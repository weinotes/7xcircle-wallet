/**
 * Copyright 2026 Davey Wong <wgwcko@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * TRON chain adapter (TRX + TRC20), client-side signing.
 *
 * TRON differs from both EVM and Solana in ways that leak into every layer:
 *   - Transactions are protobuf, signed ECDSA(secp256k1, sha256(raw_data))
 *     — same curve as EVM, only the derivation path differs (m/44'/195')
 *   - Fees are deterministic resource consumption (energy + bandwidth),
 *     NOT an auction — fee tiers only widen the fee_limit safety cap
 *   - TAPOS: every tx embeds a reference block and expires; callers must
 *     rebuild on expiry like Solana blockhash (see UnsignedTx.expiration)
 *   - The HTTP API is POST /wallet/* JSON on a fullnode (TronGrid)
 *
 * All crypto/serialization lives in the pure modules (protobuf/address/tx)
 * with unit tests; this file is only request mapping.
 */

import { sha256 } from '@noble/hashes/sha256';
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type ContractFunctionName,
} from 'viem';

import {
  formatBalance,
  fromHex,
  parseAmount as parseAmountHelper,
  toHex,
} from '@open-wallet/shared';
import type {
  ChainConfig,
  ExternalTx,
  FeeEstimate,
  SignedTransaction,
  TokenBalance,
  TokenInfo,
  TransactionRecord,
  TxIntent,
  UnsignedTx,
} from '@open-wallet/shared';
import type { BuildOpts, ChainAdapter } from '@open-wallet/core';

import {
  isValidTronAddress,
  publicKeyToTronAddress,
  toAddressBytes,
  tronToEvmAddress,
} from './address.js';
import {
  buildRawData,
  decodeRawDataJson,
  feeLimitForTier,
  signRawData,
  type TronBlockHeader,
} from './tx.js';

/** TRX has 6 decimals (1 TRX = 1_000_000 SUN) */
const TRX_DECIMALS = 6;

/** Hex form of an address is 0x41-prefixed 21 bytes, no 0x, for visible=false APIs */
function addressHex(address: string): string {
  return toHex(toAddressBytes(address));
}

/** Zero address in Tron hex form — valid owner placeholder for pure reads */
const ZERO_OWNER_HEX = '41' + '00'.repeat(20);

/**
 * Energy a TRC20 transfer consumes when the node cannot simulate it.
 *
 * Measured on mainnet (2026-09): ~31.9k-64.3k to an existing recipient, ~65.5k
 * to a fresh one. The worst case is the honest fallback — an estimate that is
 * too low makes a user under-fund a transfer that then fails.
 */
const DEFAULT_TRC20_ENERGY = 65_527n;

/** Result of /wallet/getaccountresource (staked + free allowances) */
interface AccountResourceResponse {
  EnergyLimit?: number;
  EnergyUsed?: number;
  NetLimit?: number;
  NetUsed?: number;
  freeNetLimit?: number;
  freeNetUsed?: number;
}

/**
 * What an intent costs in Tron's resource model, and what the account already
 * has staked. Everything is raw units; SUN conversion happens in the caller so
 * the UI can price the shortfall without a second RPC round trip.
 */
export interface TronResourceEstimate {
  /** energy the call is expected to consume */
  energyUsed: number;
  /** staked energy available right now */
  energyAvailable: number;
  /** uncovered energy — this is what renting would remove */
  energyShortfall: number;
  /** bytes of bandwidth the signed transaction needs */
  bandwidthUsed: number;
  /** staked + free bandwidth available right now */
  bandwidthAvailable: number;
  /** TRX (in SUN) that would be burned for the uncovered part */
  burnSun: string;
  energyPriceSun: string;
  bandwidthPriceSun: string;
}

/**
 * Known-good TRC20 contracts for the default asset view, keyed by chain id.
 * Full token discovery needs a TronGrid API key (see setGridApiKey); until
 * then we still surface the token degens actually hold: USDT on mainnet.
 */
const SEED_TOKENS: Record<string, Array<{ address: string; symbol: string; name: string; decimals: number }>> = {
  'tron-227': [
    {
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT-TRC20
      symbol: 'USDT',
      name: 'Tether USD (TRC20)',
      decimals: 6,
    },
  ],
};

/** Result of /wallet/triggerconstantcontract */
interface ConstantCallResult {
  result?: { code?: string; message?: string };
  constant_result?: string[];
  energy_used?: number;
}

interface BroadcastResult {
  result?: boolean;
  message?: string;
  code?: string;
}

interface NowBlockResponse {
  blockID?: string;
  block_header?: {
    raw_data?: {
      number?: number | string;
      timestamp?: number | string;
    };
  };
}

export class TronAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly chainName: string;
  readonly config: ChainConfig;

  private readonly fullNode: string;
  /** Optional TronGrid API key header for the /v1 data endpoints */
  private apiKey: string | undefined;

  /** Chain parameter cache — energy/bandwidth prices change only via votes */
  private resourcePrices: { energySun: bigint; bandwidthSun: bigint } | null = null;

  /** Head-block cache: TRON blocks are ~3s apart; a short TTL keeps the
   *  keyless TronGrid rate budget intact across estimate → build → send */
  private headerCache: { at: number; header: TronBlockHeader } | null = null;

  constructor(config: ChainConfig) {
    this.config = config;
    this.chainId = config.chainId;
    this.chainName = config.name;
    this.fullNode = config.rpcs[0];
  }

  /** Set a TronGrid API key to enable TRC20 transaction history */
  setGridApiKey(key: string | undefined): void {
    this.apiKey = key;
  }

  // ─── Address ────────────────────────────────────────────────────────

  deriveAddress(publicKey: Uint8Array, _accountIndex: number): string {
    return publicKeyToTronAddress(publicKey);
  }

  validateAddress(address: string): boolean {
    return isValidTronAddress(address);
  }

  // ─── RPC plumbing ───────────────────────────────────────────────────

  private async rpc<T>(path: string, body: unknown = {}): Promise<T> {
    // TronGrid keyless access is rate-limited per IP; back off and retry
    // rather than surfacing a 429 as a wallet error (3s, 6s, 12s waits)
    let lastStatus = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 3000 * 2 ** (attempt - 1)));
      }
      const res = await fetch(`${this.fullNode}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        return (await res.json()) as T;
      }
      lastStatus = res.status;
      if (res.status !== 429 && res.status < 500) {
        break;
      }
    }
    throw new Error(`tron ${path} HTTP ${lastStatus}`);
  }

  private async fetchHeader(maxAgeMillis = 2000): Promise<TronBlockHeader> {
    if (this.headerCache && Date.now() - this.headerCache.at < maxAgeMillis) {
      return this.headerCache.header;
    }
    const data = await this.rpc<NowBlockResponse>('/wallet/getnowblock');
    const raw = data.block_header?.raw_data;
    if (!raw || !data.blockID) {
      throw new Error('tron getnowblock unexpected shape');
    }
    const header: TronBlockHeader = {
      number: Number(raw.number),
      timestamp: Number(raw.timestamp),
      blockId: data.blockID,
    };
    this.headerCache = { at: Date.now(), header };
    return header;
  }

  // ─── Balance ────────────────────────────────────────────────────────

  async getNativeBalance(address: string): Promise<string> {
    const account = await this.rpc<{ balance?: number } | null>('/wallet/getaccount', {
      address,
      visible: true,
    });
    // Unactivated accounts return {} / null — they hold 0
    return String(account?.balance ?? 0);
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<string> {
    const hex = await this.callConstant(tokenAddress, 'balanceOf', 'balanceOf(address)', [
      tronToEvmAddress(address) as Address,
    ]);
    return BigInt(hex).toString();
  }

  async getAllTokenBalances(address: string): Promise<TokenBalance[]> {
    const native = await this.getNativeBalance(address).catch(() => '0');
    const out: TokenBalance[] = [{
      address: 'native',
      symbol: this.config.nativeSymbol,
      name: this.config.nativeSymbol,
      decimals: this.config.nativeDecimals,
      chainId: this.config.chainId,
      isNative: true,
      balance: native,
    }];

    for (const seed of SEED_TOKENS[this.chainId] ?? []) {
      try {
        const balance = await this.getTokenBalance(address, seed.address);
        out.push({
          address: seed.address,
          symbol: seed.symbol,
          name: seed.name,
          decimals: seed.decimals,
          chainId: this.config.chainId,
          isNative: false,
          balance,
        });
      } catch {
        // One token failing must not blank the whole list
      }
    }
    return out;
  }

  // ─── Transaction lifecycle ──────────────────────────────────────────

  async buildTransaction(intent: TxIntent, opts: BuildOpts): Promise<UnsignedTx> {
    // TAPOS expiry is minutes away; the 2s header cache is safe here and
    // saves a round-trip in the estimate → build → sign → send sequence
    const header = await this.fetchHeader();
    const { rawData, txId, ref } = buildRawData({
      intent,
      ownerAddress: opts.from,
      header,
      // fee_limit caps energy spend; tiers only scale the cap (Tron is not an auction)
      feeLimitSun: feeLimitForTier(opts.feeTier, 100_000_000n), // 100 TRX ceiling
    });
    return {
      chainType: 'tron',
      chainId: this.chainId,
      rawDataHex: toHex(rawData),
      txId,
      expiration: ref.expiration,
    };
  }

  async importExternalTransaction(tx: ExternalTx, _opts: BuildOpts): Promise<UnsignedTx> {
    // Aggregator/dApp transactions arrive as the JSON an unsigned
    // /wallet/*transaction endpoint returns; we only need raw_data_hex.
    const json = JSON.parse(
      tx.encoding === 'base64'
        ? Buffer.from(tx.payload, 'base64').toString('utf8')
        : tx.payload,
    ) as { raw_data_hex?: string; txID?: string };
    if (!json.raw_data_hex) {
      throw new Error('tron external tx must carry raw_data_hex');
    }
    const rawData = fromHex(strip0x(json.raw_data_hex));
    return {
      chainType: 'tron',
      chainId: this.chainId,
      rawDataHex: toHex(rawData),
      // Recompute rather than trust the caller's txID
      txId: toHex(sha256(rawData)),
      expiration: Number.MAX_SAFE_INTEGER,
    };
  }

  async signTransaction(
    tx: UnsignedTx,
    privateKey: Uint8Array,
  ): Promise<SignedTransaction> {
    if (tx.chainType !== 'tron') {
      throw new Error(`TronAdapter received ${tx.chainType} tx`);
    }
    const rawData = fromHex(tx.rawDataHex);
    const signature = signRawData(rawData, privateKey);
    return {
      raw: {
        visible: false,
        signature: [signature],
        txID: tx.txId,
        raw_data_hex: tx.rawDataHex,
        // fullnodes expect the decoded raw_data object alongside the hex
        raw_data: decodeRawDataJson(rawData),
      },
      signature,
    };
  }

  async sendTransaction(signedTx: SignedTransaction): Promise<string> {
    const body = signedTx.raw as {
      visible: boolean;
      signature: string[];
      txID: string;
      raw_data_hex: string;
      raw_data: unknown;
    };
    const res = await this.rpc<BroadcastResult>('/wallet/broadcasttransaction', body);
    if (!res.result) {
      const detail = decodeHexMessage(res.message) ?? res.code ?? JSON.stringify(res);
      throw new Error(`tron broadcast failed: ${detail}`);
    }
    return body.txID;
  }

  // ─── Explorer / history ─────────────────────────────────────────────

  async getTransactionHistory(address: string): Promise<TransactionRecord[]> {
    if (!this.apiKey) {
      // The /v1 data endpoints are TronGrid-keyed; without one we return
      // empty like the EVM adapters do on explorer failure.
      return [];
    }
    try {
      const url = `${this.gridV1()}/accounts/${address}/transactions/trc20?only_confirmed=true&limit=30`;
      const res = await fetch(url, { headers: { 'TRON-PRO-API-KEY': this.apiKey } });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: TronGridTrc20Tx[] };
      return (data.data ?? []).map(tx => ({
        hash: tx.transaction_id,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        tokenSymbol: tx.token_info?.symbol,
        tokenAddress: tx.token_info?.address ?? tx.token_address,
        tokenDecimals: Number(tx.token_info?.decimals ?? 0),
        blockNumber: Number(tx.block_number ?? 0),
        blockTimestamp: Math.floor((tx.timestamp ?? 0) / 1000),
        status: !tx.contract_ret || tx.contract_ret === 'SUCCESS'
          ? 'confirmed' as const
          : 'failed' as const,
        direction: tx.from.toLowerCase() === address.toLowerCase()
          ? 'sent' as const
          : 'received' as const,
      }));
    } catch {
      return [];
    }
  }

  async getTransactionStatus(txHash: string): Promise<TransactionRecord['status']> {
    const info = await this.rpc<Record<string, unknown>>('/wallet/gettransactioninfobyid', {
      value: txHash,
    });
    if (!info || Object.keys(info).length === 0) {
      return 'pending';
    }
    if (info.contractRet && info.contractRet !== 'SUCCESS') {
      return 'failed';
    }
    return 'confirmed';
  }

  getExplorerTxUrl(txHash: string): string | undefined {
    const base = this.config.testnet ? 'https://nile.tronscan.org' : 'https://tronscan.org';
    return `${base}/#/transaction/${txHash}`;
  }

  // ─── Fees ───────────────────────────────────────────────────────────

  async estimateFees(intent: TxIntent, opts: BuildOpts): Promise<FeeEstimate> {
    const [header, prices] = await Promise.all([
      this.fetchHeader(),
      this.getResourcePrices(),
    ]);
    const { rawData } = buildRawData({
      intent,
      ownerAddress: opts.from,
      header,
      feeLimitSun: feeLimitForTier(opts.feeTier, 100_000_000n),
    });

    // Bandwidth = raw tx size + signature, 1 SUN/byte when unstaked
    const bandwidth = BigInt(rawData.length + 65);
    // Energy: TRC20 transfer is deterministic but chain-parameter dependent
    // (~32k-65k measured on mainnet, 2026-09); native transfer needs none.
    const energy = intent.kind === 'native-transfer' ? 0n : DEFAULT_TRC20_ENERGY;
    const totalFee = energy * prices.energySun + bandwidth * prices.bandwidthSun;

    return {
      level: opts.feeTier ?? 'normal',
      gasLimit: String(energy + bandwidth),
      gasPrice: String(prices.energySun || prices.bandwidthSun),
      totalFee: String(totalFee),
    };
  }

  private async getResourcePrices(): Promise<{ energySun: bigint; bandwidthSun: bigint }> {
    if (this.resourcePrices) return this.resourcePrices;
    try {
      const res = await this.rpc<{ chainParameter?: Array<{ key: string; value: number }> }>(
        '/wallet/getchainparameters',
      );
      const params = new Map((res.chainParameter ?? []).map(p => [p.key, p.value]));
      this.resourcePrices = {
        energySun: BigInt(params.get('get_energy_price') ?? 1),
        bandwidthSun: BigInt(params.get('get_bandwidth_price') ?? 1),
      };
    } catch {
      // Mainnet prices as of 2026: 1 SUN/energy, 1 SUN/bandwidth for unstaked senders
      this.resourcePrices = { energySun: 1n, bandwidthSun: 1n };
    }
    return this.resourcePrices;
  }

  parseAmount(amount: string): string {
    return parseAmountHelper(amount, TRX_DECIMALS);
  }

  parseTokenAmount(amount: string, decimals: number): string {
    return parseAmountHelper(amount, decimals);
  }

  formatTokenAmount(raw: string, decimals: number): string {
    return formatBalance(raw, decimals, 6);
  }

  // ─── Contracts ──────────────────────────────────────────────────────

  async readContract(req: { to: string; data: string }): Promise<string> {
    // triggerconstantcontract takes a TEXT function signature (it keccaks the
    // selector itself), so arbitrary calldata without a known signature is
    // not expressible — swap-quote reads will pass the signature through a
    // dedicated intent once the aggregator UI lands.
    throw new Error(
      `tron readContract by raw calldata is not supported (contract ${req.to}); use the typed erc20 helpers or a signed intent`,
    );
  }

  async getAllowance(owner: string, token: string, spender: string): Promise<string> {
    const hex = await this.callConstant(token, 'allowance', 'allowance(address,address)', [
      tronToEvmAddress(owner) as Address,
      tronToEvmAddress(spender) as Address,
    ]);
    return BigInt(hex).toString();
  }

  async getTokenInfo(token: string): Promise<TokenInfo> {
    const [symbol, name, decimals] = await Promise.all([
      this.callConstant(token, 'symbol', 'symbol()', []),
      this.callConstant(token, 'name', 'name()', []),
      this.callConstant(token, 'decimals', 'decimals()', []),
    ]);
    return {
      symbol: decodeFunctionResult({
        abi: erc20Abi,
        functionName: 'symbol',
        data: symbol as `0x${string}`,
      }) as string,
      name: decodeFunctionResult({
        abi: erc20Abi,
        functionName: 'name',
        data: name as `0x${string}`,
      }) as string,
      decimals: Number(BigInt(decimals)),
    };
  }

  async getBlockHeight(): Promise<number> {
    const header = await this.fetchHeader();
    return header.number;
  }

  // ─── Resource model (energy / bandwidth) ───────────────────────────

  /** Staked + free allowances currently available to an account. */
  async getAccountResources(address: string): Promise<{ energyAvailable: number; bandwidthAvailable: number }> {
    const res = await this.rpc<AccountResourceResponse>('/wallet/getaccountresource', {
      address,
      visible: true,
    });
    const energyAvailable = Math.max(0, Number(res.EnergyLimit ?? 0) - Number(res.EnergyUsed ?? 0));
    const netStaked = Math.max(0, Number(res.NetLimit ?? 0) - Number(res.NetUsed ?? 0));
    const netFree = Math.max(0, Number(res.freeNetLimit ?? 0) - Number(res.freeNetUsed ?? 0));
    return { energyAvailable, bandwidthAvailable: netStaked + netFree };
  }

  /**
   * What an intent will cost in resources, and what is already staked.
   *
   * This is the input to the energy-rental offer: when `energyShortfall` is
   * large enough to buy a lot (see planResourcePurchase in ./tronsave.ts),
   * renting is cheaper than burning the TRX. The estimate itself never throws —
   * a node that cannot simulate falls back to the measured worst case.
   */
  async estimateResources(intent: TxIntent, opts: BuildOpts): Promise<TronResourceEstimate> {
    const [resources, prices, unsigned] = await Promise.all([
      this.getAccountResources(opts.from).catch(() => ({ energyAvailable: 0, bandwidthAvailable: 0 })),
      this.getResourcePrices(),
      this.buildTransaction(intent, opts),
    ]);

    if (unsigned.chainType !== 'tron') {
      throw new Error(`TronAdapter built a ${unsigned.chainType} transaction`);
    }

    const simulated = await this.estimateEnergyUsed(intent, opts.from).catch(() => null);
    const energyUsed = simulated ?? Number(intent.kind === 'native-transfer' ? 0n : DEFAULT_TRC20_ENERGY);
    // raw_data bytes + a 65-byte signature, charged at 1 SUN/byte when unstaked
    const bandwidthUsed = unsigned.rawDataHex.length / 2 + 65;

    const energyShortfall = Math.max(0, energyUsed - resources.energyAvailable);
    const bandwidthShortfall = Math.max(0, bandwidthUsed - resources.bandwidthAvailable);
    const burnSun = (
      BigInt(energyShortfall) * prices.energySun + BigInt(bandwidthShortfall) * prices.bandwidthSun
    ).toString();

    return {
      energyUsed,
      energyAvailable: resources.energyAvailable,
      energyShortfall,
      bandwidthUsed,
      bandwidthAvailable: resources.bandwidthAvailable,
      burnSun,
      energyPriceSun: String(prices.energySun),
      bandwidthPriceSun: String(prices.bandwidthSun),
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────

  /**
   * Ask the node what an erc20-shaped call would cost in energy, simulating
   * as THIS owner (the account's own staked energy changes the result).
   * Returns null when the call is not simulatable — never a guess.
   */
  private async estimateEnergyUsed(
    intent: TxIntent,
    owner: string,
  ): Promise<number | null> {
    // native-transfer burns no energy; arbitrary contract-call calldata has no
    // text selector to hand triggerconstantcontract
    if (intent.kind !== 'token-transfer' && intent.kind !== 'approve') return null;

    const isTransfer = intent.kind === 'token-transfer';
    const data = strip0x(
      isTransfer
        ? encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [tronToEvmAddress(intent.to) as Address, BigInt(intent.amountRaw)],
          })
        : encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [tronToEvmAddress(intent.spender) as Address, BigInt(intent.amountRaw)],
          }),
    );

    const res = await this.rpc<ConstantCallResult>('/wallet/triggerconstantcontract', {
      owner_address: addressHex(owner),
      contract_address: addressHex(intent.token),
      function_selector: isTransfer ? 'transfer(address,uint256)' : 'approve(address,uint256)',
      parameter: data.slice(8),
      visible: false,
    });
    return typeof res.energy_used === 'number' ? res.energy_used : null;
  }

  /** Pure erc20 read via triggerconstantcontract; returns '0x…' result hex.
   *  The API wants the TEXT signature (it derives the selector itself) and
   *  the ABI-encoded args WITHOUT the selector prefix. */
  private async callConstant(
    contract: string,
    functionName: ContractFunctionName<typeof erc20Abi, 'view'>,
    signature: string,
    args: readonly unknown[],
  ): Promise<string> {
    const data = strip0x(
      encodeFunctionData({
        abi: erc20Abi,
        functionName,
        args: args as [],
      }),
    );
    const res = await this.rpc<ConstantCallResult>('/wallet/triggerconstantcontract', {
      owner_address: ZERO_OWNER_HEX,
      contract_address: addressHex(contract),
      function_selector: signature,
      parameter: data.slice(8),
      visible: false,
    });
    const result = res.constant_result?.[0];
    if (!result) {
      throw new Error(`tron ${signature} failed: ${decodeHexMessage(res.result?.message) ?? 'no result'}`);
    }
    return '0x' + result;
  }

  private gridV1(): string {
    // /v1 endpoints live on the same host as /wallet on TronGrid deployments
    return `${new URL(this.fullNode).origin}/v1`;
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function strip0x(v: string): string {
  return v.startsWith('0x') ? v.slice(2) : v;
}

/** Node error messages come back as hex-encoded UTF-8; undefined if not hex */
function decodeHexMessage(hexMessage?: string): string | undefined {
  if (!hexMessage) return undefined;
  try {
    return new TextDecoder().decode(fromHex(hexMessage));
  } catch {
    return hexMessage;
  }
}

interface TronGridTrc20Tx {
  transaction_id: string;
  timestamp?: number;
  block_number?: number;
  from: string;
  to: string;
  value: string;
  contract_ret?: string;
  token_address?: string;
  token_info?: { address?: string; symbol?: string; decimals?: number | string };
}

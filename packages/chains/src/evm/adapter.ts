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
 * EVM-compatible chain adapter (Ethereum, BSC, Polygon, Arbitrum, etc.)
 *
 * Uses viem for all chain interactions. Supports:
 *   - EIP-1559 dynamic gas (maxFeePerGas / maxPriorityFeePerGas) — auto-detected
 *   - Legacy gas pricing fallback (for chains like BSC that lack 1559)
 *   - Transaction building, signing, broadcasting
 *   - Fallback transport across multiple RPC nodes with auto-failover
 *
 * Security notes:
 *   - private keys are accepted as transient Uint8Array; caller owns wiping
 *   - walletClient is created per-sign with its own isolated transport
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  type Address,
  type Hex,
  type PublicClient,
  type Chain as ViemChain,
  parseUnits,
  formatUnits,
  getContract,
  erc20Abi,
  parseTransaction,
} from 'viem';
import { privateKeyToAccount, publicKeyToAddress } from 'viem/accounts';
import {
  mainnet,
  bsc,
  bscTestnet,
  polygon,
  arbitrum,
  optimism,
  base,
  avalanche,
} from 'viem/chains';

import type {
  ChainConfig,
  ExternalTx,
  FeeEstimate,
  FeeTier,
  SignedTransaction,
  TokenBalance,
  TransactionRecord,
  TxIntent,
  UnsignedTx,
} from '@open-wallet/shared';
import type { BuildOpts, ChainAdapter, TokenSafetyReport } from '@open-wallet/core';
import { toEip55Address, validateEip55Address } from './utils.js';
import { ExplorerClient, type ExplorerNativeTx, type ExplorerTokenTx } from './explorer.js';
import { compileIntent, decodeUint256, encodeAllowance } from './intent.js';
import { fetchTokenSafety, type TokenScanChain } from '../security/tokenscan.js';

/**
 * Fee-tier multipliers applied to the priority fee, in basis points.
 *
 * On EIP-1559 chains `maxFeePerGas` is only a ceiling — the actual payment
 * is `min(maxFee, baseFee + priorityFee)`. So only the priority fee
 * genuinely costs more; raising the ceiling just absorbs base-fee spikes.
 */
const FEE_TIER_BPS: Record<FeeTier, bigint> = {
  slow: 9_000n,
  normal: 10_000n,
  fast: 13_000n,
};

/** Global explorer API key — read from env at module load. Optional. */
const EXPLORER_API_KEY =
  (typeof process !== 'undefined' && process.env?.EXPLORER_API_KEY) || undefined;

/**
 * Decimal chain ids GoPlus covers, as the scan API keys them. A chain absent
 * here (testnets, unsupported networks) simply has no safety scan.
 */
const SCANNABLE_CHAINS = new Map<number, TokenScanChain>([
  [1, '1'],
  [56, '56'],
  [137, '137'],
  [42161, '42161'],
  [10, '10'],
  [8453, '8453'],
  [43114, '43114'],
]);

/** Map our chainId to viem chain object */
const VIEM_CHAIN_MAP: Record<string, ViemChain> = {
  'eth-1': mainnet,
  'bsc-56': bsc,
  'bsc-97': bscTestnet,
  'polygon-137': polygon,
  'arbitrum-42161': arbitrum,
  'optimism-10': optimism,
  'base-8453': base,
  'avalanche-43114': avalanche,
};

export class EvmAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly chainName: string;
  readonly config: ChainConfig;
  readonly chainDecimalId: number;

  private publicClient: PublicClient;
  private chain: ViemChain;
  /** Effective RPC list (override applied) — reused for the signing transport */
  private rpcs: string[];
  /** Cached EIP-1559 support detection — undefined = not yet probed */
  private supports1559: boolean | undefined;
  /** Lazy explorer client — only built when history is requested */
  private explorerClient?: ExplorerClient;

  constructor(config: ChainConfig) {
    this.config = config;
    this.chainId = config.chainId;
    this.chainName = config.name;
    this.chainDecimalId = config.chainIdDecimal ?? 0;

    const viemChain = VIEM_CHAIN_MAP[config.chainId];
    if (viemChain) {
      this.chain = viemChain;
    } else {
      this.chain = {
        id: this.chainDecimalId,
        name: config.name,
        nativeCurrency: {
          name: config.nativeSymbol,
          symbol: config.nativeSymbol,
          decimals: config.nativeDecimals,
        },
        rpcUrls: {
          default: { http: config.rpcs },
          public: { http: config.rpcs },
        },
      } as ViemChain;
    }

    // Build a fallback transport over all configured RPCs.
    // Short timeout (8s) + single retry keeps the UI responsive when a
    // node is slow or unreachable; `rank: false` skips the upfront
    // parallel probe of every node (that produced many ERR_ABORTED
    // console errors in no-network environments).
    this.rpcs = config.rpcs;

    const transports = this.rpcs.map(url =>
      http(url, { timeout: 8_000, retryCount: 1, retryDelay: 200 }),
    );

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: fallback(transports, { rank: false }),
    });
  }

  /** Get (and lazily create) the explorer client for this chain */
  private getExplorerClient(): ExplorerClient | undefined {
    if (!this.config.explorer) return undefined;
    if (!this.explorerClient) {
      this.explorerClient = new ExplorerClient({
        explorerUrl: this.config.explorer,
        chainIdDecimal: this.config.chainIdDecimal,
        apiKey: EXPLORER_API_KEY,
      });
    }
    return this.explorerClient;
  }

  /**
   * Probe whether this chain supports EIP-1559.
   * Caches the result — runs once per adapter instance.
   *
   * Detection strategy: call eth_maxPriorityFeePerGas. Chains without
   * 1559 support return an error or 0, but legacy BSC also sometimes
   * returns a non-zero value. So we ALSO try estimateFeesPerGas and
   * check if it produces a sensible maxFeePerGas distinct from gasPrice.
   */
  private async detectEip1559(): Promise<boolean> {
    if (this.supports1559 !== undefined) return this.supports1559;

    try {
      // Method 1: eth_maxPriorityFeePerGas exists on 1559 chains
      const maxPriority = await this.publicClient.request({
        method: 'eth_maxPriorityFeePerGas',
      } as never);
      if (maxPriority && BigInt(maxPriority as string) > 0n) {
        this.supports1559 = true;
        return true;
      }
    } catch {
      // Method not supported → legacy chain
    }

    // Method 2: estimateFeesPerGas returns maxFeePerGas/maxPriorityFeePerGas
    try {
      const feeData = await this.publicClient.estimateFeesPerGas();
      if (feeData.maxFeePerGas !== undefined && feeData.maxPriorityFeePerGas !== undefined) {
        this.supports1559 = true;
        return true;
      }
    } catch {
      // Not supported
    }

    this.supports1559 = false;
    return false;
  }

  // ─── Address ──────────────────────────────────────────────────────

  deriveAddress(publicKey: Uint8Array, _accountIndex: number): string {
    const raw = '0x04' + Array.from(publicKey).map(b => b.toString(16).padStart(2, '0')).join('');
    return toEip55Address(publicKeyToAddress(raw as Hex));
  }

  validateAddress(address: string): boolean {
    return validateEip55Address(address);
  }

  // ─── Balance ───────────────────────────────────────────────────────

  async getNativeBalance(address: string): Promise<string> {
    const bal = await this.publicClient.getBalance({ address: address as Address });
    return bal.toString();
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<string> {
    const contract = getContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      client: this.publicClient,
    });
    const bal = await contract.read.balanceOf([address as Address]);
    return (bal as bigint).toString();
  }

  async getAllTokenBalances(address: string): Promise<TokenBalance[]> {
    const explorer = this.getExplorerClient();
    if (!explorer) {
      // No explorer configured — fall back to just native balance via RPC
      const nativeBal = await this.getNativeBalance(address).catch(() => '0');
      return [{
        address: 'native',
        symbol: this.config.nativeSymbol,
        name: this.config.nativeSymbol,
        decimals: this.config.nativeDecimals,
        chainId: this.config.chainId,
        isNative: true,
        balance: nativeBal,
      }];
    }

    let data;
    try {
      data = await explorer.getAllBalances(
        address,
        this.config.nativeSymbol,
        this.config.nativeDecimals,
      );
    } catch {
      // Explorer failed — return just native balance from RPC
      const nativeBal = await this.getNativeBalance(address).catch(() => '0');
      return [{
        address: 'native',
        symbol: this.config.nativeSymbol,
        name: this.config.nativeSymbol,
        decimals: this.config.nativeDecimals,
        chainId: this.config.chainId,
        isNative: true,
        balance: nativeBal,
      }];
    }

    const result: TokenBalance[] = [];

    // Native token first
    result.push({
      address: 'native',
      symbol: data.native.symbol,
      name: data.native.symbol,
      decimals: data.native.decimals,
      chainId: this.config.chainId,
      isNative: true,
      // Explorer native balance may be empty if it failed — fall back to RPC
      balance: data.native.balance && data.native.balance !== '0'
        ? data.native.balance
        : await this.getNativeBalance(address).catch(() => data.native.balance),
    });

    // ERC20 tokens
    for (const t of data.tokens) {
      const decimals = Number(t.TokenDecimal) || 18;
      result.push({
        address: t.TokenAddress,
        symbol: t.TokenSymbol || 'UNKNOWN',
        name: t.TokenName || t.TokenSymbol || '',
        decimals,
        chainId: this.config.chainId,
        isNative: false,
        balance: t.Balance,
      });
    }

    return result;
  }

  // ─── Transactions ──────────────────────────────────────────────────

  async buildTransaction(intent: TxIntent, opts: BuildOpts): Promise<UnsignedTx> {
    const call = compileIntent(intent);
    const from = opts.from;

    // Fill nonce from RPC
    const nonce = await this.publicClient.getTransactionCount({
      address: from as Address,
    });

    // Estimate gas for the actual operation (not hard-coded 21000)
    const gasEstimate = await this.publicClient.estimateGas({
      account: from as Address,
      to: call.to as Address,
      value: call.value ? BigInt(call.value) : undefined,
      data: call.data as Hex | undefined,
    });

    const supports1559 = await this.detectEip1559();
    const fees = await this.estimateFees(intent, opts, gasEstimate);

    const built: UnsignedTx = {
      chainType: 'evm',
      chainId: this.config.chainId,
      from,
      to: call.to,
      value: call.value,
      data: call.data,
      nonce,
      gasLimit: gasEstimate.toString(),
    };

    if (supports1559) {
      // EIP-1559 path. `estimateFees` already applied the fee tier, so
      // deriving the tip from the ceiling keeps the multiplier intact.
      built.maxFeePerGas = fees.gasPrice;
      built.maxPriorityFeePerGas = (BigInt(fees.gasPrice) / 10n).toString();
    } else {
      // Legacy path — use gasPrice only
      built.gasPrice = fees.gasPrice;
    }

    return built;
  }

  /**
   * Import an externally-built EVM transaction (an aggregator quote such as
   * 0x, or a dApp request). The payload is a fully-populated serialized
   * transaction, so we decode it rather than rebuild.
   */
  async importExternalTransaction(tx: ExternalTx, opts: BuildOpts): Promise<UnsignedTx> {
    if (tx.encoding !== 'hex') {
      throw new Error(`EVM transactions must be hex-encoded, got ${tx.encoding}`);
    }

    const parsed = parseTransaction(tx.payload as Hex);

    if (!parsed.to) {
      // The wallet UI has no way to surface a contract deployment safely.
      throw new Error('Contract creation transactions are not supported');
    }

    return {
      chainType: 'evm',
      chainId: this.config.chainId,
      from: opts.from,
      to: parsed.to,
      value: (parsed.value ?? 0n).toString(),
      data: parsed.data,
      nonce: parsed.nonce,
      gasLimit: parsed.gas?.toString(),
      gasPrice: parsed.gasPrice?.toString(),
      maxFeePerGas: parsed.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: parsed.maxPriorityFeePerGas?.toString(),
    };
  }

  async signTransaction(
    tx: UnsignedTx,
    privateKey: Uint8Array,
  ): Promise<SignedTransaction> {
    if (tx.chainType !== 'evm') {
      throw new Error(`EvmAdapter cannot sign a ${tx.chainType} transaction`);
    }

    const pkHex = '0x' + Array.from(privateKey)
      .map(b => b.toString(16).padStart(2, '0')).join('') as Hex;

    const account = privateKeyToAccount(pkHex);
    // Reuse the same fallback transport pattern as publicClient
    const transports = this.rpcs.map(url =>
      http(url, { timeout: 8_000, retryCount: 1, retryDelay: 200 }),
    );
    const walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: fallback(transports, { rank: false }),
    });

    const supports1559 = await this.detectEip1559();

    // Build gas fields — NEVER mix 1559 fields with legacy gasPrice
    const gasFields = supports1559
      ? {
          maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : undefined,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas
            ? BigInt(tx.maxPriorityFeePerGas)
            : undefined,
        }
      : {
          gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
        };

    const signature = await walletClient.signTransaction({
      to: tx.to as Address,
      value: tx.value ? BigInt(tx.value) : undefined,
      data: tx.data as Hex | undefined,
      nonce: tx.nonce,
      gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
      chainId: this.chainDecimalId,
      ...gasFields,
    });

    return { raw: signature, signature };
  }

  async sendTransaction(signedTx: SignedTransaction): Promise<string> {
    return this.publicClient.sendRawTransaction({
      serializedTransaction: signedTx.signature as Hex,
    });
  }

  // ─── Explorer ──────────────────────────────────────────────────────

  /**
   * Fetch transaction history for an address.
   *
   * Pulls from two sources:
   *   1. Block explorer API (native + ERC20 token transfers) — 99% of cases
   *   2. A local RPC fallback (only has the last nonce-threshold pending txs)
   *
   * Explorer is used because raw EVM RPC has no "get transactions by address"
   * method — you'd have to re-scan the entire blockchain which is slow.
   */
  async getTransactionHistory(address: string): Promise<TransactionRecord[]> {
    const explorer = this.getExplorerClient();
    if (!explorer) {
      // No explorer configured — nothing we can do without one
      return [];
    }

    const results = await explorer.getAllTransactions(address, 50);

    return results
      .map(tx => this.toTransactionRecord(tx, address))
      // Sort newest first (explorer already does desc, but be safe)
      .sort((a, b) => b.blockTimestamp - a.blockTimestamp);
  }

  /** Convert an explorer-native tx (or token tx) into our unified type */
  private toTransactionRecord(
    tx: ExplorerNativeTx | ExplorerTokenTx,
    address: string,
  ): TransactionRecord {
    return toTransactionRecord(tx, address);
  }

  private resolveStatus(
    tx: ExplorerNativeTx,
  ): TransactionRecord['status'] {
    return resolveStatus(tx);
  }

  /**
   * URL builder for external explorers — used by UI to link each tx.
   * Returns undefined if no explorer URL is configured.
   */
  getExplorerTxUrl(txHash: string): string | undefined {
    return this.getExplorerClient()?.txUrl(txHash);
  }

  async getTransactionStatus(txHash: string): Promise<TransactionRecord['status']> {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({
        hash: txHash as Hex,
      });
      if (!receipt) return 'pending';
      return receipt.status === 'success' ? 'confirmed' : 'failed';
    } catch {
      // viem throws when the receipt is not found yet (tx still pending
      // in the mempool) — treat as pending, don't crash the polling loop.
      return 'pending';
    }
  }

  // ─── Fees ──────────────────────────────────────────────────────────

  /**
   * Estimate fees for a transaction.
   *
   * If preEstimatedGas is provided (from buildTransaction) we use it directly
   * — this gives callers a way to show a fee that exactly matches the gas
   * that will be consumed.
   *
   * When preEstimatedGas is NOT provided we auto-run estimateGas so the
   * displayed fee is always based on the actual gas the tx needs, NOT the
   * hard-coded 21000 minimum. This is important because Max-button and fee
   * display in the Send page must agree with what buildTransaction produces.
   */
  async estimateFees(
    intent: TxIntent,
    opts: BuildOpts,
    preEstimatedGas?: bigint,
  ): Promise<FeeEstimate> {
    const call = compileIntent(intent);
    const feeTier = opts.feeTier ?? 'normal';
    const supports1559 = await this.detectEip1559();

    let gasLimit: bigint;
    if (preEstimatedGas !== undefined) {
      gasLimit = preEstimatedGas;
    } else {
      try {
        // Auto-estimate real gas needed for this specific tx
        gasLimit = await this.publicClient.estimateGas({
          account: opts.from as Address,
          to: call.to as Address,
          value: call.value ? BigInt(call.value) : undefined,
          data: call.data as Hex | undefined,
        });
      } catch {
        // estimateGas can fail on invalid params (e.g. bad to address).
        // Fall back to the standard 21000 minimum.
        gasLimit = 21_000n;
      }
    }

    let gasPrice: bigint | undefined;

    if (supports1559) {
      try {
        const feeData = await this.publicClient.estimateFeesPerGas();
        gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
      } catch {
        // 1559 path failed — will fall back to getGasPrice below
      }
    }

    if (gasPrice === undefined) {
      // Legacy / fallback path
      gasPrice = await this.publicClient.getGasPrice();
    }

    // Apply the requested speed tier
    gasPrice = (gasPrice * FEE_TIER_BPS[feeTier]) / 10_000n;

    return {
      level: feeTier,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      totalFee: (gasPrice * gasLimit).toString(),
    };
  }

  // ─── Contracts ─────────────────────────────────────────────────────

  /** Read-only call. Returns raw return data hex (e.g. '0x' for a non-contract). */
  async readContract(req: { to: string; data: string }): Promise<string> {
    const result = await this.publicClient.call({
      to: req.to as Address,
      data: req.data as Hex,
    });
    return result.data ?? '0x';
  }

  /** Current allowance the spender holds over the owner's tokens */
  async getAllowance(owner: string, token: string, spender: string): Promise<string> {
    const data = await this.readContract({
      to: token,
      data: encodeAllowance(owner, spender),
    });
    return decodeUint256(data).toString();
  }

  /** Current block number */
  async getBlockHeight(): Promise<number> {
    return Number(await this.publicClient.getBlockNumber());
  }

  /** Convert a human-readable amount to raw wei */
  parseAmount(amount: string): string {
    return parseUnits(amount, this.config.nativeDecimals).toString();
  }

  // ─── ERC20 / BEP20 tokens ──────────────────────────────────────────

  /**
   * Read token metadata from the contract on-chain.
   * Throws if the address is not a valid ERC20 contract (no symbol/decimals).
   */
  async getTokenInfo(tokenAddress: string): Promise<{
    symbol: string;
    decimals: number;
    name: string;
  }> {
    const contract = getContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      client: this.publicClient,
    });

    const [symbol, decimals, name] = await Promise.all([
      contract.read.symbol().catch(() => 'UNKNOWN'),
      contract.read.decimals().catch(() => 18),
      contract.read.name().catch(() => ''),
    ]);

    return {
      symbol: String(symbol),
      decimals: Number(decimals),
      name: String(name),
    };
  }

  /**
   * Advisory token-safety scan via GoPlus (keyless).
   *
   * Returns null for a chain GoPlus does not cover and for a token it has no
   * data on — both mean "no opinion", which the UI must show as unknown
   * rather than safe.
   */
  async getTokenSafety(tokenAddress: string): Promise<TokenSafetyReport | null> {
    const chain = SCANNABLE_CHAINS.get(this.chainDecimalId);
    if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) return null;

    const safety = await fetchTokenSafety(chain, tokenAddress);
    return safety ? { warnings: safety.warnings } : null;
  }

  /** Convert a human-readable token amount to raw units using the token's decimals */
  parseTokenAmount(amount: string, decimals: number): string {
    return parseUnits(amount, decimals).toString();
  }

  /** Convert raw token units to a human-readable string */
  formatTokenAmount(raw: string, decimals: number): string {
    return formatUnits(BigInt(raw), decimals);
  }
}

// ─── Pure helpers (exported for unit tests) ─────────────────────────

/** Resolve an explorer tx's lifecycle status (confirmed/failed/pending) */
export function resolveStatus(
  tx: ExplorerNativeTx,
): TransactionRecord['status'] {
  if (tx.isError === '1') return 'failed';
  if (tx.txreceipt_status === '0') return 'failed';
  if (tx.txreceipt_status === '1') return 'confirmed';
  // Still pending (no receipt yet)
  if (!tx.txreceipt_status || tx.txreceipt_status === '') {
    return 'pending';
  }
  return 'confirmed';
}

/**
 * Convert an explorer-native tx (or token tx) into our unified type.
 *
 * Direction rules (money-safety relevant):
 *   - from === address        → 'sent'     (we paid)
 *   - to === address          → 'received' (we got paid)
 * ERC20 token decimals MUST be propagated so the UI renders correct amounts
 * (USDT/USDC are 6 decimals, not 18 — assuming 18 shows amounts off by 10^12).
 */
export function toTransactionRecord(
  tx: ExplorerNativeTx | ExplorerTokenTx,
  address: string,
): TransactionRecord {
  const lowerAddr = address.toLowerCase();
  const from = tx.from.toLowerCase();

  const record: TransactionRecord = {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    blockNumber: Number(tx.blockNumber),
    blockTimestamp: Number(tx.timeStamp),
    status: resolveStatus(tx),
    direction: from === lowerAddr ? 'sent' : 'received',
    fee: tx.gasPrice && tx.gas
      ? (BigInt(tx.gasPrice) * BigInt(tx.gas)).toString()
      : undefined,
  };

  // ERC20 token tx fields
  const tokenTx = tx as ExplorerTokenTx;
  if (tokenTx.tokenSymbol && tokenTx.contractAddress) {
    record.tokenSymbol = tokenTx.tokenSymbol;
    record.tokenAddress = tokenTx.contractAddress;
    if (tokenTx.tokenDecimal) {
      record.tokenDecimals = Number(tokenTx.tokenDecimal);
    }
  }

  return record;
}

export { toEip55Address, validateEip55Address } from './utils.js';

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
 * Solana chain adapter (@solana/web3.js v1.x).
 *
 * Solana differs fundamentally from EVM:
 *   - Ed25519 signatures (not secp256k1) — uses SLIP-0010 hardened paths only
 *   - Base58 encoded addresses
 *   - Account model vs UTXO
 *   - Fees are base (5000 lamports/signature) + a PRIORITY fee, which is what
 *     actually decides whether a transaction lands during congestion
 *
 * Transactions are compiled to v0 VersionedTransaction so they can carry
 * address lookup tables and be composed with aggregator-built transactions.
 *
 * Retry on blockhash expiry is deliberately NOT handled here — see
 * `sendTransaction`. The adapter stays stateless and never holds a key
 * across a multi-attempt loop.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddress, getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';

import {
  base64ToBytes,
  bytesToBase64,
  formatBalance,
  fromHex,
  parseAmount as parseAmountHelper,
  toHex,
} from '@7xcircle/shared';
import type {
  ChainConfig,
  ExternalTx,
  FeeEstimate,
  FeeTier,
  SignedTransaction,
  SimulationResult,
  TokenBalance,
  TokenInfo,
  TransactionRecord,
  TxIntent,
  UnsignedTx,
} from '@7xcircle/shared';
import type { BuildOpts, ChainAdapter } from '@7xcircle/core';

import { parseSolanaTokenSafety, type SolanaTokenSafety } from '../security/solana.js';
import {
  compileIntent,
  pickPriorityFee,
  COMPUTE_UNIT_LIMIT,
  type CompileContext,
} from './intent.js';
import {
  buildJitoTipInstruction,
  JITO_TIP_LAMPORTS,
  paysJitoTip,
  sendViaJito,
} from './jito.js';
import { fetchTokenMetadata } from './jupiter.js';

/** Base fee per signature, in lamports. Solana charges this regardless of size. */
const SIGNATURE_FEE_LAMPORTS = 5_000n;

export class SolanaAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly chainName: string;
  readonly config: ChainConfig;

  private connection: Connection;

  constructor(config: ChainConfig) {
    this.config = config;
    this.chainId = config.chainId;
    this.chainName = config.name;

    this.connection = new Connection(config.rpcs[0], 'confirmed');
  }

  // ─── Address ──────────────────────────────────────────────────────

  deriveAddress(publicKey: Uint8Array, _accountIndex: number): string {
    return new PublicKey(publicKey).toBase58();
  }

  validateAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Balance ───────────────────────────────────────────────────────

  async getNativeBalance(address: string): Promise<string> {
    const bal = await this.connection.getBalance(new PublicKey(address));
    return bal.toString();
  }

  async getTokenBalance(address: string, tokenAddress: string): Promise<string> {
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(address),
        { mint: new PublicKey(tokenAddress) },
      );
      return accounts.value[0]?.account.data.parsed.info.tokenAmount.amount ?? '0';
    } catch {
      return '0';
    }
  }

  /**
   * Every asset the owner holds: native SOL plus every SPL token account.
   *
   * Solana needs no indexer for this — token accounts are enumerable from the
   * RPC in one call, which is exactly why a freshly airdropped memecoin shows
   * up here the moment it lands.
   *
   * Native SOL is included first, mirroring the EVM adapters: callers (the
   * home screen) look for the entry flagged `isNative` to render the hero
   * balance, so omitting it would show 0 SOL for a funded wallet.
   *
   * Symbols come from Jupiter's token search. That lookup is best-effort —
   * an unreachable metadata API must never cost the user their balance list,
   * so on failure the mint is shown truncated instead.
   */
  async getAllTokenBalances(address: string): Promise<TokenBalance[]> {
    const native: TokenBalance = {
      address: 'native',
      symbol: this.config.nativeSymbol,
      name: this.config.nativeSymbol,
      decimals: this.config.nativeDecimals,
      chainId: this.config.chainId,
      isNative: true,
      balance: '0',
    };
    try {
      native.balance = await this.getNativeBalance(address);
    } catch {
      // Keep 0 — the rest of the list is still worth returning
    }

    let accounts: Awaited<ReturnType<Connection['getParsedTokenAccountsByOwner']>>;
    try {
      accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(address),
        { programId: TOKEN_PROGRAM_ID },
      );
    } catch {
      return [native];
    }

    // One mint can be held in several accounts (e.g. after a partial move);
    // the wallet shows a token, not an account, so balances are summed.
    const byMint = new Map<string, TokenBalance>();

    for (const account of accounts.value) {
      const info = account.account.data.parsed.info;
      const mint: string = info.mint;
      const existing = byMint.get(mint);

      if (existing) {
        existing.balance = (BigInt(existing.balance) + BigInt(info.tokenAmount.amount)).toString();
        continue;
      }

      byMint.set(mint, {
        address: mint,
        // Truncated mint as the symbol: honest until metadata resolves
        symbol: mint.slice(0, 6),
        name: 'SPL Token',
        decimals: info.tokenAmount.decimals,
        chainId: this.config.chainId,
        isNative: false,
        balance: info.tokenAmount.amount,
      });
    }

    const tokens = [...byMint.values()];
    if (tokens.length === 0) return [native];

    try {
      const metadata = await fetchTokenMetadata(tokens.map(token => token.address));
      for (const token of tokens) {
        const meta = metadata[token.address];
        if (!meta) continue;
        token.symbol = meta.symbol;
        token.name = meta.name;
      }
    } catch {
      // Metadata API unavailable — truncated mints remain
    }

    return [native, ...tokens];
  }

  /**
   * On-chain mint metadata.
   *
   * SPL mints carry no symbol or name — resolving those needs a token list.
   * Until one is wired in we surface a truncated mint as the symbol, which
   * is what the UI has always displayed.
   */
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const mint = await getMint(
      this.connection,
      new PublicKey(tokenAddress),
      'confirmed',
      TOKEN_PROGRAM_ID,
    );

    return {
      symbol: tokenAddress.slice(0, 6),
      name: 'SPL Token',
      decimals: mint.decimals,
    };
  }

  /**
   * On-chain safety scan for an SPL mint.
   *
   * Reads the two authorities straight off the mint account (no oracle
   * needed) plus the largest token accounts for holder concentration.
   *
   * Throws only if the mint itself cannot be read — Token-2022 mints are not
   * covered, since they live under a different program. Callers treat a throw
   * as "no data", never as "safe".
   */
  async getTokenSafety(tokenAddress: string): Promise<SolanaTokenSafety> {
    const mint = new PublicKey(tokenAddress);

    const [mintInfo, largest] = await Promise.all([
      getMint(this.connection, mint, 'confirmed', TOKEN_PROGRAM_ID),
      // Concentration is the softest signal here — losing it must not lose
      // the authority verdicts, so its failure is absorbed.
      this.connection.getTokenLargestAccounts(mint).catch(() => null),
    ]);

    return parseSolanaTokenSafety({
      mintAuthority: mintInfo.mintAuthority?.toBase58() ?? null,
      freezeAuthority: mintInfo.freezeAuthority?.toBase58() ?? null,
      supply: mintInfo.supply.toString(),
      largestAccountAmounts: largest?.value.map(account => account.amount) ?? [],
    });
  }

  // ─── Transactions ──────────────────────────────────────────────────

  /**
   * Compile an intent into an unsigned v0 transaction.
   *
   * This DOES hit the network — a Solana transaction cannot exist without a
   * recent blockhash, and the priority fee needs recent fee samples. It runs
   * once per send (at confirm time), never in a render loop;
   * `estimateFees` is the cheap path for the typing case.
   */
  async buildTransaction(intent: TxIntent, opts: BuildOpts): Promise<UnsignedTx> {
    const payer = new PublicKey(opts.from);
    const feeTier = opts.feeTier ?? 'normal';

    const ctx: CompileContext = {
      destinationAtaExists: await this.destinationAtaExists(intent),
    };
    const ixs = await compileIntent(intent, payer, ctx);

    // The fast tier opts into the Jito relay: a tip transfer rides inside the
    // SAME transaction, which `sendTransaction` then recognises and routes to
    // the block engine instead of the public RPC. Mainnet only — Jito has no
    // relay for a devnet/testnet cluster, where a tip would be pure waste.
    if (this.shouldUseJito(feeTier)) {
      ixs.push(buildJitoTipInstruction(payer, JITO_TIP_LAMPORTS.fast));
    }

    const priceMicroLamports = await this.resolvePriorityFee(
      this.collectWritableAccounts(ixs),
      feeTier,
    );

    return this.compileV0(intent, payer, ixs, priceMicroLamports);
  }

  /**
   * Adopt a transaction built elsewhere — a Jupiter swap response, a dApp
   * request, an SDK. The payload already has its own blockhash and
   * ComputeBudget instructions, so it is deserialized rather than rebuilt.
   */
  async importExternalTransaction(tx: ExternalTx, _opts: BuildOpts): Promise<UnsignedTx> {
    const bytes = tx.encoding === 'base64'
      ? base64ToBytes(tx.payload)
      : fromHex(tx.payload);

    let decoded: VersionedTransaction;
    try {
      decoded = VersionedTransaction.deserialize(bytes);
    } catch (cause) {
      throw new Error(
        `Could not deserialize Solana transaction: ${(cause as Error).message}`,
        { cause },
      );
    }

    // The builder's own expiry is not carried in the serialized transaction,
    // so take the current one. It is only used to bound the confirm wait.
    const { lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

    return {
      chainType: 'solana',
      chainId: this.config.chainId,
      serialized: toHex(decoded.serialize()),
      versioned: decoded.version === 0,
      recentBlockhash: decoded.message.recentBlockhash,
      lastValidBlockHeight,
    };
  }

  async signTransaction(
    tx: UnsignedTx,
    privateKey: Uint8Array,
  ): Promise<SignedTransaction> {
    if (tx.chainType !== 'solana') {
      throw new Error(`SolanaAdapter cannot sign a ${tx.chainType} transaction`);
    }

    // Solana uses ed25519 — privateKey is the 32-byte seed from SLIP-0010
    const keypair = Keypair.fromSeed(privateKey);
    const decoded = VersionedTransaction.deserialize(fromHex(tx.serialized));
    decoded.sign([keypair]);

    const sigBytes = decoded.signatures[0];
    if (!sigBytes) throw new Error('Signing produced no signature');

    // `raw` must carry the SIGNED bytes — serializing `tx.serialized` here
    // would broadcast an unsigned transaction, which the cluster rejects.
    return { raw: toHex(decoded.serialize()), signature: bs58.encode(sigBytes) };
  }

  async sendTransaction(signedTx: SignedTransaction): Promise<string> {
    const bytes = fromHex(signedTx.raw as string);

    // A tipped transaction exists to go through the Jito block engine — that
    // routing is what the tip buys. Detection is by inspection rather than a
    // flag carried through the sign step, so a transaction built anywhere
    // (including one imported from a dApp) is routed consistently.
    //
    // Failure to reach the relay is NOT fatal: the transaction is already
    // signed and valid, so the public RPC is a real fallback — the tip then
    // lands as an ordinary transfer and the send simply loses the priority
    // routing. Falls through rather than throwing.
    if (this.shouldUseJito('fast')) {
      try {
        const decoded = VersionedTransaction.deserialize(bytes);
        if (paysJitoTip(decoded)) {
          return await sendViaJito(bytesToBase64(bytes));
        }
      } catch {
        // Detection or relay failed — fall back to the public RPC below
      }
    }

    return this.connection.sendRawTransaction(bytes, {
      // Preflight so the user gets a real error instead of a silently
      // dropped transaction.
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
  }

  // ─── Explorer ──────────────────────────────────────────────────────

  /**
   * Explorer URL for a tx hash.
   *
   * Keys off the explicit `testnet` flag rather than sniffing the RPC URLs —
   * sniffing appended `?cluster=devnet` to mainnet links whenever any
   * configured endpoint happened to contain the string "devnet".
   */
  getExplorerTxUrl(txHash: string): string {
    const base = this.config.explorer ?? 'https://explorer.solana.com';
    const cluster = this.config.testnet ? '?cluster=devnet' : '';
    return `${base.replace(/\/$/, '')}/tx/${txHash}${cluster}`;
  }

  /**
   * Fetch transaction history for a Solana address.
   *
   * Solana RPC natively supports getSignaturesForAddress (no need for
   * a third-party block explorer). The tradeoff is that each signature
   * only carries slot + timestamp; the full details (transfer amount,
   * direction, fee) need an additional getParsedTransaction call.
   *
   * We batch the first 20 signatures — more than that is prohibitively
   * slow without a dedicated indexer.
   */
  async getTransactionHistory(address: string): Promise<TransactionRecord[]> {
    try {
      const pubkey = new PublicKey(address);
      const signatures = await this.connection.getSignaturesForAddress(
        pubkey,
        { limit: 20 },
        'confirmed',
      );

      const results: TransactionRecord[] = [];

      // Fetch full tx details in parallel (bounded to 20 max)
      const details = await Promise.allSettled(
        signatures.map(sig => this.connection.getParsedTransaction(sig.signature, 'confirmed')),
      );

      for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        const detailResult = details[i];

        const base: TransactionRecord = {
          hash: sig.signature,
          from: address,
          to: '',
          value: '0',
          blockNumber: sig.slot,
          blockTimestamp: sig.blockTime ?? 0,
          status: sig.err ? 'failed' : 'confirmed',
          direction: 'sent',      // default; refined below
        };

        if (detailResult.status === 'fulfilled' && detailResult.value) {
          const tx = detailResult.value;
          const meta = tx.meta;

          // Fee
          if (meta?.fee !== undefined) {
            base.fee = meta.fee.toString();
          }

          // Try to find a native SOL transfer via SystemProgram instruction
          // in the parsed inner or outer instructions.
          const parsedIx = tx.transaction.message.instructions;
          for (const ix of parsedIx) {
            const parsed = (ix as { parsed?: unknown }).parsed as
              | {
                  program?: string;
                  type?: string;
                  info?: { source?: string; destination?: string; lamports?: number };
                }
              | undefined;
            if (
              parsed?.program === 'system' &&
              parsed.type === 'transfer' &&
              parsed.info?.source === address
            ) {
              base.from = parsed.info.source;
              base.to = parsed.info.destination ?? '';
              base.value = parsed.info.lamports?.toString() ?? '0';
              base.direction = 'sent';
              break;
            }
            // Received SOL — look at pre/post balances of other accounts
          }

          // Detect "received" by comparing pre/post balances at our index
          if (meta?.preBalances && meta.postBalances) {
            try {
              const accountKeys = tx.transaction.message.accountKeys;
              const accountIndex = accountKeys.findIndex(
                k => (k.pubkey as PublicKey).toBase58() === address,
              );
              if (accountIndex >= 0) {
                const diff = (meta.postBalances[accountIndex] ?? 0) - (meta.preBalances[accountIndex] ?? 0);
                // If balance increased overall, it's a receive (not our primary transfer above)
                if (diff > 0 && base.direction === 'sent' && BigInt(base.value ?? '0') === 0n) {
                  // Only treat as received if we didn't already identify a transfer
                  base.direction = 'received';
                  base.value = diff.toString();
                }
              }
            } catch {
              // account key parsing may fail — no big deal, skip direction refine
            }
          }
        }

        results.push(base);
      }

      // Sort newest first (signatures already come that way — be safe)
      results.sort((a, b) => b.blockTimestamp - a.blockTimestamp);
      return results;
    } catch {
      return [];
    }
  }

  async getTransactionStatus(txHash: string): Promise<TransactionRecord['status']> {
    try {
      const status = await this.connection.getSignatureStatuses([txHash]);
      const info = status.value[0];
      if (!info) return 'pending';
      if (info.err) return 'failed';
      return 'confirmed';
    } catch {
      return 'pending';
    }
  }

  // ─── Fees ──────────────────────────────────────────────────────────

  /**
   * Cheap fee estimate for the typing path.
   *
   * Deliberately does NOT simulate: the compute limit is free (you pay for
   * units *consumed*, not the ceiling), so a generous constant avoids an
   * RPC round trip per keystroke. The estimate is therefore an upper bound
   * on the priority-fee component.
   */
  async estimateFees(intent: TxIntent, opts: BuildOpts): Promise<FeeEstimate> {
    const feeTier = opts.feeTier ?? 'normal';
    const cuLimit = BigInt(COMPUTE_UNIT_LIMIT[intent.kind]);

    let priceMicroLamports: number;
    try {
      const samples = await this.connection.getRecentPrioritizationFees({});
      priceMicroLamports = pickPriorityFee(samples.map(s => s.prioritizationFee), feeTier);
    } catch {
      priceMicroLamports = pickPriorityFee([], feeTier);
    }

    const priorityFee = (BigInt(priceMicroLamports) * cuLimit) / 1_000_000n;
    // The fee the user is shown must include the Jito tip the fast tier
    // attaches, otherwise the quoted total is a lie whenever the send is
    // routed through the block engine.
    const jitoTip = this.shouldUseJito(feeTier) ? JITO_TIP_LAMPORTS.fast : 0n;
    const totalFee = SIGNATURE_FEE_LAMPORTS + priorityFee + jitoTip;

    return {
      level: feeTier,
      gasLimit: cuLimit.toString(),
      // On Solana this is the per-compute-unit price in micro-lamports,
      // NOT the total fee — `totalFee` is the number to display.
      gasPrice: priceMicroLamports.toString(),
      totalFee: totalFee.toString(),
    };
  }

  /** Convert human-readable SOL amount to lamports string */
  parseAmount(amount: string): string {
    return parseAmountHelper(amount, this.config.nativeDecimals);
  }

  /** Convert a human-readable SPL amount to raw units */
  parseTokenAmount(amount: string, decimals: number): string {
    return parseAmountHelper(amount, decimals);
  }

  /** Convert raw SPL units to a human-readable string */
  formatTokenAmount(raw: string, decimals: number): string {
    return formatBalance(raw, decimals);
  }

  // ─── Contracts ─────────────────────────────────────────────────────

  /**
   * Not supported. A Solana read needs a program id PLUS its account metas,
   * which `{ to, data }` cannot express. Solana-side reads (swap quotes,
   * pool state) go through the protocol's own HTTP API instead.
   */
  async readContract(): Promise<string> {
    throw new Error(
      'readContract is not supported on Solana — a read requires account metas, ' +
      'not just a program id and data. Use the protocol API instead.',
    );
  }

  /** Solana has no approval concept — approve the full amount. */
  async getAllowance(): Promise<string> {
    return (2n ** 256n - 1n).toString();
  }

  /** Current slot height — used to detect blockhash expiry */
  async getBlockHeight(): Promise<number> {
    return this.connection.getBlockHeight('confirmed');
  }

  /**
   * Simulate a transaction before signing — a pre-flight check.
   *
   * Compiles the intent into a v0 transaction, then asks the Solana cluster
   * "would this succeed?" via `simulateTransaction`. If the simulation
   * returns an error, the transaction would fail on-chain and signing it
   * would waste the transaction fee (5000 lamports + priority fee).
   *
   * Token changes are derived from the intent (what we know we're sending),
   * not from log parsing (which would require decoding program logs).
   */
  async simulateTransaction(intent: TxIntent, opts: BuildOpts): Promise<SimulationResult | null> {
    const payer = new PublicKey(opts.from);
    const feeTier = opts.feeTier ?? 'normal';
    const tokenChanges: SimulationResult['tokenChanges'] = [];
    const warnings: string[] = [];

    try {
      const ctx: CompileContext = {
        destinationAtaExists: await this.destinationAtaExists(intent),
      };
      const ixs = await compileIntent(intent, payer, ctx);
      const priceMicroLamports = await this.resolvePriorityFee(
        this.collectWritableAccounts(ixs),
        feeTier,
      );

      // Build a v0 message with the current blockhash
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      const messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT[intent.kind] }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priceMicroLamports }),
          ...ixs,
        ],
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(messageV0);
      const result = await this.connection.simulateTransaction(versionedTx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (result.value.err) {
        const logs = result.value.logs?.join('\n') ?? 'No logs';
        return {
          success: false,
          error: `Solana simulation failed: ${JSON.stringify(result.value.err)}\n${logs}`,
          tokenChanges: [],
          warnings: [],
        };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown simulation error';
      return {
        success: false,
        error: reason,
        tokenChanges: [],
        warnings: [],
      };
    }

    // Simulation succeeded — derive token changes from the intent
    switch (intent.kind) {
      case 'native-transfer':
        tokenChanges.push({
          symbol: this.config.nativeSymbol,
          address: 'native',
          decimals: this.config.nativeDecimals,
          amountRaw: intent.amountRaw,
          direction: 'out',
        });
        break;

      case 'token-transfer':
        tokenChanges.push({
          symbol: 'TOKEN', // caller resolves via getTokenInfo if needed
          address: intent.token,
          decimals: intent.decimals,
          amountRaw: intent.amountRaw,
          direction: 'out',
        });
        break;

      case 'contract-call':
      case 'approve':
        // Solana has no approval concept; contract-call is generic
        warnings.push('Solana simulation preview only — review the transaction details carefully');
        break;
    }

    return { success: true, tokenChanges, warnings };
  }

  // ─── Internals ─────────────────────────────────────────────────────

  /** Assemble a v0 transaction from instructions + compute budget */
  private async compileV0(
    intent: TxIntent,
    payer: PublicKey,
    ixs: TransactionInstruction[],
    priceMicroLamports: number,
  ): Promise<UnsignedTx> {
    // ComputeBudget instructions conventionally come first. The limit is a
    // ceiling — Solana charges units *consumed*, so a generous value costs
    // nothing and protects against under-estimation.
    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT[intent.kind] }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priceMicroLamports }),
      ...ixs,
    ];

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');

    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);

    return {
      chainType: 'solana',
      chainId: this.config.chainId,
      serialized: toHex(transaction.serialize()),
      versioned: true,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
    };
  }

  /**
   * Does the recipient already hold this mint?
   *
   * On lookup failure we assume NOT, so the create instruction is included.
   * A missing ATA makes the transfer fail outright, whereas an unexpected
   * create only fails if the account appeared in the meantime.
   */
  private async destinationAtaExists(intent: TxIntent): Promise<boolean> {
    if (intent.kind !== 'token-transfer') return false;

    try {
      const ata = await getAssociatedTokenAddress(
        new PublicKey(intent.token),
        new PublicKey(intent.to),
      );
      return (await this.connection.getAccountInfo(ata)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Query recent priority-fee samples and pick a price for the tier.
   *
   * Scoping the sample to the accounts this transaction touches gives a
   * sharper price than the network-wide average, because contention is
   * per-account.
   */
  private async resolvePriorityFee(
    writable: PublicKey[],
    tier: FeeTier,
  ): Promise<number> {
    try {
      const samples = await this.connection.getRecentPrioritizationFees(
        writable.length > 0 ? { lockedWritableAccounts: writable } : {},
      );
      return pickPriorityFee(samples.map(s => s.prioritizationFee), tier);
    } catch {
      return pickPriorityFee([], tier);
    }
  }

  /**
   * Whether the Jito relay applies to this adapter at all.
   *
   * Gated on cluster: the block engine only relays mainnet (and Jito's own
   * testnet), so a devnet config must never pay a tip for routing it cannot
   * get. Combined with the tier check this is the single place the decision
   * lives, shared by build / send / fee estimate so they can never disagree.
   */
  private shouldUseJito(tier: FeeTier): boolean {
    return tier === 'fast' && !this.config.testnet;
  }

  /** Collect the writable accounts an instruction set touches */
  private collectWritableAccounts(instructions: TransactionInstruction[]): PublicKey[] {
    const seen = new Set<string>();
    const writable: PublicKey[] = [];

    for (const ix of instructions) {
      for (const meta of ix.keys) {
        if (!meta.isWritable) continue;
        const key = meta.pubkey.toBase58();
        if (seen.has(key)) continue;
        seen.add(key);
        writable.push(meta.pubkey);
      }
    }

    return writable;
  }
}

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
 * Chain adapter interface — the core abstraction that unifies all chains.
 * Every chain (EVM, Solana, future ones) must implement this interface.
 *
 * Design goals:
 *   - Uniform API regardless of underlying chain
 *   - Adapter instances are stateless; private keys are passed in per-call
 *   - Fail gracefully on RPC errors with retry support at the chain level
 */

import type {
  ChainConfig,
  ExternalTx,
  FeeEstimate,
  FeeTier,
  SignedTransaction,
  TokenBalance,
  TokenInfo,
  TransactionRecord,
  TxIntent,
  UnsignedTx,
} from '@open-wallet/shared';

/** Options for building / estimating a transaction */
export interface BuildOpts {
  /**
   * Sender address. The intent describes *what* to do; this says *who* does it.
   * Required because gas/nonce/payer all depend on the sender.
   */
  from: string;
  /** Fee speed tier — maps to each chain's own acceleration strategy */
  feeTier?: FeeTier;
}

/**
 * Advisory token-safety findings for one asset.
 *
 * Only `warnings` is part of the contract: chains report different things
 * (EVM: honeypot, transfer tax; Solana: mint authority, holder concentration)
 * and the UI must render all of them the same way. An EMPTY list means "every
 * check we run passed" — never "we could not check", which is `null`.
 */
export interface TokenSafetyReport {
  /** Human-readable risk strings; empty = all clear */
  warnings: string[];
}

export interface ChainAdapter {
  /** Chain unique identifier (e.g. "bsc-56", "eth-1", "solana") */
  readonly chainId: string;

  /** Human-readable chain name */
  readonly chainName: string;

  /** The chain configuration this adapter was built from */
  readonly config: ChainConfig;

  // ─── Address operations ────────────────────────────────────────────

  /** Derive a native address from public key bytes */
  deriveAddress(publicKey: Uint8Array, accountIndex: number): string;

  /** Validate a native address format */
  validateAddress(address: string): boolean;

  // ─── Balance queries ───────────────────────────────────────────────

  /** Get native token balance (raw smallest unit, as string) */
  getNativeBalance(address: string): Promise<string>;

  /** Get ERC20/BEP20/SPL token balance */
  getTokenBalance(address: string, tokenAddress: string): Promise<string>;

  /** Get all known token balances for an address */
  getAllTokenBalances(address: string): Promise<TokenBalance[]>;

  // ─── Transaction lifecycle ──────────────────────────────────────────

  /**
   * Compile a semantic intent into an unsigned, ready-to-sign transaction.
   *
   * Chains translate the intent into their own native form — EVM fills
   * nonce/gas/calldata, Solana compiles instructions into a v0 message and
   * attaches a priority fee.
   */
  buildTransaction(intent: TxIntent, opts: BuildOpts): Promise<UnsignedTx>;

  /**
   * Wrap a transaction built elsewhere (an aggregator quote, a dApp request)
   * so it can go through the normal sign/broadcast path.
   */
  importExternalTransaction(tx: ExternalTx, opts: BuildOpts): Promise<UnsignedTx>;

  /** Sign a transaction with the given private key */
  signTransaction(
    tx: UnsignedTx,
    privateKey: Uint8Array,
  ): Promise<SignedTransaction>;

  /**
   * Broadcast a signed transaction, returns tx hash.
   *
   * Broadcast only — does not wait for confirmation. Callers that need
   * retry-on-expiry (Solana blockhash) drive that themselves, because
   * rebuilding requires re-signing and the private key must not outlive
   * the caller's own scope.
   */
  sendTransaction(signedTx: SignedTransaction): Promise<string>;

  // ─── Explorer / history ────────────────────────────────────────────

  /** Fetch transaction history for an address */
  getTransactionHistory(address: string): Promise<TransactionRecord[]>;

  /** Get transaction status by hash */
  getTransactionStatus(txHash: string): Promise<TransactionRecord['status']>;

  /**
   * Build an external block-explorer URL for a tx hash.
   * Returns undefined if no explorer URL is configured for this chain.
   *
   * Default implementation returns `${config.explorer}/tx/${txHash}`.
   * Chains with custom explorer URL layouts can override (e.g. Solana).
   */
  getExplorerTxUrl?(txHash: string): string | undefined;

  // ─── Fees ──────────────────────────────────────────────────────────

  /** Estimate fees for a transaction */
  estimateFees(intent: TxIntent, opts: BuildOpts): Promise<FeeEstimate>;

  /** Convert a human-readable amount to raw smallest unit string */
  parseAmount(amount: string): string;

  /** Convert a human-readable token amount to raw units using the token's decimals */
  parseTokenAmount(amount: string, decimals: number): string;

  /** Convert raw token units to a human-readable string */
  formatTokenAmount(raw: string, decimals: number): string;

  // ─── Contracts ─────────────────────────────────────────────────────

  /**
   * Read-only contract call (`eth_call` / `simulateTransaction`).
   * Returns the raw return data. Needed for swap quotes, slippage
   * calculation and pre-flight failure detection.
   */
  readContract(req: { to: string; data: string }): Promise<string>;

  /**
   * ERC20 allowance. Chains without an approval concept return the max
   * uint256 so callers can treat "no approval needed" uniformly.
   */
  getAllowance(owner: string, token: string, spender: string): Promise<string>;

  // ─── Metadata ──────────────────────────────────────────────────────

  /** Read token metadata from the contract / mint */
  getTokenInfo(token: string): Promise<TokenInfo>;

  /**
   * Advisory token-safety scan (honeypot, live mint authority, holder
   * concentration, …).
   *
   * OPTIONAL — a chain with no oracle omits the method, and the UI must then
   * show "no data" rather than "safe". Implementations return `null` when the
   * oracle has no opinion about this token (unlisted, rate-limited), which is
   * also NOT the same as a clean report.
   *
   * Findings never hard-block a transaction: false positives exist, so the
   * contract is "loud and skimmable", not "prevented".
   */
  getTokenSafety?(token: string): Promise<TokenSafetyReport | null>;

  /**
   * Current chain height. Used to detect blockhash expiry on Solana;
   * harmless and useful elsewhere.
   */
  getBlockHeight(): Promise<number>;
}

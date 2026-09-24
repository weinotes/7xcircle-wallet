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
 * Jupiter Swap API client — the P1 revenue line from MONETIZATION.md.
 *
 * Flow (all request/response SHAPES live here as pure functions so they
 * are unit-tested without network; only the two fetch calls are impure):
 *
 *   1. GET  /quote  inputMint outputMint amount slippageBps [platformFeeBps]
 *   2. POST /swap   { quoteResponse, userPublicKey, feeAccount? }
 *        → base64 unsigned VersionedTransaction
 *   3. adapter.importExternalTransaction(base64) → sign locally → send
 *
 * Revenue: `platformFeeBps` (basis points of the INPUT) is routed by
 * Jupiter's program to `feeAccount` — an associated token account owned by
 * OUR fee wallet, derived client-side. The user's private key never leaves
 * this device; the fee wallet is a plain public config value.
 *
 * Endpoints: lite-api.jup.ag is the keyless free tier (rate-limited but
 * sufficient for a wallet's own traffic); a Pro key can be injected via
 * setJupiterBaseUrl without touching call sites.
 */

import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

// ─── Well-known mints for the default picker ────────────────────────

export const SOL_MINT = 'So11111111111111111111111111111111111111112'; // wrapped SOL
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

export interface SwapTokenOption {
  mint: string;
  symbol: string;
  decimals: number;
}

/** Curated starting set — users can always paste an arbitrary mint address */
export const SWAP_TOKEN_OPTIONS: SwapTokenOption[] = [
  { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
  { mint: USDC_MINT, symbol: 'USDC', decimals: 6 },
  { mint: USDT_MINT, symbol: 'USDT', decimals: 6 },
];

// ─── Endpoint config ────────────────────────────────────────────────

const DEFAULT_BASE = 'https://lite-api.jup.ag/swap/v1';
let baseUrl = DEFAULT_BASE;

/** Point at a Pro tier (api.jup.ag) or proxy; pass undefined to reset */
export function setJupiterBaseUrl(url: string | undefined): void {
  baseUrl = url && url.length > 0 ? url : DEFAULT_BASE;
}

export function getJupiterBaseUrl(): string {
  return baseUrl;
}

// ─── Quote ──────────────────────────────────────────────────────────

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  /** input amount in raw smallest units (lamports / token base units) */
  amountRaw: string;
  /** max acceptable price move, basis points (e.g. 50 = 0.5%) */
  slippageBps: number;
  /** OUR platform fee, basis points of the input; omit or 0 for none */
  platformFeeBps?: number;
  /** restrict routing to verified tokens only — anti-scam default for memes */
  restrictIntermediateTokens?: boolean;
}

/** Build the /quote URL. Pure and test-guarded: param names are the contract. */
export function buildQuoteUrl(params: QuoteParams, base = baseUrl): string {
  assertMint(params.inputMint, 'inputMint');
  assertMint(params.outputMint, 'outputMint');
  if (!/^\d+$/.test(params.amountRaw) || BigInt(params.amountRaw) <= 0n) {
    throw new Error('quote amount must be a positive integer of raw units');
  }
  assertBps(params.slippageBps, 'slippageBps', 5000);
  if (params.platformFeeBps !== undefined) {
    assertBps(params.platformFeeBps, 'platformFeeBps', 500);
  }

  const q = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amountRaw,
    slippageBps: String(params.slippageBps),
    swapMode: 'ExactIn',
  });
  if (params.platformFeeBps) q.set('platformFeeBps', String(params.platformFeeBps));
  if (params.restrictIntermediateTokens ?? true) {
    q.set('restrictIntermediateTokens', 'true');
  }
  return `${base}/quote?${q.toString()}`;
}

/** The subset of the quote response the wallet renders */
export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  /** quote's own min-out after its slippage (ExactIn) */
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  platformFeeBps?: number;
  /** opaque — echo it back into /swap untouched */
  raw: unknown;
}

/** Validate + type the quote response. Throws on a malformed/served-error body. */
export function parseQuote(json: unknown): JupiterQuote {
  const q = json as Partial<Record<keyof JupiterQuote, unknown>> & { error?: string };
  if (!q || q.error || typeof q.inAmount !== 'string' || typeof q.outAmount !== 'string') {
    throw new Error(`jupiter quote failed: ${q?.error ?? 'unexpected response shape'}`);
  }
  return {
    inputMint: q.inputMint as string,
    outputMint: q.outputMint as string,
    inAmount: q.inAmount,
    outAmount: q.outAmount,
    otherAmountThreshold: typeof q.otherAmountThreshold === 'string' ? q.otherAmountThreshold : q.outAmount,
    priceImpactPct: typeof q.priceImpactPct === 'string' ? q.priceImpactPct : '0',
    slippageBps: Number(q.slippageBps ?? 0),
    ...(q.platformFeeBps !== undefined ? { platformFeeBps: Number(q.platformFeeBps) } : {}),
    raw: json,
  };
}

/** Fetch a quote (impure — thin wrapper over the pure builders) */
export async function fetchQuote(params: QuoteParams): Promise<JupiterQuote> {
  const res = await fetch(buildQuoteUrl(params), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`jupiter quote HTTP ${res.status}`);
  }
  return parseQuote(await res.json());
}

// ─── Swap (transaction build) ───────────────────────────────────────

export interface SwapBuildParams {
  quote: JupiterQuote;
  /** the user's own wallet — Jupiter needs it to shape the tx */
  userPublicKey: string;
  /** OUR fee ATA, required when the quote carries platformFeeBps */
  feeAccount?: string;
  /** auto wrap/unwrap wSOL for native SOL legs */
  wrapAndUnwrapSol?: boolean;
}

/** POST /swap body. Pure and test-guarded. */
export function buildSwapBody(params: SwapBuildParams): Record<string, unknown> {
  if (params.quote.platformFeeBps && !params.feeAccount) {
    throw new Error('feeAccount is required when the quote carries a platform fee');
  }
  if (params.feeAccount !== undefined) assertBase58Address(params.feeAccount, 'feeAccount');
  return {
    quoteResponse: params.quote.raw,
    userPublicKey: params.userPublicKey,
    wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
    dynamicComputeUnitLimit: true,
    // landing speed is the product for memecoin users — Jito bundles can be
    // layered on later; priority fee is added by our own SolanaAdapter path
    ...(params.feeAccount ? { feeAccount: params.feeAccount } : {}),
  };
}

/** Parse the /swap response into the base64 unsigned transaction */
export function parseSwapResponse(json: unknown): string {
  const payload = (json as { swapTransaction?: string; error?: string }) ?? {};
  if (!payload.swapTransaction) {
    throw new Error(`jupiter swap failed: ${payload.error ?? 'missing swapTransaction'}`);
  }
  return payload.swapTransaction;
}

export async function fetchSwapTransaction(params: SwapBuildParams): Promise<string> {
  const res = await fetch(`${baseUrl}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSwapBody(params)),
  });
  if (!res.ok) {
    throw new Error(`jupiter swap HTTP ${res.status}`);
  }
  return parseSwapResponse(await res.json());
}

// ─── Fee routing ────────────────────────────────────────────────────

/**
 * Derive the ATA of OUR fee wallet for the mint being charged.
 * Deterministic (no network) despite the Promise API of the SPL helper.
 */
export async function deriveFeeAccount(feeWallet: string, mint: string): Promise<string> {
  const wallet = new PublicKey(feeWallet);
  const tokenMint = new PublicKey(mint);
  const ata = await getAssociatedTokenAddress(tokenMint, wallet, true);
  return ata.toBase58();
}

// ─── guards ─────────────────────────────────────────────────────────

function assertMint(value: string, label: string): void {
  if (!isBase58Address(value)) {
    throw new Error(`${label} is not a valid base58 mint address`);
  }
}

function assertBase58Address(value: string, label: string): void {
  if (!isBase58Address(value)) {
    throw new Error(`${label} is not a valid base58 address`);
  }
}

function isBase58Address(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function assertBps(value: number, label: string, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be an integer in 0..${max} bps`);
  }
}

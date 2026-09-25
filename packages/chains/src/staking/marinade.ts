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
 * Marinade referral staking — the SOL yield line (MONETIZATION §4.2).
 *
 * ⚠ STATUS: THE REFERRAL PROGRAM IS PAUSED (since 2026-05-08). No commission
 * is paid and no new referral links are issued while it is paused; terms may
 * change before it restarts. This module is therefore INERT by design — it
 * only works once a referral code is configured, and until then every fetch
 * returns null and the UI shows nothing. It is shipped now so that turning the
 * program back on is a one-line config change, not a re-integration.
 *
 * Mechanism: Marinade's Transaction Router returns a fully-formed versioned
 * transaction for the SOL → mSOL route:
 *
 *   GET /v1/route?user=&asset_in=sol&amount_in=<lamports>&asset_out=msol
 *                &referral_id=<pubkey>
 *   → { id, tx: { message, non_user_sigs, blockhash, last_valid_block_height },
 *       funding: { fees, rent }, requested_amount_in, effective_amount_in,
 *       amount_out, details }
 *
 * The router hands back the transaction MESSAGE, not a signed wire
 * transaction, so `marinadeRouteToExternalTx` re-assembles the wire form
 * (compact-u16 signature count + zeroed signature slots + message) that
 * SolanaAdapter.importExternalTransaction expects. That layout is pinned by a
 * round-trip unit test against @solana/web3.js, not assumed.
 *
 * Rate limit is low (a handful of requests), so this is a one-shot quote and
 * never a polling loop.
 */

// ─── Well-known program / mint addresses ────────────────────────────

/** Liquid Staking referral program (pays the 12.5 bps, when active). */
export const MARINADE_LS_REFERRAL_PROGRAM = 'MR2LqxoSbw831bNy68utpu5n4YqBH3AzDmddkgk9LQv';
/** Native Staking referral proxy. */
export const MARINADE_NATIVE_STAKING_PROXY = 'mnspJQyF1KdDEs5c6YJPocYdY1esBgVQFufM2dY9oDk';
/** mSOL mint — the token received for staked SOL. */
export const MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';

/**
 * Whether the referral program currently pays out. Hard-coded `false` because
 * this is a business fact, not a user setting: flipping it must be a code
 * change reviewed alongside the current terms.
 */
export const MARINADE_REFERRAL_ACTIVE = false;

// ─── Endpoint + referral config ─────────────────────────────────────

const DEFAULT_ROUTER = 'https://tx-router.marinade.finance';

let routerBase = DEFAULT_ROUTER;
let referralCode: string | undefined;

/** Point at a proxy/mirror; undefined resets the default. */
export function setMarinadeRouterBaseUrl(url: string | undefined): void {
  routerBase = url && url.length > 0 ? url.replace(/\/+$/, '') : DEFAULT_ROUTER;
}

export function getMarinadeRouterBaseUrl(): string {
  return routerBase;
}

/** Install OUR referral code. Pass undefined to disable the yield line. */
export function setMarinadeReferralCode(code: string | undefined): void {
  const trimmed = code?.trim();
  if (trimmed && !isBase58Pubkey(trimmed)) {
    throw new Error('marinade referral code must be a base58 public key');
  }
  referralCode = trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Whether the referral route is usable — the UI gates the card on this. */
export function hasMarinadeReferralCode(): boolean {
  return referralCode !== undefined;
}

// ─── Route request ──────────────────────────────────────────────────

export interface MarinadeRouteParams {
  /** the staker's own Solana address */
  user: string;
  /** SOL amount to stake, in lamports */
  amountLamports: string;
  assetIn?: 'sol';
  assetOut?: 'msol';
}

export function buildMarinadeRouteUrl(params: MarinadeRouteParams, base = routerBase): string {
  if (!isBase58Pubkey(params.user)) throw new Error('user must be a base58 Solana address');
  if (!/^\d+$/.test(params.amountLamports) || BigInt(params.amountLamports) <= 0n) {
    throw new Error('amountLamports must be a positive integer');
  }
  const q = new URLSearchParams({
    user: params.user,
    asset_in: params.assetIn ?? 'sol',
    amount_in: params.amountLamports,
    asset_out: params.assetOut ?? 'msol',
  });
  // The referral id is what makes this worthwhile; without it the route is
  // just a worse-priced Jupiter swap, so it is not optional here.
  if (!referralCode) {
    throw new Error('marinade referral code is not configured');
  }
  q.set('referral_id', referralCode);
  return `${base}/v1/route?${q.toString()}`;
}

// ─── Route response ─────────────────────────────────────────────────

export interface MarinadeRoute {
  id: string;
  /** lamports the user actually spends (may differ by dust) */
  effectiveAmountIn: string;
  /** mSOL received, in mSOL base units */
  amountOut: string;
  /** transaction + account-creation fees, lamports */
  feesLamports: string;
  /** rent-exempt reserve for the created mSOL account, lamports */
  rentLamports: string;
  /** base64 versioned transaction MESSAGE (not a wire transaction) */
  messageBase64: string;
  /** extra signers the router already prepared (usually none) */
  nonUserSigs: string[];
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * Narrow the router payload. Throws on anything unusable so the UI shows an
 * error instead of a route that cannot be signed.
 */
export function parseMarinadeRoute(json: unknown): MarinadeRoute {
  const body = json as {
    id?: string;
    tx?: { message?: string; non_user_sigs?: string[]; blockhash?: string; last_valid_block_height?: number };
    funding?: { fees?: number | string; rent?: number | string };
    requested_amount_in?: number | string;
    effective_amount_in?: number | string;
    amount_out?: number | string;
    status?: number;
    error?: string;
  } | null;

  const message = body?.tx?.message;
  if (!body || !message || typeof message !== 'string') {
    throw new Error(`marinade route failed: ${body?.error ?? 'no transaction message'}`);
  }
  if (body.amount_out === undefined) {
    throw new Error('marinade route failed: missing amount_out');
  }

  return {
    id: body.id ?? '',
    effectiveAmountIn: String(body.effective_amount_in ?? body.requested_amount_in ?? '0'),
    amountOut: String(body.amount_out),
    feesLamports: String(body.funding?.fees ?? '0'),
    rentLamports: String(body.funding?.rent ?? '0'),
    messageBase64: message,
    nonUserSigs: body.tx?.non_user_sigs ?? [],
    blockhash: body.tx?.blockhash ?? '',
    lastValidBlockHeight: Number(body.tx?.last_valid_block_height ?? 0),
  };
}

// ─── Wire assembly ──────────────────────────────────────────────────

/**
 * Rebuild the serialized transaction from a message-only payload.
 *
 * Solana's wire form is `compact-u16(sigCount) || signatures || message`.
 * Only the user signs (plus any signers the router pre-prepared), so the
 * signature slots are zero-filled placeholders that `sign()` later fills.
 */
export function assembleWireTransaction(messageBase64: string, extraSignatureCount = 0): string {
  const message = base64ToBytes(messageBase64);
  if (message.length === 0) throw new Error('cannot assemble an empty message');
  if (!Number.isInteger(extraSignatureCount) || extraSignatureCount < 0) {
    throw new Error('extraSignatureCount must be a non-negative integer');
  }

  const sigCount = 1 + extraSignatureCount;
  if (sigCount > 127) throw new Error('more than 127 signatures is not encodable');
  // compact-u16: a single byte for values < 128 (the only case that occurs here)
  const out = new Uint8Array(1 + sigCount * 64 + message.length);
  out[0] = sigCount;
  out.set(message, 1 + sigCount * 64);
  return bytesToBase64(out);
}

/**
 * Convert a router response into the `ExternalTx` the Solana adapter imports.
 * Returns null when the route cannot be assembled.
 */
export function marinadeRouteToExternalTx(route: MarinadeRoute): { encoding: 'base64'; payload: string; versioned: true } {
  return {
    encoding: 'base64',
    payload: assembleWireTransaction(route.messageBase64, route.nonUserSigs.length),
    versioned: true,
  };
}

// ─── Fetchers ───────────────────────────────────────────────────────

/**
 * Quote the SOL → mSOL route through the Marinade router.
 *
 * Returns null when no referral code is configured (the yield line is off),
 * or on any transport failure — the rate limit here is very low, so a caller
 * must treat null as "try the Jupiter route instead", not as a hard error.
 */
export async function fetchMarinadeRoute(params: MarinadeRouteParams): Promise<MarinadeRoute | null> {
  if (!referralCode) return null;
  try {
    const res = await fetch(buildMarinadeRouteUrl(params), { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return parseMarinadeRoute(await res.json());
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Base58 pubkey: 32-44 chars from the Solana alphabet. */
function isBase58Pubkey(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

/** Isomorphic base64 → bytes (browser + node without Buffer typing). */
function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}
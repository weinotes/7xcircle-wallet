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
 * Web app build-time configuration.
 *
 * Every third-party integration reads its credentials from here and pushes
 * them into the owning module through a setter — the browser build has no
 * `process.env`, so a module-level setter is the only way a key reaches
 * `@open-wallet/chains` (see `setJupiterBaseUrl` for the reference pattern).
 *
 * Every key is OPTIONAL. An unset key disables exactly one feature and
 * nothing else: the swap page falls back to Solana-only, the Earn page shows
 * the on-chain staking board without the off-chain vault board. A missing key
 * never throws and never renders a fabricated number. (The Tron energy rental
 * needs no key at all — it is keyless and self-signed, so it works as shipped.)
 */

import {
  isBase58Address,
  setJupiterBaseUrl,
  setLifiEarnApiKey,
  setLifiEarnAppUrl,
  setLifiEarnBaseUrl,
  setMarinadeReferralCode,
  setMarinadeRouterBaseUrl,
  setTronsaveBaseUrl,
  setTronsaveSponsor,
  setZeroExApiKey,
  setZeroExBaseUrl,
} from '@open-wallet/chains';

interface EnvLike {
  // ── Swap (Solana / Jupiter) ──
  VITE_SWAP_FEE_BPS?: string;
  VITE_SWAP_FEE_WALLET?: string;
  VITE_JUPITER_BASE_URL?: string;
  // ── Swap (EVM / 0x) ──
  VITE_ZEROX_API_KEY?: string;
  VITE_ZEROX_BASE_URL?: string;
  VITE_SWAP_FEE_WALLET_EVM?: string;
  // ── Tron energy rental (TronSave) ──
  VITE_TRONSAVE_BASE_URL?: string;
  VITE_TRONSAVE_SPONSOR_CODE?: string;
  // ── Stablecoin yield discovery (LI.FI Earn) ──
  VITE_LIFI_EARN_API_KEY?: string;
  VITE_LIFI_EARN_BASE_URL?: string;
  VITE_LIFI_EARN_APP_URL?: string;
  // ── SOL liquid staking referral (Marinade) ──
  VITE_MARINADE_REFERRAL_CODE?: string;
  VITE_MARINADE_ROUTER_BASE_URL?: string;
}

const env: EnvLike =
  (import.meta as unknown as { env?: EnvLike }).env ?? {};

const trimmed = (value: string | undefined): string => (value ?? '').trim();

// ─── Swap: Solana (Jupiter) ──────────────────────────────────────────

/** Chain the in-wallet Swap routes on when the user has no EVM account */
export const SWAP_CHAIN_ID = 'solana';

/** Platform fee in basis points of the input (Jupiter allows ≤ 500) */
export const SWAP_FEE_BPS = Math.min(Number(env.VITE_SWAP_FEE_BPS ?? 50) || 0, 500);

/**
 * Wallet that RECEIVES our platform fees (Solana base58).
 * The per-mint fee ATA is derived from it client-side. Empty disables fees.
 *
 * Validated here rather than at the call site: the value feeds
 * `deriveFeeAccount`, so a typo would throw inside the swap path and break
 * Solana swaps entirely. A bad value is dropped (fee off, swaps still work).
 */
const configuredFeeWallet = trimmed(env.VITE_SWAP_FEE_WALLET);
export const SWAP_FEE_WALLET = isBase58Address(configuredFeeWallet) ? configuredFeeWallet : '';

if (configuredFeeWallet && !SWAP_FEE_WALLET) {
  console.warn('Ignoring invalid VITE_SWAP_FEE_WALLET (must be a base58 public key)');
}

/** Explorer for status links */
export const EXPLORER_BASE = 'https://explorer.solana.com';

/** Jupiter endpoint override (Pro tier with a paid key, or a proxy) */
export const JUPITER_BASE_URL = trimmed(env.VITE_JUPITER_BASE_URL) || undefined;

// ─── Swap: EVM (0x) ─────────────────────────────────────────────────

/**
 * 0x Swap API key. REQUIRED for the EVM route: without it the EVM chain
 * options stay hidden rather than launching quotes that cannot succeed.
 *
 * ⚠ This key is NOT secret in a Vite build — it is inlined into the bundle and
 * anyone can read it, so direct-to-0x use is for LOCAL DEVELOPMENT only.
 * (CORS is not the obstacle: 0x replies `Access-Control-Allow-Origin: *`, so
 * the browser call itself succeeds.) For production, keep the key in a thin
 * gateway and point `VITE_ZEROX_BASE_URL` at it.
 */
export const ZEROX_API_KEY = trimmed(env.VITE_ZEROX_API_KEY) || undefined;

/** Proxy/origin override for the 0x quote endpoint */
export const ZEROX_BASE_URL = trimmed(env.VITE_ZEROX_BASE_URL) || undefined;

/** EVM address that RECEIVES the EVM platform fee. Empty disables fees. */
export const SWAP_FEE_WALLET_EVM = trimmed(env.VITE_SWAP_FEE_WALLET_EVM);

/** 0x's integrator fee ceiling is 1000 bps; mirror Jupiter's cap on our side */
export const SWAP_FEE_BPS_EVM = Math.min(SWAP_FEE_BPS, 1_000);

// ─── Tron energy rental (TronSave) ─────────────────────────────────

/**
 * TronSave endpoint override. NOT required — the rental path is
 * self-signed and keyless, so energy pricing and ordering work as shipped.
 * Set this only to route through a proxy.
 */
export const TRONSAVE_BASE_URL = trimmed(env.VITE_TRONSAVE_BASE_URL) || undefined;

/**
 * TronSave sponsor/referral code. This is the ONLY way the energy line earns:
 * TronSave pays the commission platform-side in TRX, so the buyer still pays
 * the normal market rate and we add no markup. Obtaining the code is not
 * self-service — apply to the "Agency Program" on tronsave.io (connect wallet →
 * Agency → apply) and wait for approval. The rate is tiered and sources
 * conflict: the FAQ says 10-20% for new agencies, the referral docs say 5%.
 */
export const TRONSAVE_SPONSOR_CODE = trimmed(env.VITE_TRONSAVE_SPONSOR_CODE) || undefined;

// ─── Stablecoin yield discovery (LI.FI Earn) ────────────────────────

/**
 * LI.FI Earn key. REQUIRED for the vault board: `earn.li.fi` authenticates
 * every request (`401 Missing x-lifi-api-key`), so without a key the vault list
 * is empty and the whole board stays hidden. Register at https://portal.li.fi/.
 */
export const LIFI_EARN_API_KEY = trimmed(env.VITE_LIFI_EARN_API_KEY) || undefined;
export const LIFI_EARN_BASE_URL = trimmed(env.VITE_LIFI_EARN_BASE_URL) || undefined;
/**
 * Deposit-app origin. Set it once a wallet-hosted deposit route exists; while
 * empty, vault cards link to the protocol's own dashboard from the API.
 */
export const LIFI_EARN_APP_URL = trimmed(env.VITE_LIFI_EARN_APP_URL) || undefined;

// ─── SOL liquid staking referral (Marinade) ─────────────────────────

/**
 * Marinade referral id (base58 pubkey). ⚠ Marinade's referral programme is
 * PAUSED, so this earns nothing today — it is wired so the wallet is ready
 * the day it resumes. A malformed value is ignored with a warning.
 */
export const MARINADE_REFERRAL_CODE = trimmed(env.VITE_MARINADE_REFERRAL_CODE) || undefined;
export const MARINADE_ROUTER_BASE_URL = trimmed(env.VITE_MARINADE_ROUTER_BASE_URL) || undefined;

// ─── Push everything into the owning modules ────────────────────────

setJupiterBaseUrl(JUPITER_BASE_URL);
setZeroExBaseUrl(ZEROX_BASE_URL);
setZeroExApiKey(ZEROX_API_KEY);
setTronsaveBaseUrl(TRONSAVE_BASE_URL);
setTronsaveSponsor(TRONSAVE_SPONSOR_CODE);
setLifiEarnBaseUrl(LIFI_EARN_BASE_URL);
setLifiEarnApiKey(LIFI_EARN_API_KEY);
setLifiEarnAppUrl(LIFI_EARN_APP_URL);
setMarinadeRouterBaseUrl(MARINADE_ROUTER_BASE_URL);
// The setter throws on a malformed value so a programmatic typo fails loudly.
// At the env boundary that would kill the whole app at boot, so the bad value
// is dropped instead — the feature degrades, the wallet still starts.
try {
  if (MARINADE_REFERRAL_CODE) setMarinadeReferralCode(MARINADE_REFERRAL_CODE);
} catch {
  console.warn('Ignoring invalid VITE_MARINADE_REFERRAL_CODE (must be a base58 public key)');
}
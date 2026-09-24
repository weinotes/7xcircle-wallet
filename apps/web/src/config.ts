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
 * All swap monetization knobs live here. Empty fee wallet = zero-fee mode
 * (development default; safe to ship while the fee wallet is undecided).
 */

interface EnvLike {
  VITE_SWAP_FEE_BPS?: string;
  VITE_SWAP_FEE_WALLET?: string;
  VITE_JUPITER_BASE_URL?: string;
}

const env: EnvLike =
  (import.meta as unknown as { env?: EnvLike }).env ?? {};

/** Chain the in-wallet Swap currently routes on */
export const SWAP_CHAIN_ID = 'solana';

/** Platform fee in basis points of the input (Jupiter allows ≤ 500) */
export const SWAP_FEE_BPS = Math.min(Number(env.VITE_SWAP_FEE_BPS ?? 50) || 0, 500);

/**
 * Wallet that RECEIVES our platform fees (Solana base58).
 * The per-mint fee ATA is derived from it client-side. Empty disables fees.
 */
export const SWAP_FEE_WALLET = (env.VITE_SWAP_FEE_WALLET ?? '').trim();

/** Explorer for status links */
export const EXPLORER_BASE = 'https://explorer.solana.com';

/** Jupiter endpoint override (Pro tier with a paid key, or a proxy) */
export const JUPITER_BASE_URL = (env.VITE_JUPITER_BASE_URL ?? '').trim() || undefined;

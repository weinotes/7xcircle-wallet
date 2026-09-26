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
 * Build-time configuration for the mobile app.
 *
 * WC_PROJECT_ID gates WalletConnect relay access. A project id is a
 * public app identifier (NOT a secret — the JWT secret stays server-side),
 * so it ships embedded and every install works out of the box; forkers
 * override via EXPO_PUBLIC_WC_PROJECT_ID (https://cloud.reown.com).
 */

export const WC_PROJECT_ID =
  process.env.EXPO_PUBLIC_WC_PROJECT_ID ?? 'd25074d0f01af6f931e26082b3137aee';

/**
 * 0x Swap API key for EVM routes. Optional: without it the mobile Swap tab
 * stays Solana-only (Jupiter is keyless) instead of offering dead quotes.
 * Forkers embed their own key at build time via EXPO_PUBLIC_ZEROX_API_KEY.
 */
import { isBase58Address, setZeroExApiKey } from '@7xcircle/chains';

export const ZEROX_API_KEY = process.env.EXPO_PUBLIC_ZEROX_API_KEY ?? '';
if (ZEROX_API_KEY) setZeroExApiKey(ZEROX_API_KEY);

// ─── Swap platform fee (mirrors the web config's monetization wiring) ─

/** Platform fee in basis points of the input (Jupiter allows ≤ 500); 0 disables. */
export const SWAP_FEE_BPS = Math.min(Number(process.env.EXPO_PUBLIC_SWAP_FEE_BPS ?? 50) || 0, 500);

/**
 * Wallet that RECEIVES the Solana platform fees (base58). The per-mint fee
 * ATA is derived client-side from it. Validated here rather than at the call
 * site: the value feeds `deriveFeeAccount`, so a typo would throw inside the
 * swap path and break Solana swaps entirely — a bad value is dropped instead
 * (fee off, swaps still work). Same contract as apps/web/src/config.ts.
 */
const configuredFeeWallet = (process.env.EXPO_PUBLIC_SWAP_FEE_WALLET ?? '').trim();
export const SWAP_FEE_WALLET = isBase58Address(configuredFeeWallet) ? configuredFeeWallet : '';

/** Both halves present and well-formed — the only way the Solana fee rides a quote. */
export const SWAP_FEE_ENABLED = SWAP_FEE_BPS > 0 && SWAP_FEE_WALLET.length > 0;

/** EVM address that RECEIVES the EVM platform fee (0x recipient parameter). */
export const SWAP_FEE_WALLET_EVM = (process.env.EXPO_PUBLIC_SWAP_FEE_WALLET_EVM ?? '').trim();
const EVM_FEE_WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

/** 0x caps the integrator fee at 1000 bps; mirror the web's clamp. */
export const EVM_FEE_ENABLED =
  Math.min(SWAP_FEE_BPS, 1_000) > 0 && EVM_FEE_WALLET_RE.test(SWAP_FEE_WALLET_EVM);

/** GitHub source of truth for the in-app update check */
export const UPDATE_REPO = 'weinotes/7xcircle-wallet';

/** Public app identity shown to dApps in WalletConnect pairing prompts */
export const WALLET_METADATA = {
  name: '7xCircle Wallet',
  description: 'Open-source multi-chain wallet — TRON, BNB, Solana, Ethereum & EVM chains.',
  url: 'https://github.com/weinotes/7xcircle-wallet',
  // no public icon asset yet — dApps render the name textually
  icons: [],
};

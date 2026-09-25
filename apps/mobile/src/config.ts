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

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
 * WC_PROJECT_ID gates WalletConnect relay access — it is free to obtain at
 * https://cloud.reown.com (create project → copy Project ID) and MUST be
 * filled in before dApp connections can work. Empty keeps the app fully
 * functional everywhere else; the dApps tab explains the missing knob
 * instead of failing with an opaque relay error.
 */

export const WC_PROJECT_ID = process.env.EXPO_PUBLIC_WC_PROJECT_ID ?? '';

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

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
 * Startup wiring shared by web + extension entries (import AFTER polyfills).
 *
 * Etherscan API V2 is the only reliable browser-safe source of EVM tx
 * history since the legacy per-chain domains killed CORS; it needs a free
 * personal API key. Without one the explorer quietly degrades (no history).
 */

import { setExplorerApiKey } from '@7xcircle/chains';

interface EnvLike {
  VITE_EXPLORER_API_KEY?: string;
}

const env: EnvLike =
  (import.meta as unknown as { env?: EnvLike }).env ?? {};

setExplorerApiKey((env.VITE_EXPLORER_API_KEY ?? '').trim() || undefined);

// ── One-time storage migration from the pre-rebrand key ──
// Builds before the 7xCircle rebrand persisted the wallet store (vault
// included) under "OpenWallet-store". Move it to the current name so
// existing installs keep their wallets. Runs before the store hydrates.
const LEGACY_STORE_KEY = 'OpenWallet-store';
const CURRENT_STORE_KEY = '7xcircle-wallet-store';
try {
  const legacy = localStorage.getItem(LEGACY_STORE_KEY);
  if (legacy && !localStorage.getItem(CURRENT_STORE_KEY)) {
    localStorage.setItem(CURRENT_STORE_KEY, legacy);
    localStorage.removeItem(LEGACY_STORE_KEY);
  }
} catch {
  /* storage unavailable (private mode) — nothing to migrate */
}

export {};

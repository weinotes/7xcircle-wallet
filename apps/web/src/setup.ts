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

import { setExplorerApiKey } from '@open-wallet/chains';

interface EnvLike {
  VITE_EXPLORER_API_KEY?: string;
}

const env: EnvLike =
  (import.meta as unknown as { env?: EnvLike }).env ?? {};

setExplorerApiKey((env.VITE_EXPLORER_API_KEY ?? '').trim() || undefined);

export {};

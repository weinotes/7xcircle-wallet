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
 * distributed under the License is an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Monetization gate tests: the fee constants in src/config.ts decide whether
 * a real wallet receives platform fees. A regression that silently ENABLES
 * fees with a malformed wallet, or crashes boot on a bad env value, is a
 * money bug — hence config is loaded fresh per case with stubbed env.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

/** Load config.ts from scratch against the currently stubbed env. */
async function loadConfig() {
  vi.resetModules();
  return import('./config.js');
}

// Deterministic fake (32 bytes of 0x11) — a valid pubkey shape without
// borrowing anyone's real receiving address into a public test.
const VALID_SOL = '29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('mobile swap fee gates', () => {
  it('enables the Solana fee only with a valid wallet and bps > 0', async () => {
    vi.stubEnv('EXPO_PUBLIC_SWAP_FEE_WALLET', VALID_SOL);
    vi.stubEnv('EXPO_PUBLIC_SWAP_FEE_BPS', '50');
    const cfg = await loadConfig();
    expect(cfg.SWAP_FEE_WALLET).toBe(VALID_SOL);
    expect(cfg.SWAP_FEE_ENABLED).toBe(true);
  });

  it('drops a malformed wallet to the disabled state instead of throwing', async () => {
    vi.stubEnv('EXPO_PUBLIC_SWAP_FEE_WALLET', 'not-base58-!!');
    vi.stubEnv('EXPO_PUBLIC_SWAP_FEE_BPS', '50');
    const cfg = await loadConfig();
    expect(cfg.SWAP_FEE_WALLET).toBe('');
    expect(cfg.SWAP_FEE_ENABLED).toBe(false);
  });

  it('disables fees when no wallet is configured at all (CI/APK default)', async () => {
    const cfg = await loadConfig();
    expect(cfg.SWAP_FEE_ENABLED).toBe(false);
    expect(cfg.EVM_FEE_ENABLED).toBe(false);
  });

  it('caps the Solana fee at Jupiter\u2019s 500 bps ceiling', async () => {
    vi.stubEnv('EXPO_PUBLIC_SWAP_FEE_BPS', '9999');
    const cfg = await loadConfig();
    expect(cfg.SWAP_FEE_BPS).toBe(500);
  });

  it('enables the EVM fee only with a well-formed 0x recipient', async () => {
    vi.stubEnv('EXPO_PUBLIC_SWAP_FEE_WALLET_EVM', '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
    vi.stubEnv('EXPO_PUBLIC_SWAP_FEE_BPS', '50');
    const cfg = await loadConfig();
    expect(cfg.EVM_FEE_ENABLED).toBe(true);

    vi.stubEnv('EXPO_PUBLIC_SWAP_FEE_WALLET_EVM', '7e5f4552091a69125d5dfcb7b8c2659029395bdf');
    const bad = await loadConfig();
    expect(bad.EVM_FEE_ENABLED).toBe(false);
  });
});

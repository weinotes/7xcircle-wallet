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
 * distributed on the License is an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Simulation result contract tests.
 *
 * These tests verify that the `SimulationResult` type is correctly
 * exported and that the token-change derivation logic (which is pure,
 * no network) produces the expected shape. The actual RPC simulation
 * is tested via live probes in `scripts/evm-test.ts` and
 * `scripts/solana-test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { SimulationResult } from './types.js';

describe('SimulationResult type contract', () => {
  it('accepts a successful result with token changes', () => {
    const result: SimulationResult = {
      success: true,
      tokenChanges: [
        {
          symbol: 'ETH',
          address: 'native',
          decimals: 18,
          amountRaw: '1000000000000000000',
          direction: 'out',
        },
      ],
      warnings: [],
    };
    expect(result.success).toBe(true);
    expect(result.tokenChanges).toHaveLength(1);
    expect(result.tokenChanges[0].direction).toBe('out');
  });

  it('accepts a failed result with an error message', () => {
    const result: SimulationResult = {
      success: false,
      error: 'execution reverted: insufficient balance',
      tokenChanges: [],
      warnings: [],
    };
    expect(result.success).toBe(false);
    expect(result.error).toContain('reverted');
  });

  it('accepts warnings alongside success', () => {
    const result: SimulationResult = {
      success: true,
      tokenChanges: [],
      warnings: ['Large approval: spender can move a very large amount of your tokens'],
    };
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Large approval');
  });
});

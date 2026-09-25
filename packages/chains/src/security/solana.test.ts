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
 * Solana safety verdict tests — these decide what a user is told before
 * buying a token, so the thresholds are pinned explicitly. All pure.
 */

import { describe, it, expect } from 'vitest';

import { concentrationPct, parseSolanaTokenSafety } from './solana.js';

const SUPPLY = '1000000000000'; // 1e12 raw units

describe('concentrationPct', () => {
  it('computes the top-N share in percent', () => {
    // 500e9 of 1000e9 = 50%
    expect(concentrationPct(['500000000000', '100000000000'], SUPPLY, 1)).toBe(50);
    expect(concentrationPct(['500000000000', '100000000000'], SUPPLY, 2)).toBe(60);
  });

  it('sorts before slicing, regardless of input order', () => {
    expect(concentrationPct(['100000000000', '500000000000'], SUPPLY, 1)).toBe(50);
  });

  it('keeps two decimal places of precision', () => {
    // 1 of 3 → 33.33%
    expect(concentrationPct(['1'], '3', 1)).toBe(33.33);
  });

  it('returns null — not zero — when supply is unusable', () => {
    expect(concentrationPct(['1'], '0', 1)).toBeNull();
    expect(concentrationPct(['1'], 'not-a-number', 1)).toBeNull();
  });

  it('ignores unparseable account amounts', () => {
    expect(concentrationPct(['oops', '500000000000'], SUPPLY, 1)).toBe(50);
  });
});

describe('parseSolanaTokenSafety', () => {
  const renounced = {
    mintAuthority: null,
    freezeAuthority: null,
    supply: SUPPLY,
    largestAccountAmounts: ['100000000000'], // 10% — well spread
  };

  it('reports no warnings when authorities are renounced and supply is spread', () => {
    const report = parseSolanaTokenSafety(renounced);
    expect(report.warnings).toEqual([]);
    expect(report.topHolderPct).toBe(10);
  });

  it('warns on a live mint authority', () => {
    const report = parseSolanaTokenSafety({ ...renounced, mintAuthority: 'Auth111' });
    expect(report.warnings.some(w => w.includes('mint authority'))).toBe(true);
  });

  it('warns on a live freeze authority', () => {
    const report = parseSolanaTokenSafety({ ...renounced, freezeAuthority: 'Auth222' });
    expect(report.warnings.some(w => w.includes('freeze authority'))).toBe(true);
  });

  it('warns when one holder dominates, and asks the user to verify', () => {
    const report = parseSolanaTokenSafety({
      ...renounced,
      largestAccountAmounts: ['600000000000'], // 60%
    });
    const warning = report.warnings.find(w => w.includes('largest holder'));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/verify/);
  });

  it('does not warn at exactly the threshold (strictly greater)', () => {
    const report = parseSolanaTokenSafety({
      ...renounced,
      largestAccountAmounts: ['500000000000'], // exactly 50%
    });
    expect(report.warnings).toEqual([]);
  });

  it('warns when the top ten together control the supply', () => {
    // Ten accounts of 9.5% each = 95%
    const report = parseSolanaTokenSafety({
      ...renounced,
      largestAccountAmounts: Array(10).fill('95000000000'),
    });
    expect(report.warnings.some(w => w.includes('top 10 holders'))).toBe(true);
  });

  it('passes concentration through as null when supply is unknown', () => {
    const report = parseSolanaTokenSafety({ ...renounced, supply: '0' });
    expect(report.topHolderPct).toBeNull();
    expect(report.top10HolderPct).toBeNull();
  });
});
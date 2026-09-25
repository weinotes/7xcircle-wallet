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
 * Staking registry tests. The mock payload mirrors the REAL shape captured
 * from yields.llama.fi/chart/{pool} on 2026-09-25; the pool uuids in the
 * registry were taken from the feed's own /pools listing.
 */

import { describe, it, expect } from 'vitest';
import {
  SOLANA_STAKE_PRODUCTS,
  buildApyUrl,
  parseLatestApy,
} from './solana.js';

describe('buildApyUrl', () => {
  it('accepts defillama pool uuids only', () => {
    expect(buildApyUrl('0e7d0722-9054-4907-8593-567b353c0900'))
      .toBe('https://yields.llama.fi/chart/0e7d0722-9054-4907-8593-567b353c0900');
    expect(() => buildApyUrl('../../etc/passwd')).toThrow(/pool uuid/);
    expect(() => buildApyUrl('0e7d0722')).toThrow(/pool uuid/);
  });
});

describe('parseLatestApy (real captured shape)', () => {
  const payload = {
    status: 'success',
    data: [
      { timestamp: '2026-09-24T03:00:00.000Z', tvlUsd: 1200000000, apy: 4.8 },
      { timestamp: '2026-09-25T03:01:27.176Z', tvlUsd: 1215563605, apy: 4.77, apyBase: 4.77, apyReward: null },
    ],
  };

  it('takes the newest point', () => {
    expect(parseLatestApy(payload)).toEqual({
      apy: 4.77,
      tvlUsd: 1215563605,
      asOf: '2026-09-25T03:01:27.176Z',
    });
  });

  it('throws on empty or failed payloads instead of inventing zero', () => {
    expect(() => parseLatestApy({ status: 'success', data: [] })).toThrow(/no data/);
    expect(() => parseLatestApy({ status: 'error' })).toThrow(/no data/);
    expect(() => parseLatestApy(null)).toThrow(/no data/);
    expect(() => parseLatestApy({ status: 'success', data: [{ apy: null }] })).toThrow(/numeric/);
  });
});

describe('SOLANA_STAKE_PRODUCTS registry', () => {
  it('every product carries a valid base58 mint and a uuid pool', () => {
    for (const p of SOLANA_STAKE_PRODUCTS) {
      expect(p.mint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(p.decimals).toBe(9);
      expect(() => buildApyUrl(p.llamaPool)).not.toThrow();
      expect(p.symbol && p.name && p.provider).toBeTruthy();
    }
  });

  it('the two deepest Solana LSTs lead the list', () => {
    expect(SOLANA_STAKE_PRODUCTS.map(p => p.symbol)).toEqual(['JitoSOL', 'mSOL']);
  });
});

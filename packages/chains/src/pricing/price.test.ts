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
 * Pricing tests — the parsers are the contract with two third-party feeds,
 * and the USD maths is money. All pure, no network.
 */

import { describe, it, expect } from 'vitest';
import type { TokenBalance } from '@open-wallet/shared';

import {
  buildDexScreenerUrl,
  buildJupiterPriceUrl,
  parseDexScreenerPrices,
  parseJupiterPrices,
  priceAddress,
  totalUsd,
} from './price.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('buildJupiterPriceUrl', () => {
  it('joins mints with commas', () => {
    expect(buildJupiterPriceUrl([SOL_MINT, USDC_MINT], 'https://x/v3'))
      .toBe(`https://x/v3?ids=${SOL_MINT},${USDC_MINT}`);
  });

  it('rejects an empty list and an oversized batch', () => {
    expect(() => buildJupiterPriceUrl([])).toThrow(/at least one/);
    expect(() => buildJupiterPriceUrl(Array(51).fill(SOL_MINT))).toThrow(/at most 50/);
  });
});

describe('parseJupiterPrices', () => {
  it('reads the v3 flat shape', () => {
    expect(parseJupiterPrices({
      [SOL_MINT]: { usdPrice: 142.5, decimals: 9 },
    })).toEqual({ [SOL_MINT]: 142.5 });
  });

  it('reads the legacy v2 nested shape with string prices', () => {
    expect(parseJupiterPrices({
      data: { [USDC_MINT]: { price: '1.0001' } },
    })).toEqual({ [USDC_MINT]: 1.0001 });
  });

  it('drops entries with no usable positive price', () => {
    expect(parseJupiterPrices({
      [SOL_MINT]: { usdPrice: 0 },
      [USDC_MINT]: { usdPrice: null },
      other: 5,
    })).toEqual({});
  });
});

describe('buildDexScreenerUrl', () => {
  it('appends comma-joined addresses', () => {
    expect(buildDexScreenerUrl(['0xaaa', '0xbbb'], 'https://ds/tokens'))
      .toBe('https://ds/tokens/0xaaa,0xbbb');
  });

  it('rejects an oversized batch', () => {
    expect(() => buildDexScreenerUrl(Array(31).fill('0xaaa'))).toThrow(/at most 30/);
  });
});

describe('parseDexScreenerPrices', () => {
  const pairs = [
    { baseToken: { address: '0xAAA' }, priceUsd: '1.00', liquidity: { usd: 1_000 } },
    { baseToken: { address: '0xaaa' }, priceUsd: '2.00', liquidity: { usd: 900_000 } },
    { baseToken: { address: '0xbbb' }, priceUsd: '0.5', liquidity: { usd: 10 } },
  ];

  it('keeps the deepest pool per token, case-insensitively', () => {
    expect(parseDexScreenerPrices({ pairs })).toEqual({
      '0xaaa': 2.0,
      '0xbbb': 0.5,
    });
  });

  it('returns nothing for a null or missing pair list', () => {
    expect(parseDexScreenerPrices({ pairs: null })).toEqual({});
    expect(parseDexScreenerPrices({})).toEqual({});
  });

  it('ignores pairs without a base token or a valid price', () => {
    expect(parseDexScreenerPrices({
      pairs: [
        { baseToken: {}, priceUsd: '1' },
        { baseToken: { address: '0xccc' }, priceUsd: 'NaN' },
        { priceUsd: '1' },
      ],
    })).toEqual({});
  });
});

describe('priceAddress', () => {
  it('passes a token contract through untouched', () => {
    expect(priceAddress('bsc-56', '0xdead', false)).toBe('0xdead');
  });

  it('maps a supported native coin to its wrapped contract', () => {
    expect(priceAddress('bsc-56', 'native', true)).toBe('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
    expect(priceAddress('solana', 'native', true)).toBe(SOL_MINT);
  });

  it('returns null for a chain with no known wrapper', () => {
    expect(priceAddress('unknown-1', 'native', true)).toBeNull();
  });
});

describe('totalUsd', () => {
  it('sums priced balances and treats unpriced ones as zero contribution', () => {
    const tokens = [
      { balanceUsd: 10.5 },
      { balanceUsd: 0.25 },
      {},
    ] as TokenBalance[];
    expect(totalUsd(tokens)).toBe(10.75);
  });

  it('is zero when nothing is priced', () => {
    expect(totalUsd([{} as TokenBalance])).toBe(0);
  });
});
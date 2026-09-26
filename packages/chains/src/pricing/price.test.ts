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

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { TokenBalance } from '@7xcircle/shared';

import {
  buildDexScreenerUrl,
  buildJupiterPriceUrl,
  fetchDexScreenerPrices,
  fetchSolanaPrices,
  parseDexScreenerPrices,
  parseJupiterPrices,
  priceAddress,
  priceTokens,
  totalUsd,
} from './price.js';

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const httpFail = (status: number) => ({ ok: false, status, json: async () => ({}) });

afterEach(() => {
  vi.unstubAllGlobals();
});

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

// ─── Fetchers (fetch stubbed — unit tests never touch the network) ──

describe('fetchSolanaPrices', () => {
  it('dedupes mints and chunks past Jupiter\'s 50-id cap', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ [SOL_MINT]: { usdPrice: 100 } }));
    vi.stubGlobal('fetch', fetchImpl);

    const table = await fetchSolanaPrices([SOL_MINT, USDC_MINT, SOL_MINT]);
    expect(table[SOL_MINT]).toBe(100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain(`${SOL_MINT},${USDC_MINT}`);

    fetchImpl.mockClear();
    await fetchSolanaPrices(Array.from({ length: 51 }, (_, i) => `mint-${i}`));
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 50 + 1
  });

  it('throws on transport failure so the facade can fall through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(httpFail(429)));
    await expect(fetchSolanaPrices([SOL_MINT])).rejects.toThrow(/HTTP 429/);
  });
});

describe('fetchDexScreenerPrices', () => {
  it('normalises keys to lower case and chunks past 30 addresses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({
      pairs: [{ baseToken: { address: '0xAbC' }, priceUsd: '1.25', liquidity: { usd: 10 } }],
    }));
    vi.stubGlobal('fetch', fetchImpl);

    const table = await fetchDexScreenerPrices(['0xABC']);
    expect(table['0xabc']).toBe(1.25);

    fetchImpl.mockClear();
    await fetchDexScreenerPrices(Array.from({ length: 31 }, (_, i) => `0x${i}`));
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 30 + 1
  });
});

// ─── Facade ────────────────────────────────────────────────────────

describe('priceTokens', () => {
  it('returns an empty list untouched', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    expect(await priceTokens([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('routes Solana native through Jupiter and computes balanceUsd', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ [SOL_MINT]: { usdPrice: 100 } }));
    vi.stubGlobal('fetch', fetchImpl);

    const sol: TokenBalance = {
      address: 'native', symbol: 'SOL', name: 'Solana', decimals: 9,
      chainId: 'solana', isNative: true, balance: '1500000000',
    };
    const [priced] = await priceTokens([sol]);
    expect(fetchImpl.mock.calls[0][0]).toContain('jup.ag');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // Jupiter answered — no fallback
    expect(priced.priceUsd).toBe(100);
    expect(priced.balanceUsd).toBeCloseTo(150);
    expect(priced).not.toBe(sol); // new objects, input never mutated
  });

  it('falls through to DexScreener when Jupiter fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(httpFail(500))
      .mockResolvedValueOnce(okJson({
        pairs: [{ baseToken: { address: SOL_MINT }, priceUsd: '90', liquidity: { usd: 1 } }],
      }));
    vi.stubGlobal('fetch', fetchImpl);

    const sol: TokenBalance = {
      address: 'native', symbol: 'SOL', name: 'Solana', decimals: 9,
      chainId: 'solana', isNative: true, balance: '1000000000',
    };
    const [priced] = await priceTokens([sol]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(priced.priceUsd).toBe(90);
    expect(priced.balanceUsd).toBeCloseTo(90);
  });

  it('matches EVM contract addresses case-insensitively', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({
      pairs: [{ baseToken: { address: '0xAbCdEF' }, priceUsd: '2', liquidity: { usd: 5 } }],
    })));
    const tok: TokenBalance = {
      address: '0xABCDEF', symbol: 'X', name: 'X', decimals: 18,
      chainId: 'bsc-56', isNative: false, balance: '0',
    };
    const [priced] = await priceTokens([tok]);
    expect(priced.priceUsd).toBe(2);
  });

  it('never queries for natives without a wrapped counterpart and keeps identity', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    const unknown: TokenBalance = {
      address: 'native', symbol: 'U', name: 'U', decimals: 8,
      chainId: 'utxo-1', isNative: true, balance: '5',
    };
    const out = await priceTokens([unknown]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out[0]).toBe(unknown); // unpriced tokens are NOT copied or zeroed
  });

  it('partial pricing leaves the unpriced entry identical', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({
      pairs: [{ baseToken: { address: '0xaaa' }, priceUsd: '3', liquidity: { usd: 7 } }],
    })));
    const a: TokenBalance = {
      address: '0xAAA', symbol: 'A', name: 'A', decimals: 18,
      chainId: 'eth-1', isNative: false, balance: '1000',
    };
    const b: TokenBalance = {
      address: '0xbbb', symbol: 'B', name: 'B', decimals: 18,
      chainId: 'eth-1', isNative: false, balance: '1',
    };
    const out = await priceTokens([a, b]);
    expect(out[0].priceUsd).toBe(3);
    expect(out[1]).toBe(b);
  });
});
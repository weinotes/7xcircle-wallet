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
 * OHLCV tests — the parsers are the contract with two live price feeds,
 * and the fetch wrappers MUST degrade to empty results instead of throwing
 * into the render tree (a broken chart may never take the page down).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  fetchDexScreenerSpot,
  fetchOhlcv,
  geckoNetwork,
  pickDexScreenerQuote,
  rowsToCandles,
} from './ohlcv.js';

/** A GeckoTerminal/DexScreener-shaped JSON response */
const okJson = (body: unknown) => ({ ok: true, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geckoNetwork', () => {
  it('maps supported chains to GeckoTerminal slugs', () => {
    expect(geckoNetwork('eth-1')).toBe('eth');
    expect(geckoNetwork('bsc-56')).toBe('bsc');
    expect(geckoNetwork('polygon-137')).toBe('polygon_pos');
    expect(geckoNetwork('solana')).toBe('solana');
  });

  it('returns null for chains GeckoTerminal does not serve', () => {
    expect(geckoNetwork('tron-227')).toBeNull();
    expect(geckoNetwork('eth-sepolia')).toBeNull();
  });
});

describe('rowsToCandles', () => {
  it('maps newest-first feed rows to oldest-first candles', () => {
    const candles = rowsToCandles([
      [1700003600, 2, 3, 1.5, 2.5, 100],
      [1700000000, 1, 2, 0.5, 1.5, 50],
    ]);
    expect(candles).toEqual([
      { time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 50 },
      { time: 1700003600, open: 2, high: 3, low: 1.5, close: 2.5, volume: 100 },
    ]);
  });

  it('drops malformed rows instead of charting gaps', () => {
    const candles = rowsToCandles([
      [1700003600, 2, 3, 1.5, 2.5, 100],
      [1700003000, 1, 2, 3, 4],               // too short
      [1700002400, 1, 2, 3, NaN, 5],          // NaN close
      [1700001800, 1, 2, 3, Infinity, 5],     // non-finite high
      [1700001200, '1', 2, 3, 4, 5],          // string price
      null,
      'nope',
    ]);
    expect(candles).toHaveLength(1);
    expect(candles[0]?.time).toBe(1700003600);
  });

  it('tolerates extra trailing columns', () => {
    expect(rowsToCandles([[1700000000, 1, 2, 0.5, 1.5, 50, 'extra']])).toHaveLength(1);
  });

  it('returns [] for non-array payloads', () => {
    expect(rowsToCandles(undefined)).toEqual([]);
    expect(rowsToCandles({ ohlcv_list: [] })).toEqual([]);
    expect(rowsToCandles('rows')).toEqual([]);
  });
});

describe('pickDexScreenerQuote', () => {
  it('never quotes a different chain, even at higher liquidity', () => {
    // Bridged token: the BSC pair is deeper, but the ETH quote was asked for.
    const quote = pickDexScreenerQuote([
      { chainId: 'bsc', priceUsd: '2.00', liquidity: { usd: 9_000_000 } },
      { chainId: 'ethereum', priceUsd: '1.50', liquidity: { usd: 1_000_000 } },
    ], 'eth-1');
    expect(quote).toEqual({ priceUsd: 1.5, change24h: 0 });
  });

  it('picks the deepest-liquidity pair on the requested chain', () => {
    const quote = pickDexScreenerQuote([
      { chainId: 'ethereum', priceUsd: '1', liquidity: { usd: 100 } },
      { chainId: 'ethereum', priceUsd: '2', liquidity: { usd: 900 }, priceChange: { h24: -3.2 } },
      { chainId: 'ethereum', priceUsd: '3', liquidity: { usd: 400 } },
    ], 'eth-1');
    expect(quote).toEqual({ priceUsd: 2, change24h: -3.2 });
  });

  it('ranks a missing liquidity field as zero', () => {
    const quote = pickDexScreenerQuote([
      { chainId: 'solana', priceUsd: '7', liquidity: { usd: 50 } },
      { chainId: 'solana', priceUsd: '9' },
    ], 'solana');
    expect(quote?.priceUsd).toBe(7);
  });

  it('rejects non-finite, zero and negative prices', () => {
    expect(pickDexScreenerQuote([
      { chainId: 'ethereum', priceUsd: 'NaN' },
      { chainId: 'ethereum', priceUsd: 'Infinity' },
      { chainId: 'ethereum', priceUsd: '0' },
      { chainId: 'ethereum', priceUsd: '-1' },
      { chainId: 'ethereum' },
    ], 'eth-1')).toBeNull();
  });

  it('defaults change24h to 0 when the feed omits or corrupts it', () => {
    expect(pickDexScreenerQuote([
      { chainId: 'ethereum', priceUsd: '1', priceChange: { h24: Number.NaN } },
    ], 'eth-1')?.change24h).toBe(0);
  });

  it('survives null entries from a sloppy JSON parse', () => {
    const pairs = [
      null,
      { chainId: 'ethereum', priceUsd: '1.2', liquidity: { usd: 5 } },
    ] as unknown as Parameters<typeof pickDexScreenerQuote>[0];
    expect(pickDexScreenerQuote(pairs, 'eth-1')?.priceUsd).toBe(1.2);
  });

  it('returns null for unsupported chains, empty lists and absent data', () => {
    expect(pickDexScreenerQuote(undefined, 'eth-1')).toBeNull();
    expect(pickDexScreenerQuote([], 'eth-1')).toBeNull();
    expect(pickDexScreenerQuote([{ chainId: 'ethereum', priceUsd: '1' }], 'eth-sepolia')).toBeNull();
    expect(pickDexScreenerQuote([{ chainId: 'bsc', priceUsd: '1' }], 'solana')).toBeNull();
  });
});

describe('fetchOhlcv', () => {
  it('short-circuits unsupported chains without touching the network', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    await expect(fetchOhlcv('tron-227', 'TXYZ')).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('degrades to [] on transport failure and non-JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(fetchOhlcv('eth-1', '0xabc')).resolves.toEqual([]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json'); },
    }));
    await expect(fetchOhlcv('eth-1', '0xabc')).resolves.toEqual([]);
  });

  it('walks pool search → OHLCV and returns oldest-first candles', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(okJson({ data: [{ attributes: { address: '0xpool' } }] }))
      .mockResolvedValueOnce(okJson({
        data: { attributes: { ohlcv_list: [[2000, 2, 2, 2, 2, 2], [1000, 1, 1, 1, 1, 1]] } },
      }));
    vi.stubGlobal('fetch', fetchImpl);

    const candles = await fetchOhlcv('eth-1', '0xabc');
    expect(candles.map(c => c.time)).toEqual([1000, 2000]);

    const [searchUrl] = fetchImpl.mock.calls[0] as [string];
    expect(searchUrl).toContain('/search/pools?query=0xabc&network=eth');
    const [ohlcvUrl] = fetchImpl.mock.calls[1] as [string];
    expect(ohlcvUrl).toContain('/networks/eth/pools/0xpool/ohlcv/hour');
    expect(ohlcvUrl).toContain('limit=168');
  });

  it('returns [] when the pool search has no result', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okJson({ data: [] }));
    vi.stubGlobal('fetch', fetchImpl);
    await expect(fetchOhlcv('eth-1', '0xabc')).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('fetchDexScreenerSpot', () => {
  it('quotes the same chain out of a multi-chain token response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({
      pairs: [
        { chainId: 'bsc', priceUsd: '0.02', liquidity: { usd: 5_000_000 }, priceChange: { h24: 8 } },
        { chainId: 'base', priceUsd: '0.0205', liquidity: { usd: 2_000_000 }, priceChange: { h24: 7.5 } },
      ],
    })));
    await expect(fetchDexScreenerSpot('base-8453', '0xabc'))
      .resolves.toEqual({ priceUsd: 0.0205, change24h: 7.5 });
  });

  it('returns null on non-ok responses, transport errors and empty bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchDexScreenerSpot('eth-1', '0xabc')).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await expect(fetchDexScreenerSpot('eth-1', '0xabc')).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({})));
    await expect(fetchDexScreenerSpot('eth-1', '0xabc')).resolves.toBeNull();
  });
});

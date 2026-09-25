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
 * OHLCV candle data for price charts.
 *
 * Data source: GeckoTerminal API (CoinGecko) — free, keyless, covers
 * all major DEXes across EVM + Solana. Returns candle arrays suitable
 * for TradingView lightweight-charts.
 *
 * Fallback: DexScreener pair data for spot price + 24h change when
 * GeckoTerminal has no pool for a token (very new / very illiquid).
 *
 * Both endpoints are CORS-friendly for browser use.
 */

/** One OHLCV candle — unix seconds + USD prices */
export interface Candle {
  time: number;    // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;  // USD volume
}

/** GeckoTerminal network ids keyed by our chainId */
const GECKO_NETWORK: Record<string, string> = {
  'eth-1': 'eth',
  'bsc-56': 'bsc',
  'polygon-137': 'polygon_pos',
  'arbitrum-42161': 'arbitrum',
  'optimism-10': 'optimism',
  'base-8453': 'base',
  'avalanche-43114': 'avax',
  'solana': 'solana',
};

/**
 * Timeframe strings GeckoTerminal accepts.
 *   minute — 1/5/15/30
 *   hour   — 1/4/12
 *   day    — 1
 */
export type Timeframe = 'minute' | 'hour' | 'day';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

/**
 * Map our chainId to the GeckoTerminal network slug.
 * Returns null for unsupported chains (TRON, testnets).
 */
export function geckoNetwork(chainId: string): string | null {
  return GECKO_NETWORK[chainId] ?? null;
}

/**
 * Find the top pool for a token on a given chain, then fetch its OHLCV.
 *
 * Two-step because GeckoTerminal keys OHLCV by pool, not by token:
 *   1. `/search/pools?query={address}` → top pool address
 *   2. `/networks/{net}/pools/{pool}/ohlcv/{tf}` → candle array
 *
 * Returns [] when no pool is found (new / unlisted token).
 */
export async function fetchOhlcv(
  chainId: string,
  tokenAddress: string,
  timeframe: Timeframe = 'hour',
  aggregate = 1,
  limit = 168,
): Promise<Candle[]> {
  const network = geckoNetwork(chainId);
  if (!network) return [];

  try {
    // Step 1: find the top pool for this token
    const poolAddress = await findTopPool(network, tokenAddress);
    if (!poolAddress) return [];

    // Step 2: fetch OHLCV for the pool
    const url = `${GECKO_BASE}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}`
      + `?aggregate=${aggregate}&limit=${limit}&currency=usd`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];

    const body = await res.json() as {
      data?: { attributes?: { ohlcv_list?: number[][] } };
    };
    return rowsToCandles(body?.data?.attributes?.ohlcv_list);
  } catch {
    // Network failure, abort, or a non-JSON body — charts degrade to
    // "no candle data" rather than throwing into the render tree.
    return [];
  }
}

/**
 * Map GeckoTerminal rows to candles, oldest-first.
 *
 * GeckoTerminal returns [unix_seconds, open, high, low, close, volume]
 * newest-first; lightweight-charts wants oldest-first. Rows that do not
 * carry six finite numbers are dropped rather than charted as gaps.
 */
export function rowsToCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is number[] =>
      Array.isArray(row)
      && row.length >= 6
      && row.slice(0, 6).every(v => typeof v === 'number' && Number.isFinite(v)))
    .map(row => ({
      time: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5],
    }))
    .reverse();
}

/**
 * DexScreener network slugs keyed by our chainId.
 *
 * The fallback endpoint is keyed by token address alone and returns pairs
 * from EVERY chain that address is deployed on (bridged and multi-chain
 * tokens are the norm). Without this mapping a price could silently come
 * from the wrong chain — misleading financial data in a wallet.
 */
const DEXSCREENER_CHAIN: Record<string, string> = {
  'eth-1': 'ethereum',
  'bsc-56': 'bsc',
  'polygon-137': 'polygon',
  'arbitrum-42161': 'arbitrum',
  'optimism-10': 'optimism',
  'base-8453': 'base',
  'avalanche-43114': 'avalanche',
  'solana': 'solana',
  'tron-227': 'tron',
};

/** A DexScreener pair row, narrowed to the fields a quote needs */
interface DexScreenerPair {
  chainId?: string;
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
}

/**
 * DexScreener fallback: spot price + 24h change for tokens without
 * GeckoTerminal pool data. Returns null when DexScreener also has nothing.
 */
export async function fetchDexScreenerSpot(
  chainId: string,
  tokenAddress: string,
): Promise<{ priceUsd: number; change24h: number } | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;

    const body = await res.json() as { pairs?: DexScreenerPair[] };
    return pickDexScreenerQuote(body?.pairs, chainId);
  } catch {
    return null;
  }
}

/**
 * Pick the deepest-liquidity pair on the RIGHT chain and narrow it to a
 * quote. Exported for unit tests: wrong chain, NaN price and malformed
 * rows are all cases a live API response can actually produce.
 */
export function pickDexScreenerQuote(
  pairs: DexScreenerPair[] | undefined,
  chainId: string,
): { priceUsd: number; change24h: number } | null {
  const slug = DEXSCREENER_CHAIN[chainId];
  if (!slug || !Array.isArray(pairs)) return null;

  const candidates = pairs
    .filter(pair => pair?.chainId === slug)
    .map(pair => ({ pair, price: Number(pair.priceUsd), liquidity: pair.liquidity?.usd ?? 0 }))
    .filter(c => Number.isFinite(c.price) && c.price > 0)
    .sort((a, b) => b.liquidity - a.liquidity);

  const best = candidates[0];
  if (!best) return null;

  const h24 = best.pair.priceChange?.h24;
  return {
    priceUsd: best.price,
    change24h: typeof h24 === 'number' && Number.isFinite(h24) ? h24 : 0,
  };
}

// ─── Internal ────────────────────────────────────────────────────────

async function findTopPool(network: string, tokenAddress: string): Promise<string | null> {
  try {
    const url = `${GECKO_BASE}/search/pools?query=${encodeURIComponent(tokenAddress)}&network=${encodeURIComponent(network)}&page=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;

    const body = await res.json() as {
      data?: Array<{ id?: string; attributes?: { address?: string } }>;
    };
    // First result is the highest-volume pool
    return body?.data?.[0]?.attributes?.address ?? null;
  } catch {
    return null;
  }
}

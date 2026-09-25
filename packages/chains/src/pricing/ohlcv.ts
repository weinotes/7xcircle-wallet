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

  // Step 1: find the top pool for this token
  const poolAddress = await findTopPool(network, tokenAddress);
  if (!poolAddress) return [];

  // Step 2: fetch OHLCV for the pool
  const url = `${GECKO_BASE}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}`
    + `?aggregate=${aggregate}&limit=${limit}&currency=usd`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];

  const body = await res.json() as {
    data?: { attributes?: { ohlcv_list?: number[][] } };
  };
  const raw = body?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(raw)) return [];

  // GeckoTerminal returns [unix_seconds, open, high, low, close, volume]
  // newest-first; lightweight-charts wants oldest-first.
  return raw
    .map((row: number[]) => ({
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
 * DexScreener fallback: spot price + 24h change for tokens without
 * GeckoTerminal pool data. Returns null when DexScreener also has nothing.
 */
export async function fetchDexScreenerSpot(
  tokenAddress: string,
): Promise<{ priceUsd: number; change24h: number } | null> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;

  const body = await res.json() as {
    pairs?: Array<{
      priceUsd?: string;
      priceChange?: { h24?: number };
    }>;
  };
  const pair = body?.pairs?.[0];
  if (!pair?.priceUsd) return null;

  return {
    priceUsd: Number(pair.priceUsd),
    change24h: pair.priceChange?.h24 ?? 0,
  };
}

// ─── Internal ────────────────────────────────────────────────────────

async function findTopPool(network: string, tokenAddress: string): Promise<string | null> {
  const url = `${GECKO_BASE}/search/pools?query=${tokenAddress}&network=${network}&page=1`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;

  const body = await res.json() as {
    data?: Array<{ id?: string; attributes?: { address?: string } }>;
  };
  // First result is the highest-volume pool
  return body?.data?.[0]?.attributes?.address ?? null;
}

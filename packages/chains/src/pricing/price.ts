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
 * Live USD pricing — the layer that turns raw balances into money.
 *
 * Two keyless venues, each used where it is strongest:
 *   - Jupiter Price API (v3) — Solana mints, including the long tail that
 *     DEX aggregators route, priced from actual routed depth.
 *   - DexScreener — every other chain, keyed by token contract, plus the
 *     wrapped-native address that stands in for a chain's gas token.
 *
 * Prices are advisory: a wallet must still show a balance when a price is
 * missing. Every fetch here degrades to "no price" rather than throwing, and
 * `priceTokens` leaves `priceUsd` undefined for anything unpriced — an
 * invented zero would read as "your tokens are worthless".
 *
 * All parsing is pure and unit-tested; only the two fetchers are impure.
 */

import { formatBalance } from '@open-wallet/shared';
import type { ChainType, TokenBalance } from '@open-wallet/shared';

/** SOL's wrapped form — Jupiter prices native SOL through this mint. */
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Wrapped-gas-token contract per chain. A DEX has no pair for a chain's
 * native coin, but it does for its canonical wrapper, which tracks 1:1.
 */
const WRAPPED_NATIVE: Record<string, string> = {
  'eth-1': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  'bsc-56': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  'polygon-137': '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  'arbitrum-42161': '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  'optimism-10': '0x4200000000000000000000000000000000000006',
  'base-8453': '0x4200000000000000000000000000000000000006',
  'avalanche-43114': '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  'solana': WRAPPED_SOL_MINT,
  'tron-227': 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR',
};

/** The address to price a token by: native coins resolve to their wrapper */
export function priceAddress(chainId: string, address: string, isNative: boolean): string | null {
  if (!isNative) return address;
  return WRAPPED_NATIVE[chainId] ?? null;
}

// ─── Jupiter (Solana) ───────────────────────────────────────────────

const JUPITER_BASE = 'https://lite-api.jup.ag/price/v3';
/** Jupiter accepts up to 50 mints per request */
const JUPITER_CHUNK = 50;

export function buildJupiterPriceUrl(mints: string[], base = JUPITER_BASE): string {
  if (mints.length === 0) throw new Error('jupiter price needs at least one mint');
  if (mints.length > JUPITER_CHUNK) {
    throw new Error(`jupiter price accepts at most ${JUPITER_CHUNK} mints per request`);
  }
  return `${base}?ids=${mints.join(',')}`;
}

/**
 * Narrow the price payload to `{ mint: usd }`.
 *
 * Reads BOTH the current v3 shape (`{ [mint]: { usdPrice } }`) and the legacy
 * v2 shape (`{ data: { [mint]: { price } } }`) because the two are structurally
 * similar enough that keeping both costs three lines, while guessing wrong
 * would silently blank every price in the UI.
 */
export function parseJupiterPrices(json: unknown): Record<string, number> {
  const root = json as Record<string, unknown> & { data?: Record<string, unknown> };
  const table = (root?.data ?? root) as Record<string, { usdPrice?: unknown; price?: unknown }>;

  const out: Record<string, number> = {};
  for (const [mint, entry] of Object.entries(table ?? {})) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry.usdPrice ?? entry.price;
    const usd = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
      out[mint] = usd;
    }
  }
  return out;
}

// ─── DexScreener (everything else) ──────────────────────────────────

const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex/tokens';
/** DexScreener accepts up to 30 addresses per request */
const DEXSCREENER_CHUNK = 30;

export function buildDexScreenerUrl(addresses: string[], base = DEXSCREENER_BASE): string {
  if (addresses.length === 0) throw new Error('dexscreener needs at least one address');
  if (addresses.length > DEXSCREENER_CHUNK) {
    throw new Error(`dexscreener accepts at most ${DEXSCREENER_CHUNK} addresses per request`);
  }
  return `${base}/${addresses.join(',')}`;
}

interface DexPair {
  chainId?: string;
  priceUsd?: string;
  baseToken?: { address?: string };
  liquidity?: { usd?: number };
}

/**
 * Narrow the pair list to `{ tokenAddress: usd }`.
 *
 * One token trades in many pairs; the DEEPEST pool is the least manipulable
 * quote, so the highest-liquidity pair wins. Matched case-insensitively
 * because checksum casing differs between callers.
 */
export function parseDexScreenerPrices(json: unknown): Record<string, number> {
  const pairs = (json as { pairs?: DexPair[] | null })?.pairs;
  if (!Array.isArray(pairs)) return {};

  const best = new Map<string, { usd: number; liquidity: number }>();

  for (const pair of pairs) {
    const token = pair.baseToken?.address;
    const price = Number(pair.priceUsd);
    if (!token || !Number.isFinite(price) || price <= 0) continue;

    const liquidity = typeof pair.liquidity?.usd === 'number' ? pair.liquidity.usd : 0;
    const key = token.toLowerCase();
    const current = best.get(key);
    if (!current || liquidity > current.liquidity) {
      best.set(key, { usd: price, liquidity });
    }
  }

  const out: Record<string, number> = {};
  for (const [key, value] of best) out[key] = value.usd;
  return out;
}

// ─── Fetchers ───────────────────────────────────────────────────────

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`price feed HTTP ${res.status}`);
  return res.json();
}

/** Price Solana mints. Throws on transport failure; callers decide the fallback. */
export async function fetchSolanaPrices(mints: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(mints)];
  const out: Record<string, number> = {};
  for (const batch of chunk(unique, JUPITER_CHUNK)) {
    Object.assign(out, parseJupiterPrices(await getJson(buildJupiterPriceUrl(batch))));
  }
  return out;
}

/** Price token contracts on any DexScreener-covered chain. */
export async function fetchDexScreenerPrices(addresses: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(addresses)];
  const out: Record<string, number> = {};
  for (const batch of chunk(unique, DEXSCREENER_CHUNK)) {
    const parsed = parseDexScreenerPrices(await getJson(buildDexScreenerUrl(batch)));
    // Normalise to lower case so callers can look up by either casing
    for (const [address, usd] of Object.entries(parsed)) out[address.toLowerCase()] = usd;
  }
  return out;
}

// ─── Facade ─────────────────────────────────────────────────────────

const CHAIN_TYPE_BY_PREFIX: Record<string, ChainType> = {
  solana: 'solana',
  tron: 'tron',
  cosmos: 'cosmos',
  utxo: 'utxo',
};

/** Chain type for a configured chain id, derived from the id prefix */
function chainTypeOf(chainId: string): ChainType {
  // Every EVM chain uses its own prefix (eth / bsc / polygon / …), so
  // "anything not explicitly non-EVM" is the correct default.
  return CHAIN_TYPE_BY_PREFIX[chainId.split('-')[0] ?? ''] ?? 'evm';
}

/**
 * Attach live USD prices to balances.
 *
 * Returns NEW objects; unpriced tokens keep `priceUsd`/`balanceUsd` undefined
 * so the UI shows a bare amount rather than a fabricated $0.00. Never throws —
 * a failed lookup simply prices nothing.
 */
export async function priceTokens(tokens: TokenBalance[]): Promise<TokenBalance[]> {
  if (tokens.length === 0) return tokens;

  const solanaMints: string[] = [];
  const otherAddresses: string[] = [];

  // Remember which balance each queried address belongs to so the results can
  // be mapped back without re-deriving anything.
  const lookups: Array<{ index: number; query: string; solana: boolean }> = [];

  tokens.forEach((token, index) => {
    const query = priceAddress(token.chainId, token.address, token.isNative);
    if (!query) return;
    const solana = chainTypeOf(token.chainId) === 'solana';
    if (solana) solanaMints.push(query);
    else otherAddresses.push(query);
    lookups.push({ index, query, solana });
  });

  if (lookups.length === 0) return tokens;

  const lookupByIndex = new Map(lookups.map(entry => [entry.index, entry]));
  const prices = new Map<string, number>();

  if (solanaMints.length > 0) {
    try {
      const table = await fetchSolanaPrices(solanaMints);
      for (const [mint, usd] of Object.entries(table)) prices.set(mint, usd);
    } catch {
      // Jupiter down or rate-limited — fall through to DexScreener below
    }
  }

  // Anything Jupiter did not answer for (and every non-Solana address) is
  // worth a DexScreener attempt.
  const stillMissing = lookups
    .filter(entry => entry.solana
      ? !prices.has(entry.query)
      : !prices.has(entry.query.toLowerCase()))
    .map(entry => entry.query);

  if (stillMissing.length > 0) {
    try {
      const table = await fetchDexScreenerPrices(stillMissing);
      for (const [address, usd] of Object.entries(table)) prices.set(address, usd);
    } catch {
      // No second venue — unpriced tokens stay unpriced
    }
  }

  return tokens.map((token, index) => {
    const lookup = lookupByIndex.get(index);
    if (!lookup) return token;

    const usd = prices.get(lookup.query) ?? prices.get(lookup.query.toLowerCase());
    if (usd === undefined) return token;

    let balanceUsd: number | undefined;
    try {
      balanceUsd = Number(formatBalance(token.balance || '0', token.decimals)) * usd;
    } catch {
      balanceUsd = undefined;
    }

    return { ...token, priceUsd: usd, ...(balanceUsd !== undefined ? { balanceUsd } : {}) };
  });
}

/** Total USD value of a priced token list (0 when nothing is priced) */
export function totalUsd(tokens: TokenBalance[]): number {
  return tokens.reduce((sum, token) => sum + (token.balanceUsd ?? 0), 0);
}
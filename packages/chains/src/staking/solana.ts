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
 * Liquid-staking product registry — the "赚币生息" line.
 *
 * v1 rides the two deepest Solana LSTs (JitoSOL, mSOL): staking is a
 * Jupiter-routed SOL → LST buy and unstaking is the reverse sell, so no
 * per-program instruction building is needed and the exit stays as liquid
 * as the venue. Live APY/TVL comes from the Defillama yields feed —
 * keyless, and the pool ids below were captured from its own /pools list.
 *
 * Everything except the single fetch is pure and unit-tested.
 */

/** Curated liquid-staking tokens (mint verified against Jupiter price API) */
export interface StakeProduct {
  symbol: string;
  name: string;
  provider: string;
  /** SPL mint — the token received for staked SOL */
  mint: string;
  decimals: number;
  /** Defillama yields pool uuid powering the live APY/TVL card */
  llamaPool: string;
  /** rough unbond note shown in the UI */
  exitNote: string;
}

export const SOLANA_STAKE_PRODUCTS: StakeProduct[] = [
  {
    symbol: 'JitoSOL',
    name: 'Jito Staked SOL',
    provider: 'Jito',
    mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    decimals: 9,
    llamaPool: '0e7d0722-9054-4907-8593-567b353c0900',
    exitNote: 'Sell back to SOL anytime via Jupiter (liquid)',
  },
  {
    symbol: 'mSOL',
    name: 'Marinade Staked SOL',
    provider: 'Marinade',
    mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    decimals: 9,
    llamaPool: 'b3f93865-5ec8-4662-90a0-11808e0aa2bd',
    exitNote: 'Sell back to SOL anytime via Jupiter (liquid)',
  },
];

const LLAMA_BASE = 'https://yields.llama.fi';

/** Defillama chart URL for one pool (latest point = current APY/TVL) */
export function buildApyUrl(poolId: string, base = LLAMA_BASE): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(poolId)) {
    throw new Error(`not a defillama pool uuid: ${poolId}`);
  }
  return `${base}/chart/${poolId}`;
}

export interface StakeApy {
  /** percent, e.g. 4.77 = 4.77% */
  apy: number;
  tvlUsd: number;
  /** ISO timestamp of the data point */
  asOf: string;
}

/**
 * Parse the chart payload: last point wins. Throws on empty/ malformed so
 * the UI shows “—” rather than a silently wrong zero.
 */
export function parseLatestApy(json: unknown): StakeApy {
  const body = json as {
    status?: string;
    data?: Array<{ timestamp?: string; apy?: number | null; tvlUsd?: number | null }>;
  };
  if (body?.status !== 'success' || !Array.isArray(body.data) || body.data.length === 0) {
    throw new Error('apy feed returned no data');
  }
  const last = body.data[body.data.length - 1];
  if (typeof last.apy !== 'number' || !Number.isFinite(last.apy)) {
    throw new Error('apy point missing a numeric apy');
  }
  return {
    apy: last.apy,
    tvlUsd: typeof last.tvlUsd === 'number' ? last.tvlUsd : 0,
    asOf: last.timestamp ?? '',
  };
}

/** Fetch current APY/TVL for a stake product's Defillama pool */
export async function fetchStakeApy(product: StakeProduct): Promise<StakeApy> {
  const res = await fetch(buildApyUrl(product.llamaPool));
  if (!res.ok) {
    throw new Error(`apy feed HTTP ${res.status}`);
  }
  return parseLatestApy(await res.json());
}

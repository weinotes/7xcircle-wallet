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
 * LI.FI Earn — the stablecoin-yield discovery line (MONETIZATION §4.3).
 *
 * Memecoin traders park large USDT "dry powder" for weeks at a time. This is
 * the read-only surface that makes that money visible: vault discovery from
 * LI.FI's Earn Data API (keyless, 100 req/min), rendered as APY + TVL cards.
 *
 * What this module deliberately does NOT do is build a deposit transaction.
 * That is LI.FI Composer (`POST /compose`, authenticated, technical preview)
 * and it would drag an API key + a second integration into the wallet for a
 * revenue line that is explicitly the SMALLEST of the set. Instead the UI
 * links out to the protocol's own dashboard with the address in the card —
 * the user keeps custody, we keep the surface honest.
 *
 * Wire contract verified against docs.li.fi/earn-openapi.yaml (v0.1.0):
 *   GET https://earn.li.fi/v1/vaults
 *     ?chainId&asset&protocol&minTvlUsd&isTransactional&isRedeemable
 *     &isComposerSupported&sortBy=apy|tvl&cursor&limit
 *   → { data: Vault[], nextCursor?, total }
 *
 * APY figures arrive as DECIMALS (0.0534 = 5.34%) and TVL as a USD string —
 * both are normalised here so no call site has to remember that.
 */

// ─── Endpoint config ────────────────────────────────────────────────

const DEFAULT_BASE = 'https://earn.li.fi';

let baseUrl = DEFAULT_BASE;
let apiKey: string | undefined;
let appUrl = '';

/** Point at a proxy/mirror; undefined resets the default. */
export function setLifiEarnBaseUrl(url: string | undefined): void {
  baseUrl = url && url.length > 0 ? url : DEFAULT_BASE;
}

export function getLifiEarnBaseUrl(): string {
  return baseUrl;
}

/**
 * API key for the Earn Data API. As of 2026-09 the endpoint authenticates every
 * request (`401 Missing x-lifi-api-key`), so WITHOUT a key the vault list comes
 * back empty and the board stays hidden. Register at https://portal.li.fi/.
 */
export function setLifiEarnApiKey(key: string | undefined): void {
  apiKey = key && key.length > 0 ? key : undefined;
}

/** Whether a key is installed. The vault board needs one to return anything. */
export function hasLifiEarnKey(): boolean {
  return apiKey !== undefined;
}

/**
 * Optional deep-link base for a vault's "deposit" action.
 *
 * Left EMPTY on purpose: no vault-level URL route is documented, and guessing
 * one would ship a dead button. Configure it once a real route exists and the
 * cards gain a jump link; until then they link to the protocol's own site.
 */
export function setLifiEarnAppUrl(url: string | undefined): void {
  appUrl = (url ?? '').trim().replace(/\/+$/, '');
}

export function getLifiEarnAppUrl(): string {
  return appUrl;
}

// ─── Query ──────────────────────────────────────────────────────────

export interface EarnVaultQuery {
  chainId?: number;
  /** underlying token symbol or address (e.g. "USDC") */
  asset?: string;
  /** protocol slug (e.g. "morpho-v1", "aave-v3") */
  protocol?: string;
  /** drop dust vaults — a $10k pool cannot absorb real size */
  minTvlUsd?: number;
  sortBy?: 'apy' | 'tvl';
  limit?: number;
  cursor?: string;
  /** only vaults that support programmatic deposits (Composer) */
  isTransactional?: boolean;
  /** only vaults whose deposits can be withdrawn */
  isRedeemable?: boolean;
}

export function buildEarnVaultsUrl(query: EarnVaultQuery = {}, base = baseUrl): string {
  const q = new URLSearchParams();
  if (query.chainId !== undefined) {
    if (!Number.isInteger(query.chainId) || query.chainId <= 0) {
      throw new Error('chainId must be a positive integer');
    }
    q.set('chainId', String(query.chainId));
  }
  if (query.asset) q.set('asset', query.asset);
  if (query.protocol) q.set('protocol', query.protocol);
  if (query.minTvlUsd !== undefined) {
    if (!Number.isFinite(query.minTvlUsd) || query.minTvlUsd < 0) {
      throw new Error('minTvlUsd must be a non-negative number');
    }
    q.set('minTvlUsd', String(query.minTvlUsd));
  }
  if (query.isTransactional !== undefined) q.set('isTransactional', String(query.isTransactional));
  if (query.isRedeemable !== undefined) q.set('isRedeemable', String(query.isRedeemable));
  if (query.sortBy) q.set('sortBy', query.sortBy);
  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }
    q.set('limit', String(query.limit));
  }
  if (query.cursor) q.set('cursor', query.cursor);

  const suffix = q.toString();
  return suffix ? `${base}/v1/vaults?${suffix}` : `${base}/v1/vaults`;
}

// ─── Response ───────────────────────────────────────────────────────

export interface EarnVault {
  address: string;
  chainId: number;
  network: string;
  slug: string;
  name: string;
  description?: string;
  protocol: { name: string; url?: string; logoUri?: string };
  /** the tokens you deposit */
  underlyingTokens: Array<{ address: string; symbol: string; decimals: number }>;
  /** total APY in PERCENT (already ×100 from the API's decimal form) */
  apyTotalPct: number;
  apyBasePct: number | null;
  apyRewardPct: number | null;
  apy30dPct: number | null;
  tvlUsd: number;
  tags: string[];
  isRedeemable: boolean;
  updatedAt?: string;
  /** protocol dashboard to jump to; undefined when LI.FI lists none */
  externalUrl?: string;
}

/** API decimals (0.0534) → percent (5.34); null for anything unusable. */
export function apyToPercent(value: unknown): number | null {
  if (typeof value === 'string') {
    const parsed = Number(value);
    // A reward APY is legitimately 0 or absent; a non-numeric string is not
    return Number.isFinite(parsed) ? parsed * 100 : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value * 100;
  return null;
}

/** USD string ("12500000.00") or number → a finite number, else 0. */
function toUsd(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

export interface EarnVaultsPage {
  vaults: EarnVault[];
  nextCursor?: string;
  total: number;
}

/**
 * Narrow the vault list. Entries without an address, chain id or protocol name
 * are DROPPED rather than half-filled — a yield card with no protocol is worse
 * than no card, because the user may deposit real money from it.
 */
export function parseEarnVaults(json: unknown): EarnVaultsPage {
  const body = json as {
    data?: unknown[];
    nextCursor?: string;
    total?: number;
    message?: string;
  } | null;

  if (!body || !Array.isArray(body.data)) {
    throw new Error(`lifi earn vaults failed: ${body?.message ?? 'unexpected response shape'}`);
  }

  const vaults: EarnVault[] = [];
  for (const entry of body.data) {
    const raw = entry as {
      address?: string;
      chainId?: number;
      network?: string;
      slug?: string;
      name?: string;
      description?: string;
      protocol?: { name?: string; url?: string; logoUri?: string };
      underlyingTokens?: Array<{ address?: string; symbol?: string; decimals?: number }>;
      analytics?: {
        apy?: { base?: unknown; reward?: unknown; total?: unknown };
        apy30d?: unknown;
        tvl?: { usd?: unknown };
        updatedAt?: string;
      };
      tags?: string[];
      isRedeemable?: boolean;
    };

    if (!raw?.address || typeof raw.chainId !== 'number' || !raw.protocol?.name) continue;

    const total = apyToPercent(raw.analytics?.apy?.total);
    if (total === null) continue; // an APY-less vault is not an offer

    vaults.push({
      address: raw.address,
      chainId: raw.chainId,
      network: raw.network ?? String(raw.chainId),
      slug: raw.slug ?? raw.address,
      name: raw.name ?? raw.protocol.name,
      ...(raw.description ? { description: raw.description } : {}),
      protocol: {
        name: raw.protocol.name,
        ...(raw.protocol.url ? { url: raw.protocol.url } : {}),
        ...(raw.protocol.logoUri ? { logoUri: raw.protocol.logoUri } : {}),
      },
      underlyingTokens: (raw.underlyingTokens ?? [])
        .filter(t => typeof t?.address === 'string')
        .map(t => ({ address: t.address as string, symbol: t.symbol ?? '', decimals: Number(t.decimals ?? 0) })),
      apyTotalPct: total,
      apyBasePct: apyToPercent(raw.analytics?.apy?.base),
      apyRewardPct: apyToPercent(raw.analytics?.apy?.reward),
      apy30dPct: apyToPercent(raw.analytics?.apy30d),
      tvlUsd: toUsd(raw.analytics?.tvl?.usd),
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      isRedeemable: raw.isRedeemable === true,
      ...(raw.analytics?.updatedAt ? { updatedAt: raw.analytics.updatedAt } : {}),
      externalUrl: buildVaultExternalUrl(raw.chainId, raw.address, raw.protocol.url),
    });
  }

  return {
    vaults,
    ...(body.nextCursor ? { nextCursor: body.nextCursor } : {}),
    total: typeof body.total === 'number' ? body.total : vaults.length,
  };
}

/**
 * Where a vault card links to: a configured app route when one exists, else
 * the protocol's own dashboard from the API payload, else nothing at all.
 */
export function buildVaultExternalUrl(chainId: number, address: string, protocolUrl?: string): string | undefined {
  if (appUrl) return `${appUrl}/${chainId}/${address}`;
  // Phase 1 fallback: the protocol's own dashboard, straight from the API
  return protocolUrl;
}

// ─── Fetchers ───────────────────────────────────────────────────────

/** Fetch one page of earn vaults. Empty list on any transport failure. */
export async function fetchEarnVaults(query: EarnVaultQuery = {}): Promise<EarnVault[]> {
  try {
    const res = await fetch(buildEarnVaultsUrl(query), {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { 'x-lifi-api-key': apiKey } : {}),
      },
    });
    if (!res.ok) return [];
    return parseEarnVaults(await res.json()).vaults;
  } catch {
    return [];
  }
}

/**
 * The stablecoin "idle USDT" board: highest-APY USDC/USDT vaults above a TVL
 * floor, on chains the wallet actually supports. Sorted by APY by the API so
 * the order here needs no client-side reshuffle.
 */
export async function fetchStablecoinVaults(options: {
  minTvlUsd?: number;
  limit?: number;
  chainIds?: number[];
} = {}): Promise<EarnVault[]> {
  const { minTvlUsd = 5_000_000, limit = 6, chainIds } = options;

  const pages = await Promise.all(
    ['USDC', 'USDT'].map(asset => fetchEarnVaults({ asset, minTvlUsd, sortBy: 'apy', limit })),
  );

  const merged = [...pages[0], ...pages[1]];
  const allowed = chainIds ? new Set(chainIds) : null;
  const seen = new Set<string>();
  const out: EarnVault[] = [];

  for (const vault of merged.sort((a, b) => b.apyTotalPct - a.apyTotalPct)) {
    if (allowed && !allowed.has(vault.chainId)) continue;
    const key = `${vault.chainId}:${vault.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(vault);
    if (out.length >= limit) break;
  }
  return out;
}
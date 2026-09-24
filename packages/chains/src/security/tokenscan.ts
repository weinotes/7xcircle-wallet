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
 * GoPlus token-security oracle — the "不会被貔貅" promise.
 *
 * Free, keyless API (rate-limited ~30 req/min/IP) answering the question
 * memecoin buyers actually lose money on: honeypots, giant transfer taxes,
 * mint functions, proxy contracts, and unlocked ownership.
 *
 * This module is the pure wire contract (URL build, response narrowing,
 * risk verdicts); network access lives in fetchTokenSafety. Verdicts are
 * advisory banners in the UI — a WARNING must not hard-block a trade
 * (false positives exist), but it must be loud and impossible to skim past.
 */

/** GoPlus-supported EVM chain ids we run on */
export type TokenScanChain =
  | '56' | '1' | '137' | '42161' | '10' | '8453' | '43114';

const API_BASE = 'https://api.gopluslabs.io/api/v1/token_security';

export function buildTokenSafetyUrl(chain: TokenScanChain, contract: string, base = API_BASE): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
    throw new Error('token-scan requires a 0x EVM contract address');
  }
  return `${base}/${chain}?contract_addresses=${contract.toLowerCase()}`;
}

/** Raw GoPlus fields we consume; everything else is ignored on purpose */
interface GoPlusTokenSecurity {
  is_honeypot?: string;         // "1" = can never sell
  buy_tax?: string;             // decimal fraction as string ("0.1" = 10%)
  sell_tax?: string;
  is_proxy?: string;            // contract is an upgradable proxy
  is_mintable?: string;         // owner can print unlimited supply
  owner_of_top_lps_locked?: string; // "yes" | "No" | ""
  total_supply?: string;
  holder_count?: string;
  lp_holders?: Array<{ is_locked?: string; tag?: string }>;
  transfer_pausable?: string;   // owner can freeze ALL transfers
}

export interface TokenSafety {
  honeypot: boolean;
  buyTaxPct: number;
  sellTaxPct: number;
  proxy: boolean;
  mintable: boolean;
  transferPausable: boolean;
  holders: number | null;
  /** Human-readable risk strings for the UI banner; empty = all clear */
  warnings: string[];
}

const TAX_HIGH_PCT = 10;

/** Narrow + verdict from the raw payload. Pure and unit-tested. */
export function parseTokenSafety(json: unknown, contract: string): TokenSafety | null {
  const root = json as { result?: Record<string, GoPlusTokenSecurity> };
  const raw = root?.result?.[contract.toLowerCase()] ?? root?.result?.[contract];
  if (!raw) return null;

  const num = (v: string | undefined): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const yes = (v: string | undefined) => v === '1';

  const safety: TokenSafety = {
    honeypot: yes(raw.is_honeypot),
    buyTaxPct: num(raw.buy_tax) * 100,
    sellTaxPct: num(raw.sell_tax) * 100,
    proxy: yes(raw.is_proxy),
    mintable: yes(raw.is_mintable),
    transferPausable: yes(raw.transfer_pausable),
    holders: raw.holder_count ? Number(raw.holder_count) : null,
    warnings: [],
  };

  if (safety.honeypot) safety.warnings.push('honeypot — tokens cannot be sold');
  if (safety.buyTaxPct >= TAX_HIGH_PCT) safety.warnings.push(`high buy tax (${safety.buyTaxPct.toFixed(0)}%)`);
  if (safety.sellTaxPct >= TAX_HIGH_PCT) safety.warnings.push(`high sell tax (${safety.sellTaxPct.toFixed(0)}%)`);
  if (safety.mintable) safety.warnings.push('mintable — supply is not capped');
  if (safety.transferPausable) safety.warnings.push('transfer-pausable — owner can freeze all transfers');
  if (safety.proxy) safety.warnings.push('upgradeable proxy contract — code can change');

  return safety;
}

/**
 * Fetch the safety report for one EVM token. Returns null when GoPlus has
 * nothing (unlisted token, rate limit) — callers must degrade to "no data",
 * NEVER to "safe".
 */
export async function fetchTokenSafety(chain: TokenScanChain, contract: string): Promise<TokenSafety | null> {
  try {
    const res = await fetch(buildTokenSafetyUrl(chain, contract), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return parseTokenSafety(await res.json(), contract);
  } catch {
    return null;
  }
}

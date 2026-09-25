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
 * Solana token-safety checks — the on-chain half of the GoPlus promise.
 *
 * EVM tokens get an external oracle (GoPlus). Solana does not need one for
 * the two questions that actually cost users money, because the answers are
 * directly readable from the mint account:
 *
 *   - Is the MINT authority still live?  → supply can be printed at will,
 *     diluting every holder. Renouncing it is the standard anti-rug move.
 *   - Is the FREEZE authority still live? → the issuer can freeze any holder's
 *     token account, trapping funds.
 *
 * The third check is holder concentration, from the largest token accounts.
 * It is genuinely ambiguous — the top account of a healthy token is usually
 * its liquidity pool — so it warns with a wording that asks the user to
 * verify, rather than declaring fraud.
 *
 * Verdict logic is pure and unit-tested; the adapter supplies the RPC values.
 */

import type { TokenSafetyReport } from '@open-wallet/core';

/** Single-holder share above which concentration is worth flagging, percent */
const TOP_HOLDER_WARN_PCT = 50;
/** Combined top-10 share above which concentration is worth flagging, percent */
const TOP_10_WARN_PCT = 90;

export interface SolanaTokenSafety extends TokenSafetyReport {
  /** null = renounced (good); an address = still live */
  mintAuthority: string | null;
  /** null = renounced (good); an address = still live */
  freezeAuthority: string | null;
  /** Share of supply held by the single largest account, percent */
  topHolderPct: number | null;
  /** Combined share held by the top ten accounts, percent */
  top10HolderPct: number | null;
}

/** Everything the verdict needs, all of it straight from the RPC */
export interface SolanaSafetyInput {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Total supply in raw base units */
  supply: string;
  /** Raw base-unit amounts of the largest token accounts (unordered is fine) */
  largestAccountAmounts: string[];
}

/**
 * Percentage of supply held by the top `count` accounts.
 *
 * BigInt maths in hundredths of a percent so a huge supply cannot lose
 * precision to float division. Returns null when supply is unknown/zero,
 * which is "cannot tell" — never 0.
 */
export function concentrationPct(
  amounts: string[],
  supply: string,
  count: number,
): number | null {
  let total: bigint;
  try {
    total = BigInt(supply);
  } catch {
    return null;
  }
  if (total <= 0n) return null;

  const top = amounts
    .map(amount => {
      try {
        return BigInt(amount);
      } catch {
        return 0n;
      }
    })
    .filter(amount => amount > 0n)
    .sort((a, b) => (b > a ? 1 : b < a ? -1 : 0))
    .slice(0, count)
    .reduce((sum, amount) => sum + amount, 0n);

  // Two decimal places, truncated — hundredths of a percent
  return Number((top * 10_000n) / total) / 100;
}

/**
 * Turn the raw mint/account values into a verdict.
 *
 * Pure: the adapter does the RPC, this decides what the user is told.
 */
export function parseSolanaTokenSafety(input: SolanaSafetyInput): SolanaTokenSafety {
  const topHolderPct = concentrationPct(input.largestAccountAmounts, input.supply, 1);
  const top10HolderPct = concentrationPct(input.largestAccountAmounts, input.supply, 10);

  const warnings: string[] = [];

  if (input.mintAuthority !== null) {
    warnings.push('mint authority is live — supply can be inflated');
  }
  if (input.freezeAuthority !== null) {
    warnings.push('freeze authority is live — your tokens can be frozen');
  }
  if (topHolderPct !== null && topHolderPct > TOP_HOLDER_WARN_PCT) {
    warnings.push(
      `largest holder controls ${topHolderPct.toFixed(2)}% of supply — verify it is a liquidity pool`,
    );
  }
  if (top10HolderPct !== null && top10HolderPct > TOP_10_WARN_PCT) {
    warnings.push(`top 10 holders control ${top10HolderPct.toFixed(2)}% of supply`);
  }

  return {
    mintAuthority: input.mintAuthority,
    freezeAuthority: input.freezeAuthority,
    topHolderPct,
    top10HolderPct,
    warnings,
  };
}
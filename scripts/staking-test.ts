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
 * Staking line integration probe — LIVE endpoints, zero funds, zero keys.
 *
 * Proves both halves of the Earn tab's data path:
 *   1. Defillama yields → current APY/TVL for each curated LST
 *   2. Jupiter quote    → SOL → LST (and back) is actually routable
 * The mobile Earn tab performs exactly these two calls per product.
 */

import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

// dev-machine convenience: honor HTTP(S)_PROXY like curl (Node fetch does not)
setGlobalDispatcher(new EnvHttpProxyAgent());

import {
  SOLANA_STAKE_PRODUCTS,
  fetchStakeApy,
} from '../packages/chains/src/staking/solana.js';
import {
  fetchQuote,
  SOL_MINT,
} from '../packages/chains/src/solana/jupiter.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  for (const product of SOLANA_STAKE_PRODUCTS) {
    // 1. live APY feed
    try {
      const apy = await fetchStakeApy(product);
      check(`${product.symbol} apy feed`, apy.apy > 0 && apy.tvlUsd > 1e6,
        `apy=${apy.apy.toFixed(2)}% tvl=${Math.round(apy.tvlUsd / 1e6)}M asOf=${apy.asOf.slice(0, 10)}`);
    } catch (e) {
      check(`${product.symbol} apy feed`, false, String(e));
    }

    // 2. Jupiter routability both directions (1 SOL in)
    for (const [from, to, label] of [
      [SOL_MINT, product.mint, 'stake'],
      [product.mint, SOL_MINT, 'unstake'],
    ] as const) {
      try {
        const quote = await fetchQuote({
          inputMint: from,
          outputMint: to,
          amountRaw: '1000000000',
          slippageBps: 100,
        });
        check(`${product.symbol} ${label} route`, BigInt(quote.outAmount) > 0n,
          `out=${quote.outAmount} impact=${(Number(quote.priceImpactPct) * 100).toFixed(3)}%`);
      } catch (e) {
        check(`${product.symbol} ${label} route`, false, String(e));
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll staking probes passed.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

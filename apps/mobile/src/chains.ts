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
 * Chain selection for the mobile surface.
 *
 * The session derives one account per config, so TESTNETS ARE EXCLUDED
 * here — unlocking with the full CHAIN_CONFIGS would show BSC Testnet and
 * TRON Nile balances next to real funds and tempt exactly the wrong tap.
 */

import { CHAIN_CONFIGS } from '@7xcircle/chains';
import type { ChainConfig } from '@7xcircle/shared';

/** Mainnet chains shown in the mobile asset switcher */
export const PRODUCTION_CHAINS: ChainConfig[] = CHAIN_CONFIGS.filter(c => !c.testnet);

/** The four chains the migrant cohort actually lives on, tab order first */
export const PRIORITY_CHAIN_IDS = ['tron-227', 'bsc-56', 'solana', 'eth-1'];

/** Priority chains first, remaining EVM homechains after them */
export function orderedChains(): ChainConfig[] {
  const byId = new Map(PRODUCTION_CHAINS.map(c => [c.chainId, c]));
  const head = PRIORITY_CHAIN_IDS.map(id => byId.get(id)).filter(Boolean) as ChainConfig[];
  const tail = PRODUCTION_CHAINS.filter(c => !PRIORITY_CHAIN_IDS.includes(c.chainId));
  return [...head, ...tail];
}

/**
 * WalletConnect CAIP-2 ids look like "eip155:56" / "solana:5eykt…" —
 * map the EVM half onto our internal chain keys. Our EVM chainIds are
 * all "<slug>-<decimal>", so a decimal lookup is exact and total.
 */
export function evmChainFromCaip(caip: string): ChainConfig | undefined {
  const match = /^eip155:(\d+)$/.exec(caip);
  if (!match) return undefined;
  const decimal = match[1];
  return PRODUCTION_CHAINS.find(c => c.type === 'evm' && c.chainId.endsWith(`-${decimal}`));
}

/** Our internal key → CAIP-2 for the eip155 namespace */
export function caipForChain(config: ChainConfig): string {
  return `eip155:${config.chainId.split('-').pop()}`;
}

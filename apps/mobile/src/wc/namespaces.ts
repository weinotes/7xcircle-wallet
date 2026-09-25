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
 * WalletConnect namespace negotiation — pure, so the security-critical
 * "which accounts may this dApp see" decision is reviewable without a
 * device or relay in the loop.
 *
 * Policy:
 *   - only eip155 chains we actually manage an account for are offered
 *   - only methods the wallet can serve are granted
 *   - required chains with NO local account make the whole proposal
 *     rejectable rather than half-approved (a session missing a required
 *     chain is broken by spec anyway)
 */

import type { Account } from '@7xcircle/shared';
import { evmChainFromCaip } from '../chains';

/** Methods this wallet answers over WalletConnect */
export const SUPPORTED_METHODS = [
  'eth_sendTransaction',
  'personal_sign',
  'eth_accounts',
  'eth_chainId',
  'wallet_switchEthereumChain',
  'wallet_requestPermissions',
];

export interface ApprovedNamespace {
  accounts: string[];
  methods: string[];
  events: string[];
}

export interface NamespaceResult {
  approved: { eip155: ApprovedNamespace };
  /** CAIP-2 chains the dApp asked for that we cannot serve */
  unsupportedChains: string[];
}

/** CAIP-2 account id: eip155:56:0xabc… (all lowercase address per spec) */
export function caipAccount(caipChain: string, address: string): string {
  return `${caipChain}:${address.toLowerCase()}`;
}

/**
 * Build the approval payload for a session proposal.
 *
 * @param requestedChains CAIP-2 chain ids from proposal.requiredNamespaces
 *                        ∪ optionalNamespaces eip155 entries
 * @param requestedMethods methods the dApp needs (required ∪ optional)
 * @param accounts unlocked session accounts
 */
export function negotiateNamespace(
  requestedChains: string[],
  requestedMethods: string[],
  accounts: Account[],
): NamespaceResult {
  const supported = requestedMethods.filter(m => SUPPORTED_METHODS.includes(m));
  const out: string[] = [];
  const unsupportedChains: string[] = [];

  for (const caip of requestedChains) {
    const config = evmChainFromCaip(caip);
    if (!config) {
      unsupportedChains.push(caip);
      continue;
    }
    const local = accounts.find(a => a.chainId === config.chainId);
    if (!local) {
      unsupportedChains.push(caip);
      continue;
    }
    out.push(caipAccount(caip, local.address));
  }

  // first-requested order is kept as-is: the dApp's own chain priority wins
  return {
    approved: {
      eip155: {
        accounts: out,
        methods: supported,
        events: ['accountsChanged', 'chainChanged'],
      },
    },
    unsupportedChains,
  };
}

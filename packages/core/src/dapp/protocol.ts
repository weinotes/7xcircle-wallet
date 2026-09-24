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
 * DApp connection protocol — the pure policy core of the extension.
 *
 * All the security-critical decisions ("may this origin sign? send? which
 * chain?") live here as a testable state machine, deliberately away from
 * chrome.* plumbing. The background worker only transports these verdicts.
 *
 * Approval tiers:
 *   silent   — answered from state, no user prompt (chainId, read-only)
 *   connect  — first-time site permission prompt
 *   sign     — personal_sign prompt (message shown in full)
 *   send     — transaction prompt (recipient/value/data gas estimation)
 *   reject   — unauthorized / unsupported / locked
 */

import type { ChainType } from '@open-wallet/shared';

// ─── permissions ────────────────────────────────────────────────────

export interface SitePermission {
  /** eTLD+1 origin, e.g. "https://app.uniswap.org" */
  origin: string;
  /** hex chain ids the site was granted, e.g. ["0x38"] */
  chainIds: string[];
  grantedAt: number;
}

/** Normalize decimal or hex chain id to 0x-hex (EIP-3326 style) */
export function normalizeChainId(id: string | number): string {
  const value = typeof id === 'number'
    ? id
    : id.startsWith('0x')
      ? parseInt(id, 16)
      : parseInt(id, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`invalid chain id: ${String(id)}`);
  }
  return '0x' + value.toString(16);
}

/** Look up the grant for an origin, if any */
export function findPermission(
  perms: SitePermission[],
  origin: string,
): SitePermission | undefined {
  return perms.find(p => p.origin === origin);
}

/** Immutable add/update of a permission record */
export function grantPermission(
  perms: SitePermission[],
  origin: string,
  chainId: string,
): SitePermission[] {
  const normalized = normalizeChainId(chainId);
  const existing = findPermission(perms, origin);
  if (existing) {
    return perms.map(p => p.origin === origin
      ? { ...p, chainIds: [...new Set([...p.chainIds, normalized])] }
      : p);
  }
  return [...perms, { origin, chainIds: [normalized], grantedAt: Date.now() }];
}

export function revokePermission(perms: SitePermission[], origin: string): SitePermission[] {
  return perms.filter(p => p.origin !== origin);
}

// ─── method classification ──────────────────────────────────────────

export type MethodTier = 'silent' | 'account' | 'connect' | 'sign' | 'send' | 'admin' | 'unsupported';

const METHOD_TIERS: Record<string, MethodTier> = {
  eth_chainId: 'silent',
  net_version: 'silent',
  // eth_accounts never prompts — it answers [] without a grant (EIP-1102)
  eth_accounts: 'silent',
  eth_requestAccounts: 'connect',
  eth_decrypt: 'sign',
  eth_signTransaction: 'sign',
  personal_sign: 'sign',
  eth_signTypedData_v4: 'sign',
  eth_sendTransaction: 'send',
  wallet_switchEthereumChain: 'admin',
  wallet_addEthereumChain: 'admin',
  wallet_revokePermissions: 'admin',
};

export function classifyMethod(method: string): MethodTier {
  return METHOD_TIERS[method] ?? 'unsupported';
}

// ─── gate verdicts ──────────────────────────────────────────────────

export type Verdict =
  | { kind: 'allow'; method: string }
  | { kind: 'prompt-connect'; method: string }
  | { kind: 'prompt-sign'; method: string }
  | { kind: 'prompt-send'; method: string }
  | { kind: 'reject'; error: { code: number; message: string } }
  | { kind: 'unsupported'; method: string };

/** EIP-1193 / provider standard error constructors */
export const providerErrors = {
  userRejected: () => ({ code: 4001, message: 'User rejected the request.' }),
  unauthorized: () => ({ code: 4100, message: 'The requested account and/or method has not been authorized by the user.' }),
  unsupportedMethod: () => ({ code: 4200, message: 'The requested method is not supported by this Ethereum provider.' }),
  disconnected: () => ({ code: 4900, message: 'Provider is disconnected from the underlying chain.' }),
  chainDisconnected: (id: string) => ({ code: 4901, message: `Chain ${id} is disconnected from the underlying chain.` }),
};

/**
 * Decide how to answer a dApp RPC call.
 *
 * Security stance:
 *   - eth_accounts answers silently ([] without a grant, per EIP-1102)
 *   - signing/sending NEVER work without an existing connect grant
 *   - a granted site is additionally bound to the chain ids it was granted
 *
 * NOTE: no lock state here — MV3 keeps the session only inside the popup,
 * so the POPUP rejects queued sign/send requests itself when it opens
 * locked; the broker merely parks them.
 */
export function gate(params: {
  method: string;
  perms: SitePermission[];
  origin: string;
  activeChainId: string;
}): Verdict {
  const tier = classifyMethod(params.method);
  if (tier === 'unsupported') {
    return { kind: 'unsupported', method: params.method };
  }
  if (tier === 'silent') {
    return { kind: 'allow', method: params.method };
  }

  const perm = findPermission(params.perms, params.origin);

  if (tier === 'connect') {
    return perm
      ? { kind: 'allow', method: params.method }
      : { kind: 'prompt-connect', method: params.method };
  }

  // sign / send / admin below all require an existing grant
  if (!perm) {
    return { kind: 'reject', error: providerErrors.unauthorized() };
  }
  if (!perm.chainIds.includes(normalizeChainId(params.activeChainId))) {
    return { kind: 'reject', error: providerErrors.chainDisconnected(params.activeChainId) };
  }

  if (tier === 'sign') return { kind: 'prompt-sign', method: params.method };
  if (tier === 'send') return { kind: 'prompt-send', method: params.method };
  // admin methods are self-contained (switch/add/revoke) — handled by broker
  return { kind: 'allow', method: params.method };
}

// ─── request descriptor (what the approval UI receives) ─────────────

export interface DappRequest {
  id: string;
  origin: string;
  method: string;
  /** JSON-RPC params, forwarded verbatim for the UI to render */
  params: unknown[];
  tabId?: number;
  receivedAt: number;
}

/** Safe JSON preview of RPC params for the approval UI (never evals) */
export function previewParams(params: unknown[], maxLen = 800): string {
  try {
    const raw = JSON.stringify(params, null, 1) ?? String(params);
    return raw.length > maxLen ? raw.slice(0, maxLen) + '…' : raw;
  } catch {
    return '[unserializable params]';
  }
}

/** Chains the extension provider currently serves */
export const SUPPORTED_PROVIDER_CHAIN_TYPES: ChainType[] = ['evm'];

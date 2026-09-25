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
 * Token-approval ledger — the pure bookkeeping behind "which contracts did
 * THIS wallet grant spend rights to, and how do I take them back".
 *
 * Scope, stated honestly: this ledger only knows about approvals that were
 * built and broadcast by this wallet (swap flows, dApp requests routed
 * through it). Grants signed in another wallet before an import are invisible
 * here — auditing those needs an external indexer, which a zero-backend
 * wallet does not ship. What it DOES give users is the exit: every entry is
 * revocable to zero from the Approvals page with the normal send pipeline.
 *
 * All functions are pure — the store owns persistence, tests own the shape.
 */

/** 2^256-1 — the sentinel routers use for "spend forever" allowances */
export const UNLIMITED_APPROVAL_RAW =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

/** Where the grant came from — rendered as a chip in the UI */
export type ApprovalSource = 'swap' | 'dapp' | 'manual';

export interface TokenApproval {
  /** chainId:token:spender, lowercased — the natural key of a grant */
  id: string;
  chainId: string;
  /** the ERC20 contract whose allowance was set */
  token: string;
  /** the contract trusted to spend — the address the user must recognise */
  spender: string;
  symbol: string;
  decimals: number;
  /** raw units; UNLIMITED_APPROVAL_RAW means an infinite allowance */
  amountRaw: string;
  /** epoch seconds of the broadcast that created/updated the grant */
  createdAt: number;
  source: ApprovalSource;
  /** set once a revoke to zero confirmed; the entry stays as history */
  revokedAt?: number;
}

const addr = (value: string): string => value.trim().toLowerCase();

/** Natural key of a grant: one live approval per chain + token + spender. */
export function approvalId(chainId: string, token: string, spender: string): string {
  return `${chainId}:${addr(token)}:${addr(spender)}`;
}

export function isUnlimitedApproval(amountRaw: string): boolean {
  try {
    return BigInt(amountRaw) >= BigInt(UNLIMITED_APPROVAL_RAW);
  } catch {
    return false;
  }
}

/**
 * Insert or update a grant. Re-approving refreshes the record in place and
 * clears a previous revoked flag — the chain state, not the ledger, is the
 * source of truth about what a grant currently means.
 */
export function upsertApproval(
  list: TokenApproval[],
  entry: Omit<TokenApproval, 'id' | 'revokedAt'>,
): TokenApproval[] {
  const id = approvalId(entry.chainId, entry.token, entry.spender);
  const existing = list.find(a => a.id === id);
  if (existing) {
    return list.map(a =>
      a.id === id
        ? { ...a, amountRaw: entry.amountRaw, createdAt: entry.createdAt, source: entry.source, symbol: entry.symbol, decimals: entry.decimals, revokedAt: undefined }
        : a,
    );
  }
  return [{ ...entry, id }, ...list];
}

/** Flag a grant as revoked-after-confirmation; keeps it as history. */
export function markApprovalRevoked(list: TokenApproval[], id: string, at: number): TokenApproval[] {
  return list.map(a => (a.id === id ? { ...a, revokedAt: at } : a));
}

/** Live grants only — what the Approvals page acts on. */
export function activeApprovals(list: TokenApproval[]): TokenApproval[] {
  return list.filter(a => a.revokedAt === undefined);
}

/** ERC20 `approve(address,uint256)` function selector */
const APPROVE_SELECTOR = '0x095ea7b3';
const WORD = 64;

/**
 * Decode an ERC20 approve call out of transaction calldata. Used to record
 * dApp-originated grants: the approval UI must not silently forget what the
 * user signed through eth_sendTransaction.
 *
 * Returns null for anything that is not a well-formed approve call; callers
 * must treat null as "no opinion", never as "not an approval".
 */
export function parseErc20ApprovalCalldata(
  data: string | undefined,
): { spender: string; amountRaw: string } | null {
  if (!data || !data.toLowerCase().startsWith(APPROVE_SELECTOR)) return null;
  const body = data.slice(10);
  // address word (32B, left-padded) + uint256 word
  if (body.length < WORD * 2) return null;
  const addrWord = body.slice(0, WORD);
  const amountWord = body.slice(WORD, WORD * 2);
  if (!/^[0-9a-fA-F]{64}$/.test(addrWord) || !/^[0-9a-fA-F]{64}$/.test(amountWord)) return null;
  // address occupies the last 20 bytes of its word
  const spender = '0x' + addrWord.slice(24);
  if (!/^0x[0-9a-fA-F]{40}$/.test(spender)) return null;
  try {
    return { spender: addr(spender), amountRaw: BigInt('0x' + amountWord).toString() };
  } catch {
    return null;
  }
}

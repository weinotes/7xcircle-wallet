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
 * Unit tests for the approval ledger's pure functions: natural-key
 * identity, upsert/refresh/revoke transitions, and ERC20 approve calldata
 * decoding (valid, malformed, and non-approve cases).
 */
import { describe, expect, it } from 'vitest';
import {
  UNLIMITED_APPROVAL_RAW,
  activeApprovals,
  approvalId,
  isUnlimitedApproval,
  markApprovalRevoked,
  parseErc20ApprovalCalldata,
  upsertApproval,
  type TokenApproval,
} from './approvals.js';

const TOKEN = '0x55d398326f99059fF775485246999027B3197955';
const SPENDER = '0x1111111254EEB25477B68fb85Ed929f73A960582';
const CHAIN = 'bsc-56';

const entry = (over: Partial<Omit<TokenApproval, 'id' | 'revokedAt'>> = {}) => ({
  chainId: CHAIN,
  token: TOKEN,
  spender: SPENDER,
  symbol: 'USDT',
  decimals: 18,
  amountRaw: UNLIMITED_APPROVAL_RAW,
  createdAt: 1_700_000_000,
  source: 'swap' as const,
  ...over,
});

describe('approvalId', () => {
  it('is case-insensitive and mixes the natural key', () => {
    expect(approvalId(CHAIN, TOKEN.toUpperCase(), '0x' + SPENDER.slice(2).toUpperCase()))
      .toBe(`${CHAIN}:${TOKEN.toLowerCase()}:${SPENDER.toLowerCase()}`);
  });
});

describe('isUnlimitedApproval', () => {
  it('recognises the sentinel and rejects mere big numbers', () => {
    expect(isUnlimitedApproval(UNLIMITED_APPROVAL_RAW)).toBe(true);
    expect(isUnlimitedApproval('1000000000000000000')).toBe(false);
    expect(isUnlimitedApproval('garbage')).toBe(false);
  });
});

describe('upsertApproval', () => {
  it('inserts newest first', () => {
    const list = upsertApproval([], entry());
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(approvalId(CHAIN, TOKEN, SPENDER));
  });

  it('refreshes in place on re-approval and clears a prior revoke', () => {
    let list = upsertApproval([], entry());
    list = markApprovalRevoked(list, list[0]!.id, 1_700_000_500);
    expect(activeApprovals(list)).toHaveLength(0);

    list = upsertApproval(list, entry({ amountRaw: '5', createdAt: 1_700_001_000 }));
    expect(list).toHaveLength(1);
    expect(list[0]?.amountRaw).toBe('5');
    expect(list[0]?.revokedAt).toBeUndefined();
    expect(activeApprovals(list)).toHaveLength(1);
  });

  it('keeps distinct spender grants as distinct entries', () => {
    let list = upsertApproval([], entry());
    list = upsertApproval(list, entry({ spender: '0x0000000000000000000000000000000000000001' }));
    expect(list).toHaveLength(2);
  });
});

describe('markApprovalRevoked', () => {
  it('only touches the targeted entry', () => {
    let list = upsertApproval([], entry());
    list = upsertApproval(list, entry({ spender: '0x0000000000000000000000000000000000000002' }));
    const target = list.find(a => a.spender === '0x0000000000000000000000000000000000000002')!;
    const marked = markApprovalRevoked(list, target.id, 42);
    expect(marked.filter(a => a.revokedAt === 42)).toHaveLength(1);
    expect(marked.filter(a => a.revokedAt === undefined)).toHaveLength(1);
  });
});

describe('parseErc20ApprovalCalldata', () => {
  const word = (value: string, pad = 64): string => value.padStart(pad, '0');

  it('decodes a standard approve(spender, amount)', () => {
    const data = '0x095ea7b3' + word(SPENDER.slice(2)) + word('1');
    expect(parseErc20ApprovalCalldata(data)).toEqual({
      spender: SPENDER.toLowerCase(),
      amountRaw: '1',
    });
  });

  it('decodes the unlimited sentinel', () => {
    const data = '0x095ea7b3' + word(SPENDER.slice(2)) + word(BigInt(UNLIMITED_APPROVAL_RAW).toString(16));
    const parsed = parseErc20ApprovalCalldata(data);
    expect(parsed).not.toBeNull();
    expect(isUnlimitedApproval(parsed!.amountRaw)).toBe(true);
  });

  it('is case-insensitive on the selector', () => {
    const data = '0x095EA7B3' + word(SPENDER.slice(2)) + word('7');
    expect(parseErc20ApprovalCalldata(data)?.amountRaw).toBe('7');
  });

  it('returns null for non-approve selectors, short bodies and junk', () => {
    expect(parseErc20ApprovalCalldata(undefined)).toBeNull();
    expect(parseErc20ApprovalCalldata('0x')).toBeNull();
    expect(parseErc20ApprovalCalldata('0xa9059cbb' + word(SPENDER.slice(2)) + word('1'))).toBeNull();
    expect(parseErc20ApprovalCalldata('0x095ea7b3' + word(SPENDER.slice(2)))).toBeNull();
    expect(parseErc20ApprovalCalldata('0x095ea7b3' + 'zz'.repeat(32) + word('1'))).toBeNull();
    expect(parseErc20ApprovalCalldata('0x095ea7b3' + '0'.repeat(127))).toBeNull();
  });
});

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
 * DApp protocol state-machine tests — the security contract of the
 * extension's connection layer: which site may do what, un-prompted or not.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyMethod,
  findPermission,
  gate,
  grantPermission,
  normalizeChainId,
  previewParams,
  providerErrors,
  revokePermission,
  type SitePermission,
} from './protocol.js';

const SITE = 'https://app.uniswap.org';
const BSC = '0x38';

const granted = (origin = SITE, chains = [BSC]): SitePermission[] => [{
  origin,
  chainIds: chains,
  grantedAt: 1,
}];

describe('normalizeChainId', () => {
  it('accepts hex, decimal string, and number forms', () => {
    expect(normalizeChainId(BSC)).toBe(BSC);
    expect(normalizeChainId(56)).toBe(BSC);
    expect(normalizeChainId('56')).toBe(BSC);
    expect(normalizeChainId('0x1')).toBe('0x1');
  });

  it('rejects junk', () => {
    expect(() => normalizeChainId('0xzz')).toThrow(/invalid chain id/);
    expect(() => normalizeChainId('0')).toThrow(/invalid chain id/);
  });
});

describe('permission ledger', () => {
  it('grant is additive per chain and immutable', () => {
    let perms = grantPermission([], SITE, '56');
    perms = grantPermission(perms, SITE, '0x1');
    expect(findPermission(perms, SITE)?.chainIds).toEqual([BSC, '0x1']);
  });

  it('revoke removes the whole record', () => {
    const perms = revokePermission(granted(), SITE);
    expect(findPermission(perms, SITE)).toBeUndefined();
  });
});

describe('classifyMethod', () => {
  it('buckets the EIP-1193 surface', () => {
    expect(classifyMethod('eth_chainId')).toBe('silent');
    expect(classifyMethod('eth_requestAccounts')).toBe('connect');
    expect(classifyMethod('personal_sign')).toBe('sign');
    expect(classifyMethod('eth_signTypedData_v4')).toBe('sign');
    expect(classifyMethod('eth_sendTransaction')).toBe('send');
    expect(classifyMethod('wallet_revokePermissions')).toBe('admin');
    expect(classifyMethod('eth_coinbase')).toBe('unsupported');
  });
});

describe('gate', () => {
  const base = { perms: [] as SitePermission[], origin: SITE, activeChainId: BSC };

  it('reads are silent, eth_accounts included (renders [] without grant)', () => {
    expect(gate({ ...base, method: 'eth_chainId' })).toEqual({ kind: 'allow', method: 'eth_chainId' });
    expect(gate({ ...base, method: 'eth_accounts' }).kind).toBe('allow');
  });

  it('unknown methods are unsupported, not silently allowed', () => {
    expect(gate({ ...base, method: 'eth_coinbase' }).kind).toBe('unsupported');
  });

  it('first connect prompts; repeat connect is silent', () => {
    expect(gate({ ...base, method: 'eth_requestAccounts' }).kind).toBe('prompt-connect');
    expect(gate({ ...base, perms: granted(), method: 'eth_requestAccounts' }).kind).toBe('allow');
  });

  it('sign/send prompt ONLY with a grant — never for strangers', () => {
    expect(gate({ ...base, method: 'personal_sign' })).toEqual({
      kind: 'reject',
      error: providerErrors.unauthorized(),
    });
    expect(gate({ ...base, perms: granted(), method: 'personal_sign' }).kind).toBe('prompt-sign');
    expect(gate({ ...base, perms: granted(), method: 'eth_sendTransaction' }).kind).toBe('prompt-send');
  });

  it('grant does not leak across chains', () => {
    const verdict = gate({ ...base, perms: granted(SITE, ['0x1']), method: 'personal_sign' });
    expect(verdict.kind).toBe('reject');
    if (verdict.kind === 'reject') expect(verdict.error.code).toBe(4901);
  });

  it('grant does not leak across origins', () => {
    const verdict = gate({
      ...base,
      origin: 'https://phishing.example',
      perms: granted(),
      method: 'personal_sign',
    });
    expect(verdict.kind).toBe('reject');
  });
});

describe('previewParams', () => {
  it('truncates enormous payloads and survives circular junk', () => {
    expect(previewParams(['0x' + 'ab'.repeat(1000)]).length).toBeLessThanOrEqual(801 + 20);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(previewParams([circular])).toBe('[unserializable params]');
  });
});

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
 * WalletConnect negotiation tests — the "which account may this dApp see"
 * decision is the security contract of the dApps tab; it must never widen
 * beyond chains we manage AND methods we serve.
 */

import { describe, it, expect } from 'vitest';

import type { Account } from '@7xcircle/shared';
import { caipAccount, negotiateNamespace, SUPPORTED_METHODS } from './namespaces';

const acc = (chainId: string, address: string): Account => ({
  id: `${chainId}-0`,
  chainId,
  address,
  publicKey: 'pk',
  derivationPath: "m/44'/60'/0'/0/0",
  accountIndex: 0,
  createdAt: 0,
});

const ACCOUNTS: Account[] = [
  acc('bsc-56', '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'),
  acc('eth-1', '0xAbC1230000000000000000000000000000000001'),
  acc('solana', 'H1LZyN'),
];

describe('caipAccount', () => {
  it('lowercases the address per CAIP-10', () => {
    expect(caipAccount('eip155:56', '0xABCDEF'))
      .toBe('eip155:56:0xabcdef');
  });
});

describe('negotiateNamespace', () => {
  it('grants only chains with a local account, in requested order', () => {
    const r = negotiateNamespace(
      ['eip155:56', 'eip155:1'],
      ['eth_sendTransaction', 'personal_sign'],
      ACCOUNTS,
    );
    expect(r.approved.eip155.accounts).toEqual([
      'eip155:56:0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
      'eip155:1:0xabc1230000000000000000000000000000000001',
    ]);
    expect(r.unsupportedChains).toEqual([]);
  });

  it('reports chains we cannot serve instead of silently dropping them', () => {
    const r = negotiateNamespace(
      ['eip155:56', 'eip155:999'],
      ['personal_sign'],
      ACCOUNTS,
    );
    expect(r.approved.eip155.accounts).toHaveLength(1);
    expect(r.unsupportedChains).toEqual(['eip155:999']);
  });

  it('never grants methods the wallet cannot serve', () => {
    const r = negotiateNamespace(
      ['eip155:56'],
      ['eth_sendTransaction', 'eth_signTypedData_v4', 'wallet_getSeed'],
      ACCOUNTS,
    );
    expect(r.approved.eip155.methods).toEqual(['eth_sendTransaction']);
    expect(r.approved.eip155.methods).not.toContain('wallet_getSeed');
  });

  it('Solana accounts are not exposed through the eip155 namespace', () => {
    const r = negotiateNamespace(['eip155:56'], ['personal_sign'], [acc('solana', 'S1')]);
    expect(r.approved.eip155.accounts).toEqual([]);
    expect(r.unsupportedChains).toEqual(['eip155:56']);
  });

  it('everything advertised in SUPPORTED_METHODS survives negotiation', () => {
    const r = negotiateNamespace(['eip155:56'], SUPPORTED_METHODS, ACCOUNTS);
    expect(r.approved.eip155.methods).toEqual(SUPPORTED_METHODS);
  });
});

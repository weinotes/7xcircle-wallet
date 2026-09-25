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
 * LI.FI Earn client tests. The fixture mirrors the `example` block published
 * in docs.li.fi/earn-openapi.yaml (v0.1.0) — including the decimal APY form
 * (0.0534 = 5.34%) that the parser must convert, not pass through.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  apyToPercent,
  buildEarnVaultsUrl,
  buildVaultExternalUrl,
  parseEarnVaults,
  setLifiEarnAppUrl,
} from './lifi.js';

afterEach(() => setLifiEarnAppUrl(undefined));

const VAULT = {
  address: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A',
  network: 'base',
  chainId: 8453,
  slug: 'morpho-base-usdc-0x7bfa',
  name: 'Morpho USDC Vault',
  description: 'Optimized USDC lending vault on Morpho',
  protocol: { name: 'Morpho', logoUri: 'https://example.com/morpho-logo.png', url: 'https://morpho.org' },
  underlyingTokens: [{ address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, weight: 1 }],
  lpTokens: [{ address: '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A', symbol: 'mUSDC', decimals: 18 }],
  rewardTokens: [],
  tags: ['stablecoin', 'lending'],
  analytics: {
    apy: { base: 0.0534, reward: null, total: 0.0534 },
    apy1d: 0.0521,
    apy7d: 0.0538,
    apy30d: 0.0545,
    tvl: { usd: '12500000.00', native: '12500000000000' },
    updatedAt: '2026-03-31T14:30:00.000Z',
  },
  isTransactional: true,
  isRedeemable: true,
};

describe('buildEarnVaultsUrl', () => {
  it('targets /v1/vaults and omits empty filters', () => {
    expect(buildEarnVaultsUrl({}, 'https://earn.li.fi')).toBe('https://earn.li.fi/v1/vaults');
  });

  it('encodes the documented query params', () => {
    const url = buildEarnVaultsUrl({
      asset: 'USDC',
      minTvlUsd: 5_000_000,
      sortBy: 'apy',
      limit: 6,
      isRedeemable: true,
    }, 'https://earn.li.fi');
    const q = new URL(url).searchParams;
    expect(q.get('asset')).toBe('USDC');
    expect(q.get('minTvlUsd')).toBe('5000000');
    expect(q.get('sortBy')).toBe('apy');
    expect(q.get('limit')).toBe('6');
    expect(q.get('isRedeemable')).toBe('true');
    expect(q.has('chainId')).toBe(false);
  });

  it('rejects out-of-range filters', () => {
    expect(() => buildEarnVaultsUrl({ chainId: 0 })).toThrow(/positive integer/);
    expect(() => buildEarnVaultsUrl({ limit: 200 })).toThrow(/between 1 and 100/);
    expect(() => buildEarnVaultsUrl({ minTvlUsd: -1 })).toThrow(/non-negative/);
  });
});

describe('apyToPercent', () => {
  it('converts the API decimal form to a percentage', () => {
    expect(apyToPercent(0.0534)).toBeCloseTo(5.34);
    expect(apyToPercent('0.005')).toBeCloseTo(0.5);
  });

  it('keeps a legitimate zero reward and rejects junk', () => {
    expect(apyToPercent(0)).toBe(0);
    expect(apyToPercent(null)).toBeNull();
    expect(apyToPercent('n/a')).toBeNull();
    expect(apyToPercent(undefined)).toBeNull();
  });
});

describe('parseEarnVaults', () => {
  it('narrows a vault and converts APY/TVL', () => {
    const page = parseEarnVaults({ data: [VAULT], nextCursor: 'eyJpZCI6MTAwfQ', total: 47 });
    expect(page.total).toBe(47);
    expect(page.nextCursor).toBe('eyJpZCI6MTAwfQ');
    expect(page.vaults).toHaveLength(1);

    const vault = page.vaults[0];
    expect(vault.chainId).toBe(8453);
    expect(vault.apyTotalPct).toBeCloseTo(5.34);
    expect(vault.apyBasePct).toBeCloseTo(5.34);
    expect(vault.apyRewardPct).toBeNull();
    expect(vault.apy30dPct).toBeCloseTo(5.45);
    expect(vault.tvlUsd).toBe(12_500_000);
    expect(vault.underlyingTokens[0]).toEqual({
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      decimals: 6,
    });
    expect(vault.isRedeemable).toBe(true);
    expect(vault.externalUrl).toBe('https://morpho.org');
  });

  it('drops vaults that cannot be rendered honestly', () => {
    const page = parseEarnVaults({
      data: [
        { ...VAULT, address: '' },
        { ...VAULT, chainId: undefined },
        { ...VAULT, protocol: {} },
        { ...VAULT, analytics: { apy: { total: null } } },
      ],
    });
    expect(page.vaults).toEqual([]);
  });

  it('throws on a malformed envelope instead of showing an empty board', () => {
    expect(() => parseEarnVaults(null)).toThrow(/unexpected response shape/);
    expect(() => parseEarnVaults({ message: 'rate limited' })).toThrow(/rate limited/);
  });
});

describe('buildVaultExternalUrl', () => {
  it('uses the protocol dashboard when no app route is configured', () => {
    expect(buildVaultExternalUrl(8453, VAULT.address, 'https://morpho.org')).toBe('https://morpho.org');
  });

  it('prefers the configured app route and trims trailing slashes', () => {
    setLifiEarnAppUrl('https://earn.example.com/');
    expect(buildVaultExternalUrl(8453, VAULT.address, 'https://morpho.org'))
      .toBe(`https://earn.example.com/8453/${VAULT.address}`);
  });

  it('returns undefined when neither is available', () => {
    expect(buildVaultExternalUrl(8453, VAULT.address)).toBeUndefined();
  });
});
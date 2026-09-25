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
 * 0x v2 client tests. Query construction is the contract — 0x silently
 * ignores unknown params, so a typo here would ship a fee-free swap. The
 * response fixture mirrors the documented allowance-holder quote shape
 * (transaction + issues.allowance + fees.integratorFee).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildZeroExQuoteUrl,
  fetchZeroExQuote,
  getEvmSwapTokens,
  hasZeroExKey,
  parseZeroExQuote,
  setZeroExApiKey,
  setZeroExBaseUrl,
  zeroExQuoteToIntents,
  ZEROX_CHAIN_IDS,
  ZEROX_NATIVE_TOKEN,
} from './zerox.js';

const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const TAKER = '0x1111111111111111111111111111111111111111';
const FEE_WALLET = '0x2222222222222222222222222222222222222222';

const PARAMS = {
  chainId: 56,
  sellToken: USDT_BSC,
  buyToken: USDC_BSC,
  sellAmountRaw: '1000000000000000000',
  taker: TAKER,
} as const;

beforeEach(() => {
  setZeroExApiKey(undefined);
  setZeroExBaseUrl(undefined);
});
afterEach(() => {
  setZeroExApiKey(undefined);
  setZeroExBaseUrl(undefined);
  vi.restoreAllMocks();
});

describe('buildZeroExQuoteUrl', () => {
  it('targets the allowance-holder endpoint with the required params', () => {
    const url = buildZeroExQuoteUrl(PARAMS, 'https://api.0x.org');
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/swap/allowance-holder/quote');
    expect(parsed.searchParams.get('chainId')).toBe('56');
    expect(parsed.searchParams.get('sellToken')).toBe(USDT_BSC);
    expect(parsed.searchParams.get('buyToken')).toBe(USDC_BSC);
    expect(parsed.searchParams.get('sellAmount')).toBe('1000000000000000000');
    expect(parsed.searchParams.get('taker')).toBe(TAKER);
    // 0x defaults slippage to 100 bps when we do not ask
    expect(parsed.searchParams.get('slippageBps')).toBe('100');
    expect(parsed.searchParams.has('swapFeeBps')).toBe(false);
  });

  it('passes the integrator fee through with the buy token as default fee asset', () => {
    const url = buildZeroExQuoteUrl({
      ...PARAMS,
      swapFeeRecipient: FEE_WALLET,
      swapFeeBps: 30,
    }, 'https://api.0x.org');
    const q = new URL(url).searchParams;
    expect(q.get('swapFeeRecipient')).toBe(FEE_WALLET);
    expect(q.get('swapFeeBps')).toBe('30');
    expect(q.get('swapFeeToken')).toBe(USDC_BSC);
  });

  it('rejects a fee token that is neither side of the trade', () => {
    expect(() => buildZeroExQuoteUrl({
      ...PARAMS,
      swapFeeRecipient: FEE_WALLET,
      swapFeeBps: 30,
      swapFeeToken: '0x3333333333333333333333333333333333333333',
    })).toThrow(/buy or the sell token/);
  });

  it('requires a recipient when a fee is requested', () => {
    expect(() => buildZeroExQuoteUrl({ ...PARAMS, swapFeeBps: 30 }))
      .toThrow(/swapFeeRecipient is required/);
  });

  it('enforces 0x ceilings and shape', () => {
    expect(() => buildZeroExQuoteUrl({ ...PARAMS, slippageBps: 20_000 })).toThrow(/slippageBps/);
    expect(() => buildZeroExQuoteUrl({ ...PARAMS, swapFeeBps: 2_000, swapFeeRecipient: FEE_WALLET }))
      .toThrow(/swapFeeBps/);
    expect(() => buildZeroExQuoteUrl({ ...PARAMS, chainId: 999 })).toThrow(/does not serve/);
    expect(() => buildZeroExQuoteUrl({ ...PARAMS, sellAmountRaw: '0' })).toThrow(/positive integer/);
  });
});

describe('parseZeroExQuote', () => {
  const payload = {
    sellToken: USDT_BSC,
    buyToken: USDC_BSC,
    sellAmount: '1000000000000000000',
    buyAmount: '999000000000000000',
    minBuyAmount: '995000000000000000',
    liquidityAvailable: true,
    priceImpact: 0.42,
    totalNetworkFee: '210000000000000',
    fees: { integratorFee: { amount: '2997000000000000', token: USDC_BSC, recipient: FEE_WALLET } },
    issues: {
      allowance: { actual: '0', spender: '0x0000000000001fF3684f28c67538d4D072C22734' },
      simulationIncomplete: false,
    },
    transaction: {
      to: '0x0000000000001fF3684f28c67538d4D072C22734',
      data: '0xdeadbeef',
      value: '0',
      gas: '210000',
      gasPrice: '1000000000',
    },
  };

  it('narrows the fields the wallet renders and sends', () => {
    const quote = parseZeroExQuote(payload);
    expect(quote.buyAmount).toBe('999000000000000000');
    expect(quote.minBuyAmount).toBe('995000000000000000');
    expect(quote.liquidityAvailable).toBe(true);
    expect(quote.priceImpactPct).toBe(0.42);
    expect(quote.integratorFee?.recipient).toBe(FEE_WALLET);
    expect(quote.approval).toEqual({
      token: USDT_BSC,
      spender: '0x0000000000001fF3684f28c67538d4D072C22734',
      amountRaw: '1000000000000000000',
    });
    expect(quote.transaction.to).toBe('0x0000000000001fF3684f28c67538d4D072C22734');
    expect(quote.transaction.data).toBe('0xdeadbeef');
  });

  it('omits the approval when 0x reports no allowance issue', () => {
    const quote = parseZeroExQuote({
      ...payload,
      issues: { allowance: null },
    });
    expect(quote.approval).toBeUndefined();
  });

  it('flags an insufficient balance and a dry route', () => {
    const quote = parseZeroExQuote({
      ...payload,
      liquidityAvailable: false,
      issues: { balance: { actual: '0', expected: '1000000000000000000' } },
    });
    expect(quote.insufficientBalance).toBe(true);
    expect(quote.liquidityAvailable).toBe(false);
  });

  it('throws with the 0x reason instead of a bare failure', () => {
    expect(() => parseZeroExQuote({ reason: 'insufficient liquidity' }))
      .toThrow(/insufficient liquidity/);
    expect(() => parseZeroExQuote(null)).toThrow(/empty response/);
  });
});

describe('zeroExQuoteToIntents', () => {
  it('maps to a contract-call plus the approval step when needed', () => {
    const quote = parseZeroExQuote({
      sellToken: USDT_BSC,
      buyToken: USDC_BSC,
      sellAmount: '1000',
      buyAmount: '990',
      issues: { allowance: { spender: '0x0000000000001fF3684f28c67538d4D072C22734' } },
      transaction: { to: '0x0000000000001fF3684f28c67538d4D072C22734', data: '0xbeef', value: '0' },
    });
    const intents = zeroExQuoteToIntents(quote);
    expect(intents.swap).toEqual({
      kind: 'contract-call',
      to: '0x0000000000001fF3684f28c67538d4D072C22734',
      data: '0xbeef',
      valueRaw: '0',
    });
    expect(intents.approve?.kind).toBe('approve');
  });
});

describe('degradation without a key', () => {
  it('returns null and never fetches', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(hasZeroExKey()).toBe(false);
    expect(await fetchZeroExQuote(PARAMS)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('curated EVM token registry', () => {
  it('serves every chain 0x supports', () => {
    for (const chainId of ZEROX_CHAIN_IDS) {
      expect(getEvmSwapTokens(chainId).length).toBeGreaterThan(0);
    }
  });

  it('lists the native coin first and uses the 0x sentinel for it', () => {
    for (const chainId of ZEROX_CHAIN_IDS) {
      const [native, ...rest] = getEvmSwapTokens(chainId);
      expect(native.isNative).toBe(true);
      expect(native.address).toBe(ZEROX_NATIVE_TOKEN);
      // the sentinel must survive the quote-URL address guard
      expect(() => buildZeroExQuoteUrl({ ...PARAMS, chainId, sellToken: native.address })).not.toThrow();
      // and be unique — a second native entry would double-list the gas coin
      expect(rest.every(t => t.address !== ZEROX_NATIVE_TOKEN)).toBe(true);
    }
  });

  it('holds only well-formed, unique, non-native addresses', () => {
    for (const chainId of ZEROX_CHAIN_IDS) {
      const tokens = getEvmSwapTokens(chainId);
      const seen = new Set<string>();
      for (const token of tokens) {
        expect(token.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(token.decimals).toBeGreaterThanOrEqual(0);
        expect(token.symbol.length).toBeGreaterThan(0);
        const key = token.address.toLowerCase();
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        if (!token.isNative) expect(key).not.toBe(ZEROX_NATIVE_TOKEN.toLowerCase());
      }
    }
  });

  it('returns an empty list for an unsupported chain rather than throwing', () => {
    expect(getEvmSwapTokens(999999)).toEqual([]);
  });
});
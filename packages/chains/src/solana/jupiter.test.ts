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
 * Jupiter client tests — URL/body shapes are the wire contract with the
 * aggregator; fee invariants are money. All pure, no network.
 */

import { describe, it, expect } from 'vitest';

import {
  buildQuoteUrl,
  buildSwapBody,
  deriveFeeAccount,
  parseQuote,
  parseSwapResponse,
  SOL_MINT,
  USDC_MINT,
} from './jupiter.js';

const BASE = 'https://lite-api.jup.ag/swap/v1';

describe('buildQuoteUrl', () => {
  it('encodes the exact-in quote contract', () => {
    const url = new URL(buildQuoteUrl({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amountRaw: '1000000000',
      slippageBps: 50,
      platformFeeBps: 30,
    }, BASE));
    expect(url.origin + url.pathname).toBe(`${BASE}/quote`);
    expect(url.searchParams.get('inputMint')).toBe(SOL_MINT);
    expect(url.searchParams.get('outputMint')).toBe(USDC_MINT);
    expect(url.searchParams.get('amount')).toBe('1000000000');
    expect(url.searchParams.get('slippageBps')).toBe('50');
    expect(url.searchParams.get('platformFeeBps')).toBe('30');
    expect(url.searchParams.get('swapMode')).toBe('ExactIn');
    // verified-only routing is the anti-scam default
    expect(url.searchParams.get('restrictIntermediateTokens')).toBe('true');
  });

  it('omits the fee param when zero and rejects oversized fees', () => {
    const url = buildQuoteUrl({
      inputMint: SOL_MINT, outputMint: USDC_MINT, amountRaw: '1', slippageBps: 10,
    }, BASE);
    expect(url).not.toContain('platformFeeBps');
    expect(() => buildQuoteUrl({
      inputMint: SOL_MINT, outputMint: USDC_MINT, amountRaw: '1', slippageBps: 10, platformFeeBps: 501,
    }, BASE)).toThrow(/platformFeeBps/);
  });

  it('rejects junk mints and non-positive amounts', () => {
    expect(() => buildQuoteUrl({
      inputMint: 'not base58!!', outputMint: USDC_MINT, amountRaw: '1', slippageBps: 10,
    }, BASE)).toThrow(/inputMint/);
    expect(() => buildQuoteUrl({
      inputMint: SOL_MINT, outputMint: USDC_MINT, amountRaw: '0', slippageBps: 10,
    }, BASE)).toThrow(/positive/);
    expect(() => buildQuoteUrl({
      inputMint: SOL_MINT, outputMint: USDC_MINT, amountRaw: '-5', slippageBps: 10,
    }, BASE)).toThrow(/positive/);
  });
});

describe('parseQuote', () => {
  const sample = {
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    inAmount: '1000000000',
    outAmount: '152340000',
    otherAmountThreshold: '151578300',
    priceImpactPct: '0.0012',
    slippageBps: 50,
    platformFeeBps: 30,
    routePlan: [],
  };

  it('extracts the render subset and keeps the raw echo', () => {
    const q = parseQuote(sample);
    expect(q.outAmount).toBe('152340000');
    expect(q.platformFeeBps).toBe(30);
    expect(q.raw).toBe(sample);
  });

  it('throws on error bodies instead of returning garbage', () => {
    expect(() => parseQuote({ error: 'no route' })).toThrow(/no route/);
    expect(() => parseQuote({})).toThrow(/unexpected/);
  });
});

describe('buildSwapBody', () => {
  const quote = parseQuote({
    inputMint: SOL_MINT, outputMint: USDC_MINT,
    inAmount: '1', outAmount: '1', otherAmountThreshold: '1',
    priceImpactPct: '0', slippageBps: 50, platformFeeBps: 30,
  });

  it('echoes quoteResponse verbatim and sets userPublicKey', () => {
    const body = buildSwapBody({ quote, userPublicKey: SOL_MINT, feeAccount: USDC_MINT });
    expect(body.quoteResponse).toBe(quote.raw);
    expect(body.userPublicKey).toBe(SOL_MINT);
    expect(body.feeAccount).toBe(USDC_MINT);
    expect(body.wrapAndUnwrapSol).toBe(true);
  });

  it('refuses to build a fee-bearing quote without our feeAccount', () => {
    expect(() => buildSwapBody({ quote, userPublicKey: SOL_MINT })).toThrow(/feeAccount/);
  });
});

describe('parseSwapResponse', () => {
  it('unwraps the base64 transaction and surfaces API errors', () => {
    expect(parseSwapResponse({ swapTransaction: 'YWJj' })).toBe('YWJj');
    expect(() => parseSwapResponse({ error: 'slippage' })).toThrow(/slippage/);
  });
});

describe('deriveFeeAccount', () => {
  // Deterministic ATA derivation from a fixed fee wallet — regression pin.
  const FEE_WALLET = '11111111111111111111111111111112'; // system-ish valid pk for derivation

  it('derives stable ATAs for SOL and USDC legs', async () => {
    const solAta = await deriveFeeAccount(FEE_WALLET, SOL_MINT);
    const usdcAta = await deriveFeeAccount(FEE_WALLET, USDC_MINT);
    expect(solAta).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(usdcAta).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(solAta).not.toBe(usdcAta);
    // re-derivation is stable (fee destination must never drift per mint)
    expect(await deriveFeeAccount(FEE_WALLET, SOL_MINT)).toBe(solAta);
  });
});

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
 * TronSave self-signed rental tests.
 *
 * The mock payloads mirror the responses observed live against
 * api.tronsave.io (2026-09): the estimate, the buy ack and the order status.
 * The lot-size arithmetic and the "exact SUN" payment rule are what keep us
 * from ordering an unorderable amount or paying an amount the order cannot
 * recognise.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_DURATION_SEC,
  MIN_BANDWIDTH_ORDER,
  MIN_ENERGY_ORDER,
  TRONSAVE_DEFAULT_BASE,
  TRONSAVE_FUND_ADDRESS,
  TRONSAVE_FUND_ADDRESS_NILE,
  buildBuyResourceBody,
  buildEstimateBody,
  buildPaymentIntent,
  buyResource,
  estimateBuyResource,
  fetchResourceOrder,
  fundAddressFor,
  getTronsaveBaseUrl,
  getTronsaveFundAddress,
  parseBuyOrder,
  parseEstimate,
  planResourcePurchase,
  setTronsaveBaseUrl,
  setTronsaveFundAddress,
  setTronsaveSponsor,
  type SignedTxPayload,
} from './tronsave.js';

const RECEIVER = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/** The exact payload api.tronsave.io returns for a 65k / 3-day SLOW estimate */
const ESTIMATE_OK = {
  error: false,
  message: 'Success',
  data: {
    unitPrice: 43,
    durationSec: 259_200,
    estimateTrx: 8_385_000,
    availableResource: 65_000,
  },
};

const SIGNED: SignedTxPayload = {
  visible: false,
  txID: 'a'.repeat(64),
  raw_data_hex: '0a02',
  raw_data: {},
  signature: ['b'.repeat(130)],
};

/** Stub fetch with one JSON response and expose the captured call */
function mockJson(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  setTronsaveBaseUrl(undefined);
  setTronsaveFundAddress(undefined);
  setTronsaveSponsor(undefined);
});
afterEach(() => {
  setTronsaveBaseUrl(undefined);
  setTronsaveFundAddress(undefined);
  setTronsaveSponsor(undefined);
  vi.restoreAllMocks();
});

describe('planResourcePurchase', () => {
  it('buys nothing when the account already has enough', () => {
    expect(planResourcePurchase(31_895, 64_285, MIN_ENERGY_ORDER))
      .toEqual({ shortfall: 0, orderAmount: 0, skipReason: 'covered' });
  });

  it('skips a gap below the sellable lot instead of ordering it', () => {
    // 40k short is unorderable — energy lots start at 65k
    const gap = planResourcePurchase(80_000, 40_000, MIN_ENERGY_ORDER);
    expect(gap.shortfall).toBe(40_000);
    expect(gap.orderAmount).toBe(0);
    expect(gap.skipReason).toBe('below-minimum');
  });

  it('orders the exact shortfall once it reaches the lot size', () => {
    expect(planResourcePurchase(105_527, 40_000, MIN_ENERGY_ORDER))
      .toEqual({ shortfall: 65_527, orderAmount: 65_527 });
  });

  it('bandwidth uses its own small lot threshold', () => {
    expect(planResourcePurchase(400, 345, MIN_BANDWIDTH_ORDER).skipReason).toBe('below-minimum');
    expect(planResourcePurchase(2_000, 345, MIN_BANDWIDTH_ORDER).orderAmount).toBe(1_655);
  });
});

describe('fund address selection', () => {
  it('splits mainnet from testnet so real TRX never goes to the Nile collector', () => {
    expect(fundAddressFor(false)).toBe(TRONSAVE_FUND_ADDRESS);
    expect(fundAddressFor(true)).toBe(TRONSAVE_FUND_ADDRESS_NILE);
    expect(TRONSAVE_FUND_ADDRESS).not.toBe(TRONSAVE_FUND_ADDRESS_NILE);
  });
});

describe('buildEstimateBody', () => {
  it('maps to the documented wire fields', () => {
    expect(buildEstimateBody({
      receiver: RECEIVER,
      resourceType: 'ENERGY',
      resourceAmount: 65_000,
      durationSec: DEFAULT_DURATION_SEC,
      unitPrice: 'SLOW',
    })).toEqual({
      receiver: RECEIVER,
      resourceType: 'ENERGY',
      resourceAmount: 65_000,
      durationSec: 259_200,
      unitPrice: 'SLOW',
    });
  });

  it('rejects a malformed receiver and non-positive sizes', () => {
    expect(() => buildEstimateBody({
      receiver: '0xdeadbeef', resourceType: 'ENERGY', resourceAmount: 65_000,
      durationSec: DEFAULT_DURATION_SEC, unitPrice: 'SLOW',
    })).toThrow(/base58 TRON address/);
    expect(() => buildEstimateBody({
      receiver: RECEIVER, resourceType: 'ENERGY', resourceAmount: 0,
      durationSec: DEFAULT_DURATION_SEC, unitPrice: 'SLOW',
    })).toThrow(/positive amount/);
  });
});

describe('parseEstimate (live-verified shape)', () => {
  it('reads the SUN cost verbatim', () => {
    expect(parseEstimate(ESTIMATE_OK)).toEqual({
      availableResource: 65_000,
      durationSec: 259_200,
      unitPriceSun: 43,
      estimateTrxSun: '8385000',
    });
  });

  it('throws rather than inventing a zero cost', () => {
    expect(() => parseEstimate({ error: true, message: 'Not enough liquidity' }))
      .toThrow(/Not enough liquidity/);
    expect(() => parseEstimate({ error: false, message: 'Success' })).toThrow(/no data/);
    expect(() => parseEstimate({ error: false, data: { unitPrice: 43 } }))
      .toThrow(/no numeric cost/);
    expect(() => parseEstimate(null)).toThrow(/failed/);
  });
});

describe('estimateBuyResource (keyless)', () => {
  it('POSTs the estimate and returns the parsed quote without any API key', async () => {
    const spy = mockJson(ESTIMATE_OK);
    const estimate = await estimateBuyResource({
      receiver: RECEIVER, resourceType: 'ENERGY', resourceAmount: 65_000,
      durationSec: DEFAULT_DURATION_SEC, unitPrice: 'SLOW',
    });

    expect(estimate?.estimateTrxSun).toBe('8385000');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${TRONSAVE_DEFAULT_BASE}/v2/estimate-buy-resource`);
    expect(init.method).toBe('POST');
    // No credential of any kind rides along
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['Content-Type']);
  });

  it('hides the offer when the book cannot cover the whole lot', async () => {
    mockJson({ ...ESTIMATE_OK, data: { ...ESTIMATE_OK.data, availableResource: 64_999 } });
    const estimate = await estimateBuyResource({
      receiver: RECEIVER, resourceType: 'ENERGY', resourceAmount: 65_000,
      durationSec: DEFAULT_DURATION_SEC, unitPrice: 'SLOW',
    });
    expect(estimate).toBeNull();
  });

  it('returns null on a business error, an HTTP error and a transport failure', async () => {
    mockJson({ error: true, message: 'Not enough liquidity' });
    expect(await estimateBuyResource({
      receiver: RECEIVER, resourceType: 'ENERGY', resourceAmount: 65_000,
      durationSec: DEFAULT_DURATION_SEC, unitPrice: 'SLOW',
    })).toBeNull();

    mockJson({}, 500);
    expect(await estimateBuyResource({
      receiver: RECEIVER, resourceType: 'ENERGY', resourceAmount: 65_000,
      durationSec: DEFAULT_DURATION_SEC, unitPrice: 'SLOW',
    })).toBeNull();

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await estimateBuyResource({
      receiver: RECEIVER, resourceType: 'ENERGY', resourceAmount: 65_000,
      durationSec: DEFAULT_DURATION_SEC, unitPrice: 'SLOW',
    })).toBeNull();
  });
});

describe('buildPaymentIntent', () => {
  it('pays the estimate SUN exactly, to the configured fund address', () => {
    expect(buildPaymentIntent('8385000')).toEqual({
      kind: 'native-transfer',
      to: TRONSAVE_FUND_ADDRESS,
      amountRaw: '8385000',
    });
  });

  it('honours an override so a testnet rental pays the Nile address', () => {
    expect(buildPaymentIntent('1', TRONSAVE_FUND_ADDRESS_NILE))
      .toMatchObject({ kind: 'native-transfer', to: TRONSAVE_FUND_ADDRESS_NILE });
  });

  it('refuses a non-positive or non-numeric amount', () => {
    expect(() => buildPaymentIntent('0')).toThrow(/positive SUN/);
    expect(() => buildPaymentIntent('8.4')).toThrow(/positive SUN/);
  });
});

describe('buildBuyResourceBody', () => {
  it('carries the signed tx and caps the price at the agreed unit price', () => {
    expect(buildBuyResourceBody(
      { receiver: RECEIVER, resourceType: 'ENERGY', unitPriceSun: 43, resourceAmount: 65_000, durationSec: 259_200 },
      SIGNED,
    )).toEqual({
      resourceType: 'ENERGY',
      unitPrice: 43,
      resourceAmount: 65_000,
      receiver: RECEIVER,
      durationSec: 259_200,
      options: { allowPartialFill: false, maxPriceAccepted: 43 },
      signedTx: SIGNED,
    });
  });

  it('passes explicit options through', () => {
    const body = buildBuyResourceBody(
      { receiver: RECEIVER, resourceType: 'ENERGY', unitPriceSun: 43, resourceAmount: 65_000, durationSec: 259_200 },
      SIGNED,
      { allowPartialFill: true, maxPriceAcceptedSun: 50, minResourceDelegateRequiredAmount: 65_000 },
    );
    expect(body.options).toEqual({
      allowPartialFill: true,
      maxPriceAccepted: 50,
      minResourceDelegateRequiredAmount: 65_000,
    });
  });

  it('refuses an unsigned payment', () => {
    expect(() => buildBuyResourceBody(
      { receiver: RECEIVER, resourceType: 'ENERGY', unitPriceSun: 43, resourceAmount: 65_000, durationSec: 259_200 },
      { ...SIGNED, signature: [] },
    )).toThrow(/signed payment/);
  });

  it('omits sponsor when none is configured', () => {
    const body = buildBuyResourceBody(
      { receiver: RECEIVER, resourceType: 'ENERGY', unitPriceSun: 43, resourceAmount: 65_000, durationSec: 259_200 },
      SIGNED,
    );
    expect(body).not.toHaveProperty('sponsor');
  });

  it('carries the sponsor code so TronSave pays our 5% commission', () => {
    setTronsaveSponsor('TEST-SPONSOR-CODE');
    const body = buildBuyResourceBody(
      { receiver: RECEIVER, resourceType: 'ENERGY', unitPriceSun: 43, resourceAmount: 65_000, durationSec: 259_200 },
      SIGNED,
    );
    expect(body.sponsor).toBe('TEST-SPONSOR-CODE');
    // Attribution is platform-side margin: the buyer's price must not move.
    expect(body.unitPrice).toBe(43);
    expect(body.options).toEqual({ allowPartialFill: false, maxPriceAccepted: 43 });
  });
});

describe('parseBuyOrder', () => {
  it('reads the order id', () => {
    expect(parseBuyOrder({ error: false, message: 'Success', data: { orderId: 'ord_123' } }))
      .toEqual({ orderId: 'ord_123' });
  });

  it('surfaces a business failure rather than a phantom success', () => {
    expect(() => parseBuyOrder({ error: true, message: 'Invalid signed tx' }))
      .toThrow(/Invalid signed tx/);
    expect(() => parseBuyOrder({ error: false, data: {} })).toThrow(/no orderId/);
  });
});

describe('buyResource', () => {
  it('authenticates with the signed tx alone — no key header', async () => {
    const spy = mockJson({ error: false, message: 'Success', data: { orderId: 'ord_9' } });
    const ack = await buyResource(
      { receiver: RECEIVER, resourceType: 'ENERGY', unitPriceSun: 43, resourceAmount: 65_000, durationSec: 259_200 },
      SIGNED,
    );

    expect(ack).toEqual({ orderId: 'ord_9' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${TRONSAVE_DEFAULT_BASE}/v2/buy-resource`);
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['Content-Type']);
    expect(JSON.parse(String(init.body)).signedTx.txID).toBe(SIGNED.txID);
  });

  it('returns null on business and transport failure — nothing to roll back', async () => {
    mockJson({ error: true, message: 'Invalid signed tx' });
    expect(await buyResource(
      { receiver: RECEIVER, resourceType: 'ENERGY', unitPriceSun: 43, resourceAmount: 65_000, durationSec: 259_200 },
      SIGNED,
    )).toBeNull();

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await buyResource(
      { receiver: RECEIVER, resourceType: 'ENERGY', unitPriceSun: 43, resourceAmount: 65_000, durationSec: 259_200 },
      SIGNED,
    )).toBeNull();
  });
});

describe('fetchResourceOrder', () => {
  it('parses fulfilment progress and each delegation', async () => {
    mockJson({
      error: false,
      message: 'Success',
      data: {
        fulfilledPercent: 100,
        remainAmount: 0,
        payoutAmount: 8_385_000,
        delegates: [{ delegator: 'TKDelegator1111111111111111111111', amount: 65_000, txid: 'c'.repeat(64) }],
      },
    });
    const order = await fetchResourceOrder('ord_123');
    expect(order).toEqual({
      orderId: '',
      fulfilledPercent: 100,
      remainAmount: 0,
      payoutAmount: 8_385_000,
      delegates: [{ delegator: 'TKDelegator1111111111111111111111', amount: 65_000, txid: 'c'.repeat(64) }],
    });
  });

  it('returns null for an empty id, a failure and a transport error', async () => {
    expect(await fetchResourceOrder('')).toBeNull();
    mockJson({ error: true, message: 'Order not found' });
    expect(await fetchResourceOrder('ord_missing')).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await fetchResourceOrder('ord_123')).toBeNull();
  });
});

describe('base URL override', () => {
  it('defaults to mainnet and accepts a proxy, then resets', () => {
    expect(getTronsaveBaseUrl()).toBe(TRONSAVE_DEFAULT_BASE);
    setTronsaveBaseUrl('https://proxy.example.com');
    expect(getTronsaveBaseUrl()).toBe('https://proxy.example.com');
    setTronsaveBaseUrl(undefined);
    expect(getTronsaveBaseUrl()).toBe(TRONSAVE_DEFAULT_BASE);
  });

  it('rejects a malformed fund address override instead of paying a stranger', () => {
    expect(() => setTronsaveFundAddress('not-an-address')).toThrow(/base58 TRON address/);
    expect(getTronsaveFundAddress()).toBe(TRONSAVE_FUND_ADDRESS);
  });
});
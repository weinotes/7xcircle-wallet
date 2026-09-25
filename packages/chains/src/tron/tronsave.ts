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
 * TRON energy brokerage — the P1 "能量代付" revenue line from MONETIZATION.md.
 *
 * A TRC20 USDT transfer costs either ~$0.5-3 in burned TRX (when the sender
 * has no staked resources) or ~$0.3-0.8 worth of RENTED energy. Buying energy
 * wholesale and reselling it below the burn cost is the margin.
 *
 * We rent through TronSave's SELF-SIGNED path, which is the only one that fits
 * a zero-backend, non-custodial wallet:
 *
 *   1. POST /v2/estimate-buy-resource   KEYLESS. Price + the exact TRX to pay.
 *   2. the buyer signs a plain TRX transfer of `estimateTrx` to the fund
 *      address — locally, with the wallet key, exactly like any other send.
 *   3. POST /v2/buy-resource            authenticated BY that signed tx alone.
 *      TronSave broadcasts it as part of the order, so we must NOT broadcast it
 *      ourselves: a payment the order does not know about is money lost.
 *   4. GET  /v2/order/{orderId}         fulfilment progress + delegations.
 *
 * We deliberately do NOT support TronSave's API-key path. That path spends from
 * a custodial internal balance, so it requires a deposit, a backend to hold the
 * key, and is documented as server-side only — none of which this wallet has.
 * `/v2/signed-tx` is likewise absent: it takes the buyer's PRIVATE KEY, which
 * must never leave the device.
 *
 * No credential is needed anywhere above, so the module has no key to miss.
 *
 * DEGRADATION: every fetcher returns null on a transport or business failure
 * and the UI simply hides the offer — "no quote" must never be rendered as a
 * price, and a rental must never fail into a wallet error.
 *
 * Browser reachability: `api.tronsave.io` answers `Access-Control-Allow-Origin:
 * *` (verified 2026-09, including the POST preflight), so these calls work from
 * the web app with no proxy.
 */

import type { TxIntent } from '@open-wallet/shared';

// ─── Endpoint config ────────────────────────────────────────────────

export const TRONSAVE_DEFAULT_BASE = 'https://api.tronsave.io';
/** Nile testnet deployment — only for manual testing, not wired into any page */
export const TRONSAVE_NILE_BASE = 'https://api-dev.tronsave.io';

let baseUrl = TRONSAVE_DEFAULT_BASE;

/** Point at a proxy/self-hosted gateway; undefined resets to the default. */
export function setTronsaveBaseUrl(url: string | undefined): void {
  baseUrl = url && url.length > 0 ? url : TRONSAVE_DEFAULT_BASE;
}

export function getTronsaveBaseUrl(): string {
  return baseUrl;
}

// ─── Referral attribution ───────────────────────────────────────────

let sponsorCode: string | undefined;

/**
 * Install the TronSave sponsor (referral) code our orders are attributed to.
 *
 * Attribution is pure margin for us: the code rides along with an order the
 * user pays for at TronSave's normal market rate, and TronSave pays the
 * commission platform-side in TRX. We add no markup and never touch the funds.
 * Without a code the order is unattributed and this revenue line earns nothing.
 *
 * Rate + access: TronSave's own published figures CONFLICT — the Referral
 * Program page quotes 5% of total order value, while the live FAQ describes an
 * "Agency Program" with tiered rates starting at 10-20% for new agencies.
 * Obtaining a code is not self-service: it requires applying to the Agency
 * Program on tronsave.io and being approved. Treat the rate as negotiated.
 *
 * The code is not a secret (it appears in the order payload), so it is safe to
 * read from a VITE_* variable in the browser.
 */
export function setTronsaveSponsor(code: string | undefined): void {
  sponsorCode = code && code.length > 0 ? code : undefined;
}

export function getTronsaveSponsor(): string | undefined {
  return sponsorCode;
}

// ─── Fund address (where the rental payment goes) ───────────────────

/** Mainnet collection address from the TronSave docs. */
export const TRONSAVE_FUND_ADDRESS = 'TWZEhq5JuUVvGtutNgnRBATbF8BnHGyn4S';
/** Nile collection address — testnet only. */
export const TRONSAVE_FUND_ADDRESS_NILE = 'TATT1UzHRikft98bRFqApFTsaSw73ycfoS';

/**
 * Pick the collection address for a network.
 *
 * The wrong one sends real TRX to an address that will never fill the order,
 * so this is decided by the chain's `testnet` flag rather than by a caller
 * guess.
 */
export function fundAddressFor(testnet: boolean): string {
  return testnet ? TRONSAVE_FUND_ADDRESS_NILE : TRONSAVE_FUND_ADDRESS;
}

let fundAddress = TRONSAVE_FUND_ADDRESS;

/** Override the collection address (tests, or a self-hosted reseller). */
export function setTronsaveFundAddress(address: string | undefined): void {
  if (!address) {
    fundAddress = TRONSAVE_FUND_ADDRESS;
    return;
  }
  assertTronAddress(address, 'fund address');
  fundAddress = address;
}

export function getTronsaveFundAddress(): string {
  return fundAddress;
}

// ─── Market constraints ─────────────────────────────────────────────

/** Smallest sellable energy lot; any shortfall below this is unorderable. */
export const MIN_ENERGY_ORDER = 65_000;

/** Bandwidth is sold in small lots; a tiny gap is not worth an order. */
export const MIN_BANDWIDTH_ORDER = 1_500;

/** 3 days — the default rental window in the supplier docs. */
export const DEFAULT_DURATION_SEC = 259_200;

/** Named price tiers. A tier is resolved by TronSave against its order book. */
export const ENERGY_TIERS = ['SLOW', 'MEDIUM', 'FAST'] as const;
export type EnergyTier = (typeof ENERGY_TIERS)[number];

export type ResourceType = 'ENERGY' | 'BANDWIDTH';

// ─── Size planning (pure) ───────────────────────────────────────────

export interface ResourceGap {
  /** Raw units still needed after the account's own staked resources. */
  shortfall: number;
  /** Units to actually order; 0 when the gap is below the sellable lot. */
  orderAmount: number;
  /** Why nothing is orderable, when orderAmount is 0. */
  skipReason?: 'covered' | 'below-minimum';
}

/**
 * Decide how much resource to buy.
 *
 * Tron charges resources in whole lots: a 40k gap cannot be bought (energy
 * lots start at 65k), and requesting a sub-lot order just wastes a round
 * trip. Returning the *decision* as data keeps the arithmetic testable and
 * stops the UI from inventing its own threshold.
 */
export function planResourcePurchase(
  needed: number,
  available: number,
  minimumOrder: number,
): ResourceGap {
  const shortfall = Math.max(0, Math.ceil(needed) - Math.max(0, Math.floor(available)));
  if (shortfall <= 0) return { shortfall: 0, orderAmount: 0, skipReason: 'covered' };
  if (shortfall < minimumOrder) {
    return { shortfall, orderAmount: 0, skipReason: 'below-minimum' };
  }
  return { shortfall, orderAmount: shortfall };
}

// ─── Estimate ───────────────────────────────────────────────────────

export interface EstimateParams {
  /** the account the resource will be delegated to */
  receiver: string;
  resourceType: ResourceType;
  /** raw resource units (energy or bytes) */
  resourceAmount: number;
  /** rental window in seconds */
  durationSec: number;
  /** a named tier, or an explicit price ceiling in SUN */
  unitPrice: EnergyTier | number;
}

export interface ResourceEstimate {
  /** raw units the supplier can actually deliver */
  availableResource: number;
  durationSec: number;
  /** agreed unit price in SUN */
  unitPriceSun: number;
  /** total the buyer must pay, in SUN — the amount of the TRX transfer */
  estimateTrxSun: string;
}

/** POST body — pure and test-guarded so the field names stay the contract. */
export function buildEstimateBody(params: EstimateParams): Record<string, unknown> {
  assertTronAddress(params.receiver, 'receiver');
  if (params.resourceAmount <= 0) throw new Error('energy estimate needs a positive amount');
  if (params.durationSec <= 0) throw new Error('energy estimate needs a positive duration');
  return {
    receiver: params.receiver,
    resourceType: params.resourceType,
    resourceAmount: Math.floor(params.resourceAmount),
    durationSec: Math.floor(params.durationSec),
    unitPrice: params.unitPrice,
  };
}

/**
 * Narrow the estimate payload. Throws so the caller shows "—" rather than a
 * fabricated price; the fetcher converts that into a hidden offer.
 */
export function parseEstimate(json: unknown): ResourceEstimate {
  const body = json as {
    error?: boolean | string;
    message?: string;
    data?: {
      unitPrice?: number | string;
      durationSec?: number | string;
      estimateTrx?: number | string;
      availableResource?: number | string;
    };
  } | null;

  if (!body || body.error) {
    throw new Error(`energy estimate failed: ${body?.message ?? 'unknown error'}`);
  }
  const data = body.data;
  if (!data) throw new Error('energy estimate returned no data');

  const trx = data.estimateTrx;
  if (trx === undefined || trx === null || !/^\d+$/.test(String(trx))) {
    throw new Error('energy estimate returned no numeric cost');
  }

  return {
    availableResource: Number(data.availableResource ?? 0),
    durationSec: Number(data.durationSec ?? 0),
    unitPriceSun: Number(data.unitPrice ?? 0),
    estimateTrxSun: String(trx),
  };
}

/**
 * Price a rental lot. KEYLESS — the public estimate endpoint needs no key.
 *
 * Returns null when the supplier cannot price the lot, when it cannot deliver
 * the full amount, or on any transport failure.
 */
export async function estimateBuyResource(
  params: EstimateParams,
): Promise<ResourceEstimate | null> {
  try {
    const res = await fetch(`${baseUrl}/v2/estimate-buy-resource`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEstimateBody(params)),
    });
    if (!res.ok) return null;
    const estimate = parseEstimate(await res.json());
    // A partial fill would leave the transfer still burning TRX for the rest,
    // so a lot the book cannot cover is not an offer we may show.
    if (estimate.availableResource < Math.floor(params.resourceAmount)) return null;
    return estimate;
  } catch {
    return null;
  }
}

// ─── Payment intent ─────────────────────────────────────────────────

/**
 * The TRX transfer the buyer signs to pay for a rental.
 *
 * Amount is `estimateTrx` SUN verbatim — not a rounded or recomputed figure:
 * TronSave matches the payment to the order by that exact amount, so an
 * approximation is a payment it will not recognise.
 */
export function buildPaymentIntent(
  estimateTrxSun: string,
  fundAddressOverride?: string,
): TxIntent {
  const to = fundAddressOverride ?? fundAddress;
  assertTronAddress(to, 'fund address');
  if (!/^\d+$/.test(estimateTrxSun) || BigInt(estimateTrxSun) <= 0n) {
    throw new Error('rental payment needs a positive SUN amount');
  }
  return { kind: 'native-transfer', to, amountRaw: estimateTrxSun };
}

// ─── Buy ────────────────────────────────────────────────────────────

/** The signed transaction TronSave broadcasts as the order's payment. */
export interface SignedTxPayload {
  visible: false;
  txID: string;
  raw_data_hex: string;
  raw_data: unknown;
  signature: string[];
}

export interface BuyParams {
  receiver: string;
  resourceType: ResourceType;
  /** SUN, as returned by the estimate — TronSave matches the order on it */
  unitPriceSun: number;
  resourceAmount: number;
  durationSec: number;
}

export interface BuyOptions {
  /** accept a smaller delegation than requested instead of failing */
  allowPartialFill?: boolean;
  /** hard ceiling in SUN; the order fails rather than overpay */
  maxPriceAcceptedSun?: number;
  /** refuse to place the order unless at least this much energy is delegated */
  minResourceDelegateRequiredAmount?: number;
}

export function buildBuyResourceBody(
  params: BuyParams,
  signedTx: SignedTxPayload,
  options: BuyOptions = {},
): Record<string, unknown> {
  assertTronAddress(params.receiver, 'receiver');
  if (params.resourceAmount <= 0) throw new Error('energy order needs a positive amount');
  if (params.durationSec <= 0) throw new Error('energy order needs a positive duration');
  if (!signedTx?.signature?.length) throw new Error('energy order needs a signed payment');

  return {
    resourceType: params.resourceType,
    unitPrice: Math.floor(params.unitPriceSun),
    resourceAmount: Math.floor(params.resourceAmount),
    receiver: params.receiver,
    durationSec: Math.floor(params.durationSec),
    options: {
      allowPartialFill: options.allowPartialFill ?? false,
      // Default the ceiling to the agreed unit price: the order must not pay
      // more than the number the user was shown and agreed to.
      maxPriceAccepted: options.maxPriceAcceptedSun ?? Math.floor(params.unitPriceSun),
      ...(options.minResourceDelegateRequiredAmount !== undefined
        ? { minResourceDelegateRequiredAmount: options.minResourceDelegateRequiredAmount }
        : {}),
    },
    // Only sent when configured: an empty sponsor would be a malformed field,
    // and an unattributed order still succeeds.
    ...(sponsorCode ? { sponsor: sponsorCode } : {}),
    signedTx,
  };
}

export interface BuyOrderAck {
  orderId: string;
}

/** Narrow the buy response. Business failures arrive as HTTP 200 + error:true. */
export function parseBuyOrder(json: unknown): BuyOrderAck {
  const body = json as {
    error?: boolean | string;
    message?: string;
    data?: { orderId?: string };
  } | null;

  if (!body || body.error) {
    throw new Error(`energy order failed: ${body?.message ?? 'unknown error'}`);
  }
  const orderId = body.data?.orderId;
  if (!orderId) throw new Error('energy order returned no orderId');
  return { orderId };
}

/**
 * Place a rental order against an already-signed payment.
 *
 * No API key: the signed transaction IS the authentication. Returns null on any
 * failure — a failed order leaves the user with an unbroadcast, expiring
 * signature and no money moved, so there is nothing to roll back.
 */
export async function buyResource(
  params: BuyParams,
  signedTx: SignedTxPayload,
  options: BuyOptions = {},
): Promise<BuyOrderAck | null> {
  try {
    const res = await fetch(`${baseUrl}/v2/buy-resource`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBuyResourceBody(params, signedTx, options)),
    });
    if (!res.ok) return null;
    return parseBuyOrder(await res.json());
  } catch {
    return null;
  }
}

// ─── Order status ───────────────────────────────────────────────────

export interface ResourceDelegation {
  delegator: string;
  amount: number;
  txid: string;
}

export interface ResourceOrder {
  orderId: string;
  /** 0-100 */
  fulfilledPercent: number;
  remainAmount: number;
  payoutAmount: number;
  delegates: ResourceDelegation[];
}

export function parseResourceOrder(json: unknown): ResourceOrder {
  const body = json as {
    error?: boolean | string;
    message?: string;
    data?: {
      orderId?: string;
      fulfilledPercent?: number | string;
      remainAmount?: number | string;
      payoutAmount?: number | string;
      delegates?: Array<{ delegator?: string; amount?: number | string; txid?: string }>;
    };
  } | null;

  if (!body || body.error) {
    throw new Error(`energy order status failed: ${body?.message ?? 'unknown error'}`);
  }
  const data = body.data;
  if (!data) throw new Error('energy order status returned no data');

  return {
    orderId: data.orderId ?? '',
    fulfilledPercent: Number(data.fulfilledPercent ?? 0),
    remainAmount: Number(data.remainAmount ?? 0),
    payoutAmount: Number(data.payoutAmount ?? 0),
    delegates: (data.delegates ?? []).map(d => ({
      delegator: d.delegator ?? '',
      amount: Number(d.amount ?? 0),
      txid: d.txid ?? '',
    })),
  };
}

/** Poll one order. null when it cannot be read (network, unknown id). */
export async function fetchResourceOrder(orderId: string): Promise<ResourceOrder | null> {
  if (!orderId) return null;
  try {
    const res = await fetch(`${baseUrl}/v2/order/${encodeURIComponent(orderId)}`);
    if (!res.ok) return null;
    return parseResourceOrder(await res.json());
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Base58check TRON address (T + 33 bytes). Kept local rather than imported
 * from ./address.js so this module stays dependency-free and testable in
 * isolation — the shape is the only thing the API validates.
 */
function assertTronAddress(address: string, field: string): void {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    throw new Error(`${field} must be a base58 TRON address`);
  }
}
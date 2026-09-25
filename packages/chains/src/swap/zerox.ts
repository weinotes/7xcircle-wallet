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
 * 0x Swap API v2 client — the EVM half of the P1 Swap revenue line.
 *
 * Where Solana routes through Jupiter (see ../solana/jupiter.ts), BSC and
 * Ethereum route through 0x's AllowanceHolder flow:
 *
 *   GET /swap/allowance-holder/quote  → a ready-to-send `transaction`
 *   (EVM ERC20 sells additionally need an `approve` to issues.allowance.spender)
 *
 * Revenue: `swapFeeRecipient` + `swapFeeBps` (0-1000 = 0-10%) are passed to
 * 0x, and `swapFeeToken` (which MUST be the buy or sell token) names the asset
 * the fee is skimmed in. The fee wallet is a plain public config value; the
 * user's key never leaves the device and 0x never custodies anything.
 *
 * ⚠ KEY EXPOSURE, NOT CORS. 0x answers browser origins (`Access-Control-
 * Allow-Origin: *`), so a direct call from the page works — verified against
 * the live API. The problem is that a Vite build inlines VITE_ZEROX_API_KEY
 * into the bundle, so anyone can lift it and burn the account's quota. Calling
 * the default host with a key in the bundle is acceptable for LOCAL
 * DEVELOPMENT only. Production should route through a thin gateway (a
 * Cloudflare Worker holding the key, or the extension's background page) and
 * point this module at it with setZeroExBaseUrl.
 *
 * DEGRADATION: with no key every fetch returns null and the Swap page hides
 * the EVM route — "no quote" is never a price.
 */

// ─── Endpoint + credential config ───────────────────────────────────

const DEFAULT_BASE = 'https://api.0x.org';

let baseUrl = DEFAULT_BASE;
let apiKey: string | undefined;

/** Point at a proxy / self-hosted gateway; undefined resets the default. */
export function setZeroExBaseUrl(url: string | undefined): void {
  baseUrl = url && url.length > 0 ? url : DEFAULT_BASE;
}

export function getZeroExBaseUrl(): string {
  return baseUrl;
}

/** Install the 0x API key. Pass undefined to disable EVM swaps. */
export function setZeroExApiKey(key: string | undefined): void {
  apiKey = key && key.length > 0 ? key : undefined;
}

/** Whether 0x quoting is usable — the Swap page gates the EVM route on this. */
export function hasZeroExKey(): boolean {
  return apiKey !== undefined;
}

/** Chains 0x serves that we also support (decimal ids). */
export const ZEROX_CHAIN_IDS: readonly number[] = [1, 56, 137, 42161, 10, 8453, 43114];

/** 0x's own slippage ceiling, in basis points. */
export const MAX_SLIPPAGE_BPS = 10_000;
/** 0x's own integrator-fee ceiling, in basis points (10%). */
export const MAX_SWAP_FEE_BPS = 1_000;

// ─── Quote request ──────────────────────────────────────────────────

export interface ZeroExQuoteParams {
  /** decimal EVM chain id (1 Ethereum, 56 BSC, …) */
  chainId: number;
  sellToken: string;
  buyToken: string;
  /** sell amount in raw base units */
  sellAmountRaw: string;
  /** the user's own address — 0x shapes allowances/simulation around it */
  taker: string;
  slippageBps?: number;
  /** OUR fee wallet (EVM address); omit to quote fee-free */
  swapFeeRecipient?: string;
  swapFeeBps?: number;
  /** asset the fee is taken in — MUST be the buy or sell token */
  swapFeeToken?: string;
  /** address that submits the tx (differs from taker only for meta-tx) */
  txOrigin?: string;
  /** ask 0x to spend the whole balance (used by the "MAX" button) */
  sellEntireBalance?: boolean;
}

export function buildZeroExQuoteUrl(params: ZeroExQuoteParams, base = baseUrl): string {
  assertEvmAddress(params.sellToken, 'sellToken');
  assertEvmAddress(params.buyToken, 'buyToken');
  assertEvmAddress(params.taker, 'taker');
  if (!ZEROX_CHAIN_IDS.includes(params.chainId)) {
    throw new Error(`0x does not serve chain ${params.chainId}`);
  }
  if (!/^\d+$/.test(params.sellAmountRaw) || BigInt(params.sellAmountRaw) <= 0n) {
    throw new Error('0x sellAmount must be a positive integer of raw units');
  }

  const slippageBps = params.slippageBps ?? 100;
  assertBps(slippageBps, 'slippageBps', MAX_SLIPPAGE_BPS);

  const q = new URLSearchParams({
    chainId: String(params.chainId),
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmountRaw,
    taker: params.taker,
    slippageBps: String(slippageBps),
  });

  if (params.swapFeeBps) {
    if (!params.swapFeeRecipient) {
      throw new Error('0x swapFeeRecipient is required when swapFeeBps is set');
    }
    assertEvmAddress(params.swapFeeRecipient, 'swapFeeRecipient');
    assertBps(params.swapFeeBps, 'swapFeeBps', MAX_SWAP_FEE_BPS);

    // 0x only accepts the buy or the sell side as the fee asset; defaulting to
    // the buy token keeps the fee in the token the user actually wanted.
    const feeToken = params.swapFeeToken ?? params.buyToken;
    if (!sameAddress(feeToken, params.buyToken) && !sameAddress(feeToken, params.sellToken)) {
      throw new Error('0x swapFeeToken must be the buy or the sell token');
    }

    q.set('swapFeeRecipient', params.swapFeeRecipient);
    q.set('swapFeeBps', String(params.swapFeeBps));
    q.set('swapFeeToken', feeToken);
  }

  if (params.txOrigin) {
    assertEvmAddress(params.txOrigin, 'txOrigin');
    q.set('txOrigin', params.txOrigin);
  }
  if (params.sellEntireBalance) q.set('sellEntireBalance', 'true');

  return `${base}/swap/allowance-holder/quote?${q.toString()}`;
}

// ─── Quote response ─────────────────────────────────────────────────

/** The broadcastable transaction 0x hands back. */
export interface ZeroExTransaction {
  to: string;
  data: string;
  /** native value in wei, as 0x returns it (decimal string) */
  value: string;
  gas?: string;
  gasPrice?: string;
}

export interface ZeroExQuote {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  /** the quote's own slippage-adjusted floor */
  minBuyAmount: string;
  /** false = the route is stale/dry; the UI must not offer a swap */
  liquidityAvailable: boolean;
  /**
   * Percent, e.g. 0.42 = 0.42%. Undefined when 0x omits it — which is the
   * normal case on v2: the live allowance-holder response carries no
   * `priceImpact`/`estimatedPriceImpact` field at all (verified 2026-09), so
   * the EVM price-impact line simply does not render.
   */
  priceImpactPct?: number;
  /** integrator fee 0x will take on our behalf, in the fee token's units */
  integratorFee?: { amount: string; token: string; recipient: string };
  /** present only when the ERC20 needs an approve to this spender */
  approval?: { token: string; spender: string; amountRaw: string };
  /** true when the taker's balance cannot cover the sell side */
  insufficientBalance: boolean;
  /** true when 0x could not simulate the route (still usually sendable) */
  simulationIncomplete: boolean;
  transaction: ZeroExTransaction;
  /** opaque — kept for debugging, never rendered */
  raw: unknown;
}

export function parseZeroExQuote(json: unknown): ZeroExQuote {
  const body = json as {
    sellToken?: string;
    buyToken?: string;
    sellAmount?: string;
    buyAmount?: string;
    minBuyAmount?: string;
    liquidityAvailable?: boolean;
    priceImpact?: number | string;
    estimatedPriceImpact?: number | string;
    totalNetworkFee?: string;
    fees?: { integratorFee?: { amount?: string; token?: string; recipient?: string } };
    issues?: {
      allowance?: { actual?: string; spender?: string } | null;
      balance?: { actual?: string; expected?: string } | null;
      simulationIncomplete?: boolean;
    };
    transaction?: { to?: string; data?: string; value?: string; gas?: string; gasPrice?: string };
    reason?: string;
    message?: string;
  } | null;

  if (!body) throw new Error('0x quote failed: empty response');

  const tx = body.transaction;
  if (!tx?.to || !tx.data) {
    throw new Error(`0x quote failed: ${body.reason ?? body.message ?? 'no transaction'}`);
  }
  if (!body.sellAmount || !body.buyAmount) {
    throw new Error('0x quote failed: missing amounts');
  }

  const rawImpact = body.priceImpact ?? body.estimatedPriceImpact;
  const impact = rawImpact === undefined ? undefined : Number(rawImpact);

  const integrator = body.fees?.integratorFee;
  const allowance = body.issues?.allowance;

  return {
    sellToken: body.sellToken ?? '',
    buyToken: body.buyToken ?? '',
    sellAmount: body.sellAmount,
    buyAmount: body.buyAmount,
    minBuyAmount: body.minBuyAmount ?? body.buyAmount,
    liquidityAvailable: body.liquidityAvailable !== false,
    ...(impact !== undefined && Number.isFinite(impact) ? { priceImpactPct: impact } : {}),
    ...(integrator?.amount && integrator.token
      ? {
          integratorFee: {
            amount: integrator.amount,
            token: integrator.token,
            recipient: integrator.recipient ?? '',
          },
        }
      : {}),
    // 0x reports an allowance issue with the EXACT spender to approve; when
    // the spender is absent there is nothing to approve.
    ...(allowance?.spender
      ? {
          approval: {
            token: body.sellToken ?? '',
            spender: allowance.spender,
            // approve the sell amount by default; callers may widen to MAX
            amountRaw: body.sellAmount,
          },
        }
      : {}),
    insufficientBalance: body.issues?.balance != null,
    simulationIncomplete: body.issues?.simulationIncomplete === true,
    transaction: {
      to: tx.to,
      data: tx.data,
      value: tx.value ?? '0',
      ...(tx.gas ? { gas: tx.gas } : {}),
      ...(tx.gasPrice ? { gasPrice: tx.gasPrice } : {}),
    },
    raw: json,
  };
}

// ─── Fetchers ───────────────────────────────────────────────────────

/**
 * Fetch a 0x quote. Returns null without a key or on any transport failure —
 * a browser CORS rejection lands here too, which is exactly the "hide the EVM
 * route" outcome the caller wants.
 */
export async function fetchZeroExQuote(params: ZeroExQuoteParams): Promise<ZeroExQuote | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch(buildZeroExQuoteUrl(params), {
      headers: {
        Accept: 'application/json',
        '0x-api-key': apiKey,
        '0x-version': 'v2',
      },
    });
    if (!res.ok) return null;
    return parseZeroExQuote(await res.json());
  } catch {
    return null;
  }
}

// ─── Intent mapping ─────────────────────────────────────────────────

/**
 * A chain-agnostic intent for a 0x quote.
 *
 * Returned as plain data (not a TxIntent literal) so the shared package need
 * not import the swap module; the shape matches `TxIntent`'s `contract-call`
 * and optional `approve` exactly, and adapters compile it untouched.
 */
export interface ZeroExIntents {
  swap: { kind: 'contract-call'; to: string; data: string; valueRaw: string };
  /** present only when the ERC20 needs approving first */
  approve?: { kind: 'approve'; token: string; spender: string; amountRaw: string };
}

export function zeroExQuoteToIntents(quote: ZeroExQuote): ZeroExIntents {
  return {
    swap: {
      kind: 'contract-call',
      to: quote.transaction.to,
      data: quote.transaction.data,
      valueRaw: quote.transaction.value,
    },
    ...(quote.approval
      ? {
          approve: {
            kind: 'approve' as const,
            token: quote.approval.token,
            spender: quote.approval.spender,
            amountRaw: quote.approval.amountRaw,
          },
        }
      : {}),
  };
}

// ─── Curated token registry ─────────────────────────────────────────

/**
 * 0x addresses the native coin with a sentinel rather than the zero address —
 * a real transfer to it would burn funds, so the string is load-bearing.
 */
export const ZEROX_NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/** One swappable EVM asset as the Swap page needs it (no chain metadata). */
export interface EvmSwapToken {
  /** contract address, or ZEROX_NATIVE_TOKEN for the gas coin */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isNative: boolean;
}

/**
 * The pair universe offered per chain: the native coin plus the stablecoins
 * users actually hold. Deliberately curated, not discovered — an unknown
 * address pasted by the user is served by the custom-address input, and a
 * wrong curated address would silently swap the wrong asset.
 *
 * Addresses are lowercase; 0x is case-insensitive and lowercase sidesteps
 * checksum drift.
 */
export const EVM_SWAP_TOKENS: Record<number, EvmSwapToken[]> = {
  1: [
    { address: ZEROX_NATIVE_TOKEN, symbol: 'ETH', name: 'Ether', decimals: 18, isNative: true },
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6, isNative: false },
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', name: 'USD Coin', decimals: 6, isNative: false },
    { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, isNative: false },
    { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, isNative: false },
  ],
  56: [
    { address: ZEROX_NATIVE_TOKEN, symbol: 'BNB', name: 'BNB', decimals: 18, isNative: true },
    { address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT', name: 'Tether USD (BSC)', decimals: 18, isNative: false },
    { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC', name: 'USD Coin (BSC)', decimals: 18, isNative: false },
    { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18, isNative: false },
  ],
  137: [
    { address: ZEROX_NATIVE_TOKEN, symbol: 'POL', name: 'Polygon Ecosystem Token', decimals: 18, isNative: true },
    { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', symbol: 'USDT', name: 'Tether USD (Polygon)', decimals: 6, isNative: false },
    { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', symbol: 'USDC', name: 'USD Coin (Polygon)', decimals: 6, isNative: false },
  ],
  42161: [
    { address: ZEROX_NATIVE_TOKEN, symbol: 'ETH', name: 'Ether', decimals: 18, isNative: true },
    { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', name: 'Tether USD (Arbitrum)', decimals: 6, isNative: false },
    { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', name: 'USD Coin (Arbitrum)', decimals: 6, isNative: false },
    { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', name: 'Wrapped Ether (Arbitrum)', decimals: 18, isNative: false },
  ],
  10: [
    { address: ZEROX_NATIVE_TOKEN, symbol: 'ETH', name: 'Ether', decimals: 18, isNative: true },
    { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', symbol: 'USDT', name: 'Tether USD (Optimism)', decimals: 6, isNative: false },
    { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC', name: 'USD Coin (Optimism)', decimals: 6, isNative: false },
  ],
  8453: [
    { address: ZEROX_NATIVE_TOKEN, symbol: 'ETH', name: 'Ether', decimals: 18, isNative: true },
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', name: 'USD Coin (Base)', decimals: 6, isNative: false },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether (Base)', decimals: 18, isNative: false },
  ],
  43114: [
    { address: ZEROX_NATIVE_TOKEN, symbol: 'AVAX', name: 'Avalanche', decimals: 18, isNative: true },
    { address: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', symbol: 'USDT', name: 'Tether USD (Avalanche)', decimals: 6, isNative: false },
    { address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', symbol: 'USDC', name: 'USD Coin (Avalanche)', decimals: 6, isNative: false },
  ],
};

/** Tokens we offer on a chain; empty when 0x does not serve it. */
export function getEvmSwapTokens(chainId: number): EvmSwapToken[] {
  return EVM_SWAP_TOKENS[chainId] ?? [];
}

// ─── Helpers ────────────────────────────────────────────────────────

function assertEvmAddress(address: string, field: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`${field} must be a 0x EVM address`);
  }
}

function assertBps(value: number, field: string, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${field} must be an integer between 0 and ${max}`);
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
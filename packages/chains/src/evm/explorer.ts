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
 * Block Explorer API client — Etherscan-compatible JSON-RPC style endpoints.
 *
 * Almost every EVM block explorer (Etherscan, BscScan, PolygonScan,
 * Arbiscan, Snowtrace, Basescan, Optimistic Etherscan...) exposes the
 * same API shape:
 *
 *   GET {explorer}/api?module=account&action=txlist&address=...&page=1&offset=50
 *
 * This client wraps that contract + a few common endpoints, plus
 * optional API-key authentication.
 */

// ─── Explorer API URL resolution ────────────────────────────────────
//
// Each explorer has a fixed API path. The public-facing URL in the
// chain config (e.g. "https://bscscan.com") is NOT the API base.
// We map each known explorer root to its API endpoint prefix.

interface ExplorerApiEndpoint {
  /** Human-readable explorer name */
  label: string;
  /** Base URL for API calls (NO trailing slash) */
  apiBase: string;
}

/**
 * Map a public explorer URL (from ChainConfig) to its API endpoint.
 * Covers all chains we support. Unknown explorers are handled by
 * deriving /api from the public URL — works for most major ones.
 */
function resolveExplorerApi(publicUrl: string): ExplorerApiEndpoint {
  const lower = publicUrl.toLowerCase();

  // ⚠️ ORDER MATTERS: 'optimistic.etherscan' must be checked BEFORE the
  // generic 'etherscan' rule — 'optimistic.etherscan.io' also contains
  // 'etherscan', so the generic rule would win and Optimism history would
  // silently query api.etherscan.io (Ethereum mainnet data).
  if (lower.includes('optimistic.etherscan')) {
    return { label: 'Optimistic', apiBase: 'https://api-optimistic.etherscan.io' };
  }
  // Known explorers with a fixed /api path
  if (lower.includes('etherscan')) {
    return { label: 'Etherscan', apiBase: `https://api${lower.includes('testnet') ? '-testnet' : ''}.etherscan.io` };
  }
  if (lower.includes('bscscan')) {
    return { label: 'BscScan', apiBase: lower.includes('testnet') ? 'https://api-testnet.bscscan.com' : 'https://api.bscscan.com' };
  }
  if (lower.includes('polygonscan')) {
    return { label: 'PolygonScan', apiBase: lower.includes('testnet') ? 'https://api-testnet.polygonscan.com' : 'https://api.polygonscan.com' };
  }
  if (lower.includes('arbiscan')) {
    return { label: 'Arbiscan', apiBase: 'https://api.arbiscan.io' };
  }
  if (lower.includes('basescan')) {
    return { label: 'BaseScan', apiBase: 'https://api.basescan.org' };
  }
  if (lower.includes('snowtrace')) {
    return { label: 'Snowtrace', apiBase: 'https://api.snowtrace.io' };
  }

  // Generic fallback — try /api path
  return { label: 'Explorer', apiBase: `${publicUrl.replace(/\/$/, '')}/api` };
}

// ─── Response types ─────────────────────────────────────────────────

interface ExplorerBaseResponse {
  status: '1' | '0';
  message: string;
}

export interface ExplorerNativeTx {
  blockNumber: string;
  timeStamp: string;          // unix seconds
  hash: string;
  nonce: string;
  blockHash: string;
  transactionIndex: string;
  from: string;
  to: string;
  value: string;              // wei
  gas: string;
  gasPrice: string;
  isError: '0' | '1';         // 0 = success, 1 = failed
  txreceipt_status?: string;  // '1' confirmed, '0' failed, undefined = pending
  input: string;
  contractAddress?: string;   // if this tx created a contract
  cumulativeGasUsed?: string;
  gasUsed?: string;
  confirmations?: string;
}

export interface ExplorerTokenTx extends ExplorerNativeTx {
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimal?: string;      // e.g. "18"
  contractAddress?: string;   // the ERC20 contract
  // value field is in token's smallest unit
}

/** Shape returned by Explorer `tokenbalance` wildcard query */
interface ExplorerTokenBalance {
  TokenAddress: string;
  TokenName: string;
  TokenSymbol: string;
  TokenDecimal: string;
  Balance: string;
}

// ─── HTTP layer ─────────────────────────────────────────────────────

export interface ExplorerClientOptions {
  /** Public explorer URL, e.g. "https://bscscan.com" */
  explorerUrl: string;
  /** Decimal chain ID (e.g. 56 for BSC) — enables Etherscan API V2 (multi-chain) */
  chainIdDecimal?: number;
  /** Optional API key (major explorers limit unauthenticated calls to ~5/sec) */
  apiKey?: string;
  /** Max requests per second; default 4 (safe for free tier) */
  rateLimitRps?: number;
  /** Request timeout in ms; default 15000 */
  timeoutMs?: number;
}

/** Raised when the Etherscan V2 plan does not cover the requested chain. */
class ExplorerCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExplorerCoverageError';
  }
}

/**
 * Runtime Etherscan-V2 API key — browsers cannot read process.env and
 * bundlers differ, so apps call setExplorerApiKey(...) at startup (e.g.
 * from import.meta.env) instead of relying on the build-time probe.
 */
let runtimeApiKey: string | undefined;

export function setExplorerApiKey(key: string | undefined): void {
  runtimeApiKey = key && key.length > 0 ? key : undefined;
}

export function getExplorerApiKey(): string | undefined {
  return runtimeApiKey;
}

/** Thin queue to rate-limit concurrent explorer calls */
class RateLimiter {
  private readonly minInterval: number;
  private lastCall = 0;

  constructor(rps: number) {
    this.minInterval = 1000 / Math.max(1, rps);
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - elapsed));
    }
    this.lastCall = Date.now();
  }
}

/** Generic explorer API client — etherscan-compatible endpoints */
export class ExplorerClient {
  private readonly endpoint: ExplorerApiEndpoint;
  private readonly apiKey?: string;
  private readonly limiter: RateLimiter;
  private readonly timeoutMs: number;
  /** Decimal chain id for Etherscan API V2 — undefined disables V2 */
  private readonly chainIdDecimal?: number;
  /** Whether V2 is still worth trying (flips false on plan-coverage errors) */
  private v2Available: boolean;
  /** Legacy V1 api base (per-explorer), used as V2 fallback */
  private readonly v1Base: string;

  constructor(opts: ExplorerClientOptions) {
    this.endpoint = resolveExplorerApi(opts.explorerUrl);
    this.apiKey = opts.apiKey ?? runtimeApiKey;
    this.limiter = new RateLimiter(opts.rateLimitRps ?? 4);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.chainIdDecimal = opts.chainIdDecimal;
    this.v2Available = opts.chainIdDecimal !== undefined;
    this.v1Base = this.endpoint.apiBase;
  }

  /** Derive explorer page URL for a given tx hash */
  public txUrl(txHash: string): string {
    const base = this.endpoint.label === 'Explorer'
      ? this.endpoint.apiBase.replace(/\/api$/, '')
      : this.basePublicUrl();
    return `${base}/tx/${txHash}`;
  }

  /** Derive explorer page URL for a given address */
  public addressUrl(address: string): string {
    return `${this.basePublicUrl()}/address/${address}`;
  }

  // ─── Core fetch ──────────────────────────────────────────────────

  private basePublicUrl(): string {
    // e.g. "https://api.bscscan.com" → "https://bscscan.com"
    // and "https://api-testnet.bscscan.com" → "https://testnet.bscscan.com"
    const url = new URL(this.endpoint.apiBase);
    let hostname = url.hostname;
    hostname = hostname.replace(/^api-testnet\./, 'testnet.');
    hostname = hostname.replace(/^api\./, '');
    hostname = hostname.replace(/^api-optimistic\./, 'optimistic.');
    return `${url.protocol}//${hostname}`;
  }

  private async call(
    params: Record<string, string | number>,
  ): Promise<ExplorerBaseResponse & { result: unknown }> {
    await this.limiter.wait();

    if (this.v2Available) {
      try {
        return await this.callV2(params);
      } catch (err) {
        // Plan does not cover this chain (free tier covers only a few
        // mainnets) — permanently fall back to the legacy V1 endpoint.
        if (err instanceof ExplorerCoverageError) {
          this.v2Available = false;
          return this.callV1(params);
        }
        throw err;
      }
    }
    return this.callV1(params);
  }

  /** Etherscan API V2 — one endpoint for every chain, keyed by chainid */
  private async callV2(
    params: Record<string, string | number>,
  ): Promise<ExplorerBaseResponse & { result: unknown }> {
    const url = new URL('https://api.etherscan.io/v2/api');
    url.searchParams.set('chainid', String(this.chainIdDecimal));
    url.searchParams.set('module', String(params.module));
    url.searchParams.set('action', String(params.action));
    for (const [k, v] of Object.entries(params)) {
      if (k !== 'module' && k !== 'action') {
        url.searchParams.set(k, String(v));
      }
    }
    if (this.apiKey) {
      url.searchParams.set('apikey', this.apiKey);
    }

    const resp = await this.fetchJson(url);

    // Plan-coverage failures mean "this chain is not on our V2 tier" —
    // signal the caller to fall back to V1, not a hard error.
    if (
      resp.status === '0' &&
      /free api access is not supported|missing\/invalid api key/i.test(
        String(resp.result ?? resp.message),
      )
    ) {
      throw new ExplorerCoverageError(
        `[Etherscan V2] ${String(resp.result ?? resp.message)}`,
      );
    }

    return resp;
  }

  /** Legacy V1 — per-explorer endpoint (module=account&action=...) */
  private async callV1(
    params: Record<string, string | number>,
  ): Promise<ExplorerBaseResponse & { result: unknown }> {
    const url = new URL(this.v1Base);
    url.searchParams.set('module', String(params.module));
    url.searchParams.set('action', String(params.action));
    for (const [k, v] of Object.entries(params)) {
      if (k !== 'module' && k !== 'action') {
        url.searchParams.set(k, String(v));
      }
    }
    if (this.apiKey) {
      url.searchParams.set('apikey', this.apiKey);
    }
    return this.fetchJson(url);
  }

  private async fetchJson(
    url: URL,
  ): Promise<ExplorerBaseResponse & { result: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Explorer HTTP ${res.status}: ${this.endpoint.label}`);
      }
      return (await res.json()) as ExplorerBaseResponse & { result: unknown };
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── High-level endpoints ────────────────────────────────────────

  /**
   * Fetch native-token (ETH/BNB/etc.) transactions for an address.
   * Returns at most `maxCount` records across paginated calls.
   *
   * Only successful transactions are returned by default (isError=0).
   */
  async getNativeTransactions(
    address: string,
    maxCount = 50,
  ): Promise<ExplorerNativeTx[]> {
    const all: ExplorerNativeTx[] = [];
    let page = 1;
    const pageSize = Math.min(maxCount, 50);
    let keepGoing = true;

    while (keepGoing && all.length < maxCount) {
      const resp = await this.call({
        module: 'account',
        action: 'txlist',
        address,
        startblock: 0,
        endblock: 'latest',
        page,
        offset: pageSize,
        sort: 'desc',
      });

      if (resp.status !== '1') {
        // "No transactions found" — that's fine, empty list
        if (
          resp.message.includes('No records') ||
          resp.result === 'No transactions found' ||
          (Array.isArray(resp.result) && resp.result.length === 0)
        ) {
          break;
        }
        throw new Error(`Explorer error [${this.endpoint.label}]: ${resp.message}`);
      }

      const batch = resp.result as ExplorerNativeTx[];
      all.push(...batch);

      if (batch.length < pageSize) {
        keepGoing = false;   // last page
      }
      page++;
    }

    return all.slice(0, maxCount);
  }

  /**
   * Fetch ERC20 token transfers for an address.
   * Same pagination behavior as getNativeTransactions.
   */
  async getTokenTransactions(
    address: string,
    maxCount = 30,
  ): Promise<ExplorerTokenTx[]> {
    const resp = await this.call({
      module: 'account',
      action: 'tokentx',
      address,
      page: 1,
      offset: maxCount,
      sort: 'desc',
    });

    if (resp.status !== '1') {
      if (
        resp.message.includes('No records') ||
        resp.result === 'No transactions found' ||
        (Array.isArray(resp.result) && resp.result.length === 0)
      ) {
        return [];
      }
      throw new Error(`Explorer error [${this.endpoint.label}]: ${resp.message}`);
    }

    return (resp.result as ExplorerTokenTx[]).slice(0, maxCount);
  }

  /**
   * Fetch ALL transactions — native + ERC20 token — merged and sorted.
   * Returns up to `maxCount` records, sorted newest first.
   */
  async getAllTransactions(
    address: string,
    maxCount = 50,
  ): Promise<ExplorerNativeTx[]> {
    const [native, tokens] = await Promise.all([
      this.getNativeTransactions(address, maxCount),
      this.getTokenTransactions(address, Math.min(maxCount, 30)),
    ]);

    const all = [...native, ...tokens.map(t => t as ExplorerNativeTx)];
    // Sort by block timestamp descending
    all.sort((a, b) => Number(b.timeStamp) - Number(a.timeStamp));
    return all.slice(0, maxCount);
  }

  // ─── Token balances ───────────────────────────────────────────────

  /**
   * Fetch ALL ERC20 token balances for an address via `tokenbalance`
   * with `contractaddress=0x0000000000000000000000000000000000000000`.
   *
   * All major explorers (Etherscan, BscScan, PolygonScan) support this
   * "multi-balance" endpoint. Unknown explorers → returns [].
   *
   * Each balance also includes a single native-token query so callers
   * get the full portfolio from one call site.
   */
  async getAllBalances(
    address: string,
    nativeSymbol: string,
    nativeDecimals: number,
  ): Promise<{
    native: { symbol: string; decimals: number; balance: string };
    tokens: ExplorerTokenBalance[];
  }> {
    // 1) Native balance — direct RPC call wrapped by explorer
    //    We use `balance` action which is always supported.
    let nativeBalance = '0';
    try {
      const nativeResp = await this.call({
        module: 'account',
        action: 'balance',
        address,
        tag: 'latest',
      });
      if (nativeResp.status === '1' && typeof nativeResp.result === 'string') {
        nativeBalance = nativeResp.result;
      }
    } catch {
      // Explorer down — native balance will be fetched from RPC by caller
    }

    // 2) ERC20 token list — contractaddress=0x000... means "all tokens"
    let tokens: ExplorerTokenBalance[] = [];
    try {
      const tokenResp = await this.call({
        module: 'account',
        action: 'tokenbalance',
        address,
        contractaddress: '0x0000000000000000000000000000000000000000',
        tag: 'latest',
      });
      if (tokenResp.status === '1' && Array.isArray(tokenResp.result)) {
        tokens = tokenResp.result as ExplorerTokenBalance[];
      }
    } catch {
      // Explorer may not support the wildcard contractaddress — that's OK
    }

    // Filter out zero-balances (explorers often return every token ever held)
    tokens = tokens.filter(t => t.Balance !== '0' && t.Balance !== '');

    return {
      native: { symbol: nativeSymbol, decimals: nativeDecimals, balance: nativeBalance },
      tokens,
    };
  }
}

/** Exported for unit tests */
export { resolveExplorerApi };

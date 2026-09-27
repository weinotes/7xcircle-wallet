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
 * Tests for the MV3 background broker.
 *
 * background.ts exports nothing and registers its runtime listeners at import
 * time, so the broker can only be driven the way Chrome drives it: stub the
 * API surface, import the module fresh, then invoke the listener it registered.
 * No production code is changed to make this testable.
 *
 * What's covered here is the *wiring* — the gating decisions themselves live in
 * packages/core/src/dapp/protocol.ts and are already covered by protocol.test.ts.
 * These tests protect the assembly around them, which is where a refactor can
 * silently widen the dApp surface.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

type MessageListener = (
  message: unknown,
  sender: { url?: string; tab?: { id?: number } },
  respond: (response: unknown) => void,
) => boolean;

interface ChromeStub {
  store: Record<string, unknown>;
  listeners: MessageListener[];
}

const KEYS = {
  perms: 'dapp:permissions',
  accounts: 'dapp:accounts',
  chainId: 'dapp:chainId',
} as const;

const ORIGIN = 'https://app.example';
const ADDRESS = '0x1111111111111111111111111111111111111111';
const ACTIVE_CHAIN = '0x38';

const GRANT = [{ origin: ORIGIN, chainIds: [ACTIVE_CHAIN], grantedAt: 1 }];
const ACCOUNTS = { [ORIGIN]: [ADDRESS] };

/**
 * Minimal chrome surface used by background.ts. `storage.local.get` resolves
 * like the real promise-form API (returns a keyed object, not the raw value).
 */
function createChrome(initial: Record<string, unknown> = {}): ChromeStub {
  const store: Record<string, unknown> = { ...initial };
  const listeners: MessageListener[] = [];

  const chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          Object.assign(store, patch);
        }),
      },
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn((_tabId: number, _msg: unknown, cb?: () => void) => cb?.()),
    },
    runtime: {
      lastError: undefined,
      onMessage: { addListener: (fn: MessageListener) => void listeners.push(fn) },
      onConnect: { addListener: vi.fn() },
    },
  };

  vi.stubGlobal('chrome', chrome);
  return { store, listeners };
}

/** Import a fresh copy of background.ts under a new chrome stub. */
async function loadBroker(initial: Record<string, unknown> = {}): Promise<ChromeStub> {
  const stub = createChrome(initial);
  vi.resetModules();
  await import('./background.js');
  if (stub.listeners.length === 0) throw new Error('background registered no onMessage listener');
  return stub;
}

/** Drive one dapp:rpc through the broker and resolve with its reply. */
function callRpc(
  stub: ChromeStub,
  method: string,
  url: string | undefined,
  id = 1,
): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    stub.listeners[0](
      { type: 'dapp:rpc', id, method, params: [] },
      url === undefined ? {} : { url },
      resolve as (r: unknown) => void,
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('background origin gate', () => {
  it('rejects non-web schemes', async () => {
    const stub = await loadBroker();
    for (const url of [
      'chrome://extensions/',
      'file:///tmp/page.html',
      'data:text/html,<b>x</b>',
      'about:blank',
    ]) {
      const res = await callRpc(stub, 'eth_chainId', url);
      expect(res.error, `expected ${url} to be refused`).toMatchObject({ code: 4100 });
    }
  });

  it('rejects a sender that carries no url', async () => {
    const stub = await loadBroker();
    const res = await callRpc(stub, 'eth_chainId', undefined);
    expect(res.error).toMatchObject({ code: 4100 });
  });

  it('rejects an unparseable url', async () => {
    const stub = await loadBroker();
    const res = await callRpc(stub, 'eth_chainId', 'not a url');
    expect(res.error).toMatchObject({ code: 4100 });
  });

  it('accepts https origins and answers them', async () => {
    const stub = await loadBroker({ [KEYS.chainId]: ACTIVE_CHAIN });
    const res = await callRpc(stub, 'eth_chainId', `${ORIGIN}/swap`);
    expect(res.error).toBeUndefined();
    expect(res.result).toBe(ACTIVE_CHAIN);
  });

  it('accepts loopback http origins for local dApp development', async () => {
    const stub = await loadBroker({ [KEYS.chainId]: ACTIVE_CHAIN });
    for (const url of [
      'http://localhost:5173/app',
      'http://127.0.0.1:8545/',
      'http://[::1]:5173/',
    ]) {
      const res = await callRpc(stub, 'eth_chainId', url);
      expect(res.error, `expected ${url} to be accepted`).toBeUndefined();
      expect(res.result).toBe(ACTIVE_CHAIN);
    }
  });

  it('rejects plaintext http origins that are not loopback', async () => {
    // A page served over http can be rewritten in transit, so anything it asks
    // the wallet to do is attacker-influenced. Only loopback escapes this.
    const stub = await loadBroker({ [KEYS.chainId]: ACTIVE_CHAIN });
    for (const url of [
      'http://app.example/swap',
      'http://192.168.1.10:8080/',
      'http://10.0.0.5/',
      'http://localhost.evil.example/', // suffix, not loopback
    ]) {
      const res = await callRpc(stub, 'eth_chainId', url);
      expect(res.error, `expected ${url} to be refused`).toMatchObject({ code: 4100 });
    }
  });
});

describe('background silent answers', () => {
  it('eth_chainId returns the active chain without opening the popup', async () => {
    const stub = await loadBroker({ [KEYS.chainId]: ACTIVE_CHAIN });
    const res = await callRpc(stub, 'eth_chainId', ORIGIN);
    expect(res.result).toBe(ACTIVE_CHAIN);
  });

  it('net_version returns the decimal form of the active chain', async () => {
    const stub = await loadBroker({ [KEYS.chainId]: ACTIVE_CHAIN });
    const res = await callRpc(stub, 'net_version', ORIGIN);
    expect(res.result).toBe('56');
  });

  it('eth_accounts returns [] for an origin that was never granted, even if addresses are on file', async () => {
    // The address snapshot exists but there is no permission record: answering
    // with the addresses here would leak them to a site the user never approved.
    const stub = await loadBroker({ [KEYS.chainId]: ACTIVE_CHAIN, [KEYS.accounts]: ACCOUNTS });
    const res = await callRpc(stub, 'eth_accounts', ORIGIN);
    expect(res.result).toEqual([]);
  });

  it('eth_accounts returns the stored addresses for a granted origin', async () => {
    const stub = await loadBroker({
      [KEYS.chainId]: ACTIVE_CHAIN,
      [KEYS.perms]: GRANT,
      [KEYS.accounts]: ACCOUNTS,
    });
    const res = await callRpc(stub, 'eth_accounts', ORIGIN);
    expect(res.result).toEqual([ADDRESS]);
  });

  it('eth_accounts does not answer for a different origin than the one granted', async () => {
    const stub = await loadBroker({
      [KEYS.chainId]: ACTIVE_CHAIN,
      [KEYS.perms]: GRANT,
      [KEYS.accounts]: ACCOUNTS,
    });
    const res = await callRpc(stub, 'eth_accounts', 'https://other.example');
    expect(res.result).toEqual([]);
  });
});

describe('background method classification', () => {
  it('answers unknown methods as unsupported rather than failing open', async () => {
    const stub = await loadBroker({ [KEYS.chainId]: ACTIVE_CHAIN });
    const res = await callRpc(stub, 'wallet_madeUpMethod', ORIGIN);
    expect(res.error).toMatchObject({ code: 4200 });
  });

  it('keeps eth_sign unsupported so the blank-cheque method cannot be reached', async () => {
    const stub = await loadBroker({
      [KEYS.chainId]: ACTIVE_CHAIN,
      [KEYS.perms]: GRANT,
      [KEYS.accounts]: ACCOUNTS,
    });
    const res = await callRpc(stub, 'eth_sign', ORIGIN);
    expect(res.error).toMatchObject({ code: 4200 });
  });
});

describe('background revoke', () => {
  it('wallet_revokePermissions clears both the grant and the address snapshot', async () => {
    const stub = await loadBroker({
      [KEYS.chainId]: ACTIVE_CHAIN,
      [KEYS.perms]: GRANT,
      [KEYS.accounts]: ACCOUNTS,
    });

    const res = await callRpc(stub, 'wallet_revokePermissions', ORIGIN);
    expect(res.error).toBeUndefined();
    expect(stub.store[KEYS.perms]).toEqual([]);
    expect(stub.store[KEYS.accounts]).toEqual({});
  });

  it('after revoking, eth_accounts no longer answers for that origin', async () => {
    const stub = await loadBroker({
      [KEYS.chainId]: ACTIVE_CHAIN,
      [KEYS.perms]: GRANT,
      [KEYS.accounts]: ACCOUNTS,
    });

    await callRpc(stub, 'wallet_revokePermissions', ORIGIN);
    const res = await callRpc(stub, 'eth_accounts', ORIGIN);
    expect(res.result).toEqual([]);
  });
});

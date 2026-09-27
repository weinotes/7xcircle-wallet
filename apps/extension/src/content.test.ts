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
 * Tests for the content-script bridge.
 *
 * The content script runs in the least-trusted context that still has an
 * extension identity, so its only real security job is source validation:
 * anything on the page can call window.postMessage, and a message that is
 * relayed without checking its origin would let a page impersonate the
 * injected provider. That check is what these tests pin down.
 *
 * content.ts has module-level side effects (it injects the page provider and
 * registers listeners on import) and exports nothing, so the DOM and the
 * extension APIs are stubbed before a fresh import.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

type MessageHandler = (event: { source: unknown; data: unknown }) => void;
type RuntimeListener = (message: {
  type?: string;
  event?: string;
  data?: unknown;
  [key: string]: unknown;
}) => boolean;

interface Bridge {
  doc: { createElement: ReturnType<typeof vi.fn>; head: { appendChild: ReturnType<typeof vi.fn> } };
  scriptEl: Record<string, unknown>;
  appended: unknown[];
  handlers: MessageHandler[];
  runtimeListeners: RuntimeListener[];
  postMessage: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  posted: Record<string, unknown>[];
}

const INPAGE_SOURCE = '7xcircle-inpage';
const CONTENT_SOURCE = '7xcircle-content';
const EXTENSION_URL = 'chrome-extension://abcdefghijklmnop/inpage.js';

/** Stub document/window/chrome, then import a fresh copy of content.ts. */
async function loadBridge(): Promise<Bridge> {
  const appended: unknown[] = [];
  const scriptEl: Record<string, unknown> = { remove: vi.fn() };
  const handlers: MessageHandler[] = [];
  const runtimeListeners: RuntimeListener[] = [];
  const posted: Record<string, unknown>[] = [];

  const doc = {
    createElement: vi.fn(() => scriptEl),
    head: { appendChild: vi.fn((el: unknown) => void appended.push(el)) },
  };

  const win = {
    postMessage: vi.fn((msg: Record<string, unknown>) => void posted.push(msg)),
    addEventListener: vi.fn((type: string, fn: MessageHandler) => {
      if (type === 'message') handlers.push(fn);
    }),
  };

  const sendMessage = vi.fn();
  const chrome = {
    runtime: {
      getURL: vi.fn((path: string) => (path === 'inpage.js' ? EXTENSION_URL : `x/${path}`)),
      sendMessage,
      lastError: undefined as { message?: string } | undefined,
      onMessage: { addListener: (fn: RuntimeListener) => void runtimeListeners.push(fn) },
    },
  };

  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('chrome', chrome);
  vi.resetModules();
  // content.ts imports nothing and exports nothing, so TypeScript classifies it
  // as a non-module script and rejects the specifier. It still runs on import,
  // which is exactly what the bridge needs to be tested against.
  // @ts-expect-error -- side-effect-only script, intentionally not a module
  await import('./content.js');

  return { doc, scriptEl, appended, handlers, runtimeListeners, postMessage: win.postMessage, sendMessage, posted };
}

/** Deliver a window message event to the bridge. */
function post(bridge: Bridge, data: unknown, source?: unknown): void {
  const sourceRef = source === undefined ? (globalThis as { window?: unknown }).window : source;
  for (const handler of bridge.handlers) handler({ source: sourceRef, data });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('content bridge injection', () => {
  it('injects the page-side provider at import time', async () => {
    const bridge = await loadBridge();
    expect(bridge.doc.createElement).toHaveBeenCalledWith('script');
    expect(bridge.scriptEl.src).toBe(EXTENSION_URL);
    expect(bridge.appended).toContain(bridge.scriptEl);
  });
});

describe('content bridge source validation', () => {
  it('relays a well-formed inpage request to the background', async () => {
    const bridge = await loadBridge();
    post(bridge, { source: INPAGE_SOURCE, id: 'abc123', request: { method: 'eth_chainId', params: [] } });

    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
    expect(bridge.sendMessage.mock.calls[0][0]).toEqual({
      type: 'dapp:rpc',
      id: 'abc123',
      method: 'eth_chainId',
      params: [],
    });
  });

  it('defaults missing params to an empty array', async () => {
    const bridge = await loadBridge();
    post(bridge, { source: INPAGE_SOURCE, id: 'abc123', request: { method: 'eth_chainId' } });
    expect(bridge.sendMessage.mock.calls[0][0]).toMatchObject({ params: [] });
  });

  it('ignores messages carrying a different source marker', async () => {
    const bridge = await loadBridge();
    post(bridge, { source: 'some-other-wallet', id: 'abc123', request: { method: 'eth_chainId' } });
    post(bridge, { source: '7xcircle-content', id: 'abc123', request: { method: 'eth_chainId' } });
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores messages that did not originate from this window', async () => {
    const bridge = await loadBridge();
    post(
      bridge,
      { source: INPAGE_SOURCE, id: 'abc123', request: { method: 'eth_chainId' } },
      { not: 'the window' },
    );
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores requests without a string method', async () => {
    const bridge = await loadBridge();
    post(bridge, { source: INPAGE_SOURCE, id: 'abc123', request: { method: 42 } });
    post(bridge, { source: INPAGE_SOURCE, id: 'abc123' });
    post(bridge, { source: INPAGE_SOURCE, id: 'abc123', request: null });
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores empty or non-object payloads', async () => {
    const bridge = await loadBridge();
    post(bridge, null);
    post(bridge, undefined);
    post(bridge, 'a string');
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });
});

describe('content bridge responses', () => {
  it('posts a successful result back tagged as the content script', async () => {
    const bridge = await loadBridge();
    bridge.sendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ id: 'abc123', result: '0x38' });
    });

    post(bridge, { source: INPAGE_SOURCE, id: 'abc123', request: { method: 'eth_chainId' } });

    expect(bridge.posted).toContainEqual({ source: CONTENT_SOURCE, id: 'abc123', result: '0x38' });
  });

  it('posts an error back when the background returns one', async () => {
    const bridge = await loadBridge();
    const error = { code: 4100, message: 'not authorized' };
    bridge.sendMessage.mockImplementation((_msg: unknown, cb: (r: unknown) => void) => {
      cb({ id: 'abc123', error });
    });

    post(bridge, { source: INPAGE_SOURCE, id: 'abc123', request: { method: 'eth_accounts' } });

    expect(bridge.posted).toContainEqual({ source: CONTENT_SOURCE, id: 'abc123', error });
  });

  it('reports 4900 when the background is unreachable', async () => {
    const bridge = await loadBridge();
    // Chrome still fires the callback on failure — it just leaves the response
    // undefined and sets lastError. Mirroring that is the whole point here.
    bridge.sendMessage.mockImplementation((_msg: unknown, cb?: (r: unknown) => void) => {
      (globalThis as { chrome: { runtime: { lastError?: unknown } } }).chrome.runtime.lastError = {
        message: 'Could not establish connection.',
      };
      cb?.(undefined);
    });

    post(bridge, { source: INPAGE_SOURCE, id: 'abc123', request: { method: 'eth_chainId' } });

    const failure = bridge.posted.find(p => p.error !== undefined);
    expect(failure).toBeDefined();
    expect(failure?.source).toBe(CONTENT_SOURCE);
    expect(failure?.error).toMatchObject({ code: 4900 });
  });
});

describe('content bridge events', () => {
  it('forwards background provider events to the page', async () => {
    const bridge = await loadBridge();
    for (const listener of bridge.runtimeListeners) {
      listener({ type: 'dapp:event', event: 'accountsChanged', data: [] });
    }
    expect(bridge.posted).toContainEqual({
      source: CONTENT_SOURCE,
      event: 'accountsChanged',
      data: [],
    });
  });

  it('does not forward unrelated runtime messages', async () => {
    const bridge = await loadBridge();
    for (const listener of bridge.runtimeListeners) {
      listener({ type: 'popup:resolve', id: 'abc123' });
      listener({ type: 'dapp:event' });
    }
    expect(bridge.posted).toHaveLength(0);
  });
});

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
 * MV3 background — the DApp request broker.
 *
 * Owns NO keys and NO sessions: it transports, gates (via the pure
 * @open-wallet/core dapp protocol), queues, and forwards decisions between
 * content scripts (dApps) and the popup (the only place a session exists).
 *
 * Lifecycle notes (MV3 service worker is ephemeral):
 *   - permissions + accounts snapshot live in chrome.storage.local so a
 *     cold-sw eth_accounts still answers for connected sites
 *   - pending approvals live in memory + a storage mirror; a SW recycle
 *     rejects stragglers (dApps retry, which is the MetaMask behavior too)
 *   - a request awaiting approval holds its sendResponse open; Chrome caps
 *     that at ~5 min, after which the dApp sees a disconnect error
 */

import type { SitePermission } from '@open-wallet/core';
import {
  findPermission,
  gate,
  providerErrors,
  revokePermission,
} from '@open-wallet/core';

const KEYS = {
  perms: 'dapp:permissions',
  accounts: 'dapp:accounts',
  chainId: 'dapp:chainId',
} as const;

interface RpcMessage {
  type: 'dapp:rpc';
  id: number;
  method: string;
  params: unknown[];
}
interface BrokerMessage {
  type: 'popup:list' | 'popup:close';
}
interface ResolveMessage {
  type: 'popup:resolve';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: number; message: string };
}
type Incoming = RpcMessage | BrokerMessage | ResolveMessage | { type: string };

interface PendingRequest {
  id: string;
  origin: string;
  method: string;
  params: unknown[];
  tabId: number | undefined;
  receivedAt: number;
}

/** in-memory queue — cleared on SW recycle by design (see header) */
let pending: PendingRequest[] = [];
let counter = 0;
const respondTo = new Map<string, (msg: unknown) => void>();
const popupPorts: Set<chrome.runtime.Port> = new Set();

async function readStorage<T>(key: string, fallback: T): Promise<T> {
  const data = await chrome.storage.local.get(key);
  return (data[key] as T | undefined) ?? fallback;
}

function badgeCount(): void {
  const n = pending.length;
  void chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  void chrome.action.setBadgeBackgroundColor({ color: '#f2b97f' });
}

/** Broadcast an EIP-1193 event to every tab we have a port-ish relationship with */
async function broadcastEvent(event: string, data: unknown): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    // callback form: lastError (no listener in the page) must be swallowed
    chrome.tabs.sendMessage(tab.id, { type: 'dapp:event', event, data }, () => {
      void chrome.runtime.lastError;
    });
  }
}

function originOf(sender: chrome.runtime.MessageSender): string | null {
  if (!sender.url) return null;
  try {
    const url = new URL(sender.url);
    // only http(s) pages may talk to the wallet
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function handleRpc(
  msg: RpcMessage,
  sender: chrome.runtime.MessageSender,
  respond: (r: unknown) => void,
): Promise<void> {
  const origin = originOf(sender);
  if (!origin) {
    respond({ id: msg.id, error: providerErrors.unauthorized() });
    return;
  }

  const perms = await readStorage<SitePermission[]>(KEYS.perms, []);
  const activeChainId = await readStorage<string>(KEYS.chainId, '0x38');
  const verdict = gate({ method: msg.method, perms, origin, activeChainId });

  if (verdict.kind === 'unsupported') {
    respond({ id: msg.id, error: providerErrors.unsupportedMethod() });
    return;
  }
  if (verdict.kind === 'reject') {
    respond({ id: msg.id, error: verdict.error });
    return;
  }
  if (verdict.kind === 'allow') {
    await answerSilently(msg, origin, perms, activeChainId, respond);
    return;
  }

  // prompt-connect / prompt-sign / prompt-send → queue for the popup
  const id = `${Date.now()}-${++counter}`;
  const request: PendingRequest = {
    id,
    origin,
    method: msg.method,
    params: msg.params,
    tabId: sender.tab?.id,
    receivedAt: Date.now(),
  };
  pending.push(request);
  respondTo.set(id, respond as (msg: unknown) => void);
  badgeCount();
  notifyPopup();

  // safety valve: if nothing resolves (SW recycled / popup never opened),
  // fail cleanly rather than leave the dApp hanging on a dead port
  setTimeout(() => {
    if (respondTo.has(id)) {
      respondTo.delete(id);
      pending = pending.filter(p => p.id !== id);
      badgeCount();
      notifyPopup();
      respond({ id: msg.id, error: providerErrors.disconnected() });
    }
  }, 4 * 60 * 1000);
}

/** Methods answered from broker state without opening the popup */
async function answerSilently(
  msg: RpcMessage,
  origin: string,
  perms: SitePermission[],
  activeChainId: string,
  respond: (r: unknown) => void,
): Promise<void> {
  switch (msg.method) {
    case 'eth_chainId':
      respond({ id: msg.id, result: activeChainId });
      return;
    case 'net_version':
      respond({ id: msg.id, result: String(parseInt(activeChainId, 16)) });
      return;
    case 'eth_accounts': {
      const perm = findPermission(perms, origin);
      const accounts = await readStorage<Record<string, string[]>>(KEYS.accounts, {});
      respond({ id: msg.id, result: perm ? accounts[origin] ?? [] : [] });
      return;
    }
    case 'wallet_revokePermissions': {
      const next = revokePermission(perms, origin);
      await chrome.storage.local.set({ [KEYS.perms]: next });
      const accounts = await readStorage<Record<string, string[]>>(KEYS.accounts, {});
      delete accounts[origin];
      await chrome.storage.local.set({ [KEYS.accounts]: accounts });
      void broadcastEvent('accountsChanged', []);
      respond({ id: msg.id, result: null });
      return;
    }
    default:
      respond({ id: msg.id, error: providerErrors.unsupportedMethod() });
  }
}

/** Push the current queue to any open popup port */
function notifyPopup(): void {
  const snapshot = pending.map(({ ...r }) => r);
  for (const port of popupPorts) {
    try {
      port.postMessage({ type: 'popup:pending', requests: snapshot });
    } catch {
      // port died (popup closed mid-push) — drop it, next connect re-syncs
      popupPorts.delete(port);
    }
  }
}

chrome.runtime.onMessage.addListener((message: Incoming, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'dapp:rpc') {
    void handleRpc(message as RpcMessage, sender, payload => sendResponse(payload));
    return true; // async
  }

  if (message.type === 'popup:resolve') {
    const msg = message as ResolveMessage;
    const respond = respondTo.get(msg.id);
    if (respond) {
      respondTo.delete(msg.id);
      pending = pending.filter(p => p.id !== msg.id);
      badgeCount();
      notifyPopup();
      respond(msg.ok
        ? { result: msg.result }
        : { error: msg.error ?? { code: 4001, message: 'User rejected the request.' } });
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'popup') return;
  popupPorts.add(port);
  notifyPopup();
  port.onMessage.addListener((msg: { type: string }) => {
    if (msg?.type === 'popup:list') notifyPopup();
  });
  port.onDisconnect.addListener(() => {
    popupPorts.delete(port);
  });
});

// when the popup closes with requests still queued, keep the badge —
// the next popup open re-fetches the list via the port handshake

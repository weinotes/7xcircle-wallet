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
 * Content-script bridge: inpage.js ⇄ background.
 *
 * Deliberately dumb — zero policy lives here (the dApp surface is the
 * least trusted context). Only two jobs:
 *   1. relay RPC requests and their responses (correlated by id)
 *   2. re-broadcast provider events coming from the background
 */

// inject the page-side provider at document_start, before dApps load
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inpage.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

interface InpageRequest {
  source: '7xcircle-inpage';
  id: number;
  request: { method?: string; params?: unknown[] };
}

window.addEventListener('message', event => {
  if (
    event.source !== window
    || !event.data
    || (event.data as { source?: string }).source !== '7xcircle-inpage'
  ) {
    return;
  }
  const { id, request } = event.data as InpageRequest;
  if (!request || typeof request.method !== 'string') return;

  chrome.runtime.sendMessage(
    { type: 'dapp:rpc', id, method: request.method, params: request.params ?? [] },
    (response: unknown) => {
      if (chrome.runtime.lastError || !response) {
        window.postMessage({
          source: '7xcircle-content',
          id,
          error: { code: 4900, message: chrome.runtime.lastError?.message ?? 'Wallet unreachable' },
        }, '*');
        return;
      }
      const res = response as { id?: number; result?: unknown; error?: unknown };
      window.postMessage({
        source: '7xcircle-content',
        id,
        ...(res.error ? { error: res.error } : { result: res.result }),
      }, '*');
    },
  );
});

// background-originated provider events → page
chrome.runtime.onMessage.addListener((message: { type?: string; event?: string; data?: unknown }) => {
  if (message?.type === 'dapp:event' && message.event) {
    window.postMessage({
      source: '7xcircle-content',
      event: message.event,
      data: message.data,
    }, '*');
  }
  return false;
});

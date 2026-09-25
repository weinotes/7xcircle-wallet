/*
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
 * Page-side EIP-1193 provider for 7xCircle Wallet.
 *
 * Not bundled — plain ES2019 that survives every dApp build pipeline.
 * Implements: request(), legacy send/sendAsync, EIP-1193 events
 * (connect/disconnect/chainChanged/accountsChanged) and the EIP-6963
 * multi-wallet discovery announce so the page sees us ALONGSIDE
 * MetaMask instead of fighting over window.ethereum.
 */
(function () {
  'use strict';
  if (window.__7xcircleInjected) return;
  window.__7xcircleInjected = true;

  // SECURITY: Use cryptographically random IDs to prevent page scripts from
  // forging responses. Predictable numeric IDs (nextId++) let any script on
  // the same page post a fake `source: '7xcircle-content'` message and
  // inject attacker-controlled results (e.g. fake eth_accounts).
  var pending = {};
  var listeners = {};
  var connectedAccounts = [];

  function emit(event, payload) {
    var handlers = listeners[event] || [];
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i](payload); } catch (e) { /* dApp bug, not ours */ }
    }
  }

  function providerRequest(args) {
    if (!args || typeof args.method !== 'string') {
      return Promise.reject(new Error('provider.request({method}) requires a method'));
    }
    var id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      window.postMessage(
        { source: '7xcircle-inpage', id: id, request: { method: args.method, params: args.params || [] } },
        '*'
      );
    }).then(function (result) {
      // maintain a local connected view for event semantics
      if (args.method === 'eth_requestAccounts' && Array.isArray(result)) {
        var first = connectedAccounts.length === 0;
        connectedAccounts = result.slice();
        if (first) emit('connect', { chainId: '0x38' });
        emit('accountsChanged', result);
      }
      return result;
    });
  }

  var provider = {
    is7xCircle: true,
    // dApps gate on this flag everywhere; we ARE an EIP-1193 provider and
    // EIP-6963 keeps multi-wallet coexistence honest
    isMetaMask: true,
    // legacy shim some older dApps still probe
    _isBuf: undefined,
    request: providerRequest,
    send: function (methodOrPayload, maybeParams) {
      if (typeof methodOrPayload === 'string') {
        return providerRequest({ method: methodOrPayload, params: maybeParams });
      }
      return providerRequest(methodOrPayload);
    },
    sendAsync: function (payload, callback) {
      providerRequest({ method: payload.method, params: payload.params }).then(
        function (result) { callback(null, { id: payload.id, jsonrpc: '2.0', result: result }); },
        function (error) { callback(error); }
      );
    },
    on: function (event, handler) {
      (listeners[event] = listeners[event] || []).push(handler);
      if (event === 'accounts' || event === 'accountsChanged') {
        // EIP-1193: state change events also fire with the current state
        if (connectedAccounts.length > 0) emit(event, connectedAccounts);
      }
      return provider;
    },
    removeListener: function (event, handler) {
      listeners[event] = (listeners[event] || []).filter(function (h) { return h !== handler; });
      return provider;
    },
    get connectedAccounts() { return connectedAccounts.slice(); },
    // selectedAddress kept current by the chainChanged/accountsChanged flow
    selectedAddress: null,
    chainId: '0x38'
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || event.data.source !== '7xcircle-content') return;
    var data = event.data;

    if (data.id && pending[data.id]) {
      var slot = pending[data.id];
      delete pending[data.id];
      if (data.error) {
        var err = new Error(data.error.message || 'Provider error');
        err.code = data.error.code;
        slot.reject(err);
      } else {
        slot.resolve(data.result);
      }
      return;
    }

    if (data.event === 'accountsChanged') {
      connectedAccounts = (data.data || []).slice();
      provider.selectedAddress = connectedAccounts[0] || null;
      emit('accountsChanged', connectedAccounts);
    } else if (data.event === 'chainChanged') {
      provider.chainId = data.data;
      emit('chainChanged', data.data);
    } else if (data.event === 'disconnect') {
      connectedAccounts = [];
      emit('disconnect', { code: data.data && data.data.code, message: 'Disconnected' });
    }
  });

  // ── EIP-6963: announce alongside other wallets ────────────────────
  var info = {
    uuid: '7a4b1f0e-9d3c-4e5a-8b2f-c6d7e8f90a1b',
    name: '7xCircle Wallet',
    rdns: 'wallet.7xcircle',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'
  };
  function announce() {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: info, provider: provider }) }));
  }
  window.addEventListener('eip6963:requestProvider', function () { announce(); });
  announce();

  // MetaMask-style convenience: only claim the legacy global if free
  if (!window.ethereum) {
    window.ethereum = provider;
    window.dispatchEvent(new Event('ethereum#initialized'));
  }
})();

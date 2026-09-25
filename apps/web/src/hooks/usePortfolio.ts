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
 * Cross-chain portfolio — all accounts' balances in one priced list.
 *
 * Lazy by design: the popup opening this page must not fire 9 chains of
 * RPC traffic nobody asked for. Nothing fetches until `enabled` flips to
 * true (Home's "All chains" view), the first result is cached for the
 * session, and refresh is manual. priceTokens handles the multi-chain mix —
 * it already groups Solana mints and EVM/TRON addresses into their own
 * quote venues.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { chainRegistry } from '@7xcircle/core';
import { priceTokens } from '@7xcircle/chains';
import type { TokenBalance } from '@7xcircle/shared';
import { useWalletStore } from '../store/wallet.js';

export interface PortfolioState {
  loading: boolean;
  tokens: TokenBalance[];
  /** Chains whose balances failed; 0 means a clean sweep */
  failedChains: number;
  loaded: boolean;
}

export function usePortfolio(enabled: boolean) {
  const accounts = useWalletStore(s => s.accounts);
  const [state, setState] = useState<PortfolioState>({
    loading: false,
    tokens: [],
    failedChains: 0,
    loaded: false,
  });

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (accounts.length === 0) return;
    setState(s => ({ ...s, loading: true }));

    const settled = await Promise.allSettled(
      accounts.map(async account => {
        const adapter = chainRegistry.get(account.chainId);
        if (!adapter) return [] as TokenBalance[];
        return adapter.getAllTokenBalances(account.address);
      }),
    );

    const merged: TokenBalance[] = [];
    let failed = 0;
    for (const result of settled) {
      if (result.status === 'fulfilled') merged.push(...result.value);
      else failed += 1;
    }

    let priced = merged;
    try {
      priced = await priceTokens(merged);
    } catch {
      // Prices are additive — a dead oracle leaves bare amounts, not zeros
    }

    if (!aliveRef.current) return;
    const nonZero = priced
      .filter(t => t.balance && t.balance !== '0')
      .sort((a, b) => (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0));
    setState({ loading: false, tokens: nonZero, failedChains: failed, loaded: true });
  }, [accounts]);

  // First activation fetches; leaving the view keeps the cache warm.
  useEffect(() => {
    if (enabled && !state.loaded && !state.loading) void load();
  }, [enabled, state.loaded, state.loading, load]);

  return { ...state, refresh: load };
}

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
 * Hook: fetch transaction history for the current active chain + account.
 *
 * Data sources (merged in priority order):
 *   1. Wallet store's pendingTxs (locally-broadcast, not yet in explorer)
 *   2. Block explorer API (confirmed history)
 *
 * Dedupe rule: explorer result replaces a pending local entry if both
 * have the same hash — because explorer has richer metadata (block
 * number, gas used, final status).
 *
 * Re-fetches on chain/address change and supports manual refresh.
 * Pending txs from the store are reacted to automatically — no polling
 * needed on the hook side.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chainRegistry } from '@7xcircle/core';
import { useWalletStore } from '../store/wallet.js';
import type { TransactionRecord } from '@7xcircle/shared';

export interface UseTransactionHistoryResult {
  transactions: TransactionRecord[];
  loading: boolean;
  error: string | null;
  /** Manually re-fetch from block explorer */
  refresh: () => void;
}

/** Module-level stable empty array — never recreated, keeps useMemo deps stable */
const EMPTY_TXS: TransactionRecord[] = [];

export function useTransactionHistory(
  chainId: string | undefined,
  address: string | undefined,
): UseTransactionHistoryResult {
  // Explorer-fetched transactions (authoritative for confirmed/failed)
  const [explorerTxs, setExplorerTxs] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Locally-known pending txs from wallet store (source of truth for "pending")
  // IMPORTANT: return a stable reference (s.pendingTxs[chainId] or undefined),
  // NOT a freshly-allocated [] — zustand v5 useSyncExternalStore requires a
  // cached getSnapshot, otherwise it triggers an infinite re-render loop.
  const pendingTxs = useWalletStore(
    s => (chainId ? s.pendingTxs[chainId] : undefined),
  ) as TransactionRecord[] | undefined;

  // Stable empty array for useMemo dependency
  const pendingList = pendingTxs ?? EMPTY_TXS;

  // Concurrency control — prevent old responses clobbering new ones
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);

  const fetch = useCallback(async () => {
    if (!chainId || !address) {
      setExplorerTxs([]);
      return;
    }

    const adapter = chainRegistry.get(chainId);
    if (!adapter) {
      setExplorerTxs([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const generation = ++genRef.current;
    setLoading(true);
    setError(null);

    try {
      const list = await adapter.getTransactionHistory(address);
      if (generation === genRef.current && !controller.signal.aborted) {
        setExplorerTxs(list);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Failed to load transactions');
        // Keep stale explorer data visible on error — better than flashing empty
      }
    } finally {
      if (generation === genRef.current) {
        setLoading(false);
      }
    }
  }, [chainId, address]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  // ── Merge explorer results + store pending txs ─────────────────────
  //
  // Rule: explorer entry wins if both exist (it has blockNumber, status,
  // gas used). Pending-only entries (not yet picked up by explorer) stay
  // as "pending" at the top.
  //
  // Sorted by blockTimestamp desc. Pending entries (blockTimestamp = when
  // we broadcast) sort newest-first naturally.
  const transactions = useMemo(() => {
    if (!chainId) return [];

    const explorerByHash = new Map<string, TransactionRecord>();
    for (const tx of explorerTxs) explorerByHash.set(tx.hash, tx);

    const merged: TransactionRecord[] = [];

    // Add explorer entries (authoritative for confirmed/failed)
    merged.push(...explorerTxs);

    // Add pending entries that explorer hasn't picked up yet
    for (const p of pendingList) {
      if (!explorerByHash.has(p.hash)) {
        merged.push(p);
      }
    }

    // Sort newest first. Pending (timestamp = broadcast time) stays on top
    // until explorer returns it with blockTimestamp.
    merged.sort((a, b) => b.blockTimestamp - a.blockTimestamp);

    return merged;
  }, [explorerTxs, pendingList, chainId]);

  const refresh = useCallback(() => void fetch(), [fetch]);

  return { transactions, loading, error, refresh };
}

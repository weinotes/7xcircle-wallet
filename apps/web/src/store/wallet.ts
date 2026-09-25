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
 * Wallet Zustand store — global state for the web app.
 *
 * State layout:
 *   vault       — encrypted vault data (persisted, this is safe)
 *   unlocked    — boolean flag (NOT persisted)
 *   accounts    — derived addresses (NOT persisted, re-derived on each unlock)
 *   ui          — theme, language, active chain (persisted, safe)
 *
 * SECURITY NOTE: mnemonic NEVER enters Zustand at all — it lives only in
 * SessionManager's module-level closure. The store only ever holds:
 *   - Account records (addresses + derivation paths — public info)
 *   - encryptedVault blob (safe to store)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VaultData, Account, TransactionRecord, AppLanguage } from '@open-wallet/shared';
import { APP_NAME, DEFAULT_THEME, detectSystemLanguage } from '@open-wallet/shared';
import type { ChainConfig } from '@open-wallet/shared';
import { unlock as sessionUnlock, lock as sessionLock } from '@open-wallet/core';

/** In-memory pending txs — chainId → list of locally-known transactions */
type PendingTxMap = Record<string, TransactionRecord[]>;

interface WalletState {
  // ─── Vault (persisted encrypted blob — safe) ────
  vaultExists: boolean;
  encryptedVault: VaultData | null;

  // ─── Unlocked flag (NOT persisted — derived fresh each session) ──
  unlocked: boolean;

  // ─── Accounts (public chain addresses, NOT persisted — re-derived on unlock) ──
  accounts: Account[];

  // ─── Hardware wallet accounts (PERSISTED — public info only: address,
  //     pubkey, device path. No key material ever exists for these.) ──
  hwAccounts: Account[];

  // ─── Local pending transactions (NOT persisted — RAM only, refresh → gone) ──
  // Populated after Send broadcasts so Home/History can show them instantly
  // before the explorer API picks them up (10-30s delay typical).
  pendingTxs: PendingTxMap;

  // ─── UI state (persisted — safe, just preferences) ──
  theme: 'dark' | 'light';
  language: AppLanguage;
  activeChainId: string;
  activeAccountId: string | null;

  // ─── Actions ────────────────────────────
  setVault: (vault: VaultData) => void;
  clearVault: () => void;

  /** Async unlock → decrypt vault + derive accounts */
  unlock: (password: string, chainConfigs: ChainConfig[]) => Promise<void>;
  lock: () => void;

  setActiveAccount: (id: string) => void;

  /** Register a Ledger/device account (public data — survives locks) */
  addHardwareAccount: (account: Account) => void;
  removeHardwareAccount: (id: string) => void;

  setTheme: (t: 'dark' | 'light') => void;
  setLanguage: (l: AppLanguage) => void;
  setActiveChain: (chainId: string) => void;

  /** Add a locally-known pending tx (just-broadcast, not yet confirmed) */
  addPendingTx: (chainId: string, tx: TransactionRecord) => void;
  /** Remove a tx from local pending list (after explorer returns it, or on fail) */
  removePendingTx: (chainId: string, txHash: string) => void;
  /** Clear all pending txs (e.g. on lock) */
  clearPendingTxs: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      vaultExists: false,
      encryptedVault: null,

      unlocked: false,
      accounts: [],
      hwAccounts: [],

      pendingTxs: {},

      theme: DEFAULT_THEME,
      // Default to the device/system language; overridden by persisted
      // value once the user picks a language manually.
      language: detectSystemLanguage(),
      activeChainId: 'bsc-56',
      activeAccountId: null,

      // ── Vault management ──
      setVault: (vault) => set({ vaultExists: true, encryptedVault: vault }),

      clearVault: () => {
        sessionLock();
        set({
          vaultExists: false,
          encryptedVault: null,
          unlocked: false,
          accounts: [],
          hwAccounts: [],
          activeAccountId: null,
          pendingTxs: {},
        });
      },

      // ── Session lifecycle ──
      unlock: async (password, chainConfigs) => {
        const state = useWalletStore.getState();
        if (!state.encryptedVault) {
          throw new Error('No vault found — wallet not initialized');
        }
        const derived = await sessionUnlock(state.encryptedVault, password, chainConfigs);
        // device accounts join every session — signing routes to the hardware
        const accounts = [...derived, ...state.hwAccounts];
        set({
          unlocked: true,
          accounts,
          activeAccountId: state.activeAccountId ?? accounts[0]?.id ?? null,
          pendingTxs: {},   // clear stale pending on each fresh unlock
        });
      },

      lock: () => {
        sessionLock();
        set({ unlocked: false, accounts: [], activeAccountId: null, pendingTxs: {} });
      },

      // ── UI ──
      setActiveAccount: (id) => set({ activeAccountId: id }),
      addHardwareAccount: (account) => set(state => {
        if (state.hwAccounts.some(a => a.id === account.id)) return state;
        const merged = [...state.hwAccounts, account];
        return {
          hwAccounts: merged,
          accounts: state.unlocked ? [...state.accounts, account] : state.accounts,
        };
      }),
      removeHardwareAccount: (id) => set(state => ({
        hwAccounts: state.hwAccounts.filter(a => a.id !== id),
        accounts: state.accounts.filter(a => a.id !== id),
        activeAccountId: state.activeAccountId === id ? null : state.activeAccountId,
      })),
      setTheme: (t) => set({ theme: t }),
      setLanguage: (l) => set({ language: l }),
      setActiveChain: (chainId) => set({ activeChainId: chainId }),

      // ── Local pending transactions (NOT persisted) ──
      addPendingTx: (chainId, tx) => set(state => {
        const list = state.pendingTxs[chainId] ?? [];
        // Avoid duplicates — dedupe by hash
        const filtered = list.filter(t => t.hash !== tx.hash);
        return {
          pendingTxs: {
            ...state.pendingTxs,
            [chainId]: [tx, ...filtered],
          },
        };
      }),
      removePendingTx: (chainId, txHash) => set(state => {
        const list = state.pendingTxs[chainId] ?? [];
        const filtered = list.filter(t => t.hash !== txHash);
        const next = { ...state.pendingTxs };
        if (filtered.length === 0) delete next[chainId];
        else next[chainId] = filtered;
        return { pendingTxs: next };
      }),
      clearPendingTxs: () => set({ pendingTxs: {} }),
    }),
    {
      name: `${APP_NAME}-store`,
      // ONLY persist safe data — no session material, no accounts (re-derived each unlock)
      partialize: (state) => ({
        vaultExists: state.vaultExists,
        encryptedVault: state.encryptedVault,
        theme: state.theme,
        language: state.language,
        activeChainId: state.activeChainId,
        // device accounts are public key + path — safe and must survive locks,
        // unlike HD accounts they are not re-derived from the mnemonic
        hwAccounts: state.hwAccounts,
        // NOTE: accounts, unlocked, activeAccountId intentionally excluded
        // — they are re-derived from the mnemonic on each unlock
      }),
    },
  ),
);

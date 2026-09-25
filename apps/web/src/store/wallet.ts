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
import type { VaultData, Account, TransactionRecord, AppLanguage, TokenApproval } from '@7xcircle/shared';
import { APP_NAME, DEFAULT_THEME, detectSystemLanguage, markApprovalRevoked, upsertApproval } from '@7xcircle/shared';
import type { ChainConfig } from '@7xcircle/shared';
import { unlock as sessionUnlock, lock as sessionLock, deriveMoreAccount } from '@7xcircle/core';

/** In-memory pending txs — chainId → list of locally-known transactions */
type PendingTxMap = Record<string, TransactionRecord[]>;

export interface WalletState {
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

  // ─── Token-approval ledger (PERSISTED — public on-chain grants issued
  //     through THIS wallet; survives locks, cleared only with the vault) ──
  approvals: TokenApproval[];

  // ─── UI state (persisted — safe, just preferences) ──
  theme: 'dark' | 'light';
  language: AppLanguage;
  activeChainId: string;
  activeAccountId: string | null;

  // ─── HD accounts per chain (PERSISTED — public index metadata, drives
  //     how many consecutive derivation indexes unlock() creates) ──
  accountCounts: Record<string, number>;

  // ─── Actions ────────────────────────────
  setVault: (vault: VaultData) => void;
  clearVault: () => void;

  /** Async unlock → decrypt vault + derive accounts */
  unlock: (password: string, chainConfigs: ChainConfig[]) => Promise<void>;
  lock: () => void;

  setActiveAccount: (id: string) => void;

  /** Derive + register the next HD account for a chain ("add account") */
  addAccount: (chainId: string) => void;

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

  /** Record an approve(spender, amount) confirmed through this wallet */
  recordApproval: (entry: Omit<TokenApproval, 'id' | 'revokedAt'>) => void;
  /** Flag a ledger entry revoked after the on-chain zero-approval confirmed */
  markApprovalRevoked: (id: string, at: number) => void;
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

      approvals: [],

      theme: DEFAULT_THEME,
      // Default to the device/system language; overridden by persisted
      // value once the user picks a language manually.
      language: detectSystemLanguage(),
      activeChainId: 'bsc-56',
      activeAccountId: null,
      accountCounts: {},

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
          approvals: [],
          accountCounts: {},
        });
      },

      // ── Session lifecycle ──
      unlock: async (password, chainConfigs) => {
        const state = useWalletStore.getState();
        if (!state.encryptedVault) {
          throw new Error('No vault found — wallet not initialized');
        }
        const derived = await sessionUnlock(
          state.encryptedVault,
          password,
          chainConfigs,
          state.accountCounts,
        );
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
      addAccount: (chainId) => {
        const account = deriveMoreAccount(chainId);
        set(state => ({
          accounts: [...state.accounts, account],
          accountCounts: {
            ...state.accountCounts,
            [chainId]: Math.max(state.accountCounts[chainId] ?? 1, account.accountIndex + 1),
          },
          activeAccountId: account.id,
        }));
      },
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
      // Switching chains re-points the active account at the first account
      // of the new chain — an id from another chain would silently strand
      // every account lookup downstream.
      setActiveChain: (chainId) => set(state => {
        const first = state.accounts.find(a => a.chainId === chainId);
        return {
          activeChainId: chainId,
          activeAccountId: first?.id ?? null,
        };
      }),

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

      // ── Approval ledger (persisted public grants) ──
      recordApproval: (entry) => set(state => ({
        approvals: upsertApproval(state.approvals, entry),
      })),
      markApprovalRevoked: (id, at) => set(state => ({
        approvals: markApprovalRevoked(state.approvals, id, at),
      })),
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
        accountCounts: state.accountCounts,
        // the approval ledger records public grants this wallet signed —
        // safe to persist and must survive locks/reloads like hwAccounts
        approvals: state.approvals,
        // device accounts are public key + path — safe and must survive locks,
        // unlike HD accounts they are not re-derived from the mnemonic
        hwAccounts: state.hwAccounts,
        // NOTE: accounts, unlocked, activeAccountId intentionally excluded
        // — they are re-derived from the mnemonic on each unlock
      }),
    },
  ),
);

/**
 * The account the UI is operating on: the explicitly selected one when it
 * belongs to the active chain, else the chain's first account. Every money
 * page resolves its signer through this — with multi-account there is no
 * longer a safe bare `find(chainId)`.
 */
export function selectActiveAccount(s: WalletState): Account | undefined {
  return (
    s.accounts.find(a => a.chainId === s.activeChainId && a.id === s.activeAccountId) ??
    s.accounts.find(a => a.chainId === s.activeChainId)
  );
}

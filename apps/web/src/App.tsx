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
import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import i18n from './i18n/index.js';
import { syncDocumentDirection } from './i18n/index.js';
import { Onboarding } from './pages/Onboarding.js';
import { Unlock } from './pages/Unlock.js';
import { Home } from './pages/Home.js';
import { Send } from './pages/Send.js';
import { Swap } from './pages/Swap.js';
import { Earn } from './pages/Earn.js';
import { Receive } from './pages/Receive.js';
import { History } from './pages/History.js';
import { Settings } from './pages/Settings.js';
import { DappApprovals } from './pages/DappApprovals.js';
import { Approvals } from './pages/Approvals.js';
import { LedgerConnect } from './pages/LedgerConnect.js';
import { WatchWallet } from './pages/WatchWallet.js';
import { useWalletStore } from './store/wallet.js';
import { useThemeSync } from './hooks/useThemeSync.js';
import { registerAllChains } from '@7xcircle/chains';
import { touchActivity, getSessionState } from '@7xcircle/core';

// Register chain adapters once at app startup
registerAllChains();

/** Auto-lock after 5 minutes of inactivity (regardless of visibility) */
const AUTO_LOCK_MS = 5 * 60 * 1000;
/** How often to check for inactivity while the page is visible */
const INACTIVITY_CHECK_MS = 30 * 1000;
let lockTimer: ReturnType<typeof setTimeout> | null = null;
let inactivityInterval: ReturnType<typeof setInterval> | null = null;

function App() {
  const vaultExists = useWalletStore(s => s.vaultExists);
  const unlocked = useWalletStore(s => s.unlocked);
  const lock = useWalletStore(s => s.lock);
  const language = useWalletStore(s => s.language);

  // Reflect the persisted theme onto <html data-theme> so tokens repaint
  useThemeSync();

  // ── Keep i18next + document direction in sync with the store ──
  useEffect(() => {
    void i18n.changeLanguage(language);
    syncDocumentDirection(language);
  }, [language]);

  // ── Auto-lock: visibility-based + inactivity-based ──
  useEffect(() => {
    if (!vaultExists) return;

    const scheduleLock = () => {
      if (lockTimer) clearTimeout(lockTimer);
      lockTimer = setTimeout(() => {
        if (document.visibilityState === 'hidden') {
          lock();
        }
      }, AUTO_LOCK_MS);
    };

    const handleHide = () => scheduleLock();
    const handleShow = () => {
      if (lockTimer) {
        clearTimeout(lockTimer);
        lockTimer = null;
      }
      if (useWalletStore.getState().unlocked) {
        touchActivity();
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleHide();
      else handleShow();
    });

    // SECURITY: The visibility-based lock above only fires when the user
    // switches away. A user who walks away with the tab still visible would
    // leave the wallet unlocked forever. This interval checks lastActivityAt
    // every 30 s and locks if no interaction happened within AUTO_LOCK_MS.
    inactivityInterval = setInterval(() => {
      if (!useWalletStore.getState().unlocked) return;
      const { lastActivityAt } = getSessionState();
      if (lastActivityAt && Date.now() - lastActivityAt > AUTO_LOCK_MS) {
        lock();
      }
    }, INACTIVITY_CHECK_MS);

    return () => {
      if (lockTimer) clearTimeout(lockTimer);
      if (inactivityInterval) clearInterval(inactivityInterval);
    };
  }, [vaultExists, lock]);

  // ── 3-state routing guard ──
  if (!vaultExists) {
    // No wallet initialized → Onboarding
    return <Onboarding />;
  }

  if (!unlocked) {
    // Vault exists but locked → Unlock screen
    return <Unlock />;
  }

  // Unlocked → main app routes
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/send" element={<Send />} />
      <Route path="/swap" element={<Swap />} />
      <Route path="/earn" element={<Earn />} />
      <Route path="/receive" element={<Receive />} />
      <Route path="/history" element={<History />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/watch" element={<WatchWallet />} />
      <Route path="/dapp" element={<DappApprovals />} />
      <Route path="/approvals" element={<Approvals />} />
      <Route path="/ledger" element={<LedgerConnect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

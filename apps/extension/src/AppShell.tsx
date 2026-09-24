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
 * Extension popup app shell.
 *
 * Mirrors the web App's 3-state routing guard + auto-lock, but mounts
 * inside the extension popup with a MemoryRouter (no URL bar).
 *
 * Reuses the web app's pages verbatim:
 *   Onboarding / Unlock / Home / Send / Receive / History / Settings
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import i18n from '@web/i18n/index.js';
import { syncDocumentDirection } from '@web/i18n/index.js';
import { Onboarding } from '@web/pages/Onboarding.js';
import { Unlock } from '@web/pages/Unlock.js';
import { Home } from '@web/pages/Home.js';
import { Send } from '@web/pages/Send.js';
import { Swap } from '@web/pages/Swap.js';
import { Receive } from '@web/pages/Receive.js';
import { History } from '@web/pages/History.js';
import { Settings } from '@web/pages/Settings.js';
import { DappApprovals } from '@web/pages/DappApprovals.js';
import { useWalletStore } from '@web/store/wallet.js';
import { registerAllChains } from '@open-wallet/chains';
import { touchActivity } from '@open-wallet/core';

// Register chain adapters once at app startup
registerAllChains();

/** Auto-lock after 5 minutes of visibility loss */
const AUTO_LOCK_MS = 5 * 60 * 1000;
let lockTimer: ReturnType<typeof setTimeout> | null = null;

function AppShell() {
  const vaultExists = useWalletStore(s => s.vaultExists);
  const unlocked = useWalletStore(s => s.unlocked);
  const lock = useWalletStore(s => s.lock);
  const language = useWalletStore(s => s.language);

  // ── Keep i18next + document direction in sync with the store ──
  useEffect(() => {
    void i18n.changeLanguage(language);
    syncDocumentDirection(language);
  }, [language]);

  // ── Auto-lock when the popup is hidden ──
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

    return () => {
      if (lockTimer) clearTimeout(lockTimer);
    };
  }, [vaultExists, lock]);

  // ── 3-state routing guard ──
  if (!vaultExists) {
    return <Onboarding />;
  }

  if (!unlocked) {
    return <Unlock />;
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/send" element={<Send />} />
      <Route path="/swap" element={<Swap />} />
      <Route path="/dapp" element={<DappApprovals />} />
      <Route path="/receive" element={<Receive />} />
      <Route path="/history" element={<History />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default AppShell;

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
 * Connect a hardware wallet (Ledger / OneKey-in-Ledger-mode).
 *
 * Flow: WebUSB pair → read ETH-app addresses (no device confirmation
 * needed to LIST) → user ticks the accounts to add. Every later signature
 * requires the physical buttons on the device — this page never touches a
 * private key because none exists in this process.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Usb, Check, ShieldCheck } from 'lucide-react';
import { Button } from '@open-wallet/ui';
import { generateId } from '@open-wallet/shared';
import type { Account } from '@open-wallet/shared';
import { chainRegistry } from '@open-wallet/core';
import { useWalletStore } from '../store/wallet.js';
import {
  browseLedgerAccounts,
  isHardwareAvailable,
  ledgerEvmPath,
  openEthApp,
  type LedgerDiscoveredAccount,
} from '../hw/ledger.js';

export function LedgerConnect() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const unlocked = useWalletStore(s => s.unlocked);
  const activeChainId = useWalletStore(s => s.activeChainId);
  const addHardwareAccount = useWalletStore(s => s.addHardwareAccount);

  const [phase, setPhase] = useState<'idle' | 'scanning' | 'list' | 'busy'>('idle');
  const [accounts, setAccounts] = useState<LedgerDiscoveredAccount[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({ 0: true });
  const [error, setError] = useState('');

  const chainConfig = chainRegistry.get(activeChainId)?.config;
  const chainIsEvm = chainConfig?.type === 'evm';

  const scan = async () => {
    setError('');
    setPhase('scanning');
    try {
      const { eth, close } = await openEthApp();
      try {
        const list = await browseLedgerAccounts(eth, 0, 5);
        setAccounts(list);
        setPhase('list');
      } finally {
        await close().catch(() => undefined);
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  };

  const addSelected = async () => {
    setPhase('busy');
    setError('');
    try {
      // verify each address ON the device before trusting it (anti fake-UI)
      const { eth, close } = await openEthApp();
      try {
        for (const [idxStr, picked] of Object.entries(selected)) {
          if (!picked) continue;
          const idx = Number(idxStr);
          const found = accounts[idx];
          const confirmed = await eth.getAddress(found.path, true, false);
          if (confirmed.address.toLowerCase() !== found.address.toLowerCase()) {
            throw new Error(`device rejected address ${found.address}`);
          }
          const account: Account = {
            id: generateId(),
            chainId: activeChainId,
            address: found.address,
            publicKey: found.publicKey,
            derivationPath: found.path,
            accountIndex: idx,
            nickname: `Ledger #${idx + 1}`,
            createdAt: Date.now(),
            source: 'ledger',
          };
          addHardwareAccount(account);
        }
      } finally {
        await close().catch(() => undefined);
      }
      navigate('/', { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setPhase('list');
    }
  };

  const cardStyle: React.CSSProperties = {
    maxWidth: 520,
    margin: '0 auto',
    padding: 'var(--ow-space-6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--ow-space-4)',
    marginTop: '5vh',
  };

  if (!isHardwareAvailable()) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>{t('ledger.title')}</div>
        <div style={{ color: 'var(--ow-text-secondary)' }}>{t('ledger.unsupportedBrowser')}</div>
        <Button variant="secondary" onClick={() => navigate(-1)}>{t('common.back')}</Button>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-3)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft size={16} /></Button>
        <div style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>
          <Usb size={18} style={{ verticalAlign: -3 }} /> {t('ledger.title')}
        </div>
      </div>

      {!chainIsEvm && (
        <div style={{ color: 'var(--ow-error)', fontSize: 'var(--ow-font-size-sm)' }}>
          {t('ledger.evmOnly')}
        </div>
      )}
      {!unlocked && (
        <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)' }}>
          {t('ledger.unlockFirst')}
        </div>
      )}

      {phase === 'idle' && (
        <>
          <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)' }}>
            {t('ledger.scanHint')}
          </div>
          <Button onClick={scan} disabled={!chainIsEvm}>{t('ledger.connect')}</Button>
        </>
      )}

      {phase === 'scanning' && <Button loading disabled>{t('ledger.scanning')}</Button>}

      {(phase === 'list' || phase === 'busy') && (
        <>
          <div style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-text-secondary)' }}>
            {t('ledger.selectAccounts')}
          </div>
          {accounts.map((acc, idx) => (
            <button
              key={acc.address}
              type="button"
              onClick={() => setSelected(s => ({ ...s, [idx]: !s[idx] }))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--ow-space-3)',
                padding: 'var(--ow-space-3)',
                textAlign: 'left',
                backgroundColor: selected[idx] ? 'var(--ow-bg-hover)' : 'var(--ow-bg-secondary)',
                border: `1px solid ${selected[idx] ? 'var(--ow-accent)' : 'var(--ow-border)'}`,
                borderRadius: 'var(--ow-radius-md)',
                cursor: 'pointer',
                color: 'var(--ow-text-primary)',
              }}
            >
              <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}>
                {selected[idx] && <Check size={16} style={{ color: 'var(--ow-accent)' }} />}
              </span>
              <span>
                <span style={{ display: 'block', fontWeight: 600 }}>{t('ledger.accountN', { n: idx + 1 })}</span>
                <span style={{ display: 'block', fontFamily: 'var(--ow-font-mono)', fontSize: 'var(--ow-font-size-xs)' }}>
                  {acc.address}
                </span>
                <span style={{ display: 'block', fontSize: 10, color: 'var(--ow-text-tertiary)' }}>{acc.path}</span>
              </span>
            </button>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
            <ShieldCheck size={14} /> {t('ledger.verifyOnDevice')}
          </div>
          <Button onClick={addSelected} loading={phase === 'busy'} disabled={!chainIsEvm}>
            {t('ledger.addSelected')}
          </Button>
        </>
      )}

      {error && <div style={{ color: 'var(--ow-error)', fontSize: 'var(--ow-font-size-sm)' }}>{error}</div>}
    </div>
  );
}

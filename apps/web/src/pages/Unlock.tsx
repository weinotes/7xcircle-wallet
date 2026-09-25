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
 * Unlock page — password input to decrypt the vault.
 *
 * This page is shown when:
 *   - vaultExists === true (wallet is initialized)
 *   - unlocked === false (session not yet open)
 *
 * The user enters their password → unlock() → derive accounts →
 * automatically redirects to Home.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { Button, Input } from '@open-wallet/ui';
import { useWalletStore } from '../store/wallet.js';
import { CHAIN_CONFIGS } from '@open-wallet/chains';

export function Unlock() {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();
  const unlock = useWalletStore(s => s.unlock);
  const clearVault = useWalletStore(s => s.clearVault);

  const handleUnlock = async () => {
    setError('');
    if (!password) {
      setError(t('unlock.enterPassword'));
      return;
    }
    setLoading(true);
    try {
      // Derive accounts for ALL registered chains on unlock
      await unlock(password, CHAIN_CONFIGS);
      // Navigate — router re-renders from store.unlocked
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('Invalid password')) {
        setError(t('unlock.incorrectPassword'));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      // Clear password from DOM input regardless — best-effort
      setPassword('');
    }
  };

  const handleReset = async () => {
    if (confirm(t('unlock.resetConfirm'))) {
      clearVault();
    }
  };

  const cardStyle: React.CSSProperties = {
    maxWidth: 420,
    margin: '0 auto',
    padding: 'var(--ow-space-8)',
    backgroundColor: 'var(--ow-bg-secondary)',
    borderRadius: 'var(--ow-radius-xl)',
    border: '1px solid var(--ow-border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--ow-space-5)',
    marginTop: '15vh',
  };

  return (
    <div style={cardStyle}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--ow-space-3)',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          backgroundColor: 'var(--ow-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--ow-accent-fg)',
        }}>
          <KeyRound size={28} />
        </div>
        <div style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>
          {t('unlock.title')}
        </div>
        <div style={{
          fontSize: 'var(--ow-font-size-sm)',
          color: 'var(--ow-text-secondary)',
          textAlign: 'center',
        }}>
          {t('unlock.desc')}
        </div>
      </div>

      <Input
        label={t('unlock.passwordLabel')}
        type={showPassword ? 'text' : 'password'}
        placeholder={t('unlock.passwordPlaceholder')}
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleUnlock();
        }}
        error={error}
      />

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => setShowPassword(s => !s)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--ow-space-2)',
            fontSize: 'var(--ow-font-size-xs)',
            color: 'var(--ow-text-tertiary)',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            fontFamily: 'inherit',
          }}
        >
          {showPassword ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          {showPassword ? t('unlock.hidePassword') : t('unlock.showPassword')}
        </button>
      </div>

      <Button
        onClick={handleUnlock}
        loading={loading}
        disabled={!password || loading}
        size="lg"
      >
        {loading ? t('unlock.unlocking') : t('unlock.unlock')}
      </Button>

      <div style={{
        borderTop: '1px solid var(--ow-border-subtle)',
        paddingTop: 'var(--ow-space-3)',
        textAlign: 'center',
      }}>
        <button
          onClick={handleReset}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--ow-text-tertiary)',
            fontSize: 'var(--ow-font-size-xs)',
            cursor: 'pointer',
          }}
        >
          {t('unlock.forgotPassword')}
        </button>
      </div>
    </div>
  );
}

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
 * SecretKeys — public account info + password-gated reveals.
 *
 * Three tiers, deliberately separated:
 *   public    address / public key / source — always visible, copyable
 *   phrase    recovery phrase reveal — re-asks the password
 *   key       per-account private key export — re-asks the password
 *
 * An unlocked session is NOT enough for the bottom two: reveal attacks
 * (shoulder-surfing, screen capture, XSS while idle) are exactly what the
 * password re-gate defends against. Reveals auto-clear after a timeout.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import { Button, Input } from '@7xcircle/ui';
import { revealRecoveryPhrase, exportAccountPrivateKey } from '@7xcircle/core';
import { useWalletStore } from '../store/wallet.js';

const REVEAL_TTL_MS = 60_000;

export function SecretKeys() {
  const { t } = useTranslation();
  const vault = useWalletStore(s => s.encryptedVault);
  const account = useWalletStore(s =>
    s.accounts.find(a => a.id === s.activeAccountId));

  const [gate, setGate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<{ kind: 'phrase' | 'key'; value: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // reveals are ephemeral by design
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(null), REVEAL_TTL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard permission denied (insecure context) — value stays on screen
    }
  };

  const requireVault = (): boolean => {
    if (!vault || !account) {
      setError(t('keys.notReady'));
      return false;
    }
    return true;
  };

  const doRevealPhrase = async () => {
    if (!requireVault() || !gate) return;
    setBusy(true);
    setError('');
    try {
      const phrase = await revealRecoveryPhrase(vault!, gate);
      setRevealed({ kind: 'phrase', value: phrase });
      setGate('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doExportKey = async () => {
    if (!requireVault() || !gate) return;
    setBusy(true);
    setError('');
    try {
      const key = await exportAccountPrivateKey(account!, vault!, gate);
      setRevealed({ kind: 'key', value: key });
      setGate('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--ow-space-3)',
    padding: 'var(--ow-space-3) var(--ow-space-4)',
    backgroundColor: 'var(--ow-bg-secondary)',
    border: '1px solid var(--ow-border)',
    borderRadius: 'var(--ow-radius-md)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-3)' }}>
      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <KeyRound size={16} /> {t('keys.title')}
      </div>

      {/* ── public tier: address + pubkey, no gate ── */}
      {account && (
        <>
          <div style={rowStyle}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>{t('keys.address')}</div>
              <div style={{ fontFamily: 'var(--ow-font-mono)', fontSize: 'var(--ow-font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {account.address}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => copy('address', account.address)}>
              <Copy size={14} /> {copied === 'address' ? t('keys.copied') : t('keys.copy')}
            </Button>
          </div>
          <div style={rowStyle}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
                {t('keys.publicKey')} · {account.source === 'key' ? t('keys.sourceKey') : account.source === 'ledger' ? t('keys.sourceLedger') : account.derivationPath}
              </div>
              <div style={{ fontFamily: 'var(--ow-font-mono)', fontSize: 'var(--ow-font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {account.publicKey}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => copy('pubkey', account.publicKey)}>
              <Copy size={14} /> {copied === 'pubkey' ? t('keys.copied') : t('keys.copy')}
            </Button>
          </div>
        </>
      )}

      {/* ── secret tier: password re-gate ── */}
      <Input
        label={t('keys.passwordLabel')}
        type="password"
        placeholder={t('keys.passwordPlaceholder')}
        value={gate}
        onChange={e => setGate(e.target.value)}
        error={error}
      />
      <div style={{ display: 'flex', gap: 'var(--ow-space-2)' }}>
        <Button variant="secondary" size="sm" onClick={doRevealPhrase} loading={busy} disabled={!gate}>
          <Eye size={14} /> {t('keys.revealPhrase')}
        </Button>
        <Button variant="secondary" size="sm" onClick={doExportKey} disabled={!gate}>
          <Eye size={14} /> {t('keys.exportKey')}
        </Button>
        {revealed && (
          <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
            <EyeOff size={14} /> {t('keys.hide')}
          </Button>
        )}
      </div>

      {revealed && (
        <div style={{
          ...rowStyle,
          flexDirection: 'column',
          alignItems: 'stretch',
          borderColor: 'var(--ow-error)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ow-error)', fontSize: 'var(--ow-font-size-xs)' }}>
            <ShieldAlert size={14} /> {t('keys.revealWarning')}
          </div>
          <div style={{ fontFamily: 'var(--ow-font-mono)', fontSize: 'var(--ow-font-size-sm)', wordBreak: 'break-all', padding: 'var(--ow-space-2) 0' }}>
            {revealed.value}
          </div>
          <Button size="sm" variant="danger" onClick={() => copy('secret', revealed.value)}>
            <Copy size={14} /> {copied === 'secret' ? t('keys.copied') : t('keys.copy')}
          </Button>
        </div>
      )}
    </div>
  );
}

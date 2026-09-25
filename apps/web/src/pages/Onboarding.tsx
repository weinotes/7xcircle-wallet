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
 * Onboarding page — Create new wallet OR import existing wallet.
 *
 * Flow:
 *   Step 1: Create / Import choice
 *   Step 2: Generate or input mnemonic
 *   Step 3: (Create flow) Show mnemonic, ask user to verify
 *   Step 4: Set password → encrypt vault → auto-unlock → derive accounts
 *   Step 5: Done → route to Home (store.unlocked becomes true)
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createMnemonic, isValidMnemonic, evaluatePassword, encryptVault, encodeVaultSecret, parsePrivateKey, base58Encode } from '@open-wallet/core';
import type { VaultKeyEntry } from '@open-wallet/core';
import { Button, Input } from '@open-wallet/ui';
import { useWalletStore } from '../store/wallet.js';
import { CHAIN_CONFIGS } from '@open-wallet/chains';

type Step = 'choice' | 'create' | 'verify' | 'import' | 'password';

/** Randomly pick N word positions + generate distractors from the same mnemonic */
function buildVerifyQuiz(words: string[], count = 3): {
  positions: number[];          // indices into words[]
  options: string[][];          // count arrays, each has 1 correct + 3 distractors
} {
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const positions: number[] = [];
  const pickedIdx = new Set<number>();
  while (positions.length < count && pickedIdx.size < words.length) {
    const idx = Math.floor(Math.random() * words.length);
    if (!pickedIdx.has(idx)) {
      pickedIdx.add(idx);
      positions.push(idx);
    }
  }
  positions.sort((a, b) => a - b);

  const options = positions.map(pos => {
    const correct = words[pos];
    // Pick 3 distractors from the rest
    const distractors = shuffled.filter(w => w !== correct).slice(0, 3);
    const all = [correct, ...distractors].sort(() => Math.random() - 0.5);
    return all;
  });

  return { positions, options };
}

export function Onboarding() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('choice');
  const [mode, setMode] = useState<'create' | 'import'>('create');
  const [mnemonic, setMnemonic] = useState('');
  const [importMnemonic, setImportMnemonic] = useState('');
  /** import sub-mode: recovery phrase vs raw private key(s) */
  const [importKind, setImportKind] = useState<'phrase' | 'key'>('phrase');
  const [keyFamily, setKeyFamily] = useState<VaultKeyEntry['family']>('evm');
  const [keyInput, setKeyInput] = useState('');
  /** keys staged in the import step, encrypted into the vault at password-set */
  const [importedKeys, setImportedKeys] = useState<VaultKeyEntry[]>([]);
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Verify step state
  const verify = useMemo(
    () => (mnemonic ? buildVerifyQuiz(mnemonic.split(' '), 3) : null),
    [mnemonic],
  );
  const [verifyAnswers, setVerifyAnswers] = useState<Record<number, string>>({});

  const setVault = useWalletStore(s => s.setVault);
  const unlock = useWalletStore(s => s.unlock);

  const go = (next: Step) => { setError(''); setStep(next); };

  const handleCreateNew = () => {
    setMode('create');
    setMnemonic(createMnemonic(wordCount));
    setVerifyAnswers({});
    go('create');
  };

  /** Switching length on the phrase screen regenerates — the old one was never backed up yet */
  const handleWordCountChange = (n: 12 | 24) => {
    setWordCount(n);
    setMnemonic(createMnemonic(n));
    setVerifyAnswers({});
  };

  const handleImport = () => {
    setMode('import');
    setImportKind('phrase');
    setImportedKeys([]);
    go('import');
  };

  const handleImportNext = () => {
    if (importKind === 'key') {
      handleAddKey();
      return;
    }
    if (!isValidMnemonic(importMnemonic)) {
      setError(t('onboarding.invalidMnemonic'));
      return;
    }
    setMnemonic(importMnemonic.trim());
    go('password');
  };

  /** Parse + stage one pasted key (canonicalized so export round-trips) */
  const handleAddKey = () => {
    try {
      const parsed = parsePrivateKey(keyFamily, keyInput);
      const canonical = keyFamily === 'solana'
        ? base58Encode(parsed.privateKey)
        : '0x' + Array.from(parsed.privateKey).map(b => b.toString(16).padStart(2, '0')).join('');
      setImportedKeys(prev => {
        if (prev.some(k => k.privateKey === canonical)) return prev;
        return [...prev, { family: keyFamily, privateKey: canonical }];
      });
      setKeyInput('');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Move from key staging to password creation */
  const handleKeysDone = () => {
    if (importedKeys.length === 0) {
      setError(t('onboarding.noKeysStaged'));
      return;
    }
    go('password');
  };

  const handleVerifyNext = () => {
    // In create mode → go through verify step first
    if (mode === 'create') {
      go('verify');
    } else {
      go('password');
    }
  };

  const handleVerifySubmit = () => {
    if (!verify) return;
    const words = mnemonic.split(' ');
    const correct = verify.positions.every(
      pos => verifyAnswers[pos] === words[pos],
    );
    if (!correct) {
      setError(t('onboarding.incorrectVerify'));
      // Reset so they can try again
      setVerifyAnswers({});
      return;
    }
    setError('');
    go('password');
  };

  const handlePasswordNext = async () => {
    if (password !== confirmPassword) {
      setError(t('onboarding.passwordsDoNotMatch'));
      return;
    }
    const evalResult = evaluatePassword(password);
    if (evalResult.score < 2) {
      setError(evalResult.errors[0] ?? t('onboarding.passwordTooWeak'));
      return;
    }

    setLoading(true);
    try {
      // Everything the vault holds goes through the envelope — mnemonic HD
      // or imported raw keys; decodeVaultSecret still reads pre-envelope vaults.
      const plaintext = mode === 'import' && importKind === 'key'
        ? encodeVaultSecret({ kind: 'keys', keys: importedKeys })
        : encodeVaultSecret({ kind: 'mnemonic', mnemonic });
      const vault = await encryptVault(plaintext, password);
      setVault(vault);
      // Auto-unlock immediately → derive accounts across all chains
      // Router will switch from Onboarding to Home after store.unlocked becomes true
      await unlock(password, CHAIN_CONFIGS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ──────────── Render helpers ────────────

  const cardStyle: React.CSSProperties = {
    maxWidth: 480,
    margin: '0 auto',
    padding: 'var(--ow-space-8)',
    backgroundColor: 'var(--ow-bg-secondary)',
    borderRadius: 'var(--ow-radius-xl)',
    border: '1px solid var(--ow-border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--ow-space-5)',
    marginTop: '10vh',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 'var(--ow-font-size-2xl)',
    fontWeight: 700,
    textAlign: 'center',
  };

  // ──────────── Step 1: Choice ────────────
  if (step === 'choice') {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>7xCircle Wallet</div>
        <div style={{ textAlign: 'center', color: 'var(--ow-text-secondary)' }}>
          {t('onboarding.slogan')}
        </div>
        <Button size="lg" onClick={handleCreateNew}>{t('onboarding.createNewWallet')}</Button>
        <Button variant="secondary" size="lg" onClick={handleImport}>{t('onboarding.importExistingWallet')}</Button>
        <div style={{ textAlign: 'center', fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
          {t('onboarding.license')}
        </div>
      </div>
    );
  }

  // ──────────── Step 2: Show generated mnemonic ────────────
  if (step === 'create') {
    const words = mnemonic.split(' ');
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>{t('onboarding.recoveryPhraseTitle')}</div>
        {/* word length choice — 12 (128-bit) and 24 (256-bit) are both BIP-39 standard */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--ow-space-2)' }}>
          {([12, 24] as const).map(n => (
            <button
              key={n}
              type="button"
              onClick={() => handleWordCountChange(n)}
              style={{
                padding: 'var(--ow-space-2) var(--ow-space-4)',
                backgroundColor: wordCount === n ? 'var(--ow-info)' : 'var(--ow-bg-tertiary)',
                color: wordCount === n ? '#000' : 'var(--ow-text-primary)',
                border: wordCount === n ? '2px solid var(--ow-info)' : '1px solid var(--ow-border-subtle)',
                borderRadius: 'var(--ow-radius-md)',
                cursor: 'pointer',
              }}
            >
              {t('onboarding.wordCountOption', { count: n })}
            </button>
          ))}
        </div>
        <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)', textAlign: 'center' }}>
          {t('onboarding.writeWords', { count: words.length })}
        </div>
        <div style={{
          backgroundColor: 'var(--ow-bg-tertiary)',
          padding: 'var(--ow-space-4)',
          borderRadius: 'var(--ow-radius-md)',
          border: '1px solid var(--ow-border)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--ow-space-2)',
            fontFamily: 'var(--ow-font-mono)',
            fontSize: 'var(--ow-font-size-sm)',
          }}>
            {words.map((w, i) => (
              <div key={i} style={{
                display: 'flex',
                gap: 'var(--ow-space-2)',
                padding: '2px 4px',
              }}>
                <span style={{ color: 'var(--ow-text-tertiary)', minWidth: '24px', textAlign: 'right' }}>{i + 1}.</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ color: 'var(--ow-error)', fontSize: 'var(--ow-font-size-xs)', textAlign: 'center' }}>
          {t('onboarding.neverShare')}
        </div>
        <Button onClick={handleVerifyNext}>{t('onboarding.savedContinue')}</Button>
      </div>
    );
  }

  // ──────────── Step 3: Verify recovery phrase ────────────
  if (step === 'verify' && verify) {
    const words = mnemonic.split(' ');
    const allCorrect = verify.positions.every(pos => verifyAnswers[pos] === words[pos]);

    return (
      <div style={cardStyle}>
        <div style={titleStyle}>{t('onboarding.verifyTitle')}</div>
        <div style={{ color: 'var(--ow-text-secondary)', textAlign: 'center', fontSize: 'var(--ow-font-size-sm)' }}>
          {t('onboarding.verifyDesc')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-4)' }}>
          {verify.positions.map((pos, idx) => (
            <div key={pos}>
              <div style={{
                fontSize: 'var(--ow-font-size-sm)',
                color: 'var(--ow-text-tertiary)',
                marginBottom: 'var(--ow-space-2)',
              }}>
                {t('onboarding.wordNumber', { n: pos + 1 })}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 'var(--ow-space-2)',
              }}>
                {verify.options[idx].map(opt => {
                  const selected = verifyAnswers[pos] === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => { setError(''); setVerifyAnswers(prev => ({ ...prev, [pos]: opt })); }}
                      style={{
                        padding: 'var(--ow-space-3)',
                        backgroundColor: selected ? 'var(--ow-info)' : 'var(--ow-bg-tertiary)',
                        color: selected ? '#000' : 'var(--ow-text-primary)',
                        border: selected ? '2px solid var(--ow-info)' : '1px solid var(--ow-border-subtle)',
                        borderRadius: 'var(--ow-radius-md)',
                        fontFamily: 'var(--ow-font-mono)',
                        fontSize: 'var(--ow-font-size-sm)',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div style={{
            color: 'var(--ow-error)',
            fontSize: 'var(--ow-font-size-sm)',
            textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        <Button onClick={handleVerifySubmit} disabled={!allCorrect}>
          {t('common.continue')}
        </Button>
        <Button variant="ghost" onClick={() => go('create')}>← {t('common.back')}</Button>
      </div>
    );
  }

  // ──────────── Step 4: Import ────────────
  if (step === 'import') {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>{t('onboarding.importTitle')}</div>
        {/* phrase vs raw private key — TP migrants routinely carry single keys out */}
        <div style={{ display: 'flex', gap: 'var(--ow-space-2)' }}>
          {(['phrase', 'key'] as const).map(kind => (
            <button
              key={kind}
              type="button"
              onClick={() => { setImportKind(kind); setError(''); }}
              style={{
                flex: 1,
                padding: 'var(--ow-space-2)',
                backgroundColor: importKind === kind ? 'var(--ow-info)' : 'var(--ow-bg-tertiary)',
                color: importKind === kind ? '#000' : 'var(--ow-text-primary)',
                border: importKind === kind ? '2px solid var(--ow-info)' : '1px solid var(--ow-border-subtle)',
                borderRadius: 'var(--ow-radius-md)',
                cursor: 'pointer',
              }}
            >
              {t(`onboarding.importTab.${kind}`)}
            </button>
          ))}
        </div>

        {importKind === 'phrase' ? (
          <>
            <Input
              label={t('onboarding.importLabel')}
              placeholder={t('onboarding.importPlaceholder')}
              value={importMnemonic}
              onChange={e => setImportMnemonic(e.target.value)}
              error={error}
            />
            <Button onClick={handleImportNext} disabled={!importMnemonic.trim()}>{t('common.next')}</Button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 'var(--ow-space-2)' }}>
              {(['evm', 'solana', 'tron'] as const).map(fam => (
                <button
                  key={fam}
                  type="button"
                  onClick={() => setKeyFamily(fam)}
                  style={{
                    flex: 1,
                    padding: 'var(--ow-space-2)',
                    fontSize: 'var(--ow-font-size-sm)',
                    backgroundColor: keyFamily === fam ? 'var(--ow-bg-tertiary)' : 'transparent',
                    color: 'var(--ow-text-primary)',
                    border: keyFamily === fam ? '2px solid var(--ow-info)' : '1px solid var(--ow-border-subtle)',
                    borderRadius: 'var(--ow-radius-md)',
                    cursor: 'pointer',
                  }}
                >
                  {t(`onboarding.keyFamily.${fam}`)}
                </button>
              ))}
            </div>
            <Input
              label={t('onboarding.keyLabel')}
              placeholder={t('onboarding.keyPlaceholder')}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              error={error}
            />
            <Button onClick={handleImportNext} disabled={!keyInput.trim()} variant="secondary">
              {t('onboarding.addKey')}
            </Button>
            {importedKeys.length > 0 && (
              <div style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-text-secondary)' }}>
                {t('onboarding.keysStaged', { count: importedKeys.length })}
                <div style={{ marginTop: 'var(--ow-space-1)' }}>
                  {importedKeys.map((k, i) => (
                    <div key={k.privateKey} style={{ fontFamily: 'var(--ow-font-mono)' }}>
                      {k.family} · {k.privateKey.slice(0, 6)}…{k.privateKey.slice(-4)}
                      <button
                        type="button"
                        aria-label={`remove key ${i}`}
                        onClick={() => setImportedKeys(prev => prev.filter(x => x !== k))}
                        style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--ow-error)', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Button onClick={handleKeysDone} disabled={importedKeys.length === 0}>
              {t('common.next')}
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={() => go('choice')}>← {t('common.back')}</Button>
      </div>
    );
  }

  // ──────────── Step 5: Set password ────────────
  return (
    <div style={cardStyle}>
      <div style={titleStyle}>{t('onboarding.setPasswordTitle')}</div>
      <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)', textAlign: 'center' }}>
        {t('onboarding.setPasswordDesc')}
      </div>
      <Input
        label={t('onboarding.passwordLabel')}
        type="password"
        placeholder={t('onboarding.passwordPlaceholder')}
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      <Input
        label={t('onboarding.confirmPasswordLabel')}
        type="password"
        placeholder={t('onboarding.confirmPasswordPlaceholder')}
        value={confirmPassword}
        onChange={e => setConfirmPassword(e.target.value)}
        error={error}
      />
      <Button onClick={handlePasswordNext} variant="primary" loading={loading}>
        {mode === 'create' ? t('onboarding.createWallet') : t('onboarding.importWallet')}
      </Button>
      <Button variant="ghost" onClick={() => go(mode === 'create' ? 'verify' : 'import')}>← {t('common.back')}</Button>
    </div>
  );
}

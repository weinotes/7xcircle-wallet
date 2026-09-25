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
 * Settings — Theme, language, about, reset wallet.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, ChevronDown, Check, Usb } from 'lucide-react';
import { Button, Modal } from '@7xcircle/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWalletStore } from '../store/wallet.js';
import { SecretKeys } from './SecretKeys.js';
import { LANGUAGES } from '@7xcircle/shared';
import type { AppLanguage } from '@7xcircle/shared';

/** Native display name for each supported language */
const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  fr: 'Français',
  ko: '한국어',
  ar: 'العربية',
};

/** Secondary label shown next to the native name (region / script hint) */
const LANGUAGE_SUBTITLES: Record<AppLanguage, string> = {
  en: 'English (US)',
  zh: '简体中文',
  ja: 'にほんご',
  fr: 'Français (France)',
  ko: '한국어 (대한민국)',
  ar: 'العربية',
};

export function Settings() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useWalletStore(s => s.theme);
  const language = useWalletStore(s => s.language);
  const setTheme = useWalletStore(s => s.setTheme);
  const setLanguage = useWalletStore(s => s.setLanguage);
  const clearVault = useWalletStore(s => s.clearVault);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageRef = useRef<HTMLDivElement | null>(null);

  // Close the language dropdown on outside click
  useEffect(() => {
    if (!languageOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (languageRef.current && !languageRef.current.contains(e.target as Node)) {
        setLanguageOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [languageOpen]);

  const cardStyle: React.CSSProperties = {
    maxWidth: 560,
    margin: '0 auto',
    padding: 'var(--ow-space-6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--ow-space-5)',
    marginTop: '5vh',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 'var(--ow-space-4)',
    backgroundColor: 'var(--ow-bg-secondary)',
    border: '1px solid var(--ow-border)',
    borderRadius: 'var(--ow-radius-md)',
  };

  const handleReset = () => {
    clearVault();
    navigate('/', { replace: true });
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-3)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </Button>
        <div style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>{t('settings.title')}</div>
      </div>

      <div style={rowStyle}>
        <span>{t('settings.theme')}</span>
        <div style={{ display: 'flex', gap: 'var(--ow-space-2)' }}>
          <Button size="sm" variant={theme === 'dark' ? 'primary' : 'secondary'} onClick={() => setTheme('dark')}>{t('settings.dark')}</Button>
          <Button size="sm" variant={theme === 'light' ? 'primary' : 'secondary'} onClick={() => setTheme('light')}>{t('settings.light')}</Button>
        </div>
      </div>

      {/* ── Language (MetaMask-style row dropdown, follows device by default) ── */}
      <div ref={languageRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setLanguageOpen(o => !o)}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--ow-space-4)',
            backgroundColor: 'var(--ow-bg-secondary)',
            border: '1px solid var(--ow-border)',
            borderRadius: 'var(--ow-radius-md)',
            cursor: 'pointer',
            color: 'var(--ow-text-primary)',
            fontFamily: 'inherit',
            fontSize: 'var(--ow-font-size-sm)',
          }}
        >
          <span>{t('settings.language')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)' }}>
            <span style={{ color: 'var(--ow-text-secondary)' }}>
              {LANGUAGE_LABELS[language]}
            </span>
            <ChevronDown
              size={16}
              style={{
                color: 'var(--ow-text-tertiary)',
                transition: 'transform 150ms',
                transform: languageOpen ? 'rotate(180deg)' : 'none',
              }}
            />
          </span>
        </button>

        {/* Dropdown panel */}
        {languageOpen && (
          <div
            role="listbox"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 100,
              backgroundColor: 'var(--ow-bg-secondary)',
              border: '1px solid var(--ow-border)',
              borderRadius: 'var(--ow-radius-md)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              overflow: 'hidden',
            }}
          >
            {LANGUAGES.map(lang => {
              const selected = language === lang;
              return (
                <button
                  key={lang}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setLanguage(lang);
                    setLanguageOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--ow-space-3)',
                    padding: '10px 12px',
                    backgroundColor: selected
                      ? 'var(--ow-bg-hover)'
                      : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--ow-text-primary)',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    fontSize: 'var(--ow-font-size-sm)',
                  }}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.backgroundColor = 'var(--ow-bg-hover)'; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  {/* Check mark column — selected language gets a check */}
                  <span style={{ width: 16, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    {selected && <Check size={16} style={{ color: 'var(--ow-accent)' }} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: selected ? 600 : 400 }}>
                      {LANGUAGE_LABELS[lang]}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ow-text-tertiary)' }}>
                      {LANGUAGE_SUBTITLES[lang]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={rowStyle}>
        <span>{t('settings.about')}</span>
        <span style={{ color: 'var(--ow-text-tertiary)', fontSize: 'var(--ow-font-size-sm)' }}>v0.1.0 · Apache-2.0</span>
      </div>

      {/* address / public key export + password-gated phrase & private-key reveals */}
      <SecretKeys />

      {/* ── Hardware wallet (WebUSB — desktop Chrome / extension popup) ── */}
      <button
        type="button"
        onClick={() => navigate('/ledger')}
        style={{
          ...rowStyle,
          width: '100%',
          cursor: 'pointer',
          color: 'var(--ow-text-primary)',
          fontFamily: 'inherit',
          fontSize: 'var(--ow-font-size-sm)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)' }}>
          <Usb size={16} /> {t('settings.hardwareWallet')}
        </span>
        <span style={{ color: 'var(--ow-text-tertiary)' }}>Ledger · OneKey →</span>
      </button>

      <div style={{ borderTop: '1px solid var(--ow-border)', paddingTop: 'var(--ow-space-4)' }}>
        <Button variant="danger" onClick={() => setShowResetConfirm(true)} style={{ width: '100%' }}>
          <Trash2 size={16} /> {t('settings.resetWallet')}
        </Button>
        <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-error)', textAlign: 'center', marginTop: 'var(--ow-space-2)' }}>
          {t('settings.resetWarning')}
        </div>
      </div>

      <Modal
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title={t('settings.resetConfirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowResetConfirm(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={handleReset}>{t('settings.yesReset')}</Button>
          </>
        }
      >
        <div style={{ color: 'var(--ow-text-secondary)' }}>
          {t('settings.resetConfirmDesc')}
        </div>
      </Modal>
    </div>
  );
}

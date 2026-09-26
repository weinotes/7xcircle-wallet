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
 * Project landing page — served at `/`, the wallet app lives at `/app`.
 *
 * Marketing and tool are deliberately separate: visitors arriving from a
 * link meet the *project* (what it is, why trust it, where the code is),
 * and only click through into the create/import flow. Every claim here
 * must match verifiable behaviour — the same honesty bar as the README
 * (no future features advertised; fees and alpha status stated plainly).
 *
 * The CTA is a real <a href="/app">, not a router <Link>: main.tsx picks
 * the wallet tree (BrowserRouter basename=/app) vs this landing tree at
 * mount time, so a client-side navigation would bypass that split.
 */

import { useTranslation } from 'react-i18next';
import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowLeftRight,
  Coins,
  ExternalLink,
  KeyRound,
  Plug,
  ShieldCheck,
  Usb,
  Wallet,
} from 'lucide-react';

const GITHUB_URL = 'https://github.com/weinotes/7xcircle-wallet';
const RELEASES_URL = `${GITHUB_URL}/releases/tag/v0.1.0`;

const sectionStyle: CSSProperties = {
  maxWidth: 980,
  margin: '0 auto',
  padding: '48px 24px',
};

const cardStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  padding: 20,
  borderRadius: 'var(--ow-radius-xl)',
  border: '1px solid var(--ow-border-subtle)',
  background: 'var(--ow-bg-secondary)',
};

const iconWrapStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: 'var(--ow-radius-md)',
  background: 'var(--ow-bg-tertiary)',
  color: 'var(--ow-accent)',
};

/** Feature icon slot — lucide elements are ReactNodes. */
type FeatureIcon = ReactNode;

export function Landing() {
  const { t } = useTranslation();

  const features: Array<{ icon: FeatureIcon; t: string; d: string }> = [
    { icon: <Coins size={20} />, t: t('landing.f1t'), d: t('landing.f1d') },
    { icon: <KeyRound size={20} />, t: t('landing.f2t'), d: t('landing.f2d') },
    { icon: <Plug size={20} />, t: t('landing.f3t'), d: t('landing.f3d') },
    { icon: <ShieldCheck size={20} />, t: t('landing.f4t'), d: t('landing.f4d') },
    { icon: <ArrowLeftRight size={20} />, t: t('landing.f5t'), d: t('landing.f5d') },
    { icon: <Usb size={20} />, t: t('landing.f6t'), d: t('landing.f6d') },
  ];

  return (
    <div style={{ minHeight: '100vh', color: 'var(--ow-text-primary)' }}>
      {/* ── Top bar ── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid var(--ow-border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <Wallet size={20} color="var(--ow-accent)" />
          <span>7xCircle Wallet</span>
        </div>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--ow-text-secondary)',
            textDecoration: 'none',
            fontSize: 'var(--ow-font-size-sm)',
          }}
        >
          GitHub <ExternalLink size={14} />
        </a>
      </header>

      {/* ── Hero ── */}
      <section style={{ ...sectionStyle, textAlign: 'center', paddingTop: 72, paddingBottom: 56 }}>
        <span
          style={{
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: 999,
            border: '1px solid var(--ow-border)',
            background: 'var(--ow-bg-tertiary)',
            color: 'var(--ow-text-secondary)',
            fontSize: 'var(--ow-font-size-xs)',
            marginBottom: 20,
          }}
        >
          {t('landing.badge')}
        </span>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', lineHeight: 1.2, margin: '0 auto 16px', maxWidth: 720 }}>
          {t('landing.headline')}
        </h1>
        <p style={{ color: 'var(--ow-text-secondary)', maxWidth: 620, margin: '0 auto 32px', lineHeight: 1.6 }}>
          {t('landing.sub')}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="/app"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 28px',
              borderRadius: 'var(--ow-radius-md)',
              background: 'var(--ow-accent)',
              color: 'var(--ow-accent-fg)',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            {t('landing.ctaOpen')}
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 28px',
              borderRadius: 'var(--ow-radius-md)',
              border: '1px solid var(--ow-border)',
              color: 'var(--ow-text-primary)',
              textDecoration: 'none',
            }}
          >
            {t('landing.ctaGithub')} <ExternalLink size={14} />
          </a>
        </div>
        <p style={{ color: 'var(--ow-text-tertiary)', fontSize: 'var(--ow-font-size-xs)', marginTop: 20 }}>
          {t('landing.alphaWarn')}
        </p>
      </section>

      {/* ── Features ── */}
      <section style={sectionStyle}>
        <h2 style={{ textAlign: 'center', marginBottom: 28, color: 'var(--ow-text-primary)' }}>
          {t('landing.featuresHead')}
        </h2>
        <div
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          {features.map(f => (
            <div key={f.t} style={cardStyle}>
              <span style={iconWrapStyle}>{f.icon}</span>
              <div style={{ flex: 3 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{f.t}</div>
                <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)', lineHeight: 1.5 }}>
                  {f.d}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Trust ── */}
      <section style={sectionStyle}>
        <h2 style={{ textAlign: 'center', marginBottom: 24 }}>{t('landing.trustHead')}</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 auto', maxWidth: 640, display: 'grid', gap: 12 }}>
          {['landing.t1', 'landing.t2', 'landing.t3'].map(k => (
            <li key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline', color: 'var(--ow-text-secondary)' }}>
              <ShieldCheck size={16} color="var(--ow-accent)" style={{ flexShrink: 0, transform: 'translateY(2px)' }} />
              <span>{t(k)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Get / download ── */}
      <section style={sectionStyle}>
        <h2 style={{ textAlign: 'center', marginBottom: 24 }}>{t('landing.getHead')}</h2>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
          <div style={cardStyle}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('landing.getWeb')}</div>
              <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)' }}>{t('landing.getWebD')}</div>
              <a href="/app" style={{ display: 'inline-block', marginTop: 8, color: 'var(--ow-accent)', fontWeight: 700, textDecoration: 'none' }}>
                {t('landing.ctaOpen')}
              </a>
            </div>
          </div>
          <div style={cardStyle}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('landing.getAndroid')}</div>
              <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)' }}>{t('landing.getAndroidD')}</div>
              <a href={RELEASES_URL} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, color: 'var(--ow-accent)', fontWeight: 700, textDecoration: 'none' }}>
                v0.1.0 <ExternalLink size={13} />
              </a>
            </div>
          </div>
          <div style={cardStyle}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('landing.getExt')}</div>
              <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)' }}>{t('landing.getExtD')}</div>
              <a href={`${GITHUB_URL}#browser-extension`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, color: 'var(--ow-accent)', fontWeight: 700, textDecoration: 'none' }}>
                README <ExternalLink size={13} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: '1px solid var(--ow-border-subtle)',
          padding: '24px',
          textAlign: 'center',
          color: 'var(--ow-text-tertiary)',
          fontSize: 'var(--ow-font-size-xs)',
        }}
      >
        {t('landing.footer')} · <a href={`${GITHUB_URL}/blob/main/LICENSE`} style={{ color: 'inherit' }}>Apache-2.0</a> ·{' '}
        <a href={`${GITHUB_URL}/blob/main/SECURITY.md`} style={{ color: 'inherit' }}>SECURITY.md</a> ·{' '}
        <a href={`${GITHUB_URL}/blob/main/CHANGELOG.md`} style={{ color: 'inherit' }}>CHANGELOG</a>
      </footer>
    </div>
  );
}

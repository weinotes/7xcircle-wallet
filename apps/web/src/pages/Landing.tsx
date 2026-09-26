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
 * Visual language: Apple-keynote style — deep #09090B canvas, the 7X Circle
 * brand gradient (indigo #6366F1 → purple #8B5CF6) as text fills, glows and
 * pill shadows, glassmorphism sections, oversized centred type, scroll
 * reveals. Fixed-dark by design (marketing surface); the wallet app under
 * /app keeps the themeable --ow-* token system. See styles/landing.css.
 *
 * Content law (unchanged): every claim here must match shipped, verifiable
 * behaviour — the same honesty bar as the README and the §0 monetization
 * board. No EVM swap, no Marinade referral.
 *
 * The CTA is a real <a href="/app">, not a router <Link>: main.tsx picks
 * the wallet tree (BrowserRouter basename=/app) vs this landing tree at
 * mount time, so the switch across trees MUST be a real reload.
 */

import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import i18n, { syncDocumentDirection } from '../i18n/index.js';
import { useWalletStore } from '../store/wallet.js';
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
import '../styles/landing.css';

const GITHUB_URL = 'https://github.com/weinotes/7xcircle-wallet';
const RELEASES_URL = `${GITHUB_URL}/releases/tag/v0.1.0`;

type FeatureIcon = ReactNode;

/**
 * One-shot scroll reveal: elements marked [data-ld-reveal] fade+rise in
 * when they enter the viewport, then stop observing. CSS handles the
 * prefers-reduced-motion escape hatch (reveals just appear).
 */
function useScrollReveal(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const targets = root.querySelectorAll<HTMLElement>('[data-ld-reveal]');
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('ld-shown');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    targets.forEach(t => observer.observe(t));
    return () => observer.disconnect();
  }, [rootRef]);
}

export function Landing() {
  const { t } = useTranslation();
  const language = useWalletStore(s => s.language);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Same sync the wallet tree does (App.tsx): the persisted language — not
  // just the browser locale — must drive copy and RTL direction here, or a
  // user who picked English sees a Chinese landing over an English wallet.
  useEffect(() => {
    void i18n.changeLanguage(language);
    syncDocumentDirection(language);
  }, [language]);

  useScrollReveal(rootRef);

  const features: Array<{ icon: FeatureIcon; t: string; d: string }> = [
    { icon: <Coins size={22} />, t: t('landing.f1t'), d: t('landing.f1d') },
    { icon: <KeyRound size={22} />, t: t('landing.f2t'), d: t('landing.f2d') },
    { icon: <Plug size={22} />, t: t('landing.f3t'), d: t('landing.f3d') },
    { icon: <ShieldCheck size={22} />, t: t('landing.f4t'), d: t('landing.f4d') },
    { icon: <ArrowLeftRight size={22} />, t: t('landing.f5t'), d: t('landing.f5d') },
    { icon: <Usb size={22} />, t: t('landing.f6t'), d: t('landing.f6d') },
  ];

  return (
    <div className="ld" ref={rootRef}>
      {/* ── Sticky glass nav ── */}
      <header className="ld-nav">
        <span className="ld-nav-brand">
          <Wallet size={19} className="ld-gradient-text" color="var(--ld-indigo)" />
          7xCircle Wallet
        </span>
        <nav className="ld-nav-actions">
          <a className="ld-nav-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="ld-pill ld-pill-primary ld-pill-small" href="/app">
            {t('landing.ctaOpen')}
          </a>
        </nav>
      </header>

      {/* ── Hero with ambient gradient glow ── */}
      <div style={{ position: 'relative' }}>
        <div className="ld-glow" aria-hidden="true" />
        <section className="ld-wrap ld-hero">
          <span className="ld-badge" data-ld-reveal>{t('landing.badge')}</span>
          <h1 className="ld-gradient-text" data-ld-reveal style={{ transitionDelay: '60ms' }}>
            {t('landing.headline')}
          </h1>
          <p className="ld-hero-sub" data-ld-reveal style={{ transitionDelay: '120ms' }}>
            {t('landing.sub')}
          </p>
          <div className="ld-hero-cta" data-ld-reveal style={{ transitionDelay: '180ms' }}>
            <a className="ld-pill ld-pill-primary" href="/app">
              {t('landing.ctaOpen')}
            </a>
            <a className="ld-pill ld-pill-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
              {t('landing.ctaGithub')} <ExternalLink size={14} />
            </a>
          </div>
          <p className="ld-hero-note" data-ld-reveal style={{ transitionDelay: '240ms' }}>
            {t('landing.alphaWarn')}
          </p>
        </section>
      </div>

      {/* ── Features ── */}
      <section className="ld-wrap ld-section">
        <h2 className="ld-section-title" data-ld-reveal>{t('landing.featuresHead')}</h2>
        <div className="ld-grid">
          {features.map((f, i) => (
            <div key={f.t} className="ld-card" data-ld-reveal style={{ transitionDelay: `${i * 60}ms` }}>
              <span className="ld-card-icon">{f.icon}</span>
              <h3>{f.t}</h3>
              <p>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Trust slab ── */}
      <section className="ld-wrap ld-section" style={{ paddingTop: 0 }}>
        <h2 className="ld-section-title" data-ld-reveal>{t('landing.trustHead')}</h2>
        <div className="ld-trust" data-ld-reveal>
          {['landing.t1', 'landing.t2', 'landing.t3'].map(k => (
            <div key={k} className="ld-trust-item">
              <ShieldCheck size={17} className="ld-trust-check" />
              <span>{t(k)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Get / download ── */}
      <section className="ld-wrap ld-section" style={{ paddingTop: 0 }}>
        <h2 className="ld-section-title" data-ld-reveal>{t('landing.getHead')}</h2>
        <div className="ld-grid">
          <div className="ld-card" data-ld-reveal>
            <h3>{t('landing.getWeb')}</h3>
            <p>{t('landing.getWebD')}</p>
            <a className="ld-get-link" href="/app">
              {t('landing.ctaOpen')} <ExternalLink size={13} />
            </a>
          </div>
          <div className="ld-card" data-ld-reveal style={{ transitionDelay: '80ms' }}>
            <h3>{t('landing.getAndroid')}</h3>
            <p>{t('landing.getAndroidD')}</p>
            <a className="ld-get-link" href={RELEASES_URL} target="_blank" rel="noreferrer">
              v0.1.0 <ExternalLink size={13} />
            </a>
          </div>
          <div className="ld-card" data-ld-reveal style={{ transitionDelay: '160ms' }}>
            <h3>{t('landing.getExt')}</h3>
            <p>{t('landing.getExtD')}</p>
            <a className="ld-get-link" href={`${GITHUB_URL}#browser-extension`} target="_blank" rel="noreferrer">
              README <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="ld-footer">
        {t('landing.footer')} ·{' '}
        <a href={`${GITHUB_URL}/blob/main/LICENSE`}>Apache-2.0</a> ·{' '}
        <a href={`${GITHUB_URL}/blob/main/SECURITY.md`}>SECURITY.md</a> ·{' '}
        <a href={`${GITHUB_URL}/blob/main/CHANGELOG.md`}>CHANGELOG</a>
      </footer>
    </div>
  );
}

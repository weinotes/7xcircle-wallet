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
 * i18next configuration — 7xCircle Wallet UI localization.
 *
 * Languages: English, 中文, 日本語, Français, 한국어, العربية.
 * Arabic (ar) is RTL — set document.dir in syncLanguage().
 *
 * The store's language preference is the source of truth; we call
 * i18n.changeLanguage() whenever the user switches language in Settings.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { detectSystemLanguage } from '@7xcircle/shared';

import en from './locales/en.js';
import zh from './locales/zh.js';
import ja from './locales/ja.js';
import fr from './locales/fr.js';
import ko from './locales/ko.js';
import ar from './locales/ar.js';

export const SUPPORTED_LANGUAGES = ['en', 'zh', 'ja', 'fr', 'ko', 'ar'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** RTL languages (only Arabic today) */
const RTL_LANGUAGES: SupportedLanguage[] = ['ar'];

/** Sync the document direction for RTL (Arabic) vs LTR layouts */
export function syncDocumentDirection(lang: string): void {
  const isRtl = RTL_LANGUAGES.includes(lang as SupportedLanguage);
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
}

export const resources = {
  en: { translation: en },
  zh: { translation: zh },
  ja: { translation: ja },
  fr: { translation: fr },
  ko: { translation: ko },
  ar: { translation: ar },
} as const;

// Start in the device/system language; the App component then syncs
// i18next to the (possibly persisted) store preference after hydration.
const initialLanguage = detectSystemLanguage();

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLanguage,
    fallbackLng: 'en',
    interpolation: {
      // React already escapes — no need for i18next escaping
      escapeValue: false,
    },
    // Disable console warnings about missing keys
    returnNull: false,
  });

// Initial direction sync
syncDocumentDirection(initialLanguage);

export default i18n;

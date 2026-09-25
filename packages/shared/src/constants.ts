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
 * Application-wide constants.
 */

/** Current vault encryption schema version */
export const VAULT_VERSION = 1;

/** PBKDF2 iterations for key derivation (OWASP 2023 recommendation) */
export const PBKDF2_ITERATIONS = 200_000;

/** AES key size in bytes (AES-256) */
export const AES_KEY_SIZE = 32;

/** GCM IV size in bytes */
export const GCM_IV_SIZE = 12;

/** GCM authentication tag size in bytes */
export const GCM_TAG_SIZE = 16;

/** Salt size in bytes */
export const SALT_SIZE = 16;

/** Default derivation account index */
export const DEFAULT_ACCOUNT_INDEX = 0;

/** App name — also the storage namespace (`${APP_NAME}-store` persists the vault). */
export const APP_NAME = '7xcircle-wallet';

/** Public product brand as shown in the UI. */
export const BRAND_NAME = '7xCircle Wallet';

/** Supported UI languages */
export const LANGUAGES = [
  'en',
  'zh',
  'ja',
  'fr',
  'ko',
  'ar',
] as const;
export type AppLanguage = (typeof LANGUAGES)[number];

/** Default language (used only when device language can't be detected) */
export const DEFAULT_LANGUAGE: AppLanguage = 'en';

/**
 * Detect the user's preferred language from the device/browser locale,
 * mapping it to our nearest supported language.
 *
 * Handles full locales with region tags, e.g.:
 *   zh-CN / zh-TW / zh-HK → zh
 *   ja-JP → ja, fr-FR → fr, ko-KR → ko, ar-SA → ar, en-US → en
 * Falls back to DEFAULT_LANGUAGE when nothing matches.
 */
export function detectSystemLanguage(
  locales: readonly string[] = typeof navigator !== 'undefined'
    ? navigator.languages ?? [navigator.language]
    : [],
): AppLanguage {
  for (const locale of locales) {
    const lang = (locale ?? '').toLowerCase();
    if (!lang) continue;
    // Exact match (e.g. "ja")
    if ((LANGUAGES as readonly string[]).includes(lang)) {
      return lang as AppLanguage;
    }
    // Match by base language code (e.g. "zh-CN" → "zh")
    const base = lang.split('-')[0];
    if ((LANGUAGES as readonly string[]).includes(base)) {
      return base as AppLanguage;
    }
  }
  return DEFAULT_LANGUAGE;
}

/** Default theme */
export const DEFAULT_THEME = 'dark' as const;

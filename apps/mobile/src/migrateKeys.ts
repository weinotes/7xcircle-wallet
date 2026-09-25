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
 * One-time SecureStore key rename from the pre-rebrand `open-wallet-*`
 * identifiers to the `7xcircle-*` namespace, so installs created before the
 * rebrand keep their vault and biometric flag.
 *
 * The biometric-password key is NOT migrated here: reading it triggers the
 * system authentication prompt, and that would surface an unexpected
 * biometric dialog at cold start. It is migrated lazily inside
 * loadCachedPassword(), where the prompt already belongs.
 */

import * as SecureStore from 'expo-secure-store';

const LEGACY_VAULT_KEY = 'open-wallet-mobile-vault';
export const VAULT_KEY = '7xcircle-mobile-vault';

const LEGACY_ENABLED_KEY = 'open-wallet-mobile-biometric-enabled';
export const BIOMETRIC_ENABLED_KEY = '7xcircle-mobile-biometric-enabled';

/** Move a non-secret key from the old namespace to the new one. */
async function renameKey(legacy: string, current: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(legacy);
  if (raw === null) return; // nothing legacy — first run or already moved
  const existing = await SecureStore.getItemAsync(current);
  if (existing === null) {
    await SecureStore.setItemAsync(current, raw);
  }
  await SecureStore.deleteItemAsync(legacy);
}

/** Run before the first vault read. Idempotent and failure-tolerant. */
export async function migrateLegacyKeys(): Promise<void> {
  try {
    await renameKey(LEGACY_VAULT_KEY, VAULT_KEY);
    await renameKey(LEGACY_ENABLED_KEY, BIOMETRIC_ENABLED_KEY);
  } catch {
    // Best-effort: App.tsx still falls back to the legacy vault key on its
    // first read, and the password key migrates lazily in biometric.ts.
  }
}

/** Legacy names for the lazy biometric-password migration in biometric.ts. */
export const LEGACY_PWD_KEY = 'open-wallet-mobile-biometric-password';

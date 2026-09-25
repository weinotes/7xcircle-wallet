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
 * Biometric unlock — key-level, not a screen curtain.
 *
 * The vault password itself is stored in the Android Keystore behind a
 * BIOMETRIC_STRONG gate (expo-secure-store requireAuthentication): without
 * a passing fingerprint/face read, the password bytes are NOT extractable,
 * so this is real protection rather than UX theatre. Password entry always
 * remains available as the fallback — biometrics are an accelerator, never
 * the only door (changing fingerprints must never mean losing funds).
 */

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { BIOMETRIC_ENABLED_KEY, LEGACY_PWD_KEY } from './migrateKeys';

/** SecureStore keys — separate from the vault ciphertext key */
const PWD_KEY = '7xcircle-mobile-biometric-password';
const ENABLED_KEY = BIOMETRIC_ENABLED_KEY;

export interface BiometricStatus {
  /** Hardware exists, is enrolled, and supports the STRONG class we require */
  usable: boolean;
  /** Human-readable reason when not usable (rendered verbatim in the UI) */
  reason: string;
}

/** Inspect device capability: the Keystore gate needs a Class-3 enrollment */
export async function inspectBiometrics(): Promise<BiometricStatus> {
  const hardware = await LocalAuthentication.hasHardwareAsync();
  if (!hardware) {
    return { usable: false, reason: 'This device has no biometric hardware.' };
  }
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) {
    return { usable: false, reason: 'No fingerprint or face is enrolled on this device.' };
  }
  const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
  if (level !== LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG) {
    // Class-2 face / PIN-only enrollments cannot open a BIOMETRIC_STRONG
    // Keystore item — offering the button here would promise a broken path
    return { usable: false, reason: 'A Class 3 (strong) fingerprint or face is required — add one in system settings.' };
  }
  return { usable: true, reason: '' };
}

/** Whether the user turned the feature on (persisted flag, not secret) */
export async function isBiometricEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ENABLED_KEY)) === 'true';
  } catch {
    return false;
  }
}

/**
 * Cache the vault password behind the Keystore biometric gate.
 * Call right after a successful PASSWORD unlock — that proves knowledge,
 * the cached copy is then only ever readable by a passing authentication.
 * On Android requireAuthentication maps to setUserAuthenticationRequired:
 * Class-3 biometric OR device credential (PIN) — exactly the fallback chain
 * we want. expo-secure-store v14 exposes no authenticator knobs, STRONG is
 * the platform default, matching the capability check in inspectBiometrics.
 */
export async function savePasswordForBiometrics(password: string): Promise<void> {
  await SecureStore.setItemAsync(PWD_KEY, password, {
    requireAuthentication: true,
    authenticationPrompt: 'Unlock 7xCircle Wallet',
  });
  await SecureStore.setItemAsync(ENABLED_KEY, 'true');
}

/**
 * Read the cached password back. The SYSTEM biometric prompt is shown by
 * the Keystore itself during this call. Returns null on cancel/fail/unset —
 * every failure path degrades to the password form, never an error state.
 */
export async function loadCachedPassword(): Promise<string | null> {
  const opts = {
    requireAuthentication: true,
    authenticationPrompt: 'Unlock 7xCircle Wallet',
  } as const;
  try {
    const fresh = await SecureStore.getItemAsync(PWD_KEY, opts);
    if (fresh !== null) return fresh;
    // Pre-rebrand installs keep the cached copy under the legacy key. The
    // auth prompt already fired for the read above, so retrying there
    // surfaces no extra dialog — move it and delete the old entry.
    const legacy = await SecureStore.getItemAsync(LEGACY_PWD_KEY, opts);
    if (legacy !== null) {
      await SecureStore.setItemAsync(PWD_KEY, legacy, opts);
      await SecureStore.deleteItemAsync(LEGACY_PWD_KEY);
    }
    return legacy;
  } catch {
    // userAuthFail, revoked biometrics, corrupted item — all mean "password next"
    return null;
  }
}

/** Wipe the biometric-cached password (feature off / vault replaced) */
export async function clearBiometricCache(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PWD_KEY);
  } finally {
    await SecureStore.setItemAsync(ENABLED_KEY, 'false');
  }
}

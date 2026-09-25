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
 * Vault encryption: AES-256-GCM + PBKDF2-SHA512.
 *
 * Encrypts sensitive data (mnemonic or raw private keys) with a user-provided
 * password. The password is NEVER stored — only a derived encryption key is
 * used per session.
 */

import {
  VAULT_VERSION,
  PBKDF2_ITERATIONS,
  AES_KEY_SIZE,
  GCM_IV_SIZE,
  SALT_SIZE,
  type VaultData,
  fromHex,
  toHex,
} from '@open-wallet/shared';

/** Convert string to UTF-8 bytes */
function strToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Generate cryptographically secure random bytes */
function randomBytes(len: number): Uint8Array {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return buf;
}

/** Derive AES-256 key from password using PBKDF2-SHA512 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    strToBytes(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-512',
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_SIZE * 8 },
    false, // never export the derived key
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt plaintext with password → VaultData */
export async function encryptVault(
  plaintext: string,
  password: string,
): Promise<VaultData> {
  const salt = randomBytes(SALT_SIZE);
  const iv = randomBytes(GCM_IV_SIZE);
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    strToBytes(plaintext),
  );

  // encrypted contains ciphertext + 16-byte auth tag appended
  return {
    version: VAULT_VERSION,
    ciphertext: toHex(new Uint8Array(encrypted)),
    salt: toHex(salt),
    iv: toHex(iv),
    authTag: toHex(new Uint8Array(encrypted).slice(-16)),
    kdf: 'pbkdf2-sha512',
    iterations: PBKDF2_ITERATIONS,
  };
}

/** Decrypt VaultData back to plaintext with password */
export async function decryptVault(
  vault: VaultData,
  password: string,
): Promise<string> {
  if (vault.version !== VAULT_VERSION) {
    throw new Error(`Unsupported vault version: ${vault.version}`);
  }

  const salt = fromHex(vault.salt);
  const iv = fromHex(vault.iv);
  const ciphertext = fromHex(vault.ciphertext);
  const key = await deriveKey(password, salt, vault.iterations);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // Wrong password → SubtleCrypto throws OperationError without details
    throw new Error('Invalid password or corrupted vault data');
  }
}

/** In-memory PBKDF2 key derivation — returns raw AES key for session use */
export async function deriveSessionKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  return deriveKey(password, salt);
}

/** Password strength evaluation */
export function evaluatePassword(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'weak' | 'fair' | 'good' | 'strong';
  errors: string[];
} {
  const errors: string[] = [];
  let score = 0;

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  } else {
    score++;
  }

  if (/[a-z]/.test(password)) score++;
  else errors.push('Include at least one lowercase letter');

  if (/[A-Z]/.test(password)) score++;
  else errors.push('Include at least one uppercase letter');

  if (/\d/.test(password)) score++;
  else errors.push('Include at least one number');

  if (/[^a-zA-Z0-9]/.test(password)) score++;

  // Cap score at 4 — and a short password can never be strong: the length
  // gate is a hard floor, so at most 1 point for short inputs.
  const finalScore = (Math.min(score, 4) === 4 && password.length < 8 ? 1 : Math.min(score, 4)) as 0 | 1 | 2 | 3 | 4;
  const labels: Record<number, 'weak' | 'fair' | 'good' | 'strong'> = {
    0: 'weak', 1: 'weak', 2: 'fair', 3: 'good', 4: 'strong',
  };

  return { score: finalScore, label: labels[finalScore], errors };
}

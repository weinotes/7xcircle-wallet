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
 * Vault encryption tests — AES-256-GCM + PBKDF2-SHA512.
 *
 * These guard the money-safety property: a vault encrypted with a password
 * must (1) decrypt back to the exact original, (2) refuse every wrong
 * password, and (3) detect ANY tampering (GCM authentication). A failure in
 * any of these means funds/keys are either unrecoverable or extractable.
 */
import { describe, it, expect } from 'vitest';
import {
  encryptVault,
  decryptVault,
  deriveSessionKey,
  evaluatePassword,
} from './encryption.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Str0ng-Passw0rd!2026';

describe('vault encryption (AES-256-GCM + PBKDF2-SHA512)', () => {
  it('roundtrips plaintext → encrypt → decrypt', async () => {
    const vault = await encryptVault(MNEMONIC, PASSWORD);
    expect(await decryptVault(vault, PASSWORD)).toBe(MNEMONIC);
  });

  it('roundtrips unicode + emoji content', async () => {
    const content = '助记词 🧠 密钥 0x84cab…秘密内容';
    const vault = await encryptVault(content, PASSWORD);
    expect(await decryptVault(vault, PASSWORD)).toBe(content);
  });

  it('rejects a wrong password', async () => {
    const vault = await encryptVault(MNEMONIC, PASSWORD);
    await expect(decryptVault(vault, 'wrong-password-123')).rejects.toThrow(
      'Invalid password or corrupted vault data',
    );
  });

  it('detects tampered ciphertext (GCM auth)', async () => {
    const vault = await encryptVault(MNEMONIC, PASSWORD);
    const bytes = vault.ciphertext.split('');
    // Flip a nibble in the middle of the ciphertext
    const idx = Math.floor(bytes.length / 2);
    const ch = bytes[idx].toLowerCase();
    bytes[idx] = ch === 'f' ? '0' : 'f';
    const tampered = { ...vault, ciphertext: bytes.join('') };
    await expect(decryptVault(tampered, PASSWORD)).rejects.toThrow(
      'Invalid password or corrupted vault data',
    );
  });

  it('detects tampered IV', async () => {
    const vault = await encryptVault(MNEMONIC, PASSWORD);
    const iv = vault.iv.split('');
    iv[0] = iv[0] === '0' ? '1' : '0';
    await expect(decryptVault({ ...vault, iv: iv.join('') }, PASSWORD)).rejects.toThrow();
  });

  it('detects tampered salt (wrong key derivation)', async () => {
    const vault = await encryptVault(MNEMONIC, PASSWORD);
    const salt = vault.salt.split('');
    salt[0] = salt[0] === '0' ? '1' : '0';
    await expect(decryptVault({ ...vault, salt: salt.join('') }, PASSWORD)).rejects.toThrow();
  });

  it('rejects unsupported vault version', async () => {
    const vault = await encryptVault(MNEMONIC, PASSWORD);
    await expect(decryptVault({ ...vault, version: 99 }, PASSWORD)).rejects.toThrow(
      'Unsupported vault version',
    );
  });

  it('uses fresh random salt + IV per encryption (same plaintext → different ciphertext)', async () => {
    const v1 = await encryptVault(MNEMONIC, PASSWORD);
    const v2 = await encryptVault(MNEMONIC, PASSWORD);
    expect(v1.salt).not.toBe(v2.salt);
    expect(v1.iv).not.toBe(v2.iv);
    expect(v1.ciphertext).not.toBe(v2.ciphertext);
  });
});

describe('evaluatePassword', () => {
  it('caps short passwords at weak (length is a hard floor)', () => {
    const r = evaluatePassword('Ab1!');
    expect(r.score).toBe(1);
    expect(r.label).toBe('weak');
    expect(r.errors).toContain('Password must be at least 8 characters');
  });

  it('never lets a short password score strong', () => {
    const r = evaluatePassword('Ab1!x'); // 5 chars, all classes — still capped
    expect(r.score).toBe(1);
    expect(r.label).toBe('weak');
  });

  it('scores a strong password 4/4 with no errors', () => {
    const r = evaluatePassword('Str0ng-Passw0rd!2026');
    expect(r.score).toBe(4);
    expect(r.label).toBe('strong');
    expect(r.errors).toHaveLength(0);
  });

  it('requires lowercase, uppercase and digits', () => {
    const r = evaluatePassword('UPPERCASE123');
    expect(r.errors).toContain('Include at least one lowercase letter');
    expect(r.score).toBeLessThan(4);
  });

  it('flags a missing uppercase letter while still scoring 4/4', () => {
    // There are five scoring points and the cap is four, so a long password
    // that is missing exactly one character class still reads as strong. This
    // test pins that as intended rather than accidental: it should only change
    // if the policy changes.
    const r = evaluatePassword('lowercase123!');
    expect(r.errors).toContain('Include at least one uppercase letter');
    expect(r.score).toBe(4);
  });

  it('flags a missing digit while still scoring 4/4', () => {
    const r = evaluatePassword('NoDigitsHere!');
    expect(r.errors).toContain('Include at least one number');
    expect(r.score).toBe(4);
  });

  it('drops below strong once two classes are missing', () => {
    const r = evaluatePassword('alllowercase!!'); // no uppercase, no digit
    expect(r.errors).toContain('Include at least one uppercase letter');
    expect(r.errors).toContain('Include at least one number');
    expect(r.score).toBeLessThan(4);
  });
});

describe('deriveSessionKey', () => {
  it('derives a non-exportable AES-256-GCM key for the session', async () => {
    const key = await deriveSessionKey(PASSWORD, new Uint8Array(16).fill(3));
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect(key.usages).toEqual(['encrypt', 'decrypt']);
    // The whole point of a session key is that it cannot be lifted back out
    // with crypto.subtle.exportKey.
    expect(key.extractable).toBe(false);
  });
});

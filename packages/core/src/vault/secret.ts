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
 * Vault secret envelope — what actually lives inside the AES-GCM ciphertext.
 *
 * Two shapes are supported:
 *   mnemonic — an HD wallet: one BIP-39 phrase derives every chain
 *   keys     — one or more raw private keys, each bound to a chain FAMILY
 *              (imported wallets: "paste your MetaMask/Phantom private key")
 *
 * Older vaults (before envelopes existed) stored the bare mnemonic string as
 * plaintext. decodeVaultSecret keeps reading those: anything that is not a
 * well-formed envelope JSON is treated as a legacy phrase, so no migration
 * step can ever brick an existing install.
 */

/** A raw private key bound to a chain family, hex or base58 encoded bytes */
export interface VaultKeyEntry {
  /** chain family this key signs for */
  family: 'evm' | 'solana' | 'tron';
  /**
   * Encoded key material:
   *   evm/tron  — 32-byte secp256k1 scalar, 0x-hex
   *   solana    — ed25519 secret, base58 (64-byte expanded OR 32-byte seed)
   */
  privateKey: string;
  /** user-given label carried across unlocks */
  nickname?: string;
}

export type VaultSecret =
  | { kind: 'mnemonic'; mnemonic: string }
  | { kind: 'keys'; keys: VaultKeyEntry[] };

/** Serialize a secret into the plaintext that gets encrypted into the vault */
export function encodeVaultSecret(secret: VaultSecret): string {
  return JSON.stringify({ v: 1, ...secret });
}

/**
 * Parse vault plaintext back into a secret.
 * A plaintext that merely LOOKS like our envelope (object + v + kind) is
 * parsed strictly; anything else is a legacy bare mnemonic.
 */
export function decodeVaultSecret(plaintext: string): VaultSecret {
  const trimmed = plaintext.trim();
  if (!trimmed.startsWith('{')) {
    return { kind: 'mnemonic', mnemonic: trimmed };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // a bare mnemonic can never start with '{', so this is corrupt data
    return { kind: 'mnemonic', mnemonic: trimmed };
  }
  const obj = parsed as Partial<VaultSecret> & { v?: unknown };
  if (obj.kind === 'mnemonic' && typeof obj.mnemonic === 'string') {
    return { kind: 'mnemonic', mnemonic: obj.mnemonic };
  }
  if (obj.kind === 'keys' && Array.isArray(obj.keys)) {
    return { kind: 'keys', keys: obj.keys as VaultKeyEntry[] };
  }
  throw new Error('unrecognized vault secret shape');
}

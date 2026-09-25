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
 * Private-key import parsing — turn whatever the user pastes out of
 * MetaMask / Phantom / TronLink into normalized key material.
 *
 * Accepted formats (auto-detected, the UI asks only for the chain family):
 *   evm    — 0x-hex 32-byte scalar                     (MetaMask export)
 *   tron   — same scalar; WIF (Base58Check 0x80-pref)  (TronLink export)
 *   solana — base58 64-byte expanded secret, or 32-byte seed (Phantom/Solflare)
 *
 * Everything returned here is a 64-byte ed25519 expanded secret for Solana
 * and a 32-byte scalar for secp256k1 chains — the exact shapes the session
 * derivation helpers already consume.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { fromHex } from '@7xcircle/shared';

import type { VaultKeyEntry } from '../vault/secret.js';

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Minimal base58 decode (Bitcoin alphabet) — no dependency, RN-safe */
export function base58Decode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  let num = 0n;
  for (const ch of str) {
    const digit = B58_ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error(`invalid base58 character: ${ch}`);
    num = num * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  // leading '1's are leading zero bytes
  let i = 0;
  while (i < str.length && str[i] === '1') i++;
  return new Uint8Array([...new Array<number>(i).fill(0), ...bytes]);
}

/** Base58 encode — used for Solana key export */
export function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num << 8n | BigInt(b);
  let out = '';
  while (num > 0n) {
    out = B58_ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
}

/** True when `bytes` is a valid standalone secp256k1 scalar (0 < k < order) */
function validSecpScalar(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  const k = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  return k > 0n && k < secp256k1.CURVE.n;
}

/** Decode a TronLink WIF ("L…"/"K…") into its 32-byte scalar */
function wifToScalar(wif: string): Uint8Array {
  const raw = base58Decode(wif);
  // 0x80 || 32 bytes || [compressed flag] || 4-byte double-sha256 checksum
  if (raw.length !== 37 && raw.length !== 38) {
    throw new Error('invalid WIF length');
  }
  if (raw[0] !== 0x80) throw new Error('invalid WIF version byte');
  return raw.slice(1, 33);
}

export interface ParsedKey {
  family: VaultKeyEntry['family'];
  /** 32-byte secp256k1 scalar, or 64-byte ed25519 expanded secret */
  privateKey: Uint8Array;
  /** public key bytes: 64-byte uncompressed secp (no 0x04) / 32-byte ed25519 */
  publicKey: Uint8Array;
}

/**
 * Parse one pasted key for the given chain family. Throws with a
 * user-presentable message on any format mismatch — never returns junk.
 */
export function parsePrivateKey(family: VaultKeyEntry['family'], input: string): ParsedKey {
  const value = input.trim();
  if (!value) throw new Error('Enter a private key');

  if (family === 'solana') {
    let bytes: Uint8Array;
    try {
      bytes = base58Decode(value);
    } catch {
      throw new Error('Not a valid Solana base58 private key');
    }
    if (bytes.length === 64) {
      // expanded secret: seed||pub — verify the pub half agrees (a truncated
      // copy-paste is heartbreakingly common)
      const pub = ed25519.getPublicKey(bytes.slice(0, 32));
      if (pub.some((b, i) => b !== bytes[32 + i])) {
        throw new Error('Solana key halves mismatch — re-export the full key');
      }
      return { family, privateKey: bytes, publicKey: pub };
    }
    if (bytes.length === 32) {
      const pub = ed25519.getPublicKey(bytes);
      const expanded = new Uint8Array(64);
      expanded.set(bytes, 0);
      expanded.set(pub, 32);
      return { family, privateKey: expanded, publicKey: pub };
    }
    throw new Error(`Expected 32- or 64-byte Solana key, got ${bytes.length}`);
  }

  // secp256k1 families (evm / tron)
  if (value.startsWith('0x') || value.startsWith('0X')) {
    const bytes = fromHex(value);
    if (!validSecpScalar(bytes)) {
      throw new Error(family === 'evm'
        ? 'Expected a 64-hex-digit (0x…) MetaMask private key'
        : 'Expected a 0x… 32-byte Tron private key');
    }
    return { family, privateKey: bytes, publicKey: secp256k1.getPublicKey(bytes, false).slice(1) };
  }

  // TronLink exports WIF by default — accept it for tron, and generously for evm too
  if (family === 'tron' || family === 'evm') {
    try {
      const scalar = wifToScalar(value);
      if (validSecpScalar(scalar)) {
        return { family, privateKey: scalar, publicKey: secp256k1.getPublicKey(scalar, false).slice(1) };
      }
    } catch {
      // fall through to the generic error
    }
  }
  throw new Error('Unrecognized private key format (expected 0x-hex' +
    (family === 'tron' ? ' or WIF' : '') + ')');
}

/**
 * Canonical export string for a stored key entry — the vault stores keys in
 * exactly the format their reference wallet exports (0x-hex scalars for
 * secp256k1 chains, base58 64-byte expanded secret for Solana), so export
 * is a pass-through and round-trips into parsePrivateKey.
 */
export function formatPrivateKeyForExport(entry: VaultKeyEntry): string {
  return entry.privateKey;
}

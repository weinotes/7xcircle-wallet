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
 * Key management: mnemonic generation, validation, and HD derivation.
 *
 * Supports:
 *   - BIP-39 mnemonic (12 or 24 words — 128/256-bit entropy)
 *   - BIP-32 / SLIP-0010 HD key derivation
 *   - secp256k1 (EVM) via @scure/bip32 HDKey
 *   - ed25519 (Solana) via SLIP-0010 HMAC-SHA512 (handwritten here)
 *   - SLIP-0044 purpose paths
 */

import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from 'bip39';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha512';
import { toHex, fromHex, wipeBytes } from '@7xcircle/shared';

/**
 * Generate a mnemonic using CSPRNG.
 * 12 words = 128-bit entropy, 24 words = 256-bit entropy — both are the
 * BIP-39 standard every mainstream wallet (MetaMask/TP/Phantom/TronLink)
 * imports and exports, so either length round-trips everywhere.
 */
export function createMnemonic(wordCount: 12 | 24 = 24): string {
  if (wordCount !== 12 && wordCount !== 24) {
    throw new Error(`unsupported mnemonic length: ${String(wordCount)}`);
  }
  return generateMnemonic(wordCount === 12 ? 128 : 256);
}

/** Validate a mnemonic phrase (checks word count + checksum) */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim());
}

/**
 * Derive a seed from mnemonic + optional passphrase.
 *
 * NOTE: the bip39 library prepends the BIP39 salt prefix "mnemonic" to the
 * passphrase internally — passing `mnemonic${passphrase}` here would double
 * the prefix (salt becomes "mnemonicmnemonic...") and produce seeds that no
 * other BIP39 wallet can reproduce. Verified against official vectors in
 * mnemonic.test.ts.
 */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  return mnemonicToSeedSync(mnemonic.trim(), passphrase);
}

/**
 * Derive an EVM (secp256k1) private key at the given BIP44 path.
 * Returns raw 32-byte private key.
 *
 * Uses @scure/bip32 HDKey which follows SLIP-0010 for secp256k1.
 */
export function deriveEvmPrivateKey(
  mnemonic: string,
  path: string,
): Uint8Array {
  const seed = mnemonicToSeed(mnemonic);
  try {
    const root = HDKey.fromMasterSeed(seed);
    const child = root.derive(path);
    if (!child.privateKey) {
      throw new Error('Failed to derive private key');
    }
    return new Uint8Array(child.privateKey);
  } finally {
    wipeBytes(seed);
  }
}

// ─── SLIP-0010 ed25519 key derivation ─────────────────────────────
//
// ed25519 only supports HARDENED derivation per SLIP-0010.
// The algorithm uses HMAC-SHA512 at every step.
//
// Master:   I = HMAC-SHA512(key="ed25519 seed", msg=seed)
//           master_priv = I[0:32], master_chain = I[32:64]
//
// Hardened: I = HMAC-SHA512(key=parent_chain, msg=0x00 || parent_priv || 4bytes(0x80000000+idx))
//            child_priv = I[0:32], child_chain = I[32:64]

/** Derive SLIP-0010 ed25519 master private key (32 bytes) from BIP39 seed */
function slip0010Ed25519Master(seed: Uint8Array): { privateKey: Uint8Array; chainCode: Uint8Array } {
  const I = hmac(sha512, 'ed25519 seed', seed);
  return {
    privateKey: I.slice(0, 32),
    chainCode: I.slice(32, 64),
  };
}

/** One SLIP-0010 hardened ed25519 child derivation step */
function slip0010Ed25519Hardened(
  parentPrivate: Uint8Array,
  parentChain: Uint8Array,
  index: number,
): { privateKey: Uint8Array; chainCode: Uint8Array } {
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parentPrivate, 1);
  const idx = 0x80000000 + index;
  data[33] = (idx >>> 24) & 0xff;
  data[34] = (idx >>> 16) & 0xff;
  data[35] = (idx >>> 8) & 0xff;
  data[36] = idx & 0xff;

  const I = hmac(sha512, parentChain, data);
  return {
    privateKey: I.slice(0, 32),
    chainCode: I.slice(32, 64),
  };
}

/**
 * Derive a Solana (ed25519) private key at the given BIP44 path.
 *
 * Follows SLIP-0010 for ed25519 — all path components MUST be hardened,
 * which matches standard Solana paths like m/44'/501'/0'/0'.
 * Returns raw 32-byte ed25519 private key.
 */
export function deriveSolanaPrivateKey(
  mnemonic: string,
  path: string,
): Uint8Array {
  const seed = mnemonicToSeed(mnemonic);
  try {
    return deriveSlip0010Ed25519FromSeed(seed, path);
  } finally {
    wipeBytes(seed);
  }
}

/**
 * SLIP-0010 ed25519 derivation from a raw seed — exported for official
 * test-vector verification (see mnemonic.test.ts).
 */
export function deriveSlip0010Ed25519FromSeed(
  seed: Uint8Array,
  path: string,
): Uint8Array {
  let node = slip0010Ed25519Master(seed);

  const segments = path
    .split('/')
    .filter(s => s !== 'm' && s !== '')
    .map(seg => {
      const hardened = seg.endsWith("'");
      const idx = parseInt(seg.replace(/'$/, ''), 10);
      if (Number.isNaN(idx)) throw new Error(`Invalid path segment: ${seg}`);
      return { idx, hardened };
    });

  // ed25519 requires ALL-hardened per SLIP-0010
  for (const { idx, hardened } of segments) {
    if (!hardened) {
      throw new Error(
        `ed25519 (SLIP-0010) only supports hardened derivation — path must use ' suffix. Got idx=${idx}`,
      );
    }
    node = slip0010Ed25519Hardened(node.privateKey, node.chainCode, idx);
  }

  return node.privateKey;
}

/** Convert a raw 32-byte private key to a hex string (with 0x prefix) */
export function privateKeyToHex(pk: Uint8Array): string {
  return '0x' + toHex(pk);
}

/** Import a private key from hex string (with or without 0x prefix) */
export function privateKeyFromHex(hex: string): Uint8Array {
  const bytes = fromHex(hex);
  if (bytes.length !== 32) {
    throw new Error(`Invalid private key length: expected 32, got ${bytes.length}`);
  }
  return bytes;
}

/** Get the EVM public key (uncompressed, 64 bytes without 0x04 prefix) */
export function evmPublicKey(pk: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(pk, false).slice(1);
}

/** Get the Solana public key from private key */
export function solanaPublicKey(pk: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(pk.slice(0, 32));
}

/** Wipe a mnemonic string from memory reference (best-effort) */
export function wipeMnemonicRef(arr: Uint8Array): void {
  wipeBytes(arr);
}

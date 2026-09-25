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
 * TRON address encoding.
 *
 * A TRON address is an Ethereum address with a version byte and base58check:
 *   address21 = 0x41 || keccak256(uncompressedPubKey[1:])[12:]
 *   base58    = Base58( address21 || sha256d(address21)[0:4] )   ("T…")
 *
 * secp256k1 is shared with EVM, so an account derived for Tron reuses the
 * exact same curve/keys as Eth — only the path (m/44'/195') and the
 * address representation differ. That is why deriveAddress accepts the
 * same 64-byte uncompressed public key as the EVM adapter.
 */

import bs58 from 'bs58';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';

import { fromHex, toHex } from '@7xcircle/shared';

/** TRON address version byte (mainnet and testnets alike) */
export const TRON_ADDRESS_PREFIX = 0x41;

/** base58check checksum = first 4 bytes of double sha256 */
function checksum(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload)).slice(0, 4);
}

/**
 * 64-byte uncompressed public key (no 0x04 prefix, EVM shape) → base58 T-address.
 */
export function publicKeyToTronAddress(publicKey: Uint8Array): string {
  // Tolerate the full 65-byte 0x04-prefixed form too
  const key = publicKey.length === 65 ? publicKey.slice(1) : publicKey;
  if (key.length !== 64) {
    throw new Error(`Invalid public key length: expected 64, got ${key.length}`);
  }
  const addr = new Uint8Array(21);
  addr[0] = TRON_ADDRESS_PREFIX;
  addr.set(keccak_256(key).slice(12), 1);
  const withSum = new Uint8Array(25);
  withSum.set(addr, 0);
  withSum.set(checksum(addr), 21);
  return bs58.encode(withSum);
}

/** Decode a base58 T-address into its 21 bytes (0x41 || 20-byte eth address). Throws on bad format. */
export function tronAddressToBytes(address: string): Uint8Array {
  const raw = bs58.decode(address);
  if (raw.length !== 25) throw new Error('invalid tron address length');
  const addr = raw.slice(0, 21);
  const sum = raw.slice(21);
  const expected = checksum(addr);
  for (let i = 0; i < 4; i++) {
    if (sum[i] !== expected[i]) throw new Error('invalid tron address checksum');
  }
  if (addr[0] !== TRON_ADDRESS_PREFIX) throw new Error('invalid tron address version byte');
  return addr;
}

/** Encode 21 bytes (0x41-prefixed) or a 0x… 20-byte hex into a base58 T-address. */
export function bytesToTronAddress(bytes: Uint8Array | string): string {
  let addr: Uint8Array;
  if (typeof bytes === 'string') {
    if (bytes.startsWith('T') && bytes.length === 34) {
      // Already base58 — validate (throws on bad checksum) and pass through
      tronAddressToBytes(bytes);
      return bytes;
    }
    const hexBytes = fromHex(bytes);
    addr = hexBytes.length === 20
      ? new Uint8Array([TRON_ADDRESS_PREFIX, ...hexBytes])
      : hexBytes;
  } else {
    addr = bytes.length === 20
      ? new Uint8Array([TRON_ADDRESS_PREFIX, ...bytes])
      : bytes;
  }
  if (addr.length !== 21 || addr[0] !== TRON_ADDRESS_PREFIX) {
    throw new Error('invalid tron address bytes');
  }
  const withSum = new Uint8Array(25);
  withSum.set(addr, 0);
  withSum.set(checksum(addr), 21);
  return bs58.encode(withSum);
}

/**
 * Normalize any accepted token/contract address form (base58 T… or 0x…/bare
 * hex 20 bytes) to the canonical 21-byte protobuf representation.
 */
export function toAddressBytes(address: string): Uint8Array {
  if (address.startsWith('T') && address.length === 34) {
    return tronAddressToBytes(address);
  }
  return normalizeHex(address);
}

function normalizeHex(address: string): Uint8Array {
  const bytes = fromHex(address);
  if (bytes.length === 20) return new Uint8Array([TRON_ADDRESS_PREFIX, ...bytes]);
  if (bytes.length === 21 && bytes[0] === TRON_ADDRESS_PREFIX) return bytes;
  throw new Error(`Invalid tron address: ${address}`);
}

/** base58 T-address → 0x… 20-byte EVM-style hex (what TRC20 ABIs encode) */
export function tronToEvmAddress(address: string): string {
  const bytes = tronAddressToBytes(address);
  return '0x' + toHex(bytes.slice(1));
}

/** Validate a base58 T-address (length + version + checksum) */
export function isValidTronAddress(address: string): boolean {
  try {
    tronAddressToBytes(address);
    return true;
  } catch {
    return false;
  }
}

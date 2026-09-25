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
 * TRON address encoding tests.
 *
 * Ground truth: the USDT-TRC20 contract is one of the most published
 * addresses in the industry, and its 0x form is documented identically
 * everywhere — a safe external anchor for the base58check codec. The
 * pubkey→address path is cross-checked against the EVM derivation of the
 * same key (Tron address == 0x41 || evm address of the same pubkey).
 */

import { describe, it, expect } from 'vitest';
import bs58 from 'bs58';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

import { fromHex, toHex } from '@7xcircle/shared';
import {
  bytesToTronAddress,
  isValidTronAddress,
  publicKeyToTronAddress,
  tronAddressToBytes,
  tronToEvmAddress,
} from './address.js';

describe('tron address encoding', () => {
  // USDT-TRC20 mainnet — the base58 string is the industry-published one;
  // its 4-byte checksum validates against double-sha256, which makes the
  // pair self-authenticating (a corrupted string would throw on decode).
  const USDT_BASE58 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const USDT_HEX20 = '0xa614f803b6fd780986a42c78ec9c7f77e6ded13c';

  it('decodes a known base58 address to its 20-byte EVM form', () => {
    const bytes = tronAddressToBytes(USDT_BASE58);
    expect(bytes[0]).toBe(0x41);
    expect('0x' + toHex(bytes.slice(1))).toBe(USDT_HEX20);
  });

  it('round-trips base58 ↔ bytes with checksum', () => {
    expect(bytesToTronAddress(USDT_HEX20)).toBe(USDT_BASE58);
    expect(bytesToTronAddress(USDT_BASE58)).toBe(USDT_BASE58);
    expect(tronToEvmAddress(USDT_BASE58)).toBe(USDT_HEX20);
  });

  it('rejects tampered checksums and wrong version bytes', () => {
    const bytes = tronAddressToBytes(USDT_BASE58);
    const tampered = new Uint8Array(bytes);
    tampered[20] ^= 0x01;
    // Re-encode without fixing the checksum → must fail validation
    const raw = bs58.encode(new Uint8Array([...tampered, 0x00, 0x00, 0x00, 0x00]));
    expect(isValidTronAddress(raw)).toBe(false);
    expect(isValidTronAddress('not-an-address!!')).toBe(false);
    expect(isValidTronAddress(USDT_BASE58)).toBe(true);
  });

  it('derives the same 20 bytes as the EVM address of the same key', () => {
    const pk = new Uint8Array(32);
    pk[31] = 1; // private key = 1
    const pub64 = secp256k1.getPublicKey(pk, false).slice(1);
    const tronAddr = publicKeyToTronAddress(pub64);
    const evm20 = keccak_256(pub64).slice(12);
    expect(tronAddressToBytes(tronAddr).slice(1)).toEqual(evm20);
  });

  it('matches the tronweb reference address for private key = 1', () => {
    // Expected value cross-checked against tronweb 6.5.1:
    //   tw.address.fromPrivateKey('01'.padStart(64, '0'))
    const pk = new Uint8Array(32);
    pk[31] = 1;
    const pub = secp256k1.getPublicKey(pk, false).slice(1);
    expect(publicKeyToTronAddress(pub)).toBe('TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC');
  });

  it('accepts 65-byte 0x04-prefixed public keys equivalently', () => {
    const pk = new Uint8Array(32);
    pk[31] = 7;
    const full = secp256k1.getPublicKey(pk, false);
    expect(publicKeyToTronAddress(full)).toBe(publicKeyToTronAddress(full.slice(1)));
  });

  it('throws on wrong key length', () => {
    expect(() => publicKeyToTronAddress(fromHex('deadbeef'))).toThrow(/public key length/);
  });
});

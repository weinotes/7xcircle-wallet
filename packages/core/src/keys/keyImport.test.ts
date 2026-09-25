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
 * Private-key import parsing tests.
 *
 * External ground truth used below:
 *   - WIF(pk=1) "5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf" is the
 *     canonical uncompressed-WIF vector from the Bitcoin wiki
 *   - Solana base58 strings were produced by the bs58 npm package against a
 *     seed-7 key (independent implementation)
 */

import { describe, it, expect } from 'vitest';
import {
  base58Decode,
  base58Encode,
  parsePrivateKey,
} from './keyImport.js';
import { toHex } from '@open-wallet/shared';

const PK1_HEX = '0x' + '00'.repeat(31) + '01';
// secp256k1 pubkey of scalar 1, uncompressed sans 0x04 — well-known vector
const PK1_PUB_START = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

describe('base58 round-trip (vs bs58-produced strings)', () => {
  it('decodes and re-encodes a Solana expanded secret losslessly', () => {
    const s = '111111111111111111111111111111139qhL8b4auL1Y7WbGjTSE1krcveF1Nwvio3X8b9RKevso';
    const bytes = base58Decode(s);
    expect(bytes.length).toBe(64);
    expect(base58Encode(bytes)).toBe(s);
  });

  it('maps leading zeros to leading 1s', () => {
    const seed = new Uint8Array(32); seed[31] = 7;
    expect(base58Encode(seed)).toBe('11111111111111111111111111111118');
    expect(base58Decode('11111111111111111111111111111118')).toEqual(seed);
  });

  it('rejects non-alphabet characters', () => {
    expect(() => base58Decode('0OIl')).toThrow(/invalid base58/);
  });
});

describe('parsePrivateKey — evm', () => {
  it('accepts a 0x-hex scalar (MetaMask export)', () => {
    const parsed = parsePrivateKey('evm', PK1_HEX);
    expect(parsed.privateKey.length).toBe(32);
    expect(toHex(parsed.publicKey).startsWith(PK1_PUB_START)).toBe(true);
  });

  it('accepts the canonical WIF vector for private key = 1', () => {
    const parsed = parsePrivateKey('evm', '5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf');
    expect(toHex(parsed.privateKey)).toBe('00'.repeat(31) + '01');
  });

  it('rejects garbage and invalid scalars', () => {
    expect(() => parsePrivateKey('evm', 'hello world')).toThrow();
    expect(() => parsePrivateKey('evm', '0x' + '00'.repeat(32))).toThrow(); // zero scalar
    expect(() => parsePrivateKey('evm', '0xabcd')).toThrow();
  });
});

describe('parsePrivateKey — tron', () => {
  it('accepts hex AND TronLink WIF', () => {
    const hex = parsePrivateKey('tron', PK1_HEX);
    const wif = parsePrivateKey('tron', '5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf');
    expect(toHex(hex.privateKey)).toBe(toHex(wif.privateKey));
  });
});

describe('parsePrivateKey — solana', () => {
  it('accepts a 64-byte expanded secret (Phantom format)', () => {
    const parsed = parsePrivateKey('solana',
      '111111111111111111111111111111139qhL8b4auL1Y7WbGjTSE1krcveF1Nwvio3X8b9RKevso');
    expect(parsed.privateKey.length).toBe(64);
    // pubkey is the embedded second half
    expect(toHex(parsed.publicKey)).toBe(toHex(parsed.privateKey.slice(32)));
  });

  it('expands a bare 32-byte seed to the same key pair', () => {
    const fromSeed = parsePrivateKey('solana', '11111111111111111111111111111118');
    const fromFull = parsePrivateKey('solana',
      '111111111111111111111111111111139qhL8b4auL1Y7WbGjTSE1krcveF1Nwvio3X8b9RKevso');
    expect(fromSeed.privateKey).toEqual(fromFull.privateKey);
    expect(fromSeed.publicKey).toEqual(fromFull.publicKey);
  });

  it('rejects a corrupted expanded secret (halves disagree)', () => {
    const bad = '111111111111111111111111111111139qhL8b4auL1Y7WbGjTSE1krcveF1Nwvio3X8b9RKevsx';
    expect(() => parsePrivateKey('solana', bad)).toThrow(/mismatch|base58|format/);
  });
});

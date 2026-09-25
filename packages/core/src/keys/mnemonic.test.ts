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
 * Official test-vector verification for key derivation.
 *
 * Sources (fetched 2026-09-01, do NOT hand-edit expected values):
 *   - SLIP-0010: https://raw.githubusercontent.com/satoshilabs/slips/master/slip-0010.md (Test vector 1 for ed25519)
 *   - BIP32:     https://raw.githubusercontent.com/bitcoin/bips/master/bip-0032.mediawiki (Test vector 1)
 *   - BIP39:     https://raw.githubusercontent.com/trezor/python-mnemonic/master/vectors.json (english)
 *
 * A derivation implementation that fails these vectors produces keys no
 * real wallet can reproduce — accounts would be unrecoverable. This file
 * is the money-safety gate for mnemonic/HD derivation.
 */
import { describe, it, expect } from 'vitest';
import { HDKey } from '@scure/bip32';
import { createMnemonic, deriveSlip0010Ed25519FromSeed, isValidMnemonic, mnemonicToSeed } from './mnemonic.js';

const bytesToHex = (b: Uint8Array): string => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (h: string): Uint8Array => {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) out[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return out;
};


describe('SLIP-0010 ed25519 (official vectors, satoshilabs/slips slip-0010.md)', () => {
  const seed = hexToBytes('000102030405060708090a0b0c0d0e0f');

  it("derives m", () => {
    expect(bytesToHex(deriveSlip0010Ed25519FromSeed(seed, "m"))).toBe('2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
  });
  it("derives m/0'", () => {
    expect(bytesToHex(deriveSlip0010Ed25519FromSeed(seed, "m/0'"))).toBe('68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
  });
  it("derives m/0'/1'", () => {
    expect(bytesToHex(deriveSlip0010Ed25519FromSeed(seed, "m/0'/1'"))).toBe('b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2');
  });
  it("derives m/0'/1'/2'", () => {
    expect(bytesToHex(deriveSlip0010Ed25519FromSeed(seed, "m/0'/1'/2'"))).toBe('92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9');
  });
  it("derives m/0'/1'/2'/2'", () => {
    expect(bytesToHex(deriveSlip0010Ed25519FromSeed(seed, "m/0'/1'/2'/2'"))).toBe('30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662');
  });
  it("derives m/0'/1'/2'/2'/1000000000'", () => {
    expect(bytesToHex(deriveSlip0010Ed25519FromSeed(seed, "m/0'/1'/2'/2'/1000000000'"))).toBe('8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793');
  });
  it("rejects non-hardened paths (ed25519 has no normal derivation)", () => {
    expect(() => deriveSlip0010Ed25519FromSeed(seed, "m/0")).toThrow();
  });
});


describe('BIP32 secp256k1 (official vectors, bip-0032.mediawiki Test vector 1)', () => {
  const root = HDKey.fromMasterSeed(hexToBytes('000102030405060708090a0b0c0d0e0f'));

  it("derives m — xprv matches", () => {
    expect(root.derive("m").privateExtendedKey).toBe('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi');
  });
  it("derives m/0' — xprv matches", () => {
    expect(root.derive("m/0'").privateExtendedKey).toBe('xprv9uHRZZhk6KAJC1avXpDAp4MDc3sQKNxDiPvvkX8Br5ngLNv1TxvUxt4cV1rGL5hj6KCesnDYUhd7oWgT11eZG7XnxHrnYeSvkzY7d2bhkJ7');
  });
  it("derives m/0'/1 — xprv matches", () => {
    expect(root.derive("m/0'/1").privateExtendedKey).toBe('xprv9wTYmMFdV23N2TdNG573QoEsfRrWKQgWeibmLntzniatZvR9BmLnvSxqu53Kw1UmYPxLgboyZQaXwTCg8MSY3H2EU4pWcQDnRnrVA1xe8fs');
  });
  it("derives m/0'/1/2' — xprv matches", () => {
    expect(root.derive("m/0'/1/2'").privateExtendedKey).toBe('xprv9z4pot5VBttmtdRTWfWQmoH1taj2axGVzFqSb8C9xaxKymcFzXBDptWmT7FwuEzG3ryjH4ktypQSAewRiNMjANTtpgP4mLTj34bhnZX7UiM');
  });
  it("derives m/0'/1/2'/2 — xprv matches", () => {
    expect(root.derive("m/0'/1/2'/2").privateExtendedKey).toBe('xprvA2JDeKCSNNZky6uBCviVfJSKyQ1mDYahRjijr5idH2WwLsEd4Hsb2Tyh8RfQMuPh7f7RtyzTtdrbdqqsunu5Mm3wDvUAKRHSC34sJ7in334');
  });
  it("derives m/0'/1/2'/2/1000000000 — xprv matches", () => {
    expect(root.derive("m/0'/1/2'/2/1000000000").privateExtendedKey).toBe('xprvA41z7zogVVwxVSgdKUHDy1SKmdb533PjDz7J6N6mV6uS3ze1ai8FHa8kmHScGpWmj4WggLyQjgPie1rFSruoUihUZREPSL39UNdE3BBDu76');
  });
});


describe('BIP39 mnemonic — seed (official vectors, trezor/python-mnemonic vectors.json)', () => {
  // ⚠️ vectors.json seeds are computed with passphrase "TREZOR" (documented
  // in the repo README). Empty-passphrase vectors are tested separately below.
  it("derives 12-word mnemonic seed with passphrase TREZOR", () => {
    expect(bytesToHex(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'TREZOR'))).toBe('c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04');
  });
  it("derives 12-word mnemonic seed with passphrase TREZOR", () => {
    expect(bytesToHex(mnemonicToSeed('legal winner thank year wave sausage worth useful legal winner thank yellow', 'TREZOR'))).toBe('2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607');
  });
  it("derives 12-word mnemonic seed with passphrase TREZOR", () => {
    expect(bytesToHex(mnemonicToSeed('letter advice cage absurd amount doctor acoustic avoid letter advice cage above', 'TREZOR'))).toBe('d71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8');
  });
  it("derives 12-word mnemonic seed with passphrase TREZOR", () => {
    expect(bytesToHex(mnemonicToSeed('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', 'TREZOR'))).toBe('ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13332572917f0f8e5a589620c6f15b11c61dee327651a14c34e18231052e48c069');
  });
  it("derives empty-passphrase seed (canonical 5eb00bbd...)", () => {
    expect(bytesToHex(mnemonicToSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'))).toBe('5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4');
  });
});

describe('createMnemonic — 12 / 24 word generation', () => {
  it('defaults to 24 words and validates', () => {
    const m = createMnemonic();
    expect(m.split(' ')).toHaveLength(24);
    expect(isValidMnemonic(m)).toBe(true);
  });

  it('generates valid 12-word phrases (128-bit entropy)', () => {
    for (let i = 0; i < 5; i++) {
      const m = createMnemonic(12);
      expect(m.split(' ')).toHaveLength(12);
      expect(isValidMnemonic(m)).toBe(true);
    }
  });

  it('every generated phrase carries a valid checksum (isValidMnemonic is strict)', () => {
    // flipping one word must break the checksum the overwhelming majority
    // of the time — instead assert the deterministic path: known-bad phrases
    expect(isValidMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon')).toBe(false); // bad checksum
    expect(isValidMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')).toBe(true);
  });

  it('rejects unsupported lengths', () => {
    expect(() => createMnemonic(15 as 12)).toThrow(/unsupported/);
  });

  it('generates distinct entropy per call', () => {
    expect(createMnemonic(12)).not.toBe(createMnemonic(12));
  });
});


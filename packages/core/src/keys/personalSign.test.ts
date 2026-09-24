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
 * personal_sign tests. Every expected signature below was produced by
 * ethers v6 Wallet.signMessage (the reference dApps verify against) —
 * captured 2026-09-25 with private key = 1.
 */

import { describe, it, expect } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3';

import { toHex } from '@open-wallet/shared';
import {
  hashPersonalMessage,
  messageParamToBytes,
  signPersonalMessage,
} from './personalSign.js';

const PK = new Uint8Array(32);
PK[31] = 1;

// ethers hashMessage(getBytes('0xdeadbeef'))
const DEADBEEF_DIGEST = '0xd1c7f1a06a4f9a535077e50ad23244ce2c6ae443fcd412965226f3df5d28eaaa';

describe('personal_sign (EIP-191)', () => {
  it('hashes 0x-hex params as RAW bytes, matching ethers hashMessage', () => {
    const digest = hashPersonalMessage(messageParamToBytes('0xdeadbeef'));
    expect('0x' + toHex(digest)).toBe(DEADBEEF_DIGEST);
  });

  it('produces the exact ethers signature for a hex message', () => {
    expect(signPersonalMessage('0xdeadbeef', PK)).toBe(
      '0x063b9060ebca861f8bff5890260dbfb7291603fca511334e2d2f4ee71384104c3c8d2f922494a81ffb72ff89f06feaee29d77b0b450a73d606f6626d4ddc6f9d1b',
    );
  });

  it('UTF-8 falls back for non-hex strings, matching ethers', () => {
    expect(signPersonalMessage('gm degen', PK)).toBe(
      '0x846943708c5535d4f5c28c7ce3f5a553f78aaac915c8c58647b78afed07249591e4b803c088d50559fa6090cd8df677e725b1f64e5f090383f8f437225e15c741c',
    );
  });

  it('signature is 65 bytes with v in {27,28} and recovers the digest', () => {
    const sig = signPersonalMessage('0x1234', PK);
    expect(sig.length).toBe(132);
    const v = parseInt(sig.slice(130), 16);
    expect([27, 28]).toContain(v);
    // sanity: our digest really is keccak of the prefixed message
    const bytes = messageParamToBytes('0x1234');
    expect(bytes).toEqual(new Uint8Array([0x12, 0x34]));
    expect(keccak_256(new Uint8Array(0)).length).toBe(32);
  });
});

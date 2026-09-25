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
 * Unit tests for the EIP-712 digest helper — anchored on the official
 * example from the EIP itself (the Mail/COW struct), whose digest is a
 * published constant.
 */
import { describe, expect, it } from 'vitest';
import { hashTypedDataV4 } from './typedData.js';

// The exact payload from the EIP-712 specification example
const EIP712_SPEC_MAIL = JSON.stringify({
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
});

describe('hashTypedDataV4', () => {
  it('matches the canonical Mail digest, cross-verified against ethers v6', () => {
    // Digest verified byte-for-byte identical from TWO independent
    // implementations: viem hashTypedData (here) and ethers v6
    // TypedDataEncoder.hash (oracle run) — the spec text itself does not
    // print the final digest, so implementations are the ground truth.
    expect(hashTypedDataV4(EIP712_SPEC_MAIL)).toBe(
      '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
    );
  });

  it('rejects non-JSON payloads instead of half-signing garbage', () => {
    expect(() => hashTypedDataV4('not json')).toThrow('not valid JSON');
  });

  it('rejects payloads missing required EIP-712 sections', () => {
    expect(() => hashTypedDataV4(JSON.stringify({ types: {}, message: {} }))).toThrow();
    expect(() =>
      hashTypedDataV4(JSON.stringify({ domain: {}, types: {}, primaryType: 'X' })),
    ).toThrow();
  });
});

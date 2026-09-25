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
 * Unit tests for the address-poisoning guard: lookalike thresholds, equal
 * / different-length exclusions, and the known-set scan.
 */
import { describe, expect, it } from 'vitest';
import { findLookalikes, isAddressLookalike } from './addressGuard.js';

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
// forged twin: same first 5 + last 4 body chars (exactly 40 hex body)
const POISONED = '0xd8dA6' + 'F'.repeat(31) + '6045';
// same head only
const HEAD_ONLY = '0xd8dA60000000000000000000000000000000009999';

describe('isAddressLookalike', () => {
  it('flags a same-head-same-tail forgery', () => {
    expect(isAddressLookalike(POISONED, VITALIK)).toBe(true);
  });

  it('does not flag the identical address (case-insensitively)', () => {
    expect(isAddressLookalike(VITALIK.toLowerCase(), VITALIK.toUpperCase())).toBe(false);
  });

  it('ignores different-length namespaces', () => {
    const shortTwin = '0xd8dA6abcd1aA96045';
    expect(isAddressLookalike(shortTwin, VITALIK)).toBe(false);
  });

  it('requires BOTH ends: head-only match passes', () => {
    expect(isAddressLookalike(HEAD_ONLY, VITALIK)).toBe(false);
  });

  it('is symmetric', () => {
    expect(isAddressLookalike(VITALIK, POISONED)).toBe(
      isAddressLookalike(POISONED, VITALIK),
    );
  });

  it('honours custom thresholds', () => {
    // only the first 3 and last 2 characters shared
    const a = '0xd8dAA000000000000000000000000000000000045';
    const b = '0xd8dAB000000000000000000000000000000000045';
    expect(isAddressLookalike(a, b)).toBe(false); // 5/4 rule: head differs at idx 3
    expect(isAddressLookalike(a, b, { head: 3, tail: 3 })).toBe(true);
  });
});

describe('findLookalikes', () => {
  it('scans the known set and dedupes case variants', () => {
    const known = [VITALIK, VITALIK.toLowerCase(), '0x1111111111111111111111111111111111111111'];
    expect(findLookalikes(POISONED, known)).toEqual([VITALIK]);
  });

  it('returns empty for an unknown address', () => {
    expect(findLookalikes('0x0000000000000000000000000000000000000123', [VITALIK])).toEqual([]);
  });

  it('tolerates blanks in the known set', () => {
    expect(findLookalikes(POISONED, ['', VITALIK])).toEqual([VITALIK]);
  });
});

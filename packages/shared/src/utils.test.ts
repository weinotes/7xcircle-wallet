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
 * Shared utility tests.
 *
 * The base64 helpers carry transactions handed back by aggregators
 * (Jupiter returns base64). A single wrong byte produces a transaction that
 * either fails to deserialize or — worse — deserializes into something the
 * user did not intend to sign. They are implemented in-house rather than via
 * `Buffer` (Node-only) or `btoa` (absent on React Native), so they need
 * their own vectors.
 *
 * The `parseAmount` cases pin CURRENT, deliberately-lenient behaviour rather
 * than asserting it is correct: it silently truncates over-precise input.
 */
import { describe, it, expect } from 'vitest';
import { bytesToBase64, base64ToBytes, parseAmount, formatBalance, formatUsd } from './utils.js';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('bytesToBase64', () => {
  it('encodes the canonical one/two/three byte vectors', () => {
    // These pin the padding rules — all three byte-remainder cases.
    expect(bytesToBase64(utf8('A'))).toBe('QQ==');
    expect(bytesToBase64(utf8('AB'))).toBe('QUI=');
    expect(bytesToBase64(utf8('ABC'))).toBe('QUJD');
  });

  it('encodes multiple blocks without padding', () => {
    expect(bytesToBase64(utf8('Hello'))).toBe('SGVsbG8=');
    expect(bytesToBase64(utf8('Hello, world!'))).toBe('SGVsbG8sIHdvcmxkIQ==');
  });

  it('encodes empty input as an empty string', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });
});

describe('base64ToBytes', () => {
  it('decodes the canonical vectors back to the original bytes', () => {
    expect(Array.from(base64ToBytes('QQ=='))).toEqual([65]);
    expect(Array.from(base64ToBytes('QUI='))).toEqual([65, 66]);
    expect(Array.from(base64ToBytes('QUJD'))).toEqual([65, 66, 67]);
  });

  it('tolerates missing padding and embedded whitespace', () => {
    // JSON responses occasionally arrive with wrapped lines.
    expect(Array.from(base64ToBytes('QQ'))).toEqual([65]);
    expect(Array.from(base64ToBytes('SGVs\nbG8='))).toEqual(Array.from(utf8('Hello')));
  });

  it('decodes empty input to zero bytes', () => {
    expect(base64ToBytes('').length).toBe(0);
  });
});

describe('base64 round trip', () => {
  it('survives every byte-remainder length', () => {
    // 32 is the length of an ed25519 seed; the others cover the padding cases.
    for (const len of [0, 1, 2, 3, 4, 5, 31, 32, 33, 64, 255, 256]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;

      const decoded = base64ToBytes(bytesToBase64(bytes));
      expect(decoded.length, `length mismatch at len=${len}`).toBe(len);
      expect(Array.from(decoded), `content mismatch at len=${len}`).toEqual(Array.from(bytes));
    }
  });

  it('preserves high-bit bytes (no sign-extension bug)', () => {
    // A naive implementation using signed char codes corrupts bytes >= 0x80.
    const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0xfe, 0x81]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('parseAmount — current lenient behaviour', () => {
  it('converts whole and fractional amounts', () => {
    expect(parseAmount('1', 18)).toBe('1000000000000000000');
    expect(parseAmount('0.5', 18)).toBe('500000000000000000');
    expect(parseAmount('1.5', 6)).toBe('1500000');
  });

  it('handles a bare fraction and leading zeros', () => {
    expect(parseAmount('0.000000001', 9)).toBe('1');
    expect(parseAmount('0.0', 6)).toBe('0');
  });

  it('DOCUMENTS a known sharp edge: over-precise input is truncated, not rejected', () => {
    // 9 decimals requested but 10 supplied — the last digit is silently
    // dropped. This is why callers must validate user input before
    // converting; a wallet must never quietly change the typed amount.
    expect(parseAmount('1.1234567891', 9)).toBe('1123456789');
  });
});

describe('formatBalance', () => {
  it('trims trailing zeros and respects maxFraction', () => {
    expect(formatBalance('1000000000000000000', 18)).toBe('1');
    expect(formatBalance('1500000', 6)).toBe('1.5');
    expect(formatBalance('0', 18)).toBe('0');
  });

  it('pads sub-unit amounts', () => {
    expect(formatBalance('1', 9, 12)).toBe('0.000000001');
  });

  it('DOCUMENTS a sharp edge: the default 6-decimal cap hides dust', () => {
    // 1 lamport formats as "0.000000" at the default cap — indistinguishable
    // from zero. Callers displaying small values (fees, dust balances) must
    // pass an explicit maxFraction, as Send.tsx does for fees (8).
    expect(formatBalance('1', 9)).toBe('0.000000');
    expect(formatBalance('1', 9, 9)).toBe('0.000000001');
  });
});

describe('formatUsd', () => {
  it('renders cents for normal amounts with thousands separators', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('keeps precision below a dollar so dust is not shown as zero', () => {
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(0.5)).toBe('$0.5000');
  });

  it('falls back to zero for a non-finite input', () => {
    expect(formatUsd(Number.NaN)).toBe('$0.00');
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });
});

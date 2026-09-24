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
 * Pure utility functions — no crypto dependencies, safe for all platforms.
 */

/** Shorten a hex/address for display: "0xABCD...1234" */
export function shortenAddress(address: string, start = 6, end = 4): string {
  if (!address) return '';
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

/** Format a bigint/string token balance with proper decimals */
export function formatBalance(
  raw: string | bigint,
  decimals: number,
  maxFraction = 6,
): string {
  const value = typeof raw === 'bigint' ? raw.toString() : raw;
  if (!value || value === '0') return '0';

  // Add leading zeros if needed
  const padded = value.length <= decimals
    ? value.padStart(decimals + 1, '0')
    : value;

  const integerPart = padded.slice(0, padded.length - decimals);
  const fractionPart = padded.slice(padded.length - decimals);

  // Trim trailing zeros
  const trimmedFraction = fractionPart.replace(/0+$/, '').slice(0, maxFraction);

  return trimmedFraction
    ? `${integerPart}.${trimmedFraction}`
    : integerPart;
}

/** Convert human-readable amount to raw smallest unit */
export function parseAmount(amount: string, decimals: number): string {
  const [int, frac = ''] = amount.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return (int + paddedFrac).replace(/^0+(?=\d)/, '') || '0';
}

/** Simple UUID v4 for account IDs */
export function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Hex encode bytes */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hex decode to bytes */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('Invalid hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

/** Deep wipe a Uint8Array (fill with zeros) — best-effort memory cleanup */
export function wipeBytes(buf: Uint8Array): void {
  for (let i = 0; i < buf.length; i++) buf[i] = 0;
}

// ─── Base64 ──────────────────────────────────────────────────────────
//
// Implemented here rather than via `Buffer` (Node-only) or `btoa`/`atob`
// (not reliably present on React Native), so the wallet code runs unchanged
// on web, extension and mobile.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes to standard base64 (with padding) */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];

    if (b1 === undefined) {
      out += '==';
    } else if (b2 === undefined) {
      out += B64_ALPHABET[(b1 & 0x0f) << 2];
      out += '=';
    } else {
      out += B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
      out += B64_ALPHABET[b2 & 0x3f];
    }
  }
  return out;
}

/** Decode standard base64 into bytes. Tolerates whitespace and missing padding. */
export function base64ToBytes(b64: string): Uint8Array {
  // Strip padding and any non-alphabet characters (newlines from wrapped JSON)
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const outLength = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLength);

  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_ALPHABET.indexOf(clean[i]);
    const c1 = B64_ALPHABET.indexOf(clean[i + 1] ?? 'A');
    const c2 = B64_ALPHABET.indexOf(clean[i + 2] ?? 'A');
    const c3 = B64_ALPHABET.indexOf(clean[i + 3] ?? 'A');

    if (p < outLength) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < outLength) out[p++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (p < outLength) out[p++] = ((c2 & 0x03) << 6) | c3;
  }

  return out;
}

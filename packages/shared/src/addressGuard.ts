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
 * Address-poisoning guard — the pure detection half of "this new address
 * looks uncomfortably like one you already use".
 *
 * Poisoning attacks mint (or find) an address whose FIRST and LAST visible
 * characters match a victim's known destination, betting that the user only
 * eyeballs those. The wallet's job is to refuse that bet: any candidate that
 * shares a head AND a tail with a known address, without being equal to it,
 * must be surfaced loudly before signing.
 *
 * Same-length only: lookalikes mimic their target's shape, and different
 * lengths cannot be confusions — they are different address namespaces.
 */

/** Visible characters matched at each end before we call it a lookalike */
export const LOOKALIKE_HEAD = 5;
export const LOOKALIKE_TAIL = 4;

/** Normalise for comparison: strip the 0x prefix, lowercase. */
function normalize(address: string): string {
  return address.trim().toLowerCase().replace(/^0x/, '');
}

/**
 * True when `a` and `b` share ≥ LOOKALIKE_HEAD leading AND ≥ LOOKALIKE_TAIL
 * trailing characters but are not the same address. Equal addresses are NOT
 * lookalikes — the function answers "suspiciously different", never "same".
 */
export function isAddressLookalike(
  a: string,
  b: string,
  limits: { head?: number; tail?: number } = {},
): boolean {
  const x = normalize(a);
  const y = normalize(b);
  const head = limits.head ?? LOOKALIKE_HEAD;
  const tail = limits.tail ?? LOOKALIKE_TAIL;
  if (!x || !y || x === y) return false;
  if (x.length !== y.length) return false;
  if (x.length < head + tail) return false;
  return x.slice(0, head) === y.slice(0, head) && x.slice(-tail) === y.slice(-tail);
}

/**
 * Which known addresses does `candidate` lookalike? Case-insensitive dedupe
 * keeps the list short — the UI shows at most a couple of references.
 */
export function findLookalikes(candidate: string, known: Iterable<string>): string[] {
  const matches: string[] = [];
  const seen = new Set<string>();
  for (const k of known) {
    if (!k) continue;
    const kn = normalize(k);
    if (seen.has(kn)) continue;
    seen.add(kn);
    if (isAddressLookalike(candidate, k)) matches.push(k);
  }
  return matches;
}

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
 * EIP-191 personal_sign — the dApp message-signing primitive.
 *
 * digest = keccak256( utf8("\x19Ethereum Signed Message:\n" + len) || msgBytes )
 * signature = secp256k1(digest) low-s, 65 bytes r||s||v, v = recovery + 27
 *
 * MetaMask semantics for the message PARAMETER: it arrives as a 0x-hex
 * string encoding the RAW BYTES to hash (not the literal characters). A
 * non-hex string falls back to UTF-8 encoding for robustness. Cross-checked
 * against ethers v6 signMessage vectors in personalSign.test.ts.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

import { fromHex, toHex } from '@7xcircle/shared';

/** Decode a personal_sign message param into the bytes to prefix-hash */
export function messageParamToBytes(message: string): Uint8Array {
  if (/^0x[0-9a-fA-F]*$/.test(message) && message.length % 2 === 0 && message.length > 2) {
    return fromHex(message);
  }
  return new TextEncoder().encode(message);
}

/** EIP-191 personal-message digest of raw bytes */
export function hashPersonalMessage(bytes: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const joined = new Uint8Array(prefix.length + bytes.length);
  joined.set(prefix, 0);
  joined.set(bytes, prefix.length);
  return keccak_256(joined);
}

/**
 * Sign a ready-made 32-byte digest with the secp256k1 key, returning the
 * 65-byte 0x-hex signature (r ‖ s ‖ v, v = recovery + 27, low-s enforced).
 * Shared by personal_sign and EIP-712 typed data — the digest construction
 * differs, the wire signature does not.
 */
export function signDigest(digest: Uint8Array, privateKey: Uint8Array): string {
  const sig = secp256k1.sign(digest, privateKey, { lowS: true });
  const out = new Uint8Array(65);
  out.set(sig.toCompactRawBytes(), 0);
  out[64] = sig.recovery + 27;
  return '0x' + toHex(out);
}

/** Full personal_sign: message param → 65-byte 0x-hex signature */
export function signPersonalMessage(
  messageParam: string,
  privateKey: Uint8Array,
): string {
  const digest = hashPersonalMessage(messageParamToBytes(messageParam));
  return signDigest(digest, privateKey);
}

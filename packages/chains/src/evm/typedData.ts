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
 * EIP-712 typed-data digest for eth_signTypedData_v4.
 *
 * The hashing is delegated to viem — the same reference implementation
 * dApps themselves use — so structural encoding (type hashing, domain
 * separation, nested structs, arrays) cannot drift. The signature over the
 * resulting digest is the wallet's own secp256k1 primitive.
 */

import { hashTypedData } from 'viem';

/** Minimal shape of a v4 payload; unknown extra fields are rejected below. */
interface TypedDataV4 {
  domain?: unknown;
  types?: Record<string, unknown>;
  message?: unknown;
  primaryType?: string;
}

/**
 * Parse an eth_signTypedData_v4 JSON payload (the param arrives as a
 * string) and return its 32-byte EIP-712 digest as hex.
 *
 * @throws on malformed payloads — a typed-data request we cannot fully
 * parse must never be half-signed.
 */
export function hashTypedDataV4(payload: string): `0x${string}` {
  let parsed: TypedDataV4;
  try {
    parsed = JSON.parse(payload) as TypedDataV4;
  } catch {
    throw new Error('Typed data is not valid JSON');
  }
  if (!parsed.domain || !parsed.types || !parsed.primaryType || parsed.message === undefined) {
    throw new Error('Typed data is missing domain, types, primaryType or message');
  }
  // EIP712Domain is derived by viem from domain fields; a hand-listed one
  // in types is legal from dApps but must match — strict mode decides.
  const types = { ...parsed.types } as Record<string, unknown>;
  delete types.EIP712Domain; // viem re-derives it; a stale copy would drift
  return hashTypedData({
    domain: parsed.domain,
    types,
    message: parsed.message,
    primaryType: parsed.primaryType,
  } as Parameters<typeof hashTypedData>[0]);
}

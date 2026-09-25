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
 * ENS name resolution — the wire contract, no SDK.
 *
 * Two plain `eth_call`s, exactly what every wallet does under the hood:
 *   1. registry.resolver(namehash(name)) → the resolver contract
 *   2. resolver.addr(namehash(name))     → the 20-byte address
 *
 * Scope notes (honest degradation):
 *   - Only L1-resident records resolve. ENSIP-15 wildcards (sub.names and
 *     .base/.net) live behind a CCIP-read gateway; a direct L1 `addr` call
 *     returns empty for them, so we return null and the UI falls back to
 *     "not a valid address" — never a wrong address.
 *   - Resolution runs against Ethereum mainnet only; that is where the
 *     canonical registry lives, independent of the chain being sent to.
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { CHAIN_CONFIGS } from '../configs.js';

/** Canonical ENS registry — same address on every mainnet fork we support */
export const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

/** Mainnet RPCs in priority order — the same failover policy as the adapter */
const ENS_RPCS =
  CHAIN_CONFIGS.find(c => c.chainId === 'eth-1')?.rpcs ?? [
    'https://ethereum-rpc.publicnode.com',
  ];

/** selector(bytes4) of resolver(bytes32) on the registry */
const RESOLVER_SELECTOR = '0x0178b8bf';
/** selector(bytes4) of addr(bytes32) on a resolver */
const ADDR_SELECTOR = '0x3b3b57de';

const hex = (bytes: Uint8Array): string =>
  '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** EIP-137 namehash, computed bottom-up over dot-separated labels. */
export function namehash(name: string): string {
  // Explicitly un-generic: RN's lib types infer Uint8Array<ArrayBuffer> here
  // and reject keccak's ArrayBufferLike return otherwise.
  let node: Uint8Array = new Uint8Array(32); // 0x00…00 — the root node
  if (name) {
    for (const label of name.toLowerCase().split('.').reverse()) {
      const labelHash = keccak_256(new TextEncoder().encode(label));
      const joined = new Uint8Array(64);
      joined.set(node, 0);
      joined.set(labelHash, 32);
      node = keccak_256(joined);
    }
  }
  return hex(node);
}

/** Does this input look like a name to resolve rather than an address? */
export function isEnsName(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.endsWith('.eth') || trimmed.length <= 4) return false;
  // LDH-ish only: labels of letters/digits/hyphens, no spaces or dots-in-dots
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(trimmed);
}

function ethCall(to: string, data: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  });
}

/** Decode an eth_call JSON-RPC response's `result` hex field. */
async function callRpc(rpcUrl: string, to: string, data: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: ethCall(to, data),
  });
  if (!res.ok) throw new Error(`eth_call failed: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string };
  if (typeof body.result !== 'string') throw new Error('eth_call without a result');
  return body.result;
}

const isAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value);

/** Extract a 20-byte address from a 32-byte ABI word (last 20 bytes). */
function addressFromWord(word: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(word)) return null;
  const addr = '0x' + word.slice(26);
  // A zero address (empty record) and a 64-zeros result both mean "none"
  return isAddress(addr) && /^0x0+$/.test(addr) ? null : addr.toLowerCase();
}

/**
 * Resolve an ENS name to an address, or null when there is no record, the
 * record is L2/wildcard-only, or every RPC leg failed. Callers MUST treat
 * null as "don't send", never as zero — sending to a guessed address is the
 * harm this module exists to prevent.
 *
 * Transport failures move on to the next RPC (failover); an EMPTY on-chain
 * record is a definitive answer and stops there.
 */
export async function resolveEnsName(
  name: string,
  opts: { rpcUrls?: string[]; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  if (!isEnsName(name)) return null;
  const rpcs = opts.rpcUrls?.length ? opts.rpcUrls : ENS_RPCS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const node = namehash(name.trim().toLowerCase());

  for (const rpcUrl of rpcs) {
    try {
      const resolver = addressFromWord(
        await callRpc(rpcUrl, ENS_REGISTRY, RESOLVER_SELECTOR + node.slice(2), fetchImpl),
      );
      if (!resolver) return null; // registry answered: the name simply has no resolver

      return addressFromWord(
        await callRpc(rpcUrl, resolver, ADDR_SELECTOR + node.slice(2), fetchImpl),
      );
    } catch {
      // This RPC is down/rate-limited — try the next one before concluding.
    }
  }
  return null;
}

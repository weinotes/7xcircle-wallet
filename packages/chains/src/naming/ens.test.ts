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
 * Unit tests for the ENS wire contract: namehash golden vectors (EIP-137),
 * input gating, and the two-leg eth_call resolution flow against a mocked
 * fetch. No network in tests — the mock asserts the EXACT request bodies.
 */
import { describe, expect, it, vi } from 'vitest';
import { ENS_REGISTRY, isEnsName, namehash, resolveEnsName } from './ens.js';

const rpc = (result: string) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ result }),
  });

describe('namehash (EIP-137)', () => {
  it('root is 32 zero bytes', () => {
    expect(namehash('')).toBe('0x' + '00'.repeat(32));
  });

  it('matches viem/ens (cross-verified byte-for-byte) for "eth"', () => {
    expect(namehash('eth')).toBe(
      '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae',
    );
  });

  it('matches viem/ens for "foo.eth" and "vitalik.eth"', () => {
    expect(namehash('foo.eth')).toBe(
      '0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f',
    );
    expect(namehash('vitalik.eth')).toBe(
      '0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835',
    );
  });

  it('is case-insensitive per EIP-137 normalization of ASCII names', () => {
    expect(namehash('Foo.ETH')).toBe(namehash('foo.eth'));
  });
});

describe('isEnsName', () => {
  it('accepts plain and nested .eth names', () => {
    expect(isEnsName('vitalik.eth')).toBe(true);
    expect(isEnsName('sub.vitalik.eth')).toBe(true);
    expect(isEnsName(' NAME.ETH ')).toBe(true);
  });

  it('rejects addresses, bare words and malformed labels', () => {
    expect(isEnsName('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
    expect(isEnsName('eth')).toBe(false);
    expect(isEnsName('.eth')).toBe(false);
    expect(isEnsName('a b.eth')).toBe(false);
    expect(isEnsName('foo.sol')).toBe(false);
  });
});

describe('resolveEnsName', () => {
  const resolverWord = (addr: string) =>
    '0x' + addr.replace(/^0x/, '').padStart(64, '0');
  const empty = '0x' + '00'.repeat(32);

  it('walks registry.resolver → resolver.addr and lowercases the result', async () => {
    const target = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: resolverWord('0x4976fb03c3265b85519aa683bc18358e979ebc2') }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: resolverWord(target) }) });

    await expect(resolveEnsName('vitalik.eth', { fetchImpl })).resolves.toBe(target);

    // Leg 1: registry + resolver(bytes32) selector + node
    const [url1, init1] = (fetchImpl.mock.calls[0] ?? []) as [string, RequestInit];
    expect(url1).toBeTruthy();
    expect(String(init1.body)).toContain('"method":"eth_call"');
    expect(String(init1.body)).toContain(ENS_REGISTRY);
    expect(String(init1.body)).toContain('0x0178b8bf' + namehash('vitalik.eth').slice(2));

    // Leg 2: the resolver returned by leg 1 + addr(bytes32) selector
    expect(String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body))
      .toContain('0x3b3b57de' + namehash('vitalik.eth').slice(2));
  });

  it('returns null when the record is empty (L2 wildcard or unowned)', async () => {
    const fetchImpl = rpc(empty);
    await expect(resolveEnsName('missing.eth', { fetchImpl })).resolves.toBeNull();
    // Only the registry leg runs; no resolver to ask
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null on transport failure and never fabricates an address', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('rpc down'));
    await expect(resolveEnsName('vitalik.eth', { fetchImpl })).resolves.toBeNull();
  });

  it('refuses inputs that are not ENS names without touching the network', async () => {
    const fetchImpl = rpc(empty);
    await expect(resolveEnsName('0xdeadbeef', { fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

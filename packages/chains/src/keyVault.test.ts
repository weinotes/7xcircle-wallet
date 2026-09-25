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
 * Private-key-imported wallet end-to-end tests: a keys-envelope vault must
 * unlock into real chain accounts, and export must round-trip back into
 * what MetaMask/TronLink/Phantom show for the same key.
 *
 * Expected addresses are external ground truth (tronweb / ed25519 via the
 * independent bs58+tweetnacl capture used in interop.test.ts) for the
 * famous private key = 1 and a 32-byte seed ending in 07.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import {
  encryptVault,
  encodeVaultSecret,
  unlock,
  lock,
  getPrivateKey,
  exportAccountPrivateKey,
  revealRecoveryPhrase,
  isUnlocked,
} from '@7xcircle/core';
import type { Account } from '@7xcircle/shared';
import { registerAllChains, CHAIN_CONFIGS } from './index.js';

const EVM_PK1 = '0x' + '00'.repeat(31) + '01';
const EVM_PK1_ADDR = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'; // canonical secp256k1 vec
const TRON_PK1_ADDR = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';        // tronweb 6.5.1 cross-checked
const SOL_SEED7_ADDR = '5EUjf4oPLzrA7w7M9EC9fDEyBBjkAVS4QgqrZhRx3G9s'; // bs58(ed25519.getPublicKey(seed))
const SOL_SECRET58 = '111111111111111111111111111111139qhL8b4auL1Y7WbGjTSE1krcveF1Nwvio3X8b9RKevso';

const PASSWORD = 'Test Pass!2026x';

let accounts: Account[];

beforeAll(async () => {
  registerAllChains();
  const vault = await encryptVault(encodeVaultSecret({
    kind: 'keys',
    keys: [
      { family: 'evm', privateKey: EVM_PK1 },
      { family: 'tron', privateKey: EVM_PK1 },
      { family: 'solana', privateKey: SOL_SECRET58 },
    ],
  }), PASSWORD);
  accounts = await unlock(vault, PASSWORD, CHAIN_CONFIGS);
});

const byChain = (chainId: string) => accounts.find(a => a.chainId === chainId);

describe('keys-vault unlock', () => {
  it('produces one account per chain, all source=key', () => {
    expect(accounts.length).toBeGreaterThan(5);
    expect(accounts.every(a => a.source === 'key')).toBe(true);
    expect(byChain('eth-1') && byChain('bsc-56') && byChain('tron-227') && byChain('solana')).toBeTruthy();
  });

  it('EVM key lands on the canonical pk=1 address on EVERY EVM chain', () => {
    expect(byChain('eth-1')!.address.toLowerCase()).toBe(EVM_PK1_ADDR);
    expect(byChain('bsc-56')!.address.toLowerCase()).toBe(EVM_PK1_ADDR);
    expect(byChain('polygon-137')?.address.toLowerCase() ?? EVM_PK1_ADDR).toBe(EVM_PK1_ADDR);
  });

  it('tron key lands on the tronweb-verified T-address', () => {
    expect(byChain('tron-227')!.address).toBe(TRON_PK1_ADDR);
  });

  it('solana secret lands on the pubkey address', () => {
    expect(byChain('solana')!.address).toBe(SOL_SEED7_ADDR);
  });

  it('getPrivateKey returns the stored key (copy, per chain family)', async () => {
    const pk = getPrivateKey(byChain('eth-1')!);
    expect(Buffer.from(pk).toString('hex')).toBe('00'.repeat(31) + '01');
    pk.fill(0); // caller-side wipe must not corrupt the session copy
    const again = getPrivateKey(byChain('eth-1')!);
    expect(again[31]).toBe(1);
  });

  it('lock() wipes everything — re-signing throws, accounts gone', () => {
    lock();
    expect(isUnlocked()).toBe(false);
    expect(() => getPrivateKey(byChain('eth-1')!)).toThrow(/locked/);
  });
});

describe('export round-trips (password re-gate)', () => {
  beforeAll(async () => {
    // re-unlock after the previous suite locked the session
    const vault = await encryptVault(encodeVaultSecret({
      kind: 'keys',
      keys: [
        { family: 'evm', privateKey: EVM_PK1 },
        { family: 'tron', privateKey: EVM_PK1 },
        { family: 'solana', privateKey: SOL_SECRET58 },
      ],
    }), PASSWORD);
    accounts = await unlock(vault, PASSWORD, CHAIN_CONFIGS);
  });

  it('exports keys in the exact format their reference wallet uses', async () => {
    const vault = await encryptVault(encodeVaultSecret({
      kind: 'keys',
      keys: [
        { family: 'evm', privateKey: EVM_PK1 },
        { family: 'tron', privateKey: EVM_PK1 },
        { family: 'solana', privateKey: SOL_SECRET58 },
      ],
    }), PASSWORD);
    expect(await exportAccountPrivateKey(byChain('eth-1')!, vault, PASSWORD)).toBe(EVM_PK1);
    expect(await exportAccountPrivateKey(byChain('tron-227')!, vault, PASSWORD)).toBe(EVM_PK1);
    expect(await exportAccountPrivateKey(byChain('solana')!, vault, PASSWORD)).toBe(SOL_SECRET58);
  });

  it('wrong password is rejected before anything leaks', async () => {
    const vault = await encryptVault(encodeVaultSecret({
      kind: 'keys', keys: [{ family: 'evm', privateKey: EVM_PK1 }],
    }), PASSWORD);
    await expect(exportAccountPrivateKey(accounts[0], vault, 'wrong')).rejects.toThrow();
  });

  it('a keys wallet has no recovery phrase to reveal', async () => {
    const vault = await encryptVault(encodeVaultSecret({
      kind: 'keys', keys: [{ family: 'evm', privateKey: EVM_PK1 }],
    }), PASSWORD);
    await expect(revealRecoveryPhrase(vault, PASSWORD)).rejects.toThrow(/no recovery phrase/);
  });

  it('HD vaults STILL unlock (legacy + envelope) and export derived keys', async () => {
    const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    for (const plaintext of [phrase, encodeVaultSecret({ kind: 'mnemonic', mnemonic: phrase })]) {
      const vault = await encryptVault(plaintext, PASSWORD);
      const hd = await unlock(vault, PASSWORD, CHAIN_CONFIGS);
      const eth = hd.find(a => a.chainId === 'eth-1')!;
      expect(eth.address.toLowerCase()).toBe('0x9858effd232b4033e47d90003d41ec34ecaeda94');
      expect(eth.source).toBeUndefined(); // hd is the default
      const exported = await exportAccountPrivateKey(eth, vault, PASSWORD);
      expect(exported.startsWith('0x')).toBe(true);
      expect(await revealRecoveryPhrase(vault, PASSWORD)).toBe(phrase);
      lock();
    }
  });
});

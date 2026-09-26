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
 * distributed under the License is an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Session-manager matrix tests that keyVault.test.ts leaves uncovered:
 * HD multi-account derivation, deriveMoreAccount (add-account flow),
 * the mnemonic getPrivateKey paths, and the registry surface. Everything
 * runs against the real registered adapters — same code the apps ship.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import {
  base58Encode,
  chainRegistry,
  deriveEvmPrivateKey,
  deriveMoreAccount,
  deriveSolanaPrivateKey,
  encryptVault,
  encodeVaultSecret,
  exportAccountPrivateKey,
  getPrivateKey,
  getSessionState,
  isUnlocked,
  lock,
  revealRecoveryPhrase,
  unlock,
  type ChainAdapter,
} from '@7xcircle/core';
import type { Account, ChainConfig } from '@7xcircle/shared';
import { registerAllChains, CHAIN_CONFIGS } from './index.js';

// Canonical BIP39 test mnemonic (all-zero entropy). Public everywhere.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'Session Matrix!2026x';

const ethCfg = CHAIN_CONFIGS.find(c => c.chainId === 'eth-1')!;
const solCfg = CHAIN_CONFIGS.find(c => c.chainId === 'solana')!;
const tronCfg = CHAIN_CONFIGS.find(c => c.chainId === 'tron-227')!;

/** A chain config whose adapter is NOT registered (custom-RPC style) */
const GHOST_CONFIG: ChainConfig = {
  ...ethCfg,
  chainId: 'ghost-99',
  name: 'Ghost Chain',
};

/** A registered adapter for a chain type the session layer cannot derive */
const UTXO_CONFIG: ChainConfig = {
  chainId: 'utxo-1',
  name: 'Bitcoin (stub)',
  type: 'utxo',
  nativeSymbol: 'BTC',
  nativeDecimals: 8,
  rpcs: ['https://invalid.test'],
  bip44Path: "m/84'/0'/0'/0",
};

let vault: Awaited<ReturnType<typeof encryptVault>>;
let accounts: Account[];

const byChain = (chainId: string) => accounts.filter(a => a.chainId === chainId);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

beforeAll(async () => {
  registerAllChains();
  chainRegistry.register({
    chainId: 'utxo-1',
    config: UTXO_CONFIG,
    deriveAddress: (_pk: Uint8Array, idx: number) => `stub-utxo-${idx}`,
  } as unknown as ChainAdapter);
  vault = await encryptVault(
    encodeVaultSecret({ kind: 'mnemonic', mnemonic: MNEMONIC }),
    PASSWORD,
  );
  accounts = await unlock(vault, PASSWORD, [...CHAIN_CONFIGS, GHOST_CONFIG, UTXO_CONFIG], {
    'eth-1': 3,
    'solana': 2,
  });
});

describe('HD unlock with per-chain account counts', () => {
  it('derives N consecutive accounts for chains that ask for them', () => {
    const eth = byChain('eth-1');
    expect(eth).toHaveLength(3);
    expect(eth.map(a => a.accountIndex)).toEqual([0, 1, 2]);
    expect(eth.map(a => a.derivationPath)).toEqual([
      `${ethCfg.bip44Path}/0`, `${ethCfg.bip44Path}/1`, `${ethCfg.bip44Path}/2`,
    ]);
    expect(eth[1].nickname).toContain('#2');
    // Chains without an explicit count carry exactly one, unnumbered account
    expect(byChain('bsc-56')).toHaveLength(1);
    expect(byChain('bsc-56')[0].nickname).toBe(CHAIN_CONFIGS.find(c => c.chainId === 'bsc-56')!.name);
  });

  it('hardens every Solana index (ed25519 needs all-hardened paths)', () => {
    const sol = byChain('solana');
    expect(sol).toHaveLength(2);
    expect(sol.map(a => a.derivationPath)).toEqual([
      `${solCfg.bip44Path}/0'`, `${solCfg.bip44Path}/1'`,
    ]);
  });

  it('skips unregistered chains and unsupported types without failing the unlock', () => {
    expect(byChain('ghost-99')).toHaveLength(0); // no adapter in registry
    expect(byChain('utxo-1')).toHaveLength(0);   // adapter, but type unsupported
    expect(byChain('tron-227')).toHaveLength(1); // sanity: supported chains work
  });

  it('getSessionState returns a defensive copy of the account list', () => {
    const snapshot = getSessionState();
    expect(snapshot.unlocked).toBe(true);
    const before = snapshot.accounts.length;
    snapshot.accounts.pop();
    expect(getSessionState().accounts).toHaveLength(before);
  });
});

describe('getPrivateKey on a mnemonic session', () => {
  it('re-derives exactly what the interop vectors promise per chain type', () => {
    const eth1 = byChain('eth-1')[1];
    const ethKey = getPrivateKey(eth1);
    expect(hex(ethKey)).toBe(hex(deriveEvmPrivateKey(MNEMONIC, eth1.derivationPath)));
    ethKey.fill(0);

    const tronKey = getPrivateKey(byChain('tron-227')[0]);
    expect(hex(tronKey)).toBe(hex(deriveEvmPrivateKey(MNEMONIC, tronCfg.bip44Path + '/0')));
    tronKey.fill(0);

    const solAcct = byChain('solana')[1];
    const solKey = getPrivateKey(solAcct);
    expect(hex(solKey)).toBe(hex(deriveSolanaPrivateKey(MNEMONIC, solAcct.derivationPath)));
    solKey.fill(0);
  });

  it('refuses accounts whose chain has no config registered', () => {
    const fake = { ...byChain('eth-1')[0], chainId: 'nope-1' };
    expect(() => getPrivateKey(fake)).toThrow(/No chain config/);
  });

  it('refuses chain types it cannot derive even with a registered adapter', () => {
    const utxo = { ...byChain('eth-1')[0], chainId: 'utxo-1' };
    expect(() => getPrivateKey(utxo)).toThrow(/Unsupported chain type/);
  });
});

describe('deriveMoreAccount (MetaMask-style add-account)', () => {
  it('appends the next HD index to the live session and can sign with it', () => {
    const before = byChain('eth-1').length;
    const extra = deriveMoreAccount('eth-1');
    expect(extra.accountIndex).toBe(before);
    expect(extra.derivationPath).toBe(`${ethCfg.bip44Path}/${before}`);
    expect(extra.nickname).toContain(`#${before + 1}`);
    expect(byChain('eth-1')).toHaveLength(before + 1); // session list grew
    const key = getPrivateKey(extra);
    expect(hex(key)).toBe(hex(deriveEvmPrivateKey(MNEMONIC, extra.derivationPath)));
    key.fill(0);
  });

  it('hardens the added Solana index too', () => {
    const extra = deriveMoreAccount('solana');
    expect(extra.derivationPath).toBe(`${solCfg.bip44Path}/2'`);
  });

  it('rejects chains without a registered adapter', () => {
    expect(() => deriveMoreAccount('ghost-99')).toThrow(/No chain config/);
  });

  it('rejects registered chains whose type it cannot derive', () => {
    expect(() => deriveMoreAccount('utxo-1')).toThrow(/Unsupported chain type/);
  });

  it('stops at the per-chain ceiling', async () => {
    // Fresh unlock with the cap already reached for eth-1
    await unlock(vault, PASSWORD, CHAIN_CONFIGS, { 'eth-1': 10 });
    expect(() => deriveMoreAccount('eth-1')).toThrow(/Maximum 10 accounts/);
    // restore the shared session for later describes
    accounts = await unlock(vault, PASSWORD, [...CHAIN_CONFIGS, GHOST_CONFIG, UTXO_CONFIG], {
      'eth-1': 3,
      'solana': 2,
    });
  });
});

describe('password-gated exports on a mnemonic session', () => {
  it('reveals the phrase only with the password re-supplied', async () => {
    await expect(revealRecoveryPhrase(vault, PASSWORD)).resolves.toBe(MNEMONIC);
    await expect(revealRecoveryPhrase(vault, 'wrong password')).rejects.toThrow();
  });

  it('exports Solana as base58 of the 64-byte secret (Phantom format)', async () => {
    const sol = byChain('solana')[0];
    const exported = await exportAccountPrivateKey(sol, vault, PASSWORD);
    expect(exported).toBe(base58Encode(deriveSolanaPrivateKey(MNEMONIC, sol.derivationPath)));
  });

  it('exports EVM as 0x-hex 32-byte keys', async () => {
    const eth = byChain('eth-1')[0];
    const exported = await exportAccountPrivateKey(eth, vault, PASSWORD);
    expect(exported).toBe('0x' + hex(deriveEvmPrivateKey(MNEMONIC, eth.derivationPath)));
  });

  it('refuses chains without a registered config', async () => {
    const fake = { ...byChain('eth-1')[0], chainId: 'nope-1' };
    await expect(exportAccountPrivateKey(fake, vault, PASSWORD)).rejects.toThrow(/No chain config/);
  });
});

describe('key-vault edges', () => {
  let keyVault: Awaited<ReturnType<typeof encryptVault>>;
  const EVM_PK1 = '0x' + '00'.repeat(31) + '01';
  const orphan = (chainId: string): Account => ({
    id: 'orphan-1',
    chainId,
    address: 'n/a',
    publicKey: 'n/a',
    derivationPath: 'imported',
    accountIndex: 0,
    nickname: 'orphan',
    createdAt: 0,
    source: 'key',
  });

  beforeAll(async () => {
    keyVault = await encryptVault(encodeVaultSecret({
      kind: 'keys',
      keys: [{ family: 'evm', privateKey: EVM_PK1 }],
    }), PASSWORD);
    accounts = await unlock(keyVault, PASSWORD, CHAIN_CONFIGS);
  });

  it('deriveMoreAccount refuses imported-key vaults — there is no key tree', () => {
    expect(() => deriveMoreAccount('eth-1')).toThrow(/imported from private keys/);
  });

  it('getPrivateKey refuses a chain the imported family does not cover', () => {
    expect(() => getPrivateKey(orphan('tron-227'))).toThrow(/No imported key for tron-227/);
  });

  it('export refuses a chain the imported family does not cover', async () => {
    await expect(exportAccountPrivateKey(orphan('tron-227'), keyVault, PASSWORD))
      .rejects.toThrow(/No imported key covers tron-227/);
  });

  it('phrase reveal honestly declines: key vaults have no phrase', async () => {
    await expect(revealRecoveryPhrase(keyVault, PASSWORD))
      .rejects.toThrow(/no recovery phrase/);
  });
});

describe('locked session', () => {
  it('deriveMoreAccount demands an unlock first', () => {
    lock();
    expect(isUnlocked()).toBe(false);
    expect(() => deriveMoreAccount('eth-1')).toThrow(/please unlock/);
  });
});

describe('registry surface', () => {
  beforeAll(() => registerAllChains()); // re-populate after the lock() above

  it('answers has/get for registered chains', () => {
    expect(chainRegistry.has('eth-1')).toBe(true);
    expect(chainRegistry.get('ghost-99')).toBeUndefined();
    expect(chainRegistry.getAll().length).toBeGreaterThanOrEqual(CHAIN_CONFIGS.length);
  });

  it('remove and clear drop adapters', () => {
    chainRegistry.remove('eth-1');
    expect(chainRegistry.has('eth-1')).toBe(false);
    chainRegistry.clear();
    expect(chainRegistry.getAll()).toHaveLength(0);
    registerAllChains(); // leave the singleton as the app expects it
    expect(chainRegistry.has('eth-1')).toBe(true);
  });
});

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
 * Cross-wallet interoperability tests — THE migration contract.
 *
 * A TokenPocket/MetaMask/Phantom/TronLink user importing their mnemonic
 * into this wallet MUST see the same addresses they have today, or the
 * migration silently shows empty balances. Every expected value below was
 * produced by the reference implementation the mainstream wallets use,
 * NOT by this repo's code:
 *
 *   ETH/BNB  ethers v6 HDNodeWallet        (same path MetaMask derives)
 *   TRX      ethers v6 + tronweb 6.5.1     (TronLink/TP path + address codec)
 *   SOL      ed25519-hd-key + tweetnacl    (the Phantom/Solflare reference lib)
 *
 * Captured 2026-09-25 against the canonical all-abandon BIP39 test vector.
 */

import { describe, it, expect } from 'vitest';

import {
  deriveEvmPrivateKey,
  deriveSolanaPrivateKey,
  evmPublicKey,
  solanaPublicKey,
} from '@open-wallet/core';
import { getChainConfig } from './configs.js';
import { EvmAdapter } from './evm/adapter.js';
import { SolanaAdapter } from './solana/adapter.js';
import { publicKeyToTronAddress } from './tron/address.js';
import { toHex } from '@open-wallet/shared';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Canonical BIP39 test mnemonic (all-zero entropy). Public everywhere;
// the ETH address below is the one MetaMask shows for this phrase.
const ETH_ADDR = '0x9858effd232b4033e47d90003d41ec34ecaeda94';
const TRX_ADDR = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const SOL_ADDR = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

describe('cross-wallet address interop (TokenPocket migration contract)', () => {
  it('EVM: same address as MetaMask for the standard path', () => {
    const config = getChainConfig('eth-1')!;
    const pk = deriveEvmPrivateKey(TEST_MNEMONIC, `${config.bip44Path}/0`);
    const addr = new EvmAdapter(config).deriveAddress(evmPublicKey(pk), 0);
    expect(addr.toLowerCase()).toBe(ETH_ADDR);
  });

  it('TRON: same address as TronLink/TokenPocket', () => {
    const config = getChainConfig('tron-227')!;
    const pk = deriveEvmPrivateKey(TEST_MNEMONIC, `${config.bip44Path}/0`);
    expect(publicKeyToTronAddress(evmPublicKey(pk))).toBe(TRX_ADDR);
  });

  it('Solana: same address as Phantom (m/44\'/501\'/0\'/0\')', () => {
    const config = getChainConfig('solana')!;
    const pk = deriveSolanaPrivateKey(TEST_MNEMONIC, `${config.bip44Path}/0'`);
    const addr = new SolanaAdapter(config).deriveAddress(solanaPublicKey(pk), 0);
    expect(addr).toBe(SOL_ADDR);
  });

  it('every EVM chain derives the SAME address as Ethereum (single identity)', () => {
    const ethPk = deriveEvmPrivateKey(TEST_MNEMONIC, `${getChainConfig('eth-1')!.bip44Path}/0`);
    const ethAddr = new EvmAdapter(getChainConfig('eth-1')!).deriveAddress(evmPublicKey(ethPk), 0);
    for (const chainId of ['bsc-56', 'polygon-137', 'arbitrum-42161', 'optimism-10', 'base-8453', 'avalanche-43114']) {
      const config = getChainConfig(chainId)!;
      const pk = deriveEvmPrivateKey(TEST_MNEMONIC, `${config.bip44Path}/0`);
      expect(new EvmAdapter(config).deriveAddress(evmPublicKey(pk), 0)).toBe(ethAddr);
    }
  });

  it('config guard: no non-60 coin path snuck back into an EVM chain', () => {
    // See the compatibility rule in configs.ts — 714/966/9000 on an EVM
    // chain silently hides migrant users' balances
    for (const config of ['eth-1', 'bsc-56', 'polygon-137', 'arbitrum-42161', 'optimism-10', 'base-8453', 'avalanche-43114'].map(id => getChainConfig(id)!)) {
      expect(config.bip44Path, `${config.chainId} must use coin-60`).toBe("m/44'/60'/0'/0");
    }
  });

  it('private-key import compatibility: hex pk → same EVM address', () => {
    // TP users also export/import single-chain private keys (0x-hex, 32B)
    const pk = deriveEvmPrivateKey(TEST_MNEMONIC, "m/44'/60'/0'/0/0");
    const hex = '0x' + toHex(pk);
    expect(hex.length).toBe(66);
    const addr = new EvmAdapter(getChainConfig('bsc-56')!).deriveAddress(evmPublicKey(pk), 0);
    expect(addr.toLowerCase()).toBe(ETH_ADDR);
  });
});

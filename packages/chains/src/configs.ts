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
 * Chain configurations for all supported networks.
 * Each config includes RPC failover list, explorer URL, and BIP44 path.
 *
 * ⚠ EVM derivation-path compatibility rule: every EVM chain MUST use the
 * coin-60 path (m/44'/60'/0'/0). MetaMask/TokenPocket/Trust hold one single
 * EVM identity across all EVM chains — the SLIP-0044 native coins (714 BNB,
 * 966 MATIC, 9000 AVAX…) are NOT used for EVM addresses anywhere, and a
 * migrant importing their mnemonic would see EMPTY balances on those chains.
 * Asset compat outranks coin-type purity.
 */

import type { ChainConfig } from '@open-wallet/shared';

/** All built-in chain configurations */
export const CHAIN_CONFIGS: ChainConfig[] = [
  {
    chainId: 'eth-1',
    name: 'Ethereum',
    type: 'evm',
    chainIdDecimal: 1,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    rpcs: [
      'https://rpc.ankr.com/eth',
      'https://ethereum.publicnode.com',
      'https://cloudflare-eth.com',
    ],
    explorer: 'https://etherscan.io',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'ethereum',
  },
  {
    chainId: 'bsc-56',
    name: 'BNB Chain',
    type: 'evm',
    chainIdDecimal: 56,
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    rpcs: [
      'https://bsc-dataseed.binance.org',
      'https://rpc.ankr.com/bsc',
      'https://bsc.publicnode.com',
    ],
    explorer: 'https://bscscan.com',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'binance',
  },
  {
    chainId: 'bsc-97',
    name: 'BSC Testnet',
    type: 'evm',
    chainIdDecimal: 97,
    nativeSymbol: 'tBNB',
    nativeDecimals: 18,
    rpcs: [
      'https://bsc-testnet.publicnode.com',
      'https://data-seed-prebsc-2-s1.binance.org:8545',
      'https://data-seed-prebsc-1-s2.binance.org:8545',
      'https://data-seed-prebsc-2-s2.binance.org:8545',
    ],
    explorer: 'https://testnet.bscscan.com',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'binance',
    testnet: true,
  },
  {
    chainId: 'polygon-137',
    name: 'Polygon',
    type: 'evm',
    chainIdDecimal: 137,
    nativeSymbol: 'MATIC',
    nativeDecimals: 18,
    rpcs: [
      'https://polygon-rpc.com',
      'https://rpc.ankr.com/polygon',
      'https://polygon.publicnode.com',
    ],
    explorer: 'https://polygonscan.com',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'polygon',
  },
  {
    chainId: 'arbitrum-42161',
    name: 'Arbitrum One',
    type: 'evm',
    chainIdDecimal: 42161,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    rpcs: [
      'https://arb1.arbitrum.io/rpc',
      'https://rpc.ankr.com/arbitrum',
    ],
    explorer: 'https://arbiscan.io',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'arbitrum',
  },
  {
    chainId: 'optimism-10',
    name: 'Optimism',
    type: 'evm',
    chainIdDecimal: 10,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    rpcs: [
      'https://mainnet.optimism.io',
      'https://rpc.ankr.com/optimism',
    ],
    explorer: 'https://optimistic.etherscan.io',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'optimism',
  },
  {
    chainId: 'base-8453',
    name: 'Base',
    type: 'evm',
    chainIdDecimal: 8453,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    rpcs: [
      'https://mainnet.base.org',
      'https://rpc.ankr.com/base',
    ],
    explorer: 'https://basescan.org',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'base',
  },
  {
    chainId: 'avalanche-43114',
    name: 'Avalanche C-Chain',
    type: 'evm',
    chainIdDecimal: 43114,
    nativeSymbol: 'AVAX',
    nativeDecimals: 18,
    rpcs: [
      'https://api.avax.network/ext/bc/C/rpc',
      'https://rpc.ankr.com/avalanche',
    ],
    explorer: 'https://snowtrace.io',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'avalanche',
  },
  {
    chainId: 'solana',
    name: 'Solana',
    type: 'solana',
    nativeSymbol: 'SOL',
    nativeDecimals: 9,
    // Every entry MUST be mainnet. A devnet URL here is a failover hazard:
    // when mainnet-beta is slow the adapter would silently switch clusters,
    // showing devnet balances and broadcasting to the wrong network.
    rpcs: [
      'https://api.mainnet-beta.solana.com',
      'https://solana-rpc.publicnode.com',
    ],
    explorer: 'https://explorer.solana.com',
    bip44Path: "m/44'/501'/0'",
    icon: 'solana',
  },
  {
    chainId: 'tron-227',
    name: 'TRON',
    type: 'tron',
    nativeSymbol: 'TRX',
    nativeDecimals: 6,
    // TronGrid is the de-facto public fullnode cluster; keyless access is
    // rate-limited (per IP) on /wallet, and /v1 data endpoints need a free
    // API key — see TronAdapter.setGridApiKey.
    rpcs: [
      'https://api.trongrid.io',
    ],
    explorer: 'https://tronscan.org',
    bip44Path: "m/44'/195'/0'/0",
    icon: 'tron',
  },
  {
    chainId: 'tron-nile',
    name: 'TRON Nile',
    type: 'tron',
    nativeSymbol: 'TRX',
    nativeDecimals: 6,
    rpcs: [
      'https://nile.trongrid.io',
    ],
    explorer: 'https://nile.tronscan.org',
    bip44Path: "m/44'/195'/0'/0",
    icon: 'tron',
    testnet: true,
  },
];

/** Lookup config by chainId */
export function getChainConfig(chainId: string): ChainConfig | undefined {
  return CHAIN_CONFIGS.find(c => c.chainId === chainId);
}

/** Get all EVM chain configs */
export function getEvmConfigs(): ChainConfig[] {
  return CHAIN_CONFIGS.filter(c => c.type === 'evm');
}

/** Get all Solana chain configs */
export function getSolanaConfigs(): ChainConfig[] {
  return CHAIN_CONFIGS.filter(c => c.type === 'solana');
}

/** Get all TRON chain configs */
export function getTronConfigs(): ChainConfig[] {
  return CHAIN_CONFIGS.filter(c => c.type === 'tron');
}

// ─── RPC overrides ───────────────────────────────────────────────────

/**
 * Per-chain RPC override — point a chain at a paid fast node
 * (Helius / Triton / QuickNode) without editing the built-in configs.
 *
 * Deliberately an imperative setter rather than an env read: `CHAIN_CONFIGS`
 * is a module-level const evaluated at import time, and browser bundlers do
 * not expose `process.env` at runtime. Apps call `setRpcOverride(...)` before
 * `registerAllChains()` with whatever their platform provides
 * (`import.meta.env`, a remote config, a user setting).
 */
const rpcOverrides = new Map<string, string>();

/** Override one chain's preferred RPC. Pass undefined to clear. */
export function setRpcOverride(chainId: string, url: string | undefined): void {
  if (url) rpcOverrides.set(chainId, url);
  else rpcOverrides.delete(chainId);
}

/** Override several chains at once (skips empty values) */
export function setRpcOverrides(map: Record<string, string | undefined>): void {
  for (const [chainId, url] of Object.entries(map)) {
    setRpcOverride(chainId, url);
  }
}

/** Clear every override — mainly for tests */
export function clearRpcOverrides(): void {
  rpcOverrides.clear();
}

/** The override URL for a chain, if one is set */
export function getRpcOverride(chainId: string): string | undefined {
  return rpcOverrides.get(chainId);
}

/**
 * Effective RPC list for a chain: the override first (fast path), then the
 * built-in endpoints as failover.
 */
export function resolveRpcs(chainId: string, fallback: string[]): string[] {
  const override = rpcOverrides.get(chainId);
  if (!override) return fallback;
  return [override, ...fallback.filter(url => url !== override)];
}

/** Apply any configured override to a chain config */
export function withRpcOverride(config: ChainConfig): ChainConfig {
  const rpcs = resolveRpcs(config.chainId, config.rpcs);
  return rpcs === config.rpcs ? config : { ...config, rpcs };
}

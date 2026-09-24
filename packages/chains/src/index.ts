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
export * from './configs.js';
export * from './evm/adapter.js';
export * from './evm/explorer.js';
export * from './solana/adapter.js';
export * from './solana/jupiter.js';
export * from './tron/adapter.js';
export * from './tron/address.js';

import { chainRegistry } from '@open-wallet/core';
import { EvmAdapter } from './evm/adapter.js';
import { SolanaAdapter } from './solana/adapter.js';
import { TronAdapter } from './tron/adapter.js';
import { CHAIN_CONFIGS, withRpcOverride } from './configs.js';

/**
 * Register all built-in chain adapters into the global registry.
 *
 * Any RPC override set via `setRpcOverride` BEFORE this call is applied here,
 * so adapters are constructed with the effective endpoint list.
 */
export function registerAllChains(): void {
  for (const config of CHAIN_CONFIGS) {
    const effective = withRpcOverride(config);
    if (effective.type === 'evm') {
      chainRegistry.register(new EvmAdapter(effective));
    } else if (effective.type === 'solana') {
      chainRegistry.register(new SolanaAdapter(effective));
    } else if (effective.type === 'tron') {
      chainRegistry.register(new TronAdapter(effective));
    }
  }
}

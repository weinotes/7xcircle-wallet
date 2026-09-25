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
 * Mobile send pipeline — build → sign → broadcast, keys wiped per attempt.
 *
 * Same discipline as the web useTxFlow: the adapter rebuilds fresh chain
 * state (nonce / blockhash / TAPOS) on every build call, so a manual retry
 * after a Solana expiry just calls sendTx again — nothing is cached here.
 */

import { getPrivateKey, touchActivity } from '@open-wallet/core';
import type { ChainAdapter } from '@open-wallet/core';
import type { Account, FeeTier, TxIntent } from '@open-wallet/shared';

export async function sendTx(params: {
  adapter: ChainAdapter;
  account: Account;
  intent: TxIntent;
  feeTier?: FeeTier;
}): Promise<string> {
  const { adapter, account, intent, feeTier = 'normal' } = params;
  const built = await adapter.buildTransaction(intent, {
    from: account.address,
    feeTier,
  });
  touchActivity();
  const privateKey = getPrivateKey(account);
  try {
    const signed = await adapter.signTransaction(built, privateKey);
    return await adapter.sendTransaction(signed);
  } finally {
    privateKey.fill(0);
  }
}

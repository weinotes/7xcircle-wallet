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
 * One signing dispatcher for every account source.
 *
 *   hd / key  → in-memory private key + adapter.signTransaction (wipe after)
 *   ledger    → the hardware device (EVM only); no key ever exists here
 *
 * Both useTxFlow and the dApp approval page route through this, so a
 * hardware account can never accidentally hit the software key path.
 */

import { getPrivateKey } from '@open-wallet/core';
import type { Account, SignedTransaction, UnsignedTx } from '@open-wallet/shared';
import type { ChainAdapter } from '@open-wallet/core';

import { ledgerPathOf, ledgerSignEvmTransaction, openEthApp } from './ledger.js';

export async function signForAccount(
  account: Account,
  unsigned: UnsignedTx,
  adapter: ChainAdapter,
): Promise<SignedTransaction> {
  if (account.source !== 'ledger') {
    const privateKey = getPrivateKey(account);
    try {
      return await adapter.signTransaction(unsigned, privateKey);
    } finally {
      privateKey.fill(0);
    }
  }

  // ── hardware path ────────────────────────────────────────────────────
  if (unsigned.chainType !== 'evm') {
    throw new Error('Hardware wallets currently sign on EVM chains only');
  }
  const { eth, close } = await openEthApp();
  try {
    return await ledgerSignEvmTransaction(eth, ledgerPathOf(account), unsigned);
  } finally {
    await close().catch(() => undefined);
  }
}

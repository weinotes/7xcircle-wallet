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
 * TRON send-flow integration test — runs TronAdapter against mainnet
 * read endpoints plus an ERROR-ORACLE broadcast path that needs no funds.
 *
 * The oracle: a correctly parsed + correctly signed transaction from an
 * unfunded account is rejected for RESOURCE reasons ("over bandwidth
 * limit", "balance not enough"). Any SIGNATURE / ILLEGAL / PARSE type
 * message instead means our protobuf or signature encoding is wrong.
 * This distinguishes "our bytes are valid Tron" from "node couldn't
 * parse our submission" without ever moving money.
 *
 * Usage:
 *   pnpm tsx scripts/tron-test.ts
 *   TRON_MNEMONIC="..." pnpm tsx scripts/tron-test.ts   # funded end-to-end
 */

import { randomBytes } from 'node:crypto';

import { deriveEvmPrivateKey, evmPublicKey } from '../packages/core/src/keys/mnemonic.js';
import { TronAdapter } from '../packages/chains/src/tron/adapter.js';
import { publicKeyToTronAddress } from '../packages/chains/src/tron/address.js';
import { getChainConfig } from '../packages/chains/src/configs.js';
import type { TxIntent } from '@open-wallet/shared';

const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  const config = getChainConfig('tron-227');
  if (!config) throw new Error('tron-227 config missing');
  const adapter = new TronAdapter(config);

  // 1. Block height (exercises getnowblock + blockID shape)
  const height = await adapter.getBlockHeight();
  check('getBlockHeight returns a plausible mainnet height', height > 60_000_000, `#${height}`);

  // 2. Token metadata via triggerconstantcontract — external ground truth:
  //    this contract MUST report USDT. Validates ABI encoding + API mapping.
  const info = await adapter.getTokenInfo(USDT_TRC20);
  check('getTokenInfo(USDT) decodes to symbol USDT', info.symbol === 'USDT', JSON.stringify(info));
  check('USDT decimals = 6', info.decimals === 6, String(info.decimals));

  // 3. Native balance of a very active address (the USDT contract itself)
  const bal = await adapter.getNativeBalance(USDT_TRC20);
  check('getNativeBalance returns numeric string', /^\d+$/.test(bal), `${bal} sun`);

  // 4. Fee estimate for a native transfer (exercises chain params + builder)
  const ownerPk = randomBytes(32);
  const ownerPub = evmPublicKey(ownerPk);
  const owner = publicKeyToTronAddress(ownerPub);
  const intent: TxIntent = { kind: 'native-transfer', to: owner, amountRaw: '1000000' };
  const fees = await adapter.estimateFees(intent, { from: owner, feeTier: 'normal' });
  check('estimateFees produces non-zero total', BigInt(fees.totalFee) > 0n, `${fees.totalFee} sun`);

  // 5. Build → sign → broadcast an unfunded self-transfer (error oracle)
  const unsigned = await adapter.buildTransaction(intent, { from: owner, feeTier: 'normal' });
  check('buildTransaction yields tron unsigned tx', unsigned.chainType === 'tron' && unsigned.txId.length === 64);
  const signed = await adapter.signTransaction(unsigned, ownerPk);
  let oracleMsg = '';
  let oraclePassed = false;
  try {
    await adapter.sendTransaction(signed);
    oraclePassed = true; // would mean the unfunded tx got accepted — suspicious but not our bug
    oracleMsg = 'accepted (unexpected for unfunded account)';
  } catch (err) {
    oracleMsg = err instanceof Error ? err.message : String(err);
    // "No contract", NPE and parse/signature errors = our encoding broken;
    // resource/account errors = node accepted our bytes, only funds lacking
    const bad = /signature|illegal|uncompatible|cannot parse|proto|nullpointer|no contract/i.test(oracleMsg);
    oraclePassed = !bad;
  }
  check(
    'broadcast error-oracle: node parsed our protobuf & signature (rejected on funds only)',
    oraclePassed,
    oracleMsg,
  );

  // 6. Funded end-to-end (skipped unless a mnemonic with TRX is provided)
  if (process.env.TRON_MNEMONIC) {
    const pk = deriveEvmPrivateKey(process.env.TRON_MNEMONIC, "m/44'/195'/0'/0/0");
    const addr = publicKeyToTronAddress(evmPublicKey(pk));
    const fundedBal = await adapter.getNativeBalance(addr);
    check(`funded account ${addr} has balance`, BigInt(fundedBal) > 0n, `${fundedBal} sun`);
    const u = await adapter.buildTransaction(
      { kind: 'native-transfer', to: addr, amountRaw: '100000' },
      { from: addr, feeTier: 'normal' },
    );
    const s = await adapter.signTransaction(u, pk);
    const txid = await adapter.sendTransaction(s);
    check('funded 0.1 TRX self-transfer broadcast', typeof txid === 'string' && txid.length === 64, txid);
    console.log(`   explorer: ${adapter.getExplorerTxUrl(txid)}`);
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const st = await adapter.getTransactionStatus(txid);
      if (st !== 'pending') {
        check('status resolves off-pending', st === 'confirmed', st);
        break;
      }
    }
  } else {
    console.log('ℹ️  TRON_MNEMONIC not set — funded end-to-end skipped');
  }

  console.log(failures === 0 ? '\n🎉 TRON integration checks passed' : `\n💥 ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('fatal:', err);
  process.exit(1);
});

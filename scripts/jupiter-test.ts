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
 * Jupiter swap integration probe — REAL API, but transaction-BUILD ONLY.
 *
 * Proves the whole monetization path end to end without ever touching a
 * key or broadcasting: quote (with our platform fee) → fee ATA derivation
 * → /swap build → deserialize the returned VersionedTransaction and assert
 * OUR fee account actually appears in its account list (the fee instruction
 * is present). If this passes, the wallet UI's happy path is real.
 *
 * Usage: pnpm tsx scripts/jupiter-test.ts
 */

import { VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

// dev-machine convenience: honor HTTP(S)_PROXY like curl does (Node's
// global fetch ignores env proxies on its own). Browser code is unaffected.
setGlobalDispatcher(new EnvHttpProxyAgent());

import {
  fetchQuote,
  fetchSwapTransaction,
  deriveFeeAccount,
  SOL_MINT,
  USDC_MINT,
} from '../packages/chains/src/index.js';
import { base64ToBytes } from '../packages/shared/src/utils.js';

// A syntactically valid but throwaway "user" and "fee wallet" — no funds,
// nothing is ever signed or sent.
const USER_PUBKEY = '7xK3TnQ6pVwZbSrUJNRfD2WgYcEhLmA9sPuVqTxBmRcE';
const FEE_WALLET = '9w9JfW4jE1h8CRrJ3fUuPnQZx7kM2TvYdS6bGwLpHNfD';
const FEE_BPS = 50;

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  // 1. Quote SOL → USDC with our platform fee
  const quote = await fetchQuote({
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    amountRaw: '100000000', // 0.1 SOL
    slippageBps: 50,
    platformFeeBps: FEE_BPS,
  });
  check('quote returns a positive USDC output', BigInt(quote.outAmount) > 0n, `${quote.outAmount} raw USDC`);
  // lite-api may not echo platformFeeBps on the quote; the authoritative
  // proof of the fee is the fee ATA appearing inside the BUILT transaction
  // (asserted below), so no echo assertion here.

  // 2. Fee ATA derivation (the money destination — must be stable & real)
  const feeAta = await deriveFeeAccount(FEE_WALLET, SOL_MINT);
  check('fee ATA derived for the charged mint (wSOL)', feeAta.length >= 32, feeAta);

  // 3. Build the swap transaction through Jupiter
  const txBase64 = await fetchSwapTransaction({
    quote,
    userPublicKey: USER_PUBKEY,
    feeAccount: feeAta,
  });
  check('swap endpoint returned a transaction', txBase64.length > 100, `${txBase64.length} b64 chars`);

  // 4. Deserialize + assert the fee account really is IN the transaction.
  // v0 messages reference token programs via address lookup tables, so
  // instead of enumerating account keys we search the serialized bytes for
  // the fee ATA's raw 32-byte public key — decisive either way it's encoded.
  const txBytes = base64ToBytes(txBase64);
  const feeAtaBytes = Uint8Array.from(bs58.decode(feeAta));
  const userBytes = Uint8Array.from(bs58.decode(USER_PUBKEY));
  const contains = (hay: Uint8Array, needle: Uint8Array): boolean => {
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (hay[i + j] !== needle[j]) continue outer;
      }
      return true;
    }
    return false;
  };
  const tx = VersionedTransaction.deserialize(base64ToBytes(txBase64));
  check('transaction is versioned (v0)', tx.version === 0);
  check('our fee ATA bytes appear in the serialized transaction', contains(txBytes, feeAtaBytes));
  check('user pubkey bytes appear in the serialized transaction', contains(txBytes, userBytes));

  console.log(failures === 0 ? '\n🎉 Jupiter swap pipeline verified (build-only)' : `\n💥 ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('fatal:', err);
  process.exit(1);
});

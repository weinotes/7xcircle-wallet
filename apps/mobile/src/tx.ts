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
 * Mobile send pipeline — build → sign → broadcast → wait, with retry.
 *
 * A Solana transaction dies with its blockhash (~60-90s). Rebuilding means
 * re-signing, and re-signing needs the private key — so the retry loop lives
 * here, where the key is fetched and wiped per attempt, rather than inside a
 * stateless adapter that would have to hold the key across the whole loop.
 *
 * Retry applies only to wallet-built transactions: an aggregator quote is a
 * fixed payload, so "expired" there means re-quote (the caller's job), not
 * rebuild. Pass `allowRebuild: false` for those.
 */

import { getPrivateKey, touchActivity } from '@7xcircle/core';
import type { ChainAdapter } from '@7xcircle/core';
import type {
  Account,
  ExternalTx,
  FeeTier,
  TransactionRecord,
  TxIntent,
  UnsignedTx,
} from '@7xcircle/shared';

/** How long to wait for a confirmation before treating it as stalled */
const CONFIRM_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;
/** Max rebuild-and-resend attempts when a Solana blockhash expires */
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Outcome of waiting on a broadcast transaction */
type WaitOutcome = TransactionRecord['status'] | 'expired' | 'timeout';

/**
 * Wait for a transaction to confirm.
 *
 * On Solana the wait is bounded by the blockhash expiry rather than a fixed
 * duration — once the block height passes `lastValidBlockHeight` the
 * transaction can never land, so polling further is pointless and the caller
 * should rebuild instead.
 */
async function waitForOutcome(
  adapter: ChainAdapter,
  unsigned: UnsignedTx,
  hash: string,
): Promise<WaitOutcome> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < CONFIRM_TIMEOUT_MS) {
    const status = await adapter.getTransactionStatus(hash);
    if (status === 'confirmed' || status === 'failed') return status;

    if (unsigned.chainType === 'solana') {
      try {
        const height = await adapter.getBlockHeight();
        if (height > unsigned.lastValidBlockHeight) return 'expired';
      } catch {
        // Height lookup is best-effort — a failure must not abort the wait
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return 'timeout';
}

/**
 * Shared pipeline: build → sign → broadcast → wait, retrying on expiry.
 *
 * Returns the hash of the transaction that confirmed, or — when the outcome
 * is merely unknown (timeout) or the payload cannot be rebuilt — the last
 * hash that was broadcast, so the UI can still link to the explorer.
 *
 * @throws if the transaction is rejected on-chain, so screens can show why.
 */
async function runPipeline(
  adapter: ChainAdapter,
  account: Account,
  build: () => Promise<UnsignedTx>,
  allowRebuild: boolean,
): Promise<string> {
  const attempts = allowRebuild ? MAX_ATTEMPTS : 1;
  let lastHash = '';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const unsigned = await build();

    // Key lifetime is bounded by ONE attempt and wiped in `finally` — the
    // loop never holds it across a rebuild.
    touchActivity();
    const privateKey = getPrivateKey(account);
    let hash: string;
    try {
      const signed = await adapter.signTransaction(unsigned, privateKey);
      hash = await adapter.sendTransaction(signed);
    } finally {
      privateKey.fill(0);
    }

    lastHash = hash;

    const outcome = await waitForOutcome(adapter, unsigned, hash);
    if (outcome === 'failed') {
      throw new Error('Transaction was rejected on-chain');
    }
    // 'expired' falls through to the next attempt with a fresh blockhash;
    // anything else (confirmed / timeout) is terminal for this pipeline.
    if (outcome !== 'expired') return hash;
  }

  return lastHash;
}

export async function sendTx(params: {
  adapter: ChainAdapter;
  account: Account;
  intent: TxIntent;
  feeTier?: FeeTier;
}): Promise<string> {
  const { adapter, account, intent, feeTier = 'normal' } = params;
  return runPipeline(
    adapter,
    account,
    () => adapter.buildTransaction(intent, { from: account.address, feeTier }),
    true,
  );
}

/**
 * Broadcast a transaction built OUTSIDE the wallet (a Jupiter aggregator
 * quote): import → sign → send. No rebuild — the quote is a fixed payload,
 * so expiry means "re-quote", which only the caller can do.
 */
export async function sendExternalTx(params: {
  adapter: ChainAdapter;
  account: Account;
  tx: ExternalTx;
  feeTier?: FeeTier;
}): Promise<string> {
  const { adapter, account, tx, feeTier = 'normal' } = params;
  return runPipeline(
    adapter,
    account,
    () => adapter.importExternalTransaction(tx, { from: account.address, feeTier }),
    false,
  );
}
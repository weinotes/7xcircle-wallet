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
 * Hook: the send pipeline — build → sign → broadcast → record → wait.
 *
 * Owns the retry loop deliberately. A Solana transaction dies with its
 * blockhash (~60-90s), and rebuilding it means re-signing, which needs the
 * private key. Keeping the loop here means the key's lifetime is bounded by
 * a single attempt and wiped in a `finally`, instead of living inside a
 * stateless adapter for the duration of a retry sequence.
 *
 * Chain differences are fully absorbed by the adapter: this hook never
 * branches on chain type except to read the Solana blockhash expiry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPrivateKey, isUnlocked, touchActivity } from '@open-wallet/core';
import type { ChainAdapter } from '@open-wallet/core';
import type {
  Account,
  ExternalTx,
  FeeEstimate,
  FeeTier,
  TransactionRecord,
  TxIntent,
  UnsignedTx,
} from '@open-wallet/shared';
import { useWalletStore } from '../store/wallet.js';

export type TxFlowStatus =
  | 'idle'
  | 'building'
  | 'signing'
  | 'broadcasting'
  | 'pending'
  | 'confirmed'
  | 'failed';

/** What the hook needs in order to write the local pending record */
export interface TxMeta {
  /** The RECIPIENT — not the token contract, so History shows where it went */
  displayTo: string;
  amountRaw: string;
  token?: { symbol: string; address: string; decimals: number; isNative: boolean };
}

export interface UseTxFlowArgs {
  adapter: ChainAdapter | undefined;
  account: Account | undefined;
  chainId: string;
  feeTier?: FeeTier;
}

export interface UseTxFlowResult {
  status: TxFlowStatus;
  txHash: string | null;
  error: string | null;
  /** Exact fee of the transaction that was broadcast */
  resolvedFee: FeeEstimate | null;
  send: (intent: TxIntent, meta: TxMeta) => Promise<void>;
  /**
   * Send a transaction built OUTSIDE the wallet (a Jupiter/0x aggregator
   * quote). Same sign → broadcast → retry pipeline, only the build step
   * differs: importExternalTransaction instead of buildTransaction.
   */
  sendExternal: (tx: ExternalTx, meta: TxMeta) => Promise<void>;
  reset: () => void;
}

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
 * transaction can never land, so there is no point polling further.
 */
async function waitForOutcome(
  adapter: ChainAdapter,
  unsigned: UnsignedTx,
  hash: string,
  isCancelled: () => boolean,
): Promise<WaitOutcome> {
  const startedAt = Date.now();

  while (!isCancelled() && Date.now() - startedAt < CONFIRM_TIMEOUT_MS) {
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

  return isCancelled() ? 'timeout' : 'timeout';
}

export function useTxFlow({
  adapter,
  account,
  chainId,
  feeTier = 'normal',
}: UseTxFlowArgs): UseTxFlowResult {
  const addPendingTx = useWalletStore(s => s.addPendingTx);
  const removePendingTx = useWalletStore(s => s.removePendingTx);

  const [status, setStatus] = useState<TxFlowStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedFee, setResolvedFee] = useState<FeeEstimate | null>(null);

  // Guard against setting state after the page unmounts mid-flight
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
    setResolvedFee(null);
  }, []);

  /** Shared pipeline: build (via injected step) → sign → broadcast → wait.
   *  Both the wallet-built (intent) and aggregator-built (external) paths
   *  run through here so key lifetime stays identical. */
  const runPipeline = useCallback(async (
    build: () => Promise<UnsignedTx>,
    meta: TxMeta,
    allowRebuild: boolean,
  ) => {
    if (!adapter || !account) {
      setError('Wallet not ready');
      setStatus('failed');
      return;
    }

    setError(null);
    setTxHash(null);
    setResolvedFee(null);

    let previousHash: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let privateKey: Uint8Array | null = null;

      try {
        // ── Build ──────────────────────────────────────────────────────
        setStatus('building');
        const unsigned = await build();

        if (unsigned.chainType === 'evm') {
          // Derive the fee from the built transaction rather than calling
          // estimateFees again — that would repeat the gas estimation RPC
          // for a number the build already computed.
          const perGas = unsigned.maxFeePerGas ?? unsigned.gasPrice ?? '0';
          const totalFee = (
            BigInt(perGas) * BigInt(unsigned.gasLimit ?? '0')
          ).toString();

          setResolvedFee({
            level: feeTier,
            gasLimit: unsigned.gasLimit ?? '0',
            gasPrice: perGas,
            totalFee,
          });
        }

        // ── Sign ───────────────────────────────────────────────────────
        setStatus('signing');
        touchActivity();
        privateKey = getPrivateKey(account);
        const signed = await adapter.signTransaction(unsigned, privateKey);

        // ── Broadcast ──────────────────────────────────────────────────
        setStatus('broadcasting');
        const hash = await adapter.sendTransaction(signed);
        setTxHash(hash);

        // A retry produces a NEW hash — drop the stale pending entry so
        // History does not show a transaction that can never land.
        if (previousHash) removePendingTx(chainId, previousHash);
        previousHash = hash;

        const record: TransactionRecord = {
          hash,
          from: account.address,
          to: meta.displayTo,
          value: meta.amountRaw,
          blockNumber: 0,
          blockTimestamp: Math.floor(Date.now() / 1000),
          status: 'pending',
          direction: 'sent',
          ...(meta.token
            ? {
                tokenSymbol: meta.token.symbol,
                tokenAddress: meta.token.address,
                tokenDecimals: meta.token.decimals,
              }
            : {}),
        };
        addPendingTx(chainId, record);

        setStatus('pending');

        // ── Wait ───────────────────────────────────────────────────────
        const outcome = await waitForOutcome(adapter, unsigned, hash, () => !aliveRef.current);

        if (outcome === 'confirmed' || outcome === 'failed') {
          if (!aliveRef.current) return;
          removePendingTx(chainId, hash);
          setStatus(outcome);
          return;
        }

        if (outcome === 'expired' && allowRebuild && attempt < MAX_ATTEMPTS) {
          // The blockhash died before inclusion — rebuild and try again
          continue;
        }

        // Timed out, or out of attempts: leave the record pending and let
        // the History page's poller resolve it whenever it lands.
        if (aliveRef.current) setStatus('pending');
        return;
      } catch (e) {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : 'Transaction failed');
        setStatus('failed');
        return;
      } finally {
        // The key lives for exactly one attempt — never across a retry
        if (privateKey) privateKey.fill(0);
      }
    }
  }, [adapter, account, chainId, feeTier, addPendingTx, removePendingTx]);

  const send = useCallback(async (intent: TxIntent, meta: TxMeta) => {
    // builder is only invoked after runPipeline's adapter/account guard
    await runPipeline(
      () => (adapter as ChainAdapter).buildTransaction(intent, {
        from: (account as Account).address,
        feeTier,
      }),
      meta,
      // wallet-built txs get a fresh blockhash every attempt → retry works
      true,
    );
  }, [adapter, account, feeTier, runPipeline]);

  const sendExternal = useCallback(async (tx: ExternalTx, meta: TxMeta) => {
    await runPipeline(
      () => (adapter as ChainAdapter).importExternalTransaction(tx, {
        from: (account as Account).address,
        feeTier,
      }),
      meta,
      // an aggregator quote is a FIXED payload — re-import cannot refresh
      // its blockhash, so never re-broadcast an expired one; the UI re-quotes
      false,
    );
  }, [adapter, account, feeTier, runPipeline]);

  // Locking the wallet mid-flight must not leave the UI in a spinning state
  useEffect(() => {
    if (!isUnlocked() && status !== 'idle' && status !== 'confirmed' && status !== 'failed') {
      setError('Wallet locked before the transaction could be confirmed');
      setStatus('failed');
    }
  }, [status]);

  return { status, txHash, error, resolvedFee, send, sendExternal, reset };
}

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
 * Jito block-engine relay — the anti-sandwich / priority-landing path.
 *
 * Why a tip at all: the Jito block engine only accepts a transaction that
 * pays a tip to one of its tip accounts. In return the transaction is routed
 * through Jito's block builders, which are the validators producing most
 * Solana blocks, so a tipped transaction lands ahead of the public mempool.
 * The tip is a plain SOL SystemProgram transfer appended to the same
 * transaction — it is NOT a separate payment.
 *
 * Two things are needed for this to work, and forgetting either is a silent
 * failure mode worth naming:
 *   1. the tip instruction must be part of the SIGNED transaction, and
 *   2. the transaction must be submitted to the block engine rather than the
 *      plain RPC. A tipped transaction sent to the public RPC is simply a
 *      donation — it lands, but with none of the routing benefit.
 *
 * Everything here except `sendViaJito` is pure and unit-tested.
 */

import { PublicKey, SystemProgram, type TransactionInstruction, VersionedTransaction } from '@solana/web3.js';

/**
 * Jito's tip accounts (mainnet). The engine expects the tip to land in ONE
 * of these; picking at random spreads load and avoids the whole fleet
 * writing to a single account.
 */
export const JITO_TIP_ACCOUNTS: readonly string[] = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

/** The engine rejects anything below this; below it the tip is not a tip. */
export const JITO_MIN_TIP_LAMPORTS = 1_000n;

/**
 * Tip size per fee tier, in lamports.
 *
 * `fast` is the only tier that routes through Jito, so it carries the
 * competitive bid (~0.0001 SOL). `normal` exists so a caller can attach a
 * legal but minimal tip without a second code path — and so the value is
 * documented in one place when tuning.
 */
export const JITO_TIP_LAMPORTS: Record<'normal' | 'fast', bigint> = {
  normal: 1_000n,
  fast: 100_000n,
};

/** Block-engine endpoints. Jito relays mainnet and its own testnet only. */
export const JITO_BLOCK_ENGINE_URL =
  'https://mainnet.block-engine.jito.wtf/api/v1/transactions';

/** Is this address one of the Jito tip accounts? */
export function isJitoTipAccount(address: string): boolean {
  return JITO_TIP_ACCOUNTS.includes(address);
}

/**
 * Pick a tip account. The index is an argument (not `Math.random` inside) so
 * the choice is reproducible in tests; callers pass a varying value.
 */
export function pickTipAccount(seed: number): string {
  const idx = Math.abs(Math.trunc(seed)) % JITO_TIP_ACCOUNTS.length;
  // Non-null: idx is bounded to a valid index of a non-empty readonly array
  return JITO_TIP_ACCOUNTS[idx] as string;
}

/**
 * Build the SOL transfer that pays the Jito tip.
 *
 * @throws if the amount is below the engine's minimum — a too-small tip is
 * rejected at submit time with a confusing error, so fail early instead.
 */
export function buildJitoTipInstruction(
  payer: PublicKey,
  lamports: bigint = JITO_TIP_LAMPORTS.fast,
  tipAccount?: string,
): TransactionInstruction {
  if (lamports < JITO_MIN_TIP_LAMPORTS) {
    throw new Error(
      `jito tip must be at least ${JITO_MIN_TIP_LAMPORTS} lamports, got ${lamports}`,
    );
  }
  const recipient = new PublicKey(tipAccount ?? pickTipAccount(Date.now()));
  if (!isJitoTipAccount(recipient.toBase58())) {
    throw new Error(`not a Jito tip account: ${recipient.toBase58()}`);
  }
  return SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports });
}

/**
 * Does this transaction already pay a Jito tip?
 *
 * Checks the message's static account keys rather than decoding instructions:
 * a tip we built ourselves is always a literal pubkey, never a lookup-table
 * entry, so the key list is sufficient (and much cheaper than resolving
 * programs and metas just to answer a yes/no question).
 */
export function paysJitoTip(tx: VersionedTransaction): boolean {
  return tx.message.staticAccountKeys.some(key => isJitoTipAccount(key.toBase58()));
}

// ─── Block engine submission ────────────────────────────────────────

/** The JSON-RPC body the block engine expects. Pure and test-guarded. */
export function buildJitoSendBody(base64Tx: string): Record<string, unknown> {
  if (base64Tx.length === 0) {
    throw new Error('jito submit requires a base64 transaction payload');
  }
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendTransaction',
    params: [base64Tx, { encoding: 'base64' }],
  };
}

/**
 * Pull the signature out of the engine's reply. A JSON-RPC `error` member is
 * a failure even though the HTTP status was 200 — that is the case that
 * silently loses a transaction if it is not checked.
 */
export function parseJitoSendResponse(json: unknown): string {
  const body = json as { result?: unknown; error?: { message?: string } | string };
  if (body?.error) {
    const message = typeof body.error === 'string' ? body.error : body.error.message ?? 'unknown';
    throw new Error(`jito block engine rejected the transaction: ${message}`);
  }
  if (typeof body?.result !== 'string' || body.result.length === 0) {
    throw new Error('jito block engine returned no signature');
  }
  return body.result;
}

/**
 * Submit a signed transaction to the Jito block engine.
 *
 * Throws on any failure (network, HTTP, JSON-RPC error) so the caller can
 * decide whether to fall back to the public RPC. Never swallows.
 */
export async function sendViaJito(
  base64Tx: string,
  url: string = JITO_BLOCK_ENGINE_URL,
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildJitoSendBody(base64Tx)),
  });
  if (!res.ok) {
    throw new Error(`jito block engine HTTP ${res.status}`);
  }
  return parseJitoSendResponse(await res.json());
}
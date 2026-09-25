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
 * Solana intent compilation — pure helpers, no network access.
 *
 * Kept separate from the adapter so the instruction-building logic and the
 * priority-fee strategy can be unit tested without an RPC connection.
 */

import { PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

import type { FeeTier, TxIntent } from '@7xcircle/shared';

/**
 * Compute unit ceiling per intent kind.
 *
 * Setting the *limit* is free — Solana charges `computeUnitsConsumed × price`,
 * not `limit × price`. So we set a generous ceiling and skip an extra
 * simulation round trip. These values only need to be high enough to never
 * clip a legitimate transaction.
 */
export const COMPUTE_UNIT_LIMIT: Record<TxIntent['kind'], number> = {
  'native-transfer': 200_000,
  'token-transfer': 200_000,
  'contract-call': 400_000,
  'approve': 200_000,
};

/** Percentile of recent network fees to target per tier */
const TIER_PERCENTILE: Record<FeeTier, number> = {
  slow: 0.5,
  normal: 0.75,
  fast: 0.9,
};

/** Fallback when the RPC returns no recent fee samples at all */
const FALLBACK_MICRO_LAMPORTS: Record<FeeTier, number> = {
  slow: 1_000,
  normal: 10_000,
  fast: 50_000,
};

/** Never bid below this — a 0 bid is legal but loses every race */
export const MIN_MICRO_LAMPORTS = 1_000;

/**
 * Choose a priority fee (micro-lamports per compute unit) from recent
 * network samples.
 *
 * Uses a percentile rather than the max so a single freak transaction does
 * not set the price for everyone. Falls back to per-tier defaults when the
 * RPC has no samples (fresh/devnet clusters).
 */
export function pickPriorityFee(fees: number[], tier: FeeTier): number {
  const sorted = fees
    .filter(f => Number.isFinite(f) && f >= 0)
    .sort((a, b) => a - b);

  if (sorted.length === 0) return FALLBACK_MICRO_LAMPORTS[tier];

  const idx = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * TIER_PERCENTILE[tier]),
  );

  return Math.max(sorted[idx] ?? 0, MIN_MICRO_LAMPORTS);
}

/** Extra context the caller must resolve over the network before compiling */
export interface CompileContext {
  /** Whether the recipient's associated token account already exists */
  destinationAtaExists: boolean;
}

/**
 * Translate a semantic intent into Solana instructions.
 *
 * The caller is responsible for the `destinationAtaExists` lookup (an RPC
 * call) so this function stays pure and testable.
 *
 * @throws if the intent kind has no Solana representation
 */
export async function compileIntent(
  intent: TxIntent,
  payer: PublicKey,
  ctx: CompileContext,
): Promise<TransactionInstruction[]> {
  switch (intent.kind) {
    case 'native-transfer':
      return [
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: new PublicKey(intent.to),
          lamports: BigInt(intent.amountRaw),
        }),
      ];

    case 'token-transfer': {
      const mint = new PublicKey(intent.token);
      const recipient = new PublicKey(intent.to);

      const sourceAta = await getAssociatedTokenAddress(
        mint, payer, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const destinationAta = await getAssociatedTokenAddress(
        mint, recipient, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      const instructions: TransactionInstruction[] = [];

      // The recipient may never have held this mint — create their ATA first
      if (!ctx.destinationAtaExists) {
        instructions.push(createAssociatedTokenAccountInstruction(
          payer, destinationAta, recipient, mint,
          TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        ));
      }

      instructions.push(createTransferCheckedInstruction(
        sourceAta,
        mint,
        destinationAta,
        payer,
        BigInt(intent.amountRaw),
        intent.decimals,
        [],
        TOKEN_PROGRAM_ID,
      ));

      return instructions;
    }

    case 'contract-call':
      throw new Error('Solana does not support raw contract calls — use an external transaction');

    case 'approve':
      throw new Error('Solana has no token approval concept — use an external transaction');
  }
}

/**
 * Resolve whether a destination ATA needs creating.
 * Exposed so the adapter and tests agree on the derivation.
 */
export async function getDestinationAta(
  mint: PublicKey,
  recipient: PublicKey,
): Promise<PublicKey> {
  return getAssociatedTokenAddress(
    mint, recipient, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

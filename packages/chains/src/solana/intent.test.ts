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
 * Solana intent compilation tests.
 *
 * These guard the property that a semantic intent produces the RIGHT
 * instructions: the amount and mint must survive the translation exactly,
 * and the recipient's associated token account must be created when (and
 * only when) it does not already exist. Getting either wrong sends the
 * wrong amount, or to a token account that cannot receive.
 *
 * `pickPriorityFee` guards transaction landing: a bid of 0 loses every race,
 * so the floor must hold even on a quiet network.
 */
import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import {
  compileIntent,
  pickPriorityFee,
  MIN_MICRO_LAMPORTS,
  COMPUTE_UNIT_LIMIT,
} from './intent.js';

const PAYER = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');

/**
 * A deterministic ON-CURVE recipient.
 *
 * Derived from a fixed seed rather than hardcoded: well-known addresses like
 * Raydium's authority are PDAs (off-curve), and `getAssociatedTokenAddress`
 * rejects them as an ATA owner. A real keypair is always on-curve.
 */
const RECIPIENT = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/** Read a little-endian u64 from a buffer at offset */
function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

describe('pickPriorityFee', () => {
  it('falls back to a per-tier default when the RPC has no samples', () => {
    // Devnet and freshly-started clusters frequently return an empty list.
    const slow = pickPriorityFee([], 'slow');
    const normal = pickPriorityFee([], 'normal');
    const fast = pickPriorityFee([], 'fast');

    expect(slow).toBeGreaterThan(0);
    expect(normal).toBeGreaterThanOrEqual(slow);
    expect(fast).toBeGreaterThan(normal);
  });

  it('never bids below the floor, even when every recent fee is zero', () => {
    // A quiet network reports 0s. Bidding 0 loses every race, so clamp.
    expect(pickPriorityFee([0, 0, 0, 0], 'slow')).toBe(MIN_MICRO_LAMPORTS);
    expect(pickPriorityFee([0, 0], 'fast')).toBe(MIN_MICRO_LAMPORTS);
  });

  it('selects a higher percentile for faster tiers', () => {
    const fees = [1_000, 5_000, 20_000, 100_000, 500_000];
    const slow = pickPriorityFee(fees, 'slow');
    const normal = pickPriorityFee(fees, 'normal');
    const fast = pickPriorityFee(fees, 'fast');

    expect(slow).toBeLessThanOrEqual(normal);
    expect(normal).toBeLessThanOrEqual(fast);
  });

  it('is not dragged to the max by a single outlier', () => {
    // Percentile, not max — one whale should not set the price for everyone.
    const fees = [1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 9_999_999];
    expect(pickPriorityFee(fees, 'normal')).toBeLessThan(9_999_999);
  });

  it('ignores non-finite and negative samples', () => {
    expect(pickPriorityFee([NaN, -5, Infinity], 'normal')).toBeGreaterThan(0);
  });
});

describe('compileIntent — native transfer', () => {
  it('produces exactly one SystemProgram.transfer with the right lamports', async () => {
    const amountRaw = '1234567890';
    const ixs = await compileIntent(
      { kind: 'native-transfer', to: RECIPIENT.toBase58(), amountRaw },
      PAYER,
      { destinationAtaExists: true },
    );

    expect(ixs).toHaveLength(1);
    const ix = ixs[0]!;
    expect(ix.programId.equals(SystemProgram.programId)).toBe(true);

    // SystemProgram.transfer layout: u32 instruction index (2), then u64 lamports
    const data = Buffer.from(ix.data);
    expect(data.readUInt32LE(0)).toBe(2);
    expect(readU64LE(data, 4)).toBe(BigInt(amountRaw));

    // Must pay the intended recipient
    expect(ix.keys[1]!.pubkey.equals(RECIPIENT)).toBe(true);
    expect(ix.keys[0]!.pubkey.equals(PAYER)).toBe(true);
  });
});

describe('compileIntent — token transfer', () => {
  it('creates the destination ATA when it does not exist yet', async () => {
    const ixs = await compileIntent(
      {
        kind: 'token-transfer',
        token: USDC_MINT.toBase58(),
        decimals: 6,
        to: RECIPIENT.toBase58(),
        amountRaw: '2500000',   // 2.5 USDC
      },
      PAYER,
      { destinationAtaExists: false },
    );

    expect(ixs).toHaveLength(2);
    expect(ixs[0]!.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(ixs[1]!.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it('skips ATA creation when the destination account already exists', async () => {
    // Sending a second time must not pay rent for an account that is there.
    const ixs = await compileIntent(
      {
        kind: 'token-transfer',
        token: USDC_MINT.toBase58(),
        decimals: 6,
        to: RECIPIENT.toBase58(),
        amountRaw: '1',
      },
      PAYER,
      { destinationAtaExists: true },
    );

    expect(ixs).toHaveLength(1);
    expect(ixs[0]!.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it('encodes amount and decimals into transferChecked, and targets the right mint', async () => {
    const amountRaw = '1234567';
    const decimals = 6;

    const ixs = await compileIntent(
      {
        kind: 'token-transfer',
        token: USDC_MINT.toBase58(),
        decimals,
        to: RECIPIENT.toBase58(),
        amountRaw,
      },
      PAYER,
      { destinationAtaExists: true },
    );

    const ix = ixs[0]!;

    // transferChecked layout: u8 tag (12), u64 amount LE, u8 decimals
    const data = Buffer.from(ix.data);
    expect(data.readUInt8(0)).toBe(12);
    expect(readU64LE(data, 1)).toBe(BigInt(amountRaw));
    expect(data.readUInt8(9)).toBe(decimals);
    expect(data).toHaveLength(10);

    // Account layout: [sourceAta, mint, destinationAta, owner]
    expect(ix.keys[1]!.pubkey.equals(USDC_MINT)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(PAYER)).toBe(true);
  });
});

describe('compileIntent — unsupported intents', () => {
  it('rejects contract-call (Solana has no generic call)', async () => {
    await expect(
      compileIntent(
        { kind: 'contract-call', to: RECIPIENT.toBase58(), data: '0xdeadbeef', valueRaw: '0' },
        PAYER,
        { destinationAtaExists: true },
      ),
    ).rejects.toThrow(/contract call/i);
  });

  it('rejects approve (no approval concept on Solana)', async () => {
    await expect(
      compileIntent(
        { kind: 'approve', token: USDC_MINT.toBase58(), spender: RECIPIENT.toBase58(), amountRaw: '1' },
        PAYER,
        { destinationAtaExists: true },
      ),
    ).rejects.toThrow(/approval/i);
  });
});

describe('COMPUTE_UNIT_LIMIT', () => {
  it('covers every intent kind that compiles on Solana', () => {
    // The limit is free (you pay for consumed units, not the ceiling), so a
    // missing entry would silently clip a valid transaction.
    expect(COMPUTE_UNIT_LIMIT['native-transfer']).toBeGreaterThan(0);
    expect(COMPUTE_UNIT_LIMIT['token-transfer']).toBeGreaterThan(0);
    expect(COMPUTE_UNIT_LIMIT['contract-call']).toBeGreaterThanOrEqual(
      COMPUTE_UNIT_LIMIT['token-transfer'],
    );
  });
});

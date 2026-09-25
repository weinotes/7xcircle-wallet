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
 * Marinade router tests.
 *
 * The important one is the wire-assembly round trip: the router returns a
 * transaction MESSAGE, and the adapter needs a full serialized transaction.
 * Rather than trust the layout, this builds a real v0 transaction with
 * web3.js, strips it down to its message, and asserts the re-assembled bytes
 * deserialize back to the same transaction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  MSOL_MINT,
  assembleWireTransaction,
  buildMarinadeRouteUrl,
  fetchMarinadeRoute,
  hasMarinadeReferralCode,
  marinadeRouteToExternalTx,
  parseMarinadeRoute,
  setMarinadeReferralCode,
} from './marinade.js';

/**
 * A real router response shape, captured 2026-09-25. The message is the
 * leading bytes of the returned v0 message (enough to prove the 0x80 version
 * prefix); the assembler is layout-tested against a full transaction below.
 */
const ROUTE_PAYLOAD = {
  id: 'dc45865a-985a-4b17-b414-9acec9520a4b',
  tx: {
    message: 'gAEACBEFOsd7zr7FtS4rUO6Xhx2rfxhRfIgPsLfd',
    non_user_sigs: [],
    blockhash: 'EimdFhTzs9zb4x378wi9GDiHeyL9RKHJxGhavdXBaD9U',
    last_valid_block_height: 428286589,
  },
  funding: { fees: 5000, rent: 2039280 },
  requested_amount_in: 1000000,
  effective_amount_in: 1000000,
  amount_out: 711372,
};

beforeEach(() => setMarinadeReferralCode(undefined));
afterEach(() => {
  setMarinadeReferralCode(undefined);
  vi.restoreAllMocks();
});

describe('referral configuration', () => {
  it('is inert until a valid base58 code is installed', () => {
    expect(hasMarinadeReferralCode()).toBe(false);
    expect(() => buildMarinadeRouteUrl({ user: MSOL_MINT, amountLamports: '1000000' }))
      .toThrow(/referral code is not configured/);

    // A typo'd code must be loud, not a silent zero-revenue state
    expect(() => setMarinadeReferralCode('not a pubkey!')).toThrow(/base58 public key/);
    expect(hasMarinadeReferralCode()).toBe(false);

    setMarinadeReferralCode('MR2LqxoSbw831bNy68utpu5n4YqBH3AzDmddkgk9LQv');
    expect(hasMarinadeReferralCode()).toBe(true);
  });
});

describe('buildMarinadeRouteUrl', () => {
  beforeEach(() => setMarinadeReferralCode('MR2LqxoSbw831bNy68utpu5n4YqBH3AzDmddkgk9LQv'));

  it('encodes the documented route params plus the referral id', () => {
    const url = buildMarinadeRouteUrl(
      { user: MSOL_MINT, amountLamports: '1000000' },
      'https://tx-router.marinade.finance',
    );
    const q = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe('/v1/route');
    expect(q.get('user')).toBe(MSOL_MINT);
    expect(q.get('asset_in')).toBe('sol');
    expect(q.get('amount_in')).toBe('1000000');
    expect(q.get('asset_out')).toBe('msol');
    expect(q.get('referral_id')).toBe('MR2LqxoSbw831bNy68utpu5n4YqBH3AzDmddkgk9LQv');
  });

  it('rejects a bad user address or amount', () => {
    expect(() => buildMarinadeRouteUrl({ user: '0xabc', amountLamports: '1000000' }))
      .toThrow(/base58 Solana address/);
    expect(() => buildMarinadeRouteUrl({ user: MSOL_MINT, amountLamports: '0' }))
      .toThrow(/positive integer/);
  });
});

describe('parseMarinadeRoute', () => {
  it('narrows the captured payload', () => {
    const route = parseMarinadeRoute(ROUTE_PAYLOAD);
    expect(route.amountOut).toBe('711372');
    expect(route.feesLamports).toBe('5000');
    expect(route.rentLamports).toBe('2039280');
    expect(route.blockhash).toBe('EimdFhTzs9zb4x378wi9GDiHeyL9RKHJxGhavdXBaD9U');
    expect(route.lastValidBlockHeight).toBe(428286589);
    expect(route.nonUserSigs).toEqual([]);
  });

  it('throws with the router error instead of a bare failure', () => {
    expect(() => parseMarinadeRoute({ status: 400, error: "Failed to parse 'referral_id': TEST" }))
      .toThrow(/referral_id/);
    expect(() => parseMarinadeRoute({ tx: { message: 'x' } })).toThrow(/amount_out/);
  });
});

describe('assembleWireTransaction', () => {
  it('re-assembles a wire transaction from a message round-trip', () => {
    const payer = Keypair.generate().publicKey;
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: 'EimdFhTzs9zb4x378wi9GDiHeyL9RKHJxGhavdXBaD9U',
      instructions: [
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }),
      ],
    }).compileToV0Message();

    const wire = new VersionedTransaction(message).serialize();
    // 1 byte compact-u16 signature count + 64 zero-filled signature bytes
    const messageOnly = wire.slice(1 + 64);
    const messageBase64 = Buffer.from(messageOnly).toString('base64');

    const assembled = assembleWireTransaction(messageBase64);
    expect(assembled).toBe(Buffer.from(wire).toString('base64'));

    const decoded = VersionedTransaction.deserialize(Buffer.from(assembled, 'base64'));
    expect(decoded.message.recentBlockhash).toBe('EimdFhTzs9zb4x378wi9GDiHeyL9RKHJxGhavdXBaD9U');
    expect(decoded.message.header.numRequiredSignatures).toBe(1);
  });

  it('accounts for pre-prepared extra signers', () => {
    const message = new TransactionMessage({
      payerKey: Keypair.generate().publicKey,
      recentBlockhash: 'EimdFhTzs9zb4x378wi9GDiHeyL9RKHJxGhavdXBaD9U',
      instructions: [],
    }).compileToV0Message();
    const messageBase64 = Buffer.from(new VersionedTransaction(message).serialize().slice(65)).toString('base64');

    const bytes = Buffer.from(assembleWireTransaction(messageBase64, 2), 'base64');
    expect(bytes[0]).toBe(3); // 1 user + 2 extra
  });

  it('refuses an empty message', () => {
    expect(() => assembleWireTransaction('')).toThrow(/empty message/);
  });
});

describe('marinadeRouteToExternalTx', () => {
  it('produces a base64 versioned payload the adapter can import', () => {
    const tx = marinadeRouteToExternalTx(parseMarinadeRoute(ROUTE_PAYLOAD));
    expect(tx.encoding).toBe('base64');
    expect(tx.versioned).toBe(true);
    expect(tx.payload.length).toBeGreaterThan(0);
  });
});

describe('degradation without a referral code', () => {
  it('returns null and never fetches', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchMarinadeRoute({ user: MSOL_MINT, amountLamports: '1000000' })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});


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
 * Jito relay tests — the tip is money and the tip account list is the wire
 * contract with the block engine. Both must be exact. All pure, no network.
 */

import { describe, it, expect } from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';

import {
  buildJitoSendBody,
  buildJitoTipInstruction,
  isJitoTipAccount,
  JITO_MIN_TIP_LAMPORTS,
  JITO_TIP_ACCOUNTS,
  JITO_TIP_LAMPORTS,
  parseJitoSendResponse,
  paysJitoTip,
  pickTipAccount,
} from './jito.js';

const PAYER = Keypair.generate().publicKey;

/** Wrap instructions in a real v0 message so tip detection is exercised for real */
function compile(instructions: TransactionInstruction[]) {
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: '11111111111111111111111111111111',
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

describe('JITO_TIP_ACCOUNTS', () => {
  it('holds eight distinct, valid base58 addresses', () => {
    expect(JITO_TIP_ACCOUNTS).toHaveLength(8);
    const unique = new Set(JITO_TIP_ACCOUNTS);
    expect(unique.size).toBe(8);
    for (const account of JITO_TIP_ACCOUNTS) {
      expect(() => new PublicKey(account)).not.toThrow();
      expect(isJitoTipAccount(account)).toBe(true);
    }
  });

  it('rejects an address that is not a tip account', () => {
    expect(isJitoTipAccount(PAYER.toBase58())).toBe(false);
  });
});

describe('pickTipAccount', () => {
  it('always resolves to a real tip account and wraps on any seed', () => {
    for (const seed of [-1234, 0, 1, 7, 8, 999999]) {
      const account = pickTipAccount(seed);
      expect(isJitoTipAccount(account)).toBe(true);
    }
  });
});

describe('buildJitoTipInstruction', () => {
  it('transfers the requested lamports from the payer to a tip account', () => {
    const tipAccount = JITO_TIP_ACCOUNTS[0] as string;
    const ix = buildJitoTipInstruction(PAYER, JITO_TIP_LAMPORTS.fast, tipAccount);

    expect(ix.programId.equals(SystemProgram.programId)).toBe(true);
    expect(ix.keys[0]?.pubkey.equals(PAYER)).toBe(true);
    expect(ix.keys[1]?.pubkey.toBase58()).toBe(tipAccount);
    // data = u32 instruction index (2 = transfer) + u64 lamports, little-endian
    expect(ix.data.readUInt32LE(0)).toBe(2);
    expect(ix.data.readBigUInt64LE(4)).toBe(JITO_TIP_LAMPORTS.fast);
  });

  it('refuses a tip below the engine minimum', () => {
    expect(() => buildJitoTipInstruction(PAYER, JITO_MIN_TIP_LAMPORTS - 1n))
      .toThrow(/at least/);
  });

  it('refuses an explicit destination that is not a tip account', () => {
    expect(() => buildJitoTipInstruction(PAYER, 1_000n, PAYER.toBase58()))
      .toThrow(/not a Jito tip account/);
  });
});

describe('paysJitoTip', () => {
  it('detects a tipped transaction', () => {
    const ix = buildJitoTipInstruction(PAYER, 1_000n, JITO_TIP_ACCOUNTS[3] as string);
    expect(paysJitoTip(compile([ix]))).toBe(true);
  });

  it('does not flag a transaction without a tip', () => {
    const ix = SystemProgram.transfer({
      fromPubkey: PAYER,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1_000n,
    });
    expect(paysJitoTip(compile([ix]))).toBe(false);
  });
});

describe('buildJitoSendBody', () => {
  it('builds the base64 JSON-RPC envelope the engine expects', () => {
    expect(buildJitoSendBody('AQID')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: ['AQID', { encoding: 'base64' }],
    });
  });

  it('rejects an empty payload', () => {
    expect(() => buildJitoSendBody('')).toThrow(/base64/);
  });
});

describe('parseJitoSendResponse', () => {
  it('returns the signature from a success body', () => {
    expect(parseJitoSendResponse({ jsonrpc: '2.0', id: 1, result: '5sig' })).toBe('5sig');
  });

  it('throws on a JSON-RPC error even though HTTP was 200', () => {
    expect(() => parseJitoSendResponse({ error: { message: 'tip too low' } }))
      .toThrow(/tip too low/);
  });

  it('throws when no signature is present', () => {
    expect(() => parseJitoSendResponse({ result: '' })).toThrow(/no signature/);
  });
});
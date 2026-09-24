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
 * EVM intent compilation tests.
 *
 * These guard the wire format. The token-transfer path replaced a
 * hand-written `encodeErc20Transfer` helper, so the calldata must be
 * byte-identical to the previous implementation — a mismatch here means
 * funds go to the wrong address or the wrong amount.
 */
import { describe, it, expect } from 'vitest';

import { compileIntent, encodeAllowance, encodeBalanceOf, decodeUint256 } from './intent.js';

const TOKEN = '0x55d398326f99059fF775485246999027B3197955';  // BSC USDT
const RECIPIENT = '0x461c9A881812BbC66355FA13594442651552f772';
const SPENDER = '0x1111111254EEB25477B68fb85Ed929f73A960582';  // 1inch router

/** ERC20 function selectors (first 4 bytes of keccak of the signature) */
const SELECTOR = {
  transfer: 'a9059cbb',   // transfer(address,uint256)
  approve: '095ea7b3',    // approve(address,uint256)
  allowance: 'dd62ed3e',  // allowance(address,address)
  balanceOf: '70a08231',  // balanceOf(address)
} as const;

/** Read the 32-byte word at `index` from calldata as an address (lowercased) */
function wordAt(data: string, index: number): string {
  const start = 10 + index * 64;   // skip '0x' + selector
  return `0x${data.slice(start + 24, start + 64)}`.toLowerCase();
}

/** Read the 32-byte word at `index` from calldata as a bigint */
function amountAt(data: string, index: number): bigint {
  const start = 10 + index * 64;
  return BigInt(`0x${data.slice(start, start + 64)}`);
}

describe('compileIntent — native transfer', () => {
  it('sends value directly with no calldata', () => {
    const call = compileIntent({ kind: 'native-transfer', to: RECIPIENT, amountRaw: '1000000000000000000' });

    expect(call.to).toBe(RECIPIENT);
    expect(call.value).toBe('1000000000000000000');
    expect(call.data).toBeUndefined();
  });
});

describe('compileIntent — token transfer', () => {
  it('targets the token contract with transfer calldata and zero value', () => {
    const call = compileIntent({
      kind: 'token-transfer',
      token: TOKEN,
      decimals: 18,
      to: RECIPIENT,
      amountRaw: '2500000000000000000',
    });

    // Value goes to the CONTRACT, not the recipient — a native-value send
    // here would be lost.
    expect(call.to).toBe(TOKEN);
    expect(call.value).toBe('0');

    expect(call.data).toBeDefined();
    expect(call.data!.slice(0, 10)).toBe(`0x${SELECTOR.transfer}`);
    expect(wordAt(call.data!, 0)).toBe(RECIPIENT.toLowerCase());
    expect(amountAt(call.data!, 1)).toBe(2500000000000000000n);
  });

  it('ignores decimals (the amount is already in base units)', () => {
    // Regression guard: passing a human amount but token decimals would
    // silently send 10^decimals times too much.
    const a = compileIntent({
      kind: 'token-transfer', token: TOKEN, decimals: 6, to: RECIPIENT, amountRaw: '42',
    });
    const b = compileIntent({
      kind: 'token-transfer', token: TOKEN, decimals: 18, to: RECIPIENT, amountRaw: '42',
    });

    expect(a.data).toBe(b.data);
  });
});

describe('compileIntent — approve', () => {
  it('encodes approve(spender, amount) against the token contract', () => {
    const call = compileIntent({
      kind: 'approve',
      token: TOKEN,
      spender: SPENDER,
      amountRaw: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    });

    expect(call.to).toBe(TOKEN);
    expect(call.value).toBe('0');
    expect(call.data!.slice(0, 10)).toBe(`0x${SELECTOR.approve}`);
    expect(wordAt(call.data!, 0)).toBe(SPENDER.toLowerCase());
    // Max uint256 — the "unlimited approval" value
    expect(amountAt(call.data!, 1)).toBe(2n ** 256n - 1n);
  });
});

describe('compileIntent — contract call', () => {
  it('passes calldata and value through untouched', () => {
    // This is the path an aggregator quote (0x) travels.
    const call = compileIntent({
      kind: 'contract-call',
      to: SPENDER,
      data: '0xdeadbeef',
      valueRaw: '123',
    });

    expect(call).toEqual({ to: SPENDER, value: '123', data: '0xdeadbeef' });
  });

  it('defaults value to zero when omitted', () => {
    const call = compileIntent({ kind: 'contract-call', to: SPENDER, data: '0x' });
    expect(call.value).toBe('0');
  });
});

describe('read-call encoders', () => {
  it('encodes allowance(owner, spender)', () => {
    const data = encodeAllowance(RECIPIENT, SPENDER);
    expect(data.slice(0, 10)).toBe(`0x${SELECTOR.allowance}`);
    expect(wordAt(data, 0)).toBe(RECIPIENT.toLowerCase());
    expect(wordAt(data, 1)).toBe(SPENDER.toLowerCase());
  });

  it('encodes balanceOf(owner)', () => {
    const data = encodeBalanceOf(RECIPIENT);
    expect(data.slice(0, 10)).toBe(`0x${SELECTOR.balanceOf}`);
    expect(wordAt(data, 0)).toBe(RECIPIENT.toLowerCase());
  });
});

describe('decodeUint256', () => {
  it('decodes a plain uint256 return value', () => {
    const word = '0000000000000000000000000000000000000000000000000de0b6b3a7640000';
    expect(decodeUint256(`0x${word}`)).toBe(1000000000000000000n);
  });

  it('reads only the first word when more are returned', () => {
    const first = '000000000000000000000000000000000000000000000000000000000000002a';
    const second = '00000000000000000000000000000000000000000000000000000000000000ff';
    expect(decodeUint256(`0x${first}${second}`)).toBe(42n);
  });

  it('treats an empty return as zero', () => {
    // A call to a non-contract address returns '0x' — must not throw.
    expect(decodeUint256('0x')).toBe(0n);
  });
});

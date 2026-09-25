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
 * EVM intent compilation and read-call encoding — pure helpers, no network.
 */

import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';

import type { TxIntent } from '@7xcircle/shared';

/** A compiled EVM call — the fields that go on the wire */
export interface EvmCall {
  to: string;
  value: string;
  data?: string;
}

/**
 * Translate a semantic intent into an EVM call.
 *
 * Token transfers target the token contract with `transfer` calldata;
 * native transfers send value directly. `value` is always a decimal string
 * so it survives JSON round trips.
 */
export function compileIntent(intent: TxIntent): EvmCall {
  switch (intent.kind) {
    case 'native-transfer':
      return { to: intent.to, value: intent.amountRaw };

    case 'token-transfer':
      return {
        to: intent.token,
        value: '0',
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [intent.to as Address, BigInt(intent.amountRaw)],
        }),
      };

    case 'contract-call':
      return {
        to: intent.to,
        value: intent.valueRaw ?? '0',
        data: intent.data,
      };

    case 'approve':
      return {
        to: intent.token,
        value: '0',
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [intent.spender as Address, BigInt(intent.amountRaw)],
        }),
      };
  }
}

// ─── Read-call encoding (for readContract) ───────────────────────────

/** Encode `allowance(owner, spender)` calldata */
export function encodeAllowance(owner: string, spender: string): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner as Address, spender as Address],
  });
}

/** Encode `balanceOf(owner)` calldata */
export function encodeBalanceOf(owner: string): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner as Address],
  });
}

/**
 * Decode a uint256 return value from `eth_call` result hex.
 *
 * Reads only the first 32-byte word, so it also works for calls that return
 * a tuple whose first member is the value we want.
 */
export function decodeUint256(data: string): bigint {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length === 0) return 0n;
  return BigInt(`0x${hex.slice(0, 64)}`);
}

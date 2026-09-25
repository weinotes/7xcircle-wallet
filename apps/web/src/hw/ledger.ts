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
 * Ledger / Ledger-compatible hardware wallet bridge (EVM chains).
 *
 * Devices: Ledger Nano S Plus / Stax, and OneKey Classic-style devices
 * which speak the Ledger WebUSB protocol (same vendor id framing, same
 * ETH app APDUs) — one code path covers both.
 *
 * Threat model: the private key NEVER exists in this process. We hand the
 * device the canonical tx payload, the device signs, and we only ever see
 * the (r, s, v). The wallet therefore can be phishing-locked and the funds
 * stay safe behind the physical confirm button.
 *
 * Scope: EVM only this round. Solana (ed25519 app) and Tron signing need
 * their own device apps and are deliberately not half-wired here.
 */

import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import { serializeTransaction, type Signature } from 'viem';

import type { Account, SignedTransaction, UnsignedTx } from '@open-wallet/shared';

/** Instance type of the Ledger Ethereum app, resolved at import time */
type EthApp = InstanceType<typeof import('@ledgerhq/hw-app-eth')['default']>;

/** Ledger ETH app signature shape (hex strings) */
export interface DeviceSignature {
  v: string;
  r: string;
  s: string;
}

/** WebUSB is only in Chromium desktop (and the MV3 popup with "usb" grants) */
export function isHardwareAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && typeof (navigator as { usb?: unknown }).usb !== 'undefined'
    && typeof window !== 'undefined'
    && (navigator.userAgent.includes('Chrome') || navigator.userAgent.includes('Edg'));
}

/** Open the Ethereum app on the connected device (user must have it installed) */
export async function openEthApp(): Promise<{
  eth: EthApp;
  close: () => Promise<unknown>;
}> {
  const transport = await TransportWebUSB.create();
  // late import keeps the (large) eth-app module out of the first paint
  const { default: Eth } = await import('@ledgerhq/hw-app-eth');
  const eth = new Eth(transport);
  return {
    eth,
    close: () => transport.close(),
  };
}

export interface LedgerDiscoveredAccount {
  path: string;
  address: string;
  publicKey: string; // hex, uncompressed sans 0x04
}

/** Standard MetaMask-compatible account path for EVM chains */
export function ledgerEvmPath(index: number): string {
  return `m/44'/60'/${index}'/0/0`;
}

/**
 * Browse `count` accounts starting at `from` WITHOUT asking for on-device
 * confirmation (non-display mode) — this is what the connect screen shows.
 */
export async function browseLedgerAccounts(
  eth: EthApp,
  from = 0,
  count = 5,
): Promise<LedgerDiscoveredAccount[]> {
  const out: LedgerDiscoveredAccount[] = [];
  for (let i = from; i < from + count; i++) {
    const path = ledgerEvmPath(i);
    const res = await eth.getAddress(path, false, false);
    out.push({
      path,
      address: res.address,
      publicKey: res.publicKey.startsWith('0x') ? res.publicKey.slice(2) : res.publicKey,
    });
  }
  return out;
}

/** "bsc-56" → 56; "eth-1" → 1 (decimal chain id for the tx payload) */
export function chainDecimalFromKey(chainKey: string): number {
  const tail = chainKey.split('-').pop() ?? '';
  const n = Number(tail);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`cannot read a decimal chain id out of "${chainKey}"`);
  }
  return n;
}

/** hw-app-eth tx payload built from our chain-agnostic UnsignedTx */
export function toLedgerTxConfig(unsigned: Extract<UnsignedTx, { chainType: 'evm' }>) {
  const is1559 = Boolean(unsigned.maxFeePerGas);
  const hex = (v: string | number | undefined | null) => {
    if (v === undefined || v === null || v === '' || v === 0 || v === '0' || v === '0x') return '0x';
    const bare = BigInt(v).toString(16);
    return '0x' + (bare.length % 2 ? '0' + bare : bare);
  };
  return {
    chainId: chainDecimalFromKey(unsigned.chainId),
    nonce: unsigned.nonce ?? 0,
    gasLimit: hex(unsigned.gasLimit),
    gasPrice: is1559 ? undefined : hex(unsigned.gasPrice),
    maxFeePerGas: is1559 ? hex(unsigned.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: is1559 ? hex(unsigned.maxPriorityFeePerGas) : undefined,
    to: unsigned.to,
    value: hex(unsigned.value),
    data: unsigned.data && unsigned.data !== '0x' ? unsigned.data : undefined,
    type: is1559 ? 2 : 0,
  };
}

/**
 * Convert the device (v,r,s) into a viem signature.
 * Legacy EIP-155 returns v = chainId*2 + 35 + parity — viem wants the raw
 * 27/28 yParity and re-applies EIP-155 during serialization.
 */
export function toViemSignature(
  sig: DeviceSignature,
  is1559: boolean,
  chainId: number,
): Signature {
  let v = BigInt(parseInt(sig.v.startsWith('0x') ? sig.v : '0x' + sig.v, 16));
  if (!is1559 && v >= 35n) {
    v = ((v - 35n) % 2n) + 27n;
  }
  const r = (sig.r.startsWith('0x') ? sig.r : '0x' + sig.r) as `0x${string}`;
  const s = (sig.s.startsWith('0x') ? sig.s : '0x' + sig.s) as `0x${string}`;
  return { r, s, v: v === 28n ? 28n : 27n };
}

/**
 * Sign an EVM transaction ON the device and return exactly the
 * SignedTransaction shape adapter.sendTransaction already consumes.
 * The device shows the tx and the user presses both physical buttons.
 */
export async function ledgerSignEvmTransaction(
  eth: EthApp,
  path: string,
  unsigned: Extract<UnsignedTx, { chainType: 'evm' }>,
): Promise<SignedTransaction> {
  const config = toLedgerTxConfig(unsigned);
  const rawSig = await eth.signTransaction(path, config as never);
  // normalize whatever shape the device returned into hex strings
  const sig: DeviceSignature = {
    v: String(rawSig.v),
    r: String(rawSig.r),
    s: String(rawSig.s),
  };
  const is1559 = config.type === 2;
  const signature = toViemSignature(sig, is1559, config.chainId);

  const base = {
    nonce: config.nonce,
    to: unsigned.to as `0x${string}`,
    value: BigInt(unsigned.value ?? '0'),
    data: ((unsigned.data ?? '0x') as `0x${string}`),
  };
  const tx = is1559
    ? {
        ...base,
        type: 'eip1559' as const,
        chainId: config.chainId,
        gas: BigInt(unsigned.gasLimit ?? '0'),
        maxFeePerGas: BigInt(unsigned.maxFeePerGas ?? '0'),
        maxPriorityFeePerGas: BigInt(unsigned.maxPriorityFeePerGas ?? '0'),
      }
    : {
        ...base,
        type: 'legacy' as const,
        chainId: config.chainId,
        gas: BigInt(unsigned.gasLimit ?? '0'),
        gasPrice: BigInt(unsigned.gasPrice ?? '0'),
      };

  const raw = serializeTransaction(tx, signature);
  return { raw, signature: raw };
}

/** EIP-191 personal_sign executed on the device (dApp login flows) */
export async function ledgerSignMessage(
  eth: EthApp,
  path: string,
  messageHex: string,
): Promise<string> {
  const rawSig = await eth.signPersonalMessage(path, messageHex);
  const sig: DeviceSignature = {
    v: String(rawSig.v),
    r: String(rawSig.r),
    s: String(rawSig.s),
  };
  const v = (sig.v.startsWith('0x') ? parseInt(sig.v, 16) : Number(sig.v)) - 27;
  const vh = v.toString(16).padStart(2, '0');
  const r = sig.r.startsWith('0x') ? sig.r.slice(2) : sig.r;
  const s = sig.s.startsWith('0x') ? sig.s.slice(2) : sig.s;
  return `0x${r}${s}${vh}`;
}

/** The path a hardware account is keyed by (stored on the Account record) */
export function ledgerPathOf(account: Account): string {
  if (account.source !== 'ledger') {
    throw new Error('not a hardware account');
  }
  return account.derivationPath;
}

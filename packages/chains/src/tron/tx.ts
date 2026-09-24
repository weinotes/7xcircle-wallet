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
 * TRON transaction assembly — pure, offline, no network.
 *
 * Everything that must be byte-exact before signing lives here:
 *   - TAPOS reference fields derived from the head block
 *   - intent → contract message compilation (TRC20 via the shared erc20 ABI)
 *   - the sha256 → secp256k1 signature format Tron verifies
 *
 * The head block arrives as TronBlockHeader because /wallet/getnowblock is
 * the only sane source for ref fields; the adapter fetches and passes it in,
 * keeping this module deterministic and unit-testable.
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { encodeFunctionData, erc20Abi, type Address } from 'viem';

import { fromHex, toHex } from '@open-wallet/shared';
import type { TxIntent } from '@open-wallet/shared';

import {
  CONTRACT_TYPE_TRANSFER,
  CONTRACT_TYPE_TRIGGER_SMART_CONTRACT,
  encodeContract,
  encodeRawData,
  encodeTransferContract,
  encodeTriggerSmartContract,
  readFields,
  type PbField,
  type TxReference,
} from './protobuf.js';
import { toAddressBytes, tronToEvmAddress } from './address.js';

/** Minimal head-block fields needed to build TAPOS refs (from /wallet/getnowblock) */
export interface TronBlockHeader {
  /** Block height */
  number: number;
  /** 32-byte block id, hex (no 0x) — first 8 bytes are the BE block number */
  blockId: string;
  /** Block timestamp in millis */
  timestamp: number;
  /**
   * Validity window for the built transaction, millis past block timestamp.
   * Nodes accept up to 24h; 60s matches the wallet convention, but memecoin
   * senders on flaky connections benefit from a wider default.
   */
  ttlMillis?: number;
}

/** Derive ref_block_bytes / ref_block_hash per java-tron setReference():
 *  ref_block_hash  = blockId[8..16), ref_block_bytes = BE(number)[6..8)
 *  nowMillis is injectable for deterministic tests. */
export function computeTxReference(header: TronBlockHeader, nowMillis?: number): TxReference {
  const blockId = fromHex(header.blockId);
  if (blockId.length !== 32) {
    throw new Error(`invalid blockId length: ${blockId.length}`);
  }
  const numBytes = new Uint8Array(8);
  let n = header.number;
  for (let i = 7; i >= 0; i--) {
    numBytes[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  const ttl = header.ttlMillis ?? 10 * 60 * 1000;
  return {
    refBlockBytes: blockIdRefBytes(numBytes),
    refBlockHash: blockId.slice(8, 16),
    expiration: header.timestamp + ttl,
    timestamp: nowMillis ?? Date.now(),
  };
}

/** bytes 6..8 of the 8-byte big-endian block number (the low 2 bytes) */
function blockIdRefBytes(numBytes: Uint8Array): Uint8Array {
  return numBytes.slice(6, 8);
}

/** Compiled contract payload + type tag for an intent */
export function compileTronIntent(params: {
  intent: TxIntent;
  ownerAddress: string;
}): { type: number; typeUrl: string; payload: Uint8Array } {
  const owner = toAddressBytes(params.ownerAddress);
  const intent = params.intent;

  switch (intent.kind) {
    case 'native-transfer': {
      return {
        type: CONTRACT_TYPE_TRANSFER,
        typeUrl: 'type.googleapis.com/protocol.TransferContract',
        payload: encodeTransferContract({
          ownerAddress: owner,
          toAddress: toAddressBytes(intent.to),
          amountSun: BigInt(intent.amountRaw),
        }),
      };
    }

    case 'token-transfer':
    case 'approve': {
      // TRC20 uses the same ABI as ERC20; ABI args take the 0x… 20-byte form
      const contract = toAddressBytes(intent.token);
      const data =
        intent.kind === 'token-transfer'
          ? encodeFunctionData({
              abi: erc20Abi,
              functionName: 'transfer',
              args: [toTronAbiAddress(intent.to), BigInt(intent.amountRaw)],
            })
          : encodeFunctionData({
              abi: erc20Abi,
              functionName: 'approve',
              args: [toTronAbiAddress(intent.spender), BigInt(intent.amountRaw)],
            });
      return {
        type: CONTRACT_TYPE_TRIGGER_SMART_CONTRACT,
        typeUrl: 'type.googleapis.com/protocol.TriggerSmartContract',
        payload: encodeTriggerSmartContract({
          ownerAddress: owner,
          contractAddress: contract,
          data: fromHex(data),
        }),
      };
    }

    case 'contract-call': {
      return {
        type: CONTRACT_TYPE_TRIGGER_SMART_CONTRACT,
        typeUrl: 'type.googleapis.com/protocol.TriggerSmartContract',
        payload: encodeTriggerSmartContract({
          ownerAddress: owner,
          contractAddress: toAddressBytes(intent.to),
          data: fromHex(intent.data),
          callValueSun: intent.valueRaw ? BigInt(intent.valueRaw) : undefined,
        }),
      };
    }
  }
}

/** Address as TRC20 ABI expects it: base58 → 0x… 20-byte hex */
function toTronAbiAddress(address: string): Address {
  if (address.startsWith('T') && address.length === 34) {
    return tronToEvmAddress(address) as Address;
  }
  return address as Address;
}

/** Build the unsigned raw_data bytes for an intent. Deterministic given header. */
export function buildRawData(params: {
  intent: TxIntent;
  ownerAddress: string;
  header: TronBlockHeader;
  /** Max SUN for energy (TRC20 calls); defaults to a conservative 30 TRX */
  feeLimitSun?: bigint;
  /** Injectable clock for deterministic builds (tests, replay tooling) */
  nowMillis?: number;
}): { rawData: Uint8Array; txId: string; ref: TxReference } {
  const compiled = compileTronIntent(params);
  const contract = encodeContract(compiled);
  const ref = computeTxReference(params.header, params.nowMillis);
  const intentIsContract = compiled.type === CONTRACT_TYPE_TRIGGER_SMART_CONTRACT;

  const rawData = encodeRawData({
    contract,
    ref: {
      ...ref,
      feeLimitSun: intentIsContract ? (params.feeLimitSun ?? 30_000_000n) : undefined,
    },
  });

  return { rawData, txId: toHex(sha256(rawData)), ref };
}

/**
 * Produce the 65-byte Tron signature: r(32) || s(32) || (recoveryId + 27).
 * Signs sha256(raw_data) — NO ethereum personal-message prefix.
 */
export function signRawData(rawData: Uint8Array, privateKey: Uint8Array): string {
  const hash = sha256(rawData);
  const sig = secp256k1.sign(hash, privateKey, { lowS: true });
  const out = new Uint8Array(65);
  out.set(sig.toCompactRawBytes(), 0);
  out[64] = sig.recovery + 27;
  return toHex(out);
}

/** Fee-tier → energy fee_limit multiplier (Tron fees don't buy speed; tiers only widen the safety cap) */
export function feeLimitForTier(feeTier: 'slow' | 'normal' | 'fast' | undefined, baseSun: bigint): bigint {
  switch (feeTier) {
    case 'slow':
      return baseSun;
    case 'fast':
      return baseSun * 3n;
    default:
      return baseSun * 2n;
  }
}

// ─── Broadcast JSON reconstruction ──────────────────────────────────
//
// /wallet/broadcasttransaction is happiest with the full transaction JSON a
// fullnode itself would return (raw_data object + raw_data_hex); posting
// ONLY the hex makes java-tron NPE. We decode our own deterministic bytes
// back into that shape — which doubles as a serialization round-trip check.

/** TronGrid-JSON raw_data for an unsigned raw_data blob (hex addresses,
 *  int64 fields as JSON numbers — the fullnode's gson parser REJECTS
 *  quoted strings for long fields and fails the contract silently). */
export function decodeRawDataJson(rawData: Uint8Array): Record<string, unknown> {
  const fields = readFields(rawData);
  const out: Record<string, unknown> = { contract: [] };
  for (const f of fields) {
    switch (f.field) {
      case 1:
        out.ref_block_bytes = toHex(bytesOf(f));
        break;
      case 4:
        out.ref_block_hash = toHex(bytesOf(f));
        break;
      case 8:
        out.expiration = int64Json(varintOf(f));
        break;
      case 11:
        (out.contract as unknown[]).push(decodeContractJson(bytesOf(f)));
        break;
      case 14:
        out.timestamp = int64Json(varintOf(f));
        break;
      case 18:
        out.fee_limit = int64Json(varintOf(f));
        break;
    }
  }
  return out;
}

/** int64 → JSON number literal (what fullnodes parse for long fields) */
function int64Json(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new Error('tron int64 exceeds JSON safe-integer range');
  }
  return Number(v);
}

function decodeContractJson(contract: Uint8Array): Record<string, unknown> {
  let type = 0n;
  let any: Uint8Array = new Uint8Array(0);
  for (const f of readFields(contract)) {
    if (f.field === 1) type = varintOf(f);
    if (f.field === 2) any = bytesOf(f);
  }
  let typeUrl = '';
  let payload: Uint8Array = new Uint8Array(0);
  for (const f of readFields(any)) {
    if (f.field === 1) typeUrl = new TextDecoder().decode(bytesOf(f));
    if (f.field === 2) payload = bytesOf(f);
  }
  const value: Record<string, unknown> = {};
  const isTransfer = type === BigInt(CONTRACT_TYPE_TRANSFER);
  for (const f of readFields(payload)) {
    if (isTransfer) {
      if (f.field === 1) value.owner_address = toHex(bytesOf(f));
      if (f.field === 2) value.to_address = toHex(bytesOf(f));
      if (f.field === 3) value.amount = int64Json(varintOf(f));
    } else if (type === BigInt(CONTRACT_TYPE_TRIGGER_SMART_CONTRACT)) {
      if (f.field === 1) value.owner_address = toHex(bytesOf(f));
      if (f.field === 2) value.contract_address = toHex(bytesOf(f));
      if (f.field === 3) value.data = toHex(bytesOf(f));
      if (f.field === 4) value.call_value = int64Json(varintOf(f));
    }
  }
  return {
    type: isTransfer ? 'TransferContract' : 'TriggerSmartContract',
    parameter: { type_url: typeUrl, value },
  };
}

function bytesOf(f: PbField): Uint8Array {
  if (typeof f.value === 'bigint') throw new Error(`field ${f.field}: expected bytes`);
  return f.value;
}

function varintOf(f: PbField): bigint {
  if (typeof f.value !== 'bigint') throw new Error(`field ${f.field}: expected varint`);
  return f.value;
}

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
 * Minimal protobuf wire-format writer for TRON transactions.
 *
 * TRON uses protobuf for everything on the wire. Rather than pulling in a
 * protobuf runtime (heavy, bundler-hostile on RN/extension), we hand-write
 * exactly the messages we need. Only what the wire format requires is
 * implemented — fields are encoded in ascending order and empty values are
 * omitted, matching protobuf's canonical serialization (java-tron accepts
 * any valid encoding, but deterministic output keeps txID stable).
 *
 * Wire types used: 0 = varint, 2 = length-delimited. All TRON ids/addresses
 * are bytes; amounts are int64 (varint, two's complement for negatives —
 * we never send negative values).
 */

/** Concatenate byte arrays */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Protobuf varint (unsigned LEB128) */
export function varint(value: number | bigint): Uint8Array {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n) throw new Error('negative varint not supported');
  const bytes: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    bytes.push(b);
  } while (v > 0n);
  return Uint8Array.from(bytes);
}

/** Field tag = (fieldNumber << 3) | wireType */
function tag(fieldNumber: number, wireType: 0 | 2): Uint8Array {
  return varint((fieldNumber << 3) | wireType);
}

/** int64 / uint64 field (varint). Skipped when zero, like proto3 default. */
export function int64Field(fieldNumber: number, value: number | bigint): Uint8Array {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  if (v === 0n) return new Uint8Array(0);
  return concatBytes([tag(fieldNumber, 0), varint(v)]);
}

/** bytes field (length-delimited). Empty bytes still encode a present-but-empty value. */
export function bytesField(fieldNumber: number, value: Uint8Array): Uint8Array {
  return concatBytes([tag(fieldNumber, 2), varint(value.length), value]);
}

/** string field (length-delimited UTF-8) */
export function stringField(fieldNumber: number, value: string): Uint8Array {
  const enc = new TextEncoder().encode(value);
  return concatBytes([tag(fieldNumber, 2), varint(enc.length), enc]);
}

/** Embedded message field */
export function messageField(fieldNumber: number, value: Uint8Array): Uint8Array {
  return bytesField(fieldNumber, value);
}

// ─── TRON contract messages ──────────────────────────────────────────
//
// Field numbers from java-tron core/protos (contract.proto / core.proto):
//   TransferContract      { bytes owner_address = 1; bytes to_address = 2; int64 amount = 3; }
//   TriggerSmartContract  { bytes owner_address = 1; bytes contract_address = 2; bytes data = 3;
//                           int64 call_value = 4; int64 token_value = 5; }
//                           (legacy function_selector/parameter fields are unused — `data`
//                           carries the full 4-byte-selector calldata, like EVM)
//   Transaction.Contract  { ContractType type = 1; google.protobuf.Any parameter = 2; int32 Permission_id = 5; }
//   google.protobuf.Any   { string type_url = 1; bytes value = 2; }
//   Transaction.raw       { bytes ref_block_bytes = 1; int64 ref_block_num = 3; bytes ref_block_hash = 4;
//                           int64 expiration = 8; repeated Contract contract = 11; int64 timestamp = 14;
//                           int64 fee_limit = 18; }
//   Transaction           { raw raw_data = 1; repeated bytes signature = 2; repeated Result ret = 5; }

/** Contract contract type enum values (subset we emit) */
export const CONTRACT_TYPE_TRANSFER = 1;
export const CONTRACT_TYPE_TRIGGER_SMART_CONTRACT = 31;

export function encodeTransferContract(params: {
  ownerAddress: Uint8Array;   // 21 bytes, 0x41-prefixed
  toAddress: Uint8Array;      // 21 bytes, 0x41-prefixed
  amountSun: bigint;
}): Uint8Array {
  return concatBytes([
    bytesField(1, params.ownerAddress),
    bytesField(2, params.toAddress),
    int64Field(3, params.amountSun),
  ]);
}

export function encodeTriggerSmartContract(params: {
  ownerAddress: Uint8Array;   // 21 bytes
  contractAddress: Uint8Array; // 21 bytes
  /** Full calldata: 4-byte selector + ABI-encoded args */
  data: Uint8Array;
  callValueSun?: bigint;
}): Uint8Array {
  return concatBytes([
    bytesField(1, params.ownerAddress),
    bytesField(2, params.contractAddress),
    bytesField(3, params.data),
    int64Field(4, params.callValueSun ?? 0n),
  ]);
}

/** Wrap a contract message into Transaction.Contract { type, parameter: Any{type_url, value} } */
export function encodeContract(params: {
  type: number;
  typeUrl: string;            // e.g. "type.googleapis.com/protocol.TransferContract"
  payload: Uint8Array;
}): Uint8Array {
  const any = concatBytes([
    stringField(1, params.typeUrl),
    bytesField(2, params.payload),
  ]);
  return concatBytes([
    int64Field(1, params.type),
    messageField(2, any),
  ]);
}

/** Raw TRON block-ref fields shared by all builders */
export interface TxReference {
  /** 2 bytes: bytes 6..8 of the big-endian ref block number */
  refBlockBytes: Uint8Array;
  /** 8 bytes: bytes 8..16 of the ref block id */
  refBlockHash: Uint8Array;
  /** millis — must be within (refBlockTime, refBlockTime + 24h) */
  expiration: number;
  /** millis — creation time */
  timestamp: number;
  /** max SUN spendable on energy (trigger_contract only; ignored elsewhere) */
  feeLimitSun?: bigint;
}

/** Serialize Transaction.raw (the exact bytes that get sha256'd for signing) */
export function encodeRawData(params: {
  contract: Uint8Array;      // one encodeContract() output
  ref: TxReference;
}): Uint8Array {
  return concatBytes([
    bytesField(1, params.ref.refBlockBytes),
    bytesField(4, params.ref.refBlockHash),
    int64Field(8, params.ref.expiration),
    messageField(11, params.contract),
    int64Field(14, params.ref.timestamp),
    int64Field(18, params.ref.feeLimitSun ?? 0n),
  ]);
}

// ─── Minimal reader (broadcast JSON reconstruction, round-trip tests) ───

/** One decoded protobuf field: varints as bigint, length-delimited as bytes */
export interface PbField {
  field: number;
  wire: 0 | 2;
  value: bigint | Uint8Array;
}

/** Decode the top-level fields of a protobuf message (unknown fields kept) */
export function readFields(buf: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let i = 0;
  while (i < buf.length) {
    const [key, next] = readVarint(buf, i);
    i = next;
    const wire = Number(key & 0x7n) as 0 | 2;
    const field = Number(key >> 3n);
    if (wire === 0) {
      const [v, n] = readVarint(buf, i);
      i = n;
      out.push({ field, wire, value: v });
    } else if (wire === 2) {
      const [len, n] = readVarint(buf, i);
      i = n;
      const end = i + Number(len);
      out.push({ field, wire, value: buf.slice(i, end) });
      i = end;
    } else {
      throw new Error(`protobuf wire type ${wire} not supported`);
    }
  }
  return out;
}

function readVarint(buf: Uint8Array, start: number): [bigint, number] {
  let value = 0n;
  let shift = 0n;
  let i = start;
  for (;;) {
    if (i >= buf.length) throw new Error('truncated varint');
    const b = buf[i++];
    value |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [value, i];
}

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
 * TRON transaction assembly tests — everything that must be byte-exact
 * before a node sees it, verified without network access.
 */

import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

import { fromHex, toHex } from '@7xcircle/shared';
import type { TxIntent } from '@7xcircle/shared';

import { publicKeyToTronAddress, tronAddressToBytes } from './address.js';
import { varint, encodeRawData, encodeContract, encodeTransferContract, CONTRACT_TYPE_TRANSFER, CONTRACT_TYPE_TRIGGER_SMART_CONTRACT } from './protobuf.js';
import {
  buildRawData,
  computeTxReference,
  decodeRawDataJson,
  feeLimitForTier,
  signRawData,
  type TronBlockHeader,
} from './tx.js';

const HEADER: TronBlockHeader = {
  number: 60_000_000,
  // 32-byte block id; bytes 8..16 are the TAPOS hash slice
  blockId: '0'.repeat(16) + 'deadbeefcafebabe' + '1'.repeat(32),
  timestamp: 1_700_000_000_000,
};
const NOW = 1_700_000_010_000;

// Owner key = 1 (deterministic); address derived, never hardcoded
const OWNER_PK = new Uint8Array(32);
OWNER_PK[31] = 1;
const OWNER_PUB = secp256k1.getPublicKey(OWNER_PK, false).slice(1);
const OWNER = publicKeyToTronAddress(OWNER_PUB);

describe('tron protobuf primitives', () => {
  it('encodes varints at the continuation boundaries', () => {
    expect(toHex(varint(0))).toBe('00');
    expect(toHex(varint(127))).toBe('7f');
    expect(toHex(varint(128))).toBe('8001');
    expect(toHex(varint(300))).toBe('ac02');
    expect(toHex(varint(1_000_000_000n))).toBe('8094ebdc03');
  });

  it('emits fee_limit (field 18) only when set', () => {
    const contract = encodeContract({
      type: CONTRACT_TYPE_TRIGGER_SMART_CONTRACT,
      typeUrl: 'type.googleapis.com/protocol.TriggerSmartContract',
      payload: new Uint8Array([0xff]),
    });
    const ref = {
      refBlockBytes: new Uint8Array([0x11, 0x22]),
      refBlockHash: new Uint8Array(8),
      expiration: 1,
      timestamp: 1,
    };
    const without = encodeRawData({ contract, ref });
    const withFee = encodeRawData({ contract, ref: { ...ref, feeLimitSun: 1000n } });
    // tag for field 18 wiretype 0 = (18<<3)|0 = 0x90, continuation byte 0x01
    expect(toHex(without)).not.toContain('9001');
    expect(toHex(withFee)).toContain('9001');
  });
});

describe('computeTxReference', () => {
  it('slices ref hash and block bytes per java-tron setReference', () => {
    const ref = computeTxReference(HEADER, NOW);
    // blockId bytes 8..16 → deadbeefcafebabe
    expect(toHex(ref.refBlockHash)).toBe('deadbeefcafebabe');
    // 60_000_000 = 0x03938700 → low two bytes of the BE 8-byte form
    expect(toHex(ref.refBlockBytes)).toBe('8700');
    expect(ref.expiration).toBe(HEADER.timestamp + 10 * 60 * 1000);
    expect(ref.timestamp).toBe(NOW);
  });

  it('rejects malformed block ids', () => {
    expect(() => computeTxReference({ ...HEADER, blockId: 'abcd' })).toThrow(/blockId length/);
  });
});

describe('buildRawData', () => {
  const native: TxIntent = { kind: 'native-transfer', to: OWNER, amountRaw: '1000000' };

  const build = (intent: TxIntent) =>
    buildRawData({ intent, ownerAddress: OWNER, header: HEADER, nowMillis: NOW });

  it('is deterministic for identical inputs', () => {
    const a = build(native);
    const b = build(native);
    expect(toHex(a.rawData)).toBe(toHex(b.rawData));
    expect(a.txId).toBe(toHex(sha256(a.rawData)));
  });

  it('changes output when the amount changes', () => {
    const a = build(native);
    const b = build({ kind: 'native-transfer', to: OWNER, amountRaw: '2000000' });
    expect(toHex(a.rawData)).not.toBe(toHex(b.rawData));
  });

  it('embeds owner and destination address bytes in the contract payload', () => {
    const { rawData } = build(native);
    const hex = toHex(rawData);
    expect(hex).toContain(toHex(tronAddressToBytes(OWNER)));
  });

  it('TRC20 transfer carries the erc20 selector and the contract bytes', () => {
    const intent: TxIntent = {
      kind: 'token-transfer',
      token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      to: OWNER,
      amountRaw: '5000000',
    };
    const { rawData } = build(intent);
    const hex = toHex(rawData);
    expect(hex).toContain('a9059cbb'); // transfer(address,uint256)
    // USDT-TRC20 contract, 21-byte form (0x41-prefixed), see address.test.ts
    expect(hex).toContain('41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
  });

  it('sets fee_limit on triggers but not on native transfers', () => {
    const nativeHex = toHex(build(native).rawData);
    const tokenIntent: TxIntent = {
      kind: 'token-transfer',
      token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      to: OWNER,
      amountRaw: '1',
    };
    const tokenHex = toHex(build(tokenIntent).rawData);
    // field 18 tag 0x9001 present exactly in the trigger encoding
    expect(nativeHex).not.toContain('9001');
    expect(tokenHex).toContain('9001');
  });
});

describe('signRawData', () => {
  it('recovers the owner address from the 65-byte signature', () => {
    const intent: TxIntent = { kind: 'native-transfer', to: OWNER, amountRaw: '7' };
    const { rawData } = buildRawData({ intent, ownerAddress: OWNER, header: HEADER, nowMillis: NOW });
    const sig = fromHex(signRawData(rawData, OWNER_PK));
    expect(sig.length).toBe(65);

    const recovery = sig[64] - 27;
    expect(recovery).toBeGreaterThanOrEqual(0);
    expect(recovery).toBeLessThanOrEqual(3);
    const recovered = secp256k1.Signature
      .fromCompact(toHex(sig.slice(0, 64)))
      .addRecoveryBit(recovery)
      .recoverPublicKey(sha256(rawData))
      .toRawBytes(false);
    expect(publicKeyToTronAddress(recovered.slice(1))).toBe(OWNER);

    // low-s canonical form required by java-tron verification
    const s = BigInt('0x' + toHex(sig.slice(32, 64)));
    expect(s <= secp256k1.CURVE.n >> 1n).toBe(true);
  });
});

describe('feeLimitForTier', () => {
  it('scales the cap, never the price', () => {
    expect(feeLimitForTier('slow', 100n)).toBe(100n);
    expect(feeLimitForTier('normal', 100n)).toBe(200n);
    expect(feeLimitForTier('fast', 100n)).toBe(300n);
    expect(feeLimitForTier(undefined, 100n)).toBe(200n);
  });
});

describe('golden vector — mainnet /wallet/createtransaction output', () => {
  // Captured live from api.trongrid.io (2026-09): our serializer must
  // reproduce a fullnode's own bytes for identical inputs, byte for byte.
  const NODE_RAW_DATA_HEX =
    '0a02573d2208c696cc077627ad0240b0ddba9f8d345a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a15411111111111111111111111111111111111111111121541a614f803b6fd780986a42c78ec9c7f77e6ded13c18c0843d70f796b79f8d34';

  it('serializes a TransferContract identically to java-tron', () => {
    const contract = encodeContract({
      type: CONTRACT_TYPE_TRANSFER,
      typeUrl: 'type.googleapis.com/protocol.TransferContract',
      payload: encodeTransferContract({
        ownerAddress: fromHex('41' + '11'.repeat(20)),
        toAddress: fromHex('41a614f803b6fd780986a42c78ec9c7f77e6ded13c'),
        amountSun: 1_000_000n,
      }),
    });
    const raw = encodeRawData({
      contract,
      ref: {
        refBlockBytes: fromHex('573d'),
        refBlockHash: fromHex('c696cc077627ad02'),
        expiration: 1_790_262_030_000,
        timestamp: 1_790_261_971_831,
      },
    });
    expect(toHex(raw)).toBe(NODE_RAW_DATA_HEX);
  });

  it('decodes the java-tron bytes back into faithful JSON', () => {
    const json = decodeRawDataJson(fromHex(NODE_RAW_DATA_HEX));
    const contract = (json.contract as Record<string, any>[])[0];
    expect(contract.type).toBe('TransferContract');
    expect(contract.parameter.value.owner_address).toBe('41' + '11'.repeat(20));
    expect(contract.parameter.value.to_address).toBe('41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
    expect(contract.parameter.value.amount).toBe(1000000);
    expect(json.ref_block_bytes).toBe('573d');
    expect(json.ref_block_hash).toBe('c696cc077627ad02');
    expect(json.timestamp).toBe(1790261971831);
    expect(json.expiration).toBe(1790262030000);
  });
});

describe('decodeRawDataJson round-trip', () => {
  it('recovers every intent field from the serialized bytes', () => {
    const intent: TxIntent = { kind: 'native-transfer', to: OWNER, amountRaw: '123456789' };
    const { rawData } = buildRawData({ intent, ownerAddress: OWNER, header: HEADER, nowMillis: NOW });
    const json = decodeRawDataJson(rawData);
    const contract = (json.contract as Record<string, any>[])[0];
    expect(contract.type).toBe('TransferContract');
    expect(contract.parameter.type_url).toBe('type.googleapis.com/protocol.TransferContract');
    expect(contract.parameter.value.owner_address).toBe(toHex(tronAddressToBytes(OWNER)));
    expect(contract.parameter.value.to_address).toBe(toHex(tronAddressToBytes(OWNER)));
    expect(contract.parameter.value.amount).toBe(123456789);
    expect(json.ref_block_bytes).toBe('8700');
    expect(json.ref_block_hash).toBe('deadbeefcafebabe');
    expect(json.timestamp).toBe(NOW);
    expect(json.expiration).toBe(HEADER.timestamp + 600_000);
    expect(json.fee_limit).toBeUndefined();
  });

  it('recovers TRC20 calldata and fee_limit', () => {
    const intent: TxIntent = {
      kind: 'token-transfer',
      token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      to: OWNER,
      amountRaw: '5000000',
    };
    const { rawData } = buildRawData({
      intent,
      ownerAddress: OWNER,
      header: HEADER,
      feeLimitSun: 12345n,
      nowMillis: NOW,
    });
    const json = decodeRawDataJson(rawData);
    expect(json.fee_limit).toBe(12345);
    const contract = (json.contract as Record<string, any>[])[0];
    expect(contract.type).toBe('TriggerSmartContract');
    expect(contract.parameter.value.data.startsWith('a9059cbb')).toBe(true);
    expect(contract.parameter.value.contract_address).toBe('41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
  });
});

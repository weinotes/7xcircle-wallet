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
 * Shared type definitions used across all packages and platforms.
 * These are pure data types with no runtime dependencies.
 */

/** Supported chain types */
export type ChainType = 'evm' | 'solana' | 'tron' | 'utxo' | 'cosmos';

/** Password strength result */
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'weak' | 'fair' | 'good' | 'strong';
  errors: string[];
}

/** Unified account model across all chains */
export interface Account {
  id: string;               // unique account id (uuid or derived)
  chainId: string;          // e.g. "bsc-56", "eth-1", "solana"
  address: string;          // native address format per chain
  publicKey: string;        // hex or base58 encoded
  derivationPath: string;   // e.g. "m/44'/60'/0'/0/0"; "imported" / "ledger" for non-HD
  accountIndex: number;     // index within the derivation path
  nickname?: string;
  createdAt: number;        // unix timestamp
  /**
   * Where the signing capability lives:
   *   hd     — derived from the vault mnemonic (default, older records omit it)
   *   key    — raw private key imported into the vault
   *   ledger — keys never leave the device; signing routes to the hardware
   */
  source?: 'hd' | 'key' | 'ledger';
}

/** Unified token model */
export interface Token {
  address: string;          // "0x..." for EVM, token mint for Solana, "native" for chain native
  symbol: string;
  name: string;
  decimals: number;
  chainId: string;
  logoUrl?: string;
  priceUsd?: number;
  isNative: boolean;
}

/** Token with balance info */
export interface TokenBalance extends Token {
  balance: string;          // string to preserve precision
  balanceUsd?: number;
}

/**
 * EVM-shaped unsigned transaction.
 *
 * This is the EVM branch of {@link UnsignedTx}. Non-EVM chains carry their
 * own payload shape and must NOT overload `to`/`value`/`data` to mean
 * something else (an earlier revision smuggled Solana SPL transfers through
 * `data` as a string DSL, which broke the meaning of every field here).
 */
export interface RawTransaction {
  from: string;
  to: string;
  value: string;            // wei as string
  data?: string;            // calldata hex (EVM only)
  gasLimit?: string;
  gasPrice?: string;        // legacy
  maxFeePerGas?: string;    // EIP-1559
  maxPriorityFeePerGas?: string;
  nonce?: number;
  chainId?: string;
}

/** Fee speed tier — each chain maps this to its own acceleration strategy */
export type FeeTier = 'slow' | 'normal' | 'fast';

/**
 * What the user wants to do — a chain-agnostic semantic layer.
 *
 * `amountRaw` is always the smallest-unit value as a string (wei, lamports,
 * token base units) to avoid floating point precision loss. Adapters are
 * responsible for translating an intent into their chain's native form.
 *
 * Intents describe *what*; the sender is passed separately via BuildOpts.
 */
export type TxIntent =
  | { kind: 'native-transfer'; to: string; amountRaw: string }
  | {
      kind: 'token-transfer';
      token: string;          // ERC20 contract address / SPL mint / TRC20 contract (hex or base58)
      decimals: number;       // required by SPL transferChecked
      to: string;
      amountRaw: string;
    }
  | { kind: 'contract-call'; to: string; data: string; valueRaw?: string }
  // EVM/Tron only — Solana has no approval concept
  | { kind: 'approve'; token: string; spender: string; amountRaw: string };

/**
 * A transaction built outside the wallet — returned by an aggregator or dApp
 * (Jupiter, 0x, WalletConnect). We import and sign it rather than build it.
 */
export interface ExternalTx {
  encoding: 'base64' | 'hex';
  payload: string;
  /** Solana: payload is a v0 VersionedTransaction */
  versioned?: boolean;
}

/**
 * Compiled, unsigned transaction ready to sign.
 * The payload is chain-native and opaque to callers.
 */
export type UnsignedTx =
  | ({ chainType: 'evm'; chainId: string } & RawTransaction)
  | {
      chainType: 'solana';
      chainId: string;
      /** Hex-serialized unsigned transaction (see shared `toHex` / `fromHex`) */
      serialized: string;
      versioned: boolean;
      recentBlockhash: string;
      /** Lets callers detect blockhash expiry and rebuild */
      lastValidBlockHeight: number;
    }
  | {
      chainType: 'tron';
      chainId: string;
      /**
       * Exact protobuf bytes of Transaction.raw_data, hex-encoded (no 0x).
       * The signature is ECDSA(secp256k1, sha256(rawDataBytes)) — the byte
       * sequence signed MUST be byte-identical to what gets serialized
       * into the broadcasted Transaction, so it is carried verbatim here.
       */
      rawDataHex: string;
      /** Transaction id = sha256(rawDataBytes), hex (no 0x). Also the explorer hash. */
      txId: string;
      /** Millis epoch after which the node rejects the tx (TAPOS expiry) */
      expiration: number;
    };

/** Signed transaction ready for broadcast */
export interface SignedTransaction {
  raw: unknown;             // chain-specific serialized tx
  signature: string;
}

/** On-chain token metadata resolved from the contract / mint */
export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
}

/** Fee estimate result */
export interface FeeEstimate {
  level: FeeTier;
  gasLimit: string;         // estimated gas units
  gasPrice: string;         // per-unit price in native token (wei/lamports)
  totalFee: string;         // total fee = gasLimit * gasPrice
  totalFeeUsd?: number;
}

/** Transaction record from block explorer */
export interface TransactionRecord {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  tokenDecimals?: number;       // for ERC20/BEP20 tokens; undefined = native
  blockNumber: number;
  blockTimestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  direction: 'sent' | 'received';
  fee?: string;
  /**
   * EVM only: enough of the broadcast payload to REPLACE the transaction —
   * speed-up re-sends it under the same nonce at a higher fee, cancel
   * overwrites that nonce with a self-send. Only locally-tracked pending
   * txs carry it; explorer history does not need it.
   */
  replay?: {
    to: string;
    value: string;
    data?: string;
    nonce: number;
    gasLimit: string;
  };
}

/** Wallet vault encrypted storage format */
export interface VaultData {
  version: number;
  ciphertext: string;       // AES-256-GCM encrypted mnemonic/private keys
  salt: string;             // hex-encoded 16 bytes
  iv: string;               // hex-encoded 12 bytes
  authTag: string;          // hex-encoded 16 bytes (GCM authentication)
  kdf: 'pbkdf2-sha512';
  iterations: number;
}

/** Chain runtime configuration */
export interface ChainConfig {
  chainId: string;          // unique identifier "type-id"
  name: string;
  type: ChainType;
  chainIdDecimal?: number;  // for EVM chains only
  nativeSymbol: string;
  nativeDecimals: number;
  rpcs: string[];           // ordered by priority, with failover
  explorer?: string;        // base explorer URL
  bip44Path: string;        // e.g. "m/44'/60'/0'/0"
  icon?: string;
  testnet?: boolean;
}

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
 * SessionManager — in-memory wallet session lifecycle.
 *
 * Responsibilities:
 *   - Decrypt vault with user password → recover mnemonic
 *   - HD-derive accounts across all supported chains
 *   - Provide private keys on demand (for signing)
 *   - Lock → erase all sensitive data from memory
 *
 * Security rules:
 *   - Never persists mnemonic or private keys — localStorage is forbidden
 *   - Wipes buffers after use where possible
 *   - Auto-lock recommended after 5 min of inactivity (handled by UI layer)
 */

import {
  decryptVault,
  deriveEvmPrivateKey,
  deriveSolanaPrivateKey,
  evmPublicKey,
  solanaPublicKey,
} from '../index.js';
import { chainRegistry } from '../chain/registry.js';
import type { Account, VaultData, ChainConfig } from '@open-wallet/shared';
import { generateId, wipeBytes } from '@open-wallet/shared';

export interface SessionState {
  unlocked: boolean;
  /** Mnemonic stored as UTF-8 bytes so we can wipe it from memory on lock */
  mnemonicBytes: Uint8Array | null;
  accounts: Account[];
  unlockedAt: number | null;          // unix ms
  lastActivityAt: number | null;      // for auto-lock
}

// ─── Module-level in-memory state (never serialized) ──────────────────

let state: SessionState = {
  unlocked: false,
  mnemonicBytes: null,
  accounts: [],
  unlockedAt: null,
  lastActivityAt: null,
};

/** Get a snapshot of the current session state */
export function getSessionState(): Readonly<SessionState> {
  return { ...state, accounts: [...state.accounts] };
}

/** Whether the session is currently unlocked */
export function isUnlocked(): boolean {
  return state.unlocked;
}

/** Touch the last-activity timestamp (call before each signing / balance query) */
export function touchActivity(): void {
  state.lastActivityAt = Date.now();
}

/** Decode UTF-8 bytes back to mnemonic string */
function mnemonicFromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Encode mnemonic string to UTF-8 bytes */
function mnemonicToBytes(mnemonic: string): Uint8Array {
  return new TextEncoder().encode(mnemonic);
}

// ─── Account derivation ───────────────────────────────────────────────

/**
 * Derive one account per registered chain from the mnemonic.
 * Uses each chain's configured BIP44 path + accountIndex.
 */
function deriveAllAccounts(
  mnemonic: string,
  chainConfigs: ChainConfig[],
): Account[] {
  const accounts: Account[] = [];

  for (const config of chainConfigs) {
    const adapter = chainRegistry.get(config.chainId);
    if (!adapter) {
      // Register on the fly if adapter isn't in the registry yet
      // (e.g. custom RPC chains added by user)
      continue;
    }

    const accountIndex = 0; // first account per chain
    // ed25519 (Solana/SLIP-0010) requires ALL-hardened derivation,
    // so accountIndex must also be hardened (e.g. m/44'/501'/0'/0')
    const isEd25519 = config.type === 'solana';
    const derivationPath = isEd25519
      ? `${config.bip44Path}/${accountIndex}'`
      : `${config.bip44Path}/${accountIndex}`;

    let privateKey: Uint8Array;
    let publicKey: Uint8Array;

    if (config.type === 'evm' || config.type === 'tron') {
      // Tron is secp256k1/BIP32 exactly like EVM — only the path (m/44'/195')
      // and the address encoding differ (handled by the chain adapter)
      privateKey = deriveEvmPrivateKey(mnemonic, derivationPath);
      publicKey = evmPublicKey(privateKey);
    } else if (config.type === 'solana') {
      privateKey = deriveSolanaPrivateKey(mnemonic, derivationPath);
      publicKey = solanaPublicKey(privateKey);
    } else {
      continue; // unsupported chain type
    }

    const address = adapter.deriveAddress(publicKey, accountIndex);

    accounts.push({
      id: generateId(),
      chainId: config.chainId,
      address,
      publicKey: publicKey.reduce((s, b) => s + b.toString(16).padStart(2, '0'), ''),
      derivationPath,
      accountIndex,
      nickname: config.name,
      createdAt: Date.now(),
    });

    // Best-effort wipe of the ephemeral privateKey from this scope
    wipeBytes(privateKey);
  }

  return accounts;
}

// ─── Lifecycle ───────────────────────────────────────────────────────

/**
 * Unlock the wallet: decrypt vault → derive accounts → hold in memory.
 * Throws on wrong password or corrupted vault.
 *
 * Stores mnemonic as UTF-8 bytes (not a JS string) so we can wipe it from
 * memory on lock().
 */
export async function unlock(
  vault: VaultData,
  password: string,
  chainConfigs: ChainConfig[],
): Promise<Account[]> {
  const mnemonic = await decryptVault(vault, password);
  const accounts = deriveAllAccounts(mnemonic, chainConfigs);

  const bytes = mnemonicToBytes(mnemonic);

  state = {
    unlocked: true,
    mnemonicBytes: bytes,
    accounts,
    unlockedAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  return accounts;
}

/**
 * Lock the wallet — erase ALL sensitive data from memory.
 *
 * Wipes the mnemonic byte buffer before nulling it out, so the raw
 * passphrase bytes are not left in RAM waiting for GC.
 */
export function lock(): void {
  if (state.mnemonicBytes) {
    wipeBytes(state.mnemonicBytes);
    state.mnemonicBytes = null;
  }
  state.unlocked = false;
  state.accounts = [];
  state.unlockedAt = null;
  state.lastActivityAt = null;
}

// ─── Signing helpers ─────────────────────────────────────────────────

/**
 * Get a transient private key for the given account.
 * The caller is responsible for using it immediately — do NOT store it.
 *
 * Throws if session is locked or account is not found.
 */
export function getPrivateKey(account: Account): Uint8Array {
  if (!state.unlocked || !state.mnemonicBytes) {
    throw new Error('Wallet is locked');
  }

  const mnemonic = mnemonicFromBytes(state.mnemonicBytes);
  const config = chainRegistry.get(account.chainId)?.config;
  if (!config) {
    throw new Error(`No chain config for ${account.chainId}`);
  }

  touchActivity();

  if (config.type === 'evm' || config.type === 'tron') {
    return deriveEvmPrivateKey(mnemonic, account.derivationPath);
  } else if (config.type === 'solana') {
    return deriveSolanaPrivateKey(mnemonic, account.derivationPath);
  }

  throw new Error(`Unsupported chain type: ${config.type}`);
}

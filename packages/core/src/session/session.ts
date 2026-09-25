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
 *   - Decrypt vault with user password → recover the secret envelope
 *     (HD mnemonic OR imported raw private keys)
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
import { decodeVaultSecret, type VaultKeyEntry } from '../vault/secret.js';
import { parsePrivateKey } from '../keys/keyImport.js';
import { chainRegistry } from '../chain/registry.js';
import type { Account, VaultData, ChainConfig } from '@open-wallet/shared';
import { generateId, toHex, wipeBytes } from '@open-wallet/shared';

/** A parsed key held in RAM for key-imported sessions */
interface LiveKey {
  family: VaultKeyEntry['family'];
  privateKey: Uint8Array;
  nickname?: string;
}

export interface SessionState {
  unlocked: boolean;
  /** Mnemonic stored as UTF-8 bytes so we can wipe it from memory on lock */
  mnemonicBytes: Uint8Array | null;
  /** Raw imported keys (private-key wallets); wiped on lock just like phrases */
  keyEntries: LiveKey[] | null;
  accounts: Account[];
  unlockedAt: number | null;          // unix ms
  lastActivityAt: number | null;      // for auto-lock
}

// ─── Module-level in-memory state (never serialized) ──────────────────

let state: SessionState = {
  unlocked: false,
  mnemonicBytes: null,
  keyEntries: null,
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

/** Which key-family a chain config is served by (imported-key lookup) */
function familyForConfigType(type: ChainConfig['type']): VaultKeyEntry['family'] | null {
  if (type === 'evm' || type === 'tron' || type === 'solana') return type;
  return null;
}

/**
 * Build accounts for a private-key-imported vault: every registered chain
 * gets the account its imported family key controls. Multiple keys per
 * family create multiple accounts per chain (MetaMask-style multi-import).
 */
function deriveAccountsFromKeys(
  entries: VaultKeyEntry[],
  chainConfigs: ChainConfig[],
): { accounts: Account[]; live: LiveKey[] } {
  const live: LiveKey[] = entries.map(e => {
    const parsed = parsePrivateKey(e.family, e.privateKey);
    return { family: e.family, privateKey: parsed.privateKey, nickname: e.nickname };
  });

  const accounts: Account[] = [];
  for (const config of chainConfigs) {
    const adapter = chainRegistry.get(config.chainId);
    const family = familyForConfigType(config.type);
    if (!adapter || !family) continue;

    live.forEach((key, idx) => {
      if (key.family !== family) return;
      const publicKey = family === 'solana'
        ? solanaPublicKey(key.privateKey)
        : evmPublicKey(key.privateKey);
      accounts.push({
        id: generateId(),
        chainId: config.chainId,
        address: adapter.deriveAddress(publicKey, idx),
        publicKey: toHex(publicKey),
        derivationPath: 'imported',
        accountIndex: idx,
        nickname: key.nickname ?? `${config.name} (imported)`,
        createdAt: Date.now(),
        source: 'key',
      });
    });
  }
  return { accounts, live };
}

// ─── Lifecycle ───────────────────────────────────────────────────────

/**
 * Unlock the wallet: decrypt vault → parse secret envelope → build accounts
 * → hold secrets in memory. Works for BOTH vault shapes (HD mnemonic and
 * imported private keys) plus legacy bare-mnemonic plaintexts.
 * Throws on wrong password or corrupted vault.
 */
export async function unlock(
  vault: VaultData,
  password: string,
  chainConfigs: ChainConfig[],
): Promise<Account[]> {
  const plaintext = await decryptVault(vault, password);
  const secret = decodeVaultSecret(plaintext);

  if (secret.kind === 'mnemonic') {
    const accounts = deriveAllAccounts(secret.mnemonic, chainConfigs);
    const bytes = mnemonicToBytes(secret.mnemonic);
    state = {
      unlocked: true,
      mnemonicBytes: bytes,
      keyEntries: null,
      accounts,
      unlockedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    return accounts;
  }

  const { accounts, live } = deriveAccountsFromKeys(secret.keys, chainConfigs);
  state = {
    unlocked: true,
    mnemonicBytes: null,
    keyEntries: live,
    accounts,
    unlockedAt: Date.now(),
    lastActivityAt: Date.now(),
  };
  return accounts;
}

/**
 * Lock the wallet — erase ALL sensitive data from memory.
 *
 * Wipes the mnemonic byte buffer AND every live key buffer before nulling
 * them out, so raw secrets are not left in RAM waiting for GC.
 */
export function lock(): void {
  if (state.mnemonicBytes) {
    wipeBytes(state.mnemonicBytes);
    state.mnemonicBytes = null;
  }
  if (state.keyEntries) {
    for (const k of state.keyEntries) wipeBytes(k.privateKey);
    state.keyEntries = null;
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
  if (!state.unlocked) {
    throw new Error('Wallet is locked');
  }

  const config = chainRegistry.get(account.chainId)?.config;
  if (!config) {
    throw new Error(`No chain config for ${account.chainId}`);
  }

  touchActivity();

  // Imported-key session: hand out a COPY of the stored key (caller wipes)
  if (state.keyEntries) {
    const family = familyForConfigType(config.type);
    const matches = state.keyEntries.filter(k => k.family === family);
    const key = matches[account.source === 'key' ? account.accountIndex : 0];
    if (!key) {
      throw new Error(`No imported key for ${account.chainId}`);
    }
    return key.privateKey.slice();
  }

  if (!state.mnemonicBytes) {
    throw new Error('Wallet is locked');
  }
  const mnemonic = mnemonicFromBytes(state.mnemonicBytes);

  if (config.type === 'evm' || config.type === 'tron') {
    return deriveEvmPrivateKey(mnemonic, account.derivationPath);
  } else if (config.type === 'solana') {
    return deriveSolanaPrivateKey(mnemonic, account.derivationPath);
  }

  throw new Error(`Unsupported chain type: ${config.type}`);
}

// ─── Export helpers (password-gated reveals) ───────────────────

/**
 * Reveal the recovery phrase. Requires the password AGAIN — an unlocked
 * session alone is not enough (shoulder-surfing / XSS while unlocked).
 * Throws for private-key-imported wallets: they have no phrase to show.
 */
export async function revealRecoveryPhrase(
  vault: VaultData,
  password: string,
): Promise<string> {
  const secret = decodeVaultSecret(await decryptVault(vault, password));
  if (secret.kind !== 'mnemonic') {
    throw new Error('This wallet was imported from private keys — it has no recovery phrase');
  }
  return secret.mnemonic;
}

/**
 * Export one account's private key in its canonical wallet format
 * (0x-hex for EVM/TRON, base58 64-byte secret for Solana).
 * Password re-verification like phrase reveal.
 */
export async function exportAccountPrivateKey(
  account: Account,
  vault: VaultData,
  password: string,
): Promise<string> {
  const config = chainRegistry.get(account.chainId)?.config;
  if (!config) {
    throw new Error(`No chain config for ${account.chainId}`);
  }
  const secret = decodeVaultSecret(await decryptVault(vault, password));

  let bytes: Uint8Array;
  if (secret.kind === 'keys') {
    const family = familyForConfigType(config.type);
    const matches = secret.keys.filter(k => k.family === family);
    const entry = matches[account.source === 'key' ? account.accountIndex : 0] ?? matches[0];
    if (!entry) {
      throw new Error(`No imported key covers ${account.chainId}`);
    }
    bytes = parsePrivateKey(entry.family, entry.privateKey).privateKey;
  } else {
    bytes = config.type === 'solana'
      ? deriveSolanaPrivateKey(secret.mnemonic, account.derivationPath)
      : deriveEvmPrivateKey(secret.mnemonic, account.derivationPath);
  }

  if (config.type === 'solana') {
    // Solana wallets (Phantom/Solflare) export the base58 64-byte secret
    const { base58Encode } = await import('../keys/keyImport.js');
    return base58Encode(bytes);
  }
  return '0x' + toHex(bytes);
}

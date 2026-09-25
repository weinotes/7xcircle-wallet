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
 * WalletConnect v2 SignClient lifecycle for React Native.
 *
 * Import order below IS load-bearing: the RN compat package patches
 * crypto/websocket/globalThis BEFORE sign-client's module init, and
 * react-native-get-random-values must land before even that.
 *
 * The client is a singleton: pairing state lives in AsyncStorage, the
 * client identity key in SecureStore — both survive app restarts, so a
 * dApp session stays valid until it is explicitly disconnected.
 */

import 'react-native-get-random-values';
import '@walletconnect/react-native-compat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SignClient } from '@walletconnect/sign-client';

import { WALLET_METADATA, WC_PROJECT_ID } from '../config';

/** The initialised client instance type, inferred from the factory */
export type WcClient = Awaited<ReturnType<typeof SignClient.init>>;

/**
 * WC 2.25 expects getKeys/getEntries on top of AsyncStorage's surface —
 * a two-method shim rather than a second storage dependency.
 */
const wcStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
  getKeys: async () => (await AsyncStorage.getAllKeys()) as string[],
  getEntries: async () => {
    const keys = (await AsyncStorage.getAllKeys()) as string[];
    const pairs = await AsyncStorage.multiGet(keys);
    return pairs.map(([key, value]) => ({ key: key ?? '', value: value ?? '' }));
  },
};

/** One client per app process; created lazily on first dApp interaction */
let clientPromise: Promise<WcClient> | null = null;

export function wcConfigured(): boolean {
  return WC_PROJECT_ID.length > 0;
}

export async function getSignClient(): Promise<WcClient> {
  if (!wcConfigured()) {
    throw new Error(
      'WalletConnect is not configured yet — set EXPO_PUBLIC_WC_PROJECT_ID (free at cloud.reown.com) and rebuild.',
    );
  }
  if (!clientPromise) {
    clientPromise = (async () => SignClient.init({
      projectId: WC_PROJECT_ID,
      metadata: WALLET_METADATA,
      // pairing state + the client identity key both persist in AsyncStorage
      storage: wcStorage as never,
    }))().catch(err => {
      // never cache a failed init — next attempt can succeed
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/** Tear the cached client down on wallet lock (relay sockets closed) */
export async function disposeSignClient(): Promise<void> {
  const pending = clientPromise;
  clientPromise = null;
  if (!pending) return;
  try {
    const client = await pending;
    await client.core.relayer.transportClose();
  } catch {
    // best effort — a dead socket is fine after lock
  }
}

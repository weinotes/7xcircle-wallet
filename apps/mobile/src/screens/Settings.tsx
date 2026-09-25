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
 * Settings tab — security, biometrics, lock and the update check.
 *
 * Online upgrade follows the open-source mobile convention: compare the
 * bundled version against the GitHub Releases latest tag and point the
 * user at the release page. No silent APK sideloading, no self-update
 * attack surface — the binary always comes from store/release provenance.
 */

import { useState } from 'react';
import { Linking, ScrollView, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { decryptVault } from '@7xcircle/core';
import type { VaultData } from '@7xcircle/shared';
import { Button } from '../components';
import { UPDATE_REPO } from '../config';
import { isNewer } from '../update';
import {
  clearBiometricCache,
  savePasswordForBiometrics,
  type BiometricStatus,
} from '../biometric';
import { styles } from '../theme';

/** "0.1.0" vs "v0.2.0" compare lives in ../update so it is unit-testable */

export function Settings({
  vault,
  bioStatus,
  bioEnabled,
  onBioChanged,
  onLock,
}: {
  vault: VaultData | null;
  bioStatus: BiometricStatus | null;
  bioEnabled: boolean;
  onBioChanged: (enabled: boolean) => void;
  onLock: () => void;
}) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen}>
      <Text style={styles.heading}>Settings</Text>
      <Biometric vault={vault} bioStatus={bioStatus} bioEnabled={bioEnabled} onBioChanged={onBioChanged} />
      <Updates />
      <View style={styles.card}>
        <Text style={styles.section}>Session</Text>
        <Text style={styles.status}>Locking wipes every key from memory; the encrypted vault stays on this device only.</Text>
        <Button label="Lock wallet" onPress={onLock} danger />
      </View>
    </ScrollView>
  );
}

/**
 * Biometric toggle. Enabling requires re-entering the password (proves
 * knowledge NOW; the cached copy behind the Keystore gate was never touched
 * by a merely-unlocked session). Disabling just wipes the cache — the
 * password path remains, so funds can never be locked out by this setting.
 */
function Biometric({
  vault,
  bioStatus,
  bioEnabled,
  onBioChanged,
}: {
  vault: VaultData | null;
  bioStatus: BiometricStatus | null;
  bioEnabled: boolean;
  onBioChanged: (enabled: boolean) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [pwd, setPwd] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const enable = async () => {
    if (!vault) return;
    setSaving(true);
    setMsg('');
    try {
      // verify knowledge of the password against the real vault — pure
      // decrypt check, no session side effects
      await decryptVault(vault, pwd);
      await savePasswordForBiometrics(pwd);
      setPwd('');
      onBioChanged(true);
      setShowForm(false);
      setMsg('Biometric unlock enabled.');
    } catch (cause) {
      setMsg(cause instanceof Error ? `Failed: ${cause.message}` : 'Failed to enable.');
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    await clearBiometricCache().catch(() => undefined);
    onBioChanged(false);
    setMsg('Biometric unlock disabled — password unlock still available.');
  };

  return (
    <View style={styles.card}>
      <Text style={styles.section}>Biometric unlock</Text>
      <Text style={styles.status}>
        {bioEnabled ? 'On — fingerprint / face unlocks the wallet.'
          : bioStatus && !bioStatus.usable ? bioStatus.reason
          : 'Off. The password stays the master door; biometrics only speed up unlocking.'}
      </Text>
      {bioEnabled
        ? <Button label="Turn off biometrics" onPress={disable} secondary />
        : bioStatus?.usable && <Button label="Turn on biometrics" onPress={() => setShowForm(v => !v)} secondary />}
      {showForm && <>
        <TextInput secureTextEntry value={pwd} onChangeText={setPwd} placeholder="Current password to confirm" placeholderTextColor="#78818f" style={styles.input} />
        <Button label={saving ? 'Saving…' : 'Confirm and enable'} onPress={enable} disabled={saving || pwd.length === 0} />
      </>}
      {msg ? <Text style={styles.status}>{msg}</Text> : null}
    </View>
  );
}

/** In-app update check against the public GitHub release feed */
function Updates() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'update' | 'error'>('idle');
  const [latest, setLatest] = useState('');
  const current = Constants.expoConfig?.version ?? '0.0.0';

  const check = async () => {
    setState('checking');
    try {
      const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { tag_name?: string; html_url?: string };
      const tag = json.tag_name ?? '';
      if (tag && isNewer(tag, current)) {
        setLatest(tag);
        setState('update');
      } else {
        setState('latest');
      }
    } catch {
      setState('error');
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.section}>About & updates</Text>
      <Text style={styles.status}>Version {current} · open source (Apache-2.0)</Text>
      <Button label={state === 'checking' ? 'Checking…' : 'Check for updates'} onPress={check} secondary disabled={state === 'checking'} />
      {state === 'latest' && <Text style={styles.status}>You are on the latest release.</Text>}
      {state === 'error' && <Text style={styles.warning}>Update check failed — check connectivity.</Text>}
      {state === 'update' && (
        <>
          <Text style={styles.warning}>A new version ({latest}) is available.</Text>
          <Button
            label="Open release page"
            onPress={() => Linking.openURL(`https://github.com/${UPDATE_REPO}/releases/latest`)}
          />
        </>
      )}
    </View>
  );
}

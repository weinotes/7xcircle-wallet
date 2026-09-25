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
 * 7xCircle Wallet — Android client shell.
 *
 * Mainstream-wallet layout: locked/unlocked gate on top, and once unlocked
 * a bottom tab bar (Assets · Swap · dApps · Settings) in the MetaMask
 * Mobile / TokenPocket / OneKey tradition. Every tab renders the SAME
 * session accounts and the SAME send pipeline — no chain branching in UI.
 */
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { registerAllChains } from '@7xcircle/chains';
import {
  createMnemonic,
  encodeVaultSecret,
  encryptVault,
  evaluatePassword,
  isValidMnemonic,
  unlock as unlockSession,
  lock as lockSession,
} from '@7xcircle/core';
import type { Account, VaultData } from '@7xcircle/shared';
import { PRODUCTION_CHAINS } from './src/chains';
import { Button, Centered } from './src/components';
import { colors, styles as ui } from './src/theme';
import {
  inspectBiometrics,
  isBiometricEnabled,
  loadCachedPassword,
  savePasswordForBiometrics,
  type BiometricStatus,
} from './src/biometric';
import { Home } from './src/screens/Home';
import { Swap } from './src/screens/Swap';
import { Earn } from './src/screens/Earn';
import { Dapps } from './src/screens/Dapps';
import { Settings } from './src/screens/Settings';
import { VAULT_KEY, migrateLegacyKeys } from './src/migrateKeys';

type Screen = 'loading' | 'welcome' | 'create' | 'import' | 'password' | 'wallet';
type Tab = 'home' | 'swap' | 'earn' | 'dapps' | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'home', label: 'Assets', icon: '💼' },
  { id: 'swap', label: 'Swap', icon: '⇄' },
  { id: 'earn', label: 'Earn', icon: '💰' },
  { id: 'dapps', label: 'dApps', icon: '🌐' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [tab, setTab] = useState<Tab>('home');
  const [vault, setVault] = useState<VaultData | null>(null);
  const [mnemonic, setMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bioStatus, setBioStatus] = useState<BiometricStatus | null>(null);
  const [bioEnabled, setBioEnabled] = useState(false);

  useEffect(() => {
    registerAllChains();
    // One-time rename from the pre-rebrand SecureStore keys; if the vault
    // somehow still sits under the legacy name, read it from there instead
    // of showing the onboarding over an existing wallet.
    void migrateLegacyKeys()
      .then(() => SecureStore.getItemAsync(VAULT_KEY))
      .then(raw => raw ?? SecureStore.getItemAsync('open-wallet-mobile-vault'))
      .then(raw => {
      if (raw) {
        setVault(JSON.parse(raw) as VaultData);
        setScreen('welcome');
      } else {
        setScreen('welcome');
      }
    }).catch(() => setError('Unable to load the local wallet vault.'));
    inspectBiometrics().then(setBioStatus).catch(() => setBioStatus({ usable: false, reason: 'Biometric check failed.' }));
    isBiometricEnabled().then(setBioEnabled).catch(() => setBioEnabled(false));
  }, []);

  const startCreate = () => {
    setMnemonic(createMnemonic());
    setError('');
    setScreen('create');
  };

  const startImport = () => {
    setMnemonic('');
    setError('');
    setScreen('import');
  };

  const continueImport = () => {
    if (!isValidMnemonic(mnemonic.trim())) {
      setError('Enter a valid BIP39 recovery phrase.');
      return;
    }
    setMnemonic(mnemonic.trim());
    setScreen('password');
  };

  const continueCreate = () => setScreen('password');

  const saveAndUnlock = async () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    const strength = evaluatePassword(password);
    if (strength.score < 2) {
      setError(strength.errors[0] ?? 'Choose a stronger password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextVault = await encryptVault(encodeVaultSecret({ kind: 'mnemonic', mnemonic }), password);
      await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(nextVault));
      if (bioEnabled) {
        await savePasswordForBiometrics(password).catch(() => undefined);
      }
      const nextAccounts = await unlockSession(nextVault, password, PRODUCTION_CHAINS);
      setVault(nextVault);
      setAccounts(nextAccounts);
      setPassword('');
      setConfirmPassword('');
      setScreen('wallet');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the wallet.');
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!vault) return;
    setBusy(true);
    setError('');
    try {
      setAccounts(await unlockSession(vault, password, PRODUCTION_CHAINS));
      // keep the biometric-cached password fresh on every password unlock —
      // silently no-ops unless the user enabled biometrics
      if (bioEnabled) {
        await savePasswordForBiometrics(password).catch(() => undefined);
      }
      setPassword('');
      setScreen('wallet');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Incorrect password.');
    } finally {
      setBusy(false);
    }
  };

  /** Keystore-gated read of the cached password; failure → password form */
  const unlockWithBiometric = async () => {
    if (!vault) return;
    setBusy(true);
    setError('');
    try {
      const cached = await loadCachedPassword();
      if (!cached) {
        setError('Biometric unlock unavailable — use your password.');
        return;
      }
      setAccounts(await unlockSession(vault, cached, PRODUCTION_CHAINS));
      setScreen('wallet');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  const lock = () => {
    lockSession();
    setAccounts([]);
    setTab('home');
    setScreen('welcome');
  };

  if (screen === 'loading') {
    return <Centered><ActivityIndicator color={colors.accent} /></Centered>;
  }

  return (
    <SafeAreaView style={ui.safe}>
      <StatusBar style="light" />
      {screen === 'wallet' ? (
        <View style={tabShell.shell}>
          <View style={{ flex: 1 }}>
            {tab === 'home' && <Home accounts={accounts} />}
            {tab === 'swap' && <Swap accounts={accounts} />}
            {tab === 'earn' && <Earn accounts={accounts} />}
            {tab === 'dapps' && <Dapps accounts={accounts} locked={false} />}
            {tab === 'settings' && (
              <Settings vault={vault} bioStatus={bioStatus} bioEnabled={bioEnabled} onBioChanged={setBioEnabled} onLock={lock} />
            )}
          </View>
          <View style={ui.tabBar}>
            {TABS.map(item => {
              const active = tab === item.id;
              return (
                <Pressable key={item.id} style={ui.tabItem} onPress={() => setTab(item.id)}>
                  <Text style={ui.tabIcon}>{item.icon}</Text>
                  <Text style={[ui.tabLabel, active && ui.tabLabelActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={ui.container} keyboardShouldPersistTaps="handled">
          <Text style={ui.title}>7xCircle Wallet</Text>
          <Text style={ui.subtitle}>Your keys. Your coins.</Text>
          {screen === 'welcome' && <Welcome hasVault={Boolean(vault)} bioOffer={bioEnabled && Boolean(vault) && Boolean(bioStatus?.usable)} onCreate={startCreate} onImport={startImport} onUnlock={() => setScreen('password')} onUnlockBiometric={unlockWithBiometric} />}
          {screen === 'create' && <Recovery mnemonic={mnemonic} onContinue={continueCreate} onBack={() => setScreen('welcome')} />}
          {screen === 'import' && <MnemonicInput value={mnemonic} onChange={setMnemonic} onContinue={continueImport} onBack={() => setScreen('welcome')} />}
          {screen === 'password' && <PasswordForm hasVault={Boolean(vault)} password={password} confirmPassword={confirmPassword} onPassword={setPassword} onConfirm={setConfirmPassword} onSubmit={vault ? unlock : saveAndUnlock} onBack={() => setScreen('welcome')} busy={busy} />}
          {error ? <Text style={ui.error}>{error}</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Welcome({ hasVault, bioOffer, onCreate, onImport, onUnlock, onUnlockBiometric }: { hasVault: boolean; bioOffer: boolean; onCreate: () => void; onImport: () => void; onUnlock: () => void; onUnlockBiometric: () => void }) {
  return <View style={ui.card}>
    <Text style={ui.heading}>{hasVault ? 'Wallet locked' : 'Create your wallet'}</Text>
    <Text style={ui.body}>The encrypted vault stays on this device. The recovery phrase is never uploaded.</Text>
    {hasVault ? <>
      {bioOffer && <Button label="Unlock with fingerprint / face" onPress={onUnlockBiometric} />}
      <Button label={bioOffer ? 'Use password instead' : 'Unlock wallet'} onPress={onUnlock} secondary={!bioOffer} />
    </> : <Button label="Create new wallet" onPress={onCreate} />}
    <Button label="Import recovery phrase" onPress={onImport} secondary />
  </View>;
}

function Recovery({ mnemonic, onContinue, onBack }: { mnemonic: string; onContinue: () => void; onBack: () => void }) {
  return <View style={ui.card}>
    <Text style={ui.heading}>Write down your recovery phrase</Text>
    <Text style={ui.warning}>Never share these words. Anyone with them can spend your funds.</Text>
    <Text style={ui.mnemonic}>{mnemonic}</Text>
    <Button label="I saved it" onPress={onContinue} /><Button label="Back" onPress={onBack} secondary />
  </View>;
}

function MnemonicInput({ value, onChange, onContinue, onBack }: { value: string; onChange: (value: string) => void; onContinue: () => void; onBack: () => void }) {
  return <View style={ui.card}>
    <Text style={ui.heading}>Import wallet</Text>
    <TextInput multiline autoCapitalize="none" value={value} onChangeText={onChange} placeholder="12 or 24 recovery words" placeholderTextColor="#78818f" style={[ui.input, ui.multiline]} />
    <Button label="Continue" onPress={onContinue} /><Button label="Back" onPress={onBack} secondary />
  </View>;
}

function PasswordForm({ hasVault, password, confirmPassword, onPassword, onConfirm, onSubmit, onBack, busy }: { hasVault: boolean; password: string; confirmPassword: string; onPassword: (value: string) => void; onConfirm: (value: string) => void; onSubmit: () => void; onBack: () => void; busy: boolean }) {
  return <View style={ui.card}>
    <Text style={ui.heading}>{hasVault ? 'Unlock wallet' : 'Protect your wallet'}</Text>
    <TextInput secureTextEntry value={password} onChangeText={onPassword} placeholder="Password" placeholderTextColor="#78818f" style={ui.input} />
    {!hasVault && <TextInput secureTextEntry value={confirmPassword} onChangeText={onConfirm} placeholder="Confirm password" placeholderTextColor="#78818f" style={ui.input} />}
    <Button label={busy ? 'Working…' : hasVault ? 'Unlock' : 'Create wallet'} onPress={onSubmit} disabled={busy} />
    <Button label="Back" onPress={onBack} secondary />
  </View>;
}

const tabShell = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
});

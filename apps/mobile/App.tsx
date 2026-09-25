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
 * 7xCircle Wallet — Android client.
 *
 * Multi-chain surface on the shared core: TRON (TRX + USDT-TRC20), BNB,
 * Solana and Ethereum lead the switcher, every other production EVM chain
 * follows. Chain differences stay inside the adapters; this file only
 * renders what they return. Testnet configs are deliberately excluded
 * from derivation so test assets can never appear next to real funds.
 */
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { registerAllChains } from '@open-wallet/chains';
import { chainRegistry } from '@open-wallet/core';
import {
  createMnemonic,
  decryptVault,
  encryptVault,
  evaluatePassword,
  isValidMnemonic,
  unlock as unlockSession,
  lock as lockSession,
} from '@open-wallet/core';
import { formatBalance } from '@open-wallet/shared';
import type { Account, TokenBalance, VaultData } from '@open-wallet/shared';
import { PRODUCTION_CHAINS, orderedChains } from './src/chains';
import { sendTx } from './src/tx';
import {
  inspectBiometrics,
  isBiometricEnabled,
  loadCachedPassword,
  savePasswordForBiometrics,
  clearBiometricCache,
  type BiometricStatus,
} from './src/biometric';

const VAULT_KEY = 'open-wallet-mobile-vault';

type Screen = 'loading' | 'welcome' | 'create' | 'import' | 'password' | 'wallet';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
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
    SecureStore.getItemAsync(VAULT_KEY).then(raw => {
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
      const nextVault = await encryptVault(mnemonic, password);
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
    setScreen('welcome');
  };

  if (screen === 'loading') {
    return <Centered><ActivityIndicator color="#78a9ff" /></Centered>;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>7xCircle Wallet</Text>
        <Text style={styles.subtitle}>Your keys. Your coins.</Text>
        {screen === 'welcome' && <Welcome hasVault={Boolean(vault)} bioOffer={bioEnabled && Boolean(vault) && Boolean(bioStatus?.usable)} onCreate={startCreate} onImport={startImport} onUnlock={() => setScreen('password')} onUnlockBiometric={unlockWithBiometric} />}
        {screen === 'create' && <Recovery mnemonic={mnemonic} onContinue={continueCreate} onBack={() => setScreen('welcome')} />}
        {screen === 'import' && <MnemonicInput value={mnemonic} onChange={setMnemonic} onContinue={continueImport} onBack={() => setScreen('welcome')} />}
        {screen === 'password' && <PasswordForm hasVault={Boolean(vault)} password={password} confirmPassword={confirmPassword} onPassword={setPassword} onConfirm={setConfirmPassword} onSubmit={vault ? unlock : saveAndUnlock} onBack={() => setScreen('welcome')} busy={busy} />}
        {screen === 'wallet' && <Wallet accounts={accounts} onLock={lock} vault={vault} bioStatus={bioStatus} bioEnabled={bioEnabled} onBioChanged={(enabled) => setBioEnabled(enabled)} />}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Welcome({ hasVault, bioOffer, onCreate, onImport, onUnlock, onUnlockBiometric }: { hasVault: boolean; bioOffer: boolean; onCreate: () => void; onImport: () => void; onUnlock: () => void; onUnlockBiometric: () => void }) {
  return <View style={styles.card}>
    <Text style={styles.heading}>{hasVault ? 'Wallet locked' : 'Create your wallet'}</Text>
    <Text style={styles.body}>The encrypted vault stays on this device. The recovery phrase is never uploaded.</Text>
    {hasVault ? <>
      {bioOffer && <Button label="Unlock with fingerprint / face" onPress={onUnlockBiometric} />}
      <Button label={bioOffer ? 'Use password instead' : 'Unlock wallet'} onPress={onUnlock} secondary={!bioOffer} />
    </> : <Button label="Create new wallet" onPress={onCreate} />}
    <Button label="Import recovery phrase" onPress={onImport} secondary />
  </View>;
}

function Recovery({ mnemonic, onContinue, onBack }: { mnemonic: string; onContinue: () => void; onBack: () => void }) {
  return <View style={styles.card}>
    <Text style={styles.heading}>Write down your recovery phrase</Text>
    <Text style={styles.warning}>Never share these words. Anyone with them can spend your funds.</Text>
    <Text style={styles.mnemonic}>{mnemonic}</Text>
    <Button label="I saved it" onPress={onContinue} /><Button label="Back" onPress={onBack} secondary />
  </View>;
}

function MnemonicInput({ value, onChange, onContinue, onBack }: { value: string; onChange: (value: string) => void; onContinue: () => void; onBack: () => void }) {
  return <View style={styles.card}>
    <Text style={styles.heading}>Import wallet</Text>
    <TextInput multiline autoCapitalize="none" value={value} onChangeText={onChange} placeholder="12 or 24 recovery words" placeholderTextColor="#78818f" style={[styles.input, styles.multiline]} />
    <Button label="Continue" onPress={onContinue} /><Button label="Back" onPress={onBack} secondary />
  </View>;
}

function PasswordForm({ hasVault, password, confirmPassword, onPassword, onConfirm, onSubmit, onBack, busy }: { hasVault: boolean; password: string; confirmPassword: string; onPassword: (value: string) => void; onConfirm: (value: string) => void; onSubmit: () => void; onBack: () => void; busy: boolean }) {
  return <View style={styles.card}>
    <Text style={styles.heading}>{hasVault ? 'Unlock wallet' : 'Protect your wallet'}</Text>
    <TextInput secureTextEntry value={password} onChangeText={onPassword} placeholder="Password" placeholderTextColor="#78818f" style={styles.input} />
    {!hasVault && <TextInput secureTextEntry value={confirmPassword} onChangeText={onConfirm} placeholder="Confirm password" placeholderTextColor="#78818f" style={styles.input} />}
    <Button label={busy ? 'Working…' : hasVault ? 'Unlock' : 'Create wallet'} onPress={onSubmit} disabled={busy} />
    <Button label="Back" onPress={onBack} secondary />
  </View>;
}

/** Multi-chain wallet: chain switcher → assets → send, same session accounts */
function Wallet({ accounts, onLock, vault, bioStatus, bioEnabled, onBioChanged }: { accounts: Account[]; onLock: () => void; vault: VaultData | null; bioStatus: BiometricStatus | null; bioEnabled: boolean; onBioChanged: (enabled: boolean) => void }) {
  const chains = orderedChains();
  const [activeChainId, setActiveChainId] = useState(
    () => chains.find(c => accounts.some(a => a.chainId === c.chainId))?.chainId ?? chains[0]?.chainId ?? '',
  );
  const account = accounts.find(a => a.chainId === activeChainId);
  const adapter = chainRegistry.get(activeChainId);
  const chainCfg = chains.find(c => c.chainId === activeChainId);

  return <View style={styles.card}>
    <Text style={styles.heading}>Assets</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
      {chains.map(chain => {
        const active = chain.chainId === activeChainId;
        return <Pressable key={chain.chainId} onPress={() => setActiveChainId(chain.chainId)} style={[styles.chip, active && styles.chipActive]}>
          <Text style={[styles.chipText, active && styles.chipTextActive]}>
            {chain.nativeSymbol} · {chain.name === 'BNB Chain' ? 'BNB' : chain.name === 'TRON' ? 'TRON' : chain.name === 'Avalanche C-Chain' ? 'AVAX' : chain.name}
          </Text>
        </Pressable>;
      })}
    </ScrollView>
    {!account && <Text style={styles.body}>This wallet has no account on {chainCfg?.name ?? activeChainId}.</Text>}
    {account && adapter && chainCfg && (
      <ChainAssets account={account} chainId={activeChainId} nativeSymbol={chainCfg.nativeSymbol} />
    )}
    {account && adapter && chainCfg && (
      <SendForm account={account} chainId={activeChainId} nativeSymbol={chainCfg.nativeSymbol} />
    )}
    <Security vault={vault} bioStatus={bioStatus} bioEnabled={bioEnabled} onBioChanged={onBioChanged} />
    <Button label="Lock wallet" onPress={onLock} secondary />
  </View>;
}

/** Token list for one chain: native + whatever the adapter discovers */
function ChainAssets({ account, chainId, nativeSymbol }: { account: Account; chainId: string; nativeSymbol: string }) {
  const [tokens, setTokens] = useState<TokenBalance[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const adapter = chainRegistry.get(chainId);
    if (!adapter) return;
    let cancelled = false;
    setTokens(null);
    setFailed(false);
    adapter.getAllTokenBalances(account.address)
      .then(list => { if (!cancelled) setTokens(list); })
      .catch(() => { if (!cancelled) { setFailed(true); setTokens(null); } });
    return () => { cancelled = true; };
  }, [account.address, chainId]);

  return <View>
    <Text style={styles.address}>{account.address}</Text>
    {tokens === null && !failed && <Text style={styles.status}>Loading balances…</Text>}
    {failed && <Text style={styles.status}>Balance lookup failed — check connectivity.</Text>}
    {tokens?.map(token => {
      const raw = token.balance || '0';
      const zero = BigInt(raw) === 0n;
      return <View key={`${token.chainId}-${token.address}`} style={styles.assetRow}>
        <Text style={[styles.assetSymbol, zero && styles.assetZero]}>{token.symbol}</Text>
        <Text style={[styles.assetBalance, zero && styles.assetZero]}>
          {formatBalance(raw, token.decimals, 4)}
        </Text>
      </View>;
    })}
  </View>;
}

/**
 * Send form for the selected chain: native or any discovered/entered token.
 * Address validation and intent compilation live entirely in the adapter —
 * TRON base58, Solana base58 and EVM 0x all take this same code path.
 */
function SendForm({ account, chainId, nativeSymbol }: { account: Account; chainId: string; nativeSymbol: string }) {
  const adapter = chainRegistry.get(chainId);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  const send = async () => {
    if (!adapter) return;
    if (!adapter.validateAddress(to.trim())) {
      setStatus(`Enter a valid ${nativeSymbol} address.`);
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setStatus('Enter a valid amount.');
      return;
    }
    setSending(true);
    setStatus('');
    try {
      const intent = tokenAddress.trim()
        ? await buildTokenIntent(tokenAddress.trim())
        : {
            kind: 'native-transfer' as const,
            to: to.trim(),
            amountRaw: adapter.parseAmount(amount),
          };
      if (!intent) return;
      const hash = await sendTx({ adapter, account, intent });
      setStatus(`Sent: ${hash.slice(0, 14)}…`);
      setTo('');
      setAmount('');
      setTokenAddress('');
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Transaction failed.');
    } finally {
      setSending(false);
    }
  };

  /** Resolve token decimals from the contract before building the intent */
  const buildTokenIntent = async (contract: string) => {
    if (!adapter) return null;
    try {
      const info = await adapter.getTokenInfo(contract);
      return {
        kind: 'token-transfer' as const,
        token: contract,
        decimals: info.decimals,
        to: to.trim(),
        amountRaw: adapter.parseTokenAmount(amount, info.decimals),
      };
    } catch {
      setStatus('That token contract did not answer — check the address.');
      return null;
    }
  };

  return <View>
    <Text style={styles.section}>Send on {chainId}</Text>
    <TextInput autoCapitalize="none" value={to} onChangeText={setTo} placeholder="Recipient address" placeholderTextColor="#78818f" style={styles.input} />
    <TextInput keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder={`Amount (${nativeSymbol} if native)`} placeholderTextColor="#78818f" style={styles.input} />
    <TextInput autoCapitalize="none" value={tokenAddress} onChangeText={setTokenAddress} placeholder="Token contract / mint (optional — empty sends native)" placeholderTextColor="#78818f" style={styles.input} />
    <Button label={sending ? 'Sending…' : 'Send'} onPress={send} disabled={sending} />
    {status ? <Text style={styles.status}>{status}</Text> : null}
  </View>;
}

/**
 * Biometric toggle. Enabling requires re-entering the password (proves
 * knowledge NOW; the cached copy behind the Keystore gate was never touched
 * by a merely-unlocked session). Disabling just wipes the cache — the
 * password path remains, so funds can never be locked out by this setting.
 */
function Security({ vault, bioStatus, bioEnabled, onBioChanged }: { vault: VaultData | null; bioStatus: BiometricStatus | null; bioEnabled: boolean; onBioChanged: (enabled: boolean) => void }) {
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
      wipeField(pwd, setPwd);
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

  return <View style={styles.account}>
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
  </View>;
}

/** RN TextInput state wipe helper (strings are immutable; best effort) */
function wipeField(_value: string, setter: (v: string) => void): void {
  setter('');
}

function Button({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text></Pressable>;
}

function Centered({ children }: { children: ReactElement }) {
  return <SafeAreaView style={[styles.safe, styles.center]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#101114' },
  center: { justifyContent: 'center', alignItems: 'center' },
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  title: { color: '#f5f7fa', fontSize: 32, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#9ca8b8', fontSize: 16, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  card: { backgroundColor: '#1a1d23', borderColor: '#303641', borderWidth: 1, borderRadius: 18, padding: 20, gap: 14 },
  heading: { color: '#f5f7fa', fontSize: 22, fontWeight: '700' },
  body: { color: '#b4bfcd', fontSize: 15, lineHeight: 22 },
  warning: { color: '#f2b97f', fontSize: 14, lineHeight: 20 },
  mnemonic: { color: '#f5f7fa', backgroundColor: '#252a33', borderRadius: 10, padding: 16, lineHeight: 26, fontSize: 16 },
  input: { color: '#f5f7fa', backgroundColor: '#252a33', borderColor: '#424b59', borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 16 },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  button: { backgroundColor: '#78a9ff', borderRadius: 10, padding: 15, alignItems: 'center', marginTop: 2 },
  secondaryButton: { backgroundColor: 'transparent', borderColor: '#536071', borderWidth: 1 },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#101114', fontSize: 16, fontWeight: '700' },
  secondaryText: { color: '#d8e0eb' },
  error: { color: '#ff8f8f', textAlign: 'center', marginTop: 16 },
  account: { backgroundColor: '#252a33', borderRadius: 10, padding: 14, gap: 6 },
  accountName: { color: '#f5f7fa', fontWeight: '700' },
  address: { color: '#aeb9c8', fontSize: 12 },
  balance: { color: '#78a9ff', fontSize: 24, fontWeight: '700' },
  section: { color: '#f5f7fa', fontSize: 16, fontWeight: '700', marginTop: 8 },
  status: { color: '#b4bfcd', fontSize: 13, lineHeight: 18 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { backgroundColor: '#252a33', borderColor: '#424b59', borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { backgroundColor: '#78a9ff', borderColor: '#78a9ff' },
  chipText: { color: '#d8e0eb', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#101114' },
  assetRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#303641' },
  assetSymbol: { color: '#f5f7fa', fontWeight: '700' },
  assetBalance: { color: '#78a9ff', fontWeight: '600' },
  assetZero: { opacity: 0.4 },
});

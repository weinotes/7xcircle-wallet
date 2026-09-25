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
 * Home tab — chain switcher, token balances and sends.
 *
 * Layout follows the MetaMask-Mobile / TokenPocket pattern: portfolio
 * header card, horizontal chain chips, asset list, prominent Send block.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { chainRegistry } from '@open-wallet/core';
import type { Account, TokenBalance } from '@open-wallet/shared';
import { formatBalance } from '@open-wallet/shared';
import { Button, shorten } from '../components';
import { orderedChains } from '../chains';
import { sendTx } from '../tx';
import { styles } from '../theme';

export function Home({ accounts }: { accounts: Account[] }) {
  const chains = orderedChains();
  const [activeChainId, setActiveChainId] = useState(
    () => chains.find(c => accounts.some(a => a.chainId === c.chainId))?.chainId ?? chains[0]?.chainId ?? '',
  );
  const account = accounts.find(a => a.chainId === activeChainId);
  const adapter = chainRegistry.get(activeChainId);
  const chainCfg = chains.find(c => c.chainId === activeChainId);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Wallet</Text>
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
    </ScrollView>
  );
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

  return <View style={styles.card}>
    <Text style={styles.accountName}>{nativeSymbol} account</Text>
    <Text style={styles.address}>{shorten(account.address, 14, 10)}</Text>
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
      setStatus(`Sent: ${shorten(hash, 12, 8)}`);
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

  return <View style={styles.card}>
    <Text style={styles.section}>Send on {chainId}</Text>
    <TextInput autoCapitalize="none" value={to} onChangeText={setTo} placeholder="Recipient address" placeholderTextColor="#78818f" style={styles.input} />
    <TextInput keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder={`Amount (${nativeSymbol} if native)`} placeholderTextColor="#78818f" style={styles.input} />
    <TextInput autoCapitalize="none" value={tokenAddress} onChangeText={setTokenAddress} placeholder="Token contract / mint (optional — empty sends native)" placeholderTextColor="#78818f" style={styles.input} />
    <Button label={sending ? 'Sending…' : 'Send'} onPress={send} disabled={sending} />
    {status ? <Text style={styles.status}>{status}</Text> : null}
  </View>;
}

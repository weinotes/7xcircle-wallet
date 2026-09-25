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
 * Earn tab — 赚币生息 via liquid staking (Solana LSTs, zero keys needed).
 *
 * Stake = Jupiter-routed SOL → LST buy; unstake = the reverse sell. The
 * LST itself keeps appreciating against SOL, so holding IS earning — no
 * lockups, exit liquidity is the same venue that priced the entry.
 * APY/TVL refresh from Defillama on mount and pull-to-retry.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { chainRegistry } from '@7xcircle/core';
import {
  SOLANA_STAKE_PRODUCTS,
  SOL_MINT,
  fetchQuote,
  fetchStakeApy,
  fetchSwapTransaction,
  type StakeProduct,
  type StakeApy,
} from '@7xcircle/chains';
import { formatBalance, parseAmount } from '@7xcircle/shared';
import type { Account } from '@7xcircle/shared';
import { Button, shorten } from '../components';
import { sendExternalTx } from '../tx';
import { colors, styles } from '../theme';

const SOLANA_CHAIN = 'solana';

export function Earn({ accounts }: { accounts: Account[] }) {
  const account = accounts.find(a => a.chainId === SOLANA_CHAIN);
  const [apys, setApys] = useState<Record<string, StakeApy | 'loading' | 'error'>>({});
  const [held, setHeld] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<{ product: StakeProduct; dir: 'stake' | 'unstake' } | null>(null);

  // live APY per product
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setApys(Object.fromEntries(SOLANA_STAKE_PRODUCTS.map(p => [p.symbol, 'loading' as const])));
    for (const p of SOLANA_STAKE_PRODUCTS) {
      fetchStakeApy(p)
        .then(a => { if (!cancelled) setApys(prev => ({ ...prev, [p.symbol]: a })); })
        .catch(() => { if (!cancelled) setApys(prev => ({ ...prev, [p.symbol]: 'error' })); });
    }
    return () => { cancelled = true; };
  }, [account]);

  // what the user already stakes (from the Solana token balances)
  useEffect(() => {
    const adapter = chainRegistry.get(SOLANA_CHAIN);
    if (!account || !adapter) return;
    let cancelled = false;
    adapter.getAllTokenBalances(account.address)
      .then(list => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const p of SOLANA_STAKE_PRODUCTS) {
          const t = list.find(x => x.address === p.mint);
          map[p.symbol] = t?.balance ?? '0';
        }
        setHeld(map);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [account]);

  if (!account) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen}>
        <Text style={styles.heading}>Earn</Text>
        <Text style={styles.body}>Staking runs on Solana — this wallet has no Solana account.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Earn</Text>
      <Text style={styles.status}>Liquid staking — your stake stays sellable back to SOL at any time.</Text>

      {SOLANA_STAKE_PRODUCTS.map(product => {
        const apy = apys[product.symbol];
        const balance = held[product.symbol];
        return (
          <View key={product.symbol} style={styles.card}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.accountName}>{product.symbol}</Text>
                <Text style={styles.monoSmall}>{product.provider} · {product.name}</Text>
              </View>
              <View style={styles.badge}>
                <Text style={[styles.badgeText, { color: colors.accent }]}>
                  {apy === 'loading' || apy === undefined ? 'APY …'
                    : apy === 'error' ? 'APY —'
                    : `${apy.apy.toFixed(2)}% APY`}
                </Text>
              </View>
            </View>
            {typeof apy === 'object' && (
              <Text style={styles.monoSmall}>TVL ${(apy.tvlUsd / 1e6).toFixed(0)}M · as of {apy.asOf.slice(0, 10)}</Text>
            )}
            <Text style={styles.status}>
              Holding {formatBalance(balance ?? '0', product.decimals, 4)} {product.symbol}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button label="Stake SOL" onPress={() => setOpen({ product, dir: 'stake' })} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Unstake"
                  secondary
                  disabled={!balance || balance === '0'}
                  onPress={() => setOpen(o => (o ? null : { product, dir: 'unstake' }))}
                />
              </View>
            </View>
          </View>
        );
      })}

      {open && (
        <StakeSheet
          account={account}
          product={open.product}
          dir={open.dir}
          held={held[open.product.symbol] ?? '0'}
          onClose={() => setOpen(null)}
        />
      )}
    </ScrollView>
  );
}

/** One-shot amount → quote → sign panel for a direction */
function StakeSheet({
  account,
  product,
  dir,
  held,
  onClose,
}: {
  account: Account;
  product: StakeProduct;
  dir: 'stake' | 'unstake';
  held: string;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const seq = useRef(0);

  const inputMint = dir === 'stake' ? SOL_MINT : product.mint;
  const outputMint = dir === 'stake' ? product.mint : SOL_MINT;
  const inDecimals = 9; // both legs are 9-decimal on this curated set
  const outDecimals = 9;

  // debounced quote preview
  useEffect(() => {
    const my = ++seq.current;
    setPreview('');
    setError('');
    if (!amount || Number(amount) <= 0) return;
    let raw: string;
    try {
      raw = parseAmount(amount, inDecimals);
    } catch {
      setError('Invalid amount.');
      return;
    }
    const timer = setTimeout(() => {
      fetchQuote({ inputMint, outputMint, amountRaw: raw, slippageBps: 100 })
        .then(q => { if (seq.current === my) setPreview(`≈ ${formatBalance(q.outAmount, outDecimals, 4)} ${dir === 'stake' ? product.symbol : 'SOL'}`); })
        .catch(e => { if (seq.current === my) setError(e instanceof Error ? e.message : 'Quote failed'); });
    }, 450);
    return () => clearTimeout(timer);
  }, [amount, inputMint, outputMint, dir, product.symbol]);

  const submit = async () => {
    const adapter = chainRegistry.get(SOLANA_CHAIN);
    if (!adapter || !amount) return;
    setBusy(true);
    setError('');
    try {
      const quote = await fetchQuote({
        inputMint,
        outputMint,
        amountRaw: parseAmount(amount, inDecimals),
        slippageBps: 100,
      });
      const txBase64 = await fetchSwapTransaction({ quote, userPublicKey: account.address });
      const hash = await sendExternalTx({
        adapter,
        account,
        tx: { encoding: 'base64', payload: txBase64, versioned: true },
      });
      setDone(`${dir === 'stake' ? 'Staked' : 'Unstaked'} — ${shorten(hash, 10, 8)}`);
      setAmount('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, { borderColor: colors.borderStrong }]}>
      <View style={styles.rowBetween}>
        <Text style={styles.section}>
          {dir === 'stake' ? `Stake SOL → ${product.symbol}` : `Unstake ${product.symbol} → SOL`}
        </Text>
        <Pressable onPress={onClose}><Text style={styles.badgeText}>✕ close</Text></Pressable>
      </View>
      <TextInput
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
        placeholder={dir === 'stake' ? 'Amount (SOL)' : `Amount (${product.symbol}, holding ${formatBalance(held, 9, 4)})`}
        placeholderTextColor="#78818f"
        style={styles.input}
      />
      {preview ? <Text style={styles.status}>{preview}</Text> : null}
      {error ? <Text style={styles.warning}>{error}</Text> : null}
      {done ? <Text style={[styles.status, { color: colors.success }]}>{done}</Text> : null}
      <Button label={busy ? 'Confirming…' : dir === 'stake' ? 'Stake' : 'Unstake'} onPress={submit} disabled={busy || !amount} />
      <Text style={styles.monoSmall}>{product.exitNote}</Text>
    </View>
  );
}

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
 * Swap tab — Jupiter-routed swaps on Solana (mobile twin of the web page).
 *
 * Quote (debounced) → review → /swap build → importExternalTransaction →
 * local sign → broadcast. Keys never leave the session; the aggregator
 * only ever sees the public key it is asked to build a tx for.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { chainRegistry } from '@7xcircle/core';
import {
  SWAP_TOKEN_OPTIONS,
  fetchQuote,
  fetchSwapTransaction,
  type JupiterQuote,
  type SwapTokenOption,
} from '@7xcircle/chains';
import { formatBalance, parseAmount } from '@7xcircle/shared';
import type { Account } from '@7xcircle/shared';
import { Button, shorten } from '../components';
import { sendExternalTx } from '../tx';
import { styles } from '../theme';

const SOLANA_CHAIN = 'solana';
const SLIPPAGE_OPTIONS = [50, 100, 300];

export function Swap({ accounts }: { accounts: Account[] }) {
  const account = accounts.find(a => a.chainId === SOLANA_CHAIN);
  const adapter = chainRegistry.get(SOLANA_CHAIN);

  const [from, setFrom] = useState<SwapTokenOption>(SWAP_TOKEN_OPTIONS[0]);
  const [to, setTo] = useState<SwapTokenOption>(SWAP_TOKEN_OPTIONS[1]);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(100);
  const [customMint, setCustomMint] = useState('');
  const [quote, setQuote] = useState<JupiterQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState('');
  const quoteSeq = useRef(0);

  // debounced quote refresh
  useEffect(() => {
    const seq = ++quoteSeq.current;
    setQuote(null);
    setQuoteError('');
    if (!account || !amount || Number(amount) <= 0) return;
    let amountRaw = '';
    try {
      amountRaw = parseAmount(amount, from.decimals);
    } catch {
      setQuoteError('Invalid amount.');
      return;
    }
    setQuoting(true);
    const timer = setTimeout(() => {
      fetchQuote({
        inputMint: from.mint,
        outputMint: to.mint,
        amountRaw,
        slippageBps: slippage,
      })
        .then(q => { if (quoteSeq.current === seq) setQuote(q); })
        .catch(e => { if (quoteSeq.current === seq) setQuoteError(e instanceof Error ? e.message : 'Quote failed'); })
        .finally(() => { if (quoteSeq.current === seq) setQuoting(false); });
    }, 450);
    return () => clearTimeout(timer);
  }, [account, amount, from, to, slippage]);

  const swapDirection = () => {
    setFrom(to);
    setTo(from);
    setAmount('');
  };

  const applyCustomMint = (which: 'from' | 'to') => {
    const mint = customMint.trim();
    if (!mint) return;
    // same convention as the web Swap page: unverified mints assume 6
    // decimals (the dominant SPL choice); Jupiter still routes by mint
    const opt: SwapTokenOption = { mint, symbol: shorten(mint, 4, 4), decimals: 6 };
    if (which === 'from') setFrom(opt); else setTo(opt);
    setCustomMint('');
    setAmount('');
  };

  const execute = async () => {
    if (!account || !adapter || !quote) return;
    setExecuting(true);
    setStatus('');
    try {
      const txBase64 = await fetchSwapTransaction({ quote, userPublicKey: account.address });
      const hash = await sendExternalTx({
        adapter,
        account,
        tx: { encoding: 'base64', payload: txBase64, versioned: true },
      });
      setStatus(`Swapped: ${shorten(hash, 12, 8)}`);
      setAmount('');
      setQuote(null);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Swap failed — request a fresh quote and retry.');
    } finally {
      setExecuting(false);
    }
  };

  if (!account) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen}>
        <Text style={styles.heading}>Swap</Text>
        <Text style={styles.body}>Swap runs on Solana — this wallet has no Solana account.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Swap</Text>

      <View style={styles.card}>
        <TokenPicker label="From" token={from} onPress={() => {}} tokens={SWAP_TOKEN_OPTIONS} onPick={setFrom} />
        <Pressable onPress={swapDirection} style={styles.badge}>
          <Text style={styles.badgeText}>⇅ switch</Text>
        </Pressable>
        <TokenPicker label="To" token={to} onPress={() => {}} tokens={SWAP_TOKEN_OPTIONS} onPick={setTo} />

        <TextInput
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          placeholder={`Amount (${from.symbol})`}
          placeholderTextColor="#78818f"
          style={styles.input}
        />

        <View style={styles.rowBetween}>
          <Text style={styles.status}>Max slippage</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {SLIPPAGE_OPTIONS.map(bps => (
              <Pressable key={bps} onPress={() => setSlippage(bps)} style={[styles.badge, slippage === bps && styles.chipActive]}>
                <Text style={[styles.badgeText, slippage === bps && styles.chipTextActive]}>{bps / 100}%</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {quoting && <Text style={styles.status}>Fetching best route…</Text>}
        {quoteError !== '' && <Text style={styles.warning}>{quoteError}</Text>}
        {quote && (
          <View style={styles.requestBox}>
            <Text style={styles.requestText}>
              You receive ≥ {formatBalance(quote.otherAmountThreshold, to.decimals, 6)} {to.symbol}
            </Text>
            <Text style={styles.requestText}>
              Price impact {(Number(quote.priceImpactPct) * 100).toFixed(2)}% · Slippage {(quote.slippageBps / 100).toFixed(2)}%
            </Text>
          </View>
        )}
        <Button
          label={executing ? 'Swapping…' : `Swap ${from.symbol} → ${to.symbol}`}
          onPress={execute}
          disabled={executing || !quote}
        />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>

      {/* paste any SPL mint into the pair */}
      <View style={styles.card}>
        <Text style={styles.section}>Custom token (mint)</Text>
        <TextInput
          autoCapitalize="none"
          value={customMint}
          onChangeText={setCustomMint}
          placeholder="Paste token mint address…"
          placeholderTextColor="#78818f"
          style={styles.input}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="Set as From" onPress={() => applyCustomMint('from')} secondary disabled={!customMint.trim()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Set as To" onPress={() => applyCustomMint('to')} secondary disabled={!customMint.trim()} />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function TokenPicker({
  label,
  token,
  tokens,
  onPick,
}: {
  label: string;
  token: SwapTokenOption;
  onPress: () => void;
  tokens: SwapTokenOption[];
  onPick: (t: SwapTokenOption) => void;
}) {
  return (
    <View>
      <Text style={styles.status}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {tokens.map(t => {
          const active = t.mint === token.mint;
          return (
            <Pressable key={t.mint} onPress={() => onPick(t)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.symbol}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

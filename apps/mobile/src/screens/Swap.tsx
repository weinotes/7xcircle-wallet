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
 * Swap tab — the mobile twin of the web Swap page.
 *
 *   Solana → Jupiter  (quote, then /swap builds the wire transaction)
 *   EVM    → 0x v2    (the quote already carries the calldata to send)
 *
 * The EVM routes appear only when an 0x key was embedded at build time
 * (EXPO_PUBLIC_ZEROX_API_KEY) — quoting without one returns nothing, so
 * listing dead chains would be a lie. EVM ERC20 sells may need an approval
 * first: approve → wait → swap, and an unconfirmed approval never chains.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { chainRegistry } from '@7xcircle/core';
import {
  CHAIN_CONFIGS,
  SWAP_TOKEN_OPTIONS,
  deriveFeeAccount,
  fetchQuote,
  fetchSwapTransaction,
  fetchZeroExQuote,
  getEvmSwapTokens,
  hasZeroExKey,
  zeroExQuoteToIntents,
  ZEROX_CHAIN_IDS,
  type EvmSwapToken,
  type JupiterQuote,
  type ZeroExQuote,
} from '@7xcircle/chains';
import { formatBalance, parseAmount } from '@7xcircle/shared';
import type { Account } from '@7xcircle/shared';
import { Button, shorten } from '../components';
import { sendExternalTx, sendTx } from '../tx';
import {
  EVM_FEE_ENABLED,
  SWAP_FEE_BPS,
  SWAP_FEE_ENABLED,
  SWAP_FEE_WALLET,
  SWAP_FEE_WALLET_EVM,
} from '../config';
import { styles } from '../theme';

const SLIPPAGE_OPTIONS = [50, 100, 300];

/** One side of the pair, normalized across Solana mints and EVM contracts */
interface TokenChoice {
  address: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
}

/** A network this screen can actually route on, given the unlocked accounts */
interface ChainOption {
  chainId: string;
  label: string;
  kind: 'solana' | 'evm';
  decimal?: number;
}

function jupiterChoice(symbol: string): TokenChoice | undefined {
  const t = SWAP_TOKEN_OPTIONS.find(x => x.symbol === symbol);
  return t ? { address: t.mint, symbol: t.symbol, decimals: t.decimals, isNative: symbol === 'SOL' } : undefined;
}

export function Swap({ accounts }: { accounts: Account[] }) {
  const chainOptions = useMemo<ChainOption[]>(() => {
    const out: ChainOption[] = [];
    for (const cfg of CHAIN_CONFIGS) {
      if (cfg.testnet) continue;
      if (!accounts.some(a => a.chainId === cfg.chainId)) continue;
      if (cfg.type === 'solana') {
        out.push({ chainId: cfg.chainId, label: cfg.name, kind: 'solana' });
      } else if (
        cfg.type === 'evm' &&
        cfg.chainIdDecimal !== undefined &&
        ZEROX_CHAIN_IDS.includes(cfg.chainIdDecimal) &&
        hasZeroExKey()
      ) {
        out.push({ chainId: cfg.chainId, label: cfg.name, kind: 'evm', decimal: cfg.chainIdDecimal });
      }
    }
    return out;
  }, [accounts]);

  const [selectedChain, setSelectedChain] = useState<string>('');
  const active = chainOptions.find(o => o.chainId === selectedChain) ?? chainOptions[0];
  const account = active ? accounts.find(a => a.chainId === active.chainId) : undefined;
  const adapter = active ? chainRegistry.get(active.chainId) : undefined;

  const evmTokens = useMemo<TokenChoice[]>(
    () => (active?.kind === 'evm' ? getEvmSwapTokens(active.decimal ?? 0).map(evmToChoice) : []),
    [active],
  );

  const [from, setFrom] = useState<TokenChoice | undefined>(undefined);
  const [to, setTo] = useState<TokenChoice | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(100);
  const [customAddr, setCustomAddr] = useState('');
  const [jupQuote, setJupQuote] = useState<JupiterQuote | null>(null);
  const [zxQuote, setZxQuote] = useState<ZeroExQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [executing, setExecuting] = useState(false);
  const [status, setStatus] = useState('');
  const quoteSeq = useRef(0);

  // Re-seed the pair whenever the network changes
  useEffect(() => {
    if (!active) return;
    if (active.kind === 'solana') {
      setFrom(jupiterChoice('SOL'));
      setTo(jupiterChoice('USDC'));
    } else {
      setFrom(evmTokens[0]);
      setTo(evmTokens[1]);
    }
    setAmount('');
    setJupQuote(null);
    setZxQuote(null);
  }, [active, evmTokens]);

  // debounced quote refresh — one effect serves both venues
  useEffect(() => {
    const seq = ++quoteSeq.current;
    setJupQuote(null);
    setZxQuote(null);
    setQuoteError('');
    if (!account || !active || !from || !to || !amount || Number(amount) <= 0) return;
    let amountRaw = '';
    try {
      amountRaw = parseAmount(amount, from.decimals);
    } catch {
      setQuoteError('Invalid amount.');
      return;
    }
    setQuoting(true);
    const timer = setTimeout(() => {
      const done = (fn: () => Promise<void>) => fn().finally(() => {
        if (quoteSeq.current === seq) setQuoting(false);
      });
      if (active.kind === 'solana') {
        done(async () => {
          try {
            const q = await fetchQuote({
              inputMint: from.address,
              outputMint: to.address,
              amountRaw,
              slippageBps: slippage,
              // Platform fee rides the quote only when both config halves are
              // valid (see src/config.ts) — same gate as the web Swap.
              ...(SWAP_FEE_ENABLED ? { platformFeeBps: SWAP_FEE_BPS } : {}),
            });
            if (quoteSeq.current === seq) setJupQuote(q);
          } catch (e) {
            if (quoteSeq.current === seq) setQuoteError(e instanceof Error ? e.message : 'Quote failed');
          }
        });
      } else {
        done(async () => {
          try {
            const q = await fetchZeroExQuote({
              chainId: active.decimal ?? 0,
              sellToken: from.address,
              buyToken: to.address,
              sellAmountRaw: amountRaw,
              taker: account.address,
              slippageBps: slippage,
              ...(EVM_FEE_ENABLED
                ? { swapFeeRecipient: SWAP_FEE_WALLET_EVM, swapFeeBps: Math.min(SWAP_FEE_BPS, 1_000) }
                : {}),
            });
            if (quoteSeq.current !== seq) return;
            if (q) setZxQuote(q);
            else setQuoteError('No route for this pair right now.');
          } catch (e) {
            if (quoteSeq.current === seq) setQuoteError(e instanceof Error ? e.message : 'Quote failed');
          }
        });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [account, active, amount, from, to, slippage]);

  if (chainOptions.length === 0 || !active || !account || !adapter) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen}>
        <Text style={styles.heading}>Swap</Text>
        <Text style={styles.body}>
          {hasZeroExKey()
            ? 'Swap needs at least one supported chain account.'
            : 'Swap runs on Solana — this build has no 0x key embedded (set EXPO_PUBLIC_ZEROX_API_KEY for EVM routes).'}
        </Text>
      </ScrollView>
    );
  }

  const swapDirection = () => {
    setFrom(to);
    setTo(from);
    setAmount('');
  };

  const applyCustomAddress = (which: 'from' | 'to') => {
    const addr = customAddr.trim();
    if (!addr) return;
    // Unverified custom assets assume 18 decimals on EVM (the dominant EVM
    // choice) and 6 on Solana — pasted tokens are the user's responsibility,
    // the same convention the web page documents.
    const opt: TokenChoice = {
      address: addr,
      symbol: shorten(addr, 4, 4),
      decimals: active.kind === 'evm' ? 18 : 6,
      isNative: false,
    };
    if (which === 'from') setFrom(opt); else setTo(opt);
    setCustomAddr('');
    setAmount('');
  };

  const execute = async () => {
    if (!from || !to) return;
    setExecuting(true);
    setStatus('');
    try {
      if (active.kind === 'solana' && jupQuote) {
        // Jupiter routes the platform fee to the fee wallet's ATA for the
        // input mint; derived here (not at quote time) so the swap body and
        // the quote's platformFeeBps always name the same account.
        const feeAccount = SWAP_FEE_ENABLED
          ? await deriveFeeAccount(SWAP_FEE_WALLET, from.address)
          : undefined;
        const txBase64 = await fetchSwapTransaction({
          quote: jupQuote,
          userPublicKey: account.address,
          ...(feeAccount ? { feeAccount } : {}),
        });
        const hash = await sendExternalTx({
          adapter,
          account,
          tx: { encoding: 'base64', payload: txBase64, versioned: true },
        });
        setStatus(`Swapped: ${shorten(hash, 12, 8)}`);
      } else if (active.kind === 'evm' && zxQuote) {
        const intents = zeroExQuoteToIntents(zxQuote);
        if (intents.approve) {
          // An unconfirmed approval must never chain into the swap — the
          // swap would revert and burn gas for nothing.
          setStatus('Approving spend…');
          await sendTx({ adapter, account, intent: intents.approve });
        }
        setStatus('Swapping…');
        const hash = await sendTx({ adapter, account, intent: intents.swap });
        setStatus(`Swapped: ${shorten(hash, 12, 8)}`);
      } else {
        throw new Error('Quote is stale — request a fresh one.');
      }
      setAmount('');
      setJupQuote(null);
      setZxQuote(null);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Swap failed — request a fresh quote and retry.');
    } finally {
      setExecuting(false);
    }
  };

  const ready = active.kind === 'solana' ? jupQuote !== null : zxQuote !== null;
  const outChoice = to;
  const outText = jupQuote
    ? `You receive ≥ ${formatBalance(jupQuote.otherAmountThreshold, outChoice?.decimals ?? 6, 6)} ${outChoice?.symbol ?? ''}`
    : zxQuote && outChoice
      ? `You receive ≈ ${formatBalance(zxQuote.buyAmount, outChoice.decimals, 6)} ${outChoice.symbol}`
      : '';

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Swap</Text>

      {/* chain chips — only routes this build can actually serve */}
      <View style={styles.chipRow}>
        {chainOptions.map(opt => {
          const on = opt.chainId === active.chainId;
          return (
            <Pressable key={opt.chainId} onPress={() => setSelectedChain(opt.chainId)} style={[styles.chip, on && styles.chipActive]}>
              <Text style={[styles.chipText, on && styles.chipTextActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.card}>
        {from && <TokenPicker label="From" token={from} tokens={active.kind === 'solana' ? SWAP_TOKEN_OPTIONS.map(jupToChoice) : evmTokens} onPick={setFrom} />}
        <Pressable onPress={swapDirection} style={styles.badge}>
          <Text style={styles.badgeText}>⇅ switch</Text>
        </Pressable>
        {to && <TokenPicker label="To" token={to} tokens={active.kind === 'solana' ? SWAP_TOKEN_OPTIONS.map(jupToChoice) : evmTokens} onPick={setTo} />}

        <TextInput
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          placeholder={`Amount (${from?.symbol ?? ''})`}
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
        {(jupQuote || zxQuote) && (
          <View style={styles.requestBox}>
            <Text style={styles.requestText}>{outText}</Text>
            {jupQuote && (
              <Text style={styles.requestText}>
                Price impact {(Number(jupQuote.priceImpactPct) * 100).toFixed(2)}%
              </Text>
            )}
          </View>
        )}
        <Button
          label={executing ? 'Swapping…' : `Swap ${from?.symbol ?? ''} → ${to?.symbol ?? ''}`}
          onPress={execute}
          disabled={executing || !ready}
        />
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>

      {/* paste any contract / mint into the pair */}
      <View style={styles.card}>
        <Text style={styles.section}>Custom token ({active.kind === 'evm' ? 'contract' : 'mint'})</Text>
        <TextInput
          autoCapitalize="none"
          value={customAddr}
          onChangeText={setCustomAddr}
          placeholder={active.kind === 'evm' ? 'Paste token contract address…' : 'Paste token mint address…'}
          placeholderTextColor="#78818f"
          style={styles.input}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="Set as From" onPress={() => applyCustomAddress('from')} secondary disabled={!customAddr.trim()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Set as To" onPress={() => applyCustomAddress('to')} secondary disabled={!customAddr.trim()} />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function evmToChoice(t: EvmSwapToken): TokenChoice {
  return { address: t.address, symbol: t.symbol, decimals: t.decimals, isNative: t.isNative };
}

function jupToChoice(t: (typeof SWAP_TOKEN_OPTIONS)[number]): TokenChoice {
  return { address: t.mint, symbol: t.symbol, decimals: t.decimals, isNative: t.symbol === 'SOL' };
}

function TokenPicker({
  label,
  token,
  tokens,
  onPick,
}: {
  label: string;
  token: TokenChoice;
  tokens: TokenChoice[];
  onPick: (t: TokenChoice) => void;
}) {
  return (
    <View>
      <Text style={styles.status}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {tokens.map(t => {
          const active = t.address === token.address;
          return (
            <Pressable key={t.address} onPress={() => onPick(t)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.symbol}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

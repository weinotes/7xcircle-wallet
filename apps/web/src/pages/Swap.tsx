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
 * Swap page — Jupiter-routed swaps on Solana (MONETIZATION P1 line #1).
 *
 * Flow: pick pair + amount → quote (debounced) → review → /swap build →
 * importExternalTransaction → local sign → send via the shared tx pipeline.
 *
 * Platform fee: when a fee wallet is configured (env), every quote carries
 * platformFeeBps and Jupiter routes that slice of the INPUT to our fee
 * ATA — derived client-side per mint. No backend, keys never leave device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowDownUp, Loader2, ExternalLink } from 'lucide-react';
import { Button, Input } from '@open-wallet/ui';
import { chainRegistry } from '@open-wallet/core';
import {
  SWAP_TOKEN_OPTIONS,
  deriveFeeAccount,
  fetchQuote,
  fetchSwapTransaction,
  setJupiterBaseUrl,
  type JupiterQuote,
  type SwapTokenOption,
} from '@open-wallet/chains';
import { formatBalance, parseAmount } from '@open-wallet/shared';
import { useWalletStore } from '../store/wallet.js';
import { useTxFlow } from '../hooks/useTxFlow.js';
import { SWAP_CHAIN_ID, SWAP_FEE_BPS, SWAP_FEE_WALLET, EXPLORER_BASE, JUPITER_BASE_URL } from '../config.js';

// honor a Pro-tier / proxy endpoint from the build env (no-op when unset)
setJupiterBaseUrl(JUPITER_BASE_URL);

interface TokenChoice extends SwapTokenOption {
  isNative: boolean;
}

/** Curated pairs plus whatever the user pastes as a custom mint */
const PRESETS: TokenChoice[] = [
  { ...SWAP_TOKEN_OPTIONS[0], isNative: true },   // SOL (native, wSOL mint)
  ...SWAP_TOKEN_OPTIONS.slice(1).map(t => ({ ...t, isNative: false })),
];

const SLIPPAGE_CHOICES = [50, 100, 300];

export function Swap() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const accounts = useWalletStore(s => s.accounts);
  const account = accounts.find(a => a.chainId === SWAP_CHAIN_ID);
  const adapter = chainRegistry.get(SWAP_CHAIN_ID);
  const flow = useTxFlow({ adapter, account, chainId: SWAP_CHAIN_ID, feeTier: 'fast' });

  const [fromMint, setFromMint] = useState<TokenChoice>(PRESETS[0]);
  const [toMint, setToMint] = useState<TokenChoice>(PRESETS[1]);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [quote, setQuote] = useState<JupiterQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [fromBalance, setFromBalance] = useState<string | null>(null);
  const quoteSeq = useRef(0);

  const feeEnabled = SWAP_FEE_BPS > 0 && SWAP_FEE_WALLET.length > 0;

  // ── Balance of the current input token (for display + overspend guard) ──
  useEffect(() => {
    if (!adapter || !account) return;
    let cancelled = false;
    setFromBalance(null);
    const bal = fromMint.isNative
      ? adapter.getNativeBalance(account.address)
      : adapter.getTokenBalance(account.address, fromMint.mint);
    bal
      .then(b => { if (!cancelled) setFromBalance(b); })
      .catch(() => { if (!cancelled) setFromBalance(null); });
    return () => { cancelled = true; };
  }, [adapter, account, fromMint]);

  // ── Debounced quote refresh ─────────────────────────────────────────
  const amountRaw = useMemo(() => {
    try {
      return amount && Number(amount) > 0 ? parseAmount(amount, fromMint.decimals) : '';
    } catch {
      return '';
    }
  }, [amount, fromMint.decimals]);

  // evaluated after amountRaw — TDZ guard: never move this above the memo
  const insufficient =
    fromBalance !== null && amountRaw !== '' && BigInt(amountRaw) > BigInt(fromBalance);

  useEffect(() => {
    if (!account || !amountRaw || fromMint.mint === toMint.mint) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    setQuoteError(null);
    const timer = setTimeout(() => {
      fetchQuote({
        inputMint: fromMint.mint,
        outputMint: toMint.mint,
        amountRaw,
        slippageBps,
        ...(feeEnabled ? { platformFeeBps: SWAP_FEE_BPS } : {}),
      })
        .then(q => {
          if (seq !== quoteSeq.current) return;
          setQuote(q);
        })
        .catch(err => {
          if (seq !== quoteSeq.current) return;
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (seq === quoteSeq.current) setQuoting(false);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [account, amountRaw, fromMint, toMint, slippageBps, feeEnabled]);

  // ── Custom mint inputs ──────────────────────────────────────────────
  const applyCustom = (side: 'from' | 'to') => {
    const mint = (side === 'from' ? customFrom : customTo).trim();
    if (!mint) return;
    const choice: TokenChoice = { mint, symbol: mint.slice(0, 4) + '…', decimals: 6, isNative: false };
    if (side === 'from') setFromMint(choice);
    else setToMint(choice);
  };

  const flip = () => {
    setFromMint(toMint);
    setToMint(fromMint);
    setAmount('');
  };

  /** Fill the input with the whole balance minus a small gas cushion for SOL */
  const setMaxAmount = () => {
    if (fromBalance === null) return;
    const cushion = fromMint.isNative ? 5_000_000n : 0n; // 0.005 SOL for fees
    const max = BigInt(fromBalance) - cushion;
    if (max <= 0n) { setAmount(''); return; }
    // raw → human string with exact decimals, no float
    const s = max.toString().padStart(fromMint.decimals + 1, '0');
    const whole = s.slice(0, s.length - fromMint.decimals).replace(/^0+/, '') || '0';
    const frac = s.slice(s.length - fromMint.decimals).replace(/0+$/, '');
    setAmount(frac ? `${whole}.${frac}` : whole);
  };

  // ── Execute ─────────────────────────────────────────────────────────
  const handleSwap = useCallback(async () => {
    if (!account || !adapter || !quote) return;
    try {
      const feeAccount = feeEnabled
        ? await deriveFeeAccount(SWAP_FEE_WALLET, fromMint.mint)
        : undefined;
      const txBase64 = await fetchSwapTransaction({
        quote,
        userPublicKey: account.address,
        ...(feeAccount ? { feeAccount } : {}),
      });
      await flow.sendExternal(
        { encoding: 'base64', payload: txBase64, versioned: true },
        {
          displayTo: `swap ${fromMint.symbol}→${toMint.symbol}`,
          amountRaw: quote.outAmount,
          token: { symbol: toMint.symbol, address: toMint.mint, decimals: toMint.decimals, isNative: toMint.isNative },
        },
      );
      // force a fresh quote after a terminal state
      if (flow.status === 'failed') setAmount('');
    } catch (err) {
      // surfaced via flow for pipeline errors; this covers build-phase ones
      setQuoteError(err instanceof Error ? err.message : String(err));
    }
  }, [account, adapter, quote, feeEnabled, fromMint, toMint, flow]);

  // ── Render ──────────────────────────────────────────────────────────
  if (!account) {
    return (
      <div style={{ padding: 'var(--ow-space-4)' }}>
        <p>{t('swap.noSolanaAccount')}</p>
        <Button onClick={() => navigate('/')}>{t('common.back')}</Button>
      </div>
    );
  }

  const done = flow.status === 'confirmed' || flow.status === 'failed' || flow.status === 'pending';
  const busy = ['building', 'signing', 'broadcasting'].includes(flow.status);

  return (
    <div style={{ padding: 'var(--ow-space-4)', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)', marginBottom: 'var(--ow-space-4)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
        </Button>
        <h2 style={{ margin: 0 }}>{t('swap.title')}</h2>
      </div>

      {flow.status === 'idle' || !done ? (
        <>
          <TokenSelect
            label={t('swap.from')}
            value={fromMint}
            onChange={setFromMint}
            custom={customFrom}
            onCustomChange={setCustomFrom}
            onCustomApply={() => applyCustom('from')}
          />
          <div style={{ textAlign: 'center', margin: 'var(--ow-space-2) 0' }}>
            <Button variant="ghost" size="sm" onClick={flip} aria-label="flip">
              <ArrowDownUp size={16} />
            </Button>
          </div>
          <TokenSelect
            label={t('swap.to')}
            value={toMint}
            onChange={setToMint}
            custom={customTo}
            onCustomChange={setCustomTo}
            onCustomApply={() => applyCustom('to')}
          />

          <div style={{ marginTop: 'var(--ow-space-3)' }}>
            <Input
              label={t('swap.amountLabel', { symbol: fromMint.symbol })}
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              error={insufficient ? t('swap.notEnoughBalance', { symbol: fromMint.symbol }) : undefined}
            />
            {/* always visible — an RPC failure shows “—”, not a silent gap
                (the overspend guard simply stays inert without a balance) */}
            <div style={{ fontSize: 'var(--ow-font-size-sm)', opacity: 0.7 }}>
              {t('swap.balance', { balance: fromBalance === null ? '—' : formatBalance(fromBalance, fromMint.decimals, 4) })}
              <button
                type="button"
                style={{ marginLeft: 6, background: 'none', border: 'none', color: 'var(--ow-accent)', cursor: 'pointer' }}
                onClick={() => setMaxAmount()}
                disabled={fromBalance === null}
              >
                MAX
              </button>
            </div>
          </div>

          <div style={{ marginTop: 'var(--ow-space-3)' }}>
            <div style={{ fontSize: 'var(--ow-font-size-sm)', marginBottom: 'var(--ow-space-1)' }}>{t('swap.slippage')}</div>
            <div style={{ display: 'flex', gap: 'var(--ow-space-2)' }}>
              {SLIPPAGE_CHOICES.map(bps => (
                <Button
                  key={bps}
                  size="sm"
                  variant={slippageBps === bps ? 'primary' : 'secondary'}
                  onClick={() => setSlippageBps(bps)}
                >
                  {(bps / 100).toFixed(1)}%
                </Button>
              ))}
            </div>
          </div>

          {/* Quote summary */}
          <div style={{ marginTop: 'var(--ow-space-4)', padding: 'var(--ow-space-3)', borderRadius: 'var(--ow-radius-md)', border: '1px solid var(--ow-border)' }}>
            {quoting && <span><Loader2 size={14} style={{ display: 'inline' }} /> {t('swap.quoting')}</span>}
            {!quoting && quoteError && <span style={{ color: 'var(--ow-danger)' }}>{quoteError}</span>}
            {!quoting && !quote && !quoteError && !amountRaw && <span>{t('swap.enterAmount')}</span>}
            {!quoting && quote && (
              <div style={{ display: 'grid', gap: 'var(--ow-space-1)', fontSize: 'var(--ow-font-size-sm)' }}>
                <div style={{ fontSize: 'var(--ow-font-size-lg)', fontWeight: 700 }}>
                  ≈ {formatBalance(quote.outAmount, toMint.decimals, 6)} {toMint.symbol}
                </div>
                <div>{t('swap.minReceived')}: {formatBalance(quote.otherAmountThreshold, toMint.decimals, 6)}</div>
                <div>{t('swap.priceImpact')}: {(Number(quote.priceImpactPct) * 100).toFixed(2)}%</div>
                {feeEnabled && <div>{t('swap.fee')}: {(SWAP_FEE_BPS / 100).toFixed(2)}%</div>}
              </div>
            )}
          </div>

          <Button
            size="lg"
            style={{ width: '100%', marginTop: 'var(--ow-space-4)' }}
            disabled={!quote || quoting || busy || insufficient}
            onClick={handleSwap}
          >
            {busy ? <Loader2 size={16} /> : t('swap.execute', { symbol: toMint.symbol })}
          </Button>
          {flow.error && <p style={{ color: 'var(--ow-danger)' }}>{flow.error}</p>}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 'var(--ow-space-6) 0' }}>
          <p style={{ fontWeight: 700 }}>
            {flow.status === 'confirmed' && `✅ ${t('swap.confirmed')}`}
            {flow.status === 'pending' && `⏳ ${t('swap.pending')}`}
            {flow.status === 'failed' && `❌ ${t('swap.failed')}`}
          </p>
          {flow.txHash && (
            <a href={`${EXPLORER_BASE}/tx/${flow.txHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {flow.txHash.slice(0, 12)}… <ExternalLink size={12} />
            </a>
          )}
          <div style={{ marginTop: 'var(--ow-space-4)', display: 'flex', gap: 'var(--ow-space-2)', justifyContent: 'center' }}>
            <Button onClick={() => { flow.reset(); setAmount(''); setQuote(null); }}>{t('swap.another')}</Button>
            <Button variant="secondary" onClick={() => navigate('/')}>{t('common.back')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── token select subcomponent ──────────────────────────────────────

interface TokenSelectProps {
  label: string;
  value: TokenChoice;
  onChange: (t: TokenChoice) => void;
  custom: string;
  onCustomChange: (v: string) => void;
  onCustomApply: () => void;
}

function TokenSelect({ label, value, onChange, custom, onCustomChange, onCustomApply }: TokenSelectProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ fontSize: 'var(--ow-font-size-sm)', marginBottom: 'var(--ow-space-1)' }}>{label}</div>
      <div style={{ display: 'flex', gap: 'var(--ow-space-2)', alignItems: 'center' }}>
        <select
          value={PRESETS.some(p => p.mint === value.mint) ? value.mint : 'custom'}
          onChange={e => {
            const preset = PRESETS.find(p => p.mint === e.target.value);
            if (preset) onChange(preset);
          }}
          style={{ padding: 'var(--ow-space-2)', borderRadius: 'var(--ow-radius-md)', minWidth: 120 }}
        >
          {PRESETS.map(p => <option key={p.mint} value={p.mint}>{p.symbol}</option>)}
          <option value="custom" disabled>{t('swap.custom')}</option>
        </select>
        <span style={{ fontSize: 'var(--ow-font-size-sm)', opacity: 0.7 }}>{value.mint}</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--ow-space-2)', marginTop: 'var(--ow-space-1)' }}>
        <input
          placeholder={t('swap.customMintPlaceholder')}
          value={custom}
          onChange={e => onCustomChange(e.target.value)}
          style={{ flex: 1, padding: 'var(--ow-space-2)', borderRadius: 'var(--ow-radius-md)', border: '1px solid var(--ow-border)' }}
        />
        <Button size="sm" variant="secondary" onClick={onCustomApply} disabled={!custom.trim()}>{t('swap.useMint')}</Button>
      </div>
    </div>
  );
}

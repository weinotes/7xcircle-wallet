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
 * Swap page — aggregator-routed swaps (MONETIZATION P1 line #1).
 *
 * Two providers, one page, chosen by the selected network:
 *   Solana → Jupiter  (quote, then /swap builds the wire transaction)
 *   EVM    → 0x v2    (the quote already carries the transaction to send)
 *
 * The structural difference is the reason this file keeps two quote shapes
 * instead of a fake common one: Jupiter needs a SECOND call to turn a quote
 * into bytes, while 0x hands back a signable payload immediately. Forcing
 * them into one abstraction would hide that, not remove it.
 *
 * EVM ERC20 sells may need an approval first. That is a two-transaction
 * flow: approve → confirm → swap. `flow.send` resolves with the outcome so
 * the second step never fires on an unconfirmed approval.
 *
 * Platform fee: Solana takes it via Jupiter's platformFeeBps + a derived fee
 * ATA; EVM takes it via 0x's swapFeeBps + a public fee wallet. Both are
 * skipped entirely when the corresponding env value is empty. No backend,
 * keys never leave the device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowDownUp, Loader2, ExternalLink } from 'lucide-react';
import { Button, Input } from '@7xcircle/ui';
import { chainRegistry } from '@7xcircle/core';
import {
  CHAIN_CONFIGS,
  SWAP_TOKEN_OPTIONS,
  ZEROX_CHAIN_IDS,
  deriveFeeAccount,
  fetchQuote,
  fetchSwapTransaction,
  fetchZeroExQuote,
  getEvmSwapTokens,
  hasZeroExKey,
  zeroExQuoteToIntents,
  type JupiterQuote,
  type ZeroExQuote,
} from '@7xcircle/chains';
import { formatBalance, parseAmount } from '@7xcircle/shared';
import type { TxIntent } from '@7xcircle/shared';
import { useWalletStore } from '../store/wallet.js';
import { useTxFlow } from '../hooks/useTxFlow.js';
import {
  SWAP_FEE_BPS,
  SWAP_FEE_BPS_EVM,
  SWAP_FEE_WALLET,
  SWAP_FEE_WALLET_EVM,
} from '../config.js';

/** One side of the pair, normalized across Solana mints and EVM contracts */
interface TokenChoice {
  /** quote-side asset id: SPL mint on Solana, contract (or native sentinel) on EVM */
  address: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
}

/** A network this page can actually route on, given the unlocked accounts */
interface ChainOption {
  /** registry key (e.g. 'solana', 'bsc-56') */
  chainId: string;
  label: string;
  kind: 'solana' | 'evm';
  /** decimal EVM chain id — required for the 0x quote, absent on Solana */
  decimal?: number;
  /** base explorer URL; a chain config may omit it (link is skipped then) */
  explorer?: string;
}

const SLIPPAGE_CHOICES = [50, 100, 300];

/** Native-gas cushion the MAX button leaves behind, in raw units */
const SOL_GAS_CUSHION = 5_000_000n;            // 0.005 SOL
const EVM_GAS_CUSHION = 1_000_000_000_000_000n; // 0.001 ETH/BNB

/** SOL first (native, but quoted as the wSOL mint), then the stablecoins */
const SOLANA_PRESETS: TokenChoice[] = SWAP_TOKEN_OPTIONS.map((t, i) => ({
  address: t.mint,
  symbol: t.symbol,
  decimals: t.decimals,
  isNative: i === 0,
}));

const EVM_FEE_WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export function Swap() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const accounts = useWalletStore(s => s.accounts);
  const recordApproval = useWalletStore(s => s.recordApproval);
  const [chainId, setChainId] = useState<string>('');

  /**
   * The networks on offer. Gated on accounts the user actually holds, and on
   * the 0x key: without it every EVM quote returns null, so listing the chains
   * would only produce four dead options.
   */
  const chainOptions = useMemo<ChainOption[]>(() => {
    const out: ChainOption[] = [];
    for (const cfg of CHAIN_CONFIGS) {
      if (cfg.testnet) continue;
      if (!accounts.some(a => a.chainId === cfg.chainId)) continue;
      if (cfg.type === 'solana') {
        out.push({ chainId: cfg.chainId, label: cfg.name, kind: 'solana', explorer: cfg.explorer });
      } else if (
        cfg.type === 'evm' &&
        cfg.chainIdDecimal !== undefined &&
        ZEROX_CHAIN_IDS.includes(cfg.chainIdDecimal) &&
        hasZeroExKey()
      ) {
        out.push({
          chainId: cfg.chainId,
          label: cfg.name,
          kind: 'evm',
          decimal: cfg.chainIdDecimal,
          explorer: cfg.explorer,
        });
      }
    }
    return out;
  }, [accounts]);

  // Fall back to the first usable network when the selected one disappears
  const active = chainOptions.find(o => o.chainId === chainId) ?? chainOptions[0];
  const activeChainId = active?.chainId ?? '';

  const account = accounts.find(a => a.chainId === activeChainId);
  const adapter = chainRegistry.get(activeChainId);
  const flow = useTxFlow({ adapter, account, chainId: activeChainId, feeTier: 'fast' });

  const [fromToken, setFromToken] = useState<TokenChoice>(SOLANA_PRESETS[0]);
  const [toToken, setToToken] = useState<TokenChoice>(SOLANA_PRESETS[1]);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [quote, setQuote] = useState<JupiterQuote | null>(null);
  const [evmQuote, setEvmQuote] = useState<ZeroExQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [fromBalance, setFromBalance] = useState<string | null>(null);
  /** Non-null while a multi-transaction EVM swap is mid-flight */
  const [stage, setStage] = useState<'approve' | 'swap' | null>(null);
  const quoteSeq = useRef(0);

  /** Presets for the selected network; Solana mints or the 0x curated list */
  const presets = useMemo<TokenChoice[]>(() => {
    if (!active) return [];
    if (active.kind === 'solana') return SOLANA_PRESETS;
    return getEvmSwapTokens(active.decimal as number).map(tok => ({
      address: tok.address,
      symbol: tok.symbol,
      decimals: tok.decimals,
      isNative: tok.isNative,
    }));
  }, [active]);

  const feeEnabled = SWAP_FEE_BPS > 0 && SWAP_FEE_WALLET.length > 0;
  const evmFeeEnabled = SWAP_FEE_BPS_EVM > 0 && EVM_FEE_WALLET_RE.test(SWAP_FEE_WALLET_EVM);

  // Switching networks invalidates every pair + quote on screen. Re-seed from
  // the new list so a Solana mint can never be quoted against a BSC contract.
  useEffect(() => {
    if (presets.length < 2) return;
    setFromToken(presets[0]);
    setToToken(presets[1]);
    setAmount('');
    setQuote(null);
    setEvmQuote(null);
    setQuoteError(null);
  }, [presets]);

  // ── Balance of the current input token (display + overspend guard) ──
  useEffect(() => {
    if (!adapter || !account) return;
    let cancelled = false;
    setFromBalance(null);
    const bal = fromToken.isNative
      ? adapter.getNativeBalance(account.address)
      : adapter.getTokenBalance(account.address, fromToken.address);
    bal
      .then(b => { if (!cancelled) setFromBalance(b); })
      .catch(() => { if (!cancelled) setFromBalance(null); });
    return () => { cancelled = true; };
  }, [adapter, account, fromToken]);

  // ── Debounced quote refresh ─────────────────────────────────────────
  const amountRaw = useMemo(() => {
    try {
      return amount && Number(amount) > 0 ? parseAmount(amount, fromToken.decimals) : '';
    } catch {
      return '';
    }
  }, [amount, fromToken.decimals]);

  // evaluated after amountRaw — TDZ guard: never move this above the memo
  const insufficient =
    (fromBalance !== null && amountRaw !== '' && BigInt(amountRaw) > BigInt(fromBalance)) ||
    evmQuote?.insufficientBalance === true;

  useEffect(() => {
    if (!account || !active || !amountRaw || fromToken.address === toToken.address) {
      setQuote(null);
      setEvmQuote(null);
      setQuoteError(null);
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        if (active.kind === 'solana') {
          const q = await fetchQuote({
            inputMint: fromToken.address,
            outputMint: toToken.address,
            amountRaw,
            slippageBps,
            ...(feeEnabled ? { platformFeeBps: SWAP_FEE_BPS } : {}),
          });
          if (seq !== quoteSeq.current) return;
          setQuote(q);
          setEvmQuote(null);
        } else {
          const q = await fetchZeroExQuote({
            chainId: active.decimal as number,
            sellToken: fromToken.address,
            buyToken: toToken.address,
            sellAmountRaw: amountRaw,
            taker: account.address,
            slippageBps,
            ...(evmFeeEnabled
              ? { swapFeeRecipient: SWAP_FEE_WALLET_EVM, swapFeeBps: SWAP_FEE_BPS_EVM }
              : {}),
          });
          if (seq !== quoteSeq.current) return;
          if (q) {
            setEvmQuote(q);
            setQuote(null);
          } else {
            setEvmQuote(null);
            setQuoteError(t('swap.evmUnavailable'));
          }
        }
      } catch (err) {
        if (seq !== quoteSeq.current) return;
        setQuote(null);
        setEvmQuote(null);
        setQuoteError(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [account, active, amountRaw, fromToken, toToken, slippageBps, feeEnabled, evmFeeEnabled, t]);

  // ── Custom token inputs ─────────────────────────────────────────────
  const applyCustom = async (side: 'from' | 'to') => {
    const raw = (side === 'from' ? customFrom : customTo).trim();
    if (!raw || !adapter) return;
    if (!adapter.validateAddress(raw)) {
      setQuoteError(t('swap.invalidToken'));
      return;
    }
    try {
      // Read symbol/decimals off the contract rather than guessing: a wrong
      // decimals value would misprice the swap by orders of magnitude.
      const info = await adapter.getTokenInfo(raw);
      const choice: TokenChoice = {
        address: raw,
        symbol: info.symbol || raw.slice(0, 6),
        decimals: info.decimals,
        isNative: false,
      };
      if (side === 'from') setFromToken(choice);
      else setToToken(choice);
      setQuoteError(null);
    } catch {
      setQuoteError(t('swap.invalidToken'));
    }
  };

  const flip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount('');
  };

  /** Fill the input with the whole balance minus a gas cushion for the native coin */
  const setMaxAmount = () => {
    if (fromBalance === null) return;
    const cushion = fromToken.isNative
      ? (active?.kind === 'solana' ? SOL_GAS_CUSHION : EVM_GAS_CUSHION)
      : 0n;
    const max = BigInt(fromBalance) - cushion;
    if (max <= 0n) { setAmount(''); return; }
    // raw → human string with exact decimals, no float
    const s = max.toString().padStart(fromToken.decimals + 1, '0');
    const whole = s.slice(0, s.length - fromToken.decimals).replace(/^0+/, '') || '0';
    const frac = s.slice(s.length - fromToken.decimals).replace(/0+$/, '');
    setAmount(frac ? `${whole}.${frac}` : whole);
  };

  // ── Execute ─────────────────────────────────────────────────────────
  const handleSwap = useCallback(async () => {
    if (!account || !adapter || !active) return;
    try {
      if (active.kind === 'solana') {
        if (!quote) return;
        const feeAccount = feeEnabled
          ? await deriveFeeAccount(SWAP_FEE_WALLET, fromToken.address)
          : undefined;
        const txBase64 = await fetchSwapTransaction({
          quote,
          userPublicKey: account.address,
          ...(feeAccount ? { feeAccount } : {}),
        });
        await flow.sendExternal(
          { encoding: 'base64', payload: txBase64, versioned: true },
          {
            displayTo: `swap ${fromToken.symbol}→${toToken.symbol}`,
            amountRaw: quote.outAmount,
            token: {
              symbol: toToken.symbol,
              address: toToken.address,
              decimals: toToken.decimals,
              isNative: toToken.isNative,
            },
          },
        );
        return;
      }

      if (!evmQuote) return;
      const intents = zeroExQuoteToIntents(evmQuote);
      setStage(intents.approve ? 'approve' : 'swap');

      if (intents.approve) {
        const approved = await flow.send(intents.approve as TxIntent, {
          // the spender IS the destination of an approval — History must show
          // the contract the user just trusted, not the token
          displayTo: intents.approve.spender,
          amountRaw: intents.approve.amountRaw,
          token: {
            symbol: fromToken.symbol,
            address: fromToken.address,
            decimals: fromToken.decimals,
            isNative: false,
          },
        });
        // An unconfirmed approval must never be chained into a swap: the
        // swap would revert and burn gas for nothing.
        if (approved !== 'confirmed') {
          setStage(null);
          return;
        }
        // Confirmed grant → the approval ledger (Approvals page can revoke
        // exactly what this wallet just signed over to the router).
        recordApproval({
          chainId: active.chainId,
          token: intents.approve.token,
          spender: intents.approve.spender,
          symbol: fromToken.symbol,
          decimals: fromToken.decimals,
          amountRaw: intents.approve.amountRaw,
          createdAt: Math.floor(Date.now() / 1000),
          source: 'swap',
        });
        setStage('swap');
      }

      await flow.send(intents.swap as TxIntent, {
        displayTo: `swap ${fromToken.symbol}→${toToken.symbol}`,
        amountRaw: evmQuote.buyAmount,
        token: {
          symbol: toToken.symbol,
          address: toToken.address,
          decimals: toToken.decimals,
          isNative: toToken.isNative,
        },
      });
      setStage(null);
    } catch (err) {
      // build-phase failures — pipeline errors surface through `flow` instead
      setStage(null);
      setQuoteError(err instanceof Error ? err.message : String(err));
    }
  }, [account, adapter, active, quote, evmQuote, feeEnabled, fromToken, toToken, flow, recordApproval]);

  // ── Render ──────────────────────────────────────────────────────────
  if (!active || !account) {
    return (
      <div style={{ padding: 'var(--ow-space-4)' }}>
        <p>{t('swap.noAccount')}</p>
        {accounts.length > 0 && !hasZeroExKey() && (
          <p style={{ fontSize: 'var(--ow-font-size-sm)', opacity: 0.7 }}>{t('swap.evmNeedsKey')}</p>
        )}
        <Button onClick={() => navigate('/')}>{t('common.back')}</Button>
      </div>
    );
  }

  const settled =
    flow.status === 'confirmed' || flow.status === 'failed' || flow.status === 'pending';
  // While a second EVM transaction is still coming, the approval's own
  // "confirmed" must not be mistaken for the end of the swap.
  const showResult = settled && stage === null;
  const busy = stage !== null || ['building', 'signing', 'broadcasting'].includes(flow.status);
  const hasQuote = active.kind === 'solana' ? quote !== null : evmQuote !== null;

  return (
    <div style={{ padding: 'var(--ow-space-4)', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)', marginBottom: 'var(--ow-space-4)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
        </Button>
        <h2 style={{ margin: 0 }}>{t('swap.title')}</h2>
      </div>

      {!showResult ? (
        <>
          {/* Network — hidden when only one is routable, rather than a
              one-item dropdown that looks broken */}
          {chainOptions.length > 1 && (
            <div style={{ marginBottom: 'var(--ow-space-3)' }}>
              <div style={{ fontSize: 'var(--ow-font-size-sm)', marginBottom: 'var(--ow-space-1)' }}>
                {t('swap.network')}
              </div>
              <select
                value={activeChainId}
                onChange={e => setChainId(e.target.value)}
                style={{ width: '100%', padding: 'var(--ow-space-2)', borderRadius: 'var(--ow-radius-md)' }}
              >
                {chainOptions.map(o => <option key={o.chainId} value={o.chainId}>{o.label}</option>)}
              </select>
            </div>
          )}

          <TokenSelect
            label={t('swap.from')}
            value={fromToken}
            presets={presets}
            onChange={setFromToken}
            custom={customFrom}
            onCustomChange={setCustomFrom}
            onCustomApply={() => { void applyCustom('from'); }}
          />
          <div style={{ textAlign: 'center', margin: 'var(--ow-space-2) 0' }}>
            <Button variant="ghost" size="sm" onClick={flip} aria-label="flip">
              <ArrowDownUp size={16} />
            </Button>
          </div>
          <TokenSelect
            label={t('swap.to')}
            value={toToken}
            presets={presets}
            onChange={setToToken}
            custom={customTo}
            onCustomChange={setCustomTo}
            onCustomApply={() => { void applyCustom('to'); }}
          />

          <div style={{ marginTop: 'var(--ow-space-3)' }}>
            <Input
              label={t('swap.amountLabel', { symbol: fromToken.symbol })}
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              error={insufficient ? t('swap.notEnoughBalance', { symbol: fromToken.symbol }) : undefined}
            />
            {/* always visible — an RPC failure shows “—”, not a silent gap
                (the overspend guard simply stays inert without a balance) */}
            <div style={{ fontSize: 'var(--ow-font-size-sm)', opacity: 0.7 }}>
              {t('swap.balance', { balance: fromBalance === null ? '—' : formatBalance(fromBalance, fromToken.decimals, 4) })}
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
            {!quoting && !hasQuote && !quoteError && !amountRaw && <span>{t('swap.enterAmount')}</span>}

            {!quoting && quote && (
              <div style={{ display: 'grid', gap: 'var(--ow-space-1)', fontSize: 'var(--ow-font-size-sm)' }}>
                <div style={{ fontSize: 'var(--ow-font-size-lg)', fontWeight: 700 }}>
                  ≈ {formatBalance(quote.outAmount, toToken.decimals, 6)} {toToken.symbol}
                </div>
                <div>{t('swap.minReceived')}: {formatBalance(quote.otherAmountThreshold, toToken.decimals, 6)}</div>
                <div>{t('swap.priceImpact')}: {(Number(quote.priceImpactPct) * 100).toFixed(2)}%</div>
                {feeEnabled && <div>{t('swap.fee')}: {(SWAP_FEE_BPS / 100).toFixed(2)}%</div>}
              </div>
            )}

            {!quoting && evmQuote && (
              <div style={{ display: 'grid', gap: 'var(--ow-space-1)', fontSize: 'var(--ow-font-size-sm)' }}>
                <div style={{ fontSize: 'var(--ow-font-size-lg)', fontWeight: 700 }}>
                  ≈ {formatBalance(evmQuote.buyAmount, toToken.decimals, 6)} {toToken.symbol}
                </div>
                <div>{t('swap.minReceived')}: {formatBalance(evmQuote.minBuyAmount, toToken.decimals, 6)}</div>
                {/* 0x already reports this in percent (0.42 = 0.42%) */}
                {evmQuote.priceImpactPct !== undefined && (
                  <div>{t('swap.priceImpact')}: {evmQuote.priceImpactPct.toFixed(2)}%</div>
                )}
                {evmFeeEnabled && <div>{t('swap.fee')}: {(SWAP_FEE_BPS_EVM / 100).toFixed(2)}%</div>}
                {!evmQuote.liquidityAvailable && (
                  <div style={{ color: 'var(--ow-danger)' }}>{t('swap.noLiquidity')}</div>
                )}
                {evmQuote.approval && (
                  <div style={{ opacity: 0.75 }}>{t('swap.needsApproval', { symbol: fromToken.symbol })}</div>
                )}
              </div>
            )}
          </div>

          <Button
            size="lg"
            style={{ width: '100%', marginTop: 'var(--ow-space-4)' }}
            disabled={!hasQuote || quoting || busy || insufficient || evmQuote?.liquidityAvailable === false}
            onClick={() => { void handleSwap(); }}
          >
            {busy ? <Loader2 size={16} /> : t('swap.execute', { symbol: toToken.symbol })}
          </Button>

          {stage === 'approve' && (
            <p style={{ fontSize: 'var(--ow-font-size-sm)', opacity: 0.75 }}>
              {t('swap.approvingStep', { symbol: fromToken.symbol })}
            </p>
          )}
          {flow.error && <p style={{ color: 'var(--ow-danger)' }}>{flow.error}</p>}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 'var(--ow-space-6) 0' }}>
          <p style={{ fontWeight: 700 }}>
            {flow.status === 'confirmed' && `✅ ${t('swap.confirmed')}`}
            {flow.status === 'pending' && `⏳ ${t('swap.pending')}`}
            {flow.status === 'failed' && `❌ ${t('swap.failed')}`}
          </p>
          {flow.txHash && active.explorer && (
            <a href={`${active.explorer}/tx/${flow.txHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {flow.txHash.slice(0, 12)}… <ExternalLink size={12} />
            </a>
          )}
          <div style={{ marginTop: 'var(--ow-space-4)', display: 'flex', gap: 'var(--ow-space-2)', justifyContent: 'center' }}>
            <Button onClick={() => { flow.reset(); setAmount(''); setQuote(null); setEvmQuote(null); }}>
              {t('swap.another')}
            </Button>
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
  presets: TokenChoice[];
  onChange: (t: TokenChoice) => void;
  custom: string;
  onCustomChange: (v: string) => void;
  onCustomApply: () => void;
}

function TokenSelect({ label, value, presets, onChange, custom, onCustomChange, onCustomApply }: TokenSelectProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ fontSize: 'var(--ow-font-size-sm)', marginBottom: 'var(--ow-space-1)' }}>{label}</div>
      <div style={{ display: 'flex', gap: 'var(--ow-space-2)', alignItems: 'center' }}>
        <select
          value={presets.some(p => p.address === value.address) ? value.address : 'custom'}
          onChange={e => {
            const preset = presets.find(p => p.address === e.target.value);
            if (preset) onChange(preset);
          }}
          style={{ padding: 'var(--ow-space-2)', borderRadius: 'var(--ow-radius-md)', minWidth: 120 }}
        >
          {presets.map(p => <option key={p.address} value={p.address}>{p.symbol}</option>)}
          <option value="custom" disabled>{t('swap.custom')}</option>
        </select>
        <span style={{ fontSize: 'var(--ow-font-size-sm)', opacity: 0.7 }}>{value.symbol}</span>
      </div>
      <div style={{ display: 'flex', gap: 'var(--ow-space-2)', marginTop: 'var(--ow-space-1)' }}>
        <input
          placeholder={t('swap.customTokenPlaceholder')}
          value={custom}
          onChange={e => onCustomChange(e.target.value)}
          style={{ flex: 1, padding: 'var(--ow-space-2)', borderRadius: 'var(--ow-radius-md)', border: '1px solid var(--ow-border)' }}
        />
        <Button size="sm" variant="secondary" onClick={onCustomApply} disabled={!custom.trim()}>{t('swap.useToken')}</Button>
      </div>
    </div>
  );
}
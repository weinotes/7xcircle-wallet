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
 * Earn page — 赚币生息 via liquid staking (web + extension twin of the
 * mobile Earn tab).
 *
 * Stake = Jupiter-routed SOL → LST; unstake = the reverse. Execution runs
 * through the SAME useTxFlow.sendExternal pipeline as swaps, so key
 * lifetime and retry semantics are identical everywhere in the product.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, Input } from '@open-wallet/ui';
import { chainRegistry } from '@open-wallet/core';
import {
  SOLANA_STAKE_PRODUCTS,
  SOL_MINT,
  fetchQuote,
  fetchStakeApy,
  fetchSwapTransaction,
  setJupiterBaseUrl,
  type StakeProduct,
  type StakeApy,
} from '@open-wallet/chains';
import { formatBalance, parseAmount } from '@open-wallet/shared';
import { useWalletStore } from '../store/wallet.js';
import { useTxFlow } from '../hooks/useTxFlow.js';
import { SWAP_CHAIN_ID, JUPITER_BASE_URL } from '../config.js';

setJupiterBaseUrl(JUPITER_BASE_URL);

const EARN_SLIPPAGE_BPS = 100;

export function Earn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accounts = useWalletStore(s => s.accounts);
  const account = accounts.find(a => a.chainId === SWAP_CHAIN_ID);
  const adapter = chainRegistry.get(SWAP_CHAIN_ID);
  const flow = useTxFlow({ adapter, account, chainId: SWAP_CHAIN_ID, feeTier: 'fast' });

  const [apys, setApys] = useState<Record<string, StakeApy | 'loading' | 'error'>>({});
  const [held, setHeld] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<{ product: StakeProduct; dir: 'stake' | 'unstake' } | null>(null);

  // live APY per product
  useEffect(() => {
    let cancelled = false;
    setApys(Object.fromEntries(SOLANA_STAKE_PRODUCTS.map(p => [p.symbol, 'loading' as const])));
    for (const p of SOLANA_STAKE_PRODUCTS) {
      fetchStakeApy(p)
        .then(a => { if (!cancelled) setApys(prev => ({ ...prev, [p.symbol]: a })); })
        .catch(() => { if (!cancelled) setApys(prev => ({ ...prev, [p.symbol]: 'error' })); });
    }
    return () => { cancelled = true; };
  }, []);

  // current LST holdings from the Solana token list
  useEffect(() => {
    if (!account || !adapter) return;
    let cancelled = false;
    adapter.getAllTokenBalances(account.address)
      .then(list => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const p of SOLANA_STAKE_PRODUCTS) {
          map[p.symbol] = list.find(x => x.address === p.mint)?.balance ?? '0';
        }
        setHeld(map);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [account, adapter]);

  const execute = useCallback(async (quoteParams: { inputMint: string; outputMint: string; amountRaw: string }, product: StakeProduct, dir: 'stake' | 'unstake') => {
    if (!account || !adapter) return;
    const quote = await fetchQuote({ ...quoteParams, slippageBps: EARN_SLIPPAGE_BPS });
    const txBase64 = await fetchSwapTransaction({ quote, userPublicKey: account.address });
    await flow.sendExternal(
      { encoding: 'base64', payload: txBase64, versioned: true },
      {
        displayTo: `${dir === 'stake' ? 'stake' : 'unstake'} ${product.symbol}`,
        amountRaw: quote.outAmount,
        token: {
          symbol: dir === 'stake' ? product.symbol : 'SOL',
          address: dir === 'stake' ? product.mint : SOL_MINT,
          decimals: 9,
          isNative: dir === 'unstake',
        },
      },
    );
  }, [account, adapter, flow]);

  if (!account) {
    return (
      <div style={{ padding: 'var(--ow-space-4)' }}>
        <p>{t('earn.noSolanaAccount')}</p>
        <Button onClick={() => navigate('/')}>{t('common.back')}</Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--ow-space-4)', maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-3)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft size={16} /></Button>
        <span style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>{t('earn.title')}</span>
      </div>
      <p style={{ margin: 0, fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-text-secondary)' }}>
        {t('earn.intro')}
      </p>

      {flow.status !== 'idle' && (
        <div style={{ fontSize: 'var(--ow-font-size-sm)', color: flow.status === 'failed' ? 'var(--ow-error)' : 'var(--ow-text-secondary)' }}>
          {flow.error
            ?? (flow.status === 'confirmed' ? t('earn.done')
              : flow.status === 'pending' ? t('earn.pending')
              : t('earn.working'))}
          {flow.status === 'confirmed' && flow.txHash && (
            <span> · {flow.txHash.slice(0, 12)}…</span>
          )}
        </div>
      )}

      {SOLANA_STAKE_PRODUCTS.map(product => {
        const apy = apys[product.symbol];
        const balance = held[product.symbol];
        const isOpen = open?.product.symbol === product.symbol;
        return (
          <div key={product.symbol} style={{
            backgroundColor: 'var(--ow-bg-secondary)',
            border: '1px solid var(--ow-border)',
            borderRadius: 'var(--ow-radius-lg)',
            padding: 'var(--ow-space-4)',
            display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{product.symbol}</div>
                <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
                  {product.provider} · {product.name}
                </div>
              </div>
              <div style={{ fontWeight: 700, color: 'var(--ow-accent)' }}>
                {apy === 'loading' || apy === undefined ? '…' : apy === 'error' ? '—' : `${apy.apy.toFixed(2)}%`}
              </div>
            </div>
            {typeof apy === 'object' && (
              <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
                TVL ${(apy.tvlUsd / 1e6).toFixed(0)}M · {apy.asOf.slice(0, 10)}
              </div>
            )}
            <div style={{ fontSize: 'var(--ow-font-size-sm)' }}>
              {t('earn.holding', { amount: formatBalance(balance ?? '0', product.decimals, 4), symbol: product.symbol })}
            </div>
            <div style={{ display: 'flex', gap: 'var(--ow-space-2)' }}>
              <Button size="sm" onClick={() => setOpen(isOpen && open?.dir === 'stake' ? null : { product, dir: 'stake' })}>
                {t('earn.stake')}
              </Button>
              <Button size="sm" variant="secondary" disabled={!balance || balance === '0'}
                onClick={() => setOpen(isOpen && open?.dir === 'unstake' ? null : { product, dir: 'unstake' })}>
                {t('earn.unstake')}
              </Button>
            </div>
            {isOpen && open.dir === 'stake' && (
              <StakeForm product={product} dir={open.dir} flowBusy={['building', 'signing', 'broadcasting'].includes(flow.status)} onExecute={execute} onDone={() => setOpen(null)} />
            )}
            {isOpen && open.dir === 'unstake' && (
              <StakeForm product={product} dir={open.dir} heldRaw={balance ?? '0'} flowBusy={['building', 'signing', 'broadcasting'].includes(flow.status)} onExecute={execute} onDone={() => setOpen(null)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Amount + live preview + confirm for one product/direction */
function StakeForm({
  product,
  dir,
  heldRaw,
  flowBusy,
  onExecute,
  onDone,
}: {
  product: StakeProduct;
  dir: 'stake' | 'unstake';
  heldRaw?: string;
  flowBusy: boolean;
  onExecute: (p: { inputMint: string; outputMint: string; amountRaw: string }, product: StakeProduct, dir: 'stake' | 'unstake') => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const seq = useRef(0);

  const inputMint = dir === 'stake' ? SOL_MINT : product.mint;
  const outputMint = dir === 'stake' ? product.mint : SOL_MINT;
  const outSymbol = dir === 'stake' ? product.symbol : 'SOL';

  useEffect(() => {
    const my = ++seq.current;
    setPreview('');
    setError('');
    if (!amount || Number(amount) <= 0) return;
    let raw: string;
    try {
      raw = parseAmount(amount, 9);
    } catch {
      setError(t('earn.invalidAmount'));
      return;
    }
    const timer = setTimeout(() => {
      fetchQuote({ inputMint, outputMint, amountRaw: raw, slippageBps: EARN_SLIPPAGE_BPS })
        .then(q => { if (seq.current === my) setPreview(`≈ ${formatBalance(q.outAmount, 9, 4)} ${outSymbol}`); })
        .catch(e => { if (seq.current === my) setError(String(e instanceof Error ? e.message : e)); });
    }, 450);
    return () => clearTimeout(timer);
  }, [amount, inputMint, outputMint, outSymbol, t]);

  const submit = async () => {
    if (!amount || Number(amount) <= 0) return;
    if (dir === 'unstake' && heldRaw && BigInt(parseAmount(amount, 9)) > BigInt(heldRaw)) {
      setError(t('earn.tooMuchToUnstake'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onExecute({ inputMint, outputMint, amountRaw: parseAmount(amount, 9) }, product, dir);
      setAmount('');
      onDone();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-2)', borderTop: '1px solid var(--ow-border)', paddingTop: 'var(--ow-space-3)' }}>
      <Input
        label={dir === 'stake' ? t('earn.stakeAmount') : t('earn.unstakeAmount', { symbol: product.symbol })}
        placeholder={dir === 'stake' ? '0.0' : `max ${formatBalance(heldRaw ?? '0', 9, 4)}`}
        value={amount}
        onChange={e => setAmount(e.target.value)}
      />
      {preview && <div style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-text-secondary)' }}>{preview}</div>}
      {error && <div style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-error)' }}>{error}</div>}
      <Button size="sm" onClick={submit} loading={submitting || flowBusy} disabled={!amount}>
        {dir === 'stake' ? t('earn.confirmStake') : t('earn.confirmUnstake')}
      </Button>
      <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>{product.exitNote}</div>
    </div>
  );
}

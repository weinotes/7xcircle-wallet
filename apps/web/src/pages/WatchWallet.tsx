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
 * distributed under the License is an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Watch wallet page — monitor addresses without holding keys.
 *
 * Users can add any public address to watch its balances and transactions
 * across chains. Common use case: tracking whale wallets for MEME trading.
 *
 * Read-only: no signing, no sending. The store persists watch addresses
 * so they survive locks and reloads.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, Trash2, Eye, Copy, Check, ExternalLink, Loader2, Inbox } from 'lucide-react';
import { Button, Input, Card, EmptyState } from '@7xcircle/ui';
import { useWalletStore, type WatchEntry } from '../store/wallet.js';
import { CHAIN_CONFIGS } from '@7xcircle/chains';
import { chainRegistry } from '@7xcircle/core';
import { formatBalance } from '@7xcircle/shared';

/** Balance snapshot for a watched address */
interface WatchedBalance {
  entry: WatchEntry;
  nativeBalance: string;
  nativeSymbol: string;
  nativeDecimals: number;
  nativeUsd?: number;
  loading: boolean;
  error: string | null;
}

export function WatchWallet() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const watchAddresses = useWalletStore(s => s.watchAddresses);
  const addWatchAddress = useWalletStore(s => s.addWatchAddress);
  const removeWatchAddress = useWalletStore(s => s.removeWatchAddress);
  const activeChainId = useWalletStore(s => s.activeChainId);

  const [showAdd, setShowAdd] = useState(false);
  const [inputAddress, setInputAddress] = useState('');
  const [inputChain, setInputChain] = useState(activeChainId);
  const [inputLabel, setInputLabel] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [balances, setBalances] = useState<Map<string, WatchedBalance>>(new Map());

  // ── Fetch balances for all watched addresses ──
  useEffect(() => {
    if (watchAddresses.length === 0) {
      setBalances(new Map());
      return;
    }

    const cancelled = { current: false };

    for (const entry of watchAddresses) {
      const key = `${entry.chainId}:${entry.address}`;
      const adapter = chainRegistry.get(entry.chainId);
      const chain = CHAIN_CONFIGS.find(c => c.chainId === entry.chainId);

      // Set loading state
      setBalances(prev => {
        const next = new Map(prev);
        next.set(key, {
          entry,
          nativeBalance: '0',
          nativeSymbol: chain?.nativeSymbol ?? '',
          nativeDecimals: chain?.nativeDecimals ?? 18,
          loading: true,
          error: null,
        });
        return next;
      });

      if (!adapter || !chain) {
        setBalances(prev => {
          const next = new Map(prev);
          next.set(key, {
            entry,
            nativeBalance: '0',
            nativeSymbol: chain?.nativeSymbol ?? '',
            nativeDecimals: chain?.nativeDecimals ?? 18,
            loading: false,
            error: t('watch.chainUnavailable'),
          });
          return next;
        });
        continue;
      }

      adapter.getNativeBalance(entry.address)
        .then(bal => {
          if (cancelled.current) return;
          setBalances(prev => {
            const next = new Map(prev);
            next.set(key, {
              entry,
              nativeBalance: bal,
              nativeSymbol: chain.nativeSymbol,
              nativeDecimals: chain.nativeDecimals,
              loading: false,
              error: null,
            });
            return next;
          });
        })
        .catch(err => {
          if (cancelled.current) return;
          setBalances(prev => {
            const next = new Map(prev);
            next.set(key, {
              entry,
              nativeBalance: '0',
              nativeSymbol: chain.nativeSymbol,
              nativeDecimals: chain.nativeDecimals,
              loading: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
            return next;
          });
        });
    }

    return () => { cancelled.current = true; };
  }, [watchAddresses]);

  // ── Add handler ──
  const handleAdd = () => {
    setInputError(null);
    const trimmed = inputAddress.trim();
    if (!trimmed) {
      setInputError(t('watch.addressRequired'));
      return;
    }

    const adapter = chainRegistry.get(inputChain);
    if (adapter && !adapter.validateAddress(trimmed)) {
      setInputError(t('watch.invalidAddress'));
      return;
    }

    addWatchAddress({
      address: trimmed,
      chainId: inputChain,
      label: inputLabel.trim() || undefined,
      addedAt: Date.now(),
    });

    setInputAddress('');
    setInputLabel('');
    setShowAdd(false);
  };

  // ── Copy to clipboard ──
  const handleCopy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard API may fail in non-secure contexts
    }
  };

  const cardStyle: React.CSSProperties = {
    maxWidth: 560,
    margin: '0 auto',
    padding: 'var(--ow-space-6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--ow-space-4)',
    marginTop: '5vh',
  };

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div className="ow-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)' }}>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
          </Button>
          <div style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>{t('watch.title')}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={16} />
        </Button>
      </div>

      {/* Empty state */}
      {!showAdd && watchAddresses.length === 0 && (
        <Card>
          <EmptyState
            icon={<Eye size={28} />}
            title={t('watch.emptyTitle')}
            description={t('watch.emptyDesc')}
            action={
              <Button onClick={() => setShowAdd(true)}>
                <Plus size={14} /> {t('watch.addFirst')}
              </Button>
            }
          />
        </Card>
      )}

      {/* Watched addresses list */}
      {watchAddresses.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {watchAddresses.map(entry => {
            const key = `${entry.chainId}:${entry.address}`;
            const bal = balances.get(key);
            const chain = CHAIN_CONFIGS.find(c => c.chainId === entry.chainId);
            const explorer = chain?.explorer;

            return (
              <div key={key} style={{
                padding: '14px 16px',
                backgroundColor: 'var(--ow-bg-secondary)',
                borderRadius: 'var(--ow-radius-lg)',
                border: '1px solid var(--ow-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                {/* Top row: label + chain + remove */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Eye size={14} style={{ color: 'var(--ow-text-tertiary)', flexShrink: 0 }} />
                    {entry.label && (
                      <span style={{ fontWeight: 600, fontSize: 'var(--ow-font-size-sm)' }}>
                        {entry.label}
                      </span>
                    )}
                    <span style={{
                      fontSize: 'var(--ow-font-size-xs)',
                      color: 'var(--ow-text-tertiary)',
                      backgroundColor: 'var(--ow-bg-tertiary)',
                      padding: '2px 6px',
                      borderRadius: 'var(--ow-radius-sm)',
                    }}>
                      {chain?.name ?? entry.chainId}
                    </span>
                  </div>
                  <button
                    onClick={() => removeWatchAddress(entry.chainId, entry.address)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--ow-text-tertiary)',
                      padding: 4,
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Address + copy + explorer */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--ow-font-size-xs)' }}>
                  <span className="ow-mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ow-text-secondary)' }}>
                    {entry.address}
                  </span>
                  <button
                    onClick={() => handleCopy(entry.address)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ow-text-tertiary)', padding: 2 }}
                  >
                    {copied === entry.address ? <Check size={12} style={{ color: 'var(--ow-positive)' }} /> : <Copy size={12} />}
                  </button>
                  {explorer && (
                    <a
                      href={`${explorer}/address/${entry.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--ow-text-tertiary)', display: 'flex' }}
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>

                {/* Balance */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {bal?.loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ow-text-tertiary)', fontSize: 'var(--ow-font-size-xs)' }}>
                      <Loader2 size={12} style={{ animation: 'ow-spin 1s linear infinite' }} />
                      {t('watch.fetchingBalance')}
                    </div>
                  ) : bal?.error ? (
                    <span style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-error)' }}>
                      {bal.error}
                    </span>
                  ) : bal ? (
                    <span className="ow-mono" style={{ fontWeight: 600, fontSize: 'var(--ow-font-size-base)' }}>
                      {formatBalance(bal.nativeBalance, bal.nativeDecimals, 6)} {bal.nativeSymbol}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add address form */}
      {showAdd && (
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-3)' }}>
          <div style={{ fontSize: 'var(--ow-font-size-sm)', fontWeight: 600 }}>{t('watch.addTitle')}</div>

          {/* Chain selector */}
          <div>
            <label style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)', display: 'block', marginBottom: 4 }}>
              {t('watch.chainLabel')}
            </label>
            <select
              value={inputChain}
              onChange={e => setInputChain(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: 'var(--ow-bg-secondary)',
                color: 'var(--ow-text-primary)',
                border: '1px solid var(--ow-border)',
                borderRadius: 'var(--ow-radius-md)',
                fontSize: 'var(--ow-font-size-sm)',
              }}
            >
              {CHAIN_CONFIGS.map(c => (
                <option key={c.chainId} value={c.chainId}>{c.name} ({c.nativeSymbol})</option>
              ))}
            </select>
          </div>

          <Input
            label={t('watch.addressLabel')}
            placeholder={t('watch.addressPlaceholder')}
            value={inputAddress}
            onChange={e => { setInputAddress(e.target.value); setInputError(null); }}
            error={inputError ?? undefined}
          />

          <Input
            label={t('watch.labelLabel')}
            placeholder={t('watch.labelPlaceholder')}
            value={inputLabel}
            onChange={e => setInputLabel(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" size="sm" onClick={() => { setShowAdd(false); setInputError(null); }}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleAdd}>
              <Plus size={14} /> {t('watch.add')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

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
 * Transaction history page.
 *
 * Data source: useTransactionHistory hook, which merges:
 *   - Locally-known pending txs (from wallet store)
 *   - Block explorer API (confirmed/failed history)
 *
 * Supports EVM (Etherscan) and Solana (native RPC) adapters — the
 * adapter handles the chain-specific fetch logic, this page only
 * renders the unified TransactionRecord shape.
 */

import { useEffect, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Clock, CheckCircle2, XCircle, RefreshCw, ExternalLink, Inbox } from 'lucide-react';
import { Button, IconButton, Card, Skeleton, EmptyState } from '@7xcircle/ui';
import { useWalletStore } from '../store/wallet.js';
import { CHAIN_CONFIGS } from '@7xcircle/chains';
import { useTransactionHistory } from '../hooks/useTransactionHistory.js';
import { chainRegistry } from '@7xcircle/core';
import { formatBalance } from '@7xcircle/shared';
import type { TransactionRecord } from '@7xcircle/shared';

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function formatTime(ts: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return t('history.justNow');
  if (diffMin < 60) return t('history.minutesAgo', { n: diffMin });
  if (diffHr < 24) return t('history.hoursAgo', { n: diffHr });
  if (diffDay < 7) return t('history.daysAgo', { n: diffDay });
  return d.toLocaleDateString();
}

function StatusBadge({ status, t }: { status: TransactionRecord['status']; t: (key: string) => string }) {
  const styles: Record<TransactionRecord['status'], { bg: string; color: string; icon: JSX.Element; label: string }> = {
    pending: {
      bg: 'var(--ow-pending-bg)',
      color: 'var(--ow-pending)',
      icon: <Clock size={12} />,
      label: t('history.pending'),
    },
    confirmed: {
      bg: 'var(--ow-success-bg)',
      color: 'var(--ow-positive)',
      icon: <CheckCircle2 size={12} />,
      label: t('history.confirmed'),
    },
    failed: {
      bg: 'var(--ow-error-bg)',
      color: 'var(--ow-negative)',
      icon: <XCircle size={12} />,
      label: t('history.failed'),
    },
  };
  const s = styles[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 'var(--ow-radius-full)',
      fontSize: 'var(--ow-font-size-xs)',
      fontWeight: 600,
      backgroundColor: s.bg,
      color: s.color,
    }}>
      {s.icon}{s.label}
    </span>
  );
}

export function History() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const activeChainId = useWalletStore(s => s.activeChainId);
  const accounts = useWalletStore(s => s.accounts);
  const fromAccount = accounts.find(a => a.chainId === activeChainId);
  const activeChain = CHAIN_CONFIGS.find(c => c.chainId === activeChainId);
  const adapter = chainRegistry.get(activeChainId);

  const { transactions, loading, error, refresh } = useTransactionHistory(
    activeChainId,
    fromAccount?.address,
  );

  // Periodic refresh while we have pending txs — explorer picks them up ~10-30s after broadcast
  const hasPending = transactions.some(t => t.status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => refresh(), 15000);
    return () => clearInterval(timer);
  }, [hasPending, refresh]);

  const getExplorerUrl = (txHash: string) => adapter?.getExplorerTxUrl?.(txHash) ?? null;

  function formatAmount(tx: TransactionRecord): { text: string; symbol: string; isPositive: boolean } {
    if (tx.tokenSymbol) {
      // ERC20/BEP20/SPL token — use tokenDecimals from explorer (fallback 18)
      const decimals = tx.tokenDecimals ?? 18;
      const amount = formatBalance(tx.value, decimals, 6);
      return { text: amount, symbol: tx.tokenSymbol, isPositive: tx.direction === 'received' };
    }
    const decimals = activeChain?.nativeDecimals ?? 18;
    const amount = formatBalance(tx.value, decimals, 6);
    return { text: amount, symbol: activeChain?.nativeSymbol ?? '', isPositive: tx.direction === 'received' };
  }

  const cardStyle: React.CSSProperties = {
    maxWidth: 720,
    margin: '0 auto',
    padding: 'var(--ow-space-6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--ow-space-4)',
    marginTop: '5vh',
  };

  const listItemStyle = (status: TransactionRecord['status']): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--ow-space-3)',
    padding: '14px 16px',
    backgroundColor: status === 'pending' ? 'var(--ow-pending-bg)' : 'var(--ow-bg-secondary)',
    borderRadius: 'var(--ow-radius-lg)',
    border: status === 'pending' ? '1px solid var(--ow-pending)' : '1px solid var(--ow-border)',
    transition: 'background-color var(--ow-duration-fast) var(--ow-ease)',
  });

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div className="ow-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)' }}>
          <IconButton aria-label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
          </IconButton>
          <div style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>{t('history.title')}</div>
        </div>
        <IconButton aria-label={t('history.refreshAria')} onClick={refresh} disabled={loading}>
          <RefreshCw size={16} style={loading ? { animation: 'ow-spin 1s linear infinite' } : undefined} />
        </IconButton>
      </div>

      {/* Chain label */}
      <div style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-text-secondary)' }}>
        {activeChain?.name ?? activeChainId} · <span className="ow-mono">{fromAccount ? truncateHash(fromAccount.address) : '—'}</span>
      </div>

      {/* Error state */}
      {error && (
        <div role="alert" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ow-space-3)',
          padding: 'var(--ow-space-3) var(--ow-space-4)',
          borderRadius: 'var(--ow-radius-lg)',
          backgroundColor: 'var(--ow-error-bg)',
          color: 'var(--ow-negative-fg)',
          fontSize: 'var(--ow-font-size-sm)',
        }}>
          {t('history.failedToLoad', { error })}
          <Button variant="ghost" size="sm" onClick={refresh} style={{ marginLeft: 'auto', flexShrink: 0 }}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && transactions.length === 0 && (
        <Card>
          <EmptyState
            icon={<Inbox size={28} />}
            title={t('history.noTxTitle')}
            description={t('history.noTxDesc', { chain: activeChain?.name ?? '' })}
            action={
              <Button onClick={() => navigate('/send')}>{t('history.send', { symbol: activeChain?.nativeSymbol ?? '' })}</Button>
            }
          />
        </Card>
      )}

      {/* Loading skeleton */}
      {loading && transactions.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label={t('common.loading')}>
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} height={58} style={{ borderRadius: 'var(--ow-radius-lg)' }} />
          ))}
        </div>
      )}

      {/* Transaction list */}
      {transactions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {transactions.map(tx => {
            const amt = formatAmount(tx);
            const explorerUrl = getExplorerUrl(tx.hash);
            const isTokenTransfer = !!tx.tokenSymbol;

            return (
              <div key={tx.hash} style={listItemStyle(tx.status)}>
                {/* Left: direction icon + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    flexShrink: 0,
                    borderRadius: 'var(--ow-radius-full)',
                    backgroundColor: tx.direction === 'sent' ? 'var(--ow-error-bg)' : 'var(--ow-success-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: tx.direction === 'sent' ? 'var(--ow-negative)' : 'var(--ow-positive)',
                  }}>
                    {tx.direction === 'sent' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {isTokenTransfer ? (
                          tx.direction === 'sent' ? t('history.sentToken', { symbol: tx.tokenSymbol }) : t('history.receivedToken', { symbol: tx.tokenSymbol })
                        ) : (
                          tx.direction === 'sent' ? t('history.sent') : t('history.received')
                        )}
                      </span>
                      <StatusBadge status={tx.status} t={t} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ow-text-secondary)' }}>
                      {formatTime(tx.blockTimestamp, t)}
                      {explorerUrl && (
                        <a href={explorerUrl} target="_blank" rel="noopener noreferrer" style={{
                          marginLeft: 6,
                          color: 'var(--ow-text-secondary)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                        }}>
                          {truncateHash(tx.hash)}
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: amount */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="ow-mono" style={{
                    fontWeight: 600,
                    fontSize: 'var(--ow-font-size-base)',
                    color: amt.isPositive ? 'var(--ow-positive-fg)' : 'var(--ow-text-primary)',
                  }}>
                    {amt.isPositive ? '+' : '-'}{amt.text}
                  </div>
                  <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-secondary)' }}>
                    {amt.symbol}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      {transactions.length > 0 && (
        <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-secondary)', textAlign: 'center', marginTop: 'var(--ow-space-2)' }}>
          {t('history.showing', { count: transactions.length })}
          {hasPending && <span style={{ marginLeft: 6, color: 'var(--ow-pending)' }}>{t('history.autoRefreshing')}</span>}
        </div>
      )}
    </div>
  );
}

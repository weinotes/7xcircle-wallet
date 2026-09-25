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
 * Home page — Multi-chain asset overview, chain selector, quick actions.
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │  Header: chain selector | lock btn  │
 *   ├─────────────────────────────────────┤
 *   │  Total balance (native + tokens)     │
 *   │  Token list (native + ERC20/BEP20)  │
 *   ├─────────────────────────────────────┤
 *   │  [Send] [Receive] [History] [Lock]  │
 *   ├─────────────────────────────────────┤
 *   │  Recent transactions (top 3)         │
 *   └─────────────────────────────────────┘
 *
 * NOTE: This page only renders when store.unlocked === true.
 * All chain queries use accounts derived during unlock().
 */

import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, Send, ArrowLeftRight, TrendingUp, ArrowDownToLine, History as HistoryIcon, Settings, ArrowUpRight, ArrowDownLeft, Coins, RefreshCw, Plug } from 'lucide-react';
import { Button } from '@open-wallet/ui';
import { useWalletStore } from '../store/wallet.js';
import { chainRegistry } from '@open-wallet/core';
import { CHAIN_CONFIGS } from '@open-wallet/chains';
import { formatBalance } from '@open-wallet/shared';
import type { TokenBalance } from '@open-wallet/shared';
import { useTransactionHistory } from '../hooks/useTransactionHistory.js';

export function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const activeChainId = useWalletStore(s => s.activeChainId);
  const setActiveChain = useWalletStore(s => s.setActiveChain);
  const accounts = useWalletStore(s => s.accounts);
  const lock = useWalletStore(s => s.lock);

  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);

  const activeChain = CHAIN_CONFIGS.find(c => c.chainId === activeChainId);
  const currentAccount = accounts.find(a => a.chainId === activeChainId);
  const adapter = chainRegistry.get(activeChainId);

  const { transactions: allTxs, loading: historyLoading } = useTransactionHistory(
    activeChainId,
    currentAccount?.address,
  );
  const recentTxs = allTxs.slice(0, 3);

  // ── Fetch all token balances ──────────────────────────────────────
  const fetchTokens = useCallback(async () => {
    if (!adapter || !currentAccount) return;

    setTokensLoading(true);
    setTokensError(null);
    try {
      const list = await adapter.getAllTokenBalances(currentAccount.address);
      // Sort: native first, then by balance desc (amount > 0)
      list.sort((a, b) => {
        if (a.isNative !== b.isNative) return a.isNative ? -1 : 1;
        const aBal = BigInt(a.balance || '0');
        const bBal = BigInt(b.balance || '0');
        return bBal > aBal ? 1 : bBal < aBal ? -1 : 0;
      });
      setTokens(list);
    } catch (e) {
      setTokensError((e as Error).message);
      // Fall back to native-only via RPC
      try {
        const nativeBal = await adapter.getNativeBalance(currentAccount.address);
        setTokens([{
          address: 'native',
          symbol: activeChain?.nativeSymbol ?? '',
          name: activeChain?.nativeSymbol ?? '',
          decimals: activeChain?.nativeDecimals ?? 18,
          chainId: activeChainId,
          isNative: true,
          balance: nativeBal,
        }]);
      } catch { /* ignore */ }
    } finally {
      setTokensLoading(false);
    }
  }, [adapter, currentAccount?.address, activeChain, activeChainId]);

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

  const goSendToken = (tokenAddress: string | null, tokenSymbol: string) => {
    // Build a URL with optional token prefill via search params in a future
    // version — for now just go to /send; user selects ERC20 there
    navigate('/send');
    void tokenAddress; void tokenSymbol; // silence unused
  };

  const contentStyle: React.CSSProperties = {
    maxWidth: 720,
    margin: '0 auto',
    padding: 'var(--ow-space-6)',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--ow-space-6)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const balanceCardStyle: React.CSSProperties = {
    backgroundColor: 'var(--ow-bg-secondary)',
    borderRadius: 'var(--ow-radius-xl)',
    padding: 'var(--ow-space-8)',
    border: '1px solid var(--ow-border)',
    textAlign: 'center',
  };

  const actionRowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--ow-space-3)',
  };

  const chainSelector = (
    <select
      value={activeChainId}
      onChange={e => setActiveChain(e.target.value)}
      style={{
        backgroundColor: 'var(--ow-bg-tertiary)',
        color: 'var(--ow-text-primary)',
        border: '1px solid var(--ow-border)',
        borderRadius: 'var(--ow-radius-md)',
        padding: 'var(--ow-space-2) var(--ow-space-3)',
        fontSize: 'var(--ow-font-size-sm)',
        cursor: 'pointer',
      }}
    >
      {CHAIN_CONFIGS.map(c => (
        <option key={c.chainId} value={c.chainId}>
          {c.name} {c.testnet && '(testnet)'}
        </option>
      ))}
    </select>
  );

  return (
    <div style={contentStyle}>
      <div style={headerStyle}>
        <div style={{ fontSize: 'var(--ow-font-size-lg)', fontWeight: 700 }}>
          7xCircle Wallet
        </div>
        <div style={{ display: 'flex', gap: 'var(--ow-space-2)', alignItems: 'center' }}>
          {chainSelector}
          <Button variant="ghost" size="sm" onClick={fetchTokens} disabled={tokensLoading}>
            <RefreshCw size={16} style={tokensLoading ? { animation: 'spin 1s linear infinite' } : undefined} />
          </Button>
          <Link to="/settings">
            <Button variant="ghost" size="sm">
              <Settings size={16} />
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Native balance hero ─────────────────────────────────────── */}
      {(() => {
        const native = tokens.find(t => t.isNative);
        const bal = native ? formatBalance(native.balance, native.decimals, 4) : (tokensLoading ? '...' : '0');
        return (
          <div style={balanceCardStyle}>
            <div style={{ color: 'var(--ow-text-secondary)', fontSize: 'var(--ow-font-size-sm)', marginBottom: 'var(--ow-space-2)' }}>
              {t('home.balanceOf', { chain: activeChain?.name ?? 'Unknown', symbol: activeChain?.nativeSymbol ?? '' })}
            </div>
            <div style={{ fontSize: 'var(--ow-font-size-3xl)', fontWeight: 700, fontFamily: 'var(--ow-font-mono)' }}>
              {bal}
            </div>
            {currentAccount && (
              <div style={{
                marginTop: 'var(--ow-space-4)',
                fontFamily: 'var(--ow-font-mono)',
                fontSize: 'var(--ow-font-size-xs)',
                color: 'var(--ow-text-secondary)',
                wordBreak: 'break-all',
              }}>
                {currentAccount.address}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Asset list (native + ERC20s) ─────────────────────────────── */}
      {tokens.length > 1 && (
        <div style={{
          backgroundColor: 'var(--ow-bg-secondary)',
          borderRadius: 'var(--ow-radius-xl)',
          border: '1px solid var(--ow-border)',
          padding: 'var(--ow-space-4) var(--ow-space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 'var(--ow-font-size-sm)',
            fontWeight: 600,
            marginBottom: 'var(--ow-space-2)',
          }}>
            <Coins size={14} /> {t('home.assets', { count: tokens.length })}
            {tokensError && <span style={{ color: 'var(--ow-error)', fontSize: 11, fontWeight: 400 }}>· {tokensError}</span>}
          </div>

          {tokens.filter(t => !t.isNative).map(t => {
            const formatted = formatBalance(t.balance, t.decimals, 6);
            return (
              <div
                key={t.address}
                onClick={() => goSendToken(t.address, t.symbol)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 'var(--ow-radius-md)',
                  backgroundColor: 'var(--ow-bg-tertiary)',
                  border: '1px solid var(--ow-border-subtle)',
                  cursor: 'pointer',
                  transition: 'background-color 150ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--ow-bg-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--ow-bg-tertiary)')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    backgroundColor: 'var(--ow-bg-secondary)',
                    border: '1px solid var(--ow-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, fontFamily: 'var(--ow-font-mono)',
                    color: 'var(--ow-text-secondary)',
                  }}>
                    {t.symbol.slice(0, 3).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--ow-font-size-sm)', fontWeight: 600 }}>{t.symbol}</div>
                    <div style={{ fontSize: 10, color: 'var(--ow-text-tertiary)', fontFamily: 'var(--ow-font-mono)' }}>
                      {t.address.slice(0, 10)}…{t.address.slice(-6)}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--ow-font-mono)', fontSize: 'var(--ow-font-size-sm)' }}>{formatted}</div>
                  <div style={{ fontSize: 10, color: 'var(--ow-text-tertiary)' }}>{t.decimals} decimals</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Quick actions ─────────────────────────────────────────────── */}
      <div style={actionRowStyle}>
        <Link to="/send" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" style={{ width: '100%', flexDirection: 'column', padding: 'var(--ow-space-4)', gap: 'var(--ow-space-1)' }}>
            <Send size={20} /> {t('home.send')}
          </Button>
        </Link>
        <Link to="/swap" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" style={{ width: '100%', flexDirection: 'column', padding: 'var(--ow-space-4)', gap: 'var(--ow-space-1)' }}>
            <ArrowLeftRight size={20} /> {t('home.swap')}
          </Button>
        </Link>
        <Link to="/earn" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" style={{ width: '100%', flexDirection: 'column', padding: 'var(--ow-space-4)', gap: 'var(--ow-space-1)' }}>
            <TrendingUp size={20} /> {t('home.earn')}
          </Button>
        </Link>
        <Link to="/receive" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" style={{ width: '100%', flexDirection: 'column', padding: 'var(--ow-space-4)', gap: 'var(--ow-space-1)' }}>
            <ArrowDownToLine size={20} /> {t('home.receive')}
          </Button>
        </Link>
        <Link to="/history" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" style={{ width: '100%', flexDirection: 'column', padding: 'var(--ow-space-4)', gap: 'var(--ow-space-1)' }}>
            <HistoryIcon size={20} /> {t('home.history')}
          </Button>
        </Link>
        {/* dApp approvals only exist inside the extension popup */}
        {typeof chrome !== 'undefined' && Boolean((chrome as unknown as { runtime?: { id?: string } }).runtime?.id) && (
          <Link to="/dapp" style={{ textDecoration: 'none' }}>
            <Button variant="secondary" style={{ width: '100%', flexDirection: 'column', padding: 'var(--ow-space-4)', gap: 'var(--ow-space-1)' }}>
              <Plug size={20} /> {t('home.dappRequests')}
            </Button>
          </Link>
        )}
        <Button
          variant="secondary"
          style={{ width: '100%', flexDirection: 'column', padding: 'var(--ow-space-4)', gap: 'var(--ow-space-1)' }}
          onClick={lock}
        >
          <Lock size={20} /> {t('home.lock')}
        </Button>
      </div>

      {/* ── Recent transactions ────────────────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--ow-bg-secondary)',
        borderRadius: 'var(--ow-radius-xl)',
        border: '1px solid var(--ow-border)',
        padding: 'var(--ow-space-4) var(--ow-space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ow-space-2)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--ow-space-2)',
        }}>
          <div style={{ fontSize: 'var(--ow-font-size-sm)', fontWeight: 600 }}>{t('home.recentTransactions')}</div>
          <Link to="/history" style={{
            fontSize: 'var(--ow-font-size-xs)',
            color: 'var(--ow-info)',
            textDecoration: 'none',
          }}>{t('home.viewAll')}</Link>
        </div>

        {historyLoading && (
          <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)', padding: 'var(--ow-space-3) 0' }}>
            {t('common.loading')}
          </div>
        )}

        {!historyLoading && recentTxs.length === 0 && (
          <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)', padding: 'var(--ow-space-3) 0' }}>
            {t('home.noTransactions')}
          </div>
        )}

        {!historyLoading && recentTxs.map(tx => {
          const isSent = tx.direction === 'sent';
          const isPositive = !isSent;
          const symbol = tx.tokenSymbol ?? activeChain?.nativeSymbol ?? '';
          // Use tokenDecimals from tx record (explorer data or our pending entry)
          const decimals = tx.tokenDecimals ?? activeChain?.nativeDecimals ?? 18;
          const amt = formatBalance(tx.value, decimals, 4);

          return (
            <div key={tx.hash} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--ow-space-2) 0',
              borderBottom: '1px solid var(--ow-border-subtle)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-3)' }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: tx.status === 'pending'
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'var(--ow-bg-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {isSent
                    ? <ArrowUpRight size={14} color="#f87171" />
                    : <ArrowDownLeft size={14} color="#22c55e" />}
                </div>
                <div>
                  <div style={{ fontSize: 'var(--ow-font-size-xs)', fontWeight: 600 }}>
                    {isSent
                    ? (tx.tokenSymbol ? t('home.sentToken', { symbol: tx.tokenSymbol }) : t('home.sent'))
                    : (tx.tokenSymbol ? t('home.receivedToken', { symbol: tx.tokenSymbol }) : t('home.received'))}
                    {tx.status === 'pending' && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: '#f59e0b' }}>· {t('home.pending')}</span>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--ow-text-tertiary)', fontFamily: 'var(--ow-font-mono)' }}>
                    {(tx.to || tx.hash).slice(0, 10)}…
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontFamily: 'var(--ow-font-mono)',
                  fontSize: 'var(--ow-font-size-sm)',
                  color: isPositive ? '#22c55e' : '#f87171',
                }}>
                  {isPositive ? '+' : '-'}{amt}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--ow-text-tertiary)' }}>{symbol}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
        7xCircle Wallet · Apache-2.0 · v0.1.0
      </div>
    </div>
  );
}
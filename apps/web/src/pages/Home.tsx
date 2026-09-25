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
 *   │  Header: chain picker | lock btn    │
 *   ├─────────────────────────────────────┤
 *   │  Hero: portfolio USD (or native)    │
 *   │  Token list (native + ERC20/BEP20)  │
 *   ├─────────────────────────────────────┤
 *   │  Round icon actions (send/swap/…)   │
 *   ├─────────────────────────────────────┤
 *   │  Recent transactions (top 3)         │
 *   └─────────────────────────────────────┘
 *
 * NOTE: This page only renders when store.unlocked === true.
 * All chain queries use accounts derived during unlock().
 *
 * UI notes for this revision:
 *   - Loading shows skeletons, never bare "..." or blank flashes
 *   - Clickable rows are real buttons (ListRow), not div-with-onClick
 *   - Colors all reference design tokens so the light theme survives
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, Send, ArrowLeftRight, TrendingUp, ArrowDownToLine, History as HistoryIcon, Settings, ArrowUpRight, ArrowDownLeft, Coins, RefreshCw, Plug, Copy, Check, ChevronDown, LayoutGrid } from 'lucide-react';
import { Button, IconButton, Card, ListRow, Skeleton, EmptyState } from '@7xcircle/ui';
import { useWalletStore } from '../store/wallet.js';
import { chainRegistry } from '@7xcircle/core';
import { CHAIN_CONFIGS, priceTokens, totalUsd } from '@7xcircle/chains';
import { formatBalance, formatUsd } from '@7xcircle/shared';
import type { TokenBalance } from '@7xcircle/shared';
import { useTransactionHistory } from '../hooks/useTransactionHistory.js';
import { usePortfolio } from '../hooks/usePortfolio.js';

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
  const [copied, setCopied] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);
  // "All chains" is a local VIEW — the store's activeChainId keeps pointing
  // at a real chain so Send/Swap/recent-tx semantics never have to special
  // case a pseudo-chain.
  const [viewAll, setViewAll] = useState(false);
  const portfolio = usePortfolio(viewAll);
  const chainRef = useRef<HTMLDivElement | null>(null);

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
      // Prices are fetched in the same pass: the balance list is useless
      // without them, and a second render pass would flash bare amounts.
      const priced = await priceTokens(await adapter.getAllTokenBalances(currentAccount.address));
      const list = [...priced];
      // Sort: native first, then by USD value, then by raw balance
      list.sort((a, b) => {
        if (a.isNative !== b.isNative) return a.isNative ? -1 : 1;
        const aUsd = a.balanceUsd ?? 0;
        const bUsd = b.balanceUsd ?? 0;
        if (aUsd !== bUsd) return bUsd - aUsd;
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
      } catch { /* shown via tokensError below */ }
    } finally {
      setTokensLoading(false);
    }
  }, [adapter, currentAccount?.address, activeChain, activeChainId]);

  useEffect(() => {
    void fetchTokens();
  }, [fetchTokens]);

  // Close the chain dropdown on outside click
  useEffect(() => {
    if (!chainOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (chainRef.current && !chainRef.current.contains(e.target as Node)) {
        setChainOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [chainOpen]);

  const copyAddress = async () => {
    if (!currentAccount) return;
    try {
      await navigator.clipboard.writeText(currentAccount.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — the address stays selectable */ }
  };

  const goSendToken = (tokenAddress: string | null, tokenSymbol: string) => {
    // Build a URL with optional token prefill via search params in a future
    // version — for now just go to /send; user selects ERC20 there
    navigate('/send');
    void tokenAddress; void tokenSymbol; // silence unused
  };

  const chainSelector = (
    <div ref={chainRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={chainOpen}
        aria-label={t('home.chainSelector', { chain: viewAll ? t('portfolio.allChains') : (activeChain?.name ?? '') })}
        onClick={() => setChainOpen(o => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--ow-space-2)',
          backgroundColor: 'var(--ow-bg-tertiary)',
          color: 'var(--ow-text-primary)',
          border: '1px solid var(--ow-border)',
          borderRadius: 'var(--ow-radius-md)',
          padding: 'var(--ow-space-2) var(--ow-space-3)',
          fontSize: 'var(--ow-font-size-sm)',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {viewAll ? (
          <>
            <LayoutGrid size={14} aria-hidden="true" style={{ color: 'var(--ow-accent)' }} />
            {t('portfolio.allChains')}
          </>
        ) : (
          <>
            {activeChain?.name ?? activeChainId}
            {activeChain?.testnet && <span className="ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>testnet</span>}
          </>
        )}
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            color: 'var(--ow-text-tertiary)',
            transition: 'transform var(--ow-duration-fast) var(--ow-ease)',
            transform: chainOpen ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>
      {chainOpen && (
        <div
          role="listbox"
          aria-label={t('home.chainSelectorLabel')}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            insetInlineEnd: 0,
            zIndex: 'var(--ow-z-dropdown)' as unknown as number,
            minWidth: 200,
            maxHeight: 320,
            overflow: 'auto',
            backgroundColor: 'var(--ow-bg-secondary)',
            border: '1px solid var(--ow-border)',
            borderRadius: 'var(--ow-radius-md)',
            boxShadow: 'var(--ow-shadow-lg)',
          }}
        >
          <button
            type="button"
            role="option"
            aria-selected={viewAll}
            onClick={() => {
              setViewAll(true);
              setChainOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--ow-space-2)',
              width: '100%',
              padding: '10px 12px',
              backgroundColor: viewAll ? 'var(--ow-bg-hover)' : 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--ow-border-subtle)',
              cursor: 'pointer',
              color: 'var(--ow-text-primary)',
              fontFamily: 'inherit',
              fontSize: 'var(--ow-font-size-sm)',
              fontWeight: 600,
              textAlign: 'start',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <LayoutGrid size={13} aria-hidden="true" /> {t('portfolio.allChains')}
            </span>
            {viewAll && <Check size={14} aria-hidden="true" style={{ color: 'var(--ow-accent)', flexShrink: 0 }} />}
          </button>
          {CHAIN_CONFIGS.map(c => {
            const selected = !viewAll && c.chainId === activeChainId;
            return (
              <button
                key={c.chainId}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setViewAll(false);
                  setActiveChain(c.chainId);
                  setChainOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--ow-space-2)',
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: selected ? 'var(--ow-bg-hover)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--ow-text-primary)',
                  fontFamily: 'inherit',
                  fontSize: 'var(--ow-font-size-sm)',
                  textAlign: 'start',
                }}
              >
                <span>
                  {c.name}
                  {c.testnet && <span className="ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)', marginInlineStart: 6 }}>(testnet)</span>}
                </span>
                {selected && <Check size={14} aria-hidden="true" style={{ color: 'var(--ow-accent)', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const actionTile = (to: string, icon: React.ReactNode, label: string) => (
    <Link
      to={to}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--ow-space-2)',
        padding: 'var(--ow-space-3) var(--ow-space-2)',
        color: 'var(--ow-text-primary)',
        textDecoration: 'none',
        borderRadius: 'var(--ow-radius-lg)',
        border: '1px solid var(--ow-border-subtle)',
        backgroundColor: 'var(--ow-bg-secondary)',
        transition: 'background-color var(--ow-duration-fast) var(--ow-ease), border-color var(--ow-duration-fast) var(--ow-ease)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          borderRadius: 'var(--ow-radius-full)',
          backgroundColor: 'var(--ow-bg-hover)',
          color: 'var(--ow-accent)',
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 'var(--ow-font-size-xs)', fontWeight: 600 }}>{label}</span>
    </Link>
  );

  // ── Hero figures: USD portfolio first, bare native as the fallback ──
  const native = tokens.find(tok => tok.isNative);
  const priced = tokens.some(tok => tok.balanceUsd !== undefined);
  const portfolioUsd = totalUsd(tokens);
  const nativeBal = native ? formatBalance(native.balance, native.decimals, 4) : '0';

  return (
    <div className="ow-page">
      <header className="ow-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-3)' }}>
          <span style={{ fontSize: 'var(--ow-font-size-lg)', fontWeight: 700 }}>
            7xCircle Wallet
          </span>
          {chainSelector}
        </div>
        <div style={{ display: 'flex', gap: 'var(--ow-space-1)', alignItems: 'center' }}>
          <IconButton
            aria-label={t('home.refresh')}
            onClick={() => void (viewAll ? portfolio.refresh() : fetchTokens())}
            disabled={viewAll ? portfolio.loading : tokensLoading}
          >
            <RefreshCw size={16} style={(viewAll ? portfolio.loading : tokensLoading) ? { animation: 'ow-spin 1s linear infinite' } : undefined} />
          </IconButton>
          <IconButton aria-label={t('home.settingsAria')} onClick={() => navigate('/settings')}>
            <Settings size={16} />
          </IconButton>
          <IconButton aria-label={t('home.lock')} onClick={lock}>
            <Lock size={16} />
          </IconButton>
        </div>
      </header>

      {/* ── Portfolio hero ──────────────────────────────────────────── */}
      {/* ── Cross-chain portfolio (All chains view) ────────────────── */}
      {viewAll && (
        <Card centered style={{ padding: 'var(--ow-space-8)' }}>
          <div className="ow-muted" style={{ fontSize: 'var(--ow-font-size-sm)' }}>
            {t('portfolio.title')}
          </div>
          {portfolio.loading && !portfolio.loaded ? (
            <>
              <Skeleton width={220} height={36} style={{ marginTop: 'var(--ow-space-2)' }} />
              <Skeleton width={140} height={12} style={{ marginTop: 'var(--ow-space-3)' }} />
            </>
          ) : (
            <>
              <div className="ow-mono" style={{ fontSize: 'var(--ow-font-size-3xl)', fontWeight: 700 }}>
                {formatUsd(totalUsd(portfolio.tokens))}
              </div>
              <div className="ow-muted" style={{ fontSize: 'var(--ow-font-size-sm)', marginTop: 'var(--ow-space-1)' }}>
                {t('portfolio.subtitle', { count: accounts.length })}
              </div>
              {portfolio.failedChains > 0 && (
                <div role="status" style={{ color: 'var(--ow-warning)', fontSize: 'var(--ow-font-size-xs)', marginTop: 'var(--ow-space-2)' }}>
                  {t('portfolio.partialFail', { count: portfolio.failedChains })}
                </div>
              )}
            </>
          )}
        </Card>
      )}
      {viewAll && (
        <Card>
          <div className="ow-row-between" style={{ marginBottom: 'var(--ow-space-2)' }}>
            <div className="ow-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Coins size={14} aria-hidden="true" /> {t('portfolio.assets', { count: portfolio.tokens.length })}
            </div>
          </div>
          {portfolio.loading && !portfolio.loaded ? (
            <>
              <Skeleton height={44} style={{ marginBottom: 6 }} />
              <Skeleton height={44} style={{ marginBottom: 6 }} />
              <Skeleton height={44} />
            </>
          ) : portfolio.tokens.length === 0 ? (
            <div className="ow-faint" style={{ padding: 'var(--ow-space-3) 0', fontSize: 'var(--ow-font-size-sm)', textAlign: 'center' }}>
              {t('portfolio.empty')}
            </div>
          ) : (
            portfolio.tokens.map(tok => (
              <ListRow
                key={`${tok.chainId}:${tok.address}`}
                aria-label={`${tok.symbol} · ${CHAIN_CONFIGS.find(c => c.chainId === tok.chainId)?.name ?? tok.chainId}`}
                onClick={() => {
                  // Drill into the owning chain, then hand off to Send —
                  // one coherent single-chain context for the money step.
                  setViewAll(false);
                  setActiveChain(tok.chainId);
                  navigate('/send');
                }}
                start={
                  <>
                    <div
                      aria-hidden="true"
                      className="ow-mono"
                      style={{
                        width: 32,
                        height: 32,
                        flexShrink: 0,
                        borderRadius: 'var(--ow-radius-full)',
                        backgroundColor: 'var(--ow-bg-secondary)',
                        border: '1px solid var(--ow-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--ow-font-size-xs)',
                        fontWeight: 700,
                        color: 'var(--ow-text-secondary)',
                      }}
                    >
                      {tok.symbol.slice(0, 3).toUpperCase()}
                    </div>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--ow-font-size-sm)', fontWeight: 600 }}>{tok.symbol}</span>
                      <span className="ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>
                        {CHAIN_CONFIGS.find(c => c.chainId === tok.chainId)?.name ?? tok.chainId}
                      </span>
                    </span>
                  </>
                }
                end={
                  <>
                    <span className="ow-mono" style={{ fontSize: 'var(--ow-font-size-sm)' }}>
                      {formatBalance(tok.balance, tok.decimals, 4)}
                    </span>
                    <span className="ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>
                      {tok.balanceUsd !== undefined ? `≈ ${formatUsd(tok.balanceUsd)}` : ''}
                    </span>
                  </>
                }
              />
            ))
          )}
        </Card>
      )}

      {/* ── Single-chain hero ──────────────────────────────────────── */}
      {!viewAll && (
      <Card centered style={{ padding: 'var(--ow-space-8)' }}>
        {tokensLoading && tokens.length === 0 ? (
          <>
            <Skeleton width={180} height={14} />
            <Skeleton width={220} height={36} style={{ marginTop: 'var(--ow-space-2)' }} />
            <Skeleton width={140} height={12} style={{ marginTop: 'var(--ow-space-3)' }} />
          </>
        ) : (
          <>
            <div className="ow-muted" style={{ fontSize: 'var(--ow-font-size-sm)' }}>
              {t('home.balanceOf', { chain: activeChain?.name ?? 'Unknown', symbol: activeChain?.nativeSymbol ?? '' })}
            </div>
            {priced ? (
              <>
                {/* USD portfolio total is what users actually scan for — make
                    it the big number; the native balance becomes a sub-line. */}
                <div className="ow-mono" style={{ fontSize: 'var(--ow-font-size-3xl)', fontWeight: 700 }}>
                  {formatUsd(portfolioUsd)}
                </div>
                <div className="ow-mono ow-muted" style={{ fontSize: 'var(--ow-font-size-sm)', marginTop: 'var(--ow-space-1)' }}>
                  {nativeBal} {activeChain?.nativeSymbol}
                  {tokens.length > 1 && t('home.assets', { count: tokens.length })}
                </div>
              </>
            ) : (
              <>
                <div className="ow-mono" style={{ fontSize: 'var(--ow-font-size-3xl)', fontWeight: 700 }}>
                  {nativeBal} <span style={{ fontSize: 'var(--ow-font-size-xl)' }}>{activeChain?.nativeSymbol}</span>
                </div>
                {native?.balanceUsd !== undefined && (
                  <div className="ow-mono ow-muted" style={{ fontSize: 'var(--ow-font-size-sm)', marginTop: 'var(--ow-space-1)' }}>
                    ≈ {formatUsd(native.balanceUsd)}
                  </div>
                )}
              </>
            )}
            {tokensError && (
              <div role="status" style={{ color: 'var(--ow-warning)', fontSize: 'var(--ow-font-size-xs)', marginTop: 'var(--ow-space-2)' }}>
                {t('home.loadDataIssue', { error: tokensError })}
              </div>
            )}
            {currentAccount && (
              <div style={{ marginTop: 'var(--ow-space-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--ow-space-2)' }}>
                <span className="ow-mono ow-muted" style={{ fontSize: 'var(--ow-font-size-xs)', wordBreak: 'break-all' }}>
                  {currentAccount.address}
                </span>
                <IconButton
                  aria-label={t('home.copyAddress')}
                  size={14}
                  onClick={() => void copyAddress()}
                  style={{ padding: 'var(--ow-space-1)', flexShrink: 0 }}
                >
                  {copied ? <Check size={14} style={{ color: 'var(--ow-positive)' }} /> : <Copy size={14} />}
                </IconButton>
              </div>
            )}
          </>
        )}
      </Card>
      )}

      {/* ── Asset list (native + ERC20s) ─────────────────────────────── */}
      {!viewAll && tokensLoading && tokens.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-hidden="true">
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      )}
      {!viewAll && !tokensLoading && tokens.length > 1 && (
        <Card>
          <div className="ow-row-between" style={{ marginBottom: 'var(--ow-space-2)' }}>
            <div className="ow-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Coins size={14} aria-hidden="true" /> {t('home.assets', { count: tokens.length })}
            </div>
            {tokensError && <span style={{ color: 'var(--ow-error)', fontSize: 'var(--ow-font-size-xs)' }}>{tokensError}</span>}
          </div>

          {tokens.filter(tok => !tok.isNative).map(tok => (
            <ListRow
              key={tok.address}
              onClick={() => goSendToken(tok.address, tok.symbol)}
              aria-label={t('home.sendTokenAria', { symbol: tok.symbol })}
              start={
                <>
                  <div
                    aria-hidden="true"
                    className="ow-mono"
                    style={{
                      width: 32,
                      height: 32,
                      flexShrink: 0,
                      borderRadius: 'var(--ow-radius-full)',
                      backgroundColor: 'var(--ow-bg-secondary)',
                      border: '1px solid var(--ow-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--ow-font-size-xs)',
                      fontWeight: 700,
                      color: 'var(--ow-text-secondary)',
                    }}
                  >
                    {tok.symbol.slice(0, 3).toUpperCase()}
                  </div>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 'var(--ow-font-size-sm)', fontWeight: 600 }}>{tok.symbol}</span>
                    <span className="ow-mono ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>
                      {tok.address.slice(0, 10)}…{tok.address.slice(-6)}
                    </span>
                  </span>
                </>
              }
              end={
                <>
                  <span className="ow-mono" style={{ fontSize: 'var(--ow-font-size-sm)' }}>
                    {formatBalance(tok.balance, tok.decimals, 6)}
                  </span>
                  <span className="ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>
                    {tok.balanceUsd !== undefined
                      ? `≈ ${formatUsd(tok.balanceUsd)}`
                      : tok.priceUsd !== undefined
                        ? `${formatUsd(tok.priceUsd)} / ${tok.symbol}`
                        : `${tok.decimals} decimals`}
                  </span>
                </>
              }
            />
          ))}
        </Card>
      )}

      {/* ── Quick actions ─────────────────────────────────────────────── */}
      {/* Lock left the grid for the header; the auto-fit grid wraps 5-6
          tiles cleanly in web, popup, and every width between. */}
      <nav className="ow-actions" aria-label={t('home.actionsLabel')}>
        {actionTile('/send', <Send size={20} />, t('home.send'))}
        {actionTile('/swap', <ArrowLeftRight size={20} />, t('home.swap'))}
        {actionTile('/earn', <TrendingUp size={20} />, t('home.earn'))}
        {actionTile('/receive', <ArrowDownToLine size={20} />, t('home.receive'))}
        {actionTile('/history', <HistoryIcon size={20} />, t('home.history'))}
        {/* dApp approvals only exist inside the extension popup */}
        {typeof chrome !== 'undefined' && Boolean((chrome as unknown as { runtime?: { id?: string } }).runtime?.id) && (
          actionTile('/dapp', <Plug size={20} />, t('home.dappRequests'))
        )}
      </nav>

      {/* ── Recent transactions ────────────────────────────────────────── */}
      <Card>
        <div className="ow-row-between" style={{ marginBottom: 'var(--ow-space-2)' }}>
          <div className="ow-label">{t('home.recentTransactions')}</div>
          <Link to="/history" style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-info)', textDecoration: 'none' }}>
            {t('home.viewAll')}
          </Link>
        </div>

        {historyLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-3)' }} aria-label={t('common.loading')}>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        )}

        {!historyLoading && recentTxs.length === 0 && (
          <EmptyState
            icon={<HistoryIcon size={28} />}
            title={t('home.noTransactions')}
            description={t('home.noTransactionsHint')}
            action={
              <Link to="/receive">
                <Button variant="secondary" size="sm">
                  <ArrowDownToLine size={14} /> {t('home.receive')}
                </Button>
              </Link>
            }
          />
        )}

        {!historyLoading && recentTxs.map(tx => {
          const isSent = tx.direction === 'sent';
          const isPositive = !isSent;
          const symbol = tx.tokenSymbol ?? activeChain?.nativeSymbol ?? '';
          // Use tokenDecimals from tx record (explorer data or our pending entry)
          const decimals = tx.tokenDecimals ?? activeChain?.nativeDecimals ?? 18;
          const amt = formatBalance(tx.value, decimals, 4);

          return (
            <div
              key={tx.hash}
              className="ow-row-between"
              style={{ padding: 'var(--ow-space-2) 0', borderTop: '1px solid var(--ow-border-subtle)' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-3)', minWidth: 0 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    borderRadius: 'var(--ow-radius-full)',
                    backgroundColor: tx.status === 'pending' ? 'var(--ow-pending-bg)' : 'var(--ow-bg-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSent
                    ? <ArrowUpRight size={14} style={{ color: 'var(--ow-negative-fg)' }} />
                    : <ArrowDownLeft size={14} style={{ color: 'var(--ow-positive-fg)' }} />}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 'var(--ow-font-size-xs)', fontWeight: 600 }}>
                    {isSent
                      ? (tx.tokenSymbol ? t('home.sentToken', { symbol: tx.tokenSymbol }) : t('home.sent'))
                      : (tx.tokenSymbol ? t('home.receivedToken', { symbol: tx.tokenSymbol }) : t('home.received'))}
                    {tx.status === 'pending' && (
                      <span style={{ marginInlineStart: 6, fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-pending-fg)' }}>· {t('home.pending')}</span>
                    )}
                  </span>
                  <span className="ow-mono ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>
                    {(tx.to || tx.hash).slice(0, 10)}…
                  </span>
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span className="ow-mono" style={{ fontSize: 'var(--ow-font-size-sm)', color: isPositive ? 'var(--ow-positive-fg)' : 'var(--ow-negative-fg)' }}>
                  {isPositive ? '+' : '-'}{amt}
                </span>
                <span className="ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>{symbol}</span>
              </span>
            </div>
          );
        })}
      </Card>

      <div className="ow-page--footer ow-faint" style={{ marginTop: 'auto', textAlign: 'center', fontSize: 'var(--ow-font-size-xs)' }}>
        {t('home.footer')}
      </div>
    </div>
  );
}

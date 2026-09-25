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
 * Approvals — the token-grants ledger of THIS wallet, with the exit door.
 *
 * Every approve(spender, amount) broadcast through the swap flow or signed
 * for a dApp lands here. Unlimited allowances are flagged in red because
 * they are the industry's favorite leftover. Revoking is a normal send:
 * approve(spender, 0) through the same pipeline, same review, same fee
 * honesty as any other transaction.
 *
 * Scope is stated up front (notice line): grants signed elsewhere before an
 * import are invisible without an indexer this wallet does not ship.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShieldOff, Ban } from 'lucide-react';
import { Button, Card, IconButton, EmptyState, Modal } from '@7xcircle/ui';
import { chainRegistry } from '@7xcircle/core';
import { CHAIN_CONFIGS } from '@7xcircle/chains';
import { formatBalance, isUnlimitedApproval, type TokenApproval } from '@7xcircle/shared';
import { useWalletStore } from '../store/wallet.js';
import { useTxFlow } from '../hooks/useTxFlow.js';

const short = (addr: string): string => `${addr.slice(0, 8)}…${addr.slice(-6)}`;

export function Approvals() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const approvals = useWalletStore(s => s.approvals);
  const markRevoked = useWalletStore(s => s.markApprovalRevoked);
  const accounts = useWalletStore(s => s.accounts);

  // The pipeline follows the selected grant's chain — the hook re-derives
  // adapter/account whenever the modal target changes.
  const [target, setTarget] = useState<TokenApproval | null>(null);
  const adapter = chainRegistry.get(target?.chainId ?? '');
  const account = accounts.find(a => a.chainId === target?.chainId);
  const flow = useTxFlow({ adapter, account, chainId: target?.chainId ?? '', feeTier: 'normal' });
  const [error, setError] = useState<string | null>(null);

  const doRevoke = async () => {
    if (!target || !account) {
      setError(t('approvals.noAccountForChain'));
      return;
    }
    const grant = target;
    setTarget(null);
    setError(null);
    const outcome = await flow.send(
      { kind: 'approve', token: grant.token, spender: grant.spender, amountRaw: '0' },
      {
        displayTo: grant.spender,
        amountRaw: '0',
        token: { symbol: grant.symbol, address: grant.token, decimals: grant.decimals, isNative: false },
      },
    );
    if (outcome === 'confirmed') {
      markRevoked(grant.id, Math.floor(Date.now() / 1000));
    } else if (outcome === 'failed') {
      setError(flow.error ?? t('approvals.revokeFailed'));
    }
  };

  const chainName = (chainId: string): string =>
    CHAIN_CONFIGS.find(c => c.chainId === chainId)?.name ?? chainId;

  return (
    <div className="ow-page" style={{ maxWidth: 640 }}>
      <header className="ow-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)' }}>
          <IconButton aria-label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
          </IconButton>
          <span style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>{t('approvals.title')}</span>
        </div>
      </header>

      <p className="ow-muted" style={{ margin: 0, fontSize: 'var(--ow-font-size-sm)' }}>
        {t('approvals.notice')}
      </p>

      {error && (
        <div role="alert" style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-negative-fg)' }}>
          {error}
        </div>
      )}

      {approvals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldOff size={28} />}
            title={t('approvals.empty')}
            description={t('approvals.emptyHint')}
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('/swap')}>
                {t('home.swap')}
              </Button>
            }
          />
        </Card>
      ) : (
        <Card style={{ gap: 'var(--ow-space-3)' }}>
          {approvals.map(grant => {
            const unlimited = isUnlimitedApproval(grant.amountRaw);
            const revoked = grant.revokedAt !== undefined;
            return (
              <div
                key={grant.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--ow-space-3)',
                  flexWrap: 'wrap',
                  padding: 'var(--ow-space-3)',
                  borderRadius: 'var(--ow-radius-md)',
                  backgroundColor: 'var(--ow-bg-tertiary)',
                  border: '1px solid var(--ow-border-subtle)',
                  opacity: revoked ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--ow-font-size-sm)' }}>
                      {grant.symbol} → {chainName(grant.chainId)}
                    </span>
                    <span
                      style={{
                        fontSize: 'var(--ow-font-size-xs)',
                        padding: '1px 8px',
                        borderRadius: 'var(--ow-radius-full)',
                        backgroundColor: unlimited && !revoked ? 'var(--ow-error-bg)' : 'var(--ow-bg-hover)',
                        color: unlimited && !revoked ? 'var(--ow-negative-fg)' : 'var(--ow-text-secondary)',
                        fontWeight: 600,
                      }}
                    >
                      {revoked
                        ? t('approvals.revoked')
                        : unlimited
                          ? t('approvals.unlimited')
                          : formatBalance(grant.amountRaw, grant.decimals, 2)}
                    </span>
                    <span
                      className="ow-faint"
                      style={{ fontSize: 'var(--ow-font-size-xs)', textTransform: 'lowercase' }}
                    >
                      {t(`approvals.source_${grant.source}`)}
                    </span>
                  </div>
                  <div className="ow-mono ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>
                    {t('approvals.spender')}: {short(grant.spender)} · {short(grant.token)}
                  </div>
                </div>
                {!revoked && (
                  <Button size="sm" variant="secondary" onClick={() => setTarget(grant)}>
                    <Ban size={13} /> {t('approvals.revoke')}
                  </Button>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {/* Revoke is a real on-chain transaction with a fee — review it like
          Send reviews everything else. */}
      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={t('approvals.revokeTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={() => void doRevoke()}>{t('approvals.revokeConfirm')}</Button>
          </>
        }
      >
        {target && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-2)', fontSize: 'var(--ow-font-size-sm)' }}>
            <p style={{ margin: 0, color: 'var(--ow-text-secondary)' }}>{t('approvals.revokeDesc')}</p>
            <div className="ow-mono" style={{ wordBreak: 'break-all' }}>
              {target.symbol} → {short(target.spender)}
            </div>
            <div className="ow-faint" style={{ fontSize: 'var(--ow-font-size-xs)' }}>
              {t('approvals.revokeNote')}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

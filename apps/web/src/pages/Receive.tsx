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
 * Receive page — display current chain + account address with QR code.
 *
 * QR rendering rules (scannability beats theming):
 *   - Always black-on-white. An inverted (light-on-dark) QR fails many
 *     in-the-wild scanners (WeChat/Alipay in particular) and a theme-driven
 *     fgColor can go invisible-white-on-white in the light theme.
 *   - marginSize=2 modules of quiet zone: the spec wants 4; 2 is what
 *     MetaMask ships inside its white plate, enough for phone cameras.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Check, QrCode } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, IconButton, EmptyState } from '@open-wallet/ui';
import { useWalletStore } from '../store/wallet.js';
import { CHAIN_CONFIGS } from '@open-wallet/chains';
import { QRCodeSVG } from 'qrcode.react';

export function Receive() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeChainId = useWalletStore(s => s.activeChainId);
  const accounts = useWalletStore(s => s.accounts);
  const account = accounts.find(a => a.chainId === activeChainId) ?? accounts[0];
  const activeChain = CHAIN_CONFIGS.find(c => c.chainId === activeChainId);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — the address text stays selectable
    }
  };

  return (
    <div className="ow-page" style={{ maxWidth: 520 }}>
      <header className="ow-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)' }}>
          <IconButton aria-label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
          </IconButton>
          <div style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>{t('receive.title')}</div>
        </div>
        {activeChain && (
          <span
            className="ow-mono"
            style={{
              fontSize: 'var(--ow-font-size-xs)',
              fontWeight: 600,
              color: 'var(--ow-text-secondary)',
              backgroundColor: 'var(--ow-bg-tertiary)',
              border: '1px solid var(--ow-border)',
              borderRadius: 'var(--ow-radius-full)',
              padding: '2px 10px',
            }}
          >
            {activeChain.name}
          </span>
        )}
      </header>

      {account ? (
        <Card centered style={{ padding: 'var(--ow-space-8)', gap: 'var(--ow-space-4)' }}>
          <div className="ow-muted" style={{ fontSize: 'var(--ow-font-size-sm)' }}>
            {t('receive.desc')}
          </div>

          {/* White plate, fixed — the one surface on purpose in a dark app */}
          <div
            role="img"
            aria-label={t('receive.qrAria')}
            style={{
              backgroundColor: '#ffffff',
              padding: 'var(--ow-space-4)',
              borderRadius: 'var(--ow-radius-xl)',
              boxShadow: 'var(--ow-shadow-md)',
              lineHeight: 0,
            }}
          >
            <QRCodeSVG
              value={account.address}
              size={200}
              level="M"
              marginSize={2}
              fgColor="#0b0c0f"
              bgColor="#ffffff"
            />
          </div>

          {/* Address + copy */}
          <div
            className="ow-mono"
            style={{
              fontSize: 'var(--ow-font-size-sm)',
              wordBreak: 'break-all',
              backgroundColor: 'var(--ow-bg-tertiary)',
              padding: 'var(--ow-space-3)',
              borderRadius: 'var(--ow-radius-md)',
              border: '1px solid var(--ow-border-subtle)',
              width: '100%',
              textAlign: 'center',
            }}
          >
            {account.address}
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            style={{ display: 'flex', gap: 'var(--ow-space-2)', alignItems: 'center' }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t('receive.copied') : t('receive.copyAddress')}
          </Button>

          <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-warning)', textAlign: 'center' }}>
            {t('receive.warning')}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<QrCode size={28} />}
            title={t('receive.noAccount')}
            description={t('receive.noAccountHint')}
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
                {t('home.history')}
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}

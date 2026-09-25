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
 * DApp approvals — the human gate between queued dApp requests and keys.
 *
 * Lives in the web page set so the extension popup renders it via @web
 * (the only runtime with a session); plain web shows a stub notice.
 *
 * Contract with the background broker:
 *   port 'popup' pushes {type:'popup:pending', requests:[...]}
 *   we answer {type:'popup:resolve', id, ok, result|error}
 * Execution uses the SAME pipeline pieces the Send page uses: chainAdapter
 * build/sign/send + core signPersonalMessage — no parallel crypto paths.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, Signature, Send as SendIcon, Plug, ArrowLeftRight } from 'lucide-react';
import { Button } from '@7xcircle/ui';
import {
  chainRegistry,
  getPrivateKey,
  grantPermission,
  signDigest,
  signPersonalMessage,
  touchActivity,
} from '@7xcircle/core';
import { useWalletStore, selectActiveAccount } from '../store/wallet.js';
import { signForAccount } from '../hw/signFor.js';
import { ledgerPathOf, ledgerSignMessage, openEthApp } from '../hw/ledger.js';
import { CHAIN_CONFIGS, hashTypedDataV4 } from '@7xcircle/chains';
import { fromHex, parseErc20ApprovalCalldata } from '@7xcircle/shared';
import type { SitePermission } from '@7xcircle/core';

interface PendingRequest {
  id: string;
  origin: string;
  method: string;
  params: unknown[];
  tabId?: number;
  receivedAt: number;
}

const PERMS_KEY = 'dapp:permissions';
const ACCOUNTS_KEY = 'dapp:accounts';

const inExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

export function DappApprovals() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeChainId = useWalletStore(s => s.activeChainId);
  const setActiveChain = useWalletStore(s => s.setActiveChain);
  const unlocked = useWalletStore(s => s.unlocked);

  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  const account = useWalletStore(selectActiveAccount);
  const adapter = chainRegistry.get(activeChainId);
  const chainCfg = CHAIN_CONFIGS.find(c => c.chainId === activeChainId);
  const chainHex = useMemo(
    () => (chainCfg?.chainIdDecimal !== undefined ? '0x' + chainCfg.chainIdDecimal.toString(16) : '0x38'),
    [chainCfg],
  );

  useEffect(() => {
    if (!inExtension) return;
    const port = chrome.runtime.connect({ name: 'popup' });
    portRef.current = port;
    port.onMessage.addListener((msg: { type?: string; requests?: PendingRequest[] }) => {
      if (msg?.type === 'popup:pending' && Array.isArray(msg.requests)) {
        setRequests(msg.requests);
      }
    });
    port.onDisconnect.addListener(() => {
      // broker restart (SW recycle) — reconnect once, then give up quietly
      setTimeout(() => {
        try {
          const p = chrome.runtime.connect({ name: 'popup' });
          portRef.current = p;
        } catch { /* closing popup */ }
      }, 400);
    });
    return () => { try { port.disconnect(); } catch { /* noop */ } };
  }, []);

  const resolve = (id: string, ok: boolean, result?: unknown, error?: { code: number; message: string }) => {
    portRef.current?.postMessage({ type: 'popup:resolve', id, ok, result, error });
    setRequests(rs => rs.filter(r => r.id !== id));
  };

  const rejectAllLocked = () => {
    for (const r of requests) {
      resolve(r.id, false, undefined, { code: 4100, message: 'Wallet is locked' });
    }
  };

  const approve = async (req: PendingRequest) => {
    if (!account || !adapter) return;
    setBusyId(req.id);
    try {
      if (req.method === 'eth_requestAccounts') {
        const stored = await chrome.storage.local.get(PERMS_KEY);
        const perms = (stored[PERMS_KEY] as SitePermission[] | undefined) ?? [];
        await chrome.storage.local.set({ [PERMS_KEY]: grantPermission(perms, req.origin, chainHex) });
        const accStored = await chrome.storage.local.get(ACCOUNTS_KEY);
        const accMap = (accStored[ACCOUNTS_KEY] as Record<string, string[]> | undefined) ?? {};
        accMap[req.origin] = [account.address];
        await chrome.storage.local.set({ [ACCOUNTS_KEY]: accMap });
        resolve(req.id, true, [account.address]);
        return;
      }

      if (req.method === 'personal_sign') {
        const message = String(req.params?.[0] ?? '');
        touchActivity();
        if (account.source === 'ledger') {
          // device signs — same 0x-hex payload convention as the software path
          const messageHex = message.startsWith('0x')
            ? message
            : '0x' + Array.from(new TextEncoder().encode(message))
                .map(b => b.toString(16).padStart(2, '0')).join('');
          const { eth, close } = await openEthApp();
          try {
            const sig = await ledgerSignMessage(eth, ledgerPathOf(account), messageHex);
            resolve(req.id, true, sig);
          } finally {
            await close().catch(() => undefined);
          }
          return;
        }
        const pk = getPrivateKey(account);
        try {
          const sig = signPersonalMessage(message, pk);
          resolve(req.id, true, sig);
        } finally {
          pk.fill(0);
        }
        return;
      }

      if (req.method === 'eth_signTypedData_v4') {
        // MetaMask's [from, data] ordering is the convention, but dApps have
        // shipped both — detect by shape, and honour the from field when one
        // of the two params is an address.
        const [a, b] = req.params ?? [];
        const aIsJson = typeof a === 'string' && a.trim().startsWith('{');
        const payload = aIsJson ? String(a) : String(b ?? '');
        const signer = aIsJson ? String(b ?? '') : String(a ?? '');
        if (/^0x[0-9a-fA-F]{40}$/.test(signer) && signer.toLowerCase() !== account.address.toLowerCase()) {
          resolve(req.id, false, undefined, { code: 4001, message: 'Signer is not the active account' });
          return;
        }
        if (account.source === 'ledger') {
          // honest decline: the device app's EIP-712 path is not wired yet
          resolve(req.id, false, undefined, { code: 4200, message: 'Typed data signing on Ledger is not supported yet' });
          return;
        }
        const digest = fromHex(hashTypedDataV4(payload));
        touchActivity();
        const pk = getPrivateKey(account);
        try {
          const sig = signDigest(digest, pk);
          resolve(req.id, true, sig);
        } finally {
          pk.fill(0);
        }
        return;
      }

      if (req.method === 'wallet_switchEthereumChain') {
        const requested = String((req.params?.[0] as { chainId?: string } | undefined)?.chainId ?? '');
        const decimal = Number.parseInt(requested, 16);
        const target = CHAIN_CONFIGS.find(c => c.chainIdDecimal === decimal);
        if (!target) {
          resolve(req.id, false, undefined, { code: 4902, message: `Unrecognized chain ${requested}` });
          return;
        }
        // both views of "active chain": the wallet UI's registry key AND the
        // broker's hex (what eth_chainId answers and the permission ledger
        // bounds) — a dApp must never see a chain the popup is not on.
        setActiveChain(target.chainId);
        await chrome.storage.local.set({ 'dapp:chainId': requested.toLowerCase() });
        resolve(req.id, true, null);
        return;
      }

      if (req.method === 'eth_sendTransaction') {
        const tx = (req.params?.[0] ?? {}) as { from?: string; to?: string; value?: string; data?: string };
        if (!tx.to) throw new Error('transaction is missing "to"');
        if (tx.from && tx.from.toLowerCase() !== account.address.toLowerCase()) {
          resolve(req.id, false, undefined, { code: 4001, message: 'From address is not the active account' });
          return;
        }
        const intent = tx.data
          ? { kind: 'contract-call' as const, to: tx.to, data: tx.data, ...(tx.value ? { valueRaw: BigInt(tx.value).toString() } : {}) }
          : { kind: 'native-transfer' as const, to: tx.to, amountRaw: tx.value ? BigInt(tx.value).toString() : '0' };
        const built = await adapter.buildTransaction(intent, { from: account.address, feeTier: 'normal' });
        touchActivity();
        // dispatcher handles software keys AND routes ledger accounts to the device
        const signed = await signForAccount(account, built, adapter);
        const hash = await adapter.sendTransaction(signed);
        resolve(req.id, true, hash);

        // If the dApp just talked the user into an ERC20 approve, book it in
        // the approval ledger — the Approvals page is the revocation exit.
        const grant = parseErc20ApprovalCalldata(tx.data);
        if (grant && tx.to) {
          try {
            const info = await adapter.getTokenInfo(tx.to);
            useWalletStore.getState().recordApproval({
              chainId: activeChainId,
              token: tx.to,
              spender: grant.spender,
              symbol: info.symbol,
              decimals: info.decimals,
              amountRaw: grant.amountRaw,
              createdAt: Math.floor(Date.now() / 1000),
              source: 'dapp',
            });
          } catch {
            // Metadata lookup failed — the grant still exists on chain; the
            // ledger simply cannot describe it. Skipping beats storing a lie.
          }
        }
        return;
      }

      resolve(req.id, false, undefined, { code: 4200, message: `${req.method} is not supported yet` });
    } catch (err) {
      resolve(req.id, false, undefined, { code: -32603, message: err instanceof Error ? err.message : 'Execution failed' });
    } finally {
      setBusyId(null);
    }
  };

  const reject = (req: PendingRequest) => {
    resolve(req.id, false, undefined, { code: 4001, message: 'User rejected the request.' });
  };

  // ── render ──────────────────────────────────────────────────────────

  if (!inExtension) {
    return (
      <div style={{ padding: 'var(--ow-space-4)' }}>
        <h2>{t('dapp.title')}</h2>
        <p>{t('dapp.webUnsupported')}</p>
        <Button onClick={() => navigate('/')}>{t('common.back')}</Button>
      </div>
    );
  }

  const iconFor = (m: string) =>
    m === 'personal_sign' || m === 'eth_signTypedData_v4'
      ? <Signature size={18} />
      : m === 'eth_sendTransaction'
        ? <SendIcon size={18} />
        : m === 'wallet_switchEthereumChain'
          ? <ArrowLeftRight size={18} />
          : <Plug size={18} />;

  return (
    <div style={{ padding: 'var(--ow-space-4)', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)', marginBottom: 'var(--ow-space-3)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}><ArrowLeft size={16} /></Button>
        <h2 style={{ margin: 0 }}>{t('dapp.title')}</h2>
      </div>

      {unlocked && requests.length > 0 && (
        <div style={{ marginBottom: 'var(--ow-space-3)' }}>
          <Button size="sm" variant="secondary" onClick={rejectAllLocked}>{t('dapp.rejectAll', { count: requests.length })}</Button>
        </div>
      )}

      {!unlocked && requests.length > 0 && (
        <p style={{ color: 'var(--ow-danger)' }}>{t('dapp.lockedNotice')} </p>
      )}

      {requests.length === 0 && (
        <p style={{ opacity: 0.7 }}>{t('dapp.none')}</p>
      )}

      {requests.map(req => (
        <div
          key={req.id}
          style={{
            border: '1px solid var(--ow-border)',
            borderRadius: 'var(--ow-radius-md)',
            padding: 'var(--ow-space-3)',
            marginBottom: 'var(--ow-space-3)',
            display: 'grid',
            gap: 'var(--ow-space-2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            {iconFor(req.method)}
            <span>{req.method}</span>
            {req.method === 'wallet_switchEthereumChain' && (() => {
              const decimal = Number.parseInt(String((req.params?.[0] as { chainId?: string } | undefined)?.chainId ?? ''), 16);
              const target = CHAIN_CONFIGS.find(c => c.chainIdDecimal === decimal);
              return (
                <span style={{ fontWeight: 400, fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-info)' }}>
                  → {target?.name ?? `0x${decimal.toString(16)}`}
                </span>
              );
            })()}
          </div>
          <div style={{ fontSize: 'var(--ow-font-size-sm)' }}>
            <ShieldAlert size={13} style={{ display: 'inline', verticalAlign: -2 }} /> {req.origin}
            {' '}· {new Date(req.receivedAt).toLocaleTimeString()}
          </div>
          <pre style={{
            background: 'var(--ow-bg-tertiary)',
            borderRadius: 8, padding: 10, fontSize: 12, maxHeight: 180, overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
          }}>
            {JSON.stringify(req.params, null, 1)}
          </pre>
          <div style={{ display: 'flex', gap: 'var(--ow-space-2)' }}>
            <Button
              size="sm"
              disabled={!unlocked || !account || busyId === req.id}
              onClick={() => approve(req)}
            >
              {t('dapp.approve')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => reject(req)}>{t('dapp.reject')}</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

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
 * dApps tab — WalletConnect v2 sessions with an explicit human gate.
 *
 * Every incoming request lands in a review card first: nothing is ever
 * auto-signed. Session requests are served with the SAME software the
 * extension approval page and Home send use (adapter build → session
 * sign → broadcast), so dApp transactions are subject to the exact same
 * address validation, fee estimation and key lifetime as manual sends.
 */

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { SignClientTypes, SessionTypes } from '@walletconnect/types';
import { chainRegistry, getPrivateKey, signPersonalMessage } from '@open-wallet/core';
import type { Account } from '@open-wallet/shared';
import { Button, shorten } from '../components';
import { evmChainFromCaip } from '../chains';
import { sendTx } from '../tx';
import { disposeSignClient, getSignClient, wcConfigured, type WcClient } from '../wc/client';
import { negotiateNamespace } from '../wc/namespaces';
import { styles } from '../theme';

// expo-camera's class component predates this @types/react's shouldComponentUpdate
// arity — a typed alias avoids spraying `any` through the render code
const Camera = CameraView as unknown as ComponentType<{
  style?: object;
  barcodeScannerSettings?: { barcodeTypes: string[] };
  onBarcodeScanned?: (payload: { data: string }) => void;
}>;

interface PendingProposal {
  id: number;
  metadata: { name?: string; description?: string; url?: string };
  chains: string[];
  methods: string[];
}

interface PendingRequest {
  id: number;
  topic: string;
  chainId: string;
  method: string;
  params: unknown;
}

export function Dapps({ accounts, locked }: { accounts: Account[]; locked: boolean }) {
  const clientRef = useRef<WcClient | null>(null);
  const [ready, setReady] = useState(false);
  const [sessions, setSessions] = useState<SessionTypes.Struct[]>([]);
  const [proposal, setProposal] = useState<PendingProposal | null>(null);
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [msg, setMsg] = useState('');
  const [scanning, setScanning] = useState(false);
  const [uri, setUri] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  // accounts must be fresh inside long-lived event callbacks
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const refreshSessions = useCallback(() => {
    const client = clientRef.current;
    if (client) setSessions([...client.session.values]);
  }, []);

  // client bootstrap + event wiring (client is a singleton; safe to re-enter)
  useEffect(() => {
    if (locked || !wcConfigured()) {
      setReady(false);
      return;
    }
    let cancelled = false;
    const offs: Array<() => void> = [];
    (async () => {
      const client = await getSignClient();
      if (cancelled) return;
      clientRef.current = client;

      const onProposal = (prop: SignClientTypes.EventArguments['session_proposal']) => {
        const ns = prop.params.requiredNamespaces.eip155;
        const opt = prop.params.optionalNamespaces?.eip155;
        setProposal({
          id: prop.id,
          metadata: prop.params.proposer.metadata,
          chains: [...new Set([...(ns?.chains ?? []), ...(opt?.chains ?? [])])].filter(c => c.startsWith('eip155:')),
          methods: [...new Set([...(ns?.methods ?? []), ...(opt?.methods ?? [])])],
        });
      };
      const onRequest = (evt: SignClientTypes.EventArguments['session_request']) => {
        setRequest({
          id: evt.id,
          topic: evt.topic,
          chainId: evt.params.chainId,
          method: evt.params.request.method,
          params: evt.params.request.params,
        });
      };
      const onDelete = () => refreshSessions();
      client.on('session_proposal', onProposal);
      client.on('session_request', onRequest);
      client.on('session_delete', onDelete);
      offs.push(
        () => client.off('session_proposal', onProposal),
        () => client.off('session_request', onRequest),
        () => client.off('session_delete', onDelete),
      );
      setReady(true);
      refreshSessions();
    })().catch(e => setMsg(e instanceof Error ? e.message : 'WalletConnect init failed'));
    return () => {
      cancelled = true;
      offs.forEach(off => off());
      if (locked) disposeSignClient().catch(() => undefined);
    };
  }, [locked, refreshSessions]);

  const pairUri = async (raw: string) => {
    setMsg('');
    try {
      const client = await getSignClient();
      await client.core.pairing.pair({ uri: raw.trim() });
      setScanning(false);
      setUri('');
      refreshSessions();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Pairing failed');
    }
  };

  const approveProposal = async () => {
    if (!proposal || !clientRef.current) return;
    const accountsNow = accountsRef.current;
    const { approved, unsupportedChains } = negotiateNamespace(proposal.chains, proposal.methods, accountsNow);
    if (approved.eip155.accounts.length === 0) {
      setMsg(`Cannot serve any requested chain${unsupportedChains.length ? ` (${unsupportedChains.join(', ')})` : ''}.`);
      return;
    }
    try {
      await clientRef.current.approve({ id: proposal.id, namespaces: approved as never });
      setProposal(null);
      refreshSessions();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Approve failed');
    }
  };

  const rejectProposal = async () => {
    if (!proposal || !clientRef.current) return;
    await clientRef.current.reject({ id: proposal.id, reason: { code: 6000, message: 'User rejected' } }).catch(() => undefined);
    setProposal(null);
  };

  const answerRequest = async (approve: boolean) => {
    if (!request || !clientRef.current) return;
    const client = clientRef.current;
    const envelope = {
      topic: request.topic,
      request: { id: request.id, jsonrpc: '2.0' as const, method: request.method },
    };
    try {
      if (!approve) {
        await client.respond({
          ...envelope,
          response: { id: request.id, jsonrpc: '2.0', error: { code: 5000, message: 'User rejected' } },
        } as never);
      } else {
        const result = await serve(request, accountsRef.current);
        await client.respond({
          ...envelope,
          response: { id: request.id, jsonrpc: '2.0', result },
        } as never);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setRequest(null);
      refreshSessions();
    }
  };

  if (!wcConfigured()) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen}>
        <Text style={styles.heading}>dApps</Text>
        <Text style={styles.body}>
          WalletConnect needs a free project id: create one at cloud.reown.com, set
          EXPO_PUBLIC_WC_PROJECT_ID, then rebuild. Everything else in the wallet works without it.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.rowBetween}>
        <Text style={styles.heading}>dApps</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{ready ? 'relay connected' : 'connecting…'}</Text>
        </View>
      </View>

      {/* ── connection prompt ── */}
      {proposal && (
        <View style={styles.sessionCard}>
          <Text style={styles.dappName}>{proposal.metadata.name ?? 'Unknown dApp'}</Text>
          <Text style={styles.monoSmall}>{proposal.metadata.url}</Text>
          <Text style={styles.status}>
            Requests {proposal.chains.length} chain(s): {proposal.chains.join(', ')}
          </Text>
          <Text style={styles.status}>Methods: {proposal.methods.join(', ')}</Text>
          <Button label="Connect" onPress={approveProposal} />
          <Button label="Reject" onPress={rejectProposal} secondary />
        </View>
      )}

      {/* ── request review ── */}
      {request && (
        <View style={[styles.sessionCard, { borderColor: styles.warning.color as string }]}>
          <Text style={styles.dappName}>Signing request · {request.method}</Text>
          <Text style={styles.monoSmall}>{request.chainId}</Text>
          <View style={styles.requestBox}>
            <Text style={styles.requestText} numberOfLines={8}>
              {previewRequest(request)}
            </Text>
          </View>
          <Button label="Approve" onPress={() => answerRequest(true)} />
          <Button label="Reject" onPress={() => answerRequest(false)} secondary />
        </View>
      )}

      {/* ── connect a dApp ── */}
      {!proposal && !request && (
        <View style={styles.card}>
          <Text style={styles.section}>Connect to a dApp</Text>
          {scanning && (
            <Camera
              style={{ height: 240, borderRadius: 12, overflow: 'hidden' }}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={async ({ data }) => {
                if (data.startsWith('wc:')) await pairUri(data);
              }}
            />
          )}
          {permission !== null && !permission.granted && scanning && (
            <Button label="Allow camera" onPress={() => requestPermission()} secondary />
          )}
          <Button
            label={scanning ? 'Close scanner' : 'Scan WalletConnect QR'}
            onPress={async () => {
              if (!scanning && permission?.granted !== true) await requestPermission();
              setScanning(s => !s);
            }}
            secondary
          />
          <TextInput
            autoCapitalize="none"
            value={uri}
            onChangeText={setUri}
            placeholder="…or paste a wc: connection link"
            placeholderTextColor="#78818f"
            style={styles.input}
          />
          <Button label="Pair from link" onPress={() => pairUri(uri)} disabled={!uri.trim()} />
        </View>
      )}

      {msg ? <Text style={styles.warning}>{msg}</Text> : null}

      {/* ── active sessions ── */}
      {sessions.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.section}>Connected ({sessions.length})</Text>
          {sessions.map(s => (
            <View key={s.topic} style={styles.sessionCard}>
              <Text style={styles.dappName}>{s.peer.metadata.name}</Text>
              <Text style={styles.monoSmall}>
                {Object.values(s.namespaces).flatMap(n => n.accounts).map(a => shorten(a, 12, 6)).join(' · ')}
              </Text>
              <Button
                label="Disconnect"
                danger
                onPress={async () => {
                  await clientRef.current?.disconnect({ topic: s.topic, reason: { code: 6000, message: 'Disconnected by user' } }).catch(() => undefined);
                  refreshSessions();
                }}
              />
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

/** Human-readable review line for a session request */
function previewRequest(req: PendingRequest): string {
  if (req.method === 'eth_sendTransaction') {
    const tx = (req.params as [{ from?: string; to?: string; value?: string; data?: string }])?.[0] ?? {};
    const parts = [`to: ${tx.to ?? '?'}`, `value: ${tx.value ?? '0x0'}`];
    if (tx.data && tx.data !== '0x') parts.push(`data: ${shorten(tx.data, 14, 8)}`);
    return parts.join('\n');
  }
  if (req.method === 'personal_sign') {
    const message = String((req.params as [string])?.[0] ?? '');
    return message.startsWith('0x') ? `raw bytes: ${shorten(message, 20, 10)}` : `text: ${message.slice(0, 220)}`;
  }
  return JSON.stringify(req.params).slice(0, 220);
}

/** Route an approved session request through the wallet's own pipelines */
async function serve(req: PendingRequest, accounts: Account[]): Promise<unknown> {
  const config = evmChainFromCaip(req.chainId);
  if (!config) throw new Error(`Unsupported chain ${req.chainId}`);
  const account = accounts.find(a => a.chainId === config.chainId);
  const adapter = chainRegistry.get(config.chainId);
  if (!account || !adapter) throw new Error(`No wallet account on ${req.chainId}`);

  switch (req.method) {
    case 'eth_accounts':
      return [account.address];
    case 'eth_chainId':
      return '0x' + BigInt(config.chainId.split('-').pop() ?? '0').toString(16);
    case 'wallet_switchEthereumChain':
      return null;
    case 'personal_sign': {
      const message = String((req.params as [string])?.[0] ?? '');
      const pk = getPrivateKey(account);
      try {
        return signPersonalMessage(message, pk);
      } finally {
        pk.fill(0);
      }
    }
    case 'eth_sendTransaction': {
      const tx = (req.params as [{ to?: string; value?: string; data?: string }])?.[0] ?? {};
      if (!tx.to) throw new Error('Transaction is missing "to"');
      const intent = tx.data && tx.data !== '0x'
        ? { kind: 'contract-call' as const, to: tx.to, data: tx.data, ...(tx.value ? { valueRaw: BigInt(tx.value).toString() } : {}) }
        : { kind: 'native-transfer' as const, to: tx.to, amountRaw: tx.value ? BigInt(tx.value).toString() : '0' };
      return await sendTx({ adapter, account, intent });
    }
    default:
      throw new Error(`${req.method} is not supported by this wallet`);
  }
}

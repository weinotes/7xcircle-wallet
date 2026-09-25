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
 * Send page — native and token transfers, chain-agnostic.
 *
 * Lifecycle:
 *   1. Choose token mode: Native (gas token) or ERC20/SPL (by address)
 *   2. Enter recipient + amount → real-time validation
 *   3. Fee auto-estimated for the matching intent
 *   4. Review → Build → Sign → Broadcast → Confirm
 *
 * Chain differences live entirely in the adapter. This page builds one
 * `TxIntent` — a native-transfer or a token-transfer — and hands it to
 * `useTxFlow`. ERC20 and SPL take the same code path; the adapter compiles
 * the intent into calldata or into Solana instructions respectively.
 *
 * Security:
 *   - Private key derived ONLY at signing time, wiped in a `finally`
 *   - Address validated before signing
 *   - Amount ≤ available balance enforced before broadcast
 *   - Token sends always call `.transfer()` (no infinite approval flow)
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Loader2, CheckCircle2, XCircle, Coins, Wallet, ChevronDown, ListPlus, ShieldAlert } from 'lucide-react';
import { Button, Input, Modal } from '@7xcircle/ui';
import { chainRegistry } from '@7xcircle/core';
import { useTransactionHistory } from '../hooks/useTransactionHistory.js';
import { useWalletStore, selectActiveAccount } from '../store/wallet.js';
import {
  CHAIN_CONFIGS,
  DEFAULT_DURATION_SEC,
  MIN_ENERGY_ORDER,
  buildPaymentIntent,
  buyResource,
  estimateBuyResource,
  fetchResourceOrder,
  fundAddressFor,
  isEnsName,
  planResourcePurchase,
  resolveEnsName,
  type ResourceEstimate,
  type ResourceOrder,
  type SignedTxPayload,
  type TronResourceEstimate,
} from '@7xcircle/chains';
import { formatBalance } from '@7xcircle/shared';
import { findLookalikes } from '@7xcircle/shared';
import type { FeeTier, TokenBalance, TxIntent } from '@7xcircle/shared';
import { useTxFlow } from '../hooks/useTxFlow.js';
import { signForAccount } from '../hw/signFor.js';

type TxStatus = 'idle' | 'estimating' | 'ready' | 'building' | 'signing' | 'broadcasting' | 'pending' | 'confirmed' | 'failed';
/** Statuses owned by local fee estimation (the hook owns the rest) */
type EstimateStatus = 'idle' | 'estimating' | 'ready';
type TokenMode = 'native' | 'erc20';

interface Erc20Info {
  symbol: string;
  decimals: number;
  name: string;
  address: string;
}

/**
 * Tron's resource model, which only TronAdapter implements. Kept as a local
 * capability interface so this page can offer the energy advisory for TRON
 * without casting the shared ChainAdapter contract into something it is not.
 */
interface TronResourceCapable {
  estimateResources(intent: TxIntent, opts: { from: string; feeTier?: FeeTier }): Promise<TronResourceEstimate>;
}

/** The energy advisory shown above the send button on TRON */
interface EnergyHint {
  energyUsed: number;
  energyShortfall: number;
  /** TRX (in SUN) burned as gas for the uncovered energy */
  burnSun: string;
  /** lot the rental market can actually sell; 0 when there is nothing to buy */
  orderAmount: number;
  skipReason?: 'covered' | 'below-minimum';
  /** the priced rental lot, or null when no supplier quoted this lot */
  rent: ResourceEstimate | null;
}

/**
 * Rental purchase state. Kept inline (not a modal) so the exact TRX cost and
 * the fund address sit next to the number that justified the purchase.
 */
type RentalStep = 'idle' | 'confirm' | 'working' | 'done' | 'error';

/** Poll cadence for a placed order — the delegation lands in seconds usually */
const RENT_POLL_INTERVAL_MS = 5_000;
const RENT_POLL_ATTEMPTS = 12;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait for a rental order to fill.
 *
 * Returns the last order it managed to read — `null` only when every read
 * failed. A partially filled order is a real outcome (the supplier may deliver
 * in instalments), so the caller renders the percentage rather than waiting
 * for 100%.
 */
async function waitForRental(orderId: string, isCancelled: () => boolean): Promise<ResourceOrder | null> {
  let last: ResourceOrder | null = null;
  for (let attempt = 0; attempt < RENT_POLL_ATTEMPTS; attempt++) {
    if (isCancelled()) return last;
    const order = await fetchResourceOrder(orderId);
    if (order) {
      last = order;
      if (order.fulfilledPercent >= 100) return order;
    }
    if (attempt < RENT_POLL_ATTEMPTS - 1) await sleep(RENT_POLL_INTERVAL_MS);
  }
  return last;
}

export function Send() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [tokenMode, setTokenMode] = useState<TokenMode>('native');
  // Recipient: the typed text (may be an ENS name) and the RESOLVED address
  // every downstream step — validation, fees, signing — exclusively uses.
  const [recipientInput, setRecipientInput] = useState('');
  const [ensStage, setEnsStage] = useState<'none' | 'resolving' | 'resolved' | 'unresolved'>('none');
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  /** Fee-estimation phase only — the transaction phase lives in useTxFlow */
  const [estimateStatus, setEstimateStatus] = useState<EstimateStatus>('idle');
  const [feeTier, setFeeTier] = useState<FeeTier>('normal');

  // ERC20-specific state
  const [erc20Address, setErc20Address] = useState('');
  const [tokenInfo, setTokenInfo] = useState<Erc20Info | null>(null);
  const [tokenInfoLoading, setTokenInfoLoading] = useState(false);
  const [tokenInfoError, setTokenInfoError] = useState<string | null>(null);
  /**
   * Token-safety findings for the entered contract — advisory banner.
   * `null` = the chain (or the oracle) has no opinion. An empty array means
   * every check passed, so the two must never be collapsed.
   */
  const [safetyWarnings, setSafetyWarnings] = useState<string[] | null>(null);

  // Held tokens list (for dropdown selection), and manual-input toggle
  const [heldTokens, setHeldTokens] = useState<TokenBalance[]>([]);
  const [heldTokensLoading, setHeldTokensLoading] = useState(false);
  const [selectedHeldToken, setSelectedHeldToken] = useState<TokenBalance | null>(null);
  const [manualTokenInput, setManualTokenInput] = useState(false);

  // Token search filter state
  const [tokenSearch, setTokenSearch] = useState('');
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);

  const [feeInfo, setFeeInfo] = useState<{
    nativeFee: string;
    rawFee: string;
    gasLimit: string;
    gasPrice: string;
  } | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [validationError, setValidationError] = useState('');
  /** TRON only — null whenever the advisory does not apply */
  const [energyHint, setEnergyHint] = useState<EnergyHint | null>(null);
  /** TRON rental purchase, driven from the advisory card */
  const [rentalStep, setRentalStep] = useState<RentalStep>('idle');
  const [rentalError, setRentalError] = useState<string | null>(null);
  const [rentalOrder, setRentalOrder] = useState<ResourceOrder | null>(null);
  const rentalAlive = useRef(true);
  useEffect(() => {
    rentalAlive.current = true;
    return () => { rentalAlive.current = false; };
  }, []);

  const activeChainId = useWalletStore(s => s.activeChainId);
  const fromAccount = useWalletStore(selectActiveAccount);

  const adapter = chainRegistry.get(activeChainId);
  const activeChain = CHAIN_CONFIGS.find(c => c.chainId === activeChainId);

  // Poisoning guard: past recipients on this chain are the "known shapes" a
  // forged head+tail address would try to blend into.
  const { transactions: recipientHistory } = useTransactionHistory(
    activeChainId,
    fromAccount?.address,
  );
  const lookalikes = useMemo(() => {
    if (!toAddress || !fromAccount || !adapter?.validateAddress(toAddress)) return [];
    const known = new Set<string>([fromAccount.address]);
    for (const tx of recipientHistory) {
      if (tx.direction === 'sent' && tx.to) known.add(tx.to);
    }
    return findLookalikes(toAddress, known);
  }, [toAddress, fromAccount, adapter, recipientHistory]);

  // Build → sign → broadcast → confirm, including Solana blockhash retry
  const flow = useTxFlow({ adapter, account: fromAccount, chainId: activeChainId, feeTier });

  // ── ENS name → address (EVM chains only, debounced) ──
  // Every downstream step consumes `toAddress`; it stays EMPTY until a name
  // resolves, so an un-deadlined .eth can never reach the sign path.
  useEffect(() => {
    const typed = recipientInput.trim();
    if (activeChain?.type !== 'evm' || !isEnsName(typed)) {
      // A plain address (or a non-EVM chain): typed text IS the address
      setToAddress(typed);
      setEnsStage('none');
      return;
    }
    setEnsStage('resolving');
    setToAddress('');
    let cancelled = false;
    const timer = setTimeout(() => {
      resolveEnsName(typed)
        .then(addr => {
          if (cancelled) return;
          if (addr) {
            setToAddress(addr);
            setEnsStage('resolved');
          } else {
            setEnsStage('unresolved');
          }
        })
        .catch(() => { if (!cancelled) setEnsStage('unresolved'); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [recipientInput, activeChain?.type]);

  /**
   * A single status for the UI to render. The transaction phase wins once it
   * starts; before that we show the fee-estimation phase.
   */
  const status: TxStatus = flow.status !== 'idle' ? flow.status : estimateStatus;
  const txHash = flow.txHash;
  const txError = flow.error;

  // ── Resolve which token we're sending ──────────────────────────────
  const sendToken = useMemo(() => {
    if (tokenMode === 'erc20' && tokenInfo) {
      return {
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        isNative: false,
        address: tokenInfo.address,
      };
    }
    return {
      symbol: activeChain?.nativeSymbol ?? '',
      decimals: activeChain?.nativeDecimals ?? 18,
      isNative: true,
      address: 'native',
    };
  }, [tokenMode, tokenInfo, activeChain]);

  // ── Fetch held tokens (for dropdown) when entering ERC20 mode ─────
  useEffect(() => {
    if (tokenMode !== 'erc20' || !adapter || !fromAccount) {
      setHeldTokens([]);
      return;
    }
    let cancelled = false;
    setHeldTokensLoading(true);
    adapter.getAllTokenBalances(fromAccount.address)
      .then(list => {
        if (cancelled) return;
        // Filter to non-native tokens with balance > 0
        const erc20 = list.filter(t => !t.isNative && BigInt(t.balance || '0') > 0n);
        setHeldTokens(erc20);
        // Auto-select first token if we have any
        if (erc20.length > 0 && !selectedHeldToken && !manualTokenInput) {
          handleSelectHeldToken(erc20[0]);
        }
      })
      .catch(() => { if (!cancelled) setHeldTokens([]); })
      .finally(() => { if (!cancelled) setHeldTokensLoading(false); });
    return () => { cancelled = true; };
  }, [tokenMode, adapter, fromAccount?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Select a held token from dropdown → prefill tokenInfo ──────────
  const handleSelectHeldToken = useCallback((t: TokenBalance) => {
    setSelectedHeldToken(t);
    setManualTokenInput(false);
    setErc20Address(t.address);
    setTokenInfo({
      symbol: t.symbol,
      decimals: t.decimals,
      name: t.name,
      address: t.address,
    });
    setTokenInfoError(null);
    setAmount(''); // reset amount when switching token
    setTokenSearch('');
    setTokenDropdownOpen(false);
  }, []);

  // ── Filter held tokens by search query ──────────────────────────────
  const filteredHeldTokens = useMemo(() => {
    const q = tokenSearch.trim().toLowerCase();
    if (!q) return heldTokens;
    return heldTokens.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
    );
  }, [heldTokens, tokenSearch]);

  // ── Smart balance formatting: big balances → fewer decimals ─────────
  const formatTokenBalance = useCallback((raw: string, decimals: number): string => {
    const value = Number(formatBalance(raw, decimals, 8));
    if (value === 0) return '0';
    if (value >= 1000) return formatBalance(raw, decimals, 2);
    if (value >= 1) return formatBalance(raw, decimals, 4);
    return formatBalance(raw, decimals, 6);
  }, []);

  // ── Load ERC20 token info when contract address changes ────────────
  useEffect(() => {
    if (tokenMode !== 'erc20') {
      setTokenInfo(null);
      setTokenInfoError(null);
      return;
    }

    if (!adapter || !erc20Address) {
      setTokenInfo(null);
      setTokenInfoError(null);
      return;
    }

    if (!adapter.validateAddress(erc20Address)) {
      setTokenInfo(null);
      setTokenInfoError(t('send.invalidContractAddress'));
      return;
    }

    let cancelled = false;
    setTokenInfoLoading(true);
    setTokenInfoError(null);

    // Debounce: wait 400ms before hitting RPC
    const timer = setTimeout(async () => {
      try {
        const info = await adapter.getTokenInfo(erc20Address);
        if (cancelled) return;
        setTokenInfo({ ...info, address: erc20Address });
        // Token-safety scan — EVM via GoPlus, Solana straight off the mint
        // account. Advisory only, never blocks (false positives exist), but
        // a honeypot or a live mint authority must be LOUD.
        setSafetyWarnings(null);
        adapter.getTokenSafety?.(erc20Address)
          .then(report => { if (!cancelled) setSafetyWarnings(report?.warnings ?? null); })
          .catch(() => { if (!cancelled) setSafetyWarnings(null); });
      } catch {
        if (cancelled) return;
        setTokenInfo(null);
        setTokenInfoError(t('send.notValidToken'));
      } finally {
        if (!cancelled) setTokenInfoLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tokenMode, erc20Address, adapter]);

  // ── Load balance: native or token ───────────────────────────────────
  useEffect(() => {
    if (!fromAccount || !adapter) return;

    if (tokenMode === 'native') {
      adapter.getNativeBalance(fromAccount.address)
        .then(b => setBalance(b))
        .catch(() => setBalance('0'));
    } else if (tokenMode === 'erc20' && tokenInfo) {
      adapter.getTokenBalance(fromAccount.address, tokenInfo.address)
        .then(b => setBalance(b))
        .catch(() => setBalance('0'));
    }
  }, [fromAccount?.address, activeChainId, tokenMode, tokenInfo?.address]);

  // ── Validate amount format: must be "digits[.digits]" ──────────────
  const isValidAmountFormat = (v: string): boolean => {
    if (!v) return false;
    if (!/^\d*\.?\d+$/.test(v)) return false;
    const cleaned = v.replace(/[.]/g, '');
    if (/^0+$/.test(cleaned)) return false;
    return true;
  };

  // ── Real-time amount validation + fee estimation ─────────────────
  useEffect(() => {
    setFeeInfo(null);
    setValidationError('');

    if (!adapter || !fromAccount || !activeChain) {
      setValidationError(t('send.walletNotReady'));
      return;
    }

    // Address validation (ERC20 path must also validate recipient)
    if (toAddress && !adapter.validateAddress(toAddress)) {
      setValidationError(t('send.invalidAddress'));
      return;
    }

    // ERC20 contract must be valid and loaded
    if (tokenMode === 'erc20' && !tokenInfo) {
      if (tokenInfoError) {
        setValidationError(tokenInfoError);
      } else if (erc20Address && !tokenInfoLoading) {
        setValidationError(t('send.invalidContractAddress'));
      }
      return;
    }

    // Amount format validation
    if (amount && !isValidAmountFormat(amount)) {
      setValidationError(t('send.invalidAmount'));
      return;
    }

    // Parse raw amount with correct decimals
    let rawAmount = '';
    if (amount) {
      try {
        if (sendToken.isNative) {
          rawAmount = adapter.parseAmount(amount);
        } else {
          rawAmount = adapter.parseTokenAmount(amount, sendToken.decimals);
        }
      } catch {
        setValidationError(t('send.invalidAmount'));
        return;
      }
      if (BigInt(rawAmount) <= 0n) {
        setValidationError(t('send.amountMustBePositive'));
        return;
      }
      if (BigInt(rawAmount) > BigInt(balance)) {
        setValidationError(t('send.amountExceeds'));
        return;
      }
    }

    // Fee estimation — needs valid to + positive amount
    if (toAddress && adapter.validateAddress(toAddress) && rawAmount && BigInt(rawAmount) > 0n) {
      void estimateFee();
    }

    async function estimateFee() {
      setEstimateStatus('estimating');
      try {
        // A single intent covers native, ERC20 and SPL alike — the adapter
        // compiles it into whatever the chain needs. (Previously this branch
        // called `encodeErc20Transfer`, which does not exist on Solana, so
        // SPL transfers could not estimate a fee at all.)
        const intent: TxIntent = sendToken.isNative
          ? { kind: 'native-transfer', to: toAddress, amountRaw: rawAmount }
          : {
              kind: 'token-transfer',
              token: sendToken.address,
              decimals: sendToken.decimals,
              to: toAddress,
              amountRaw: rawAmount,
            };

        const fees = await adapter!.estimateFees(intent, {
          from: fromAccount!.address,
          feeTier,
        });
        const formattedFee = formatBalance(fees.totalFee, activeChain!.nativeDecimals, 8);
        setFeeInfo({
          nativeFee: formattedFee,
          rawFee: fees.totalFee,
          gasLimit: fees.gasLimit,
          gasPrice: fees.gasPrice,
        });
        setEstimateStatus('ready');
      } catch {
        setValidationError(t('send.couldNotEstimateFee'));
        setEstimateStatus('idle');
      }
    }
  }, [toAddress, amount, adapter, fromAccount, activeChain, tokenMode, erc20Address, tokenInfo, sendToken, balance, tokenInfoLoading, tokenInfoError, feeTier]);

  // ── TRON energy advisory (TRC20 only) ──────────────────────────────
  /**
   * A TRC20 transfer consumes energy. Anything the account has not staked is
   * burned as TRX — and renting that energy from the open market is usually
   * cheaper, which is exactly what TronSave prices for us (keyless, so this
   * line works with zero configuration). The number is shown BEFORE signing,
   * because afterwards it is already spent.
   *
   * A plain TRX send burns only bandwidth, which is cheap enough that an
   * advisory would be noise — hence the TRC20-only gate.
   */
  useEffect(() => {
    // A recomputed hint invalidates any rental confirmation the user was
    // looking at — the price it referred to may no longer be the price.
    setRentalStep('idle');
    setRentalError(null);
    setRentalOrder(null);

    const capable = adapter as Partial<TronResourceCapable> | undefined;
    if (
      activeChain?.type !== 'tron' ||
      !fromAccount ||
      tokenMode !== 'erc20' ||
      !tokenInfo ||
      !adapter ||
      typeof capable?.estimateResources !== 'function' ||
      !toAddress ||
      !adapter.validateAddress(toAddress)
    ) {
      setEnergyHint(null);
      return;
    }

    let rawAmount = '';
    try {
      rawAmount = adapter.parseTokenAmount(amount, tokenInfo.decimals);
    } catch {
      setEnergyHint(null);
      return;
    }
    if (!rawAmount || BigInt(rawAmount) <= 0n) {
      setEnergyHint(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const estimate = await (capable.estimateResources as TronResourceCapable['estimateResources']).call(
          adapter,
          {
            kind: 'token-transfer',
            token: tokenInfo.address,
            decimals: tokenInfo.decimals,
            to: toAddress,
            amountRaw: rawAmount,
          },
          { from: fromAccount.address },
        );
        if (cancelled) return;

        const gap = planResourcePurchase(estimate.energyUsed, estimate.energyAvailable, MIN_ENERGY_ORDER);
        // Only ask for a price when there is a whole lot to buy: a sub-lot
        // gap has no order, so a price for it would be fiction.
        const rent = gap.orderAmount > 0
          ? await estimateBuyResource({
              // The SENDER pays the energy bill, so the sender is the receiver
              // of the delegation.
              receiver: fromAccount.address,
              resourceType: 'ENERGY',
              resourceAmount: gap.orderAmount,
              durationSec: DEFAULT_DURATION_SEC,
              unitPrice: 'SLOW',
            })
          : null;
        if (cancelled) return;

        setEnergyHint({
          energyUsed: estimate.energyUsed,
          energyShortfall: estimate.energyShortfall,
          burnSun: estimate.burnSun,
          orderAmount: gap.orderAmount,
          ...(gap.skipReason ? { skipReason: gap.skipReason } : {}),
          rent,
        });
      } catch {
        // No advisory is better than a wrong one
        if (!cancelled) setEnergyHint(null);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeChain, adapter, fromAccount, tokenMode, tokenInfo, toAddress, amount]);

  /**
   * Buy the priced energy lot.
   *
   * The payment is signed here but deliberately NEVER broadcast by us: TronSave
   * broadcasts it as part of the order, and a payment the order does not know
   * about is money lost. So the failure mode is safe — a failed order leaves an
   * unbroadcast signature that simply expires with its TAPOS reference, and no
   * TRX has moved.
   */
  const handleRentEnergy = useCallback(async () => {
    const rent = energyHint?.rent;
    if (!adapter || !fromAccount || !activeChain || !rent) return;

    setRentalStep('working');
    setRentalError(null);
    setRentalOrder(null);
    try {
      const intent = buildPaymentIntent(rent.estimateTrxSun, fundAddressFor(!!activeChain.testnet));
      const unsigned = await adapter.buildTransaction(intent, {
        from: fromAccount.address,
        feeTier,
      });
      const signed = await signForAccount(fromAccount, unsigned, adapter);

      const ack = await buyResource(
        {
          receiver: fromAccount.address,
          resourceType: 'ENERGY',
          unitPriceSun: rent.unitPriceSun,
          resourceAmount: energyHint.orderAmount,
          durationSec: DEFAULT_DURATION_SEC,
        },
        signed.raw as SignedTxPayload,
      );
      if (!ack) {
        if (!rentalAlive.current) return;
        setRentalError(t('send.tronEnergyRentFailed'));
        setRentalStep('error');
        return;
      }

      const order = await waitForRental(ack.orderId, () => !rentalAlive.current);
      if (!rentalAlive.current) return;
      setRentalOrder(order ?? { orderId: ack.orderId, fulfilledPercent: 0, remainAmount: 0, payoutAmount: 0, delegates: [] });
      setRentalStep('done');
    } catch (e) {
      if (!rentalAlive.current) return;
      setRentalError(e instanceof Error ? e.message : t('send.tronEnergyRentFailed'));
      setRentalStep('error');
    }
  }, [adapter, fromAccount, activeChain, energyHint, feeTier, t]);

  // Confirmation polling now lives in useTxFlow, which also owns the
  // Solana blockhash-expiry retry.

  /**
   * Once the transaction is actually built the adapter knows the exact fee.
   * Prefer it over the pre-build estimate so the confirm screen shows what
   * will really be paid.
   */
  useEffect(() => {
    const fee = flow.resolvedFee;
    if (!fee || !activeChain) return;
    setFeeInfo({
      nativeFee: formatBalance(fee.totalFee, activeChain.nativeDecimals, 8),
      rawFee: fee.totalFee,
      gasLimit: fee.gasLimit,
      gasPrice: fee.gasPrice,
    });
  }, [flow.resolvedFee, activeChain]);

  // ── Main send handler ──────────────────────────────────────────────
  const handleSend = async () => {
    if (!adapter || !fromAccount) {
      setValidationError(t('send.walletNotReady'));
      return;
    }

    if (tokenMode === 'erc20' && !tokenInfo) {
      setValidationError(t('send.tokenNotLoaded'));
      return;
    }

    setShowConfirm(false);
    setValidationError('');

    const rawAmount = sendToken.isNative
      ? adapter.parseAmount(amount)
      : adapter.parseTokenAmount(amount, sendToken.decimals);

    // One intent covers native, ERC20 and SPL. There is no chain branch
    // here — the adapter compiles it into whatever the chain needs.
    const intent: TxIntent = sendToken.isNative
      ? { kind: 'native-transfer', to: toAddress, amountRaw: rawAmount }
      : {
          kind: 'token-transfer',
          token: sendToken.address,
          decimals: sendToken.decimals,
          to: toAddress,
          amountRaw: rawAmount,
        };

    await flow.send(intent, {
      // The RECIPIENT, not the token contract. Storing the contract here
      // (as the previous implementation did) hid where funds actually went.
      displayTo: toAddress,
      amountRaw: rawAmount,
      token: sendToken.isNative
        ? undefined
        : {
            symbol: sendToken.symbol,
            address: sendToken.address,
            decimals: sendToken.decimals,
            isNative: false,
          },
    });
  };

  // ── Max button ──────────────────────────────────────────────────────
  const useMax = () => {
    if (!fromAccount || !sendToken || !activeChain) return;

    if (sendToken.isNative) {
      // Native: balance - fee
      const bal = BigInt(balance);
      const fee = feeInfo ? BigInt(feeInfo.rawFee) : 0n;
      const maxRaw = bal > fee ? bal - fee : 0n;
      setAmount(formatBalance(maxRaw.toString(), sendToken.decimals, 8));
    } else {
      // ERC20: can send full balance (token transfer gas is separate)
      setAmount(formatBalance(balance, sendToken.decimals, 8));
    }
  };

  // ── Styles ─────────────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    maxWidth: 480,
    margin: '0 auto',
    padding: 'var(--ow-space-6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--ow-space-4)',
    marginTop: '5vh',
  };

  // ── Final outcome modal ────────────────────────────────────────────
  if (status === 'confirmed' || status === 'failed') {
    const isOk = status === 'confirmed';
    return (
      <div style={cardStyle}>
        <Modal
          open={true}
          onClose={() => { flow.reset(); navigate('/'); }}
          title={isOk ? t('send.txConfirmed') : t('send.txFailed')}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-3)', alignItems: 'center' }}>
            {isOk
              ? <CheckCircle2 size={48} color="var(--ow-success)" />
              : <XCircle size={48} color="var(--ow-error)" />}
            <div style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-text-tertiary)' }}>
              {isOk ? t('send.txConfirmedDesc') : (txError ?? t('send.txFailedDesc'))}
            </div>
            {txHash && (
              <div style={{
                fontFamily: 'var(--ow-font-mono)',
                fontSize: 'var(--ow-font-size-xs)',
                wordBreak: 'break-all',
                backgroundColor: 'var(--ow-bg-tertiary)',
                padding: 'var(--ow-space-3)',
                borderRadius: 'var(--ow-radius-md)',
                border: '1px solid var(--ow-border-subtle)',
              }}>
                {txHash}
              </div>
            )}
          </div>
        </Modal>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────
  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-3)' }}>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} disabled={status === 'pending'}>
          <ArrowLeft size={16} />
        </Button>
        <div style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700 }}>{t('send.title')}</div>
        <div style={{ marginLeft: 'auto', fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
          {activeChain?.name}
        </div>
      </div>

      {/* ── Token selector tabs ────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: 2,
        backgroundColor: 'var(--ow-bg-secondary)',
        borderRadius: 'var(--ow-radius-md)',
        padding: 2,
      }}>
        <button
          onClick={() => { setTokenMode('native'); setTokenInfo(null); setErc20Address(''); }}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '8px 12px',
            border: 'none',
            borderRadius: 'var(--ow-radius-md)',
            cursor: 'pointer',
            fontSize: 'var(--ow-font-size-sm)',
            fontWeight: tokenMode === 'native' ? 600 : 400,
            backgroundColor: tokenMode === 'native' ? 'var(--ow-bg-primary)' : 'transparent',
            color: tokenMode === 'native' ? 'var(--ow-text-primary)' : 'var(--ow-text-secondary)',
            transition: 'background-color 150ms',
          }}
        >
          <Wallet size={14} /> {t('send.native')}
        </button>
        <button
          onClick={() => setTokenMode('erc20')}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '8px 12px',
            border: 'none',
            borderRadius: 'var(--ow-radius-md)',
            cursor: 'pointer',
            fontSize: 'var(--ow-font-size-sm)',
            fontWeight: tokenMode === 'erc20' ? 600 : 400,
            backgroundColor: tokenMode === 'erc20' ? 'var(--ow-bg-primary)' : 'transparent',
            color: tokenMode === 'erc20' ? 'var(--ow-text-primary)' : 'var(--ow-text-secondary)',
            transition: 'background-color 150ms',
          }}
        >
          <Coins size={14} /> {t('send.erc20')}
        </button>
      </div>

      {/* ── ERC20 token selector: dropdown or manual input ───────────── */}
      {tokenMode === 'erc20' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Toggle row */}
          {heldTokens.length > 0 && !heldTokensLoading && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <button
                onClick={() => { setManualTokenInput(false); setSelectedHeldToken(null); }}
                style={{
                  flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '6px 10px',
                  border: 'none', borderRadius: 'var(--ow-radius-sm)',
                  fontSize: 'var(--ow-font-size-xs)',
                  cursor: 'pointer',
                  backgroundColor: !manualTokenInput ? 'var(--ow-bg-tertiary)' : 'transparent',
                  color: !manualTokenInput ? 'var(--ow-text-primary)' : 'var(--ow-text-tertiary)',
                  fontWeight: !manualTokenInput ? 600 : 400,
                }}
              >
                <Coins size={12} /> {t('send.heldTokens', { count: heldTokens.length })}
              </button>
              <button
                onClick={() => { setManualTokenInput(true); setSelectedHeldToken(null); setTokenInfo(null); }}
                style={{
                  flex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '6px 10px',
                  border: 'none', borderRadius: 'var(--ow-radius-sm)',
                  fontSize: 'var(--ow-font-size-xs)',
                  cursor: 'pointer',
                  backgroundColor: manualTokenInput ? 'var(--ow-bg-tertiary)' : 'transparent',
                  color: manualTokenInput ? 'var(--ow-text-primary)' : 'var(--ow-text-tertiary)',
                  fontWeight: manualTokenInput ? 600 : 400,
                }}
              >
                <ListPlus size={12} /> {t('send.customAddress')}
              </button>
            </div>
          )}

          {/* Held tokens dropdown (searchable) */}
          {!manualTokenInput && heldTokens.length > 0 && (
            <div>
              <label style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
                {t('send.selectToken')}
              </label>
              <div style={{ position: 'relative', marginTop: 4 }}>
                {/* Search / selection input */}
                <div style={{ position: 'relative' }}>
                  <input
                    value={tokenSearch}
                    placeholder={selectedHeldToken
                      ? `${selectedHeldToken.symbol} · ${formatTokenBalance(selectedHeldToken.balance, selectedHeldToken.decimals)}`
                      : t('send.searchPlaceholder')}
                    onFocus={() => setTokenDropdownOpen(true)}
                    onChange={e => {
                      const v = e.target.value;
                      setTokenSearch(v);
                      setTokenDropdownOpen(true);
                      // If the query looks like a 0x contract address, surface
                      // it into the manual-input mode automatically
                      if (/^0x[a-fA-F0-9]{6,}$/.test(v.trim())) {
                        setErc20Address(v.trim());
                      }
                    }}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--ow-bg-secondary)',
                      color: 'var(--ow-text-primary)',
                      border: `1px solid ${tokenInfoError ? 'var(--ow-error)' : 'var(--ow-border)'}`,
                      borderRadius: 'var(--ow-radius-md)',
                      padding: '10px 32px 10px 12px',
                      fontSize: 'var(--ow-font-size-sm)',
                      outline: 'none',
                    }}
                  />
                  <ChevronDown
                    size={14}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ow-text-tertiary)', pointerEvents: 'none' }}
                  />
                </div>

                {/* Dropdown list */}
                {tokenDropdownOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    maxHeight: 240,
                    overflowY: 'auto',
                    backgroundColor: 'var(--ow-bg-secondary)',
                    border: '1px solid var(--ow-border)',
                    borderRadius: 'var(--ow-radius-md)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                    zIndex: 100,
                  }}>
                    {filteredHeldTokens.length === 0 ? (
                      <div style={{ padding: 'var(--ow-space-3)', fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)', textAlign: 'center' }}>
                        {/^0x[a-fA-F0-9]{6,}$/.test(tokenSearch.trim())
                          ? <div onClick={() => { setManualTokenInput(true); setErc20Address(tokenSearch.trim()); setTokenInfo(null); setTokenDropdownOpen(false); }}
                              style={{ color: 'var(--ow-info)', cursor: 'pointer', fontWeight: 600 }}>
                              {t('send.loadTokenAt', { addr: tokenSearch.trim().slice(0, 10) })}
                            </div>
                          : t('send.noTokensMatch', { query: tokenSearch })}
                      </div>
                    ) : (
                      filteredHeldTokens.map(t => (
                        <div
                          key={t.address}
                          onClick={() => handleSelectHeldToken(t)}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--ow-bg-tertiary)')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            padding: '10px 12px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--ow-border-subtle)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                              backgroundColor: 'var(--ow-bg-tertiary)',
                              border: '1px solid var(--ow-border)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, fontWeight: 700, fontFamily: 'var(--ow-font-mono)',
                              color: 'var(--ow-text-secondary)',
                            }}>
                              {t.symbol.slice(0, 3).toUpperCase()}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 'var(--ow-font-size-sm)', fontWeight: 600 }}>
                                {t.symbol}
                                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ow-text-tertiary)', fontFamily: 'var(--ow-font-mono)' }}>
                                  {t.address.slice(0, 6)}…{t.address.slice(-4)}
                                </span>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--ow-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {t.name}
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize: 'var(--ow-font-size-sm)', fontFamily: 'var(--ow-font-mono)', flexShrink: 0 }}>
                            {formatTokenBalance(t.balance, t.decimals)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Held tokens empty state */}
          {!manualTokenInput && heldTokens.length === 0 && !heldTokensLoading && (
            <div style={{
              padding: 'var(--ow-space-3)',
              backgroundColor: 'var(--ow-bg-secondary)',
              border: '1px dashed var(--ow-border-subtle)',
              borderRadius: 'var(--ow-radius-md)',
              fontSize: 'var(--ow-font-size-xs)',
              color: 'var(--ow-text-tertiary)',
              textAlign: 'center',
            }}>
              {t('send.noTokensFound')}
            </div>
          )}

          {/* Manual contract address input */}
          {(manualTokenInput || (heldTokens.length === 0 && !heldTokensLoading)) && (
            <Input
              label={t('send.tokenContractLabel')}
              placeholder={t('send.tokenContractPlaceholder')}
              value={erc20Address}
              onChange={e => { setErc20Address(e.target.value); setTokenInfo(null); }}
              error={tokenInfoError ?? undefined}
            />
          )}

          {tokenInfoLoading && (
            <div style={{
              fontSize: 'var(--ow-font-size-xs)',
              color: 'var(--ow-text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <Loader2 size={10} style={{ animation: 'ow-spin 1s linear infinite' }} /> {t('send.readingTokenInfo')}
            </div>
          )}
          {tokenInfo && (
            <div style={{
              fontSize: 'var(--ow-font-size-xs)',
              color: 'var(--ow-success)',
            }}>
              {t('send.tokenLoaded', { name: tokenInfo.name || tokenInfo.symbol, symbol: tokenInfo.symbol, decimals: tokenInfo.decimals })}
            </div>
          )}
          {/* Safety advisory: red = concrete risks found, muted = no data */}
          {safetyWarnings && safetyWarnings.length > 0 && (
            <div style={{
              fontSize: 'var(--ow-font-size-xs)',
              color: 'var(--ow-danger)',
              border: '1px solid var(--ow-danger)',
              borderRadius: 'var(--ow-radius-sm, 8px)',
              padding: '6px 8px',
            }}>
              ⚠️ {t('send.safetyRisks', { risks: safetyWarnings.join(' · ') })}
            </div>
          )}
          {safetyWarnings && safetyWarnings.length === 0 && (
            <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
              ✓ {t('send.safetyClean')}
            </div>
          )}
          {!safetyWarnings && !tokenInfoLoading && tokenInfo && (
            <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
              {t('send.safetyUnknown')}
            </div>
          )}
        </div>
      )}

      {/* ── From address + balance ──────────────────────────────────── */}
      {fromAccount && (
        <div style={{
          backgroundColor: 'var(--ow-bg-secondary)',
          padding: 'var(--ow-space-3)',
          borderRadius: 'var(--ow-radius-md)',
          border: '1px solid var(--ow-border-subtle)',
          fontSize: 'var(--ow-font-size-xs)',
        }}>
          <div style={{ color: 'var(--ow-text-tertiary)', marginBottom: 'var(--ow-space-1)' }}>
            {t('send.from')}
          </div>
          <div style={{ fontFamily: 'var(--ow-font-mono)', wordBreak: 'break-all' }}>
            {fromAccount.address}
          </div>
          <div style={{ color: 'var(--ow-text-secondary)', marginTop: 'var(--ow-space-2)' }}>
            {t('send.balance', { amount: formatBalance(balance, sendToken.decimals, 8), symbol: sendToken.symbol })}
            {!sendToken.isNative && activeChain && (
              <span style={{ color: 'var(--ow-text-tertiary)', marginLeft: 8 }}>
                {t('send.gasHint', { amount: formatBalance(BigInt(adapter?.parseAmount?.('0.1') ?? '100000000000000000'), activeChain.nativeDecimals, 4) || '0', symbol: activeChain.nativeSymbol })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Recipient ────────────────────────────────────────────────── */}
      <Input
        label={t('send.recipientLabel')}
        placeholder={t('send.recipientPlaceholder')}
        value={recipientInput}
        onChange={e => setRecipientInput(e.target.value)}
        error={
          ensStage === 'unresolved'
            ? t('send.unresolvedName', { name: recipientInput.trim() })
            : recipientInput && toAddress && adapter && !adapter.validateAddress(toAddress)
              ? t('send.invalidAddress')
              : undefined
        }
        hint={ensStage === 'resolving' ? t('send.resolvingName') : undefined}
      />
      {ensStage === 'resolved' && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--ow-space-2)',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginTop: 'calc(-1 * var(--ow-space-2))',
            fontSize: 'var(--ow-font-size-xs)',
            color: 'var(--ow-positive-fg)',
          }}
        >
          <CheckCircle2 size={13} aria-hidden="true" />
          <span>{recipientInput.trim()} →</span>
          <span className="ow-mono" style={{ wordBreak: 'break-all' }}>{toAddress}</span>
        </div>
      )}

      {/* ── Poisoning guard banner ───────────────────────────────── */}
      {lookalikes.length > 0 && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 'var(--ow-space-2)',
            alignItems: 'flex-start',
            padding: 'var(--ow-space-3)',
            borderRadius: 'var(--ow-radius-md)',
            backgroundColor: 'var(--ow-error-bg)',
            border: '1px solid var(--ow-negative)',
            color: 'var(--ow-negative-fg)',
            fontSize: 'var(--ow-font-size-sm)',
          }}
        >
          <ShieldAlert size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600 }}>{t('send.poisoningWarning')}</div>
            {lookalikes.map(known => (
              <div key={known} className="ow-mono" style={{ fontSize: 'var(--ow-font-size-xs)', wordBreak: 'break-all', marginTop: 2 }}>
                {known}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Amount + Max ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 'var(--ow-space-2)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <Input
            label={t('send.amountLabel', { symbol: sendToken.symbol || 'token' })}
            type="text"
            inputMode="decimal"
            placeholder={t('send.amountPlaceholder')}
            value={amount}
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9.]/g, '');
              const firstDot = raw.indexOf('.');
              const cleaned = firstDot === -1
                ? raw
                : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/[.]/g, '');
              setAmount(cleaned);
            }}
            error={validationError && validationError !== t('send.invalidAddress') ? validationError : undefined}
            disabled={tokenMode === 'erc20' && !tokenInfo}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={useMax}
          disabled={!balance || balance === '0' || (tokenMode === 'erc20' && !tokenInfo)}
        >
          {t('send.max')}
        </Button>
      </div>

      {/* ── Fee speed ───────────────────────────────────────────────── */}
      {/* On Solana this sets the priority fee, which is what decides whether
          the transaction lands during congestion. */}
      {!['building', 'signing', 'broadcasting', 'pending'].includes(status) && (
        <div>
          <label style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)' }}>
            {t('send.feeTierLabel')}
          </label>
          <div style={{
            display: 'flex', gap: 4, marginTop: 4,
            padding: 3,
            backgroundColor: 'var(--ow-bg-secondary)',
            borderRadius: 'var(--ow-radius-sm)',
          }}>
            {(['slow', 'normal', 'fast'] as const).map(tier => (
              <button
                key={tier}
                type="button"
                onClick={() => setFeeTier(tier)}
                aria-pressed={feeTier === tier}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  border: 'none',
                  borderRadius: 'var(--ow-radius-sm)',
                  fontSize: 'var(--ow-font-size-xs)',
                  cursor: 'pointer',
                  backgroundColor: feeTier === tier ? 'var(--ow-bg-tertiary)' : 'transparent',
                  color: feeTier === tier ? 'var(--ow-text-primary)' : 'var(--ow-text-tertiary)',
                  fontWeight: feeTier === tier ? 600 : 400,
                }}
              >
                {t(`send.feeTier.${tier}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Gas fee row ─────────────────────────────────────────────── */}
      {feeInfo && (
        <div style={{
          backgroundColor: 'var(--ow-bg-secondary)',
          padding: 'var(--ow-space-3)',
          borderRadius: 'var(--ow-radius-md)',
          border: '1px solid var(--ow-border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 'var(--ow-font-size-sm)',
        }}>
          <span style={{ color: 'var(--ow-text-tertiary)' }}>{t('send.networkFee')}</span>
          <span style={{ fontFamily: 'var(--ow-font-mono)' }}>
            {feeInfo.nativeFee} {activeChain?.nativeSymbol}
          </span>
        </div>
      )}

      {/* ── TRON energy advisory ────────────────────────────────────── */}
      {energyHint && activeChain && (
        <div style={{
          backgroundColor: 'var(--ow-bg-secondary)',
          padding: 'var(--ow-space-3)',
          borderRadius: 'var(--ow-radius-md)',
          border: '1px solid var(--ow-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 'var(--ow-font-size-xs)',
        }}>
          <div style={{ color: 'var(--ow-text-tertiary)' }}>{t('send.tronEnergyTitle')}</div>
          {energyHint.energyShortfall > 0 ? (
            <>
              <div>
                {t('send.tronEnergyBurn', {
                  amount: formatBalance(energyHint.burnSun, activeChain.nativeDecimals, 4),
                  symbol: activeChain.nativeSymbol,
                })}
              </div>
              {/* Rendered only when a supplier actually priced this lot */}
              {energyHint.rent && (
                <div style={{ color: 'var(--ow-success)' }}>
                  {t('send.tronEnergyRent', {
                    amount: formatBalance(energyHint.rent.estimateTrxSun, activeChain.nativeDecimals, 4),
                    symbol: activeChain.nativeSymbol,
                  })}
                </div>
              )}
              {energyHint.skipReason === 'below-minimum' && (
                <div style={{ color: 'var(--ow-text-tertiary)' }}>{t('send.tronEnergySubLot')}</div>
              )}

              {/* ── Rental purchase ─────────────────────────────────── */}
              {energyHint.rent && rentalStep === 'idle' && (
                <Button variant="secondary" size="sm" onClick={() => setRentalStep('confirm')}>
                  {t('send.tronEnergyRentAction')}
                </Button>
              )}
              {energyHint.rent && rentalStep === 'confirm' && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginTop: 4,
                  paddingTop: 6,
                  borderTop: '1px solid var(--ow-border-subtle)',
                }}>
                  <div>
                    {t('send.tronEnergyRentConfirm', {
                      amount: formatBalance(energyHint.rent.estimateTrxSun, activeChain.nativeDecimals, 4),
                      symbol: activeChain.nativeSymbol,
                    })}
                  </div>
                  {/* The payment goes to the supplier's collection address, so
                      show it — a rental is still a transfer of real TRX. */}
                  <div style={{ fontFamily: 'var(--ow-font-mono)', wordBreak: 'break-all', color: 'var(--ow-text-tertiary)' }}>
                    {fundAddressFor(!!activeChain.testnet)}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" size="sm" onClick={() => setRentalStep('idle')}>
                      {t('common.cancel')}
                    </Button>
                    <Button size="sm" onClick={handleRentEnergy}>
                      {t('send.tronEnergyRentConfirmAction')}
                    </Button>
                  </div>
                </div>
              )}
              {rentalStep === 'working' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ow-text-tertiary)' }}>
                  <Loader2 size={12} style={{ animation: 'ow-spin 1s linear infinite' }} />
                  {t('send.tronEnergyRenting')}
                </div>
              )}
              {rentalStep === 'done' && rentalOrder && (
                <div style={{ color: 'var(--ow-success)' }}>
                  {rentalOrder.fulfilledPercent >= 100
                    ? t('send.tronEnergyRentDone')
                    : t('send.tronEnergyRentPending', { percent: rentalOrder.fulfilledPercent })}
                </div>
              )}
              {rentalStep === 'error' && rentalError && (
                <div style={{ color: 'var(--ow-error)' }}>{rentalError}</div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--ow-success)' }}>
              {t('send.tronEnergyCovered', { energy: energyHint.energyUsed.toLocaleString() })}
            </div>
          )}
        </div>
      )}

      {status === 'estimating' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)', fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-text-tertiary)' }}>
          <Loader2 size={14} style={{ animation: 'ow-spin 1s linear infinite' }} /> {t('send.estimatingFee')}
        </div>
      )}

      {/* ── Build/Sign/Send spinner ──────────────────────────────────── */}
      {(status === 'building' || status === 'signing' || status === 'broadcasting') && (
        <div style={{
          backgroundColor: 'var(--ow-bg-secondary)',
          padding: 'var(--ow-space-4)',
          borderRadius: 'var(--ow-radius-md)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ow-space-2)',
          border: '1px solid var(--ow-border)',
        }}>
          <Loader2 size={16} style={{ animation: 'ow-spin 1s linear infinite' }} />
          <span style={{ fontSize: 'var(--ow-font-size-sm)' }}>
            {status === 'building' && t('send.preparing')}
            {status === 'signing' && t('send.signing')}
            {status === 'broadcasting' && t('send.broadcasting')}
          </span>
        </div>
      )}

      {/* ── Pending tx ──────────────────────────────────────────────── */}
      {status === 'pending' && txHash && (
        <div style={{
          backgroundColor: 'var(--ow-bg-secondary)',
          padding: 'var(--ow-space-4)',
          borderRadius: 'var(--ow-radius-md)',
          border: '1px solid var(--ow-info)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ow-space-2)', marginBottom: 'var(--ow-space-2)' }}>
            <Loader2 size={14} style={{ animation: 'ow-spin 1s linear infinite', color: 'var(--ow-info)' }} />
            <span style={{ fontSize: 'var(--ow-font-size-sm)', color: 'var(--ow-info)' }}>
              {t('send.waitingConfirmation')}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--ow-font-mono)', fontSize: 'var(--ow-font-size-xs)', wordBreak: 'break-all', color: 'var(--ow-text-tertiary)' }}>
            {txHash}
          </div>
        </div>
      )}

      {/* ── Review button ────────────────────────────────────────────── */}
      {!showConfirm && !['building', 'signing', 'broadcasting', 'pending'].includes(status) && (
        <Button
          disabled={!!validationError || status !== 'ready' || (tokenMode === 'erc20' && !tokenInfo)}
          onClick={() => setShowConfirm(true)}
          size="lg"
        >
          {t('send.reviewTransaction')} <ArrowRight size={16} />
        </Button>
      )}

      {/* ── Confirmation modal ──────────────────────────────────────── */}
      <Modal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title={t('send.reviewTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowConfirm(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={handleSend} loading={status === 'signing'}>
              {t('send.confirmAndSend')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ow-space-3)' }}>
          <div>
            <strong>{t('send.to')}</strong>{' '}
            {ensStage === 'resolved' && (
              <div style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-secondary)', marginBottom: 2 }}>
                {recipientInput.trim()} →
              </div>
            )}
            <code style={{ wordBreak: 'break-all' }}>{toAddress}</code>
            {lookalikes.length > 0 && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  marginTop: 4,
                  color: 'var(--ow-negative-fg)',
                  fontSize: 'var(--ow-font-size-xs)',
                  fontWeight: 600,
                }}
              >
                <ShieldAlert size={13} aria-hidden="true" /> {t('send.poisoningWarning')}
              </div>
            )}
          </div>
          <div>
            <strong>{t('send.amount')}</strong> {amount} {sendToken.symbol}
            {!sendToken.isNative && (
              <span style={{ fontSize: 'var(--ow-font-size-xs)', color: 'var(--ow-text-tertiary)', marginLeft: 6 }}>
                ({sendToken.address.slice(0, 10)}…{sendToken.address.slice(-8)})
              </span>
            )}
          </div>
          <div><strong>{t('send.fee')}</strong> {feeInfo?.nativeFee} {activeChain?.nativeSymbol}</div>
          {!sendToken.isNative && (
            <div style={{
              fontSize: 'var(--ow-font-size-xs)',
              color: 'var(--ow-text-secondary)',
              padding: 'var(--ow-space-2)',
              backgroundColor: 'var(--ow-bg-tertiary)',
              borderRadius: 'var(--ow-radius-sm)',
            }}>
              {t('send.tokenTransferNote')}
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--ow-border-subtle)', paddingTop: 'var(--ow-space-3)', color: 'var(--ow-error)', fontSize: 'var(--ow-font-size-xs)' }}>
            {t('send.doubleCheck')}
          </div>
        </div>
      </Modal>
    </div>
  );
}

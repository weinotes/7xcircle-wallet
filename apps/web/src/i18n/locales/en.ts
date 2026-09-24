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
 * English translations — OpenWallet UI.
 */
export default {
  // ── Common ──
  common: {
    back: 'Back',
    next: 'Next',
    continue: 'Continue',
    cancel: 'Cancel',
    loading: 'Loading…',
    retry: 'Retry',
  },

  // ── Onboarding ──
  onboarding: {
    slogan: 'Your keys, your coins. Self-custodial multi-chain wallet.',
    createNewWallet: 'Create New Wallet',
    importExistingWallet: 'Import Existing Wallet',
    license: 'Apache-2.0 Licensed · No servers · No tracking',
    recoveryPhraseTitle: 'Your Recovery Phrase',
    writeWords: 'Write these {{count}} words in order. Store them safely. This is the ONLY way to recover your wallet.',
    neverShare: '⚠ Never share this phrase with anyone',
    savedContinue: "I've saved it, continue",
    verifyTitle: 'Verify Recovery Phrase',
    verifyDesc: 'Select the correct word for each position to confirm you saved your phrase',
    wordNumber: 'Word #{{n}}',
    importTitle: 'Import Recovery Phrase',
    importLabel: 'Enter your 12 or 24 word phrase',
    importPlaceholder: 'word1 word2 word3 ...',
    setPasswordTitle: 'Set Password',
    setPasswordDesc: 'This password encrypts your wallet locally. We cannot help you recover it.',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Min 8 chars, uppercase + number',
    confirmPasswordLabel: 'Confirm Password',
    confirmPasswordPlaceholder: 'Re-enter password',
    createWallet: 'Create Wallet',
    importWallet: 'Import Wallet',
    invalidMnemonic: 'Invalid mnemonic phrase. Please check all words.',
    incorrectVerify: 'Incorrect selection — please double-check your recovery phrase',
    passwordsDoNotMatch: 'Passwords do not match',
    passwordTooWeak: 'Password too weak',
  },

  // ── Unlock ──
  unlock: {
    title: 'Unlock Your Wallet',
    desc: 'Enter your password to unlock. Your keys never leave this device.',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter your password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    unlock: 'Unlock',
    unlocking: 'Unlocking…',
    enterPassword: 'Please enter your password',
    incorrectPassword: 'Incorrect password. Please try again.',
    forgotPassword: 'Forgot password? Reset wallet',
    resetConfirm: 'Reset wallet? This will erase all data. Make sure you have your recovery phrase.',
  },

  // ── Home ──
  home: {
    balanceOf: '{{chain}} — {{symbol}} Balance',
    assets: 'Assets ({{count}})',
    recentTransactions: 'Recent Transactions',
    viewAll: 'View all →',
    noTransactions: 'No transactions yet',
    send: 'Send',
    receive: 'Receive',
    history: 'History',
    lock: 'Lock',
    sent: 'Sent',
    received: 'Received',
    sentToken: 'Sent {{symbol}}',
    receivedToken: 'Received {{symbol}}',
    pending: 'pending',
    footer: '7xCircle Wallet · Apache-2.0 · v0.1.0',
  },

  // ── Receive ──
  receive: {
    title: 'Receive',
    desc: 'Send assets to this address',
    copyAddress: 'Copy Address',
    copied: 'Copied!',
    noAccount: 'No account for this chain yet',
    warning: '⚠ Only send assets on the matching chain',
  },

  // ── History ──
  history: {
    title: 'Transaction History',
    failedToLoad: 'Failed to load transactions: {{error}}',
    noTxTitle: 'No transactions yet',
    noTxDesc: 'Your history for {{chain}} will appear here once you send or receive funds.',
    send: 'Send {{symbol}}',
    sent: 'Sent',
    received: 'Received',
    sentToken: 'Sent {{symbol}}',
    receivedToken: 'Received {{symbol}}',
    confirmed: 'Confirmed',
    failed: 'Failed',
    pending: 'Pending',
    showing: 'Showing {{count}} transaction(s)',
    autoRefreshing: '· auto-refreshing',
    justNow: 'just now',
    minutesAgo: '{{n}}m ago',
    hoursAgo: '{{n}}h ago',
    daysAgo: '{{n}}d ago',
    networkFee: 'Network Fee',
  },

  // ── Send ──
  send: {
    title: 'Send',
    native: 'Native',
    erc20: 'ERC20',
    heldTokens: 'Held Tokens ({{count}})',
    customAddress: 'Custom Address',
    selectToken: 'Select Token',
    searchPlaceholder: 'Search token by name, symbol or address…',
    noTokensMatch: 'No tokens match "{{query}}"',
    loadTokenAt: 'Load token at {{addr}}…',
    noTokensFound: 'No ERC20 tokens found. Switch to Custom Address to send.',
    tokenContractLabel: 'Token Contract Address',
    tokenContractPlaceholder: '0x...',
    readingTokenInfo: 'Reading token info...',
    tokenLoaded: '✓ {{name}} ({{symbol}}) · {{decimals}} decimals',
    from: 'From:',
    balance: 'Balance: {{amount}} {{symbol}}',
    gasHint: '· {{amount}} {{symbol}} for gas',
    recipientLabel: 'Recipient Address',
    recipientPlaceholder: '0x...',
    invalidAddress: 'Invalid EVM address',
    amountLabel: 'Amount ({{symbol}})',
    amountPlaceholder: '0.00',
    max: 'Max',
    networkFee: 'Network Fee',
    estimatingFee: 'Estimating fee...',
    feeTierLabel: 'Transaction speed',
    feeTier: {
      slow: 'Slow',
      normal: 'Normal',
      fast: 'Fast',
    },
    preparing: 'Preparing transaction...',
    signing: 'Signing with your private key...',
    broadcasting: 'Broadcasting to network...',
    waitingConfirmation: 'Waiting for confirmation...',
    reviewTransaction: 'Review Transaction',
    reviewTitle: 'Confirm Send',
    confirmAndSend: 'Confirm & Send',
    to: 'To:',
    amount: 'Amount:',
    fee: 'Fee:',
    tokenTransferNote: 'This is a token transfer. The transaction will be sent to the token contract, not directly to the recipient address.',
    doubleCheck: 'Please double-check the address. Transactions cannot be reversed.',
    walletNotReady: 'Wallet not ready',
    tokenNotLoaded: 'Token contract not loaded',
    walletLockedBeforeConfirm: 'Wallet locked before confirmation',
    txReverted: 'Transaction reverted by the chain',
    couldNotEstimateFee: 'Could not estimate fee — try a different RPC',
    invalidAmount: 'Enter a valid positive amount',
    amountExceeds: 'Amount exceeds balance',
    amountMustBePositive: 'Amount must be greater than 0',
    invalidContractAddress: 'Invalid contract address',
    notValidToken: 'Not a valid ERC20 token',
    txConfirmed: 'Transaction Confirmed',
    txFailed: 'Transaction Failed',
    txConfirmedDesc: 'Your transaction has been confirmed.',
    txFailedDesc: 'Your transaction failed.',
  },

  // ── Settings ──
  settings: {
    title: 'Settings',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    language: 'Language',
    english: 'English',
    chinese: '中文',
    japanese: '日本語',
    french: 'Français',
    korean: '한국어',
    arabic: 'العربية',
    about: 'About',
    resetWallet: 'Reset Wallet',
    resetWarning: 'This erases all data. Ensure you have your recovery phrase backed up.',
    resetConfirmTitle: 'Reset Wallet?',
    resetConfirmDesc: "This will delete your encrypted vault from this device. You'll need your recovery phrase to restore.",
    yesReset: 'Yes, Reset Everything',
  },
};

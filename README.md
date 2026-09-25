# 7xCircle Wallet

[简体中文](README.zh-CN.md) | English

**Author:** Davey Wong <wgwcko@gmail.com>

7xCircle Wallet is an open-source, multi-chain, non-custodial cryptocurrency wallet. Private keys never leave your device — no backend, fully auditable.

> ⚠️ **Alpha / WIP** — under active development. Do not store significant funds yet.

## Features

- HD wallet creation & import: 12- or 24-word BIP39 mnemonic, plus single private-key import (EVM hex / Solana base58 / Tron hex or WIF) with password-gated export of phrase, public key and private keys
- Cross-wallet compatible accounts: the same mnemonic yields the same addresses as MetaMask / TokenPocket / Phantom / TronLink (locked in by interop tests)
- Multi-chain unified asset view: Ethereum, BNB Chain, Polygon, Arbitrum, Optimism, Base, Avalanche, Solana, TRON
- Native + ERC20/BEP20/SPL/TRC20 token balances and transfers
- Send native tokens with dynamic gas estimation (slow / normal / fast / custom)
- In-app swap: Jupiter-routed on Solana with platform-fee routing
- Earn: liquid staking (JitoSOL / mSOL) with live APY — stake and redeem via the same pipeline
- dApp connections: EIP-1193 + EIP-6963 (extension) and WalletConnect v2 (mobile)
- Hardware wallets: Ledger / OneKey (Ledger-compatible) signing over WebUSB on EVM chains
- GoPlus token-scan warnings on every contract send (honeypot / tax / mint risks)
- Transaction history via block explorer APIs
- Encrypted vault: AES-256-GCM + PBKDF2-SHA512 (200,000 iterations)
- Auto-lock on tab hidden (5 min), session keys kept in memory only
- Dark / light theme, zh / en i18n

## Tech Stack

| Layer | Tech |
|-------|------|
| Language | TypeScript 5.x |
| Monorepo | pnpm + Turborepo |
| Web | React 19 + Vite 6 + Zustand |
| Crypto | noble-curves, tweetnacl, bip39, @scure/bip32 |
| EVM | viem 2.x |
| Solana | @solana/web3.js |
| Storage | Cross-platform abstraction (localStorage / MMKV / Tauri Store) |

## Repository Structure

```
open-wallet/
├── apps/
│   ├── web/          # Web app (React + Vite)
│   ├── extension/    # Chrome/Chromium MV3 extension
│   └── mobile/       # Android app (Expo / React Native)
├── packages/
│   ├── core/         # Wallet core: keys, vault encryption, session, chain abstraction
│   ├── chains/       # Chain adapters (EVM / Solana / TRON)
│   ├── ui/           # Shared UI components
│   ├── shared/       # Shared types, utils, constants
│   └── storage/      # Cross-platform encrypted storage abstraction
└── scripts/          # Dev utilities (e.g. EVM send-flow integration test)
```

## Getting Started

```bash
pnpm install
pnpm dev          # start web app (Vite dev server)
pnpm build        # build all packages + web
pnpm typecheck    # type-check all workspaces
pnpm --filter @open-wallet/mobile start  # start Android development
pnpm --filter @open-wallet/mobile android # build/run on Android device or emulator
```

### Android

The Android app is an Expo/React Native client using the same wallet core and chain adapters.
The encrypted vault is stored with Android SecureStore. Run `pnpm install`, then use
`pnpm --filter @open-wallet/mobile android` with Android Studio/SDK installed.
The mobile app now covers all production chains with a switcher — TRON (TRX +
USDT-TRC20), BNB Chain, Solana and Ethereum first — showing adapter-discovered
token balances and sending native or token transfers through the same
chain-agnostic intent pipeline as the web app. It also supports optional
fingerprint / face unlock (Keystore-gated password cache with a password
fallback). The unlocked app follows the mainstream wallet layout — a bottom
tab bar with Assets · Swap · Earn · dApps · Settings: in-app Jupiter swaps on Solana,
liquid staking (JitoSOL / mSOL with live APY from Defillama — stake and
redeem through the same pipeline),
dApp connections over WalletConnect v2 (QR pairing, per-request human
approval; ships with a built-in relay project id, overridable via
EXPO_PUBLIC_WC_PROJECT_ID), and an in-app update
check against GitHub Releases.

### Browser extension

Build with `pnpm --filter @open-wallet/extension build`, then load
`apps/extension/dist` as an unpacked extension in Chrome or another Chromium browser.
The popup supports the wallet UI, and the injected EIP-1193 provider exposes the
current BNB chain and read-only account discovery while transaction approval UI is
being completed. The dApp-compatibility targets are MetaMask (EIP-1193 + EIP-6963),
Phantom (`window.solana`) and TronLink/TokenPocket (`window.tronWeb`).

Requires Node.js >= 20.19 and pnpm >= 9.

## Security Principles

- Private keys / mnemonics never leave the device, never uploaded
- All signing happens locally
- Vault encrypted with AES-256-GCM, key derived via PBKDF2-SHA512 (200k iterations)
- Session secrets exist in memory only; auto-lock on visibility loss

See `TECH_DESIGN.md` for the full technical design and security audit checklist.

## Roadmap

- Phase 1 (current): MVP — multi-chain send/receive, encrypted vault, web app
- Phase 2: Mobile (React Native) & Desktop (Tauri), NFT view, more chains (Bitcoin with PSBT); hardware wallets — Ledger / OneKey (Ledger-compatible) connect over WebUSB on web & extension for EVM chains (device verification pending)
- Phase 3: DeFi — DApp browser, swap aggregation, staking, WalletConnect v2

## License

Apache-2.0 — see [LICENSE](LICENSE). Copyright © 2026 Davey Wong — see [NOTICE](NOTICE).

**Author:** Davey Wong <wgwcko@gmail.com> · [www.guangweiblog.com](https://www.guangweiblog.com)

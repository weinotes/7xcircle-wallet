# Changelog

**Author:** Davey Wong <wgwcko@gmail.com>

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- ENS name resolution in Send (EVM chains): type `name.eth`, get the resolved
  address reviewed before signing. Pure wire contract (EIP-137 namehash +
  two `eth_call`s), RPC failover across the configured mainnet endpoints,
  byte-for-byte cross-verified against `viem/ens`, and a live mainnet probe
  (`scripts/ens-test.ts`). Unresolved names can never reach the sign path.
- Transaction speed-up and cancel for pending EVM transactions in History:
  same-nonce replacement (identical payload at a faster fee, or an empty
  self-send to overwrite), reviewed through the same confirmation modal as
  Send and executed through the same signing pipeline.
- Business boundary in MONETIZATION.md: personal open-source project — no
  fiat on/off-ramps, no market making, no custody; third-party fee sharing
  only.
- Design tokens: themeable P&L semantics (`--ow-positive/negative/pending`),
  badge wash backgrounds, motion durations, z-index scale, font-weight scale.
- Shared keyframes (`ow-spin`, `ow-shimmer`) with a `prefers-reduced-motion`
  guard — pages previously referenced a `spin` animation that never existed.
- UI kit: `Card`, `ListRow` (keyboard-operable), `IconButton` (required
  `aria-label`), `Spinner`, `Skeleton`, `EmptyState`.
- Utility-class layer (`.ow-page`, `.ow-card`, `.ow-mono` with tabular-nums,
  `.ow-actions`) plus a global `:focus-visible` ring and a ≤480px compact
  breakpoint that adapts the reused web pages for the extension popup.
- i18n keys for the new accessible labels (en/zh; other locales fall back to
  English by design).

### Changed
- **UI**: MetaMask/Ledger-aligned palette — near-black canvas (`#0b0c0f`),
  MetaMask blue accent (`#037dd6`), accessible green/amber/coral status colors;
  light theme rebalanced to match.
- **UI (Home)**: portfolio USD total promoted to the hero, native balance
  demoted to a sub-line; quick actions collapsed into round icon tiles;
  chain picker replaced with a listbox dropdown; skeleton loading; empty
  states now carry a call to action; silent fetch errors surfaced as a
  retryable advisory.
- **UI (History/Receive/Unlock)**: rebuilt on the shared UI kit; every
  hard-coded hex/rgba color on web pages converged onto design tokens.
- **A11y**: `Modal` is a real dialog (portal, `role="dialog"`, Escape, focus
  trap, focus restore); `Input` wires `aria-invalid`/`aria-describedby` and
  `role="alert"` errors; `Button` shows a spinner with `aria-busy` instead of
  a "Loading..." string.

### Fixed
- **Receive**: the address QR code was inverted (light modules on a dark
  surface) with no quiet zone and became invisible-white in the light theme —
  many scanners (WeChat/Alipay in particular) rejected it. It now renders
  black-on-white on a fixed white plate with a 2-module margin.
- Theme toggle in Settings had no effect: the stored theme was never applied
  to `<html data-theme>`. New `useThemeSync` hook wires it on web and in the
  extension popup.
- Refresh/spinner animations never ran (referenced a non-existent `spin`
  keyframe) on Home, History, and Send.
- `DappApprovals` referenced an undefined `--ow-bg-subtle` token and silently
  used its fallback tint.

## [0.1.0] - 2026-09

### Added
- Intent-based transaction core (`TxIntent` compiled per chain) for EVM,
  Solana, and TRON (TRX + TRC20, fully local signing).
- Unified EVM derivation on coin-60 so the same mnemonic yields the same
  address as MetaMask / TokenPocket / Trust.
- Extension dApp layer: EIP-1193 provider, EIP-6963 discovery, connect /
  personal_sign / sendTransaction approvals (MV3, popup-held session).
- GoPlus token scan: honeypot / buy-sell tax / mint / freeze warnings on
  every contract send.
- In-wallet Jupiter swaps on Solana with platform fee; 0x routing scaffold.
- Earn line: Marinade liquid staking on mobile and web.
- Hardware wallet support (Ledger / OneKey over WebUSB, EVM) — device
  verification pending.
- Mobile (Expo) multi-chain MVP: biometric unlock, WalletConnect v2 dApps,
  in-app swap, hot-update check.

[Unreleased]: #unreleased
[0.1.0]: #010---2026-09

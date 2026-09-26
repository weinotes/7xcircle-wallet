# Changelog

**Author:** Davey Wong <wgwcko@gmail.com>

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Session-layer test matrix (`sessionMatrix.test.ts`): HD multi-account
  unlock, all-hardened Solana indexes, `deriveMoreAccount` (add-account,
  per-chain ceiling, key-vault refusal), mnemonic `getPrivateKey` paths,
  unsupported-type refusals and the registry surface — lifts
  `core/session.ts` from 72% to 98.6% line coverage.
- Priced the untested half of `pricing/price.ts`: fetchers and the
  `priceTokens` facade now run under a stubbed fetch (chunking at the
  Jupiter-50 / DexScreener-30 caps, Jupiter→DexScreener fallthrough,
  case-insensitive contract matching, identity-preserving "no price"
  path) — 50% → 98% line coverage, repo statements now 84.5%.
- Pre-sign transaction simulation: Send page now runs a pre-flight check
  via `eth_call` (EVM) / `simulateTransaction` (Solana) before the user
  signs. The confirm modal shows expected token changes and any warnings;
  a failed simulation disables the confirm button so users cannot waste
  gas signing a transaction that would revert on-chain.
- SECURITY.md: vulnerability disclosure policy with email contact,
  response timeline (48h ack, 5-day triage, 14-day fix for critical),
  scope definition, and self-audit checklist status.
- .env.example: full environment variable documentation covering swap
  fee routing, 0x gateway pattern (key exposure warning), TRON energy
  sponsor code, Marinade referral code, and WalletConnect project ID.
- Multi-account HD wallets: `unlock()` derives per-chain account counts
  (persisted), Home gains an account switcher chip row with "+ Add
  account", and every money page resolves its signer through a shared
  `selectActiveAccount` — chain switches re-point it atomically.
- Extension dApp protocol completed: `wallet_switchEthereumChain` is now
  a user-approval prompt (admin tier) that atomically moves the wallet UI
  and the broker's `eth_chainId` answer, and `eth_signTypedData_v4`
  signs real EIP-712 payloads (viem digest, cross-verified against
  ethers v6 byte-for-byte; Ledger accounts get an honest decline).

### Fixed
- CI: commit-lint checked the last-10 subjects as ONE grep blob (any single
  conforming commit whitewashed the rest) — every commit in the pushed
  range is now verified individually; Dependabot bots are exempt.
- CI: secret-scan died with "Invalid revision range" on Dependabot PRs
  because `event.before` can point at an unfetched orphan commit after a
  bot force-push — candidate BASEs are now validated with
  `git cat-file -e` before use, and `dependabot/**` pushes skip the
  duplicate `push` trigger (pull_request still scans).
- Toolchain: removed the last two deprecated `baseUrl` options (mobile +
  scripts tsconfigs) that made every TypeScript 6 Dependabot bump fail
  the build, re-opening the dependency-upgrade lane.
- Lint: zero warnings. `exhaustive-deps` holes closed in Home/Send/
  WatchWallet (optional-chain guards keep fetch dep lists precise while
  satisfying the rule; `t` added where used), dead identifiers pruned
  (Unlock navigate, LedgerConnect path helper, WatchWallet icon,
  mobile Pressable).
- Typed-data requests from dApps are order-tolerant on `[from, data]`
  params and refuse to sign for an account other than the connected one.
- Mobile Swap goes multi-chain: an EVM route section gated on a build-time
  `EXPO_PUBLIC_ZEROX_API_KEY` (0x quotes, approve → wait → swap chaining),
  chain chips across every held account, and custom-contract pairs —
  keyless builds honestly stay Solana-only instead of offering dead routes.
- Address-poisoning guard: a recipient that shares the first 5 and last 4
  characters with any address you have previously sent to on that chain —
  without being identical — triggers a red alert on Send and again on the
  confirmation review (pure detector in `@7xcircle/shared`, 9 unit tests).
- Cross-chain portfolio on Home: the chain picker gains an “All chains”
  view — total USD across every account, per-chain asset rows, lazy
  first-touch loading (no RPC storm in the popup unless asked), partial
  failure surfaced, drill-into-chain built in.
- Token-approval ledger with revocation (Settings → Token approvals): every
  `approve(spender, amount)` this wallet broadcasts — from swap flows and
  from dApp `eth_sendTransaction` calldata — is recorded (persisted, public
  data), shown with an “∞ unlimited” risk badge, and revocable to zero
  through the same review-and-sign pipeline as any send. Grants signed in
  other wallets before an import are explicitly out of scope (indexer-free).
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

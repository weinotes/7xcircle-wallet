# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x (alpha) | Yes — active development, all security fixes land here |
| < 0.1.0 | No |

> ⚠️ This project is in **alpha**. Do not store significant funds yet.

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a security issue in this repository, please report it
privately so we can fix it before it becomes widely known:

| Channel | Detail |
|---------|--------|
| **Email** | [wgwcko@gmail.com](mailto:wgwcko@gmail.com) |
| **Subject line** | `[7xcircle-wallet SECURITY] <short description>` |
| **PGP** | Not yet configured — plaintext is acceptable for initial contact |

### What to include

- Steps to reproduce or a proof-of-concept
- Affected chain(s) and module(s)
- Estimated severity (critical / high / medium / low)
- Any suggested fix, if you have one

### What to expect

| Step | Target |
|------|--------|
| Acknowledgement of receipt | Within 48 hours |
| Triage + severity assessment | Within 5 business days |
| Fix + release for critical/high issues | Within 14 days of triage |
| Public disclosure | After a fix is released, or 90 days after report — whichever comes first |

### What is in scope

- Private key / mnemonic generation and storage (`packages/core/src/keys`, `packages/core/src/vault`)
- Transaction signing and broadcast (`packages/core`, `packages/chains`)
- Vault encryption (AES-256-GCM + PBKDF2-SHA512)
- Session management and auto-lock (`packages/core/src/session`)
- Extension content-script / background isolation (`apps/extension`)
- Dependency supply chain (known CVEs in `node_modules`)

### What is out of scope

- Vulnerabilities in third-party APIs we call (Jupiter, 0x, TronSave, GoPlus) —
  report those to the respective vendors
- UI-only issues (CSS glitches, i18n typos) — file a normal GitHub issue
- Denial-of-service against the public RPCs we use — those are not our infra

## Bug Bounty

This is a solo-developed, zero-revenue open-source project. There is no formal
bounty program at this time. Contributors who responsibly disclose a valid
security vulnerability will receive:

- Public acknowledgement in `CHANGELOG.md` (unless anonymity is requested)
- A signed thank-you note from the maintainer

If you would like to sponsor a formal bounty, please open a discussion.

## Security Principles (self-audit)

- [x] Private keys / mnemonics generated via CSPRNG (`crypto.getRandomValues`)
- [x] AES-256-GCM encryption with authentication tag verification
- [x] PBKDF2-SHA512 with 200,000 iterations for vault key derivation
- [x] Best-effort memory wipe of private key buffers after use (`wipeBytes`)
- [x] Address validation before signing (EIP-55, Solana Base58, Tron base58check)
- [x] Transaction confirmation UI shows target address, amount, token symbol
- [x] No remote telemetry or error reporting (privacy)
- [x] CI secret scanning on every push (`secret-scan` job in `ci.yml`)
- [x] Extension runs under MV3 with minimal permissions (`storage`, `usb` only)
- [x] GoPlus token-safety warnings on every contract send
- [x] EIP-6963 provider announcement for dApp coexistence
- [ ] Third-party security audit — **not yet obtained; planned before 1.0**
- [ ] Public HackerOne program — **not yet established**
- [ ] Automated dependency update tool (Renovate/Dependabot) — **not yet enabled**

## License

Apache-2.0 — see [LICENSE](LICENSE).

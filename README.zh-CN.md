# 7xCircle Wallet

中文 | [English](README.md)

**作者：** Davey Wong <wgwcko@gmail.com>

7xCircle Wallet 是开源、多链、非托管的加密货币钱包。私钥永不出设备 — 无后端依赖，完全可审计。

> ⚠️ **Alpha / 开发中** — 仍在积极开发，请勿存入大额资产。

## 功能特性

- HD 钱包创建 / 导入（BIP39 助记词；单私钥导入在规划中）
- 跨钱包账户兼容：同一助记词与 MetaMask / TokenPocket / Phantom / TronLink 派生出完全相同的地址（由互操作测试锁定）
- 多链统一资产管理：Ethereum、BNB Chain、Polygon、Arbitrum、Optimism、Base、Avalanche、Solana、TRON
- 原生代币 + ERC20/BEP20/SPL/TRC20 代币余额与转账
- 原生币发送，动态 Gas 估算（慢 / 中 / 快 / 自定义）
- 区块浏览器 API 查询交易历史
- 加密保险库：AES-256-GCM + PBKDF2-SHA512（20 万次迭代）
- 页面隐藏自动锁定（5 分钟），会话密钥仅存内存
- 暗 / 亮主题，中英文切换

## 技术栈

| 分层 | 技术 |
|------|------|
| 语言 | TypeScript 5.x |
| Monorepo | pnpm + Turborepo |
| Web | React 19 + Vite 6 + Zustand |
| 加密底层 | noble-curves、tweetnacl、bip39、@scure/bip32 |
| EVM | viem 2.x |
| Solana | @solana/web3.js |
| 存储 | 跨平台抽象（localStorage / MMKV / Tauri Store） |

## 仓库结构

```
open-wallet/
├── apps/
│   ├── web/          # Web 应用（React + Vite）
│   ├── extension/    # Chrome/Chromium MV3 浏览器插件
│   └── mobile/       # Android 应用（Expo / React Native）
├── packages/
│   ├── core/         # 钱包核心：密钥、保险库加密、会话、链抽象
│   ├── chains/       # 链适配器（EVM / Solana / TRON）
│   ├── ui/           # 共享 UI 组件
│   ├── shared/       # 共享类型、工具函数、常量
│   └── storage/      # 跨平台加密存储抽象
└── scripts/          # 开发工具（如 EVM 发送流程集成测试）
```

## 快速开始

```bash
pnpm install
pnpm dev          # 启动 Web 应用（Vite 开发服务器）
pnpm build        # 构建所有包 + Web
pnpm typecheck    # 全工作区类型检查
pnpm --filter @open-wallet/mobile start   # 启动 Android 开发环境
pnpm --filter @open-wallet/mobile android  # 在 Android 设备或模拟器运行
```

### Android 版本

Android 客户端使用 Expo / React Native，并复用同一套钱包核心和链适配器。加密后的 Vault 使用 Android SecureStore 保存。安装 Android Studio 和 SDK 后，
执行 `pnpm --filter @open-wallet/mobile android` 即可构建并运行。
移动端现已覆盖全部主网链（切换器以 TRON（TRX + USDT-TRC20）、BNB Chain、Solana、
Ethereum 优先排列），展示各链适配器发现的代币余额，原生与代币转账走与 Web 端相同的
链无关 intent 流水线；并支持可选的指纹/面容解锁（密码缓存由 Android Keystore 生物识别
门锁保护，密码始终作为兜底通道）。Swap 与 dApp 浏览目前仅限 Web / 插件端。

### 浏览器插件

执行 `pnpm --filter @open-wallet/extension build`，再在 Chrome 或 Chromium
浏览器中将 `apps/extension/dist` 作为“已解压的扩展程序”加载。
插件 Popup 支持完整钱包界面，页面注入的 EIP-1193 provider 已支持 BNB 链和
只读账户发现；交易审批界面仍在继续完善。dApp 兼容性目标为 MetaMask
（EIP-1193 + EIP-6963）、Phantom（`window.solana`）与 TronLink/TokenPocket
（`window.tronWeb`）。

要求 Node.js >= 20.19，pnpm >= 9。

## 安全原则

- 私钥 / 助记词永不出设备，绝不上传
- 所有签名在本地完成
- 保险库 AES-256-GCM 加密，PBKDF2-SHA512（20 万次迭代）派生密钥
- 会话密钥仅存内存；失去页面可见性自动锁定

完整技术设计与安全审计清单见 `TECH_DESIGN.md`。

## 路线图

- Phase 1（当前）：MVP — 多链收发、加密保险库、Web 应用
- Phase 2：移动端（React Native）与桌面端（Tauri）、硬件钱包（Ledger）、NFT 视图、更多链（Bitcoin 及 PSBT 支持）
- Phase 3：DeFi — DApp 浏览器、Swap 聚合、质押、WalletConnect v2、单私钥导入（EVM hex / Solana base58）

## 许可证

Apache-2.0 — 见 [LICENSE](LICENSE)。版权所有 © 2026 Davey Wong — 见 [NOTICE](NOTICE)。

**作者：** Davey Wong <wgwcko@gmail.com> · [www.guangweiblog.com](https://www.guangweiblog.com)

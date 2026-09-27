# 7xCircle Wallet 技术方案

> 开源、多链、本地托管的加密货币钱包 — 支持 Web / 移动端 / 桌面端全平台

---

## 1. 项目定位

| 项目 | 说明 |
|------|------|
| **名称** | 7xCircle Wallet |
| **许可证** | Apache-2.0 |
| **核心原则** | 私钥永不出设备、无后端依赖、完全开源可审计 |
| **目标用户** | 个人使用 + 开源社区贡献者 |

### 1.1 功能边界

**MVP（Phase 1）** — 本次开发聚焦：
- ✅ HD 钱包创建 / 导入（助记词 + 私钥）
- ✅ 多链统一资产管理（EVM 全家桶 + Solana）
- ✅ 原生代币 + ERC20/BEP20/SPL 代币收发
- ✅ 交易历史查询（通过区块浏览器 API）
- ✅ Gas 费动态估算 + 自定义
- ✅ 暗/亮主题 + 中英文切换

**不做 / 延后**：
- ❌ DeFi 交互（Swap、质押、DApp 浏览器 → Phase 2）
- ❌ 硬件钱包集成（Ledger/Trezor → Phase 2）
- ❌ 云端同步（永远不上传密钥）
- ❌ NFT 展示（Phase 2）

---

## 2. 技术选型

### 2.1 整体架构：Monorepo + Turborepo

```
7xcircle-wallet/
├── apps/
│   ├── web/          # Web 版 (React + Vite + PWA)
│   ├── mobile/       # 移动端 (React Native + Expo)
│   └── desktop/      # 桌面端 (Tauri, Rust 后端)
├── packages/
│   ├── core/         # 钱包核心：密钥、签名、链适配
│   ├── chains/       # 各链适配实现 (EVM / Solana / ...)
│   ├── ui/           # 共享 UI 组件库
│   └── shared/       # 共享类型、工具函数、常量
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

**为什么 Monorepo？**
- 钱包核心逻辑只需写一次（`packages/core` + `packages/chains`），三个平台复用
- UI 组件库可共享设计 Token
- 统一版本管理，避免多仓库依赖地狱

### 2.2 技术栈

| 分层 | 技术 | 选型理由 |
|------|------|----------|
| **语言** | TypeScript 5.x | 类型安全，生态成熟，跨平台一致 |
| **包管理** | pnpm + Turborepo | 你的项目约定，硬链接节省空间 |
| **Web** | React 19 + Vite 6 + Zustand | 轻量、HMR 快、状态管理简单 |
| **Mobile** | React Native 0.76 + Expo | 与 Web 共享业务逻辑，开发效率高 |
| **Desktop** | Tauri 2.x | 比 Electron 小 10 倍体积，原生安全沙箱 |
| **加密底层** | noble-curves + tweetnacl | 纯 JS 实现，无原生依赖，可审计 |
| **EVM 链 SDK** | viem 2.x | 轻量、类型安全、支持所有 EVM 链 |
| **Solana SDK** | @solana/web3.js 2.x | 官方 SDK，v2 重构后性能更好 |
| **助记词** | bip39 + bip32 + slip-0044 | 行业标准 HD 钱包派生 |
| **本地存储** | localStorage / MMKV / Tauri Store | 各平台原生存储 |
| **数据加密** | Web Crypto API (AES-GCM) | 浏览器原生，密钥派生用 PBKDF2 |
| **图标** | Lucide React | 统一图标风格 |
| **样式** | Tailwind CSS 3 + CSS Variables | 设计 Token 统一管理 |
| **i18n** | react-i18next | 成熟稳定 |
| **构建** | Turborepo | Monorepo 增量构建 |

### 2.3 多链支持矩阵

| 链 | 类型 | Chain ID | 原生代币 | 实现优先级 |
|----|------|----------|----------|------------|
| Ethereum | EVM | 1 | ETH | P0 |
| BSC | EVM | 56 / 97 | BNB | P0 |
| Polygon | EVM | 137 | MATIC | P0 |
| Arbitrum One | EVM | 42161 | ETH | P1 |
| Optimism | EVM | 10 | ETH | P1 |
| Base | EVM | 8453 | ETH | P1 |
| Avalanche C-Chain | EVM | 43114 | AVAX | P1 |
| Solana | Non-EVM | - | SOL | P0 |
| Tron | Non-EVM | - | TRX | P2 |

> EVM 链通过 `viem` 统一适配，每条链只需配置 RPC URL + Chain ID + Explorer 即可接入。
> Solana 独立适配，因为签名算法（Ed25519）与 EVM（secp256k1）不同。

---

## 3. 核心架构设计

### 3.1 钱包核心模块（`packages/core`）

```
packages/core/
├── src/
│   ├── keys/
│   │   ├── mnemonic.ts        # 助记词生成/验证/派生
│   │   ├── privateKey.ts      # 私钥导入/验证
│   │   └── derivation.ts      # HD 派生 (BIP32 + SLIP-0044)
│   ├── vault/
│   │   ├── vault.ts           # 加密保险库（AES-GCM 加密）
│   │   └── password.ts        # 密码策略 + PBKDF2 密钥派生
│   ├── account/
│   │   └── account.ts         # 账户模型：地址、链、余额、代币列表
│   ├── chain/
│   │   ├── chain-adapter.ts   # 链适配器接口（核心抽象）
│   │   ├── registry.ts        # 链注册表
│   │   └── types.ts           # 跨链统一类型
│   ├── transaction/
│   │   ├── tx-builder.ts      # 统一交易构建器
│   │   └── tx-result.ts       # 交易结果统一模型
│   └── index.ts
```

### 3.2 链适配器模式（核心抽象）

这是整个钱包最重要的设计。不同链的签名算法、地址格式、交易结构完全不同，通过 **Adapter Pattern** 抽象统一：

```typescript
// packages/core/src/chain/adapter.ts

export interface ChainAdapter {
  // 链标识
  readonly chainId: string;           // e.g. "bsc-56", "eth-1", "solana"
  readonly chainName: string;
  readonly config: ChainConfig;

  // 地址
  deriveAddress(publicKey: Uint8Array, accountIndex: number): string;
  validateAddress(address: string): boolean;

  // 余额
  getNativeBalance(address: string): Promise<string>;
  getTokenBalance(address: string, tokenAddress: string): Promise<string>;
  getAllTokenBalances(address: string): Promise<TokenBalance[]>;

  // 交易 —— 以「语义意图」为输入，而非链特定的原始字段
  buildTransaction(intent: TxIntent, opts: BuildOpts): Promise<UnsignedTx>;
  importExternalTransaction(tx: ExternalTx, opts: BuildOpts): Promise<UnsignedTx>;
  signTransaction(tx: UnsignedTx, privateKey: Uint8Array): Promise<SignedTransaction>;
  sendTransaction(signedTx: SignedTransaction): Promise<string>; // 返回 txHash

  // 合约读取（Swap 报价 / 授权查询的前置能力）
  readContract(req: { to: string; data: string }): Promise<string>;
  getAllowance(owner: string, token: string, spender: string): Promise<string>;

  // 元数据与金额换算
  getTokenInfo(token: string): Promise<TokenInfo>;
  parseAmount(amount: string): string;
  parseTokenAmount(amount: string, decimals: number): string;
  formatTokenAmount(raw: string, decimals: number): string;

  // 交易历史（通过 Explorer API）
  getTransactionHistory(address: string): Promise<TransactionRecord[]>;
  getTransactionStatus(txHash: string): Promise<TransactionRecord['status']>;
  getExplorerTxUrl?(txHash: string): string | undefined;

  // Gas / 费用
  estimateFees(intent: TxIntent, opts: BuildOpts): Promise<FeeEstimate>;

  // 链高度（Solana 用于判断 blockhash 是否过期）
  getBlockHeight(): Promise<number>;
}
```

**为什么是 `TxIntent` 而不是原始交易字段？**

早期版本让调用方直接拼 `RawTransaction`（`to` / `value` / `data`），结果 Solana 的 SPL 转账只能把意图编码成字符串塞进 `data`
（`spl-token:{...}`），`from/to/value` 的语义被破坏，每加一种操作就要再抄一份分支。

现在调用方只表达**想做什么**：

```typescript
export type TxIntent =
  | { kind: 'native-transfer'; to: string; amountRaw: string }
  | { kind: 'token-transfer'; token: string; decimals: number; to: string; amountRaw: string }
  | { kind: 'contract-call'; to: string; data: string; valueRaw?: string }   // 仅 EVM
  | { kind: 'approve'; token: string; spender: string; amountRaw: string };  // 仅 EVM
```

由各链 adapter 编译成自己的原生形式：

- **EVM** → `{ to, value, data }` + nonce/gas/1559 费用
- **Solana** → `TransactionInstruction[]` + `ComputeBudget` 优先费 → v0 `VersionedTransaction`

`amountRaw` 一律是最小单位字符串（wei / lamports / 代币基础单位），避免浮点精度问题。

**`ExternalTx` 用于「外部构建的交易」** —— Jupiter、0x、dApp 返回的是现成交易，不是可拆解的意图，
通过 `importExternalTransaction` 导入后走同一套签名/广播路径。

**优先费与重试（Solana）**：`buildTransaction` 会读取 `getRecentPrioritizationFees` 按费率档位
（slow p50 / normal p75 / fast p90）出价，并前置 `setComputeUnitLimit`。计算上限设得宽松——手续费按
`computeUnitsConsumed × price` 计费，**上限本身不花钱**，所以无需额外模拟。

blockhash 过期后的重试**不在 adapter 内**：重建需要重新签名，而私钥生命周期由 UI 层
（`apps/web/src/hooks/useTxFlow.ts`）管理，adapter 保持无状态、私钥不跨重试轮次驻留。

**EVM 适配器实现要点**：
- 基于 `viem`，配置 `PublicClient`（读链）+ `WalletClient`（签名）
- 地址派生：BIP44 路径 `m/44'/60'/0'/0/{index}`（ETH）或 `m/44'/714'/0'/0/{index}`（BSC）
- 签名：secp256k1 + EIP-155 交易类型
- Token 余额：调用 ERC20 `balanceOf()`

**Solana 适配器实现要点**：
- 基于 `@solana/web3.js` v2
- 地址派生：BIP44 路径 `m/44'/501'/0'/0'`
- 签名：Ed25519（用 `tweetnacl.sign.detached`）
- Token 余额：SPL Token Program 查询

### 3.3 密钥与安全架构

```
┌─────────────────────────────────────────────────────┐
│                    用户设备                          │
│                                                     │
│  ┌─────────────┐     PBKDF2-SHA512     ┌──────────┐ │
│  │  用户密码    │ ──────────────────▶  │ 主加密密钥 │ │
│  └─────────────┘     (200,000轮)      └────┬─────┘ │
│                                            │       │
│                               AES-256-GCM 加密      │
│                                            │       │
│  ┌─────────────────────────────────────────▼─────┐ │
│  │  Vault JSON (存储在 localStorage / MMKV / ...) │ │
│  │  {                                             │ │
│  │    "version": 1,                                │ │
│  │    "ciphertext": "...",    ← 加密后的助记词     │ │
│  │    "salt": "...",          ← 16字节随机盐       │ │
│  │    "iv": "...",            ← 12字节随机IV       │ │
│  │    "kdf": "pbkdf2-sha512",                      │ │
│  │    "iterations": 200000                         │ │
│  │  }                                             │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  🔐 私钥永不出设备                                   │
│  🔐 无后端服务器存储                                 │
│  🔐 所有签名在本地完成                               │
└─────────────────────────────────────────────────────┘
```

**安全要点**：
- 助记词生成：`bip39.generateMnemonic(entropy)` → 256-bit 熵 → 24词
- 密钥派生：`bip32.fromSeed(seed).derivePath(BIP44_PATH)`
- 加密：AES-256-GCM（认证加密，防篡改）
- KDF：PBKDF2-SHA512，200,000 轮（OWASP 2023 推荐）
- **内存安全**：使用后立即擦除私钥 Buffer（`crypto.subtle.wipe()` 或覆写）
- **防钓鱼**：地址展示时增加校验标记（EIP-55 大小写校验、Solana Base58 长度校验）

### 3.4 状态管理（Zustand Store 设计）

```typescript
// 顶层 Store 结构

interface WalletState {
  // 保险库状态
  vault: {
    exists: boolean;
    unlocked: boolean;
    encryptedData: string | null;
  };

  // 当前会话（解锁后才有）
  session: {
    mnemonic: string | null;        // 仅在内存中，从不持久化
    privateKeys: Map<string, Uint8Array> | null; // chainId → privateKey
  };

  // 账户状态
  accounts: Account[];              // 多链多账户

  // UI 状态
  ui: {
    theme: 'light' | 'dark';
    language: 'zh' | 'en';
    activeChain: string;            // 当前选中的链
    activeAccountId: string;
  };
}
```

**关键约束**：
- `session` 状态只存在于内存，刷新页面需重新输入密码
- 私钥数组在应用失焦/锁屏后自动清理
- 所有敏感操作（签名、发送）需要密码二次确认

---

## 4. 应用层架构

### 4.1 目录结构（以 Web 为例）

```
apps/web/
├── src/
│   ├── app/                     # 应用入口 + 路由
│   │   ├── providers/           # Zustand / Theme / I18n Provider
│   │   ├── router.tsx
│   │   └── App.tsx
│   ├── pages/
│   │   ├── Onboarding/          # 创建/导入钱包流程
│   │   ├── Home/                # 主面板：多链资产概览
│   │   ├── Send/                # 发送交易
│   │   ├── Receive/             # 接收地址 + 二维码
│   │   ├── History/             # 交易历史
│   │   ├── Settings/            # 主题/语言/链管理/关于
│   │   └── Password/            # 解锁/重置密码
│   ├── components/
│   │   ├── layout/              # Header / Sidebar / BottomNav
│   │   ├── wallet/              # 地址卡片、代币列表、余额
│   │   ├── tx/                  # 交易表单、Gas 选择器、确认弹窗
│   │   ├── ui/                  # Button / Input / Modal / Toast / QRCode
│   │   └── chain/               # 链选择器、链图标
│   ├── hooks/
│   │   ├── useWallet.ts
│   │   ├── useBalance.ts        // 自动刷新余额
│   │   ├── useSendTx.ts
│   │   └── usePassword.ts
│   ├── lib/
│   │   ├── rpcs.ts              # 公共 RPC 节点列表
│   │   ├── explorers.ts         # 区块浏览器 API 封装
│   │   └── constants.ts
│   ├── styles/
│   │   ├── tokens.css           # 设计 Token（--ow-* 变量）
│   │   └── globals.css
│   └── main.tsx
├── public/
├── index.html
├── vite.config.ts
└── package.json
```

### 4.2 页面流程

```
首次访问 ──▶ Onboarding
              │
         ┌────┴────┐
         │         │
    创建新钱包   导入现有钱包
         │         │
    生成助记词   输入助记词/私钥
         │         │
    设置密码     设置密码
         │         │
         └────┬────┘
              │
              ▼
         ┌─────────┐
         │  主面板  │ ◀────── 每次重新打开 App
         │  Home   │          需要先输入密码解锁
         └────┬────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
  Send      Receive   History
```

### 4.3 关键交互流程

**发送交易流程**：
```
1. 用户选择链 + 代币 + 输入金额/地址
2. 前端调用 adapter.estimateFees() 获取 Gas 预估
3. 用户选择 Gas 档位（慢/中/快/自定义）
4. 构建 RawTransaction → 签名 → sendTransaction
5. 显示交易 Hash + 跳转区块浏览器链接
6. 轮询确认状态（pending → confirmed）
```

**接收流程**：
```
1. 用户选择链 + 账户
2. 显示对应链的地址 + 二维码
3. 地址带校验提示（EIP-55 格式、Solana 长度检查）
4. 一键复制
```

---

## 5. 链配置与公共 RPC

### 5.1 内置公共 RPC 节点

```typescript
// packages/chains/src/config.ts

export const CHAIN_CONFIGS: ChainConfig[] = [
  {
    chainId: 'eth-1',
    name: 'Ethereum',
    type: 'evm',
    chainIdDecimal: 1,
    nativeSymbol: 'ETH',
    decimals: 18,
    rpcs: [
      'https://rpc.ankr.com/eth',
      'https://ethereum.publicnode.com',
      'https://cloudflare-eth.com',
    ],
    explorer: 'https://etherscan.io',
    bip44Path: "m/44'/60'/0'/0",
    icon: 'ethereum',
  },
  {
    chainId: 'bsc-56',
    name: 'BNB Chain',
    type: 'evm',
    chainIdDecimal: 56,
    nativeSymbol: 'BNB',
    decimals: 18,
    rpcs: [
      'https://bsc-dataseed.binance.org',
      'https://rpc.ankr.com/bsc',
      'https://bsc.publicnode.com',
    ],
    explorer: 'https://bscscan.com',
    bip44Path: "m/44'/714'/0'/0",
    icon: 'binance',
  },
  // ... Polygon, Arbitrum, Solana, etc.
];
```

**RPC 策略**：
- 内置 3 个公共 RPC，自动故障转移
- 支持用户添加自定义 RPC URL
- WebSocket 连接用于实时余额推送（Phase 2）

---

## 6. API 依赖（无后端）

钱包**完全不依赖自建后端**，数据来源：

| 用途 | 服务 | 免费额度 | 说明 |
|------|------|----------|------|
| 链上读写 | 各链公共 RPC | 无限（限速） | 去中心化，无单点故障 |
| Token 列表 | CoinGecko API | 30 req/min | 获取代币图标、价格 |
| 交易历史 | Etherscan / BscScan API | 5 req/s（免费） | 通过 API Key 提速 |
| 链 Gas 价 | 各链 RPC `eth_gasPrice` | 无限 | 实时查询 |
| 汇率 | CoinGecko / Binance | 有 | 显示法币估值 |

> 用户可自行配置 BscScan/Etherscan API Key 以获得更快的历史查询。

---

## 7. 安全审计清单

开源钱包必须把安全做到极致，以下是需要覆盖的安全点：

- [ ] 私钥 / 助记词生成使用 CSPRNG（`crypto.getRandomValues`）
- [ ] AES-256-GCM 加密 + 认证标签验证
- [ ] PBKDF2 轮次 ≥ 200,000
- [ ] 签名后立即擦除内存中的私钥
- [ ] 密码强度校验（min 8位 + 大小写 + 数字）
- [ ] 地址校验（EIP-55 / Solana Base58）
- [ ] 交易确认弹窗显示目标地址 + 金额 + 代币 Symbol
- [ ] 无远程日志上报（隐私）
- [ ] Content Security Policy（Web）
- [ ] 依赖供应链安全（`pnpm audit` + Renovate）
- [ ] 公开安全漏洞奖励计划（HackerOne 或邮箱）

### 7.1 威胁模型（STRIDE）

> 上面 §7 是「要做的事」，本节是「**为什么**要做这些事、靠什么挡住、以及如何验证真的挡住了」。
> 没有验证方式的对策不算对策 —— 那只是一句愿望。

#### 7.1.1 信任边界

```
不可信 ───────────────────────────────────────────────────▶ 可信

┌───────────┐  postMessage  ┌────────────┐  sendMessage  ┌────────────┐  port  ┌──────────┐
│   网页     │ ────────────▶ │  content   │ ────────────▶ │ background │ ─────▶ │  popup   │
│（任意 dApp）│              │   script   │               │  (SW)      │        │ （持钥）  │
│           │ ◀──────────── │ （仅中继）   │ ◀──────────── │            │ ◀───── │          │
└───────────┘               └────────────┘               └────────────┘        └──────────┘
      ▲                            ▲                            ▲
 任何人可注入代码            页面可伪造 postMessage        不持有密钥
 若走 http 可被中间人篡改      source 校验是唯一防线        只裁决、只路由
```

**三条关键不变式**（任何改动都不得破坏）：

1. 助记词与私钥**只存在于 popup 的内存会话**中 —— 从不进入 `chrome.storage`、background、content script 或 Zustand 持久化
2. `background` **不 import 任何密钥模块** —— 它只做裁决（`gate()`）与路由
3. 无 grant 时 `eth_accounts` 返回 `[]`，签名/发送类方法一律拒绝

#### 7.1.2 STRIDE 分析

| # | 威胁 | 具体攻击场景 | 影响 | 对策 | 验证方式 |
|---|---|---|---|---|---|
| **S1** | 仿冒 | 恶意页面冒充一个已获授权的 dApp 发起请求 | 用户以为在跟可信站点交互 | origin 由 `sender.url` 在 background 侧解析，**不采信页面自报的身份** | `packages/core/src/dapp/protocol.test.ts` —「grant does not leak across origins」 |
| **S2** | 仿冒 | 页面伪造 `window.postMessage` 冒充注入的 provider | 绕过 content script 直达 background | content script 校验 `event.source === window` **且** `data.source === '7xcircle-inpage'` | `apps/extension/src/content.test.ts` |
| **S3** | 仿冒 | 明文 http 页面（可被中间人改写）向钱包发起请求 | 用户批准的是一个他从未真正看到内容的 origin | `originOf` 只接受 `https:`，`http:` 仅限 `localhost` / `127.0.0.1` / `[::1]` | `apps/extension/src/background.test.ts` —「rejects plaintext http origins that are not loopback」 |
| **T1** | 篡改 | 中间人改写 dApp 的 RPC 请求或响应 | 用户签下非本意的内容 | 传输强制 https；页面↔扩展走 Chrome 内部消息，不经网络 | 同上 S3；`manifest.json` 的 `content_scripts.matches` 仍含 `http://*/*`，见 §7.1.4 |
| **T2** | 篡改 | 直接改写存储中的 vault 密文 | 解密出错误助记词 | AES-256-GCM 认证加密，认证标签校验失败即拒绝 | `packages/core/src/vault/encryption.test.ts` |
| **T3** | 篡改 | 篡改排队中的待批准请求 | 用户批准的与实际执行的不一致 | 请求只在 background 内存与 popup port 之间传递，不落盘、不经过页面 | 人工审查（无自动测试） |
| **R1** | 抵赖 | 用户否认曾授权某 dApp | 无法举证 | 权限台账含 `grantedAt` 并持久化 | `protocol.test.ts` —「permission ledger」 |
| **I1** | 信息泄露 | 未授权站点读取用户地址做指纹 | 隐私泄露 | 无 grant 时 `eth_accounts` 返回 `[]`（EIP-1102）；地址快照与权限是两份独立数据 | `background.test.ts` —「returns [] for an origin that was never granted, even if addresses are on file」 |
| **I2** | 信息泄露 | 助记词经持久化或日志外泄 | 资产全失 | 会话仅在内存；Zustand `partialize` 显式排除 `unlocked` / `accounts`；无远程日志上报 | `apps/web/src/store/wallet.ts` 头部 SECURITY NOTE + 人工审查 |
| **I3** | 信息泄露 | 私钥残留在内存中被其他进程读取 | 资产全失 | 取用后立即 `privateKey.fill(0)` | 人工审查（内存残留无法自动断言） |
| **I4** | 信息泄露 | 恶意 dApp 借超长 payload 做指纹或卡死弹窗 | 隐私 / 可用性 | `previewParams` 截断至 800 字符并容忍循环引用 | `protocol.test.ts` —「truncates enormous payloads and survives circular junk」 |
| **D1** | 拒绝服务 | dApp 洪水式请求刷爆待批准队列 | 钱包无响应 | 只读方法静默应答不进队列；签名类必须用户逐条批准；SW 重启即清空内存队列 | 部分覆盖（队列本身无上限，见 §7.1.4） |
| **D2** | 拒绝服务 | 请求挂死，占住 `sendResponse` 直至 Chrome 断开 | dApp 永久挂起 | 4 分钟超时兜底，超时回 `4900 disconnected` | 人工审查（建议补测试，见 §7.1.4） |
| **E1** | 提权 | 未授权站点直接调用签名/发送 | 资产全失 | `gate()`：sign / send / admin 无 grant 一律 `4100` 拒绝 | `protocol.test.ts` —「sign/send prompt ONLY with a grant — never for strangers」 |
| **E2** | 提权 | 已授权站点在未获批的链上发起交易 | 在错误链上执行 | grant 绑定 `chainIds`，不匹配返回 `4901` | `protocol.test.ts` —「grant does not leak across chains」 |
| **E3** | 提权 | 利用 `eth_sign` 签署任意 32 字节哈希（空白支票） | 可签出任意交易 | `eth_sign` 硬编码为 `unsupported`，永不进入签名路径 | `protocol.test.ts` + `background.test.ts` —「keeps eth_sign unsupported」 |
| **E4** | 提权 | 钱包锁定时批准待处理请求 | 未解锁即可签名 | popup 侧 `rejectAllLocked` + 批准按钮 `disabled`；broker 只「停车」不放行 | 人工审查（无自动测试） |

#### 7.1.3 对策的回归防护现状

> 这张表回答「哪些防线一旦被改坏会被 CI 立刻发现」。空白处就是当前的裸露面。

| 防线 | 有自动测试 | 仅人工审查 |
|---|---|---|
| origin 解析与 scheme 白名单 | ✅ `background.test.ts` | |
| `eth_accounts` 无授权返回 `[]` | ✅ `background.test.ts` | |
| content script source 校验 | ✅ `content.test.ts` | |
| 权限台账（授权/撤销/跨源不泄露） | ✅ `protocol.test.ts` | |
| 链绑定（跨链不泄露） | ✅ `protocol.test.ts` | |
| `eth_sign` 不可达 | ✅ 两处 | |
| vault 认证加密 | ✅ `encryption.test.ts` | |
| 私钥用后擦除 | | ⚠️ `DappApprovals.tsx` / `signFor.ts` |
| 请求不落盘 | | ⚠️ `background.ts` pending 队列 |
| 4 分钟超时兜底 | | ⚠️ `background.ts` |
| 锁定时拒绝批准 | | ⚠️ `DappApprovals.tsx` |
| Zustand 不持久化密钥 | | ⚠️ `store/wallet.ts` |

#### 7.1.4 已知接受的风险

记录在此，是为了让它们是**明确的决定**，而不是没人注意到的漏洞。

| 风险 | 说明 | 为何接受 |
|---|---|---|
| `manifest.json` 的 `content_scripts.matches` 仍为 `http://*/*` | content script 仍会注入到 http 页面，但**任何请求都会被 background 拒绝**（S3） | 安全性由 background 的 origin 判定保证；收窄 manifest 会导致 http 页面连 `window.ethereum` 都不存在，反而让部分 dApp 报错更难排查。**若要求更严格，应一并收窄** |
| 无不可篡改的审计日志 | 本机用户可修改 `chrome.storage` 中的授权记录 | 非托管钱包中用户即资产所有者，抵赖风险无实际对手方 |
| 待批准队列无长度上限 | 理论上可被洪水请求耗尽内存 | SW 是短生命周期的，重启即清空；实际影响有限。**若成为问题，应加队列上限** |
| 4 分钟超时兜底无自动测试 | 定时器行为依赖 SW 生命周期 | 测试成本高于收益，暂以人工审查覆盖 |
| 无第三方安全审计 | 未经专业机构审计 | 项目处于 alpha，SECURITY.md 已明确「勿存大额资金」 |

#### 7.1.5 变更纪律

以下任一改动**必须**回来更新本节，否则视为引入未评估的攻击面：

- 新增任何 EIP-1193 方法（改 `METHOD_TIERS`）
- 改动 `originOf` 的 scheme / host 白名单
- 让 `background` 接触任何密钥或会话 API
- 新增 popup ↔ background 的消息类型
- 向 `chrome.storage` 写入新的数据类型

---

## 8. 开发路线图

```
Phase 1 ─── MVP（核心收发）
├── Week 1: Monorepo 搭建 + 核心加密模块
├── Week 2: 链适配器（EVM 三条 + Solana）
├── Week 3: Web 版 UI（Onboarding + Home + Send/Receive）
├── Week 4: 安全加固 + 测试 + 文档
└── 交付: Web 开源可用

Phase 2 ─── 扩展
├── 移动端（React Native）
├── 桌面端（Tauri）
├── Hardware Wallet（Ledger）
├── NFT 视图
└── 更多链（Tron、Avalanche 等）

Phase 3 ─── DeFi
├── DApp Browser
├── Swap 聚合
├── 质押集成
└── WalletConnect v2
```

---

## 9. 目录初始搭建命令（Phase 1 Week 1）

```bash
# 创建项目
mkdir 7xcircle-wallet && cd 7xcircle-wallet
pnpm init

# Monorepo 基础
pnpm add -Dw turbo @types/node typescript

# 创建包
pnpm create vite apps/web --template react-ts
pnpm add -Dw tailwindcss @tailwindcss/vite
pnpm add -Dw @vitejs/plugin-react

# 核心依赖
pnpm add @noble/curves @noble/hashes tweetnacl
pnpm add viem @solana/web3.js bip39 bip32
pnpm add zustand react-i18next lucide-react

# 开发依赖
pnpm add -Dw vitest @vitest/coverage-v8
pnpm add -Dw tsx tsup @changesets/cli
```

---

## 10. 为什么这样设计？

| 设计决策 | 理由 |
|----------|------|
| **Monorepo + 链适配器** | 一次写三个平台用，新链接入只需写 adapter |
| **纯客户端，零后端** | 开源可信、无服务器成本、无单点故障 |
| **noble-curves 而非 ethers.js** | 纯 JS、可审计、无原生编译依赖 |
| **viem 而非 ethers v5** | 轻量 5x + Tree-shakeable + TypeScript 原生 |
| **Tauri 而非 Electron** | 包体 ~5MB vs ~150MB，安全性更好 |
| **AES-GCM + PBKDF2** | OWASP 2023 推荐标准，抗暴力破解 |
| **密码解锁而非明文存储** | 设备丢了也拿不到密钥 |

---

*文档版本：v1.0 · 2026-08-31 · Apache-2.0*

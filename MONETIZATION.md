# 7xCircle Wallet 商业化方案

> 单人开发者 · 零后端 · 全部第三方 API 分润 · 面向 MEME 交易者

**文档版本:** v1.0 · 2026-09-24
**适用阶段:** Alpha → 有稳定用户量的 1.0

---

## 1. 背景与约束

### 1.1 我们的处境

| 项目 | 现状 |
|---|---|
| 团队 | 单人开发 |
| 架构 | 零后端（`packages/*` 纯客户端，数据源为公共 RPC + 区块浏览器） |
| 用户来源 | 从 TokenPocket（TP 钱包）社区直接迁移 |
| 用户画像 | **MEME / 土狗高频交易者** |
| 目标链 | Solana、BNB Chain、Ethereum、Tron |
| 商业模式 | **全部依赖第三方 API，我们只做分润**——不自营验证人、不自建能量池、不做市商 |

### 1.2 一个必须先认清的事实

**我们的用户是整个行业最值钱的用户类型。**

Syndica 数据：2025 上半年 Solana DApp 收入 $1.6B，其中 **meme 类 DApp 占月度收入 62%**。土狗交易者的人均贡献是普通持币用户的 10 倍以上。

行业费率基准：

| 平台 | 基础费率 | 备注 |
|---|---|---|
| Axiom | ~1% | 返 ~1/3 作为 SOL cashback + 三级返佣 |
| Trojan | 1%（推荐码 0.9%） | 20% 返现 → 实际 ~0.8% |
| GMGN | ~1% | 推荐码不降费 |
| BullX | 0.5–1% | 多链（SOL / TRON / BSC） |
| Photon | 0.25% – 1%（数据源有冲突） | |
| **TokenPocket** | **≈0（不收平台费）** | 成本 = Gas + DEX 协议费 + 滑点 |

### 1.3 核心矛盾（决定了所有定价策略）

**机会：** 我们的用户已经习惯向狙击机器人付 1%，我们收 0.3–0.5% 属于"打折"。

**陷阱：** 但 **TP 钱包本身不收平台费**。从用户视角，迁移到我们这里 = "从 0% 变成 0.5%"，感知是**涨价**。

> **结论：收费必须与"用户真正在意的东西"绑定。**
>
> 土狗用户愿意为**成交**付钱，不愿意为**换个币**付钱。
> 所以：基础 Swap 收低价（甚至免费），把费率放在**极速模式 / 防夹 / 优先打包**上。
> 同时在迁移期把三个理由立住：**① 落地率更高 ② 不会被貔貅 ③ 新币第一时间可见**。
> 这三条做不到，费率一定把人赶回 TP。

---

## 2. 收入模型总览

| # | 收入线 | 第三方 | 分润机制 | 工程量 | 优先级 |
|---|---|---|---|---|---|
| 1 | **Swap 兑换** | Jupiter（SOL）/ 0x（EVM） | 传抽成参数，手续费进 feeAccount | 中 | **P1** |
| 2 | **Solana 质押** | Marinade Referral | 双方各得 +0.125% APY | 低 | **P1** |
| 3 | **Tron 能量代付** | TronSave / Feee.io / MERX | 批发购入 + 加价转售 | 中 | **P1** |
| 4 | **多链质押** | Everstake / P2P.org / StakeKit | 佣金分成，可配置 | 低 | P2 |
| 5 | **稳定币生息** | Yield.xyz / LI.FI Earn / Privy | 金库费率（10%/20%）或自设 bps | 低 | P2 |
| 6 | **安全检测 / 新币发现** | 自建 + DexScreener | 不直接收费，是 Swap 收入的分母 | 高 | **P1** |
| 7 | **返佣（零工程量）** | Jupiter / CEX | 推荐返佣 | 极低 | P3 |

**结构性优势：** 零后端 = 边际成本接近 0。VC 养的钱包在低交易量下必然亏损，我们在同样量级下就是盈利的。**这是单人开发者唯一的结构性优势，不要放弃它。**

**唯一必要的固定成本：** 一个付费快速 RPC（Helius / Triton，约 $50–200/月），用于 Solana 交易基建。

---

## 3. 收入线 1：Swap（主收入）

### 3.1 接入方案

| 链 | 第三方 | 抽成参数 | 说明 |
|---|---|---|---|
| **Solana** | Jupiter Swap API | `platformFeeBps`（上限 1%）+ `feeAccount` | 2025 年 1 月起无需 Referral Program，直接传 feeAccount 即可。手续费以**输出代币**形式结算。Jupiter 抽走我们收益的 **2.5%** |
| **BSC** | 0x Swap API | `swapFeeRecipient` + `swapFeeBps`（0–1000） | 支持多收款地址做分成。`swapFeeToken` 必须是 buyToken 或 sellToken |
| **跨链** | LI.FI | `fee` 参数（小数百分比）+ `integrator` | LI.FI 自身另收 0.25% 服务费，量大有折扣 |
| **Tron** | SunSwap（后期） | 需自行接入 | TP 的 Tron Meme 模式有 99% Gas 减免，是竞品优势项 |

### 3.2 定价策略（推荐方案 B）

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A | 统一收 0.3–0.5% | 简单、收入可预测 | 用户感知为"涨价" |
| **B（推荐）** | **基础 Swap 0.2% + 极速/防夹模式 0.5%** | 收费对齐价值，社区信任不受伤 | 只有部分用户付费 |

**方案 B 的分层定义：**

- **基础模式（0.2%）**：正常优先费，普通落地率
- **极速模式（0.5%）**：高优先费 + Jito tip 防夹 + 自动重发 + 更快的 RPC

土狗用户对"这笔能不能成交"的敏感度远高于"费率 0.2% 还是 0.5%"。

### 3.3 落地顺序

**Solana 先行**（土狗主战场）→ **BSC 第二**（华语圈另一大土狗链）→ **ETH 最后**（gas 太高，不是土狗场景）→ Tron 依赖 SunSwap 接入。

---

## 4. 收入线 2–5：质押与生息（全部第三方 API 分润）

> **原则：我们不自营验证人、不承担 slashing 风险、不管理资金池。**
> 所有收益产品都是：第三方提供 API → 用户自托管签名 → 我们从收益中分润。

### 4.1 选型总表

| 需求 | 推荐第三方 | 分润机制 | 集成难度 |
|---|---|---|---|
| **SOL 质押（首选）** | **Marinade Referral Program** | 合作方与用户**各得 +0.125% APY（12.5 bps）**，无质押上限，每 epoch 自动结算，来自 Marinade 现有费用 | 低（有 `marinade-ts-sdk`） |
| 多链质押（聚合） | **StakeKit (Yield.xyz)** | 单次集成覆盖 75+ 链、25–30 家 SSP；分成可达市场标准的 **2.8 倍** | 低 |
| 多链质押（白标） | **Everstake** | 佣金分成，按网络不同；非托管 Wallet SDK，约 **1 天**可集成；99.98% 在线率 SLA、0 slashing 记录；30+ 网络 | 低–中（72 小时–5 周） |
| 多链质押（快速上线） | **P2P.org** | **72 小时**集成，40+ 网络；佣金可按客户分层 / 网络 / 产品档位配置；100% 保留品牌 | 低 |
| **稳定币生息** | **Yield.xyz OAV** | 预置 **10% / 20% 费率**的 Optimized Allocator Vault，自动处理激励、包装、收费；覆盖 Yearn / Morpho / Ethena / Spark / Curve / Kamino（约 80% DeFi 市场） | 低 |
| 稳定币生息（跨链） | **LI.FI Earn** | 20+ 协议、60+ 链，Earn Data API + Composer 一键跨链存入，**内置分润** | 低 |
| 稳定币生息（Morpho） | **Privy Earn** | 部署 fee wrapper，**最高可捕获 50% 的累计收益**为金库份额 | 低 |
| 稳定币生息（自定费率） | **Enso Earn** | 请求里传 `fee`(bps) + `feeReceiver` 地址 | 低 |
| 生息（ERC-4626 白标） | **Kiln DeFi** | ERC-4626 金库，**合约层面**原生支持费用管理与记账，可定制变现逻辑 | 低–中 |

### 4.2 Solana 质押（建议第一个做）

这是**唯一一个"用户多赚、我们也赚"**的结构，最适合作为迁移期的诚意卖点：

- 用户质押 SOL（走 **Marinade Native**）→ 用户自己多得 0.125% APY
- 我们同时得 0.125% APY
- 钱由 Marinade 从它自己的费用里出，**不从用户身上扣**
- 每 epoch 自动结算，在 Marinade 后台可查

**注意两个约束：**
1. 用户必须连接钱包并用 **Marinade Native** 质押（不是买 mSOL）
2. 钱包与推荐码是**永久绑定**的关系，一个钱包只能绑一个推荐

> **对用户的说法**：「在我们这里质押 SOL，年化比别处高 0.125%，而且我们不加收任何费用。」——这是纯增量，TP 用户没有理由拒绝。

### 4.3 稳定币生息（被低估的第二曲线）

**为什么对土狗用户有意义：** 他们不质押主流币（钱都在仓位里），但他们手上有**大量等待入场的 USDT 干粉**。这部分钱平时躺着，牛市回调时闲置数周。

**产品化：** 「USDT 闲置生息」——一键存入 Morpho / Aave 金库，随时取出，我们抽成走金库费率。

**收入量级（保守）：** 300 用户 × 平均 $2,000 干粉 = $600k TVL。按 5% APY、我们抽 15% 收益计算：`$600k × 5% × 15% = $4,500/年`。

> **坦白说：对这批用户，生息收入远小于 Swap 收入。**
> 它的价值不在金额，而在**反周期性**——土狗行情死掉时，Swap 收入腰斩，生息收入还在。这是"持续盈利"里"持续"两个字的来源。

### 4.4 多链质押（辅助）

BSC 没有真正意义上的原生质押，ETH 需要 32 ETH 或 LST，对这个用户群价值都有限。
建议：**用 StakeKit 或 Everstake 一次集成覆盖全链**，不要为单一链单独对接。

---

## 5. 收入线 6：Tron 能量代付

### 5.1 为什么这是被严重低估的一条线

Tron 的资源模型（Stake 2.0）决定了两件事：

- 普通 TRC20 USDT 转账 **燃烧 TRX ≈ $0.5–3**
- 通过**能量租赁**可以降到 **$0.3–0.8**
- 能量出租的市场年化 **16.5%**，而单纯投票只有 **3.2%** —— 能量是 Tron 上真正的钱

TP 用户**本来就懂能量**，这是最容易被理解、最容易推销的卖点。

### 5.2 商业模式：批发购入 → 加价转售

我们**不自建能量池**，而是：

1. 通过第三方 API 批发购入能量
2. 在用户转账时自动代付
3. 向用户收取**低于燃烧成本**的费用

用户省钱 → 我们赚差价 → 双赢。

### 5.3 第三方 API 选型

| 供应商 | 类型 | API | 说明 |
|---|---|---|---|
| **TronSave** | 直接供应商 | `https://api.tronsave.io`（v2，API Key 认证） | 最早的能量租赁服务之一。接口：`/v2/estimate-buy-resource`、`/v2/buy-resource`、`/v2/user-info`、`/v2/order/:id`、`/v2/orders`、`/v2/order-book`、`/v2/get-extendable-delegates`、`extendRequest`。官方 SDK **`@tronsave/sdk`**（TypeScript，零依赖，内置重试与限流） |
| **Feee.io** | 直接供应商 | 有 API | 定价有竞争力，已被多个下游项目集成 |
| **MERX** | **聚合层** | 单一 API | 聚合所有供应商。每 30 秒轮询报价，Redis 缓存 TTL 60 秒，自动路由到最便宜且有货的供应商，支持故障转移。**消除"集成税"**（自接每家约 5–7 天） |
| TronScan.energy | 聚合层 | API 集成中 | 聚合 19+ 家供应商 |

> **注意参数约束：** TronSave 要求 ENERGY 的 `resourceAmount > 64,000`，默认 `durationSec = 259200`（3 天）。

> **推荐路径：** 先用 **MERX 聚合 API** 单点接入（避免逐家集成），量大后再直连 **TronSave / Feee.io** 拿更好的批发价。

### 5.4 定价示例

| 项目 | 金额 |
|---|---|
| 用户直接燃烧 TRX | ~$1.50 / 笔 |
| 我们批发能量成本 | ~$0.40 / 笔 |
| 向用户收取 | **$0.70 / 笔** |
| 用户节省 | 53% |
| **我们毛利** | **$0.30 / 笔** |

**收入量级：** 1,000 活跃用户 × 30 笔/月 × $0.30 = **$9,000/月 ≈ $10.8 万/年**

（这是乐观值。建议按你真实用户数代入：`用户数 × 月均笔数 × $0.30`。）

---

## 6. 收入线 7：安全检测与新币发现（获客引擎）

**这条线不直接收钱，但它决定前面所有收入线的分母。**

土狗用户换钱包的理由排序：**① 不要让我被貔貅 ② 新币要第一时间看到 ③ 不要让我交易失败**。

| 功能 | 实现要点 | 状态 |
|---|---|---|
| **貔貅 / rug 检测** | 买入卖出双向模拟 + 税率检测 + LP 锁仓 + 合约放弃权限 | 待建 |
| **Solana 权限检查** | `getMint` 读 `mintAuthority` / `freezeAuthority`（**代码里已 import `getMint`，可直接用**） | 易实现 |
| **持仓集中度** | Top 10 持有人占比、dev 钱包持仓 | 待建 |
| **实时价格** | **Jupiter Price API（Solana）+ DexScreener（全链）** | 待建 |
| **新币自动发现** | Solana 枚举 SPL token accounts；EVM 用 explorer wildcard `tokenbalance` | 待建 |

> ⚠️ **不要用 CoinGecko 做土狗价格——它覆盖不到。** 这是目前 `apps/web` 里最大的体验缺口：`priceUsd` / `balanceUsd` 字段在 `packages/shared/src/types.ts` 里定义了，但**代码中从未被赋值**。

---

## 7. 收入线 8：零工程量返佣

| 来源 | 机制 | 说明 |
|---|---|---|
| **Jupiter Referral** | L1 直接推荐返 **0.14% → 0.24%** 交易量（7 日滚动 > $10,000 后升级）；L2 0.04%；L3 0.02% | 用户绕过我们的 Swap 直接在 Jupiter 交易时仍有收入 |
| **CEX 返佣** | Binance / OKX 邀请返佣 | 土狗用户也用交易所，内置邀请入口即可 |

> ⚠️ **不要把用户引给 Axiom / GMGN / Photon 等竞品换返佣**——那是拿长期收入换短期收益。

---

## 8. 技术前置（必须先行）

### 8.1 Phase 0：交易抽象层改造

> **不做这一步，后面每个功能成本翻倍。**

| 问题 | 位置 | 改法 |
|---|---|---|
| Solana 用字符串 DSL 塞交易意图 | `packages/chains/src/solana/adapter.ts:155`（`spl-token:${JSON.stringify(...)}`），且 `from/to/value` 语义已被破坏 | 换成类型化 `TxIntent` 联合类型 |
| UI 强制类型转换 adapter | `apps/web/src/pages/Send.tsx` 里 `adapter as unknown as {...}` | 把 `encodeErc20Transfer` / `parseTokenAmount` / `getTokenInfo` / `buildTokenTransaction` 提升进 `ChainAdapter` 接口 |
| 无只读合约能力 | `packages/core/src/chain/adapter.ts` | 加 `readContract()`（EVM `eth_call` / Solana `simulateTransaction`）——Swap 报价、滑点、失败预演全靠它 |
| 无 approve 概念 | 同上 | 加 `getAllowance()` + `approve` 意图（EVM 非原生代币 Swap 必需） |
| Send 页面 1,019 行 | `apps/web/src/pages/Send.tsx` | 抽出 `useTxFlow` hook，Swap / Stake 复用 |

**目标类型设计：**

```typescript
export type TxIntent =
  | { kind: 'native-transfer'; to: string; amount: string }
  | { kind: 'token-transfer'; token: string; to: string; amount: string }
  | { kind: 'contract-call'; to: string; data: string; value?: string }   // EVM
  | { kind: 'solana-instructions'; instructions: unknown[] }              // Solana
  | { kind: 'approve'; token: string; spender: string; amount: string };  // EVM
```

配套：新建 `packages/swap`（只依赖 `core` / `chains`，平台无关，web / extension / mobile 三端复用）。

### 8.2 Phase 1：Solana 交易基建（**先于一切商业化，P0**）

**这是用户量能否留住的分水岭。** 没有它，土狗用户不会为了省 0.5% 而忍受 30% 的失败率。

| 缺失项 | 现状 | 后果 |
|---|---|---|
| ComputeBudget（优先费） | **完全没有** | 拥堵时交易打不进去 |
| `VersionedTransaction` | 只用 legacy `Transaction` | Jupiter 返回的是 v0 交易，接不上 |
| Jito tip | 没有 | 被三明治攻击 + 落地率低 |
| 自动重试 / 换 blockhash | 没有 | 失败即失败 |
| 快速 RPC | 用公共节点 | 延迟高，抢不到新盘 |

### 8.3 Phase 2：Tron 支持（迁移的入场券）

**现状：`packages/chains/src/configs.ts` 里 9 条链，一条 Tron 都没有。TP 用户的钱在 TRC20 USDT 上，进不来。**

**技术要点：**

- Tron 用 **secp256k1**，与 EVM **同一条曲线** → `@noble/curves` 派发逻辑可复用
- 但地址是 `base58check(0x41 + keccak(pubkey)[12:])`
- 交易是 **protobuf 结构**（不是 RLP）
- RPC 走 **TronGrid**
- 资源模型：Energy / Bandwidth，Stake 2.0 冻结 / 解冻（解冻有 **14 天等待期**）

**分两阶段：**
1. **MVP**：余额 + TRC20 USDT 收发 + 能量代付
2. **完整**：SunSwap 兑换 + Stake 2.0 冻结

**估算：2–4 周**（你所有链适配里最重的一块）。

### 8.4 其他技术债（顺带清理）

| 问题 | 位置 |
|---|---|
| `packages/storage` 是死代码，无人 import | 要么接入，要么删除 |
| README 声称支持 Bitcoin，**实际没有 adapter** | 修文档（这是信任问题） |
| `estimateFees` 永远返回 `level: 'medium'` | 补慢/快/自定义档位 |
| 扩展 provider 是空壳（`eth_accounts` 恒返回 `[]`） | 除非用户真在浏览器用 dApp，否则**低优先**；完成度不够的 provider 反而是安全隐患 |
| 无 lint 配置 | `turbo.json` 有 `lint` 任务但没有包定义脚本 |

---

## 9. 收入测算

### 9.1 Swap（假设每人每周 10 笔、单笔 $200、综合费率 0.4%）

| 活跃交易用户 | 月流水 | 月收入 | 年收入 |
|---|---|---|---|
| 200 | $1.7M | $6.9k | **~$8.3 万** |
| 1,000 | $8.7M | $34.7k | **~$41.6 万** |
| 3,000 | $26M | $104k | **~$125 万** |

### 9.2 Tron 能量（$0.30 毛利/笔，人均 30 笔/月）

| 活跃用户 | 年收入 |
|---|---|
| 500 | ~$5.4 万 |
| 1,000 | ~$10.8 万 |

### 9.3 质押与生息

| 项目 | 假设 | 年收入 |
|---|---|---|
| SOL 质押 | 300 人 × 10 SOL，Marinade 返 0.125% | ~$3.5k（按 SOL $200 计） |
| 稳定币生息 | $600k TVL，5% APY，抽 15% 收益 | ~$4.5k |

> **明确结论：质押/生息对这批用户的收入贡献是小头（万元级），Swap + 能量才是主力（十万级）。**
> 生息的价值是**反周期**，不是金额。

### 9.4 这个模型的意义

**你不需要百万用户，你需要几千个真实活跃的土狗交易者。**

对照：Trust Wallet 1.15 亿月活，ARPU 仅 **$0.9**；Rabby 420 万月活，ARPU **$5.7**。差别不在用户数量，在于**用户是不是链上活跃交易者**。

而这批用户恰恰最容易通过社区直接获取，也恰恰是通用钱包最难抢的。

---

## 10. 风险与合规

| 风险 | 说明 | 应对 |
|---|---|---|
| **合规（MiCA）** | 2026-07-01 全面执行。非托管钱包本身**不在 CASP 范围**，但"收手续费是否触发持牌"在欧盟各成员国解释不一致 | ① 费率抽在**第三方聚合器参数里**（我们身份是推荐方，不是自营路由）；② 确认页**显式披露费用**；③ 费率可配置、可归零；④ 手续费代币**直接进 feeAccount**，我们不托管 |
| **行情周期性** | Swap 收入与土狗行情强正相关，熊市腰斩 | 靠能量（刚需）+ 生息（反周期）对冲；保持零后端成本结构 |
| **第三方依赖** | 所有收入线都依赖第三方 API | 每家都准备备选（Tron 用 MERX 聚合天然多供应商；质押用 StakeKit 聚合） |
| **品牌风险** | 收"涨价"费会伤害社区信任 | 迁移期把费率理由立住；优先用"用户也获益"的结构（如 Marinade 双方各得 0.125%） |
| **单人开发** | 最大风险是摊子铺太大 | 严格按优先级执行，不并行铺开 |

---

## 11. 路线图

```
Phase 0 ── 抽象层（0 收入，但不做题后面成本翻倍）
├── TxIntent 类型化，替换 solana 字符串 DSL
├── ChainAdapter 补 readContract / getAllowance / approve
├── 抽 useTxFlow，拆 Send.tsx
└── 新建 packages/swap

Phase 1 ── Solana 交易基建（P0，用户留存的生死线）
├── ComputeBudget 动态优先费
├── VersionedTransaction 支持
├── Jito tip 防夹
├── 自动重试 + 换 blockhash
└── 接付费快速 RPC（Helius / Triton）

Phase 2 ── Tron MVP（迁移入场券）
├── 地址派生 + TronGrid RPC + protobuf 交易
├── TRC20 USDT 收发
└── 能量代付（MERX 聚合 API）+ 分润

Phase 3 ── 第一条收入
├── Solana Swap（Jupiter platformFeeBps：基础 0.2% / 极速 0.5%）
└── Solana 质押（Marinade Referral）

Phase 4 ── 留存引擎（Swap 收入的分母）
├── 貔貅/rug 检测
├── Jupiter Price API + DexScreener 实时价格
└── 新币自动发现

Phase 5 ── 扩展
├── BSC Swap（0x Swap API）
├── 稳定币生息（Yield.xyz OAV / LI.FI Earn）
├── 多链质押（StakeKit / Everstake）
├── 授权管理 / 一键撤销
└── ETH Swap

Phase 6 ── 可选
└── 扩展 provider 完整化（EIP-6963 + eth_sendTransaction + WalletConnect）
```

### 优先做哪三件

1. **Solana 交易基建**（Phase 1）——纯链路质量提升，不动现有功能，风险最低，对用户价值最大
2. **Tron MVP**（Phase 2）——没有它用户根本搬不过来
3. **Solana Swap + Marinade 质押**（Phase 3）——第一条收入

---

## 12. 明确不做的事

| 项目 | 原因 |
|---|---|
| **法币出入金** | 已排除；合规成本高，与"零后端"定位冲突 |
| 卡片支付 | 交换费被监管封顶（美国借记卡 $0.21+0.05%，欧盟 0.2%/0.3%），行业共识是亏损获客项 |
| **永续合约** | ARPU 最高，但对当前阶段是**品牌自杀**：0.23% 的巨鲸贡献 70% 持仓量，且有用户亏掉 99% 本金还付了高额费用。留到有规模、有风控能力后再评估 |
| **自营验证人 / 自建能量池** | 违背"全部第三方 API 分润"原则，引入 slashing 与资金风险 |
| **发币 / 积分** | 有社区，诱惑最大。但会把项目从"可审计的工具"变成"代币盘"，合规风险不对称。**留到年收入稳定后单独决策** |
| 自建后端 / 账号体系 | 放弃零成本结构 = 放弃唯一的结构性优势 |

---

## 附录 A：第三方 API 速查

| 用途 | 供应商 | 关键参数 / 端点 |
|---|---|---|
| Solana Swap | Jupiter | `platformFeeBps`（≤1000）、`feeAccount`；Jupiter 抽 2.5% |
| EVM Swap | 0x | `swapFeeRecipient`、`swapFeeBps`（0–1000）、`swapFeeToken` |
| 跨链 Swap | LI.FI | `fee`（小数，如 `0.02`）、`integrator` |
| Solana 质押 | Marinade | Referral Program，双方各 +0.125% APY，每 epoch 结算 |
| 多链质押 | StakeKit / Everstake / P2P.org | 佣金分成，可配置；Everstake ~1 天，P2P.org 72 小时 |
| 稳定币生息 | Yield.xyz OAV | `POST /v1/actions/enter`，预置 10% / 20% 费率金库 |
| 稳定币生息 | LI.FI Earn / Enso / Kiln DeFi / Privy | Enso 传 `fee`(bps) + `feeReceiver`；Privy 最高捕获 50% 收益 |
| Tron 能量 | TronSave / Feee.io / MERX | TronSave `@tronsave/sdk`，`/v2/buy-resource`；MERX 聚合多供应商 |
| 价格数据 | Jupiter Price API / DexScreener | 覆盖土狗，CoinGecko 覆盖不到 |

## 附录 B：关键代码位置

| 事项 | 文件 |
|---|---|
| 链适配器接口 | `packages/core/src/chain/adapter.ts` |
| 跨链统一类型 | `packages/shared/src/types.ts` |
| 链配置（9 条链，无 Tron） | `packages/chains/src/configs.ts` |
| Solana adapter（字符串 DSL 所在） | `packages/chains/src/solana/adapter.ts` |
| EVM adapter（已有 `encodeFunctionData`） | `packages/chains/src/evm/adapter.ts` |
| 唯一完整发送流程 | `apps/web/src/pages/Send.tsx`（1,019 行） |
| 扩展 provider 空壳 | `apps/extension/src/content.ts`、`apps/extension/public/inpage.js` |

---

*文档版本：v1.0 · 2026-09-24 · Apache-2.0*

# Riftbound 接管后的项目方案与技术方案（重设计）

- 日期：2026-10-15
- 状态：**待评审**（评审通过前，远程 swarm 只跑已入队的 RIFT-2…RIFT-6）
- 追踪：Zira RIFT-1；基线 `integration = e2cbcdf`（codex resume-20261013 第 1–393 波的存档）

## 1. 现状诊断

| 维度 | 事实（2026-10-15 核对） | 问题 |
| --- | --- | --- |
| 卡牌效果 | 1381 张印刷版本 / 1080 个卡牌身份：**可执行 0**，需裁定 1348，无能力 33 | 产品核心（能打真实卡）几乎为零；现有做法是给单个机制（Point、Gear、Equip、Hold、Recruit、Spell…）手写专门的 production services，一族一族地接，不能规模化 |
| 版本蔓延 | `runtime.ts / runtime-v2 / runtime-v3`、`command-journal-v2 / -p4`、`projection-v2 / -v3`、`token-play-v2 / -v3`、`canonical-session / -v2`、`cardplay-unit-v2 / unit-chain-v4`；runtime profile 已到 P9（RIFT-5 将加 P10），journal schema 到 9 | 每加一个能力就新增一个 opt-in profile 和 schema，默认值不升级，旧日志要求逐字节重放。复杂度随功能数线性叠加，大量工作耗在“兼容旧 profile、证明没退化” |
| 热点文件 | `DuelMatchBoard.tsx` 100KB、`engine-core/src/index.ts` 75KB、`GameClient.ts` 72KB、`authoritative-runtime-p4.ts` 1574 行 | 并发开发几乎必然冲突，只能串行 |
| 仓库卫生 | `engine-core/src/duel` 下提交了 13 个编译出来的 `.js`，与同名 `.ts` 并存 | 容易改错文件、类型与运行不一致 |
| 过程 | 远程拷了约 250 份无 git 的源码快照；成果从不提交；验收靠每项手写 JSON 证据 | 慢、不可追溯、无法自动合并与回归 |
| 规则版本 | 锁定 Core Rules v1.4；**v1.5 / Radiance 于 2026-10-16 生效** | 需要明确目标规则版本，否则刚做完就过时 |
| 测试 | 基线全量：engine-core 875、game-server 605、desktop-client 845/856 等，共约 2990 例 | 测试量充足，但大量用例绑在 profile/证据细节上，不是按“规则条目 / 卡牌”组织 |

结论：继续沿用“每个机制一个 profile + 手工取证”的路线，覆盖 1080 张卡不可行。需要把方向从“逐项取证”改成“**规则内核 + 数据驱动的卡牌效果 + 自动化整局回归**”。

## 2. 项目方案

### 2.1 目标重定：三个可交付里程碑

原 23 项验收保留为最终标准，但按“能玩起来”的顺序重排：

| 里程碑 | 交付物 | 完成标准（自动化可验证） |
| --- | --- | --- |
| **M1 可玩 1v1**（约 1 周） | 用 2–4 副官方预组卡组，两个客户端打完整一局；官方开局 → 回合 → 战斗 → 计分 → 终局全流程 | 预组卡组内全部卡效可执行；headless 双 bot 自动整局 100 局无异常、终局一致、回放可重放；桌面端可手动打完一局 |
| **M2 卡池覆盖** | 按能力模板批量把卡编译成 EffectIR | 可执行覆盖率分阶段：30% → 70% → 95%；剩余明确 `judge-required` 并列清单；每张可执行卡有 golden 用例 |
| **M3 发布** | macOS / Windows 安装包、干净 checkout CI、用户与开发文档 | GitHub Actions 全绿（install/typecheck/test/build）；两平台安装包可连服务端打完一局 |

### 2.2 规则版本策略（**需要你拍板**）

- 方案 A（推荐）：**直接以 v1.5 为目标**。v1.4 只作为已有实现的过渡，不再为 v1.4 增加新能力。理由：明天就生效，M1 结束时 v1.4 已是旧规则。
- 方案 B：先完成 v1.4 的 M1，再迁移 v1.5。

不论哪个方案，规则版本都作为数据（`rulesetVersion`），引擎只维护**当前一个版本**，不再并行维护多个 profile。

### 2.3 分工与流程

| 角色 | 负责 |
| --- | --- |
| Claude（调度） | 契约设计与冻结、拆任务写卡、Zira 建单流转、验收（看 diff）、合并决策、门禁、推 GitHub |
| 远程 codex-swarm（10.8.124.25） | 全部开发任务：hard 档做内核/协议/重构，easy 档做卡牌 IR 批量编译、UI 叶子组件、补测试 |
| 本机 codex | 视觉验证：启动桌面端走查，产出问题清单（截图 + 复现步骤）；Claude 据此建 RIFT 单再派修复 |

- 每个任务一张 RIFT 单，提交信息带 `RIFT-n`；验收以门禁（typecheck + 全量 test）和 diff 审查为准，不再写证据 JSON。
- 远程只用 git worktree，不再拷贝源码快照。

## 3. 技术方案

### 3.1 规则内核：单一引擎、单一管线

- `engine-core` 收敛为**一个**规则内核：状态模型 + HOT FEPR 管线（Handle outstanding → Finalize → Execute → Pass → Resolve，见 `docs/rule-engine-architecture.md`），回合/优先权/焦点、链、费用、目标、事件/触发/替代效果都只有一套实现。
- 删除 `-v1/-v2/-v3` 并存：每个概念一个模块（`turn/`、`chain/`、`cost/`、`target/`、`combat/`、`scoring/`、`zones/`、`events/`、`effects/`）。旧版本文件在收敛完成、测试迁移后删除。
- `src` 下的 `.js` 产物删除，加入 `.gitignore`。
- `engine-core/src/index.ts`（75KB）拆成按模块的再导出，避免成为冲突热点。

### 3.2 卡牌效果：数据 + 通用解释器（核心改动）

```
官方卡牌文本 ──(card-dsl 编译器/人工模板)──► EffectIR（数据，每卡一个文件）
                                              │
engine-core 效果解释器：cost / target / effect / trigger / replacement 原语
                                              │
                                    golden 用例（每卡 1–3 个场景）
```

- **原语层**（hard 档，少量任务，契约先行）：造成伤害、抽牌、移动、横置/重置、获得/支付能量与符文、召唤 Token、装备、增益/减益、计数器、选择目标、条件、持续效果、触发器（进场/离场/战斗/回合阶段）、替代效果。每个原语一个文件，按注册表登记。
- **卡牌层**（easy 档，大规模并发）：每张卡一个 IR 文件（`packages/card-dsl/cards/<set>/<id>.ts`）+ golden 用例。卡与卡之间零文件冲突，可几十路并行。
- 任何用到未实现原语、或规则有歧义的卡，保持 `judge-required`，不近似实现（沿用现有红线）。
- 现在为 Point/Gear/Equip/Hold/Recruit/Spell 手写的 production services，迁移为“原语 + 对应卡的 IR”，迁移完成后删除。

### 3.3 服务端：一个 runtime、一种日志格式

- `game-server` 只保留**一个**权威 runtime 和一种 command journal 格式，日志头记录 `engineVersion + rulesetVersion`。
- 取消 “P4…P10 runtime profile + schema 4…10” 的叠加模式：
  - 新能力直接进默认路径，不再 opt-in；
  - 旧回放：发布前没有真实用户数据，**不再要求新代码逐字节重放所有旧 schema**；需要保留的旧日志，用当时的 git tag 冻结重放器回放。
- 房间、会话、持久化（FileRoomStore）、断线重连、幂等、隐私投影各一个模块，不再按 profile 分叉。

### 3.4 协议与客户端

- `protocol` 是唯一契约（command / event / projection），客户端类型从它生成或直接引用，不复制 DTO。
- 客户端只渲染服务端投影 + 临时 UI 状态（保持现有原则）。
- 拆热点：`DuelMatchBoard.tsx`（100KB）按区域拆组件（手牌、基地、战场、符文条、链/优先权面板、聊天、日志），`GameClient.ts`（72KB）拆传输层 / 会话 / 命令；拆完后 UI 任务才能并行。
- 视觉回归：Playwright 截图基线（自动） + 本机 codex 人工式走查（问题清单）。

### 3.5 测试与门禁

| 层 | 内容 | 谁写 |
| --- | --- | --- |
| 规则 golden | 场景脚本 DSL：初始局面 + 命令序列 → 期望事件与状态，按规则条目编号组织 | hard/easy |
| 卡牌 golden | 每张可执行卡 1–3 个场景 | easy（随卡同一任务） |
| 协议契约 | command/event/projection 的 schema 与隐私差异快照 | hard |
| 整局回归 | headless 双 bot 用预组卡组自动打完整局，校验终局一致、回放可重放、无隐私泄漏 | hard |
| 门禁 | swarm 每合入 5 个任务跑一次：typecheck + 全量 test；发布前加 build 与整局回归 | 自动 |

GitHub Actions 跑同一套门禁（M3 前接入）。

## 4. 执行计划

| 阶段 | 内容 | 并发 | 主要档位 |
| --- | --- | --- | --- |
| P0 契约（Claude，0.5–1 天） | 冻结：模块边界、EffectIR v2 原语清单与接口、单一 journal 格式、protocol 命令/事件、规则版本 | — | — |
| P1 收敛重构（2–3 天） | 拆热点文件 → 内核去版本化 → 服务端单 runtime → 删 `.js` 产物；按模块分 group 串行，不同模块并行 | 6–10 路 | hard |
| P2 原语 + M1 卡组（2–3 天） | 实现原语；预组卡组的卡 IR 化；headless 双 bot 整局回归 | 10–20 路 | hard + easy |
| P3 卡池扩展（持续） | 按卡集分片批量 IR 化，覆盖率 30% → 70% → 95% | 30–60 路 | easy |
| P4 发布 | 安装包、CI、文档 | 少量 | hard |

视觉走查在 P1 拆分客户端后、P2 整局可打后各做一轮。

## 5. 对在途任务的影响

| 任务 | 处理建议 |
| --- | --- |
| RIFT-2 客户端 11 个失败用例 | 继续，与新方案一致 |
| RIFT-3 Hold 生命周期、RIFT-4 Equip 回调 | 继续：修的是内核真实缺陷，收敛时会被吸收 |
| RIFT-5 Point 接入新 profile P10 | **建议取消**：正是要停掉的 profile 叠加模式；改为 P1 里“服务端单 runtime”任务的一部分 |
| RIFT-6 Gear 正常牌组阳性 | 继续但降为参考：结果在 P2 原语化时复用 |

## 6. 需要决策

1. 目标规则版本：v1.5（推荐）还是先完成 v1.4。
2. 是否接受“不再逐字节兼容旧 profile/schema 回放”（发布前无真实用户数据）。
3. M1 用哪几副预组卡组（默认：当前 catalog 中可得的官方预组，Claude 先给候选）。
4. 是否取消 RIFT-5。

# 新内核分层与数据流

## 1. 一句话概览

卡牌程序是静态 EffectIR 数据；原语通过 `ResolveContext.perform()` 提交**游戏动作**，
动作经**事件管线**提交为事件并扫描**时点触发**，触发与打出的能力一律进**链**，
由 HOT FEPR 排序后在链的 Resolve 阶段交给**解释器**，解释器再按顺序调用已经注册的
**原语**。原语不推进回合、不传递优先权、不直接改状态。

```text
CardProgram (EffectIR)
  -> ChainEngine.commit()/execute()
    -> EventPipeline: GameAction
         -> Replacement / Prevention
         -> Commit event
         -> Trigger scan (TimingPoint + TriggerSpec)
         -> Pending chain item
    -> HOT FEPR: Handle Tasks -> Finalize -> Execute -> Pass -> Resolve
    -> Interpreter: runAbilityBody()
         -> ResolveContext.perform(action)  (回到管线)
```

这段流程的契约定义在 `docs/plans/2026-10-15-p0-contract.md` 第 3.5 节（四个交互
抽象）与第 3.6 节（原语接口 v1）。语义规范在
`docs/rule-engine-architecture.md`（HOT FEPR、费用、TargetPlan、事件与替代）。

## 2. 分层与目录

下表不带 `packages/` 前缀的路径相对 `packages/engine-core/src/`；
带包前缀的路径（`packages/card-dsl/...`）相对仓库根目录：

| 层 | 目录 / 文件 | 职责 |
| --- | --- | --- |
| 契约类型 | `effects/contract.ts` | `ResolveContext`、`ObjectSnapshot`、`GameAction`、`ObjectRef` |
| 状态与区域 | `state/`、`zones/` | 对象身份（`id` + `zoneEntryId`）、区域迁移、永久状态 |
| 回合 | `turn/flow.ts`、`turn/phase-layers.ts` | 阶段次序、各开始/结束时点、Draw/Channel/Awaken |
| 优先权与焦点 | `chain/engine.ts` 内的 `priority` / `focus` / `canAct()` | Turn State、Priority、Focus；`priority-focus/index.ts` 目前是空占位 |
| 链 | `chain/engine.ts`、`chain/interpreter-adapter.ts` | Pending/Finalized、HOT FEPR、Finalize/Resolve 事务 |
| 事件管线 | `events/pipeline.ts`、`events/pipeline-types.ts` | 替代效果、事件提交、触发扫描、快照 |
| 时点 | `events/timing-points.ts` | 封闭的 `TimingPointId` 枚举与规则来源 |
| 触发规格 | `events/trigger-spec.ts` | `TriggerSpec`（`at` + `filter` + `condition` + `once`） |
| 动作适配 | `events/action-adapter.ts` | `PipelineHost` 绑定为 `ResolveContext` |
| 原语 | `effects/instructions/<op>.ts` | 每个 `InstructionDef` 一个文件，默认导出 |
| 解释器 | `effects/interpreter.ts` | `runAbilityBody()`，执行 `Instruction[]` 并处理链接/条件/重复 |
| 测试内核 | `effects/testing/` | `world()`、`runInstruction()` 参考实现 |
| 关键词 | `effects/keywords/<Keyword>.ts` | `KeywordDef`，只展开为 `Ability[]`，不写流程 |
| 费用 | `cost/` | 费用计划、支付回执、分配 |
| 目标 | `target/target-plan.ts` | Finalize 锁定、Resolve 重验、目标税 |
| 图层 | `layers/` | copy → trait → ability → arithmetic 的持续效果 |
| 战斗 / 计分 | `combat/`、`scoring/` | 伤害分配、Conquer / Hold / Final Point（分层建设中，旧实现仍在 `duel/`） |
| 卡牌数据 | `packages/card-dsl/src/cards/<set>/<slug>.ts` | 每张 canonical 卡一个 `CardProgram` |

## 3. 数据流细节

### 3.1 游戏动作只从原语来

`ResolveContext.perform(action)` 是唯一的状态写入口（`effects/contract.ts`）。
动作在提交前先经替代效果处理：替代可以改写动作、替换为多个动作或完全阻止。
返回的 `ActionOutcome` 状态为 `done | replaced | prevented | impossible`。

原语映射结果的规则（契约 3.6「原语规则」）：

- 任一 `perform` 为 replaced / prevented / impossible → 指令 `negated`，
  后续通过 `linkedTo` 依赖它的指令仍尽可能执行。
- 目标的 `ObjectRef` 全部失效 → 指令 `ignored`（`mistargeted`），
  后续链接指令也 `ignored`。

`effect.draw` 是一个可对照的完整例子：`packages/engine-core/src/effects/instructions/effect.draw.ts`
的注释逐条列出 CR v1.5 依据（414、355、359.3.e 等），执行体只提交
`{ type: "draw" }`，Burn Out 与隐私投影留给内核。

### 3.2 事件、时点与触发

管线实现 `EventPipeline`（`events/pipeline.ts`），宿主实现 `PipelineHost`
（`events/pipeline-types.ts`）。宿主负责 `checkpoint()/restore()`、真正执行动作、
提供 `ResolveContext` 与 `choose()`；管线负责事件 id、时点发出、触发匹配、
注册快照（来源、控制者、地点、特征）与 once 频率。

触发写入链项后，由 `chain/engine.ts` 的 HOT FEPR 统一处理。链层 README
（`packages/engine-core/src/chain/README.md`）记录了已实现语义与边界，例如：
最旧 Pending 先 Finalize、最新 Finalized 先 Resolve；清理阻塞 Finalize/Resolve/
Priority/Focus；全员连续 Pass 才结算；新项加入后重置连续 Pass。

### 3.3 链

`ChainEngine`（`chain/engine.ts`）区分三类入口：

- `execute(draft)`：拥有 Priority 的自由动作。
- `enqueue()`：规则生成的触发能力。
- `commit(action)`：原语 `perform` 的实现基础（替代 → 选序 → 执行 → 提交事件 → 扫描触发）。

Finalize 阶段完成打牌流程、费用支付、目标与模式选择；Unit / Gear / Add 在 Finalize
和必要清理后立即进入 Resolve。目标计划 `TargetPlan` 在 Finalize 锁定，
Resolve 重验引用身份与过滤器。

### 3.4 解释器与原语

`runAbilityBody(body, context, registry?)` 同步执行 `Instruction[]`，默认注册表是
`effects/instructions/registry.generated.ts`（由脚本生成，不手改）。
它负责控制结构（`sequence`、`repeat`、三种 `choice.*`）、条件作用范围、
链接值、`ObjectSelector` 绑定以及 ignored / negated 传播。

遇到需要玩家决定的位置会抛出 `AwaitChoice`；调用者必须回滚并带回放整个 body。
解释器的详细规则见 `packages/engine-core/src/effects/interpreter/README.md`。

### 3.5 关键词

关键词不参与主循环，只在装配卡牌程序时把自身展开成 `Ability[]`（触发 / 静态 /
启动 / 替代 / 打出改写）。展开结果必须能通过 `validateCardProgram`。
接口定义在 `packages/engine-core/src/effects/keyword-contract.ts`，
契约见 `docs/plans/2026-10-15-p0-contract.md` 第 3.7 节。

接线现状（待确认后续任务）：截至本页撰写时，`keywordDefinitionsById` 只在
`packages/engine-core/test/effects/keywords/` 的测试中被消费，
`packages/engine-core/src` 与 `apps/` 里还没有把卡牌 `{ kind: "keyword" }`
声明展开为 `Ability[]` 的生产装配路径；关键词展开到位不自动等于整卡可执行。

### 3.6 卡牌程序

`packages/card-dsl/src/cards/<set>/<slug>.ts` 是纯数据：`canonicalCardId`、
`rulesetVersion: "core-1.5"`、`status`、`abilities`、`sourceText`。
IR 中出现的对象位置一律用符号 `ObjectSelector`
（`"self" | "source" | { target } | { pick } | { linked }`）；
运行时 `ObjectRef { id, zoneEntryId }` 只存在于 `ResolveContext` 与原语内部。

## 4. 与旧实现的关系

`packages/engine-core/src/duel/` 与 `packages/engine-core/src/full-product/`
是历史实现，生产服务器当前仍在旧路径上。
新内核（`packages/engine-core/src/chain/`、`turn/`、`events/`、`layers/`、
`cost/`、`target/`）的 README 明确写了「未接入
game-server」「不切换旧 runtime/profile/journal」。新增原语、关键词、卡牌程序
都面向新内核契约，不要复制 duel 的运行时代码。

## 5. 相关文档

- 契约：`docs/plans/2026-10-15-p0-contract.md`
- 语义规范：`docs/rule-engine-architecture.md`
- 测试矩阵：`docs/test-matrix.md`
- 进度与门禁：`docs/full-product/progress.md`

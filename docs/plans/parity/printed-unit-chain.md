# Batch E parity: printed Unit Chain services

本文件记录 `apps/game-server/src/duel/printed-unit-chain-services-p8.ts` 的退役前置条件，以及新内核对旧服务可观察轨迹的对照范围。旧服务的直接回归仍保留在：

- `apps/game-server/tests/duel/printed-unit-chain-services-p8.test.ts`
- `apps/game-server/tests/duel/printed-unit-chain-resolved-history.test.ts`
- `apps/game-server/tests/duel/optional-unit-physical-chain-p8.test.ts`

对照测试位于 `apps/game-server/tests/parity/printed-unit-chain/printed-unit-chain.parity.test.ts`。

## 旧服务处理的卡牌与命令序列

旧服务的真实卡牌输入是两个 Fury Accelerate 印刷：`ogn-001-298`（Blazing Scorcher，打印费用 5 Energy）和 `ogn-010-298`（Legion Rearguard，打印费用 2 Energy）。旧服务要求来源先是玩家手牌中的原始 Unit printing，再由物理 UID 移入 Chain；来源 epoch、catalog stamp、program fingerprint、当前 command session 和 native operation journal 都必须保持同一条 lineage。

| 场景 | 旧命令序列 | 旧服务可观察结果 | 新内核 parity 状态 |
| --- | --- | --- | --- |
| 手牌来源与程序绑定 | `play-card`/`begin` → `choice.readSource`/`program` | 真实 UID 从 Hand 到 Chain；epoch 增加；外来、克隆或错误 epoch 返回 unknown/抛 stale | `test.todo`：真实 CardProgram 仍是 `judge-required` |
| 选择前后的来源证明 | `begin` → `answer-pending-choice`；再用同 clock sibling 读取来源 | 只接受实际 V4 choice head；sibling、foreign head 和缺失 attempt proof 被拒绝 | `test.todo`：generic play adapter 尚未消费物理 UID/choice proof |
| 未观测 native Chain | `begin` → `inspectClosure`/`entry` | closure 为 pending，entry 的 source census 为 unknown，不创建 payment task | `test.todo`：generic kernel 没有 server journal closure contract |
| 已观测 native Chain | `begin` → journal `observe`/`bindContext` → `answer-pending-choice(pay)` | closure ready；全部 source 为 object/live；接受后只产生一个 required payment task | `test.todo`：generic kernel 没有该 journal/source-attestation seam |
| stale payment attestation | `sourceAttestorV4` 或 `pay-pending` 使用错误 task/proof/head | 拒绝 payment source；不移动区域、不生成 receipt | `test.todo`：V4 proof lineage 尚未接入 generic command path |
| 物理拒绝 Accelerate | `play-card` → 选择“不支付” → 支付 2 Energy → `pay-pending` → `resume` | 单位进入己方 Base，`readied=false`，Chain 关闭 | `test.todo`：`ogn-010-298` CardProgram 仍为 `judge-required`；原语结果已在 parity smoke test 覆盖 |
| 物理支付 Accelerate | `play-card` → 选择“支付” → 3 次 `rune-energy` → 1 次 Fury `rune-power` → `pay-pending` → `resume` | 总费用 `{energy:3,power:[Fury]}`；单位进入己方 Base，`readied=true`；Chain 关闭 | `test.todo`：同上，且 generic kernel 尚未从 keyword 自动生成 optional additional |
| 已解析 pre-exit 历史 | 先把两个 Hand source 通过 native `pre-exit` 移入 Trash，再 `begin` → 拒绝 Accelerate → 支付 2 Energy → `resume` | 只有完整且按 commit 顺序见证的历史才计入 census；单位进入 Base 且 exhausted | `test.todo`：CardProgram 与 resolved-history bridge 均缺失 |
| 额外 source work | 在 resolved census 后注册 object source work，再回答选择 | blocked；不创建 payment task | `test.todo`：generic kernel 没有 operation-journal source-work ledger |
| 错误 pre-exit 标签 | pre-exit commit 的 transition 不从 play 离开 | blocked，reason 为 `cost-or-payment-unproved` | `test.todo`：同上 |
| 历史 P8 回放 | 关闭 `allowResolvedPreExitCostHistory`，重放同一选择 | historical replay 保持 blocked；旧日志不升级 | `test.todo`：必须先有旧 profile replay gate 与新内核双读对照 |

## 新内核已确认的原语结果

parity smoke test 通过 `ChainEngine`、事件管线和 cost plan 执行同一张 `ogn-010-298` 的基础 Unit play primitive，并分别选择 Accelerate：

- 支付：单位从 Hand 经 Chain 进入己方 Base，费用计划包含打印的 2 Energy 与 Accelerate 的 1 Energy + Fury Power 要求，最终 `exhausted=false`；事件顺序包含 `object-enters-chain`、`chain-item-finalize`、`object-enters-board`、`object-enters-base`、`card-played`、`chain-item-resolve`。
- 拒绝：单位从 Hand 经 Chain 进入己方 Base，费用计划只有打印的 2 Energy，最终 `exhausted=true`；事件种类和顺序相同。

该 parity smoke 使用 engine-core 的 reference test kernel；它把领域 Power 作为可用域输入，不暴露服务器 Rune Pool 的逐个 Rune 扣减。因此 smoke 只证明新内核原语的区域、Energy、Power 约束和就绪语义，真实 Rune 支付仍由上表的服务器命令序列 gate 覆盖。完整 parity 仍必须执行上表中的真实服务器命令序列，并比较事件种类/顺序、区域、计分、费用和重放结果。

## CR v1.5 判定依据

- **805.1、805.1.a、805.1.b**：Accelerate 是单位上的可选附加费用；支付 `[1][C]` 后该单位就绪进场。
- **805.1.b.1、805.1.b.2**：有域单位的 Power 必须匹配自身域；无域单位才可用 `[A]`。
- **805.2、805.2.a、805.2.b**：费用只能在打出单位的步骤支付；支付后产生延迟替代，即使最终化期间失去关键词也仍然生效。
- **805.6、805.6.a**：替代的是“横置进场”为“就绪进场”，不会先横置再 ready，也不触发“成为就绪”能力。
- **356.1.b.3、356.2、357.1**：忽略基础费用不移除后续 optional additional；总费用在支付步骤合并支付 Energy 与 Power。
- **369.3**：单位入场方式的替代效果直接替代进入事件。

## `printed-unit-chain-services-p8.ts` 可删除的前置条件

1. `ogn-001-298` 和 `ogn-010-298` 的通用 `CardProgram` 状态改为 `executable`，并由 `createProgramBinding` 在 play finalize 时自动产生 Accelerate optional additional 与 805.6 replacement；不得依赖服务端白名单或手写语义。
2. 新内核提供物理打印 UID 的 Hand → Chain → Board 生命周期，保留 zone epoch、owner/controller、card identity 和命令版本检查。
3. 新内核提供等价的 optional choice、资源支付步骤和 `pay-pending`/resume 命令投影；支付与拒绝都能产生旧服务同序的事件、区域和 `readied` 结果。
4. 新内核提供 operation-journal/native closure 的等价证明：完整 source census、pre-exit transition、source-work ledger、program/catalog stamp、task/continuation/payment lineage 都能被验证；缺证据时必须保持 pending/blocked。
5. 新内核完成 stale/sibling/foreign head 拒绝，并在重连、重复命令和错误 actor 下保持相同 ACK/状态版本行为。
6. `allowResolvedPreExitCostHistory` 对已存在的 P8 replay 继续保持默认关闭；旧 1–9 profile 与旧日志必须严格重放，不能通过升级 schema 或改写日志达成 parity。
7. parity 测试表中所有场景从 `test.todo` 替换为真实新内核执行，并比较事件种类及顺序、区域、计分、费用、就绪状态和 replay journal；game-server 与 integration-tests 全量回归保持基线不下降。
8. 完成上述条件后，先切换 authoritative runtime 到新内核路径，再删除 `printed-unit-chain-services-p8.ts` 及其仅服务于该 seam 的注册/适配代码；删除动作由父任务统一协调。

当前契约变更请求：无。现有 generic CardProgram → optional-cost/replacement、physical source proof、native journal closure 接口不足以完成真实命令序列 parity，因此本批只新增对照测试和退役清单，不修改契约、卡牌程序或引擎。

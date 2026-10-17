# chain 规则 golden（RIFT-621）

把 `docs/rules/scenarios/chain.yaml` 中**新内核已能执行**的场景转成规则 golden。
文件名按规则条目号（契约第 5 节），测试标题含场景 id。

被测对象只有新层：`src/effects/testing/` 参考内核、`src/events/`（含 `producers/`）、
`src/chain/`、`src/cost/`、`src/target/`、`src/layers/`、`src/turn/`。
`src/duel/` 从不作为被测对象（本目录没有任何 `duel` 导入）。

- `support.mjs`：`world`（RIFT-46 参考内核）→ `EventPipeline` → `ChainEngine` 的真实接线，
  以及 305/335 场景用的 `TurnFlow`。清理钩子提交真实的普通 `kill` 动作（323.4），
  不手改伤害、区域或资源。
- `commit` 加入链项的场景用 `settle()` 推进 FEPR（advance + 连续 Pass）；只用 `execute` 的场景
  用 `resolveAll()`/`settle()` 连续 Pass；两者都不手工弹出链项。

## 与既有覆盖的关系

本章 35/36 个场景在 `packages/engine-core/test/chain/`（RIFT-120 的 `chain-scenarios.test.mjs`、
`adapters.test.mjs`、`priority-scenarios.test.mjs`）已有同名测试；本目录按契约第 5 节的
条目号命名口径补齐章节 golden，并在若干场景给出更严格的执行断言（完整事件序列、完整 LIFO 轨迹、
`stages` 全序列、`Priority` 授予轨迹）。两处都真实执行同一内核。

## 场景对照（36/36 已登记：35 执行 / 1 todo）

| 场景 id | 状态 | 测试 |
| --- | --- | --- |
| chain-spell-lifecycle-pending-finalize-resolve | 执行 | `329.1-329.3-359.3.a-spell-lifecycle.test.mjs` |
| chain-play-creates-closed-state | 执行 | `331.1-354.1-play-creates-closed-state.test.mjs` |
| chain-unit-gear-resolve-immediately-on-finalize | 执行 | `337.2-unit-gear-resolve-on-finalize.test.mjs` |
| chain-add-ability-resolves-immediately | 执行 | `430.2-add-ability-resolves-immediately.test.mjs` |
| chain-lifo-resolution-order | 执行 | `340.1-lifo-resolution-order.test.mjs` |
| chain-pass-not-resolve-if-item-added | 执行 | `339.2-pass-reset-when-item-added.test.mjs` |
| chain-reaction-added-restarts-finalize | 执行 | `338.1.a.7-reaction-restarts-finalize.test.mjs` |
| chain-simultaneous-triggers-same-player-orders | 执行 | `383.3.d-simultaneous-triggers-same-player-orders.test.mjs` |
| chain-simultaneous-triggers-turn-order | 执行 | `303.2.a-simultaneous-triggers-turn-order.test.mjs` |
| chain-chronobreak-multiplayer-turn-order | todo | `303.2.a-chronobreak-multiplayer-turn-order.test.mjs`（缺可变附加费 X、放逐前位置、逐拥有者 effect.play-back 与 ignore-cost；卡程序 judge-required） |
| chain-trigger-added-during-closed-state | 执行 | `383.3.c-trigger-added-during-closed-state.test.mjs` |
| chain-optional-trigger-declined-removed | 执行 | `403.1.a-optional-trigger-declined.test.mjs` |
| chain-trigger-no-legal-options-removed | 执行 | `403.4-trigger-no-legal-options-removed.test.mjs` |
| chain-trigger-cost-declined-not-countered | 执行 | `405.2-trigger-cost-declined.test.mjs` |
| chain-action-spell-rejected-in-closed | 执行 | `331.1.a-action-spell-rejected-in-closed.test.mjs` |
| chain-reaction-spell-allowed-in-closed | 执行 | `309.1.a-reaction-spell-allowed-in-closed.test.mjs` |
| chain-conditional-reaction-checked-at-legality | 执行 | `813.4-conditional-reaction-checked-at-legality.test.mjs` |
| chain-non-action-rejected-in-showdown-open | 执行 | `308.1.a-non-action-rejected-in-showdown-open.test.mjs` |
| chain-action-spell-allowed-in-showdown-open | 执行 | `308.1.a-action-spell-allowed-in-showdown-open.test.mjs` |
| chain-non-turn-player-priority-in-closed | 执行 | `312.2.d-non-turn-player-priority-in-closed.test.mjs` |
| chain-priority-after-resolve-newest-controller | 执行 | `340.4-priority-after-resolve-newest-controller.test.mjs` |
| chain-phase-advances-when-no-actions | 执行 | `305-335-phase-advances-when-no-actions.test.mjs` |
| chain-countered-spell-not-played-no-refund | 执行 | `426.1-countered-spell-not-played-no-refund.test.mjs` |
| chain-pending-item-not-targetable | 执行 | `355.9.a.2-pending-item-not-targetable.test.mjs` |
| chain-cost-cannot-pay-finalize-fails | 执行 | `358.2-cost-not-payable-finalize-fails.test.mjs` |
| chain-conditional-reaction-lost-before-legality | 执行（沿用既有） | `test/chain/adapters.test.mjs` 同名测试；本章未重复 |
| chain-no-cleanup-during-resolution | 执行 | `321-321.1-323.4-no-cleanup-during-resolution.test.mjs` |
| chain-cleanup-after-transitions-and-chain-events | 执行 | `319-cleanup-after-transitions.test.mjs` |
| chain-cleanup-fixed-point | 执行 | `322-cleanup-fixed-point.test.mjs` |
| chain-focus-passes-after-showdown-chain | 执行 | `346-340.2.a-focus-passes-after-showdown-chain.test.mjs` |
| chain-focus-not-passed-after-trigger-opened-chain | 执行 | `346.1-focus-not-passed-after-trigger-opened-chain.test.mjs` |
| chain-play-effects-after-unit-boarded | 执行 | `383.4.a.2-play-effects-after-unit-boarded.test.mjs` |
| chain-accelerate-paid-enters-ready | 执行 | `369.3-accelerate-paid-enters-ready.test.mjs` |
| chain-multiple-pending-finalized-oldest-first | 执行 | `337.1-multiple-pending-finalized-oldest-first.test.mjs` |
| chain-reflexive-trigger-added-during-resolution | todo | `388.1-389.1-reflexive-trigger-added-during-resolution.test.mjs`（缺 `trigger.reflexive`：42 个已注册 op 中不存在，解释器抛 Unregistered instruction opcode） |
| chain-finalize-does-not-pass-priority | 执行 | `337.1.a-finalize-does-not-pass-priority.test.mjs` |

## 与场景规格的差异（以 CR v1.5 原文为准）

1. `chain-finalize-does-not-pass-priority` 的 YAML 让对手 B 在“打出触发仍 Pending”时尝试响应，
   期望 `no-priority` 拒绝；合入内核在存在 Pending 项时 `canAct` 对任何速度都为 false（312.2.c），
   因此本章用真实 FEPR 断言“两项 Finalize 之间没有 priority-granted”，语义同一，不伪造拒绝回执。
2. `chain-cleanup-after-transitions-and-chain-events` 的 YAML 期望 `cleanup.performed` 事件带
   `reason: item-pending / item-finalized / item-removed / state-opened`；冻结枚举只发
   `cleanup-start`/`cleanup-end`，请求原因记在 `ChainEngine.trace` 的 `cleanup-requested` 上
   （RIFT-120 已登记的差异）。本章按该口径断言，不发明时点名，也不把 `state-opened` 当成已存在时点。
3. `chain-conditional-reaction-lost-before-legality` 的 notes 提到 813.4.b；813.4.b 原文只规定
   “到第 5 步 Check Legality 时条件不成立则回滚”，没有给出“Finalize 流程中途条件被改变”的官方示例。
   既有 `test/chain/adapters.test.mjs` 的清理钩子在 Finalize 前令条件失效并断言抛错、链上只留 1 项，
   与 813.4.b/358.5 一致；本章不重复，也不把该 SCENARIO 的反向分支当已覆盖。
4. `chain-chronobreak-multiplayer-turn-order` 的 sources 引官方 Radiance patch notes 的 Chronobreak 条目；
   该条目不在 CR v1.5 正文内（本机规则原文到 806），因此按卡程序与 patch notes 的双重缺口登记 todo，
   不近似实现。

## 契约变更请求（未修改契约）

1. 定义从结算指令创建 Reflexive Trigger Pending 项的指令（388.1/389.1），并在链上区分它与
   真实事件触发的项；`chain-reflexive-trigger-added-during-resolution` 与 `triggers-reflexive-*` 都等它。
2. 定义可变数额附加费（`any amount`，135.2.b.5 / 204.2.a）在 CostPlan 中的表示，以及把已支付的 X
   绑定给结算指令的接口；`chain-chronobreak-multiplayer-turn-order` 等卡依赖它。
3. 定义“由游戏效果打出（420.3）”的逐对象生命周期：逐对象选择者（拥有者）与目的地、
   忽略费用的改写（356.1.b.1）、以及放逐前的原位置快照；现有 `effect.play` 只接受单一玩家、
   单一地点与已 Finalize 的费用计划。

## 运行

```
pnpm --filter @riftbound/engine-core build
node --test 'packages/engine-core/test/rules/chain/*.test.mjs'
```

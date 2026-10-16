# movement 规则 golden（RIFT-276）

把 `docs/rules/scenarios/movement.yaml` 中**新内核已能执行**的场景转成规则 golden。
被测对象只有新层：`src/effects/testing/` 参考内核、`src/events/`、`src/chain/`、
`src/turn/`、`src/zones/`。`src/duel/` 只在 `zones/movement.ts` 仍然消费 `DuelBoard` 的地方
作为 `given` 的局面构造器使用（与 `test/zones/standard-move.test.mjs` 同一口径），从不作为被测对象。

- `support.mjs`：TurnFlow → ChainEngine → EventPipeline → interpreter → primitives 的真实接线，
  以及 zones 层 Standard Move 的两个夹具（`duelWorld()` / `readinessFor()`）。
- 执行路径测试断言真实事件序列与状态；未合入的机制写 `test.todo`，标题写明缺哪个模块 / op / 时点。
- 场景 id 对照见本文件表格；timing 名称按 `events/timing-points.ts` 冻结枚举校准
  （如 `move.performed` → `object-moved`、`battlefield.contested` → `contested-applied`）。

## 场景对照（47/47 已登记：34 执行 / 13 todo）

| 场景 id | 状态 | 测试 |
| --- | --- | --- |
| movement-standard-move-base-to-battlefield | 执行 | `144-standard-move-base-to-battlefield.test.mjs` |
| movement-standard-move-battlefield-to-base | 执行 | `144.4-standard-move-battlefield-to-base.test.mjs` |
| movement-standard-move-multi-unit-same-destination | 执行 | `144.3-standard-move-multi-unit-group.test.mjs` |
| movement-standard-move-multi-unit-different-destinations-rejected | 执行 | `144.3-standard-move-single-destination-required.test.mjs` |
| movement-standard-move-exhausted-unit-rejected | 执行 | `144.2-standard-move-exhausted-unit-rejected.test.mjs` |
| movement-standard-move-not-your-turn-rejected | 执行 | `144.1-standard-move-not-your-turn-rejected.test.mjs` |
| movement-standard-move-during-closed-state-rejected | 执行 | `144.1-standard-move-closed-state-rejected.test.mjs` |
| movement-standard-move-during-showdown-rejected | 执行 | `144.1-standard-move-during-showdown-rejected.test.mjs` |
| movement-standard-move-battlefield-to-battlefield-rejected | 执行 | `144.4-standard-move-ganking-required.test.mjs` |
| movement-is-instantaneous-no-chain-no-reaction | 执行 | `448.3-move-is-instantaneous.test.mjs` |
| movement-zone-change-is-not-a-move | 执行 | `448.2-zone-change-is-not-a-move.test.mjs` |
| movement-trigger-fires-on-effect-move | 执行 | `451-move-trigger-fires-on-effect-move.test.mjs` |
| movement-control-kept-while-units-present | 执行 | `190.4-control-kept-while-units-present.test.mjs` |
| movement-control-lost-after-last-unit-leaves | 执行 | `190.4-control-lost-after-last-unit-leaves.test.mjs` |
| movement-control-preserved-during-ongoing-showdown | 执行（改写 given） | `190.4-control-preserved-during-showdown.test.mjs` |
| movement-contested-applied-on-enter-enemy-battlefield | 执行（部分断言） | `452-contested-applied-on-enter-enemy-battlefield.test.mjs` |
| movement-no-contested-on-own-battlefield | 执行 | `452-no-contested-on-own-battlefield.test.mjs` |
| movement-no-double-contested | 执行 | `190.3-no-double-contested.test.mjs` |
| movement-contested-on-controller-change | 执行 | `190.3-contested-on-controller-change.test.mjs` |
| movement-move-to-empty-battlefield-opens-noncombat-showdown | 执行 | `344.2-move-to-empty-battlefield-opens-showdown.test.mjs` |
| movement-move-onto-enemy-occupied-stages-combat | 执行（部分断言） | `462-combat-staged-when-opposing-units-meet.test.mjs` |
| movement-contested-removed-when-applier-leaves | 执行（部分断言） | `190.3-contested-removed-when-applier-leaves.test.mjs` |
| movement-staged-combat-canceled-when-opponent-units-gone | 执行 | `323.9-staged-combat-canceled.test.mjs` |
| movement-turn-player-chooses-staged-combat-order | todo | `463.1-turn-player-chooses-staged-combat-order.test.mjs` |
| movement-recall-is-not-a-move | todo | `448.1-recall-is-not-a-move.test.mjs` |
| movement-recall-bypasses-move-restriction | todo | `458.3-recall-bypasses-move-restriction.test.mjs` |
| movement-recall-preserves-damage-and-exhaustion | todo | `460.1-recall-preserves-damage-and-exhaustion.test.mjs` |
| movement-illegal-effect-move-becomes-recall | todo | `449.2-illegal-effect-move-becomes-recall.test.mjs` |
| movement-move-restriction-blocks-standard-move | todo | `054.1-move-restriction-blocks-standard-move.test.mjs` |
| movement-gear-played-to-base-by-default | 执行 | `148.1-gear-played-to-base-by-default.test.mjs` |
| movement-gear-without-deploy-battlefield-rejected | todo | `148.1-gear-without-deploy-battlefield-rejected.test.mjs` |
| movement-deploy-gear-played-to-enemy-battlefield | 执行 | `830.1-deploy-gear-played-to-enemy-battlefield.test.mjs` |
| movement-deploy-gear-not-recalled-in-cleanup | 执行 | `830.1-deploy-gear-not-recalled-in-cleanup.test.mjs` |
| movement-nondeploy-gear-recalled-in-cleanup | todo | `459.1-nondeploy-gear-recalled-in-cleanup.test.mjs` |
| movement-deploy-gear-moved-by-effect | 执行 | `830.1-deploy-gear-moved-by-effect.test.mjs` |
| movement-deploy-gear-killed-when-opponent-holds | todo | `830.1-deploy-gear-killed-when-opponent-holds.test.mjs` |
| movement-unit-played-to-own-controlled-battlefield | 执行 | `355.2-unit-played-to-own-controlled-battlefield.test.mjs` |
| movement-unit-played-to-enemy-battlefield-rejected | todo | `355.2-unit-played-to-enemy-battlefield-rejected.test.mjs` |
| movement-conquer-after-noncombat-showdown | 执行 | `348.2-conquer-after-noncombat-showdown.test.mjs` |
| movement-conquer-only-once-per-battlefield-per-turn | 执行 | `472-conquer-only-once-per-battlefield-per-turn.test.mjs` |
| movement-cannot-move-third-party-into-staged-combat | todo | `449.2-cannot-move-third-party-into-staged-combat.test.mjs` |
| movement-cannot-move-into-battlefield-with-two-other-players | todo | `451.2-cannot-move-into-battlefield-with-two-other-players.test.mjs` |
| movement-ganking-battlefield-to-battlefield | 执行 | `810.1-ganking-battlefield-to-battlefield.test.mjs` |
| movement-here-reassigned-after-unit-moved | todo | `448.3-here-reassigned-after-unit-moved.test.mjs` |
| movement-effect-move-between-battlefields-allowed | 执行 | `451-effect-move-between-battlefields-allowed.test.mjs` |
| movement-effect-move-does-not-exhaust | 执行 | `451-effect-move-does-not-exhaust.test.mjs` |
| movement-standard-move-during-enemy-showdown-unaffected | 执行 | `343.1-standard-move-during-enemy-showdown-unaffected.test.mjs` |

“执行（部分断言）”＝该场景的一部分期望属于尚未合入的机制（见测试文件头部注释列出的缺口），
已合入部分按真实执行断言，未合入部分不写近似实现。

## 与场景规格的差异（以 CR v1.5 原文为准）

1. `movement-control-preserved-during-ongoing-showdown`：YAML 的 `given` 写 bf1 `controller: A`
   同时被 A 争夺，与 190.3.a/452（施加争夺的前提是**不**控制该战场）冲突；测试改为
   B 控制 bf1、回合玩家 A 施加争夺的等价合法局面，断言的规则结论不变（190.4.b 冻结控制权、
   190.3.b.1 因 Showdown 进行中而不移除争夺）。
2. `movement-contested-removed-when-applier-leaves`：CR 190.3.b.1/323.10 要求清理移除争夺，
   但冻结枚举里没有争夺专用的时点；新内核也不发 `contested-removed`（`CombatFlow.cleanup()`
   的 323.10 分支静默）。测试断言可观察状态（`contestedBy: null`、`staged: none`、控制权不变）。
3. `movement-move-onto-enemy-occupied-stages-combat`：`combat.attack-declared` /
   `combat.staged` 需要 Combat 开始的原子时点波（`combat-start-transaction`），尚未合入；
   测试断言 Move → Contested（含 466.2.c.1 的攻击方来源）→ Cleanup → staged Combat。
4. `movement-standard-move-during-enemy-showdown-unaffected`：`grep` 显示内核在 Showdown/Combat
   进行中先报 `active Showdown or Combat`，因此场景里的 A 也会命中 144.1.c（本测试同时覆盖
   回合玩家 B 持有 Priority 的情形）。
5. 场景 notes 里的 `battlefields.bf1.contested` 布尔在冻结实现中表现为 `contestedBy`；
   `scoredThisTurn` 表现为 `TurnFlow.scored(player)` 的每回合账本（472）。

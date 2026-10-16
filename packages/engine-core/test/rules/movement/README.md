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

## 场景对照（47/47 已登记：32 仅执行 / 13 仅 todo / 2 执行 + todo）

共 34 个执行用例、15 个 `test.todo`。有完整执行缺口的两个场景保留已合入部分的
真实测试，并另写 todo；不会把局部断言当成完整场景通过。

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
| movement-control-preserved-during-ongoing-showdown | 执行 + todo（仅覆盖非战斗 Showdown 争夺保留；控制权冻结缺 Combat 开始） | `190.4-control-preserved-during-showdown.test.mjs` |
| movement-contested-applied-on-enter-enemy-battlefield | 执行（部分断言） | `452-contested-applied-on-enter-enemy-battlefield.test.mjs` |
| movement-no-contested-on-own-battlefield | 执行 | `452-no-contested-on-own-battlefield.test.mjs` |
| movement-no-double-contested | 执行 | `190.3-no-double-contested.test.mjs` |
| movement-contested-on-controller-change | 执行 | `190.3-contested-on-controller-change.test.mjs` |
| movement-move-to-empty-battlefield-opens-noncombat-showdown | 执行 | `344.2-move-to-empty-battlefield-opens-showdown.test.mjs` |
| movement-move-onto-enemy-occupied-stages-combat | 执行 + todo（已验证挂起；开启及攻守身份缺原子 Combat 开始） | `462-combat-staged-when-opposing-units-meet.test.mjs` |
| movement-contested-removed-when-applier-leaves | 执行（部分断言） | `190.3-contested-removed-when-applier-leaves.test.mjs` |
| movement-staged-combat-canceled-when-opponent-units-gone | 执行 | `323.9-staged-combat-canceled.test.mjs` |
| movement-turn-player-chooses-staged-combat-order | todo：选序后开启 Combat 缺原子时点及攻守身份事务 | `463.1-turn-player-chooses-staged-combat-order.test.mjs` |
| movement-recall-is-not-a-move | todo：缺独立 Recall 动作及其时点 | `448.1-recall-is-not-a-move.test.mjs` |
| movement-recall-bypasses-move-restriction | todo：缺 Recall 与 continuous.movement 限制消费 | `458.3-recall-bypasses-move-restriction.test.mjs` |
| movement-recall-preserves-damage-and-exhaustion | todo：缺保持身份的 Recall 动作 | `460.1-recall-preserves-damage-and-exhaustion.test.mjs` |
| movement-illegal-effect-move-becomes-recall | todo：缺非法目的地重验及改为 Recall 的路径 | `449.2-illegal-effect-move-becomes-recall.test.mjs` |
| movement-move-restriction-blocks-standard-move | todo：zones 未消费 continuous.movement 限制 | `054.1-move-restriction-blocks-standard-move.test.mjs` |
| movement-gear-played-to-base-by-default | 执行 | `148.1-gear-played-to-base-by-default.test.mjs` |
| movement-gear-without-deploy-battlefield-rejected | todo：缺 Finalize 打出地点校验 / continuous.location 消费 | `148.1-gear-without-deploy-battlefield-rejected.test.mjs` |
| movement-deploy-gear-played-to-enemy-battlefield | 执行 | `830.1-deploy-gear-played-to-enemy-battlefield.test.mjs` |
| movement-deploy-gear-not-recalled-in-cleanup | 执行 | `830.1-deploy-gear-not-recalled-in-cleanup.test.mjs` |
| movement-nondeploy-gear-recalled-in-cleanup | todo：Cleanup 遇需 Recall 的装备仍 blocked | `459.1-nondeploy-gear-recalled-in-cleanup.test.mjs` |
| movement-deploy-gear-moved-by-effect | 执行 | `830.1-deploy-gear-moved-by-effect.test.mjs` |
| movement-deploy-gear-killed-when-opponent-holds | todo：缺 Deploy 触发注册及 hold/here 过滤器适配（Hold 已携带战场 id） | `830.1-deploy-gear-killed-when-opponent-holds.test.mjs` |
| movement-unit-played-to-own-controlled-battlefield | 执行 | `355.2-unit-played-to-own-controlled-battlefield.test.mjs` |
| movement-unit-played-to-enemy-battlefield-rejected | todo：缺 Finalize 打出地点校验 / continuous.location 消费 | `355.2-unit-played-to-enemy-battlefield-rejected.test.mjs` |
| movement-conquer-after-noncombat-showdown | 执行 | `348.2-conquer-after-noncombat-showdown.test.mjs` |
| movement-conquer-only-once-per-battlefield-per-turn | 执行 | `472-conquer-only-once-per-battlefield-per-turn.test.mjs` |
| movement-cannot-move-third-party-into-staged-combat | todo：新回合驱动 / zones 棋盘仅支持 1v1，缺多人目的地限制 | `449.2-cannot-move-third-party-into-staged-combat.test.mjs` |
| movement-cannot-move-into-battlefield-with-two-other-players | todo：缺多人棋盘及第三方目的地人数限制 | `451.2-cannot-move-into-battlefield-with-two-other-players.test.mjs` |
| movement-ganking-battlefield-to-battlefield | 执行 | `810.1-ganking-battlefield-to-battlefield.test.mjs` |
| movement-here-reassigned-after-unit-moved | todo：缺攻击触发产生方及 here 在 Resolve 时重读的目标锚点 | `448.3-here-reassigned-after-unit-moved.test.mjs` |
| movement-effect-move-between-battlefields-allowed | 执行 | `451-effect-move-between-battlefields-allowed.test.mjs` |
| movement-effect-move-does-not-exhaust | 执行 | `451-effect-move-does-not-exhaust.test.mjs` |
| movement-standard-move-during-enemy-showdown-unaffected | 执行 | `343.1-standard-move-during-enemy-showdown-unaffected.test.mjs` |

“执行（部分断言）”＝该场景的一部分期望属于尚未合入的机制（见测试文件头部注释列出的缺口），
已合入部分按真实执行断言，未合入部分不写近似实现。

## 与场景规格的差异（以 CR v1.5 原文为准）

1. `movement-control-preserved-during-ongoing-showdown` 的 YAML 没有指定 `contestedBy`；
   A 控制且 B 施加争夺完全合法（190.3.a/452），不能声称该 given 违反规则。
   双方单位共处的 Combat Showdown 需要未合入的原子 Combat 开始，完整控制权冻结
   （190.4.b）登记 todo。补充执行用例只验证 190.3.b.1：无控制者的非战斗 Showdown
   中争夺者单位离开后，争夺仍保留；不以此替代 YAML 的 A 控制权断言。
2. `movement-turn-player-chooses-staged-combat-order` 的两次独立标准移动不能制造同时挂起：
   首次移动后的清理会先开启 Combat（455/323.12/462），此时第二次标准移动违反 144.1.c。
   合法版本应在同一效果/链结算中令两处同时形成挂起战斗，再按 463.1 选择先后。
3. `movement-here-reassigned-after-unit-moved` 的 here 执行时重读依据是 359.3.f.2，
   不是 053.3（战场用 here 自称）；官方例子是 Yasuo 与 Fight or Flight，并非 notes 中的 Flash。
   YAML 中 u2 初始在基地，不满足最初战场上的 here 目标资格，且 u1 移到基地后反而与 u2
   同处；合法的失效目标例子需让 u2 最初位于原战场。todo 保留至攻击及 referent 管线合入。

## 当前 API 表达及覆盖边界（不属于规则差异）

1. `movement-contested-removed-when-applier-leaves`：CR 190.3.b.1/323.10 要求清理移除争夺，
   但冻结枚举里没有争夺专用的时点；新内核也不发 `contested-removed`（`CombatFlow.cleanup()`
   的 323.10 分支静默）。测试断言可观察状态（`contestedBy: null`、`staged: none`、控制权不变）。
2. `movement-move-onto-enemy-occupied-stages-combat`：`combat.attack-declared` /
   `combat.staged` 需要 Combat 开始的原子时点波（`combat-start-transaction`），尚未合入；
   测试断言 Move → Contested（含 466.2.c.1 的攻击方来源）→ Cleanup → staged Combat。
3. `movement-standard-move-during-enemy-showdown-unaffected`：144.1.c/343.1 的状态门禁
   全局生效，报 `active Showdown or Combat`；测试同时覆盖回合玩家 B 持有 Priority 的情形。
4. 场景 notes 里的 `battlefields.bf1.contested` 布尔在冻结实现中表现为 `contestedBy`；
   `scoredThisTurn` 表现为 `TurnFlow.scored(player)` 的每回合账本（472）。
5. Standard Move 使用 zones 公开 API 验证组移动事件、横置费用与原子拒绝。该叶子 API
   返回 `requiresMoveTriggers` / `requiresOpenCleanup`；不把返回的义务当成已执行的清理。
   `TurnFlow.move()` 仍缺 Exhaust + Move 原子事务。其余移动后清理、争夺、非战斗 Showdown
   与征服通过效果移动运行真实管线验证，不手工驱动旧 duel 清理作为结算。
6. 资源通过测试来源的正常启动能力获得并经双方 Pass 结算，不伪造规则生成的 Add 能力；
   战斗取消用例让反应移动先结算、下层移走防守方的能力仍留在链上，先断言真实 `staged: combat`，
   再继续结算并验证清理取消挂起、开启非战斗 Showdown（323.9/463.2）。

## 契约变更请求（未修改契约）

1. 定义保留对象身份、伤害和横置状态的 Recall 游戏动作及对应事件；普通 Move 不能代替。
2. 定义可整体回滚的原子规则任务接口，支持 Standard Move 的 Exhaust + Move、同时 Combat /
   Showdown 开始与攻守指定，供 TurnFlow 及 CombatFlow 消费。
3. 定义关键词 IR 到冻结 TriggerSpec 的 here / 事件名称适配，以及指令结算时 referent 重新求值的
   接口；Deploy 的 Hold 事件本身已经有 `details.battlefieldId`，缺的是宿主相对地点的消费。

continuous.movement / continuous.location 的执行端校验与多人棋盘属于已有语义的实现缺口，
本任务仅登记 todo，不在测试夹具中补做这些规则。

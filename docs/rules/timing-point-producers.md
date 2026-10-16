# v1.5 时点产生方审计

本表审计 `packages/engine-core/src/events/timing-points.ts` 的 81 个时点。`已有` 表示当前新管线已经在指定位置产生；`本任务新增` 表示新增的纯派生产生器，调用方应在成功动作取得 before/after 快照后把结果追加到 `ActionExecution.emissions`；`待后续` 表示产生时点需要 Turn/Combat 内部事务、或当前动作契约没有足够证据，因此保持 judge-required/blocked。

区域别名由 [action-adapter.ts](../../packages/engine-core/src/events/action-adapter.ts) 的 `zoneTimings`（37–46 行）产生：每次换 incarnation 先产生 `object-leaves-*`，再产生 `object-enters-*`；同一物理换区共享对象 id 的 simultaneous group。新产生器中的区域实现与该规则保持一致，便于父任务把它接入统一扩展点。

| 时点 | 产生方（文件:行） | 状态 | 说明 / 测试 |
|---|---|---|---|
| `turn-start` | `src/turn/flow.ts:208-218` | 已有 | `scheduleTurn` 调用统一 `emit`。 |
| `awaken-start` | `src/turn/flow.ts:202-204` | 已有 | `enter('awaken')`。 |
| `awaken-end` | `src/turn/flow.ts:205-206` | 已有 | `leave('awaken')`。 |
| `beginning-start` | `src/turn/flow.ts:202-204` | 已有 | `enter('beginning')`。 |
| `beginning-end` | `src/turn/flow.ts:205-206` | 已有 | `leave('beginning')`。 |
| `channel-start` | `src/turn/flow.ts:202-204` | 已有 | `enter('channel')`。 |
| `channel-end` | `src/turn/flow.ts:205-206` | 已有 | `leave('channel')`。 |
| `draw-start` | `src/turn/flow.ts:202-204` | 已有 | `enter('draw')`。 |
| `draw-end` | `src/turn/flow.ts:205-206` | 已有 | `leave('draw')`。 |
| `main-start` | `src/turn/flow.ts:202-204` | 已有 | `enter('main')`。 |
| `main-end` | `src/turn/flow.ts:191-194` | 已有 | `endTurn` 任务队列。 |
| `turn-end` | `src/turn/flow.ts:191-195` | 已有 | 在 Ending Step 进入清理前产生。 |
| `cleanup-start` | `src/chain/engine.ts:262-270` | 已有 | `handleOutstanding` 固定点循环开始。 |
| `cleanup-end` | `src/chain/engine.ts:268-273` | 已有 | `cleanup` 返回后产生。 |
| `object-enters-zone` | `src/events/action-adapter.ts:37-46`；本任务 `src/events/producers/zone-change.ts:35-80` | 已有；本任务新增 | `zone-change.test.mjs`：换区产生、同 incarnation 不产生。 |
| `object-leaves-zone` | `src/events/action-adapter.ts:37-46`；本任务 `src/events/producers/zone-change.ts:35-80` | 已有；本任务新增 | 同上。 |
| `object-enters-board` | `src/events/action-adapter.ts:15-18,42-46`；`src/turn/flow.ts:85-93` | 已有 | Zone adapter 与 Board 位置移动补充共同覆盖。 |
| `object-leaves-board` | `src/events/action-adapter.ts:15-18,37-40`；`src/turn/flow.ts:85-89` | 已有 | 离场使用旧快照。 |
| `object-enters-battlefield` | `src/events/action-adapter.ts:15-18,42-46`；`src/turn/flow.ts:85-93` | 已有 | Board 位置移动由 TurnFlow 补发。 |
| `object-leaves-battlefield` | `src/events/action-adapter.ts:15-18,37-40`；`src/turn/flow.ts:85-89` | 已有 | Board 位置移动由 TurnFlow 补发。 |
| `object-enters-base` | `src/events/action-adapter.ts:15-18,42-46`；`src/turn/flow.ts:85-93` | 已有 | Board 位置移动由 TurnFlow 补发。 |
| `object-leaves-base` | `src/events/action-adapter.ts:15-18,37-40`；`src/turn/flow.ts:85-89` | 已有 | Board 位置移动由 TurnFlow 补发。 |
| `object-enters-deck` | `src/events/action-adapter.ts:37-46` | 已有 | `zoneTimings` 对 `deck` 产生。 |
| `object-leaves-deck` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-enters-hand` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-leaves-hand` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-enters-rune-deck` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-leaves-rune-deck` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-enters-rune-zone` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-leaves-rune-zone` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-enters-trash` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-leaves-trash` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-enters-banishment` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-leaves-banishment` | `src/events/action-adapter.ts:37-46` | 已有 | 同上。 |
| `object-enters-chain` | `src/events/action-adapter.ts:37-46`；`src/chain/engine.ts:202-213` | 已有 | Play 的卡牌先进入 Chain。 |
| `object-leaves-chain` | `src/events/action-adapter.ts:37-46`；`src/chain/engine.ts:367-370` | 已有 | Resolve 后离开 Chain。 |
| `card-played` | `src/chain/engine.ts:352-367` | 已有 | 仅成功 Resolve 的 spell/unit/gear。 |
| `became-target` | `src/chain/engine.ts:290-299` | 已有 | TargetPlan Finalize 回调。 |
| `object-killed` | `src/events/action-adapter.ts:47-58` | 已有 | Kill 使用离场前快照；替代/阻止不发布。 |
| `object-readied` | `src/events/action-adapter.ts:47-58`；`src/turn/flow.ts:75-84` | 已有 | Board 与 Rune readiness 分别覆盖。 |
| `object-exhausted` | `src/events/action-adapter.ts:47-58` | 已有 | Board 上的成功 Exhaust。 |
| `attack-declared` | `src/combat/flow.ts:148-155`（角色事务尚未实现） | 待后续 | Combat start/role designation 需要原子 timing wave；当前代码明确抛出 `combat-start-transaction`。 |
| `defense-declared` | `src/combat/flow.ts:148-155`（角色事务尚未实现） | 待后续 | 同上。 |
| `showdown-open` | `src/chain/engine.ts:179-184` | 已有 | `openShowdown` 原子地产生。 |
| `combat-damage-before` | `src/combat/flow.ts:157-159`（事务尚未实现） | 待后续 | `dealDamage` 明确要求 commitBatch。 |
| `combat-damage-after` | `src/combat/flow.ts:157-159`（事务尚未实现） | 待后续 | 必须与 simultaneous damage 同一原子批次。 |
| `showdown-close` | `src/chain/engine.ts:393-400` | 已有 | 双方 Focus pass 完成后产生。 |
| `combat-end` | `src/combat/flow.ts:140-159`（结束事务尚未实现） | 待后续 | 新 CombatFlow 尚无结束提交点。 |
| `chain-item-pending` | `src/chain/engine.ts:226-233` | 已有 | Pending item 安装后产生。 |
| `chain-item-finalize` | `src/chain/engine.ts:276-319` | 已有 | 合法性、目标、费用完成后产生。 |
| `chain-item-resolve` | `src/chain/engine.ts:352-372` | 已有 | Body Resolve 完成后产生。 |
| `control-established` | `src/combat/flow.ts:60-68` | 已有 | Score 原子事务前更新 Battlefield 控制。 |
| `control-lost` | `src/combat/flow.ts:88-98` | 已有 | Cleanup 中确认无己方单位后产生。 |
| `conquer` | `src/turn/flow.ts:95-104` | 已有 | Score 任务的结构化 timing wave。 |
| `hold` | `src/turn/flow.ts:95-104` | 已有 | Beginning Scoring Step 的 Score 任务。 |
| `score` | `src/turn/flow.ts:95-104` | 已有 | 计分事件独立于 points-gained。 |
| `final-point` | `src/turn/flow.ts:95-104` | 已有 | Final Point draw 检查满足时产生。 |
| `object-moved` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | 仅 `move-location`；Recall/入场/Attach 不复用。 |
| `card-drawn` | `src/events/action-adapter.ts:9-13,47-53` | 已有 | 每个实际进入手牌的对象各自产生。 |
| `card-discarded` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | 仅 Discard 动作。 |
| `damage-dealt` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | 正整数实际伤害才产生。 |
| `unit-stunned` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Stun action timing。 |
| `xp-gained` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Gain XP action timing。 |
| `buff-added` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Buff action timing。 |
| `buff-spent` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Spend Buff action timing。 |
| `empowered-changed` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Empower/Disempower action timing；重复无效由动作层拒绝。 |
| `contested-applied` | `src/combat/flow.ts:51-58,88-106` | 已有 | 实际进入 Battlefield 或 Cleanup 重新发现时产生。 |
| `contested-removed` | `src/combat/flow.ts:88-106`（仅清除状态，无 emit） | 待后续 | 需要与 Control 改变区分的 Cleanup 事务。 |
| `card-recycled` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Recycle action timing。 |
| `card-banished` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Banish action timing。 |
| `card-revealed` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Rule Reveal action timing。 |
| `objects-shown-off` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Show Off Finalize 结果。 |
| `card-hidden` | 无（`GameAction` 没有 Hide；`src/events/action-adapter.ts:9-13` 也没有映射） | 待后续 | 需要 Hide action/result 证据，不能把进入 Battlefield 推断为 Hidden。 |
| `card-burned` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | 仅 Mill/Burn。 |
| `cards-looked-at` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | 私有 Look 结果。 |
| `object-attached` | `src/events/action-adapter.ts:9-13,47-58` | 已有 | Attach 到新 Top-Most Card。 |
| `might-changed` | 本任务 `src/events/producers/might-change.ts:20-49` | 本任务新增 | `might-change.test.mjs`：数值变化产生、null 保留、无变化/非 Unit/新 incarnation 不产生。接入点为成功动作后的 before/after layer snapshots。 |
| `ability-activated` | 本任务 `src/events/producers/ability-activation.ts:23-46` | 本任务新增 | `ability-activation.test.mjs`：committed 产生、cancelled/countered/invalid 不产生。必须由 Chain 的合法完成结果提供 proof。 |
| `combat-start` | `src/combat/flow.ts:148-155`（事务尚未实现） | 待后续 | 同 `attack-declared`，不能由 Showdown 开启近似代替。 |
| `combat-result` | `src/combat/flow.ts:140-159`（结果事务尚未实现） | 待后续 | 需要胜负/No Result 的权威 Combat cleanup 结果。 |
| `points-gained` | `src/turn/flow.ts:75-104` | 已有 | Score action 的 `score` emission 在结构化 wave 中改名为 points-gained；0 点的 Final Point 仍保留 Score。 |

## 本任务新增产生器

- `deriveZoneChangeEmissions(before, after, context)`：按 `zoneEntryId` 判断 leave/enter，覆盖 generic zone、Board、Base、Battlefield、Deck、Hand、Rune Deck、Rune Zone、Trash、Banishment、Chain 的别名，并保留离场旧快照。
- `deriveMightChangedEmissions(before, after, context)`：只比较同一 incarnation 的 Unit；`null` 与 `0` 严格区分，输出 `previousMight/currentMight`。
- `deriveAbilityActivatedEmission(proof)`：只有 `status: committed` 才输出 activation timing；任何未完成或被 Counter 的尝试都不输出。

这些函数是纯函数，避免在 fixture 中改写 frame/zone/resource/health。它们的测试只使用 before/after 快照和受信结果替身，不模拟动作结算。

## 契约变更请求

1. **Chain activation proof（最小接口）**：`ChainDraft`/`ChainItem` 目前没有稳定的 `abilityId`，也没有“Finalize 合法完成且未被 Counter”的受信结果字段。父任务接入 `deriveAbilityActivatedEmission` 时，需要在 Chain 的合法 activation 入口提供 `{ chainItemId, playerId, sourceId, abilityId, status: "committed" }`；不能从普通 `activated` kind 或 card text 猜测能力身份。
2. **Hide action evidence（最小接口）**：`GameAction` 没有 Hide 类型，`ActionExecution` 也没有 Hide 专用结果。请增加受信的 Hide action/result 后再产生 `card-hidden`；在此之前保持待后续。

Combat damage/role/result 与 `contested-removed` 不提出接口变更请求，本任务按卡片要求不修改 `src/turn/`、`src/combat/`，由后续回合/战斗事务任务完成。

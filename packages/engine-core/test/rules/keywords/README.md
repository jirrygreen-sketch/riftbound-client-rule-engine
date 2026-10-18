# keywords 规则 golden（RIFT-626）

把 `docs/rules/scenarios/keywords.yaml` 中**新内核已能执行**的场景转成规则 golden。
被测对象只有新层：`src/effects/testing/` 参考内核、`src/programs/`（程序绑定 +
关键词展开）、`src/chain/`、`src/events/`、`src/layers/`、`src/cost/`、`src/target/`、
`src/zones/`、`src/turn/` 与 `src/effects/keywords/` 的关键词展开。
`src/duel/` 只在 `zones/movement.ts` 仍然消费 `DuelBoard` 的地方作为局势构造器使用
（与 `test/rules/movement/` 同一口径），从不作为被测对象。

- `support.mjs`：真实接线（program binding → ChainEngine → EventPipeline →
  interpreter → primitives），以及 `fixture()` / `play()` / `activate()` / `settle()`
  这组构造与驱动助手。局面只由 WorldBuilder 构造，状态变化全部走真实 `GameAction`。
- 能执行的场景写真实执行测试（断言事件序列、费用回执、图层快照或结果状态）；
  机制未合入的写 `test.todo`，标题写明缺哪个模块 / op / 时点。
- 文件名按规则条目号（契约第 5 节），测试名含场景 id。

## 计数

88 个场景全部登记：26 个仅执行、19 个仅 todo，另有 43 个在执行测试之外追加了
明确缺口的 todo（该场景尚未达到 YAML 的全部验收项）。在 140 个用例里，87 个执行、53 个 todo。

## 场景对照

| 场景 id | 状态 | 测试文件 |
| --- | --- | --- |
| keywords-general-grant-no-duration-persists | executed | 801.3-803-keyword-general.test.mjs |
| keywords-general-execution-order | todo | 801.3-803-keyword-general.test.mjs |
| keywords-accelerate-paid-enters-ready | executed | 805.1.b-accelerate-entry-state.test.mjs |
| keywords-accelerate-not-paid-enters-exhausted | executed + todo | 805.1.b-accelerate-entry-state.test.mjs |
| keywords-accelerate-enters-ready-not-a-ready-trigger | executed + todo | 805.1.b-accelerate-entry-state.test.mjs |
| keywords-accelerate-on-board-no-function | executed | 805.1.b-accelerate-entry-state.test.mjs |
| keywords-accelerate-power-domain-must-match | executed | 805.1.b-accelerate-entry-state.test.mjs |
| keywords-accelerate-multiple-instances-redundant | executed | 805.1.b-accelerate-entry-state.test.mjs |
| keywords-assault-default-value-1 | executed + todo | 807-assault.test.mjs |
| keywords-assault-inactive-while-defending | executed + todo | 807-assault.test.mjs |
| keywords-assault-stacks-from-multiple-sources | executed + todo | 807-assault.test.mjs |
| keywords-assault-ends-when-combat-ends | executed + todo | 807-assault.test.mjs |
| keywords-shield-bonus-while-defending | executed + todo | 814-shield.test.mjs |
| keywords-shield-inactive-while-attacking | executed + todo | 814-shield.test.mjs |
| keywords-shield-stacks-from-multiple-sources | executed + todo | 814-shield.test.mjs |
| keywords-deflect-mandatory-additional-power-cost | executed | 809-deflect.test.mjs |
| keywords-deflect-insufficient-power-rejected | executed | 809-deflect.test.mjs |
| keywords-deflect-power-any-domain | executed | 809-deflect.test.mjs |
| keywords-deflect-multiple-times-chosen-cost-multiplies | executed | 809-deflect.test.mjs |
| keywords-deflect-stacks-from-multiple-sources | executed | 809-deflect.test.mjs |
| keywords-deathknell-triggers-on-kill | executed + todo | 808-deathknell.test.mjs |
| keywords-deathknell-removed-when-death-replaced | todo | 808-deathknell.test.mjs |
| keywords-deathknell-multiple-instances-trigger-separately | executed | 808-deathknell.test.mjs |
| keywords-ganking-battlefield-to-battlefield-move | executed + todo | 810-ganking-standard-move.test.mjs |
| keywords-ganking-multiple-redundant | executed | 810-ganking-standard-move.test.mjs |
| keywords-hidden-hide-from-hand | executed | 811-hidden.test.mjs |
| keywords-hidden-play-facedown-next-turn | executed + todo | 811-hidden.test.mjs |
| keywords-hidden-facedown-no-referenceable-characteristics | todo | 811-hidden.test.mjs, 832-show-off.test.mjs |
| keywords-hidden-normal-play-still-allowed | executed + todo | 811-hidden.test.mjs |
| keywords-hidden-spell-targets-must-be-at-battlefield | todo | 811-hidden.test.mjs |
| keywords-hidden-gear-played-to-battlefield-overrides-base-restriction | todo | 811-hidden.test.mjs |
| keywords-hidden-play-effect-mistargets-when-source-leaves | todo | 811-hidden.test.mjs |
| keywords-legion-satisfied-after-another-card-finalized | executed + todo | 812-824-legion-level.test.mjs |
| keywords-legion-not-satisfied-first-card-of-turn | executed + todo | 812-824-legion-level.test.mjs |
| keywords-legion-one-card-satisfies-all-legion | todo | 812-824-legion-level.test.mjs |
| keywords-reaction-play-on-opponent-turn-closed-state | executed | 806-813-action-reaction-speed.test.mjs |
| keywords-action-not-playable-in-closed-state | executed | 806-813-action-reaction-speed.test.mjs |
| keywords-action-unit-still-restricted-to-base-or-own-battlefield | todo | 806-813-action-reaction-speed.test.mjs |
| keywords-tank-must-be-assigned-lethal-first | executed + todo | 815-826-combat-assignment-keywords.test.mjs |
| keywords-tank-multiple-tanks-any-order | todo | 815-826-combat-assignment-keywords.test.mjs |
| keywords-temporary-killed-at-controller-beginning-phase | executed + todo | 816-817-temporary-vision.test.mjs |
| keywords-temporary-multiple-instances-trigger-once | executed + todo | 816-817-temporary-vision.test.mjs |
| keywords-vision-trigger-on-played | executed + todo | 816-817-temporary-vision.test.mjs |
| keywords-vision-multiple-instances-trigger-separately | executed + todo | 816-817-temporary-vision.test.mjs |
| keywords-equip-attach-gear-to-unit | executed + todo | 818-equip-attach.test.mjs |
| keywords-equip-target-must-be-friendly-unit | executed | 818-equip-attach.test.mjs |
| keywords-equip-unit-cannot-be-attached | executed | 818-equip-attach.test.mjs |
| keywords-equip-attached-equipment-detaches-when-becomes-unit | executed | 818-equip-attach.test.mjs |
| keywords-quickdraw-attach-on-play | executed | 819-quick-draw.test.mjs |
| keywords-quickdraw-playable-with-reaction-timing | todo | 819-quick-draw.test.mjs |
| keywords-repeat-paid-executes-twice | executed + todo | 820-repeat.test.mjs |
| keywords-repeat-not-paid-executes-once | executed + todo | 820-repeat.test.mjs |
| keywords-repeat-played-only-once | executed + todo | 820-repeat.test.mjs |
| keywords-repeat-multiple-instances-paid-separately | executed + todo | 820-repeat.test.mjs |
| keywords-weaponmaster-discount-attach-on-play | executed + todo | 821-weaponmaster.test.mjs |
| keywords-weaponmaster-no-function-on-board | executed + todo | 821-weaponmaster.test.mjs |
| keywords-ambush-play-to-friendly-occupied-battlefield | executed + todo | 822-ambush.test.mjs |
| keywords-ambush-invalid-when-no-friendly-units | todo | 822-ambush.test.mjs |
| keywords-hunt-gains-xp-on-conquer | executed + todo | 823-hunt.test.mjs |
| keywords-hunt-stacks-from-multiple-sources | executed + todo | 823-hunt.test.mjs |
| keywords-level-active-when-xp-threshold-met | executed + todo | 812-824-legion-level.test.mjs |
| keywords-level-inactive-below-threshold | todo | 812-824-legion-level.test.mjs |
| keywords-unique-deck-limit-one | executed + todo | 825-103.3.b-unique-deck-limit.test.mjs |
| keywords-unique-signature-combined-limit | executed + todo | 825-103.3.b-unique-deck-limit.test.mjs |
| keywords-backline-assigned-last | executed + todo | 815-826-combat-assignment-keywords.test.mjs |
| keywords-backline-multiple-any-order | todo | 815-826-combat-assignment-keywords.test.mjs |
| keywords-empower-first-activation-becomes-empowered | executed | 827-empower.test.mjs |
| keywords-empower-binary-cannot-reactivate-when-empowered | executed | 827-empower.test.mjs |
| keywords-empower-multiple-permission-ignores-restriction | executed | 827-empower.test.mjs |
| keywords-empower-at-max-activation-legal-but-no-effect | executed | 827-empower.test.mjs |
| keywords-empowered-dependent-ability-active | todo | 827-empower.test.mjs |
| keywords-empowered-becomes-empowered-trigger | todo | 827-empower.test.mjs |
| keywords-disempower-removes-one-status | executed + todo | 827-empower.test.mjs |
| keywords-flow-play-from-trash-for-flow-cost | executed + todo | 829-flow.test.mjs |
| keywords-flow-timing-unchanged | executed | 829-flow.test.mjs |
| keywords-deploy-play-gear-to-any-battlefield | executed + todo | 830-deploy-gear.test.mjs |
| keywords-deploy-gear-not-recalled-in-cleanup | executed | 830-deploy-gear.test.mjs |
| keywords-deploy-killed-when-opponent-holds | todo | 830-deploy-gear.test.mjs |
| keywords-deploy-multiple-redundant | executed | 830-deploy-gear.test.mjs |
| keywords-disarm-attack-trigger-minus-might | executed + todo | 831-disarm.test.mjs |
| keywords-disarm-multiple-instances-single-trigger | executed + todo | 831-disarm.test.mjs |
| keywords-disarm-no-enemy-unit-trigger-fizzles | todo | 831-disarm.test.mjs |
| keywords-showoff-reveal-from-hand-locks-value | executed + todo | 832-show-off.test.mjs |
| keywords-showoff-pick-from-board | executed + todo | 832-show-off.test.mjs |
| keywords-showoff-set-can-mix-hand-and-board | executed + todo | 832-show-off.test.mjs |
| keywords-showoff-leaving-zone-after-shown-still-finalizes | todo | 832-show-off.test.mjs |
| keywords-showoff-no-valid-choice-play-normally | executed + todo | 832-show-off.test.mjs |
| keywords-showoff-multiple-instances-linked-separately | todo | 832-show-off.test.mjs |


## 与场景规格的差异（以 CR v1.5 原文为准）

1. `keywords-assault-default-value-1` / `...-stacks-from-multiple-sources` 与
   `keywords-shield-*` 的 YAML 期望 `objects.*.effectiveMight` 与
   `combat.damage-assigned` 事件。CR 807.1.c / 814.1.c 的 “+X Might while I am an
   attacker/defender” 是**指定（designation）驱动**的持续效果；合并后的契约只提供
   `ObjectSnapshot.combatRole`，而关键词展开读的是 `designation`，`src/layers/engine.ts`
   也没有该属性访问器。测试因此执行真实可执行的部分（缺省值、叠加求和、门控条件），
   把 Might / 伤害部分登记为 todo，而不是把 `combatRole` 当成 `designation`。
2. `keywords-deflect-*` 的 YAML 期望由一次 Spell Play 的 Finalize 收费。合并后的
   `ChainEngine` 目标税桥把每个税额一律转成 Energy 组件，与 809.1.c.1 的任意域 Power
   不符；测试改在真实的 cost/target 图层（`TargetTaxCostAdapter` + `collectTargetTaxes`）
   上执行同一语义，并在 todo 里点名该桥。
3. `keywords-empower-at-max-activation-legal-but-no-effect` 的 YAML 期望
   `effect.negated` 事件；合并的 `effect.empower` 在到达上限时返回 negated（无事件），
   费用照付。测试断言可观察结果（计数停在 3、能量已付），不伪造事件。
4. `keywords-disempower-removes-one-status` 的 YAML 期望 empowered 由 2 变 1。
   合并参考内核的 Disempower 动作把计数清零（`src/effects/testing/test-kernel.ts`），
   与 CR 443.1.b 不符。测试订住真实行为并另写 todo 说明差异（修正属范围外）。
5. 若干场景（`keywords-accelerate-*`、`keywords-reaction-*`、`keywords-equip-*` 等）
   的 YAML 用 `commands[].do: play/activate/hide`、`pay: {...}` 与
   `rejected: { reason }` 这套**旧会话命令词汇**。新内核没有该分发器；测试改用真实
   `ChainDraft` / cost plan 执行同一语义，并把“旧词汇通知”登记为 todo。

## 当前 API 表达及覆盖边界（不属于规则差异）

1. 关键词展开大多把宿主写成 `ObjectSelector` 的 `"self"`，或写成 `appliesTo`、
   `permission`、`appliesTo: ["card"]` 这类**描述性形状**。生产静态绑定器
   （`src/programs/statics.ts`）只接受可映射的 effect kind 与它白名单里的 filter 字段，
   因此 `accelerate.cost` / `cost.hidden` / `cost.reveal` / `flow.cost` /
   `play-location-permission` / `condition.predicate` / `continuous.combat` /
   `target.tax` 中的一部分会 fail-closed（`judge-required`）。测试按各自真实可执行的
   切片断言，并把缺口写进 todo。
2. 触发类关键词（Temporary、Hunt、Vision、Deathknell、Disarm、Deploy）各自被冻结的
   `EventPattern` 词表或 `src/programs/filters.ts` 白名单挡住：`beginning-start`、
   `conquer`/`hold`、`object.id`、`here`、`sameLocationAs` 都不是可注册形状。测试用
   `validateTriggerSpec` 钉住这一事实，并单独执行它们的展开与 body 原语。
3. Deathknell 的 body op 是 `trigger.leave`，生成的指令注册表里没有该 op；同时
   `src/programs/lifecycle.ts` 会在 `object-killed` 时立刻注销触发注册。两点都写进 todo。
4. Vision 的 body（`effect.inspect` + `effect.recycle`）是真实原语，缺的只有可注册的
   `object-enters-board` filter，因此测试执行 body 形状与 Predict 的默认张数（437.3.a）。
5. Assault / Shield 的叠加走 `layers/ops` 的 `normaliseKeywordGrants` +
   `buildKeywordArithmeticSpec`，由 `continuous.grant-keyword` 原语真实执行；这一条路径
   完全可用，不依赖 `designation`。
6. `keywords-ganking-*` 用 `src/zones/movement.ts` 的 Standard Move 叶子内核执行
   （与 `test/rules/movement/810.1-*` 同一口径）。Ganking 的关键词形状
   （`permission: "battlefield-to-battlefield"`）与 `layers/rules/query.movement()` 读取的
   `permission.routes` 不一致，所以“关键词 → 移动许可”的接线登记为 todo。
7. `keywords-deploy-play-gear-to-any-battlefield` 与
   `keywords-deploy-gear-not-recalled-in-cleanup` 走真实 Play 与真实 Cleanup；
   `continuous.location` 的消费端仍未合入，另有 todo。
8. `keywords-unique-*` 没有对应的 KeywordDef；牌张数据上的 `unique` 标签加合并后的
   `continuous.deck` 原语与 `layers/rules/query.deckLimit()` 是真实路径，测试据此断言，
   组牌阶段校验本身登记为 todo。

## 契约变更请求（未修改契约）

1. `ObjectSnapshot` 需要可读的**指定（designation）**特征（或让关键词展开改用
   `combatRole`），否则 807/814 的 “while I am an attacker/defender” 无法求值。
2. 需要 `EventPattern` 能表达**时点 id 形式的触发**（`beginning-start`、`conquer`、
   `hold`、`empowered-changed`），或由适配器把时点 id 映射为可注册模式。
3. 需要把**目标税的域语义**（809.1.c.1 的任意域 Power）接进 ChainEngine 的 Finalize
   费用计划，而不是一律折成 Energy。
4. 需要把 **Finalize 的费用回执接到 Resolve**（Repeat 的已付实例数、Accelerate 的
   付费与否、Flow 的替代费用选择），否则这三个关键词的打出流程都无法端到端执行。
5. 需要 **Empowered 计数的单步移除**动作（443.1.b），参考内核当前的 Disempower 会清零。
6. 需要 `effect.disempower`、`cost.reveal`、`cost.hidden`、`trigger.leave` 等指令的
   注册（或让关键词展开改用已注册 op），否则对应关键词的 body 无法由解释器执行。
7. 需要 **facedown 区域模型**（811）与 **Deploy 的 continuous.location 消费端**
   （830.1.b.1/.b.3）以及 **Temporary/Vision/Disarm 的触发过滤器适配**，才能把
   这些章节的 todo 转成执行测试。

## 复现

```bash
pnpm --filter @riftbound/engine-core build
node --test --import ./packages/engine-core/test/support/register.mjs \
  packages/engine-core/test/rules/keywords/*.test.mjs
```

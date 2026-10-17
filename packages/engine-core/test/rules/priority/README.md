# priority 规则 golden（RIFT-622）

场景来源：`docs/rules/scenarios/priority.yaml`（41 个场景）与 Core Rules v1.5 原文。
文件名按规则条目号（契约第 5 节），测试标题含场景 id。

被测对象只有新层：`src/effects/testing/` 参考内核、`src/events/` 事件管线、
`src/chain/` 链引擎、`src/turn/` 回合驱动（含真实 Cleanup 与 Showdown 收束）。
`src/duel/` 从不作为被测对象；`given` 局面用参考内核的 world builder 构造。

本目录只补该章尚未转成测试的场景。RIFT-120 已把其余 39 个场景登记在
`test/chain/priority-scenarios.test.mjs`（对照表见
`src/chain/SCENARIO-COVERAGE.md`），本目录不重复实现。

`harness.mjs` 只做局面构造与 `ChoiceRequest` 应答，不代任何规则结算：分数、
控制权、Contested 与 Showdown 全部由 `TurnFlow` 的真实 Cleanup / 收束路径产生。

## 场景 id 对照（本目录负责的 2 个）

| 场景 id | 状态 | 测试 |
| --- | --- | --- |
| priority-noncombat-showdown-conquer | 执行 | `348.2.a-noncombat-showdown-conquer.test.mjs` |
| priority-combat-showdown-proceeds-to-damage | todo | `348.1-combat-showdown-proceeds-to-damage.test.mjs` |

`priority-noncombat-showdown-conquer` 用真实路径构造 Contested（移入无控制者战场经
Cleanup 判定 190.3.a / 344.2），因此该场景的 `showdown-close → control-established →
conquer → score` 序列与规则 348.2.a / 348.2.a.1 一致，未预置 `contested: true`。

`priority-combat-showdown-proceeds-to-damage` 登记为 todo：见下节差异。

## 与场景规格的差异（以 CR v1.5 原文为准）

1. YAML 期望的 `combat.damage-step` 时点在冻结枚举
   `src/events/timing-points.ts` 中不存在；对应条目为 `combat-damage-before`
   （467.2.c / 467.2.c.1.a）与 `combat-damage-after`（467.2.d / 467.3）。
   346/348 对应的是 `showdown-close`。测试按冻结枚举撰写，未自造时点名。
2. YAML 中 `priority-showdown-open-on-contested` 期望 `showdown.staged` 时点；
   冻结枚举里没有该时点，Staged 是 Cleanup 内部状态（`CombatFlow.battlefields[].staged`），
   该场景由已合入的 RIFT-120/276 测试覆盖，本目录不重复。
3. YAML 中 `focus.granted` / `priority.granted` 是引擎 trace 步骤
   （`chain.trace` 的 `focus-granted` / `priority-granted`）而非
   pipeline 时点；断言必须读 trace 或状态，不能当作 timing 匹配。

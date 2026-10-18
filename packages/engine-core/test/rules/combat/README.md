# combat 规则 golden（RIFT-625）

把 `docs/rules/scenarios/combat.yaml` 中**新内核已能执行**的场景转成规则 golden，按契约第 5 节
以规则条目号命名（`<条目号>-<slug>.test.mjs`）。

被测对象只有新层：`src/effects/testing/` 参考内核、`src/events/`、`src/chain/`、`src/turn/`、
`src/layers/`、`src/combat/`（分配内核）。`src/duel/` 只在 `src/combat/base-combat-allocation.ts`
仍然要求由它提供规范棋盘的地方作为 `given` 的局面构造器使用；从不是被测对象。
旧 `src/duel/` 运行时、旧 profile、旧回放都不参与。

- `harness.mjs`：TurnFlow → ChainEngine → EventPipeline → interpreter → primitives 的真实接线，
  以及分配内核的 `combatScene()` / `bindScene()` / `blockedCode()` 与图层 `layeredMight()`。
- 执行用例断言真实事件序列、trace、内核快照或分配回执；未合入的机制写 `test.todo`，标题写明缺哪个模块 / op / 时点。
- 不写“断言某功能不存在”的测试：每个 todo 都指出缺失的接口或消费者。

## 场景对照（41/41 已登记）

“已有”＝本任务前已合入的测试（补充说明要求只补未覆盖的），本目录不重复这些用例。
“执行”＝本目录新增的真实执行断言；“todo”＝本目录新增的 `test.todo`（标题含缺失机制）。

| 场景 id | 状态 | 位置 |
| --- | --- | --- |
| `combat-move-opens-noncombat-showdown-contested` | 已有（执行） | `test/combat/flow.test.mjs` |
| `combat-move-to-enemy-stages-combat-opens-combat-showdown` | 已有（部分执行）+ todo（开启与攻守指定） | `test/combat/flow.test.mjs`；`466.2-combat-start-and-designation.test.mjs` |
| `combat-focus-does-not-pass-after-trigger-opened-chain` | 执行 + todo（攻击触发版本） | `346.1-trigger-opened-chain-focus-not-passed.test.mjs` |
| `combat-focus-passes-after-player-chain` | 已有（执行） | `test/combat/flow.test.mjs` |
| `combat-showdown-ends-after-all-pass` | todo（原子战斗开始 + 伤害步骤） | `466.2-combat-start-and-designation.test.mjs` |
| `combat-noncombat-showdown-control-established` | 已有（执行） | `test/combat/flow.test.mjs` |
| `combat-defender-mid-showdown-move-converts-to-combat-showdown` | todo（Showdown→战斗转换） | `466.2-combat-start-and-designation.test.mjs` |
| `combat-negative-nonfocus-player-cannot-play` | 已有（执行） | `test/combat/flow.test.mjs` |
| `combat-assign-full-lethal-before-spreading` | 执行（分配与校验）+ todo（实际结算） | `467.2.c.3-lethal-before-spreading.test.mjs`；`467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-negative-cannot-spread-below-lethal` | 执行 | `467.2.c.3-lethal-before-spreading.test.mjs` |
| `combat-assign-capped-at-lethal-with-existing-damage` | 执行 | `467.2.c.4-lethal-cap-and-existing-damage.test.mjs` |
| `combat-negative-assign-more-than-lethal` | 执行 | `467.2.c.4-lethal-cap-and-existing-damage.test.mjs` |
| `combat-tank-forces-first-assignment` | todo（缺 `continuous.combat` 消费者） | `815-tank-826-backline-assignment-priority.test.mjs` |
| `combat-negative-bypass-tank-assignment` | todo（同上） | `815-tank-826-backline-assignment-priority.test.mjs` |
| `combat-two-tanks-free-order-among-same-priority` | todo（同上） | `815-tank-826-backline-assignment-priority.test.mjs` |
| `combat-tank-plus-backline-conflict-choose-one` | todo（同上 + 互斥要求求解） | `815-tank-826-backline-assignment-priority.test.mjs` |
| `combat-undamageable-unit-exempt-from-mandatory-assignment` | todo（缺不可受伤依据） | `467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-damage-dealt-simultaneously-shared-deathknell` | 已有（阻塞断言）+ todo（原子批量结算） | `test/combat/flow.test.mjs`；`467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-attacker-sums-might-defender-assigns-back` | 执行 | `467.2.c.4-lethal-cap-and-existing-damage.test.mjs` |
| `combat-negative-might-sums-as-zero` | 执行（求和读 0） | `143.2.c-negative-might-sums-as-zero.test.mjs` |
| `combat-prevent-and-doubling-apply-at-assignment-controller-orders` | todo（缺分配期替代管道） | `467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-assignment-accounts-for-doubling-minimum-applied` | todo（缺放大后致命最小值） | `467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-no-result-recalls-attackers-when-defenders-remain` | todo（缺 Recall 动作 + 伤害事务） | `467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-attacker-wins-conquers-battlefield` | todo（缺战斗结果步骤与攻守指定） | `467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-both-sides-wiped-no-result-battlefield-uncontrolled` | todo（同上） | `467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-heal-in-combat-cleanup-before-result` | todo（缺战斗特殊清理） | `467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-staged-combat-fizzles-when-side-leaves` | 执行（323.9 取消）+ todo（两处同时挂起变体） | `463.2-staged-combat-fizzles-when-side-leaves.test.mjs` |
| `combat-negative-move-into-ongoing-combat-battlefield` | todo（缺多人棋盘 464.1） | `355.2-play-destination-and-464.1-third-party.test.mjs` |
| `combat-deploy-gear-becomes-unit-stages-showdown-orianna` | todo（RAD-145 judge-required + 战斗开启） | `143.5-unitized-gear-and-attach.test.mjs` |
| `combat-attached-gear-becomes-unit-detaches` | todo（需真实卡 + 已有 143.5.b 图层用例） | `143.5-unitized-gear-and-attach.test.mjs` |
| `combat-negative-attach-unit-noop` | todo（缺 attach 命令准入；规则语义已有用例） | `143.5-unitized-gear-and-attach.test.mjs`；`355.2-play-destination-and-464.1-third-party.test.mjs` |
| `combat-deathknell-pending-before-trash` | 执行（808.2/808.2.a 与 808.1.d.3）+ todo（808.1.d.2 严格先于入墓） | `808.2-deathknell-instances-and-order.test.mjs` |
| `combat-deathknell-removed-when-death-replaced` | 执行（替代后不入链）+ todo（已入链项的移除） | `808.1.d.1-death-replaced-removes-trigger.test.mjs` |
| `combat-disarm-single-trigger-on-attack` | todo（缺 attack-declared 产生方 + `sameLocationAs` 过滤桥） | `831-disarm-attack-trigger.test.mjs` |
| `combat-disarm-multiple-instances-merge-sum` | todo（缺合并求和运行期路径） | `831-disarm-attack-trigger.test.mjs` |
| `combat-disarm-checked-once-per-combat` | todo（缺每战斗一次的检查计数） | `467.2.d-simultaneous-combat-damage.test.mjs` |
| `combat-disarm-first-attack-requirement-skipped` | todo（缺攻击限制消费者 + 指定） | `831-disarm-attack-trigger.test.mjs` |
| `combat-new-arrivals-gain-designation-next-cleanup` | todo（缺迟到单位的指定） | `466.2-combat-start-and-designation.test.mjs` |
| `combat-turn-player-chooses-which-combat-first` | todo（缺同时挂起的多战斗） | `466.2-combat-start-and-designation.test.mjs` |
| `combat-negative-unit-cannot-be-played-to-enemy-battlefield` | todo（缺 Finalize 打出地点校验） | `355.2-play-destination-and-464.1-third-party.test.mjs` |
| `combat-deploy-hold-kills-enemy-gear` | todo（缺 `hold` + `here` 过滤注册） | `143.5-unitized-gear-and-attach.test.mjs` |

## 与场景规格的差异（以 CR v1.5 原文为准）

1. **timing 别名**：场景 YAML 使用 `unit.moved` / `battlefield.contested` / `battlefield.control-established` /
   `score.conquered` / `score.held` / `unit.healed` / `unit.recalled` / `combat.result-determined` /
   `combat.ended` / `combat.damage-dealt` / `showdown.staged` / `combat.unstaged` 等旧别名。冻结枚举
   （`src/events/timing-points.ts`）对应为 `object-moved`、`contested-applied`、`control-established`、
   `conquer`、`hold`、`object-killed` + `heal` 动作、`combat-result`、`combat-end`、`damage-dealt`，
   且**没有** 争夺移除 / combat.staged / 战斗取消的公开时点（内部状态 `staged` 可观测）。
   本目录按冻结枚举断言，未改原规格。
2. **`combat-negative-nonfocus-player-cannot-play` 与 `combat-move-to-enemy-…`** 的 given 需要
   **战斗 Showdown**（两方单位同处一战场的进行中战斗）。开启战斗需要尚未合入的原子战斗开始任务，
   所以本目录用真实落地路径能产生的等价状态（非战斗 Showdown / 仅 staged 战斗）执行 347.1 与 323.9
   所要求的规则本身，并分别登记 todo；未把局部断言当作整场景通过。
3. **`combat-negative-might-sums-as-zero`**：143.2.c 的两半要分开看。合并后的算术层在每次算术结算末尾把
   Might 夹到 >= 0（`src/layers/engine.ts` `applyArithmetic`），因此“被引用按 0 计”可执行且已断言，
   而 143.2.c.1“实际值仍为负、继续参与增减”没有模型——已在 `test/rules/layers/`
   （`143.2.c-negative-might-treated-as-zero.test.mjs`）登记为图层缺口，本目录不重复该 todo。
4. **`combat-assign-full-lethal-before-spreading` / `combat-assignment-accounts-for-doubling-…` /
   `combat-prevent-and-doubling-…`** 的 467.2.c.5 / 467.2.c.4.a 语义要求分配期就应用被动与替代效果。
   合并后的分配内核要求调用方**证明**不存在分配修正与预防/替代（`proven-none`），且没有按单位套用替代的
   管道，所以这些只登记 todo；不发明近似语义。
5. **`combat-staged-combat-fizzles-when-side-leaves`** 的 notes 标出 UNCERTAIN（323.9 只说战斗停止 staged，
   同处非战斗 Showdown 是否保留按 323.7.a 字面理解）。本目录按该理解断言 `staged: 'showdown'` 保留。
   另：YAML given 的两处同时挂起（bf1 staged [showdown, combat] 与 bf2 进行中 Showdown）无法在
   TurnFlow 单engagement 驱动下构造，已登记 todo。
6. **`combat-deathknell-pending-before-trash`**：808.1.d.2 要求触发先于入墓成为 Pending。合并管线整组发布
   `object-killed → object-enters-trash` 后才 drain 挂起的触发扫描，因此该严格顺序登记 todo；
   可执行的是 808.2 / 808.2.a（多实例分别触发、操控者选序）与 808.1.d.3（触发快照保留死前信息）。

## 契约变更请求（未修改契约）

1. 定义可整体回滚的**原子战斗开始任务**：在一次提交内发出 `combat-start` + `showdown-open`（或把进行中的
   Showdown 转为战斗 Showdown）、完成 466.2.c 的攻守指定并保持 466.2.c.1.b 的焦点；`src/combat/flow.ts`
   的 `combat-start-transaction` 阻塞点与多个场景 todo 都依赖它。
2. 定义**同时战斗伤害的原子批量提交任务**：把已完成的两侧分配回执一次性结算为伤害 + 死亡 + 触发收集
   （467.2.c.1.a / 467.2.d），并允许从链上移除已入链的自身死亡触发（808.1.d.1）。
3. 定义 **Recall 游戏动作**及其事件（保留对象身份、伤害与横置状态），供 468.1.a.2 的召回攻击方与清理召回使用。
4. 为 `continuous.combat` 定义图层消费者与查询接口（每单位分配优先级 + 互斥要求求解），使 Tank
   （815）/ Backline（826）的 467.2.c.6–c.9 能在分配内核上表达；当前 `keywordPriority` 只有 `proven-none`。
5. 定义 `EventPattern` 的宿主相对地点选择器（如 `here`）与 `ObjectFilter.sameLocationAs` 的适配，
   使 Deploy 的 `hold` + `here`（830.1.b）与 Disarm 的 `sameLocationAs: "source"`（831.1.d）可注册。
6. 定义分布期**被动/替代效果的应用与顺序选择**接口（467.2.c.5 / 467.2.c.4.a），或明确说明
   `proven-none` 证明与后续工作的边界，使含预防/翻倍的分配场景可执行。

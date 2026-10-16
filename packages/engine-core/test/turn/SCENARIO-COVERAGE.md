# RIFT-124 场景覆盖与验收边界

此批为**部分交付**。新增 Node 测试使用真实 `TurnFlow → ChainEngine → EventPipeline → interpreter → primitives`；局面构造仅用于 given，不手动结算。未修改旧 profile、journal、duel 或批 4 文件。

非战斗 Showdown → Conquer 的完整事件序列已有断言；它不能替代任务卡要求的 Combat → Conquer 端到端验收。后者尚未完成。

下表按当前场景目录逐项登记。“部分/阻塞”仅证明边界保护，不算原场景通过。场景中的旧 timing 别名对应当前 TimingPointId（例如 `turn.begin` → `turn-start`）；依据一律采用本机 CR v1.5。scoring.yaml 尚含 v1.4 引用，本批未改原规格。

## turn

| 场景 id | 状态 | 测试/未覆盖原因 |
| --- | --- | --- |
| `turn-phase-sequence-full` | 部分 | 从合法初始局面执行两个完整回合；未提供任意中间阶段反序列化入口。 |
| `turn-awaken-readies-all-controlled` | 部分 | 覆盖无 Stun 的单位、装备、符文；Stun 路径显式 blocked。 |
| `turn-beginning-trigger-goes-on-chain` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-scoring-step-hold-scores-point` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `turn-channel-phase-two-runes-ready` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-channel-partial-when-rune-deck-short` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-draw-phase-draws-one` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-draw-burnout-recycles-trash-and-gives-point` | 部分/阻塞 | 缺少 Burn Out 规则事务；测试只断言 blocked。 |
| `turn-burnout-repeated-until-opponent-wins` | 未做 | Burn Out 规则事务尚缺。 |
| `turn-main-phase-priority-and-rune-pool-empty` | 部分/阻塞 | 缺少 empty-rune-pool 动作；测试只断言 blocked 且资源未变。 |
| `turn-main-phase-free-order-actions` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |
| `turn-end-main-on-no-discretionary` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |
| `turn-ending-step-eot-triggers-on-chain` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-expiration-heals-all-units` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-expiration-this-turn-effects-expire` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-expiration-empties-rune-pool` | 部分/阻塞 | 同上，未实现非空符文池清空。 |
| `turn-expiration-loops-when-fepr-occurs` | 未做 | 依赖特征变化时点/延迟触发生命周期契约，未近似实现。 |
| `turn-eot-and-at-end-of-this-turn-synonymous` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |
| `turn-eot-delayed-trigger-not-generated-after-ending-step` | 未做 | 依赖特征变化时点/延迟触发生命周期契约，未近似实现。 |
| `turn-cleanup-blocks-finalize-and-priority` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-cleanup-deferred-during-resolution` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-cleanup-chains-to-fixed-point` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-special-cleanup-repeat-is-normal` | 部分 | 覆盖治疗特殊步骤只执行一次；未实现到期特征变化触发检测。 |
| `turn-victory-check-in-cleanup-step-one` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `turn-negative-draw-as-discretionary` | 未做 | 本驱动只提供受控阶段动作，无通用 wire 命令分发器。 |
| `turn-negative-ready-as-discretionary` | 未做 | 本驱动只提供受控阶段动作，无通用 wire 命令分发器。 |
| `turn-negative-channel-as-discretionary` | 未做 | 本驱动只提供受控阶段动作，无通用 wire 命令分发器。 |
| `turn-negative-opponent-action-in-main` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-negative-action-spell-in-closed-state` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |
| `turn-negative-end-turn-while-chain-exists` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-negative-burnout-never-voluntary` | 未做 | Burn Out 规则事务尚缺。 |
| `turn-simultaneous-phase-triggers-turn-order` | 部分 | 覆盖同方排序选择回滚与恢复；未覆盖完整双方 APNAP 组合。 |
| `turn-awaken-already-ready-noop` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-eot-text-lost-when-object-changes-zone` | 未做 | 依赖特征变化时点/延迟触发生命周期契约，未近似实现。 |
| `turn-first-turn-second-player-extra-channel` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-first-turn-skip-draw-not-default` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |
| `turn-pending-item-added-cleanup-before-finalize` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |
| `turn-cleanup-between-phase-transitions` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |
| `turn-phases-cannot-skip` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-play-continues-until-win` | 完成 | `turn/flow.test.mjs` 中同名测试。 |
| `turn-turn-player-definition-visible-in-priority` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |
| `turn-cleanup-invoked-on-object-entering-board` | 未做 | 未在本批新增该完整 YAML 场景；不以同类断言冒充场景通过。 |

## combat

| 场景 id | 状态 | 测试/未覆盖原因 |
| --- | --- | --- |
| `combat-move-opens-noncombat-showdown-contested` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `combat-move-to-enemy-stages-combat-opens-combat-showdown` | 部分/阻塞 | 已验证真实效果移动和战斗 staged；开启需要批 4 原子时点波。 |
| `combat-focus-does-not-pass-after-trigger-opened-chain` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-focus-passes-after-player-chain` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `combat-showdown-ends-after-all-pass` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-noncombat-showdown-control-established` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `combat-defender-mid-showdown-move-converts-to-combat-showdown` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-negative-nonfocus-player-cannot-play` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `combat-assign-full-lethal-before-spreading` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-negative-cannot-spread-below-lethal` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-assign-capped-at-lethal-with-existing-damage` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-negative-assign-more-than-lethal` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-tank-forces-first-assignment` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-negative-bypass-tank-assignment` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-two-tanks-free-order-among-same-priority` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-tank-plus-backline-conflict-choose-one` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-undamageable-unit-exempt-from-mandatory-assignment` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-damage-dealt-simultaneously-shared-deathknell` | 部分/阻塞 | 缺少同时伤害原子批量提交；测试只断言 blocked 和状态不变。 |
| `combat-attacker-sums-might-defender-assigns-back` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-negative-might-sums-as-zero` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-prevent-and-doubling-apply-at-assignment-controller-orders` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-assignment-accounts-for-doubling-minimum-applied` | 未做 | 基础分配叶子内核保持不变；批 5 Combat 未开启，未移植该 YAML 场景。 |
| `combat-no-result-recalls-attackers-when-defenders-remain` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-attacker-wins-conquers-battlefield` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-both-sides-wiped-no-result-battlefield-uncontrolled` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-heal-in-combat-cleanup-before-result` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-staged-combat-fizzles-when-side-leaves` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-negative-move-into-ongoing-combat-battlefield` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-deploy-gear-becomes-unit-stages-showdown-orianna` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-attached-gear-becomes-unit-detaches` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-negative-attach-unit-noop` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-deathknell-pending-before-trash` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-deathknell-removed-when-death-replaced` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-disarm-single-trigger-on-attack` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-disarm-multiple-instances-merge-sum` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-disarm-checked-once-per-combat` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-disarm-first-attack-requirement-skipped` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |
| `combat-new-arrivals-gain-designation-next-cleanup` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-turn-player-chooses-which-combat-first` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-negative-unit-cannot-be-played-to-enemy-battlefield` | 未做 | Combat 开始/转换/同时伤害/特殊清理依赖批 4 规则事务，未实现该场景。 |
| `combat-deploy-hold-kills-enemy-gear` | 未做 | 依赖 Combat 事务或卡牌/关键词程序；未近似实现。 |

## scoring

| 场景 id | 状态 | 测试/未覆盖原因 |
| --- | --- | --- |
| `scoring-hold-basic-one-point` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-hold-multiple-battlefields-same-step` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-hold-not-turn-player` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-hold-only-in-scoring-step` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-hold-requires-current-control` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-hold-no-units-but-controller` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-hold-while-contested` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-hold-at-final-point-still-scores` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `scoring-hold-at-or-above-victory-still-scores` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-conquer-basic-on-control` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-conquer-via-noncombat-showdown` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `scoring-no-conquer-without-control-event` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-no-result-combat-no-conquer` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-no-conquer-when-already-controller` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-conquer-not-turn-player` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-once-per-turn-hold-then-conquer-blocked` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-once-per-turn-is-per-player` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-ledger-resets-next-turn` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `scoring-final-point-conquer-single-battlefield-draws` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `scoring-final-point-second-conquer-after-hold-scores` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-final-point-above-victory-still-restricted` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-ability-point-no-final-point-restriction` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-triggers-fire-on-score-conquer-hold` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `scoring-trigger-fires-on-final-point-draw` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `scoring-victory-unique-leader-at-cleanup` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-victory-tie-at-victory-score-continues` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-victory-not-checked-midturn` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-ability-point-past-victory-wins-at-cleanup` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-victory-score-altered-by-effect` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-points-never-negative` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-zero-loss-no-trigger` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-burnout-draw-empty-grants-point` | 未做 | Burn Out 规则事务尚缺。 |
| `scoring-v15-victory-check-moved-to-cleanup` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-deploy-gear-destroyed-on-opponent-hold` | 未做 | 依赖 Deploy 卡牌程序，未接卡牌专用行为。 |
| `scoring-deploy-gear-survives-own-hold` | 未做 | 依赖 Deploy 卡牌程序，未接卡牌专用行为。 |
| `scoring-deploy-gear-survives-conquer` | 未做 | 依赖 Deploy 卡牌程序，未接卡牌专用行为。 |
| `scoring-control-lost-at-open-cleanup-no-score` | 完成 | `combat/flow.test.mjs` 中同名测试。 |
| `scoring-reconquer-after-losing-battlefield` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |
| `scoring-duel-victory-score-eight-two-battlefields` | 未做 | 未在本批新增完整 YAML 场景；旧 scoring 叶子内核不作改动。 |

## 补充覆盖

- priority：复用批 4 的 Focus/Priority；新增测试覆盖当前焦点、非持焦点玩家拒绝、玩家链关闭后的焦点传递。
- movement：真实 `effect.move` 从基地进入战场、离开控制中的战场、Contested 动作波；Standard Move 在 Exhaust 前显式 blocked。

## 计数

部分 4, 完成 29, 部分/阻塞 5, 未做 84。这些是规格登记数，不是测试通过数。

## 验证证据

命令及结果保存在 `/tmp/RIFT-124-engine-batch5-turn-combat/verification.json` 和同目录各项 `.log`；聚焦日志为 `focused.log`。以本轮实际日志为准，不沿用历史基线数字。

# 场景 ID 对照

由 `node packages/engine-core/test/chain/scenario-coverage.mjs` 生成。覆盖口径见 README；不等同于完整卡牌/战斗验收。

## chain：35/36

| 场景 ID | 状态 / 对照 |
| --- | --- |
| chain-spell-lifecycle-pending-finalize-resolve | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-play-creates-closed-state | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-unit-gear-resolve-immediately-on-finalize | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-add-ability-resolves-immediately | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-lifo-resolution-order | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-pass-not-resolve-if-item-added | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-reaction-added-restarts-finalize | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-simultaneous-triggers-same-player-orders | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-simultaneous-triggers-turn-order | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-chronobreak-multiplayer-turn-order | 未覆盖：命名卡程序与多个拥有者的 Play 编排未接入；不能用手工加入单位链项冒充 Chronobreak。 |
| chain-trigger-added-during-closed-state | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-optional-trigger-declined-removed | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-trigger-no-legal-options-removed | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-trigger-cost-declined-not-countered | 覆盖：[测试](../../test/chain/adapters.test.mjs) |
| chain-action-spell-rejected-in-closed | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-reaction-spell-allowed-in-closed | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-conditional-reaction-checked-at-legality | 覆盖：[测试](../../test/chain/adapters.test.mjs) |
| chain-non-action-rejected-in-showdown-open | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-action-spell-allowed-in-showdown-open | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-non-turn-player-priority-in-closed | 覆盖：[测试](../../test/chain/adapters.test.mjs) |
| chain-priority-after-resolve-newest-controller | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-phase-advances-when-no-actions | 覆盖：[测试](../../test/chain/adapters.test.mjs) |
| chain-countered-spell-not-played-no-refund | 覆盖：[测试](../../test/chain/adapters.test.mjs) |
| chain-pending-item-not-targetable | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-cost-cannot-pay-finalize-fails | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-conditional-reaction-lost-before-legality | 覆盖：[测试](../../test/chain/adapters.test.mjs) |
| chain-no-cleanup-during-resolution | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-cleanup-after-transitions-and-chain-events | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-cleanup-fixed-point | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-focus-passes-after-showdown-chain | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-focus-not-passed-after-trigger-opened-chain | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-play-effects-after-unit-boarded | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-accelerate-paid-enters-ready | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-multiple-pending-finalized-oldest-first | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-reflexive-trigger-added-during-resolution | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |
| chain-finalize-does-not-pass-priority | 覆盖：[测试](../../test/chain/chain-scenarios.test.mjs) |

## priority：39/41

| 场景 ID | 状态 / 对照 |
| --- | --- |
| priority-neutral-open-default-main | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-chain-exists-closes-state | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-neutral-closed-no-showdown | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-showdown-open-on-contested | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-showdown-closed-during-chain | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-no-chain-open-no-showdown-neutral | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-focus-cleared-when-neutral | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-no-priority-no-discretionary | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-non-turn-player-no-priority-neutral-open | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-next-chain-controller-gains-priority | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-priority-passes-in-turn-order | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-priority-taken-not-created | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-awaken-phase-no-priority | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-no-priority-during-cleanup | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-contested-player-gains-focus | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-gaining-focus-grants-priority | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-pass-priority-retains-focus | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-focus-needs-priority-to-act | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-chain-resolution-passes-focus | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-triggered-chain-no-focus-pass | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-spell-action-open-own-turn | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-spell-no-action-rejected-showdown-open | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-action-spell-showdown-open | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-action-spell-rejected-closed | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-reaction-spell-closed | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-activated-no-action-rejected-showdown | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-activated-action-showdown | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-activated-reaction-closed | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-finalizing-does-not-pass-priority | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-oldest-pending-finalizes-first | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-unit-resolves-on-finalize | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-add-ability-resolves-on-finalize | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-newest-finalized-resolves-first | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-resolve-after-all-pass | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-priority-returns-after-resolve | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-passes-reset-when-item-added | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-showdown-ends-after-all-pass-focus | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-noncombat-showdown-conquer | 未覆盖：非战斗对决后建立控制、征服由 scoring/combat 任务负责；本层已验证关闭及焦点。 |
| priority-combat-showdown-proceeds-to-damage | 未覆盖：后续战斗伤害编排属于 combat 任务，未改范围外模块。 |
| priority-turn-player-declares-end | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |
| priority-simultaneous-triggers-turn-order | 覆盖：[测试](../../test/chain/priority-scenarios.test.mjs) |

## triggers：45/56

| 场景 ID | 状态 / 对照 |
| --- | --- |
| triggers-condition-clause-true | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-condition-clause-false | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-condition-clause-not-adjacent | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-enters-zone-same-time-as-condition | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-leaves-zone-same-time-as-condition | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-leaving-board-before-zone-change | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-deathknell-processed-before-trash | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-recall-does-not-trigger-move | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-countered-play-no-trigger | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-may-at-finalize-perform | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-may-at-finalize-decline | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-may-inside-effect-resolves-on-resolution | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-cost-within-instructions-base-cost | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-cost-within-instructions-decline-pay | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-no-legal-options-removed | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-simultaneous-own-choice-order | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-simultaneous-turn-order | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-once-per-turn-cap | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-once-per-turn-decline-preserves | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-attack-trigger-once-per-combat | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-attack-trigger-condition-unmet | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-disarm-merged-single-trigger | 未覆盖：关键词展开的 Disarm 合并由 keyword 层提供，本层不解释关键词或卡牌文字。 |
| triggers-condition-info-locked-at-trigger | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-control-change-no-mistarget | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-reflexive-single | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-reflexive-n-times | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-reflexive-no-condition-always | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-play-effect-after-board | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-other-object-play-not-play-effect | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-targeting-effect | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-conquer-unit-present | 未覆盖：需要 scoring 的真实征服动作及单位在场判定，不能用时点注入冒充完整场景。 |
| triggers-conquer-point-replaced-still-triggers | 未覆盖：需要征服与得分两个独立动作的 scoring 接线。 |
| triggers-hold-unit-present | 未覆盖：需要 scoring 的真实固守及单位在场判定。 |
| triggers-hold-point-replaced-still-triggers | 未覆盖：需要固守与得分两个独立动作的 scoring 接线。 |
| triggers-activate-named-trigger-checks-other-conditions | 未覆盖：命名触发激活缺内部入口；已列契约变更请求，不绕过其余条件。 |
| triggers-activate-named-trigger-not-real-event | 未覆盖：同上；不合成未发生的攻击、征服或固守事件。 |
| triggers-replacement-instead-basic | 覆盖：[测试](../../test/events/replacement-scenarios.test.mjs) |
| triggers-replacement-enters-ready | 覆盖：[测试](../../test/events/replacement-scenarios.test.mjs) |
| triggers-replacement-once-per-event | 覆盖：[测试](../../test/events/replacement-scenarios.test.mjs) |
| triggers-replacement-order-by-controller | 覆盖：[测试](../../test/events/replacement-scenarios.test.mjs) |
| triggers-replacement-inherits-modifications | 覆盖：[测试](../../test/events/replacement-scenarios.test.mjs) |
| triggers-replacement-not-applied-preserves-turn | 覆盖：[测试](../../test/events/replacement-scenarios.test.mjs) |
| triggers-replacement-secret-zone-simultaneous | 未覆盖：秘密区域“as reveal/look”例外需要状态执行器提供同刻观察及替代协议，普通事前拦截不足。 |
| triggers-replacement-must-be-in-zone-before-event | 覆盖：[测试](../../test/events/replacement-scenarios.test.mjs) |
| triggers-delayed-end-of-turn-this-turn | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-delayed-window-ended-not-generated | 未覆盖：原语未传延迟窗口期限，见契约变更请求 3。 |
| triggers-delayed-source-left-board | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-zone-change-removes-granted-text | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-ekko-deathknell-recycle-cost | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-closed-state-can-trigger | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-trigger-not-priority-action | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-permanent-trigger-only-on-board | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-off-board-self-describing-context | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |
| triggers-nth-time-simultaneous-pick-one | 未覆盖：需要第 N 次事件资格和同刻择一的卡牌/历史适配器，不把 once 偷换成第 N 次。 |
| triggers-combat-attacker-first-then-defender | 未覆盖：466.2.d.1 要求 combat 提供攻守分组顺序；普通触发仍严格使用 303.2.a 的回合顺序。 |
| triggers-pending-pauses-for-resolution | 覆盖：[测试](../../test/events/pipeline-scenarios.test.mjs) |

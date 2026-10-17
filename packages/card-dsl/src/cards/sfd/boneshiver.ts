import type { CardProgram } from "../../ir/index.js";

/**
 * Boneshiver (sfd-118-221) — Gear, 3 Energy, no printed Power, Might 2, Body,
 * tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-118-221):
 *   "[Equip] :rb_energy_1::rb_rune_body: (:rb_energy_1::rb_rune_body:: Attach this
 *    to a unit you control.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.a: Equip is an Activated Ability keyword present on Equipment Gear.
 * - 818.1.c / 818.1.c.2: formatted "Equip [Cost]" and functionally short for
 *   "[Cost]: Attach this gear to a unit you control."
 * - 135.2.e.4: the printed Equip cost is one Energy plus one Body Power (two resource
 *   symbols); the card-level 3 Energy is the play cost, not the Equip cost.
 *
 * status: judge-required. The card declares the keyword (cards/README.md §5); the
 * merged Equip expansion already carries the effect.attach body and the
 * controlled-unit target, and its declarative cost component is exercised by the
 * golden. Two merged pieces are still missing before the activation can run:
 * 1. the printed Equip cost cannot be paid: cost/plan-values.ts readCost blocks
 *    the expansion's cost.payments [{ kind: "equip" }] with CostPlanError reason
 *    "judge-required" / "Unsupported payment kind: equip";
 * 2. the printed runes cannot reach KeywordDef.expand: the frozen KeywordAbility
 *    (contract 3.1) carries only kind/keyword/value, and no merged card-program
 *    consumer passes contract 3.8.3 params.cost for this card.
 */
const equip = {
  // Printed "Equip [1][Body]": two resource symbols (1 Energy + 1 Body Power).
  // value counts the printed resource symbols and costDomain records the Power rune.
  kind: "keyword",
  keyword: "equip",
  value: 2,
  costDomain: "Body"
} as const;

export default {
  canonicalCardId: "card.hash-fafaf203c1a2733970ae4f8f4051d2c1b16da75c5e2e637905f8fce0d6287a75",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 的启动尚不可执行，两处依赖未合入：(1) 已合入的 Equip 展开（effects/keywords/Equip.ts）声明 " +
    "cost.payments [{ kind: \"equip\" }]，费用管线 cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，" +
    "buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "(2) 印刷的 Equip 费用（1 Energy + 1 Body Power，CR 818.1.c / 135.2.e.4）无法到达 KeywordDef.expand：" +
    "契约 3.1 的 KeywordAbility 只有 kind/keyword/value，合并的卡牌程序消费方没有传契约 3.8.3 的 params.cost。" +
    "已合入的 effect.attach 半段（附着自己的单位）由 golden 真实执行，但该局部证据不足以让启动可执行。" +
    "818.1.c.3/.c.4（非资源费用与改费文本）对本卡不适用。依赖：Equip 费用支付种类、卡牌程序 → 关键词展开的 params 接线。",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_energy_1::rb_rune_body: (:rb_energy_1::rb_rune_body:: Attach this to a unit you control.)"
} satisfies CardProgram;

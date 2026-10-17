import type { CardProgram } from "../../ir/index.js";

/**
 * Boots of Swiftness (sfd-133-221) — Gear, 3 Energy, no printed Power,
 * Might 2, Chaos, tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-133-221):
 *   "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.a: Equip is an Activated Ability keyword present on Equipment Gear.
 * - 818.1.c / 818.1.c.2: formatted "Equip [Cost]" and functionally short for
 *   "[Cost]: Attach this gear to a unit you control."
 * - 135.2.e.4: the printed :rb_rune_chaos: is one Chaos Power cost; the Equip cost
 *   has no Energy (the card-level 3 Energy is the play cost, not the Equip cost).
 *
 * status: judge-required. The card declares the keyword (cards/README.md §5); the
 * merged Equip expansion already carries the effect.attach body and the
 * controlled-unit target, and its declarative cost component is exercised by the
 * golden. Two merged pieces are still missing before the activation can run:
 * 1. the printed Equip cost cannot be paid: cost/plan-values.ts readCost blocks
 *    the expansion's cost.payments [{ kind: "equip" }] with CostPlanError reason
 *    "judge-required" / "Unsupported payment kind: equip";
 * 2. the printed rune cannot reach KeywordDef.expand: the frozen KeywordAbility
 *    (contract 3.1) carries only kind/keyword/value, and no merged card-program
 *    consumer passes contract 3.8.3 params.cost for this card.
 */
const equip = {
  // Printed "Equip [Chaos]": one resource symbol, the Chaos Power rune. value
  // counts the printed resource symbols and costDomain records the Power rune.
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Chaos"
} as const;

export default {
  canonicalCardId: "card.hash-a22e6e418137f242aaa2ac6403b7a752bfc243cecc9d372bc3dfc04dabced9e0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 的启动尚不可执行，两处依赖未合入：(1) 已合入的 Equip 展开（effects/keywords/Equip.ts）声明 " +
    "cost.payments [{ kind: \"equip\" }]，费用管线 cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，" +
    "buildCostPlan 抛 CostPlanError（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；" +
    "(2) 印刷的 Equip 费用（1 Chaos Power，CR 818.1.c）无法到达 KeywordDef.expand：契约 3.1 的 KeywordAbility 只有 " +
    "kind/keyword/value，合并的卡牌程序消费方没有传契约 3.8.3 的 params.cost。" +
    "已合入的 effect.attach 半段（附着自己的单位）由 golden 真实执行，但该局部证据不足以让启动可执行。" +
    "818.1.c.3/.c.4（非资源费用与改费文本）对本卡不适用。依赖：Equip 费用支付种类、params.cost 接线。",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)"
} satisfies CardProgram;

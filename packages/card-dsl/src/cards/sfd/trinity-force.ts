import type { CardProgram } from "../../ir/index.js";

/**
 * Trinity Force (sfd-115-221) — Gear, 4 Energy, no printed Power, Might 2,
 * Body, tag Equipment.
 *
 * sourceText (verbatim from packages/card-data/data/deck-catalog.json sfd-115-221):
 *   "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
 *
 * Rules (CR v1.5):
 * - 818.1 / 818.1.a: Equip is an Activated Ability keyword present on Equipment Gear.
 * - 818.1.c / 818.1.c.2: formatted "Equip [Cost]" and functionally short for
 *   "[Cost]: Attach this gear to a unit you control."
 * - 135.2.e.4: the printed :rb_rune_body: is one Body Power cost; the Equip cost has
 *   no Energy (the card-level 4 Energy is the play cost, not the Equip cost).
 *
 * status: judge-required. The merged Equip expansion (RIFT-87/RIFT-257) produces its
 * activated ability and its effect.attach body really attaches this gear (the golden
 * drives that expansion and the attached state); two gaps remain:
 * 1. the printed Equip cost cannot reach KeywordDef.expand. Contract 3.8.3 defines
 *    `params.cost` on KeywordDef, but programs/keywords.ts still calls
 *    `def.expand({ value, host })` with no params, and contract 3.1's KeywordAbility
 *    has no field that carries a printed cost either.
 * 2. even with the cost in hand, the merged Equip expansion declares
 *    `cost.payments [{ kind: "equip" }]`, which cost/plan-values.ts readCost blocks
 *    with CostPlanError reason "judge-required" ("Unsupported payment kind: equip").
 *    cost.pay / cost.modify are not merged at all (RIFT-261).
 * Nothing is approximated: the Equip activation is never executed at full price or
 * with a substitute rune.
 */
const equip = {
  // Printed "Equip [Body]": one resource symbol, the Body Power rune. value
  // counts the printed resource symbols and costDomain records the Power rune.
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Body"
} as const;

export default {
  canonicalCardId: "card.hash-e6073f232b1dbf7483b03684f042e36bd6c5692386fa16bce43630d890454681",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Equip] 的启动费用仍不可支付：(1) 印刷费用无法到达 KeywordDef.expand——契约 3.8.3 已定义 params.cost，" +
    "但 programs/keywords.ts 仍以 `def.expand({ value, host })` 调用、不传 params，且契约 3.1 的 KeywordAbility 没有承载印刷费用的字段；" +
    "(2) 即使拿到费用，已合入的 Equip 展开（RIFT-87）声明 payments: [{ kind: \"equip\" }]，" +
    "cost/plan-values.ts 的 readCost 对未知支付种类调用 blocked，实测 buildCostPlan 抛 CostPlanError" +
    "（reason \"judge-required\"，message \"Unsupported payment kind: equip\"）；cost.pay / cost.modify 也尚未合入（RIFT-261）。" +
    "已可真实执行的部分：Equip 展开的 activated 能力（818.1.b）与 effect.attach 本体（818.2），golden 用真实展开 + 参考内核执行并断言附着结果。" +
    "印刷 Equip 费用为 1 个 Body 符文（:rb_rune_body:，无能量符号）；不近似实现（不以全价启动、不用具名符文替代）。" +
    "依赖：RIFT-261（cost.pay/cost.modify）与 KeywordDef params.cost 的消费接线。",
  abilities: [equip],
  sourceText:
    "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)"
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * World Atlas — sfd-086-221 (CR v1.5 818.1.b/c).
 * Printed Equip costs one Mind Power. Keyword expansion and attachment exist;
 * the printed ability cost must reach the existing Finalize payment pipeline.
 */
// Printed "Equip [Mind]": one Mind Power rune and no Energy symbol. value counts
// the printed resource symbols and costDomain records the Power rune (the same
// extension-field convention the sibling Equipment cards use); contract 3.1's
// KeywordAbility still has no field for the printed cost, so nothing consumes it
// yet (see judgeReason).
const equip = {
  kind: "keyword",
  keyword: "equip",
  value: 1,
  costDomain: "Mind"
} as const;

export default {
  canonicalCardId: "card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Equip 的印刷启动费用仍缺绑定（818.1.c）：KeywordAbility 不承载 CostSpec，programs/keywords.ts 只传 value/host，未把 params.cost 交给 Equip 展开；value:1 与 costDomain:Mind 不能代替权威费用。Equip 展开仍使用未映射的 payments kind:equip，需要改为实际 Mind Power 启动费用并交给现有费用计划/支付管线。cost.pay/cost.modify 已存在，effect.attach 子效果也可执行；缺的是印刷 Equip 费用的传递与 Finalize 消费。不近似实现。",
  abilities: [equip],
  sourceText: "[Equip] :rb_rune_mind: (:rb_rune_mind:: Attach this to a unit you control.)"
} satisfies CardProgram;

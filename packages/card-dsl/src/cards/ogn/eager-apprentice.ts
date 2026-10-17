import type { CardProgram } from "../../ir/index.js";

/**
 * Eager Apprentice — CR v1.5 356.4.c–f.
 * cost.modify/cost.pay already execute discounts and per-discount minima.
 * The remaining boundary is the static spell-discount subscription at Finalize.
 */
export default {
  canonicalCardId: "card.hash-e5d8b2e1e9ee0d9e2669fae947f4252a33dfc970df9cd39ad8477263b66fccc6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺把 continuous.cost-modification 静态效果按宿主在战场的条件、打出玩家和 spell 类型收集为 Chain Finalize 的 CostPlanInput.discounts。programs/statics.ts 无费用层映射，programs/play.ts 未传递该折扣（CR 356.4.c/356.4.d/356.4.e）；不能把减费放到结算正文中。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -1 },
        minimum: { kind: "constant", value: 1 },
        appliesTo: { type: "spell", controller: "controller" }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: { object: "self", location: "battlefield" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "While I'm at a battlefield, the Energy costs for spells you play is reduced by :rb_energy_1:, to a minimum of :rb_energy_1:."
} satisfies CardProgram;

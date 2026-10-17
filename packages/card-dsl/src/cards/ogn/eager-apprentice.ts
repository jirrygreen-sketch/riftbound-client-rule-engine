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
    "仍缺 continuous.cost-modification 的静态费用收集器：programs/statics.ts 未消费该效果，programs/play.ts 未把宿主当前处于战场、施放者为其控制者且卡牌为 spell 的条件折扣传入 Chain Finalize 的 CostPlanInput.discounts（CR 356.4.a/356.4.d/356.4.e）。cost.modify/cost.pay 已支持减费及每条折扣自己的最低值；剩余缺口是 Finalize 绑定和宿主移动后的条件重验。",
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

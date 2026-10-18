import type { CardProgram } from "../../ir/index.js";

/**
 * Eager Apprentice — CR v1.5 356.4.c–f.
 * cost.modify/cost.pay already execute discounts and per-discount minima.
 * cost/discounts now collects this declaration and rechecks its host condition.
 * The remaining boundary is binding that collector to production Finalize.
 */
export default {
  canonicalCardId: "card.hash-e5d8b2e1e9ee0d9e2669fae947f4252a33dfc970df9cd39ad8477263b66fccc6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.cost-modification 到生产 Finalize 的绑定（CR 356.4.a/d/e）：programs/statics.ts 的 layerFor 仍拒绝费用声明，" +
    "chain/engine.ts 仍直接调用 buildCostPlan，未调用已合入的 cost/discounts.finalizeCostPlan 或提供活跃静态来源。" +
    "收集器已能把本卡原始声明转换为 CostPlanInput.discounts，重验宿主在战场、己方 spell 与来源离场，并保留每条折扣的 minimum；" +
    "这些已支持语义不再是缺口，但不能以单独调用收集器证明整卡打出可执行。",
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

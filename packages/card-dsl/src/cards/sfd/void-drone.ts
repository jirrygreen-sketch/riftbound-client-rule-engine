import type { CardProgram } from "../../ir/index.js";

/** Void Drone (sfd-010-221). */
export default {
  canonicalCardId: "card.hash-512a6baf401c344f2932b0402985380ea003a2798bef0dec74998bf39db0f00c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.cost-modification 尚未接入 Finalize 的 CostPlan（programs/statics.ts 的 layerFor 没有该 kind 映射）。cost.modify 已能执行 Energy 减费及零下限；尚需费用消费方保留打出前来源区域，并按 fromZone: not-hand 门控本卡的 [2] 折扣（356.4）。进入 chain 后的当前区域不能代替来源区域，不能给从手牌打出也减费。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        amount: { kind: "constant", value: -2 },
        appliesTo: "self",
        fromZone: "not-hand"
      }
    }
  ],
  sourceText: "I cost :rb_energy_2: less to play from anywhere other than your hand."
} satisfies CardProgram;

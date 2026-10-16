import type { CardProgram } from "../../ir/index.js";

/** Void Drone (sfd-010-221). */
export default {
  canonicalCardId: "card.hash-512a6baf401c344f2932b0402985380ea003a2798bef0dec74998bf39db0f00c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『I cost [2] less to play from anywhere other than your hand』需要把卡牌 static 费用改写接入 CostPlan（缺 cost.modify 与 CardProgram→CostPlan 接线，RIFT-89），" +
    "并需要在打出时按来源区域判断『不是手牌』（not-hand）；当前 CostDiscount/费用消费方没有该区域门控。不能把减费无条件应用到手牌打出。",
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

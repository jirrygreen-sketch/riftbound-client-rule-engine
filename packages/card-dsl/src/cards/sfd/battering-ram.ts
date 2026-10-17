import type { CardProgram } from "../../ir/index.js";

/** Battering Ram (sfd-012-221). */
export default {
  canonicalCardId: "card.hash-cf0a755fb6b4deccfb2863c8b92871864f69bfbf69522b1c4d98870a89afc0c4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『每张本回合已打出的牌减 1，最低费用 1』需要 cost.modify 与 CardProgram→CostPlan 接线（RIFT-9/RIFT-89）；" +
    "当前 Expr.count 只能查询对象集合，不能读取 cards-played-this-turn 的按回合累计打牌历史来产生动态折扣，且 minimum/历史门控没有卡牌侧消费者。保留声明，不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        resource: "energy",
        appliesTo: "self",
        amount: {
          kind: "arithmetic",
          operator: "neg",
          operands: [
            { kind: "count", subject: "cards-played-this-turn", filter: { player: "controller" } }
          ]
        },
        minimum: { kind: "constant", value: 1 },
        history: { scope: "turn", action: "play", player: "controller" }
      }
    }
  ],
  sourceText: "I cost :rb_energy_1: less for each card you've played this turn, to a minimum of :rb_energy_1:."
} satisfies CardProgram;

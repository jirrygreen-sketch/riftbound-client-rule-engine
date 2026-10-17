import type { CardProgram } from "../../ir/index.js";

/**
 * Battering Ram (sfd-012-221).
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-012-221，逐字）:
 *   I cost 1 energy less for each card you played this turn, to a minimum of 1.
 *
 * 规则依据（CR v1.5）：356.4 的每折扣实例最低费用（356.4.e）与费用修改顺序；
 * cost.modify / buildCostPlan 已合入 discounts、minimum 与零地板（356.4.f）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，当前真实缺口：
 * - 没有把卡程序 static 的 continuous.cost-modification 接进打出费用计划的管线
 *   （statics 不映射该 kind，chain finalize 也不读卡程序 static）。
 * - Expr.count 只查询当前对象集合，没有 cards-played-this-turn 的按回合打牌历史
 *   计数来源，折扣数量无处求值。
 * 依赖：卡程序 static→费用接线、按回合打牌历史计数、356.4.e 最低费语义消费。
 * 不近似实现（不把动态折扣写成固定值）。
 */
export default {
  canonicalCardId: "card.hash-cf0a755fb6b4deccfb2863c8b92871864f69bfbf69522b1c4d98870a89afc0c4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『每张本回合已打出的牌减 1，最低费用 1』需要 CardProgram→CostPlan 接线：cost.modify 与 buildCostPlan 已合入 discounts/minimum/零地板，" +
    "但没有任何管线把卡程序 static 的 continuous.cost-modification 接进打出费用计划（statics 不映射该 kind，chain finalize 不读卡程序 static）；" +
    "Expr.count 只查询当前对象集合，没有 cards-played-this-turn 的按回合打牌历史计数来源，折扣数量无处求值；" +
    "通用测试台实测：本卡 static 绑定即抛 Static ability kind continuous.cost-modification has no layer mapping，" +
    "本回合已打出两张牌后打出本卡仍按印刷的 5 能量全额支付。" +
    "356.4.e 的每折扣最低费用语义也没有卡牌侧消费者。保留声明，不近似实现。",
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

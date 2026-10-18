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
 * status 判定（cards/README.md 第 2 节）：judge-required，复核 2026-10-18：
 * - programs/statics.ts 仍不把卡程序 static 的 continuous.cost-modification 接进打出费用计划。
 * - 已合入的 cost/discounts/collect.ts 能在调用方提供 finalizedPlaysThisTurn 时读取
 *   cards-played-this-turn，并应用 356.4.e 的每折扣最低费用；缺的是 chain/engine.ts
 *   将本卡静态绑定和本回合 Finalize 历史传给该收集器。
 * 不把已合入的历史求值能力重复列为缺口，也不把动态折扣写成固定值。
 */
export default {
  canonicalCardId: "card.hash-cf0a755fb6b4deccfb2863c8b92871864f69bfbf69522b1c4d98870a89afc0c4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前唯一阻断是 CardProgram static 到生产 Finalize 的接线（2026-10-18 实测；356.4.e）：" +
    "programs/statics.ts 的 layerFor 对 continuous.cost-modification 仍抛出 " +
    "\"Static ability kind continuous.cost-modification has no layer mapping\"，chain/engine.ts 也没有把 " +
    "本卡静态绑定交给 cost/discounts/collect.ts。该收集器已支持本卡的 cards-played-this-turn 表达式，" +
    "但只有调用方提供 finalizedPlaysThisTurn 才能读取权威本回合 Finalize 历史并应用最低费用；生产打出路径尚未传入这两项，" +
    "所以本卡仍不能按每张已打出牌减 1。已合入的 cost.modify/buildCostPlan 与 356.4.e 最低费语义由局部 golden 覆盖，" +
    "不近似实现。",
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

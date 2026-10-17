import type { CardProgram } from "../../ir/index.js";

/**
 * Thousand-Tailed Watcher — CR v1.5 805, 383.4.a, 355.10.d, 478.1.c.
 * The play trigger binding and the -3 Might body are merged. Accelerate still
 * needs the paid additional-cost decision tied to its delayed entry replacement.
 */
const thousandTailedWatcher = {
  canonicalCardId: "card.hash-0c45b29063c3531b9891e06fa06538c7ff50e7ecd9a1f6f1147e18ee33176c81",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Accelerate] 的费用与入场替代仍缺生产消费（CR 805.1.b、805.2.b、805.6.a）：programs/play.describePlay 不把展开的 accelerate.cost 接入 CostPlan.optionalAdditional，programs/statics.layerFor 也不能绑定该费用声明；" +
    "付费后才安装、且不发出 object-readied 的延迟入场替代尚未接线。cost.pay、可选附加费用规划、关键词展开与 CardProgram 触发注册均已合入，不再作为缺口。" +
    "continuous.might 的敌方集合、-3、minimum 1（478.1.c）与 this-turn 到期已有真实执行证据；整卡等待 Accelerate 的支付决定与替代生命周期绑定。",
  abilities: [
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "watcher.debuff-enemy-units",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -3 },
            duration: { kind: "constant", value: "this-turn" },
            minimum: { kind: "constant", value: 1 },
            // 355.10.d："enemy units" 是按特征选择的一组（无玩家选择），用集合查询表达。
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { zone: "board", type: "unit", controller: "opponent" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "When you play me, give enemy units -3 :rb_might: this turn, to a minimum of 1 :rb_might:."
} satisfies CardProgram;

export default thousandTailedWatcher;

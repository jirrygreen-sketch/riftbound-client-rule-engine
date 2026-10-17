import type { CardProgram } from "../../ir/index.js";

/**
 * Fight or Flight — CR v1.5 811, 806 and 451.
 * The printed Move, Hidden cost planning/payment, and Action speed are wired
 * through the current engine. Hidden is still only a cost marker: the runtime
 * has no Hide/facedown lifecycle or the delayed play permission that consumes it.
 */
const fightOrFlight = {
  canonicalCardId: "card.hash-ae89acfc3272efb2e11f1ffd438022efc8a49ff3d3e37cfa6ede1a1b15bffca7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 Hidden 的运行时消费者：KeywordDef 只展开 cost.hidden，buildHiddenCostPlan/payHiddenCostPlan 目前仅建立并支付 Hide/打出费用计划；没有把手牌或 Champion Zone、己方回合 Open State、控制且无隐藏牌的战场等许可接到 Hide 动作，也没有 facedown Zone incarnation、card-hidden 后从下一回合起的 Reaction、免印刷基础费打出或隐藏战场目标限制的程序生命周期（CR 811.1.b/811.1.c/811.1.d.2）。Action 的 speed/Chain 时机、effect.move 及费用原语已有局部执行证据，但不能替代上述 Hidden 全路径。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // 印刷费用（2 energy，power null）由卡牌本体决定；Finalize 默认按 printed 结算。
      body: [
        {
          id: "fight-or-flight.move-to-base",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "fight-or-flight.unit" } },
            to: { kind: "constant", value: "controller-base" }
          },
          targets: [
            {
              id: "fight-or-flight.unit",
              filter: { type: "unit", zone: "board", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Move a unit from a battlefield to its base."
} satisfies CardProgram;

export default fightOrFlight;

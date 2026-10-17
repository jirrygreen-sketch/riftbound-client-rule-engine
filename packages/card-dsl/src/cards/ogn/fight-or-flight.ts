import type { CardProgram } from "../../ir/index.js";

/**
 * Fight or Flight — CR v1.5 811, 806 and 451.
 * Hidden cost planning/payment and Action timing are merged.
 * The remaining Hidden gap is its Hide/facedown lifecycle, delayed Reaction
 * permission and battlefield restrictions. The printed Move has execution tests.
 */
const fightOrFlight = {
  canonicalCardId: "card.hash-ae89acfc3272efb2e11f1ffd438022efc8a49ff3d3e37cfa6ede1a1b15bffca7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 Hidden KeywordDef 的 cost.hidden 与实际 Hide/facedown 流程绑定：手牌或 Champion Zone、自身回合 Open State、控制且无隐藏牌的战场等 Hide 许可，以及从下一回合起的 Reaction/免基础费打出和隐藏战场目标限制均未接入程序生命周期（CR 811.1.b/811.1.c/811.1.d.2）。buildHiddenCostPlan/payHiddenCostPlan、Action 时机和本卡 Move 已存在；费用支付不能替代上述区域与时机路径。",
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

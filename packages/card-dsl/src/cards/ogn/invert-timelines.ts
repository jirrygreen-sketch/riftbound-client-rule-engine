import type { CardProgram } from "../../ir/index.js";

/**
 * Invert Timelines (ogn-201-298): whole-hand discard, then Draw 4, for every player.
 * CR v1.5 355.10.d/e and 355.18: this is a non-targeting resolution-time sweep;
 * discarding the entire Hand requires no choice of individual cards (423.1.a).
 * effect.discard/effect.draw and programs/ binding are executable. The remaining
 * gap is a runtime player-roster expression and a loop binding each player's
 * identity; repeat only repeats a body without a player variable. The retained
 * body proves the controller's subeffect, not the whole-table sweep.
 */
const invertTimelines = {
  canonicalCardId: "card.hash-2b0d48b46b31dd4d55ffc8e62c6db42641a683f4550c4a410384c03a347a0cc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺全体玩家结算：effect.discard 的 player 只接受单个玩家，effect.draw 的多候选玩家会选择一位而非遍历；" +
    "现有 Expr 无法取得运行时玩家列表，repeat 也不能把每个席位绑定到指令的 player。" +
    "CR 355.10.d、355.10.e、355.18、423.1.a 要求非目标的全体玩家弃整手牌→各抽 4；整手弃牌本身无需选牌。" +
    "保留的 body 仅为控制者的已支持子效果，缺多人遍历与逐玩家引用绑定。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 },
        // Printed Power cost is 1 (Chaos); Power is a symbol count, not a domain list.
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "invert-timelines.discard-hand",
          op: "effect.discard",
          args: {
            // "discards their hand": a whole-hand discard without a card
            // choice. The acting seat is the merged default (190.6.d).
            amount: { kind: "constant", value: "all" }
          }
        },
        {
          id: "invert-timelines.draw-4",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 4 } }
        }
      ]
    }
  ],
  sourceText: "Each player discards their hand, then draws 4."
} satisfies CardProgram;

export default invertTimelines;

import type { CardProgram } from "../../ir/index.js";

/**
 * Invert Timelines — ogn-201-298 (Spell, Chaos, 3 Energy + 1 Chaos Power).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-201-298):
 *   Each player discards their hand, then draws 4.
 *
 * Modeling notes (Core Rules v1.5):
 * - No speed keyword is printed, so the spell defaults to Action timing
 *   (159.2.a).
 * - "Each player discards their hand" covers the whole table at once. Rule
 *   355.10.e explains why nothing here is targeted: the set of objects is
 *   "chosen in whole or in part by other players", and 355.18 puts those
 *   choices on resolution instead of Finalize. "their hand" is the acting
 *   player's own Hand (108.7.b: Hands are private information), so neither
 *   the cards nor the other seats are targets.
 * - "then draws 4" is the next instruction in the printed sequence; the
 *   "then" is sequencing, not a linkedTo result dependency.
 * - The merged effect.discard / effect.draw primitives act on one player per
 *   call: their player argument is an Expr evaluated in the ability context
 *   (contract 3.6), with 190.6.d's implied "you" as the default. Nothing in
 *   the merged instruction set enumerates the roster or repeats an
 *   instruction once per seat, and no Expr yields "each player" as a player
 *   list, so the table-wide sweep cannot be declared without inventing
 *   semantics.
 *
 * Status: judge-required. The body keeps the discard-then-draw structure with
 * the acting seat as the reference shape (exactly the half the golden test
 * executes) and claims no whole-table behavior until the multi-player form is
 * merged.
 */
const invertTimelines = {
  canonicalCardId: "card.hash-2b0d48b46b31dd4d55ffc8e62c6db42641a683f4550c4a410384c03a347a0cc9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「每个玩家各自弃掉手牌再抽 4」的多玩家指令形状：effect.discard / effect.draw 每次只作用于一个玩家，" +
    "其 player 参数是能力上下文中的 Expr；355.10.e / 355.18 要求的「由全体玩家在结算时各自选择自己的手牌」" +
    "没有可表达的选择形状，也没有可产出「每个玩家」席位列表的 Expr 或逐席位重复的控制结构。" +
    "依赖多玩家选择/引用与逐席位结算支持（RIFT-9 target.player 及其 CardProgram 绑定接线 RIFT-257）；当前 IR 只记录行动玩家一侧的" +
    "弃手牌→抽 4 结构，不近似实现整桌效果。",
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

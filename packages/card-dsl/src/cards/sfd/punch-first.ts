import type { CardProgram } from "../../ir/index.js";


/**
 * Punch First (sfd-097-221) — Spell, 1 energy + 2 Body power, Fiora deck.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit +5 :rb_might: this turn.
 *
 * Status: judge-required — the buff is faithfully described below but is not
 * expressible with the merged v1 primitives: there is no instruction primitive
 * for a temporary might modification ("give a unit +N Might this turn");
 * contract 3.6's closed GameAction set has no might-modification action, and
 * effect.buff explicitly leaves temporary Might changes to a layers/
 * "continuous.might" effect that the not-yet-implemented layers system
 * (RIFT-83/84) would consume. Not approximated with Buff counters (702).
 *
 * Speed: the printed [Action] reminder text is part of this printing's ability
 * line, so the program declares { kind: "keyword", keyword: "action" }.
 */
const punchFirst = {
  canonicalCardId: "card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 封闭 GameAction 集合无 might 修改动作，" +
    "effect.buff 文档明确临时 Might 归 layers 的 continuous.might（图层系统未实现，依赖 RIFT-83/84）；不近似实现。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit +5 :rb_might: this turn.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Give a unit +5 Might this turn" — described via the layers
          // contract shape; no merged primitive consumes it yet (judgeReason).
          id: "buff",
          op: "effect.might-modify",
          args: {
            amount: { kind: "literal", value: 5 },
            duration: { kind: "literal", value: "this-turn" },
            target: { kind: "literal", value: "unit" }
          },
          targets: [
            { id: "unit", filter: { type: "unit", zone: "board" }, selection: "one" }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default punchFirst;

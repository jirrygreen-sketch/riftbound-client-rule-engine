import type { CardProgram } from "../../ir/index.js";


/**
 * Stupefy (ogn-095-298) — Spell, 1 energy, Mind.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a unit -1 :rb_might: this turn, to a minimum of 1 :rb_might:. Draw 1.
 *
 * Status: judge-required — the debuff half is faithfully described below but is
 * not expressible with the merged v1 primitives:
 * - there is no instruction primitive for a temporary might modification
 *   ("give a unit -N Might this turn"); contract 3.6's closed GameAction set
 *   has no might-modification action, and effect.buff explicitly leaves
 *   temporary Might changes to a layers/ "continuous.might" effect that the
 *   not-yet-implemented layers system (RIFT-83/84) would consume, including
 *   the printed "to a minimum of 1" clamp (CR 122.5.b: effects cannot reduce
 *   a unit below 1 Might);
 * - the 359.2.c "as much as possible" interplay between an impossible debuff
 *   and the independent "Draw 1" is engine-resolution behaviour that needs
 *   that primitive before it can be exercised.
 * The draw half only uses the merged effect.draw primitive and is covered by
 * the golden test.
 */
const stupefy = {
  canonicalCardId: "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：契约 3.6 封闭 GameAction 集合无 might 修改动作，" +
    "effect.buff 文档明确临时 Might 归 layers 的 continuous.might（图层系统未实现，依赖 RIFT-83/84），" +
    "“to a minimum of 1”的下限钳制（CR 122.5.b）亦无实现路径；不近似实现。Draw 1 部分仅用已合入的 effect.draw。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit -1 :rb_might: this turn, to a minimum of 1 :rb_might:. Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "Give a unit -1 Might this turn, to a minimum of 1" — described via
          // the layers contract shape; no merged primitive consumes it yet
          // (see judgeReason).
          id: "debuff",
          op: "effect.might-modify",
          args: {
            amount: { kind: "literal", value: -1 },
            duration: { kind: "literal", value: "this-turn" },
            minimum: { kind: "literal", value: 1 },
            target: { kind: "literal", value: "unit" }
          },
          targets: [
            { id: "unit", filter: { type: "unit", zone: "board" }, selection: "one" }
          ]
        },
        {
          // "Draw 1." — independent instruction (not linkedTo the debuff), so the
          // 359.2.c "as much as possible" case still draws. Fully expressible with
          // the merged effect.draw primitive.
          id: "draw",
          op: "effect.draw",
          args: { amount: { kind: "literal", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default stupefy;

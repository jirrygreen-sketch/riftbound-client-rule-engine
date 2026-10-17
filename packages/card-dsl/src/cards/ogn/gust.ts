import type { CardProgram } from "../../ir/index.js";

/**
 * Gust (ogn-169-298) — Spell, 1 energy, Chaos.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Return a unit at a battlefield with 3 :rb_might: or less to its owner's hand.
 *
 * Structure (contract 3.1 / 3.2, Core Rules v1.5):
 * - `reaction` keeps the printed [Reaction] keyword (813; spell intrinsic timing
 *   159.2.b); its expansion and the chain admission belong to the keyword
 *   registry and chain/ (contract 3.7).
 * - "Return a unit … to its owner's hand" moves a Board object to Hand. The
 *   unit is a target (355.10.a / 355.9.a.1: "unit" is a Board object, and
 *   choosing it is a choice, not a characteristic query), so the instruction is
 *   `effect.zone` with a TargetSpec and `to: "hand"`; the action layer routes
 *   the card to its OWNER's hand, not the caster's (359.3.e.9 example: 2142
 *   "returns the friendly unit to its owner's hand").
 * - "at a battlefield" is a targeting restriction on the unit, not a second
 *   target (355.10.b); TargetSpec.location records a battlefield restriction,
 *   consumed by target.location at Finalize and Resolve.
 *
 * Status: judge-required — the "with 3 :rb_might: or less" restriction still
 * has no target predicate. Target plans now lock and revalidate ordinary
 * filters, but the filter vocabulary has no comparison against a unit's
 * current Might. The `mightLte: 3` field below remains descriptive until the
 * target binder exposes that comparison to target Finalize and Resolve; no
 * approximate Might test is substituted. The move half uses only
 * the merged effect.zone primitive and is executed in the golden test.
 */
const gust = {
  canonicalCardId: "card.hash-22baca2d2ee27d8cf7c15a3d1d1f215e8c0a3b8fbbe9b0edcd70d888b29a21d5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 355.10.b / 359.3.e.9 的当前 Might ≤ 3 目标限制仍缺候选与 Resolve 重验绑定：programs/filters.ts 不接受 " +
    "mightLte，layers/filter.ts 不消费该数值比较。TargetRequirement 没有对应动态谓词入口；不能用结算时跳过指令替代 Finalize 目标合法性。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "gust.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "gust.unit-at-battlefield" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "gust.unit-at-battlefield",
              filter: {
                type: "unit",
                zone: "board",
                // 描述性占位：见 judgeReason，尚无 Might 比较谓词。
                mightLte: 3
              },
              location: { type: "battlefield" },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Return a unit at a battlefield with 3 :rb_might: or less to its owner's hand."
} satisfies CardProgram;

export default gust;

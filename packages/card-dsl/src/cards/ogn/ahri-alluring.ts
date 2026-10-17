import type { CardProgram } from "../../ir/index.js";

/**
 * Ahri, Alluring (ogn-066-298) — Unit, 5 energy + 1 Calm power, Might 4.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-066-298):
 *   When I hold, you score 1 point.
 *
 * Rules evidence (Core Rules v1.5):
 * - "When I hold" is a Hold Effect (383.4.d, 383.4.d.1): the unit must be
 *   present at a Battlefield while its controller maintains control and gains
 *   a Victory Point during their Beginning Phase (383.4.d.2.a; 471.2, 473.2.b).
 *   The merged closed timing enum has `hold` for exactly this, and the
 *   eligibility wording ("must have been present during the Hold") is the
 *   trigger filter's job.
 * - "you score 1 point" grants one point to the ability's controller; the
 *   merged GameAction vocabulary has a `score` action ({ player, amount }),
 *   and the survey maps "score 1 point" to the effect.score primitive
 *   (22 identities). Reward/points accounting (470.1, 470.2) stays in the
 *   engine.
 *
 * Status: judge-required. effect.score executes, but the hold wave supplies
 * player and battlefieldId without a participant object. The self-anchored
 * EventPattern cannot express the host's presence at that scoring battlefield
 * (383.4.d.2.a), and no event-field/location comparison predicate supplies the
 * missing association. Golden tests inspect a real TurnFlow hold emission.
 */
export default {
  canonicalCardId: "card.hash-4f9cef9a5292a16fac59206baa263b0654606faa95119ee4a76583f82b2a4dac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺自身固守范围（CR 383.4.d.2.a）：turn/flow.ts 的 hold 波只有 player 与 details.battlefieldId，没有参战单位 object；translateTriggerFilter 把 self 锚点变成 objectId，无法关联宿主与该战场的这次固守。尚无读取事件战场并与宿主位置比较的 IR 条件；仅用 player:self 会让其它战场或基地的 Ahri 也执行 effect.score。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: { event: "held", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          // "you score 1 point" — the merged effect.score primitive (RIFT-115)
          // submits the closed `score` GameAction for the ability controller by
          // default (194.1.c / 470.1-3).
          id: "ahri-alluring.score-1",
          op: "effect.score",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When I hold, you score 1 point."
} satisfies CardProgram;

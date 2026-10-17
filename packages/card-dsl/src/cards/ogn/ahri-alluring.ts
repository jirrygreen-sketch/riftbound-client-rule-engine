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
 * Status: judge-required. Both halves now have merged execution support — the
 * `hold` timing point is emitted by the TurnFlow Score wave (turn/flow.ts,
 * rule refs 315.2.b.2 / 471.2 / 473.2.b) and `effect.score` (RIFT-115) awards
 * the point and publishes the `scored` receipt; the golden test executes the
 * score instruction through the real interpreter and reference kernel — but the
 * trigger still cannot enter the chain: the card's nested `{ event, filter }`
 * spelling is rejected by the engine validator (events/trigger-spec.ts
 * EventPattern has no inner `filter` field) and no merged consumer turns a
 * CardProgram's triggered ability into a TriggerRegistration (RIFT-257).
 */
export default {
  canonicalCardId: "card.hash-4f9cef9a5292a16fac59206baa263b0654606faa95119ee4a76583f82b2a4dac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "效果本体已合入并可执行：「you score 1 point」用已注册的 effect.score（RIFT-115；194.1.c/470.1-3 的得点，" +
    "受让者缺省为能力控制者，golden 真实执行并断言只给控制者加 1 分），hold 时点也已由 turn/flow.ts 的 Score 波发射" +
    "（383.4.d、315.2.b.2/471.2/473.2.b）。" +
    "仍缺：本卡的嵌套 { event, filter } 触发拼写被引擎侧 assertTriggerSpec 拒绝（events/trigger-spec.ts 的 EventPattern 没有内层 filter 字段），" +
    "且没有已合入消费方把 CardProgram 的 triggered 能力绑定成 TriggerRegistration（RIFT-257）。依赖：RIFT-257。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: { event: "hold", filter: { source: "self" } }
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

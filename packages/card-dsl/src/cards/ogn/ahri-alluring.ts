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
 * Status: judge-required. Both halves have merged execution support — the
 * `hold` timing point is emitted by the TurnFlow Score wave (turn/flow.ts,
 * rule refs 315.2.b.2 / 471.2 / 473.2.b) and `effect.score` (RIFT-115) awards
 * the point and publishes the `scored` receipt; the golden test executes the
 * score instruction through the real interpreter and reference kernel. The
 * merged CardProgram trigger binding is also merged (RIFT-257,
 * programs/triggers.ts + filters.ts translateTriggerFilter, which resolves the
 * nested `{ filter: { source: 'self' } }` spelling to
 * `{ object: { objectId: host } }` and passes assertTriggerSpec). The
 * remaining gap is the 383.4.d.2.a rule itself: the held emission carries only
 * `{ player, details: { battlefieldId } }` with no participant object, so no
 * merged EventPattern field can express "this unit was present during the
 * Hold". A `player: 'self'` pattern would fire for every Ahri the controller
 * owns instead of the unit that held, and is rejected as an approximation of
 * 383.4.d.2.a. A proof test registers the translated filter through
 * validateTriggerSpec and shows that a real held emission does not match it.
 */
export default {
  canonicalCardId: "card.hash-4f9cef9a5292a16fac59206baa263b0654606faa95119ee4a76583f82b2a4dac",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "效果本体已合入并可执行：「you score 1 point」用已注册的 effect.score（RIFT-115；194.1.c/470.1-3 的得点，" +
    "受让者缺省为能力控制者，golden 真实执行并断言只给控制者加 1 分），hold 时点已由 turn/flow.ts 的 Score 波发射" +
    "（383.4.d、315.2.b.2/471.2/473.2.b），触发绑定也已合入（RIFT-257，programs/triggers.ts 经 " +
    "translateTriggerFilter 把本卡 { filter: { source: 'self' } } 拼写翻译成 object:{objectId:宿主} 并通过 assertTriggerSpec）。" +
    "仍缺 383.4.d.2.a 的自身范围条件：held 发射载荷只有 { player, details:{ battlefieldId } }、没有参战单位 object，" +
    "EventPattern 封闭字段集无法表达「本单位在该战场经历了固守」；player:'self' 只能近似成『控制者的每次固守』，" +
    "会给不相干单位的 Ahri 也挂上触发，属近似实现，不采用。" +
    "证明测试：translateTriggerFilter 产出的 pattern 通过 validateTriggerSpec，但对真实 held 发射 matchesTriggerEvent 返回 false。不近似实现。",
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

import type { CardProgram } from "../../ir/index.js";

/**
 * Amateur Recital (unl-207-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-207-219, 逐字):
 *   "When you hold here, you may move a unit at a battlefield to its base."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here …" is a Hold
 *   Effect; Hold Abilities of anything that references the player Holding are
 *   put on the chain when that player has held (timing point "hold", emitted
 *   by the Beginning Phase scoring step, rule refs 315.2.b.2 / 471.2 / 473.2.b).
 *   383.4.d.2.c: the ability still triggers when the point from Holding is
 *   negated or replaced.
 * - 190.6.a / 190.6.d: "you" is this Battlefield's Controller, which also
 *   makes the choices and controls the ability.
 * - 421 / 448-455: "move a unit at a battlefield to its base" is a
 *   location-to-location Move, not the Standard Move: no exhaust cost and no
 *   Main-Phase gate (451.1). The merged effect.move performs the frozen
 *   move-location action, and `to: "controller-base"` is each moved unit's own
 *   controller's Base (107.1.c) — the printed "its base".
 * - 355.9.a.1 / 355.9.b / 355.10: "a unit at a battlefield" is a specific
 *   public Board object chosen by the effect's controller, so it is a Target
 *   (not a pick) and is locked at Finalize; "at a battlefield" is a targeting
 *   restriction (355.10.b example: "Kill a unit at a battlefield" targets the
 *   unit). The merged ObjectFilter spells that as `location: "battlefield"`,
 *   which layers/filter.ts compares against the object's location type.
 * - 383.3.a / 383.3.a.3 / 383.3.e.2: "you may" is the first part of the
 *   effect, so the finalize decision belongs to the trigger; contract §3.9
 *   still places the chosen instruction inside `choice.optional`.
 *
 * Status: judge-required (re-reviewed 2026-10-17) — the producer gap is gone and
 * the body is executable; two binding gaps remain, neither approximated:
 * 1. the merged producer exists: `turn/flow.ts`'s Score wave publishes the
 *    Beginning Scoring Step's `hold` emission (with details.battlefieldId) into
 *    the single event pipeline, and the golden test asserts that delivery.
 * 2. the `here: true` key has no evaluable anchor in the frozen EventPattern
 *    vocabulary: the static filter cannot reference its own host's runtime
 *    location id. The trigger translator rejects the placeholder key outright
 *    (`Unsupported filter field here`), so the declared trigger cannot be bound
 *    as written — the sibling battlefield programs carry the same placeholder.
 * 3. even with the anchor resolved, no merged path registers a Battlefield's
 *    CardProgram abilities: `attachLifecycle` only binds on
 *    object-enters-board/chain, and battlefields are placed by setup rather than
 *    played, so 190.6.a/190.6.d's "the holding player controls the ability"
 *    binding for a Battlefield program is never wired.
 * The body (choice.optional + effect.move to "controller-base") uses merged
 * primitives and runs through the golden test's real interpreter plus chain
 * adapter.
 *
 * Dependencies: an EventPattern "here" anchor (RIFT-357) and Battlefield setup
 * lifecycle registration, including 190.6's battlefield/event player binding.
 */
export default {
  canonicalCardId: "card.hash-16deedb0db72d0ab2151c19d3fe3648037a218f76385c1a46853b273e5671102",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发侧仍不可执行，三处现状：(1) hold 时点已有生产者——turn/flow.ts 的 Score 波把 Beginning 计分步骤的 " +
    "'hold' 发射（载荷 details.battlefieldId）推进唯一事件管线，golden 断言了该投递（471.2 / 473.2.b）；" +
    "(2) 触发过滤里的 here=true 在封闭 EventPattern 词汇里没有可求值锚点：静态 filter 读不到宿主运行时的位置身份，" +
    "programs/filters.ts 的翻译层会以 \"Unsupported filter field here\" 直接拒绝该占位键，因此按现状无法注册（同 the-papertree、" +
    "ogn/startipped-peak 等战场卡）；(3) 即使锚点落地，也没有已合入路径注册 Battlefield 的 CardProgram 能力：" +
    "attachLifecycle 只在 object-enters-board/chain 时绑定，而战场由 setup 放置而非被打出，" +
    "190.6.a/190.6.d 的战场能力控制者与未受控战场处理同样没有接线。" +
    "能力本体只用已合入原语（choice.optional + effect.move，to: \"controller-base\"），目标形状（355.9/355.10：单位是目标、" +
    "“at a battlefield”是目标限制）与 421/451 的效果移动写在程序里，golden 用真实解释器执行。" +
    "依赖：EventPattern 的 Battlefield here 锚点（位置选择 RIFT-357）与 setup 程序注册/190.6 控制者绑定。",
  sourceText: "When you hold here, you may move a unit at a battlefield to its base.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "When you hold here": the battlefield is the ability host and the
        // holding player is (once wired) its controller (190.6.a/190.6.d).
        // `here`/`player` keep the sibling battlefield spelling until the
        // hold payload binding lands (see judgeReason).
        filter: { event: "hold", here: true, player: "controller" }
      },
      // 383.3.a/383.3.e.2: "you may" as the first part of the effect is the
      // ability's finalize decision.
      optional: true,
      body: [
        {
          id: "amateur-recital.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Move a unit at a battlefield to its base?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "amateur-recital.move",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "amateur-recital.unit-at-battlefield" }
                    },
                    to: { kind: "constant", value: "controller-base" },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "moved" }
                  },
                  targets: [
                    {
                      id: "amateur-recital.unit-at-battlefield",
                      // 355.9.b/355.10.b: "a unit at a battlefield" targets
                      // one unit; the destination is not a choice — "its base"
                      // is fixed by 107.1.c.
                      filter: { type: "unit", zone: "board", location: "battlefield" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

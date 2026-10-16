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
 * Status: judge-required — the trigger cannot run, and the two engine gaps are
 * the same ones the merged battlefield programs record, not approximations:
 * 1. no merged producer emits the `hold` timing point into the chain/events
 *    pipeline: `turn/flow.ts` performs the Beginning Phase scoring through
 *    `scheduleScore`, which commits the `score` game action and raises
 *    `scoring.ts`'s trigger flags; the chain's event pipeline never sees a
 *    `hold` emission, and 383.4.d's "the holding player controls the ability"
 *    (190.6.a/190.6.d) has no binding for a Battlefield program.
 * 2. no merged subscriber turns a CardProgram's triggered ability into a
 *    TriggerRegistration (chain/pipeline register only from trusted kernel
 *    callers), so the body cannot be attached to the timing point.
 * The body itself uses only merged primitives and is executed by the golden
 * test through the real interpreter plus the chain adapter; the trigger half
 * stays judged.
 *
 * Dependencies: RIFT-76/RIFT-120 follow-up (hold emission from the Beginning
 * scoring step into the single event pipeline) and the card-program trigger
 * registration with 190.6 battlefield-controller binding (contract §7.2
 * batch 5).
 */
export default {
  canonicalCardId: "card.hash-16deedb0db72d0ab2151c19d3fe3648037a218f76385c1a46853b273e5671102",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发侧两处已合入缺口，均不近似实现：(1) 「hold」时点没有生产者：Beginning 计分步骤在 turn/flow.ts 的 scheduleScore 里提交 " +
    "score 动作并读取 scoring.ts 的触发标志，chain/events 单管线收不到 hold 发射，190.6.a/190.6.d 的“固守玩家控制该战场能力”" +
    "也没有绑定；(2) 没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration。" +
    "能力本体只用已合入原语（choice.optional + effect.move，to: \"controller-base\"），目标形状（355.9/355.10：单位是目标、" +
    "“at a battlefield”是目标限制）与 421/451 的效果移动写在程序里，golden 用真实解释器执行。" +
    "依赖：RIFT-76/RIFT-120 后续的 hold 发射接入与契约 §7.2 批 5 的卡牌触发注册。",
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

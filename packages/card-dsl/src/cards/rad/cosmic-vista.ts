import type { CardProgram } from "../../ir/index.js";

/**
 * Cosmic Vista (rad-160-167) — Battlefield (domainless, RAD).
 *
 * Printed text:
 *   When you hold here, if your Rune Deck is empty, you score 1 point.
 *
 * Rules evidence (Core Rules v1.5):
 * - 383.1: "When you hold here" is a Triggered Ability; 315.2.b.2 / 471.2 /
 *   473.2.b describe Holding during the Beginning Phase's scoring step, which
 *   is the merged "hold" timing point (events/timing-points.ts).
 * - 383.2.a.1: "if your Rune Deck is empty" immediately follows the trigger
 *   condition, so it is part of the Trigger Condition (not the effect): the
 *   ability does not trigger at all while the Rune Deck is not empty.
 * - 470.1 / 470.2 / 194.1.c: "you score 1 point" is Gaining a Point through an
 *   effect ("Score X points" is how card text refers to Gaining Points), which
 *   is the merged effect.score instruction. It is not Scoring a Battlefield.
 *
 * Status: judge-required (re-checked 2026-10-17 third re-sweep). Three facts,
 * none approximated:
 * - The "hold" timing point is now emitted: turn/flow.ts's scheduleScore
 *   publishes a structural Score wave (hold / score / points-gained) with
 *   details.battlefieldId (RIFT-124 turn workstream); the golden asserts it.
 * - The trigger condition still requires a host.testTrigger adapter: the event
 *   pipeline throws "Trigger condition adapter required" for registrations
 *   carrying a condition when that adapter is absent (no merged production host
 *   supplies one; only parity tests inject their own).
 * - "here" is not in the closed EventPattern vocabulary: assertTriggerSpec
 *   rejects the field with "EventPattern 不允许此字段" and the program adapter's
 *   translateTriggerFilter rejects it with "Unsupported filter field here", so
 *   the source-battlefield anchor cannot be registered even though the emitted
 *   hold payload carries battlefieldId. Verified against the merged code; the
 *   golden asserts both failures. The event *name* is not the problem —
 *   { event: "held", player: "self" } translates and validates fine.
 * The body (effect.score, amount 1) is a merged instruction and is executed by
 * the golden test; the trigger half stays judged.
 */
export default {
  canonicalCardId: "card.hash-6096f8a7ac4a9de3a47f4b906c5922677655ef6d2b97f64352b7057c63cafa87",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口，均不近似实现：" +
    "（1）触发条件「if your Rune Deck is empty」属 TriggerSpec.condition（383.2.a.1），" +
    "但事件管线对带 condition 的注册要求 host.testTrigger，否则抛 \"Trigger condition adapter required\"。" +
    "（2）「when you hold here」的 here 锚点不在封闭 EventPattern 词表里：assertTriggerSpec 抛 \"EventPattern 不允许此字段\"，" +
    "程序绑定路径的 translateTriggerFilter 也抛 \"Unsupported filter field here\"（均已实测），" +
    "因此无法把触发注册到本卡的战场；payload 侧 details.battlefieldId 已随 hold/score 波发出。" +
    "事件名本身不是缺口：{ event: \"held\", player: \"self\" } 可正常翻译并通过校验。" +
    "已合入部分：hold 时点由 turn/flow.ts 的 scheduleScore 随结构化 Score 波（hold / score / points-gained）发出（RIFT-124），" +
    "效果本体「score 1 point」= 获得 1 点（470.1 / 470.2 / 194.1.c）用已合入的 effect.score 表达并有真实执行用例；触发半段保持 judge-required。",
  sourceText: "When you hold here, if your Rune Deck is empty, you score 1 point.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "When you hold here": "self" is the merged PlayerSelector spelling
        // for the ability's controller; "here" is a descriptive placeholder
        // for the source-battlefield anchor the merged EventPattern lacks.
        filter: { event: "held", here: true, player: "self" },
        condition: {
          kind: "compare",
          // "if your Rune Deck is empty": zero objects in the controller's
          // Rune Deck. "self" is the merged spelling for "the ability's
          // controller" in a query filter (the chain context normalizes
          // self -> the ability controller for both controller and owner).
          left: {
            kind: "count",
            subject: "rune-deck",
            filter: { owner: "self", zone: "rune-deck" }
          },
          operator: "eq",
          right: { kind: "constant", value: 0 }
        }
      },
      optional: false,
      body: [
        {
          // "you score 1 point" — Gaining a Point (470.1 / 470.2), one for the
          // ability's controller. effect.score defaults to ctx.controller.
          id: "cosmic-vista.score-1",
          op: "effect.score",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

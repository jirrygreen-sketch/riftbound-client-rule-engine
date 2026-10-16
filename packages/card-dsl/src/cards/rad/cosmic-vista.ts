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
 * Status: judge-required. Two merged gaps, neither approximated:
 * - The trigger condition needs the TriggerSpec condition evaluator: the event
 *   pipeline requires host.testTrigger for any registration that carries a
 *   condition ("Trigger condition adapter required") and no merged host
 *   provides one.
 * - The "hold" timing point is declared in the closed enum but nothing emits
 *   it: the merged scoring primitive returns triggerScore/triggerMethod
 *   (scoring.ts) and the turn executor consumes that result as flags, while
 *   the event pipeline only emits card-played / chain / showdown / cleanup
 *   timings. Until a rules module emits hold, the trigger cannot fire.
 * The body (effect.score, amount 1) is a merged instruction and is executed by
 * the golden test; the trigger half stays judged.
 */
export default {
  canonicalCardId: "card.hash-6096f8a7ac4a9de3a47f4b906c5922677655ef6d2b97f64352b7057c63cafa87",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处已合入缺口：" +
    "（1）触发条件「if your Rune Deck is empty」属 TriggerSpec.condition（383.2.a.1），" +
    "但事件管线对带 condition 的注册要求 host.testTrigger（pipeline.ts 抛 \"Trigger condition adapter required\"），没有任何已合入 host 提供该适配器；" +
    "（2）「hold」时点虽在封闭枚举中，但生产流程没有发出：scoring.ts 的 scoreDuelBattlefield 只返回 triggerScore/triggerMethod 标志，" +
    "turn-executor-v2 按标志消费，事件管线只发 card-played / chain / showdown / cleanup 等时点。" +
    "效果本体「score 1 point」= 获得 1 点（470.1 / 470.2 / 194.1.c）已用已合入的 effect.score 表达并有真实执行用例；触发半段保持 judge-required。不近似实现。",
  sourceText: "When you hold here, if your Rune Deck is empty, you score 1 point.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "When you hold here": "self" is the merged PlayerSelector spelling
        // for the ability's controller; "here" is a descriptive placeholder
        // for the source-battlefield anchor the merged EventPattern lacks.
        filter: { event: "hold", here: true, player: "self" },
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

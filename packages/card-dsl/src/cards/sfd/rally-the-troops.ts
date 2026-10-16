import type { CardProgram } from "../../ir/index.js";

/**
 * Rally the Troops (sfd-166-221) — Spell, 2 energy, Order.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   When a friendly unit is played this turn, buff it. (If it doesn't have a
 *   buff, it gets a +1 :rb_might: buff.)
 *   Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - "When a friendly unit is played this turn, buff it" is a delayed triggered
 *   ability for this turn (382 / 392: it exists only during the stated window,
 *   and 355.5.b: its choices are made when the delayed trigger itself
 *   finalizes, not when the spell does). The spell registers that delayed
 *   trigger from its own play body.
 * - "buff it" is the merged effect.buff primitive (702.2.a: place a Buff
 *   counter; 427.1.b.1: a unit that already has one does not get another),
 *   with the played unit as the delayed trigger's own target.
 * - "Draw 1." is the second, independent instruction of the same spell (158.1:
 *   spells resolve top to bottom) and is not linked to the delayed trigger.
 *
 * Status: judge-required. The delay registration itself is not executable: no
 * `trigger.delayed` instruction is registered, and the "this turn" lifetime
 * needs the continuous duration support tracked as RIFT-91. The buff body uses
 * only merged primitives and the draw is a plain effect.draw, so the golden
 * test exercises those parts directly instead of pretending the registration
 * works.
 */
const rallyTheTroops = {
  canonicalCardId: "card.hash-3e2b0e6be550a6ea91eaca662301cad701e40cd382c25c86b966e45b6858b678",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 trigger.delayed 原语与「本回合」到期窗口：「When a friendly unit is played this turn, buff it」是 CR v1.5 392/393 的延迟触发，" +
    "按 355.5.b 其目标在延迟触发 Finalize 时才选择，到期窗口需要 continuous.duration（未实现，依赖 RIFT-91 的 layers-continuous）；" +
    "effects/instructions/ 没有 trigger.delayed 的已注册实现，registerDelayedTrigger 也不带期限。" +
    "buff 本体（effect.buff，702.2.a）与独立的 Draw 1（effect.draw）用已合入原语表达并在金标测试中直接执行；" +
    "整卡因延迟触发注册缺失保持 judge-required，不近似实现。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "When a friendly unit is played this turn, buff it. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)\n" +
    "Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // The delayed trigger this spell creates. 392: it lasts only during
          // the stated window ("this turn"), which is the missing duration.
          id: "rally-the-troops.register-trigger",
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "card-played" },
            filter: {
              kind: "constant",
              value: { type: "unit", controller: "controller" }
            },
            // The window; no merged primitive consumes it (judgeReason).
            duration: { kind: "constant", value: "this-turn" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "rally-the-troops.buff",
                  op: "effect.buff",
                  args: {
                    mode: { kind: "constant", value: "buff" },
                    // "it" = the unit whose play triggered the delayed ability.
                    target: { kind: "constant", value: "rally-the-troops.played-unit" }
                  },
                  targets: [
                    {
                      id: "rally-the-troops.played-unit",
                      filter: { type: "unit", controller: "controller" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        },
        {
          // "Draw 1." — independent of the delayed registration
          // (359.3.e.11: resolve as much as possible).
          id: "rally-the-troops.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default rallyTheTroops;

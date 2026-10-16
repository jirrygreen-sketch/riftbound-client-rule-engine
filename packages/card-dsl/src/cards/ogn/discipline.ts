import type { CardProgram } from "../../ir/index.js";

/**
 * Discipline (ogn-058-298) — Spell, 2 energy (Calm).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Give a unit +2 :rb_might: this turn. Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a keyword ability expanded by the keyword registry
 *   (contract 3.7); the card only names it.
 * - "a unit" is a target (355.7 / 355.9.a.1: "unit" refers to an object on
 *   the Board unless specified otherwise).
 * - "Draw 1." is effect.draw (414.3), and it is a separate sentence: the
 *   draw is not linked to the Might instruction, so it still resolves when the
 *   Might modification cannot (359.3.e.11 / 359.3.e.14: resolve as much as
 *   possible and do not chain unrelated instructions). The draw half is
 *   executed by the golden test through the real primitive.
 *
 * Status: judge-required — continuous.might now performs the temporary Might
 * registration, and the Draw 1 primitive is independently executable. The
 * remaining gaps are the Reaction timing consumer, CardProgram play binding,
 * and the generic interpreter's argument boundary: it eagerly evaluates
 * effect.draw arguments before effect.draw validates them as Expr values.
 * Not approximated with a Buff counter.
 */
const discipline = {
  canonicalCardId: "card.hash-a1b14db94434084b789c0069291250652a46b455cbb2b5c347c9231af8ac51b5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "continuous.might 已合入：通过 chosen-unit 的 TargetSpec 可真实注册本回合结束到期的 +2 Might；" +
    "effect.draw 也已合入且与 Might 指令独立。整卡仍不能标为 executable：Reaction 关键词的时机许可消费、" +
    "CardProgram play 能力绑定仍依赖 RIFT-257；通用解释器在执行完整 body 时会先求值 effect.draw 的 args，" +
    "而 effect.draw argsSchema 仍要求 Expr，当前会报告“effect.draw args.amount must be an Expr”。" +
    "费用支付接线属于 RIFT-261；不以 Buff 计数近似 Might。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit +2 :rb_might: this turn. Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "Give a unit +2 Might this turn" — temporary Might modification;
          // no merged primitive consumes it (see judgeReason).
          id: "grant-plus-2-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "chosen-unit" }
          },
          targets: [
            {
              id: "chosen-unit",
              filter: { type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Draw 1." — an independent sentence, deliberately not linked to
          // the Might instruction (359.3.e.11/e.14).
          id: "draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default discipline;

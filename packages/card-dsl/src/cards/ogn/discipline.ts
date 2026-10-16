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
 * Status: judge-required — "Give a unit +2 Might this turn" is a temporary
 * Might modification, and no merged primitive performs one. The closed
 * GameAction set of contract 3.6 has no Might-modification action, and
 * effect.buff's own header states that temporary Might changes belong to
 * continuous.might, never to the Buff primitive (CR 703: a Buff contributes
 * +1 Might because it is a counter, which is not the same object as a
 * temporary Might modification). The layers engine can already evaluate such
 * a registration, but no instruction primitive registers one, so the opcode
 * is unregistered. Not approximated with a Buff counter.
 */
const discipline = {
  canonicalCardId: "card.hash-a1b14db94434084b789c0069291250652a46b455cbb2b5c347c9231af8ac51b5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正原语：“Give a unit +2 Might this turn”是带回合期限的临时 Might 修改；" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effect.buff 文件头明确临时 Might 归 continuous.might" +
    "（CR 703 的 Buff 计数与它不是一回事）；layers 引擎已能求值 arithmetic 层持续效果，" +
    "但没有任何 effects/instructions 原语通过 ResolveContext.addContinuous 注册它。" +
    "依赖：continuous.might 指令原语（RIFT-9 清单；RIFT-91 已合入 layers 求值侧）。" +
    "“Draw 1.”（414.3）已合入且与 Might 指令不链接（359.3.e.11/e.14），由 golden 执行。不近似实现。",
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
            duration: { kind: "constant", value: "this-turn" }
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

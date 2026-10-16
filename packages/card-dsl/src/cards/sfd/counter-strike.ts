import type { CardProgram } from "../../ir/index.js";

/**
 * Counter Strike (sfd-194-221) — Spell, 2 energy + 1 Calm/Body power,
 * Calm/Body, tags Jax/Signature.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a unit. The next time that unit would be dealt damage this turn,
 *   prevent it. Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the closed-state
 *   permission is expanded by effects/keywords/Reaction.ts.
 * - "Choose a unit" is a target, not a pick: 355.10.c gives the exact example
 *   ("Choose a friendly unit. The next time it would die this turn, return it
 *   to your hand instead" targets a friendly unit, because "choose a friendly
 *   unit" is not part of the replacement effect). The unit is therefore
 *   declared as a TargetSpec on the instruction that creates the shield.
 * - "The next time that unit would be dealt damage this turn, prevent it" is
 *   a one-shot prevention replacement effect (367-371; 371.1 counts the
 *   "next time" window, and 467.2.c.10 uses this card as its example of a
 *   replacement effect that still leaves the unit able to be dealt damage).
 *   The frozen GameAction set has no prevent action (only damage) and no
 *   replacement primitive is registered, so the shield cannot be created by
 *   any merged op.
 * - "Draw 1." is a second, independent instruction (158.1) and stays
 *   unlinked: 359.3.e.11 keeps the draw when the shield cannot be created.
 *
 * Status: judge-required. The target declaration, the duration and the
 * one-shot lifetime are described; the prevention half is not approximated,
 * and the draw half is executed by the golden test.
 */
const counterStrike = {
  canonicalCardId: "card.hash-c6634bd393cadc3a20eda81ee688c8d171d215f7dd6297a92a55a2491f3ec43a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺防伤替代原语：「The next time that unit would be dealt damage this turn, prevent it」是 CR v1.5 367-371 的一次性预防替代" +
    "（371.1 的一次计数窗口，467.2.c.10 正是本卡的例子）；契约 3.6 的封闭 GameAction 集合没有 prevent 动作，" +
    "effects/instructions/ 也没有 replacement.prevent 的实现，替代效果只能在动作执行前拦截，卡牌无法自行实现。" +
    "依赖：replacement.prevent 原语与替代效果的时点拦截（图层/替代批次）。「Choose a unit」按 355.10.c 的例子是目标选择，" +
    "「Draw 1」是独立的 effect.draw，两者都已在程序中表达并在金标测试中覆盖。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a unit. The next time that unit would be dealt damage this turn, prevent it. Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "The next time that unit would be dealt damage this turn,
          // prevent it" — a one-shot prevention replacement effect. No
          // merged primitive creates it; the target is the chosen unit
          // (355.10.c), declared on this instruction the same way 355.8
          // locks targets as the spell is put on the chain.
          id: "counter-strike.prevent",
          op: "replacement.prevent",
          args: {
            event: { kind: "constant", value: "damage" },
            scope: { kind: "constant", value: "one-shot-this-turn" },
            amount: { kind: "constant", value: "all" }
          },
          targets: [
            {
              id: "counter-strike.unit",
              filter: { type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Draw 1." — independent of the shield (359.3.e.11).
          id: "counter-strike.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default counterStrike;

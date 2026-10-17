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
 * Status: executable — continuous.might and effect.draw are both merged;
 * Reaction timing and CardProgram play/trigger binding are also available. The
 * target selector uses the primitive's objects descriptor so the chain adapter
 * preserves the target id while evaluating primitive arguments.
 */
const discipline = {
  canonicalCardId: "card.hash-a1b14db94434084b789c0069291250652a46b455cbb2b5c347c9231af8ac51b5",
  rulesetVersion: "core-1.5",
  status: "executable",
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
            objects: { kind: "constant", value: { kind: "target", id: "chosen-unit" } }
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

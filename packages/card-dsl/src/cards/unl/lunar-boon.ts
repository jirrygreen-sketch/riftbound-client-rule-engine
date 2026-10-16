import type { CardProgram } from "../../ir/index.js";

/**
 * Lunar Boon (unl-125-219) — Spell, 3 energy, no printed power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-125-219, verbatim):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)\n
 *   Discard 1, then draw 2.
 *
 * Rules evidence (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only; 813.1.b grants the
 *   card every Action permission, 813.1.c adds Closed State play on any
 *   player's turn, and 813.3 records that the keyword is a pure permission. The
 *   expansion belongs to effects/keywords/Reaction.ts (contract 3.7) and
 *   admission is chain-owned (contract 3.5); the card declares nothing more.
 * - "Discard 1" is an effect Discard (423.1 / 423.4: discard as many as
 *   possible; 423.1.a the discarding player chooses which cards), carried by
 *   the merged effect.discard primitive with amount 1 and the default drawer
 *   being the ability controller (355.10.a keeps Hand cards non-targeted, so
 *   the choice is a private non-target selection).
 * - "then draw 2" is the merged effect.draw primitive (414.1 / 414.3). The two
 *   instructions are not linked: 359.3.e.11's own example is exactly
 *   "Discard 2, then draw 2" — an empty hand negates the discard and the draw
 *   still happens, so the draw does not reference the discard's result
 *   (359.3.e.14 defines linked instructions by anaphoric reference).
 *
 * Status: executable. Every printed instruction is carried by a merged
 * primitive ([Reaction] keyword ability, effect.discard, effect.draw) and the
 * golden test executes the program's own body through the real interpreter and
 * reference kernel, including the empty-hand and single-card boundaries.
 */
export default {
  canonicalCardId:
    "card.hash-9e6fd20cf02fe1fa8c5b7c57c70ffbd3900b55bc4509cbd90f50efb0587b8b2f",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          id: "lunar-boon.discard-1",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "lunar-boon.draw-2",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Discard 1, then draw 2."
} satisfies CardProgram;

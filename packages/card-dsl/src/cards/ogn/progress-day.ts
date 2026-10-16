import type { CardProgram } from "../../ir/index.js";

/**
 * Progress Day (ogn-114-298) — Spell, 6 energy + 1 Mind power.
 *
 * Printed text:
 *   Draw 4.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Draw 4." is the frozen 414.3 form: one `effect.draw` instruction whose
 *   amount is evaluated at resolution (contract 3.6).
 * - No target, pick, or choice: the implicit drawer is the ability controller
 *   (190.6.d's implied "you"), which is `effect.draw`'s default.
 * - No speed keyword: this printing's ability line has no [Action]/[Reaction]
 *   reminder text, and spells carry either intrinsic property only when
 *   printed (159.2.a-b, 806.1, 813.1); the printing is plain Action timing.
 * - Draw shortfalls (414.4.a draw as many as possible, 414.4.b Burn Out,
 *   414.4.c draw the rest) are kernel-owned; the card only states the amount.
 */
const progressDay = {
  canonicalCardId: "card.hash-6f5f348b612d7d8afb8d38e3f76ed436a62cd1d5d0abcb5a003c48de2e2741fb",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "draw-4",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 4 } }
        }
      ]
    }
  ],
  sourceText: "Draw 4."
} satisfies CardProgram;

export default progressDay;

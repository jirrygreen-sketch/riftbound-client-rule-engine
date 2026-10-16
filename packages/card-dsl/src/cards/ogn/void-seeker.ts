import type { CardProgram } from "../../ir/index.js";


/**
 * Void Seeker (ogn-024-298) — Spell, 3 energy + 1 Fury power.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 4 to a unit at a battlefield. Draw 1.
 *
 * Status: executable (expressible with contract-3.1 structures only):
 * - [Action] → keyword ability { kind: "keyword", keyword: "action" }
 *   (Action.ts merged, v1.5 806);
 * - "Deal 4 to a unit at a battlefield" → effect.damage with a TargetSpec
 *   (type unit, at a battlefield);
 * - "Draw 1." → effect.draw (controller draws, CR 190.6.d's implied "you").
 * Both instructions are unlinked: the draw is a separate sentence and still
 * happens even if the damage instruction is replaced or negated (v1.5 359.3.e.14).
 */
const voidSeeker = {
  canonicalCardId: "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 4 to a unit at a battlefield. Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "damage",
          op: "effect.damage",
          args: {
            amount: { kind: "literal", value: 4 },
            target: { kind: "literal", value: "unit-at-battlefield" }
          },
          targets: [
            {
              id: "unit-at-battlefield",
              filter: { type: "unit", locationType: "battlefield" },
              selection: "one"
            }
          ]
        },
        {
          id: "draw",
          op: "effect.draw",
          args: { amount: { kind: "literal", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default voidSeeker;

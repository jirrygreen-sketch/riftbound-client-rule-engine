import type { CardProgram } from "../../ir/index.js";

/**
 * Falling Comet (ogn-085-298) — Spell, 5 energy, Mind.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-085-298):
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 6 to a unit at a battlefield.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability only: the Showdown
 *   permission is expanded by effects/keywords/Action.ts (contract 3.7) and
 *   the admission check itself belongs to the chain (contract 3.5).
 * - "a unit at a battlefield" is a target. 355.5.a uses the sibling phrasing
 *   "Stun a unit at a battlefield" as its example of a Choice made during
 *   finalization; 355.9.a.1 places "unit" on the Board and 355.9.b spells out
 *   that such a unit is only a legal target while it satisfies the
 *   restriction. 355.10.b adds that "at a battlefield" restricts the unit and
 *   does not target the battlefield itself.
 * - The restriction is a Location-type test on the chosen unit, not a pin to
 *   one named battlefield, so the merged spelling is the ability-level filter
 *   key `location: "battlefield"`: `layers/filter.ts` compares it against the
 *   snapshot's `location.type` (and rejects base/board-less objects), and the
 *   chain's query path routes through that matcher. The TargetSpec-level
 *   `location` field is deliberately not used here: `target/target-plan.ts`
 *   compares it with `sameLocation`, which needs a complete LocationRef, so it
 *   can only pin one concrete battlefield rather than "any battlefield".
 * - "Deal 6" is effect.damage with the printed constant amount. The source is
 *   the resolving spell (418.6.a: without a stated source, the effect that
 *   describes the Deal is the source) and the damage is non-combat (418.1.c).
 *   A target that left the Board after finalization is dropped at resolution
 *   (359.3.e), which the golden test exercises.
 * - No printed cost is declared: a spell's printed base cost is bound from the
 *   catalog at Finalize (`cost.printed`, contract 3.1 / CR 356.1.c).
 *
 * Status: executable. The damage primitive, the target spec and the [Action]
 * permission are all merged; the golden test runs the card's own instruction
 * against the reference kernel and verifies the declared location restriction
 * through the merged filter matcher the chain uses.
 */
const fallingComet = {
  canonicalCardId: "card.hash-6d7a9531293e32e434c7fe99c6af5db443cfa11aa7c070f842cb759910097458",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "falling-comet.deal-6",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 6 },
            target: { kind: "constant", value: "falling-comet.unit" }
          },
          targets: [
            {
              id: "falling-comet.unit",
              filter: { type: "unit", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 6 to a unit at a battlefield."
} satisfies CardProgram;

export default fallingComet;

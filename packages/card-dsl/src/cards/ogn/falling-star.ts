import type { CardProgram } from "../../ir/index.js";

/**
 * Falling Star (ogn-029-298) — Spell, 2 Energy + 2 Fury power, Fury.
 *
 * Printed text:
 *   Deal 3 to a unit.
 *   Deal 3 to a unit.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 2, power 2 (Fury), might null, tags [].
 * The printed ability line has no [Action]/[Reaction] keyword; spells are
 * playable in the Open State of their controller's turn by default (155), so no
 * speed keyword is declared (contrast Void Seeker, which prints [Action]).
 *
 * Modeling notes (Core Rules v1.5):
 * - The text is two sentences, each with its own "a unit" choice: 135.2.b.5
 *   separates instructions per clause, and 355.5/358.1 require each clause's
 *   choice while the spell is finalized. Two independent TargetSpecs keep that.
 *   They may name the same unit or two different units; nothing in the text says
 *   "another unit", so no exclusion is added.
 * - Each sentence is an independent Deal action (418) submitted by the merged
 *   effect.damage primitive. The second sentence does not reference the first,
 *   so the two instructions are not linked (359.3.e.14 defines linked
 *   instructions by anaphoric reference). An ignored first instruction
 *   therefore does not suppress the second, and either may resolve alone.
 * - "a unit" carries no location restriction, so the filter accepts a unit
 *   wherever it is on the Board (355.9.a.1), including a Base.
 * - The printed cost (2 Energy + 2 Fury power) is authoritative for cost checks
 *   (206 / 204.1) and comes from the catalog.
 */
const fallingStar = {
  canonicalCardId: "card.hash-46a8cadb412c53c300d401fa5cb701e3ff79acdc14f7759a2d78bd292379b77f",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Deal 3 to a unit.\nDeal 3 to a unit.",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "falling-star.deal-3-first",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "falling-star.first-unit" }
          },
          targets: [
            {
              id: "falling-star.first-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "falling-star.deal-3-second",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "falling-star.second-unit" }
          },
          targets: [
            {
              id: "falling-star.second-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default fallingStar;

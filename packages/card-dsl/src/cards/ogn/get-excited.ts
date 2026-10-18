import type { CardProgram } from "../../ir/index.js";

/**
 * Get Excited! (ogn-008-298) — Spell, 2 Energy + 1 Fury power, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Discard 1. Deal its Energy cost as damage to a unit at a battlefield.
 *   (Ignore its Power cost.)
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 2, power 1 (Fury), might null, tags [].
 *
 * Status: executable. The linked characteristic read uses the merged selector
 * traversal and last-known information after the discard changes zones:
 * - "Deal its Energy cost as damage" reads a characteristic of the card that the
 *   previous instruction discarded. The object is produced by effect.discard,
 *   whose result links the discarded cards (423.1). Since the card changed zones,
 *   the read also relies on 359.3.e.13 (a spell that moves something as an effect
 *   can look back at its characteristics before the zone change).
 * - effect.discard writes a named result as
 *   `get-excited.discard-1.discarded`, whose value is
 *   `{ count, player, objects }`. The `{ linked: "get-excited.discard-1" }`
 *   ObjectSelector now resolves its nested object references and reads their
 *   last-known characteristics. No cost is hard-coded from a hypothetical
 *   discarded card. "(Ignore its Power cost.)" is honored by reading only
 *   Energy. Golden tests execute the unchanged discard → damage body and
 *   retain the battlefield target restriction.
 */
const getExcited = {
  canonicalCardId: "card.hash-79956e42a3d826b547522f15e3706e341605f6f98ef9d9aad5caf3d03248a826",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Discard 1. Deal its Energy cost as damage to a unit at a battlefield. (Ignore its Power cost.)",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost (energy 2 + 1 Fury power) comes from the catalog; 206 /
      // 204.1 make the printed cost authoritative for cost checks.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "get-excited.discard-1",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          // "Deal its Energy cost as damage to a unit at a battlefield." The
          // linked instruction reads the discarded card's printed Energy cost
          // and never its Power cost (printed reminder). The selector shape is
          // authored per contract 3.6; the merged selector follows the nested
          // discarded.objects binding and preserves the pre-discard identity.
          id: "get-excited.deal-energy-cost",
          op: "effect.damage",
          linkedTo: "get-excited.discard-1",
          args: {
            amount: {
              kind: "object-property",
              object: { linked: "get-excited.discard-1" },
              property: "energy"
            },
            target: { kind: "constant", value: "get-excited.unit-at-battlefield" }
          },
          targets: [
            {
              id: "get-excited.unit-at-battlefield",
              filter: { type: "unit", zone: "board" },
              location: { type: "battlefield" },
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

export default getExcited;

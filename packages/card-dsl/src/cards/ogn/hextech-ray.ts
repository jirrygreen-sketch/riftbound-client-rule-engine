import type { CardProgram } from "../../ir/index.js";

/**
 * Hextech Ray (ogn-009-298) — Spell, 1 Energy + 1 Fury power, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 3 to a unit at a battlefield.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 1, power 1 (Fury), might null, tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is the printed speed keyword. The card declares it as a
 *   keyword ability (contract 3.7); the keyword registry owns the permission
 *   expansion.
 * - "Deal 3 to a unit at a battlefield" chooses one unit, so the unit is a
 *   target (355.7), not a pick. The printed location restriction is carried by
 *   the TargetSpec's own `location` field — the merged target system's
 *   `TargetRequirement.location` (engine-core/src/target/target-plan.ts) — and
 *   the filter pins the object type (355.9.a.1: "unit" is a Board object).
 *   Target legality is rechecked at Finalize and Resolve; an all-stale target
 *   makes the instruction `ignored` (contract 3.4).
 * - The damage is the merged effect.damage primitive (CR 418: a Deal action;
 *   its source defaults to the resolving spell per 418.6.a).
 * - The printed cost (1 Energy + 1 Fury power) is authoritative for cost checks
 *   (206 / 204.1) and is declared from the catalog so the card is
 *   self-describing; the Finalize cost plan is the consumer (RIFT-89).
 */
const hextechRay = {
  canonicalCardId: "card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield.",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost (energy 1 + 1 Fury power) from the catalog.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "hextech-ray.deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "hextech-ray.unit-at-battlefield" }
          },
          targets: [
            {
              id: "hextech-ray.unit-at-battlefield",
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

export default hextechRay;

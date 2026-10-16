import type { CardProgram } from "../../ir/index.js";

/**
 * Riptide Rex (ogn-092-298) — Unit, 6 energy + 2 Power, 6 Might, Mind,
 * Pirate / Bilgewater.
 *
 * Printed text: "When you play me, deal 6 to an enemy unit at a battlefield."
 *
 * Rules evidence (Core Rules v1.5):
 * - "When you play me" subscribes to the card-played timing point (383.4.a)
 *   filtered to this card being played.
 * - "deal 6 to an enemy unit at a battlefield" is one mandatory target
 *   (355.9/355.10.a): the TargetSpec restricts the unit's controller (enemy,
 *   i.e. opponent of the ability controller) and requires a battlefield
 *   location (the merged engine filter matches `location: "battlefield"`
 *   against ObjectSnapshot.location.type). The amount is the printed
 *   constant 6, evaluated at resolution (contract 3.6).
 * - The damage source defaults to the ability source (418.6.a) and the action
 *   is non-combat damage.
 *
 * One target with a fixed amount is ordinary dealing, not damage splitting
 * (355.14), so effect.damage submits a single damage game action for the still
 * legal target (418.1.c).
 */
export default {
  canonicalCardId: "card.hash-48a9eb2aa99eeb51f17ab56a8ac367f90457aafe2f94b3280638ca8e269f2cf8",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "riptide-rex.deal-6",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 6 },
            target: { kind: "constant", value: "enemy-unit-at-battlefield" }
          },
          targets: [
            {
              id: "enemy-unit-at-battlefield",
              filter: {
                type: "unit",
                controller: "opponent",
                location: "battlefield"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, deal 6 to an enemy unit at a battlefield."
} satisfies CardProgram;

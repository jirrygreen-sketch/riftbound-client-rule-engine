import type { CardProgram } from "../../ir/index.js";

/**
 * Incinerate (ogs-003-024) — Spell, 2 energy (Fury).
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 2 to a unit at a battlefield.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is a Permissive keyword; the card only names it and the
 *   keyword registry expands the Showdown timing permission (806.1.b/806.1.c).
 *   The reminder no longer needs a separate instruction (159.2.a).
 * - "Deal 2 to a unit at a battlefield" is a targeted Deal (418.1). The unit is
 *   the target and "at a battlefield" only restricts which units are legal
 *   (355.9.a.1, 355.10.b: "Kill a unit at a battlefield" targets a unit, not a
 *   battlefield). The restriction is a location filter; result's location
 *   vocabulary is the layers matcher's location-type string (layers/filter.ts
 *   reads `location: "battlefield"`), the same spelling merged programs use.
 * - The source of the damage is the spell itself by default (418.6.a), so the
 *   instruction needs no `source` argument. Target legality at Finalize and
 *   revalidation at Resolve belong to the target system (355.8-355.9.a,
 *   359.3.e.12; RIFT-90).
 *
 * Status: executable — the [Action] keyword (806), the one targeted
 * effect.damage instruction, and the location restriction all have merged
 * paths. The golden test executes the instruction against the real primitive.
 */
const incinerate = {
  canonicalCardId: "card.hash-cda4589f51b52780272f5a9b1db1a1de9e9e57e13ffaa05ab668af2de34c1de9",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "incinerate.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: "battlefield-unit" }
          },
          targets: [
            {
              id: "battlefield-unit",
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
  sourceText: "[Action] (Play on your turn or in showdowns.)\nDeal 2 to a unit at a battlefield."
} satisfies CardProgram;

export default incinerate;

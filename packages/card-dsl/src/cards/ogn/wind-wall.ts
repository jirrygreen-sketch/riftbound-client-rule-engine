import type { CardProgram } from "../../ir/index.js";

/**
 * Wind Wall (ogn-064-298) — Spell, 3 energy + 2 power, Calm.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-064-298):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Counter a spell.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability only. 813.1.b grants the
 *   card every permission Action has (including the Showdown window), 813.1.c
 *   adds Closed-State play on any player's turn, and 813.3 records that the
 *   keyword is a pure permission: it does not change any instruction's
 *   function. The expansion into `continuous.timing` belongs to
 *   effects/keywords/Reaction.ts (contract 3.7), and admission is chain-owned
 *   (`canAct` plus the draft's speed) — this card file declares nothing more.
 * - "a spell" is a finalized object on the Chain (355.9.a.2), so it is the
 *   instruction's target (355.7/355.9.a), not a pick. effect.counter rechecks
 *   that the locked reference is still current and still on the Chain, so a
 *   target that left the Chain is ignored (359.3.e.1-e.6).
 * - Countering follows 426.1-426.3: the countered card does nothing, is
 *   cleared from the Chain, and its costs are not refunded. effect.counter
 *   links the countered references under `counteredObjects` for follow-ups.
 * - No printed cost is declared: a spell's printed base cost is bound from the
 *   catalog at Finalize (`cost.printed`, contract 3.1 / CR 356.1.c).
 *
 * Status: executable. Every instruction the card prints is carried by merged
 * primitives (effect.counter) and by the merged [Reaction] KeywordDef
 * (effects/keywords/Reaction.ts, RIFT-85), and the counter half is executed by
 * the golden test. Closed-State admission itself is the chain's own timing
 * check (`canAct`, contract 3.5), not per-card behaviour.
 */
const windWall = {
  canonicalCardId: "card.hash-9403a9de45d88c83f5f8544042525f78e120da0c765a8e684b24ca0e9c7afd2d",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "wind-wall.counter-spell",
          op: "effect.counter",
          args: { target: { kind: "constant", value: "wind-wall.spell" } },
          targets: [
            {
              id: "wind-wall.spell",
              // "a spell" = a finalized object on the Chain (355.9.a.2).
              filter: { type: "spell", zone: "chain" },
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
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Counter a spell."
} satisfies CardProgram;

export default windWall;

import type { CardProgram } from "../../ir/index.js";

/**
 * ogn-233-298 Grand Strategem (Spell, Order, 6 energy + 3 Order power) — RIFT-143 shard 8.
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * cardType Spell, domains ["Order"], energy 6, power 3, might null.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give friendly units +5 :rb_might: this turn.
 *
 * Status: executable. The temporary Might instruction and its layers consumer
 * are merged, and the play body resolves through the production interpreter
 * adapter with the controller-relative filter.
 *
 * "friendly units" is a criteria-based set (each/all), not a choice: no unit is
 * chosen, so nothing is targeted (355.5.a/355.10.d) and no TargetSpec is written.
 */
const grandStrategem = {
  canonicalCardId: "card.hash-c93cf1fcde5c50351fa2b80cc594925df51669816b5ce25ba223e27376c47b3a",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Give friendly units +5 Might this turn" — a non-targeting set
          // registration consumed by continuous.might.
          id: "grand-strategem.might",
          op: "continuous.might",
          args: {
            amount: { kind: "literal", value: 5 },
            duration: { kind: "literal", value: "this-turn" },
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { type: "unit", controller: "self", zone: "board" }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText: "[Action] (Play on your turn or in showdowns.)\nGive friendly units +5 :rb_might: this turn."
} satisfies CardProgram;

export default grandStrategem;

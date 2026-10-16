import type { CardProgram } from "../../ir/index.js";

/**
 * Traveling Merchant (ogn-185-298) — Unit, Chaos (Bilgewater).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-185-298):
 *   When I move, discard 1, then draw 1.
 *
 * Modeling (CR v1.5):
 * - "When I move" subscribes to the object-moved timing point (421.1/449.1)
 *   with the source-self filter; Recall and entry are not Moves.
 * - "discard 1" is effect.discard's effect form: the discarding player chooses
 *   the card (423.1.a) and discards as many as possible (423.4). "then draw 1"
 *   is a separate instruction that does not reference the discarded object or
 *   the discard action (359.3.e.14.c), so it is not linked; both merged
 *   primitives execute in source order.
 */
export default {
  canonicalCardId: "card.hash-b826486bfded0550969d823bf5dedeaa623f413f4ff7c55486520f3b812c6a43",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "object-moved", filter: { event: "object-moved", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "traveling-merchant.discard-1",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "traveling-merchant.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When I move, discard 1, then draw 1."
} satisfies CardProgram;

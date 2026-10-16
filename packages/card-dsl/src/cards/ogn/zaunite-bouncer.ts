import type { CardProgram } from "../../ir/index.js";

/**
 * Zaunite Bouncer (ogn-188-298) — Unit, Chaos (Zaun).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-188-298):
 *   When you play me, return another unit at a battlefield to its owner's hand.
 *
 * Modeling (CR v1.5):
 * - "When you play me" is the Play Effect trigger (383.4.a): the card-played
 *   timing point filtered to this card.
 * - "another unit at a battlefield" is a Target (355.10.a: units on the board
 *   in public zones), filtered to units at a battlefield that are not the
 *   source itself ("another", 355.9.c/359.3.e.7). effect.zone performs the
 *   already-selected move; its "hand" destination submits the closed
 *   return-to-hand action, which routes the card to its owner's hand.
 */
export default {
  canonicalCardId: "card.hash-9cfa0070bcd3f9eedc4527cb2136f412f6a974322e4aadba697f3ae28538b753",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "zaunite-bouncer.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "zaunite-bouncer.another-unit" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "zaunite-bouncer.another-unit",
              filter: {
                type: "unit",
                location: { type: "battlefield" },
                other: true
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
  sourceText: "When you play me, return another unit at a battlefield to its owner's hand."
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Cemetery Attendant (ogn-165-298) — Unit, Chaos (Dog / Shadow Isles).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-165-298):
 *   When you play me, return a unit from your trash to your hand.
 *
 * Modeling (CR v1.5):
 * - "When you play me" is the Play Effect trigger (383.4.a): the card-played
 *   timing point filtered to this card.
 * - "return a unit from your trash to your hand" names a card in the public
 *   trash, so it is a Target (355.10.a explicitly uses this text as its
 *   example). The target spec filters type unit, zone trash and
 *   owner controller; effect.zone performs an already-selected move and its
 *   "hand" destination submits the closed return-to-hand action, which routes
 *   the card to its owner's hand.
 */
export default {
  canonicalCardId: "card.hash-9737147ed5d1bc44fe4888e08c2da381c529e02f1cb71540821c07384949de3c",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
      optional: false,
      body: [
        {
          id: "cemetery-attendant.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "cemetery-attendant.unit-in-trash" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "cemetery-attendant.unit-in-trash",
              filter: { zone: "trash", type: "unit", owner: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, return a unit from your trash to your hand."
} satisfies CardProgram;

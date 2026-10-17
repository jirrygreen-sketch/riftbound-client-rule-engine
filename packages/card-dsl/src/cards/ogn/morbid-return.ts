import type { CardProgram } from "../../ir/index.js";

/**
 * Morbid Return (ogn-170-298) — Spell, 2 energy, Chaos.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Return a unit from your trash to your hand.
 *
 * Modeling notes (Core Rules v1.5):
 * - `action` keeps the printed [Action] keyword (806; spell intrinsic timing
 *   159.2.a); its `continuous.timing` expansion and the chain admission are
 *   owned by the keyword registry and chain/ (contract 3.7).
 * - "Return a unit from your trash to your hand" names a card in a public
 *   zone, so the choice is a Target (355.10.a: the Trash is a Public zone,
 *   and 355.9.a.1 keeps "unit" meaning a Unit; 355.9.a's own example is
 *   "Recycle a unit from your trash"). It is the merged effect.zone primitive
 *   with a TargetSpec and `to: "hand"` — a zone change (448.2), not a Move.
 * - The filter uses the frozen filter vocabulary (events/trigger-spec.ts):
 *   `zone: "trash"` selects the zone, and `owner: "self"` scopes it to the
 *   ability controller's Trash ("your trash"; each player has their own
 *   Trash, 108.2.a, and "self" is the controller selector the chain layer
 *   resolves — chain/engine.ts normalizes `controller`/`owner` "self" to the
 *   item's controller). The destination routing to the OWNER's hand is the
 *   action layer's job, so the card does not add a player argument.
 * - Printed cost (2 Energy, no printed Power — `power: null` in the catalog,
 *   which is not 0) is bound by the card identity at Finalize
 *   (356.1.c / printed-cost binding); the program intentionally declares no
 *   CostSpec rather than re-stating or rewriting the printed values.
 *
 * Status: executable — the Action keyword expands to the runtime `action`
 * speed, the program binding builds a ChainDraft from the printed play
 * ability, and the engine supplies the printed cost from the card snapshot.
 * The body uses the merged zone instruction and is exercised through the real
 * Chain finalize/resolve path below.
 */
const morbidReturn = {
  canonicalCardId: "card.hash-6d8e159513836dafac8b110c3107086e5b6f6971b99ba6ddfb0e749be264be76",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "morbid-return.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "morbid-return.unit-in-trash" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "morbid-return.unit-in-trash",
              filter: { type: "unit", zone: "trash", owner: "self" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Return a unit from your trash to your hand."
} satisfies CardProgram;

export default morbidReturn;

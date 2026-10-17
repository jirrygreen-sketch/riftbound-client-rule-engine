import type { CardProgram } from "../../ir/index.js";

/**
 * En Garde — CR v1.5 813, 158.1 and 355.9.b.
 * Reaction timing and target finalization use the merged program/chain binding.
 * Declare the friendly target once and reuse it for both ordered Might clauses.
 * The second clause counts other friendly units at that target’s live location.
 */
const enGarde = {
  canonicalCardId: "card.hash-9e538f0004c80732dc1212c4b54ff1803de134cd9a4b8e1bb91a6c710b43a73a",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a friendly unit +1 :rb_might: this turn, then an additional +1 :rb_might: this turn " +
    "if it is the only unit you control there.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          id: "grant-plus-1",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "friendly-unit" } }
          },
          targets: [
            {
              id: "friendly-unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "then an additional +1 Might this turn if it is the only unit you
          // control there" — the same target, gated on the location count:
          // the controller's units at the target's location, excluding the
          // target itself, must be zero. The condition is per-instruction
          // (contract 3.4).
          id: "grant-plus-1-conditional",
          op: "continuous.might",
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "units",
              filter: {
                type: "unit",
                controller: "self",
                sameLocationAs: { target: "friendly-unit" },
                exclude: { target: "friendly-unit" }
              }
            },
            operator: "eq",
            right: { kind: "constant", value: 0 }
          },
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: { kind: "constant", value: { kind: "target", id: "friendly-unit" } }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default enGarde;

import type { CardProgram } from "../../ir/index.js";

/**
 * Bubble Bot (sfd-062-221) — rumble-sfd (RIFT-95).
 *
 * "When you play me, ready another friendly Mech."
 *
 * Trigger: the "card-played" timing point (contract 3.5), filtered to the
 * controller playing this card ("me"). The body readies exactly one other
 * friendly Mech chosen by target spec "other-friendly-mech"; selection and
 * re-verification belong to chain Finalize/Resolve. "Another" is expressed
 * with the other: true filter key, which target re-verification must exclude
 * the source object (CR 740.1.a friendly, CR 105 tags).
 *
 * effect.ready defaults `objects` to the source ("ready me"), so the body
 * names the locked target explicitly; without it the production chain locked
 * the other Mech but readied Bubble Bot itself (RIFT-887 probe).
 */
export default {
  canonicalCardId: "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          filter: { source: "self", player: "controller" }
        }
      },
      optional: false,
      body: [
        {
          id: "ready-mech",
          op: "effect.ready",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "other-friendly-mech" } }
          },
          targets: [
            {
              id: "other-friendly-mech",
              filter: {
                type: "unit",
                tag: "Mech",
                controller: "controller",
                other: true,
                zone: "board"
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
  sourceText: "When you play me, ready another friendly Mech."
} satisfies CardProgram;

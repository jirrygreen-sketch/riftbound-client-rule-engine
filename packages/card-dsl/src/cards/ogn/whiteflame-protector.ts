import type { CardProgram } from "../../ir/index.js";

/**
 * Whiteflame Protector (ogn-082-298).
 * CR v1.5 383.4.a / 478 / 317.1: mandatory self play trigger, +8 Might until turn end.
 * Any unit is a legal target, including an enemy or this unit. There is no
 * other/friendly/here restriction. Temporary Might must not be encoded as Buff counters.
 *
 * The card-played trigger, targeted continuous.might instruction, and
 * end-of-turn duration all have executable engine paths.
 */
const program = {
  canonicalCardId: "card.hash-b9737e97366888566c3b22952ffcbbb0194dfeed8bd919f0e724f6d93433206e",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          filter: { source: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "grant-might",
          op: "continuous.might",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "whiteflame-protector.unit" }
            },
            amount: {
              kind: "constant",
              value: 8
            },
            duration: {
              kind: "constant",
              value: "this-turn"
            }
          },
          targets: [
            {
              id: "whiteflame-protector.unit",
              filter: {
                type: "unit",
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
  sourceText: "When you play me, give a unit +8 :rb_might: this turn."
} satisfies CardProgram;

export default program;

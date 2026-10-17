import type { CardProgram } from "../../ir/index.js";

/**
 * Ravenbloom Student (ogn-103-298) — Unit, 2 energy, 2 Might, Mind, Noxus.
 *
 * Printed text: "When you play a spell, give me +1 :rb_might: this turn."
 *
 * Modeling notes:
 * - The trigger is the card-played timing point (383.4.a / 383.4.a.1, emitted
 *   by chain/engine.ts after a spell resolves) filtered to a spell played by
 *   this ability's controller ("you play a spell"); there is no target — "me"
 *   is the ability source, read through the symbolic source selector.
 * - "give me +1 :rb_might: this turn" is executed by the merged
 *   continuous.might primitive (RIFT-258): it registers one arithmetic-layer
 *   effect for the source through ResolveContext.addContinuous with the
 *   end-of-turn duration (143.2.a / 478; 317.1.a / 468.7.c expiry). Not a Buff
 *   counter (702/703): a Buff is a counter, not a Might change.
 *
 * Status: executable — the trigger subscription fires on the merged chain,
 * the ability body registers the arithmetic-layer effect through the
 * production chain context, and the golden test drives a real spell cast
 * through ChainEngine, asserting the +1 Might, the enemy/controller scoping
 * and the end-of-turn expiry.
 */
export default {
  canonicalCardId: "card.hash-1e9496baf34c0f775ffe94233c00bca385044ae51ac57ce745999144f3493a9d",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          object: { type: "spell" },
          player: "self"
        }
      },
      optional: false,
      body: [
        {
          id: "ravenbloom-student.give-plus-1",
          // "give me +1 Might this turn": the ability source, bounded by the
          // end-of-turn duration (317.1.a / 468.7.c).
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" },
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "When you play a spell, give me +1 :rb_might: this turn."
} satisfies CardProgram;

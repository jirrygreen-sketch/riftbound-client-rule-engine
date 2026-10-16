import type { CardProgram } from "../../ir/index.js";

/**
 * Pit Crew (ogn-091-298) — Unit, 3 energy, 3 Might, Mind, Bandle City.
 *
 * Printed text: "When you play a gear, ready me."
 *
 * Rules evidence (Core Rules v1.5):
 * - The trigger is the card-played timing point (383.4.a) with the played
 *   object restricted to a Gear (105 types; the event payload carries the
 *   played object) and the playing player restricted to this ability's
 *   controller ("you play a gear" — the merged event matcher binds the
 *   `player: "self"` selector to the ability controller, events/pipeline-match.ts).
 * - "ready me" is the merged effect.ready primitive (416.1) with its default
 *   selection: the ability source (355.10.g / 412.4). Already-ready objects are
 *   left untouched (416.1.b/416.1.c).
 *
 * No keyword, layer, cost or chain primitive is involved, so the whole card is
 * expressible with merged pieces: the keyword registry and the event/timing
 * matcher already understand a card-played event filter on object type and
 * player selector (events/pipeline-match.ts).
 */
export default {
  canonicalCardId: "card.hash-c14f8fe7647e76e1a5b3db9a1eef0a30ba2a0cdc929fe013536ce268b02c81d8",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          object: { type: "gear" },
          player: "self"
        }
      },
      optional: false,
      body: [
        {
          id: "pit-crew.ready-self",
          op: "effect.ready",
          args: {}
        }
      ]
    }
  ],
  sourceText: "When you play a gear, ready me."
} satisfies CardProgram;

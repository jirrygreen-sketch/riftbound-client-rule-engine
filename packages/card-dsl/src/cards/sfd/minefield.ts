import type { CardProgram } from "../../ir/index.js";

/**
 * Minefield (sfd-212-221) — Battlefield, Rumble champion precon (rumble-sfd).
 *
 * "When you conquer here, put the top 2 cards of your Main Deck into your trash."
 *
 * Default setup now puts the selected Battlefield on the Board, lifecycle
 * attachment binds that exact pre-existing object, combat establishes the
 * current controller on the Battlefield ObjectSnapshot, and a multi-Unit Score
 * wave is collected once under its shared batch identity. The trigger therefore
 * uses once: "per-batch": CR 472 permits Scoring a Battlefield only once per
 * player per turn, and CR 473.2.c limits this Score ability to that occurrence.
 * This is narrower than unconditional once: "per-turn" collection, which would
 * create multiple Pending items when several Units participate in one conquer.
 *
 * RIFT-988 now supplies the final production primitive: effect.mill completes
 * a short Main Deck through CR 432 Burn Out and CR 441.4, including Trash
 * randomization, the opponent point, and the remaining burns. Production
 * goldens cover two available cards, one available card, and an empty Main
 * Deck through the real default lifecycle, TurnFlow, ChainEngine, Finalize,
 * and Resolve path.
 */
export default {
  canonicalCardId: "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "When you conquer here, put the top 2 cards of your Main Deck into your trash.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquered", here: true, player: "self" },
        once: "per-batch"
      },
      optional: false,
      body: [
        {
          id: "minefield.mill",
          op: "effect.mill",
          args: {
            // The Battlefield controller is the implicit "you" under
            // CR 190.6.a/d. The amount is two, not an "up to" amount; any
            // shortfall must continue through the engine's Burn Out rule.
            amount: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

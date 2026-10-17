import type { CardProgram } from "../../ir/index.js";

/**
 * Minefield (sfd-212-221) — Battlefield, Rumble champion precon (rumble-sfd).
 *
 * "When you conquer here, put the top 2 cards of your Main Deck into your trash."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1: "When you conquer…" is a Conquer Effect, a triggered
 *   ability; the `conquer` timing point (events/timing-points.ts, refs
 *   468.5.d / 471.1 / 473.2.a) is emitted by scoring/.
 * - "put the top N cards of your Main Deck into your trash" is the merged
 *   `effect.mill` primitive (deck-top → trash), which owns deck order and Burn
 *   Out handling through the authoritative kernel.
 *
 * Status rationale (contract §3.1): the mill body is executable, but the whole
 * card remains judge-required. The conquer timing point is emitted by the
 * scoring flow, but the printed "here" restriction has no battlefield-relative
 * EventPattern spelling: programs/filters.ts rejects the `here` key, and the
 * conquer emission carries no battlefield object to compare against. The
 * structure below records the exact trigger and uses effect.mill for the
 * supported sub-effect.
 */
export default {
  canonicalCardId: "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The merged effect.mill primitive executes the deck-top-to-trash action and the card program " +
    "binding is merged, but the card is still judge-required: the program adapter rejects the printed `here` filter key " +
    "(Unsupported filter field here), the TriggerSpec vocabulary spells the event 'conquered', " +
    "and the scoring conquer emission carries only player/details with no battlefield object, " +
    "so a battlefield-relative host-location comparison cannot be formed. The supported mill " +
    "body is tested in isolation.",
  sourceText: "When you conquer here, put the top 2 cards of your Main Deck into your trash.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquered", here: true, player: "controller" } },
      optional: false,
      body: [
        {
          id: "minefield.mill",
          op: "effect.mill",
          args: {
            // The controller is implicit under 190.6.d; effect.mill owns
            // deck-top order and Burn Out (441.4 / 432.x).
            amount: { kind: "constant", value: 2 }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

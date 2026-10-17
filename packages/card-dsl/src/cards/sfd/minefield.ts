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
 * Status rationale (contract §3.1, re-checked 2026-10-17): the mill body is
 * executable, but the whole card remains judge-required. The conquer timing
 * point is emitted by the scoring flow, yet the printed "here" restriction still
 * has no battlefield-relative EventPattern spelling:
 * - programs/filters.ts `translateObjectFilter`/`translateTriggerFilter` reject the
 *   `here` key (ProgramBindingError: Unsupported filter field here), so binding the
 *   printed filter throws before any registration.
 * - turn/flow.ts publishes the Score wave as `{ timingPoint: score.method, player,
 *   details: { battlefieldId } }` — there is no battlefield object, and
 *   trigger-spec/`translateTriggerFilter` copy `details` verbatim, so a
 *   self-referential battlefield anchor cannot be formed from the host's identity.
 * The structure below records the exact trigger and uses effect.mill for the
 * supported sub-effect.
 */
export default {
  canonicalCardId: "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The merged effect.mill primitive executes the deck-top-to-trash action and the card program " +
    "binding is merged, but the card is still judge-required: programs/filters.ts rejects the printed `here` " +
    "filter key (ProgramBindingError: Unsupported filter field here), and the scoring conquer emission in " +
    "turn/flow.ts publishes only player/details ({ battlefieldId }) with no battlefield object, while " +
    "translateTriggerFilter copies `details` verbatim — so a battlefield-relative host-location comparison " +
    "(CR 468.5.d / 471.1 / 473.2.a) cannot be formed from this card's own identity. The supported mill " +
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

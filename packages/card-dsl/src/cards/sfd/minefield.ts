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
 * - "put the top N cards of your Main Deck into your trash" is the frozen
 *   `mill` GameAction shape (deck-top → trash).
 *
 * Status rationale (contract §3.1): the effect is NOT expressible with the
 * merged primitives. No effect.mill instruction file exists (RIFT-9 lists it
 * as a required primitive), and effect.zone does not submit the `mill`
 * action — its `to: "trash"` form performs per-object `move-zone` on
 * target/pick refs, which cannot name the hidden deck-top cards (query does
 * not guarantee zone order and zoneSlice is not wired into effect.zone). The
 * structure below records the intended trigger + count + destination; the
 * deck-top selection is the judged part.
 */
export default {
  canonicalCardId: "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "No merged primitive performs the deck-top-to-trash mill: effect.mill has no instruction file (RIFT-9 required primitive), and effect.zone only moves target/pick refs via move-zone (it never submits the 'mill' GameAction, and cannot select the hidden deck-top cards in zone order).",
  sourceText: "When you conquer here, put the top 2 cards of your Main Deck into your trash.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", here: true, player: "controller" } },
      optional: false,
      body: [
        {
          id: "minefield.mill",
          op: "effect.zone",
          args: {
            // Mill anchors the instruction to the milling player; the kernel
            // owns deck-top order and Burn Out (414.4 / 432.x).
            pick: { kind: "constant", value: "minefield.miller" },
            amount: { kind: "constant", value: 2 },
            to: { kind: "constant", value: "trash" }
          },
          picks: [
            {
              id: "minefield.miller",
              options: ["controller"],
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Veiled Temple (sfd-221-221) — Battlefield, Fiora precon.
 *
 * "When you conquer here, you may ready a friendly gear. If it's an
 *  Equipment, you may detach it."
 *
 * Status rationale (contract §3.1): the conquer trigger, the two optional
 * decisions, the ready and the detach are each expressible, but the clause
 * "If it's an Equipment" is NOT expressible in the frozen IR:
 * - Equipment is a tag on the gear, and Condition has no array-contains
 *   operator (only eq/ne/lt/lte/gt/gte/in, where in tests left-in-right), so
 *   the readied gear's tags cannot be tested for "Equipment" without
 *   inventing semantics;
 * - effect.ready links only count/object refs (readied, readiedCount), not a
 *   tag snapshot.
 *
 * The detach branch is gated on the second optional decision alone; the
 * Equipment gate is the judged part. The structure (trigger → optional ready
 * → optional detach of the same gear via a non-target pick, 436.3) is kept so
 * downstream checkers can see the full shape.
 */
export default {
  canonicalCardId: "card.hash-9daf60cdf4c82e4fba1f685af1c9b0d748003f7e9ad9c68f02f429bdd0cf85e5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The condition 'If it's an Equipment' is not expressible: Condition lacks an array-contains operator, so the readied gear's tags cannot be tested for the Equipment tag; effect.ready also links only refs/count, not tag snapshots. The ready + detach structure is encoded, but the Equipment gate is judged.",
  sourceText: "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", here: true, player: "controller" } },
      optional: true,
      body: [
        {
          id: "veiled-temple.ready-opt",
          op: "choice.optional",
          args: { prompt: { kind: "constant", value: "Ready a friendly gear?" } }
        },
        {
          id: "veiled-temple.ready-gear",
          op: "effect.ready",
          linkedTo: "veiled-temple.ready-opt",
          args: {
            objects: { kind: "constant", value: { kind: "target", id: "veiled-temple.gear" } },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "veiled-temple.gear",
              filter: { type: "gear", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "veiled-temple.detach-opt",
          op: "choice.optional",
          linkedTo: "veiled-temple.ready-gear",
          args: { prompt: { kind: "constant", value: "Detach that Equipment?" } }
        },
        {
          id: "veiled-temple.detach",
          op: "effect.detach",
          linkedTo: "veiled-temple.detach-opt",
          args: { pick: { kind: "constant", value: "veiled-temple.detached-gear" } },
          picks: [
            {
              id: "veiled-temple.detached-gear",
              options: [
                { kind: "linked-value", instructionId: "veiled-temple.ready-gear", key: "readied" }
              ],
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

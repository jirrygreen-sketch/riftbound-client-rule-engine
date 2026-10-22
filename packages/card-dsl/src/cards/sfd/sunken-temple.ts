import type { CardProgram } from "../../ir/index.js";

/**
 * Sunken Temple (sfd-218-221) — Battlefield, Fiora precon.
 *
 * Printed text: "When you conquer here with one or more [Mighty] units, you
 * may pay {1 energy} to draw 1. (A unit is Mighty while it has 5+ might.)"
 *
 * CR v1.5 (published 2026-10-09, effective 2026-10-16):
 * - 170.2.a/b establish Battlefields during setup; they are not played.
 * - 190.6.a/d make the current Battlefield Controller the ability controller,
 *   and "you" in its instructions.
 * - 383.2.a.1 treats the Mighty clause as part of the Trigger Condition.
 * - 383.3.a/b move the leading "you may" and the following one-Energy base
 *   cost to Finalize; a failed payment never finalizes the ability.
 * - 383.4.c.2 and 473.2.a make this a Conquer Effect whose participant set is
 *   frozen from the Score action. The runtime reads current layered Might for
 *   exactly those frozen participants (706-710).
 * - 472 and 473.2.c allow one Score per player per Battlefield per turn. One
 *   Score wave emits one Conquer per participant; `once: per-batch` turns that
 *   wave into one trigger opportunity.
 * - 478.1/479.4.e.1.a apply layer dependencies before the Might predicate.
 *
 * The checked Radiance rulings effective 2026-10-16 do not name Sunken Temple.
 * The effective Spiritforged errata page also contains no replacement text for
 * this card, so its printed source text remains authoritative.
 *
 * Status: executable. createMatch places the selected Battlefield on the Board
 * at its own Location, ProgramBinding attaches its lifecycle, and the trusted
 * game-server room registry includes selected Battlefield programs. The
 * production golden covers default setup, Score/Conquer, Finalize payment,
 * Resolve draw, control change, layered Might, decline/unpayable, here and
 * once-per-Score boundaries, and replaced point gain.
 */
export default {
  canonicalCardId: "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "When you conquer here with one or more [Mighty] units, you may pay :rb_energy_1: to draw 1. (A unit is Mighty while it has 5+ :rb_might:.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquered", here: true, player: "self" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            // The pipeline projects this query to the exact participating
            // Unit refs from this Score batch, rather than the live Board set.
            subject: "conquering-mighty-units-at-this-battlefield",
            filter: { type: "unit", controller: "self", mightGte: 5, sameLocationAs: "source" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        },
        // A Score action emits one Conquer per participant. The batch identity
        // makes all those events one trigger opportunity (CR 472/473.2.c).
        once: "per-batch"
      },
      optional: true,
      body: [
        {
          id: "sunken-temple.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Choose whether to pay 1 Energy to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "sunken-temple.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  id: "sunken-temple.draw",
                  op: "effect.draw",
                  linkedTo: "sunken-temple.pay",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

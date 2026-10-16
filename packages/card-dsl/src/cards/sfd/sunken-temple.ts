import type { CardProgram } from "../../ir/index.js";

/**
 * Sunken Temple (sfd-218-221) — Battlefield, Fiora precon.
 *
 * "When you conquer here with one or more [Mighty] units, you may pay
 *  {1 energy} to draw 1. (A unit is Mighty while it has 5+ might.)"
 *
 * CR v1.5 anchors:
 * - The trigger condition references Mighty units (706–709: a unit "is
 *   Mighty" while its Might is 5 or greater). The trigger fires when you
 *   conquer; the "with one or more [Mighty] units" clause is a condition on
 *   the conquering units, not on whether the draw itself is possible.
 * - "you may pay … to draw 1" = optional wrapper + pay + effect.draw (414.x).
 *
 * Status rationale (contract §3.1): the trigger and the pay-then-draw shape
 * are expressible, but the "with one or more [Mighty] units" clause needs
 * either a Mighty predicate (keywords/mighty.ts, not merged) or an
 * event-payload Might filter on the conquer timing point; neither exists in
 * merged code, so the condition cannot be honestly evaluated. The card is
 * therefore judge-required, with the intended shape preserved.
 */
export default {
  canonicalCardId: "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The trigger condition 'conquer here with one or more [Mighty] units' requires a Mighty predicate (CR v1.5 706–709: might >= 5) or a conquer-payload Might filter; neither the Mighty keyword expansion nor a payload-exposing conquer filter is merged, so the condition cannot be evaluated without inventing semantics.",
  sourceText:
    "When you conquer here with one or more [Mighty] units, you may pay :rb_energy_1: to draw 1. (A unit is Mighty while it has 5+ :rb_might:.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "conquering-units",
            filter: { type: "unit", controller: "controller", mightGte: 5 }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: true,
      body: [
        {
          id: "sunken-temple.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "sunken-temple.pay",
                  op: "cost.pay",
                  args: { energy: { kind: "constant", value: 1 } }
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

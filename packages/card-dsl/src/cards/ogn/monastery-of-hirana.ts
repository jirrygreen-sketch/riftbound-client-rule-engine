import type { CardProgram } from "../../ir/index.js";

/**
 * Monastery of Hirana (ogn-282-298) — Battlefield, domainless.
 *
 * "When you conquer here, you may spend a buff to draw 1."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b: "When you conquer here …" is a Conquer
 *   Effect; Conquer Abilities that reference the player Conquering go on the
 *   chain when that player has Conquered (timing point "conquer", emitted by
 *   scoring/, rule refs 468.5.d / 471.1 / 473.2.a). 383.4.c.2.c: the ability
 *   still triggers if the point from Conquering was negated or replaced.
 * - 190.6.a / 190.6.d: "you" is this battlefield's Controller.
 * - 355.10.c / 355.10.c.1: the buff is part of the cost inside the instruction
 *   ("spend a buff to draw 1"), and the rule text uses this exact card as its
 *   example of a cost-within-an-instruction, so it is not a target: it is the
 *   non-target, private selection the buff payment needs.
 * - 702.2.b / 702.2.b.1 / 702.2.b.2 / 745.2: spending a buff removes one Buff
 *   counter from a unit the spending player controls, and a unit without a
 *   buff cannot be spent from; effect.buff mode "spend" submits the closed
 *   "spend-buff" action and enforces both restrictions.
 * - 414.3 / 414.1.a: the draw is one card to the ability controller from the
 *   top of their Main Deck.
 *
 * Status rationale (contract §3.1, cards README §2) and expected execution:
 * the card is written as judge-required because the buff payment is modelled
 * inside the resolving ability rather than as a Finalize-locked cost plan, and
 * because "you may …" applies to the whole "spend a buff to draw 1" clause:
 * the merged `effect.buff` can decline by negating when nothing was spent, but
 * it does not express "the player may decide not to spend even though a buff
 * was available". The intended shape is the §3.9 optional wrapper around
 * spend-then-draw, with the draw gated on the spend's own linked result
 * ("spentCount") so the draw is not paid for with nothing. The merged
 * instructions are exercised end to end by the golden test.
 */
export default {
  canonicalCardId: "card.hash-7616fe7692fc8b3e1bf7fcdbe41d93a4d08639e4c541b02a6378293a286e0550",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The optional half is not fully expressible: the printed 'you may spend a buff to draw 1' needs the player's decline to be a real choice even when a buff is available, and a Finalize-locked cost (CR 355.10.c.1 / 357) whose payment gates the draw. Merged effect.buff only negates with reason 'skipped' after the fact, and cost.pay has no merged instruction file, so the payment cannot be locked at Finalize; a bare choice.optional would still spend the buff whenever the player accepts. Dependencies: the cost plan / cost.pay workstream (RIFT-89 batch3-cost-plan scope) and the conquer trigger pipeline (RIFT-33 scenarios-triggers). The rest of the card (conquer timing point, spend-buff restrictions of 702.2.b.1/.2, effect.draw) is merged and executed by the golden test.",
  sourceText: "When you conquer here, you may spend a buff to draw 1.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" }
      },
      optional: true,
      body: [
        {
          // §3.9 shape for the printed "you may …": the accept decision wraps
          // the instructions it selects, instead of linking a later choice.
          id: "monastery-of-hirana.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Spend a buff to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  // "spend a buff": non-target selection (355.10.c), one buff
                  // counter off a unit the ability's controller controls
                  // (702.2.b.1/.2). effect.buff records the actual result in
                  // the linked "spent"/"spentCount" values.
                  id: "monastery-of-hirana.spend-buff",
                  op: "effect.buff",
                  args: {
                    mode: { kind: "constant", value: "spend" },
                    target: { kind: "constant", value: "buff-holder" }
                  },
                  targets: [
                    {
                      id: "buff-holder",
                      filter: { type: "unit", zone: "board", controller: "controller" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  // "to draw 1": only after a buff was actually spent.
                  id: "monastery-of-hirana.draw",
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } },
                  condition: {
                    kind: "compare",
                    left: {
                      kind: "linked-value",
                      instructionId: "monastery-of-hirana.spend-buff",
                      key: "spentCount"
                    },
                    operator: "gte",
                    right: { kind: "constant", value: 1 }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

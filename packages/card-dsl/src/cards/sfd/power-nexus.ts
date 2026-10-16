import type { CardProgram } from "../../ir/index.js";

/**
 * Power Nexus (sfd-214-221) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-214-221):
 *   "When you hold here, you may pay
 *    :rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow:
 *    to score 1 point."
 *
 * CR v1.5 anchors:
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b: "When you hold here …" is a Hold
 *   Effect — a Triggered Ability that references the player Holding; the closed
 *   `hold` timing point (471.2 / 473.2.b, events/timing-points.ts) is the
 *   subscription point, and 190.6.a/190.6.d make "you" this Battlefield's
 *   Controller.
 * - "you may pay … to score 1 point" is a cost within the instruction
 *   (383.3.b, 355.10.c.1): contract 3.9 models the printed "may" as one
 *   choice.optional whose body holds the payment followed by the point gain
 *   (never a leading choice plus a linkedTo consumer); the payment is declared
 *   before the score.
 * - The four :rb_rune_rainbow: symbols are Power of any Domain, [A]
 *   (135.2.e.5). When required as a cost, [A] may be paid by Power of any
 *   Domain (135.2.e.5.a), so the declared payment is four Power with all six
 *   Domains allowed — the CostSpec shape cost/plan-values.ts already reads
 *   (same spelling as rad/black-market).
 * - "score 1 point" is Gaining a Point (470.1 / 470.2: card text refers to
 *   gaining points as "Score X points"), distinct from Scoring a Battlefield;
 *   effect.score is the merged primitive for that gain.
 *
 * Status: judge-required. Two merged gaps, neither approximated:
 * 1. `hold` is declared in the closed timing-point enum (emittedBy
 *    "scoring") but nothing emits it into the single event pipeline:
 *    scoring/scoring.ts returns triggerScore/triggerMethod flags that
 *    turn-executor-v2 consumes, and the chain/pipeline emit sites cover only
 *    chain / card-played / showdown / cleanup / became-target. The trigger
 *    therefore cannot enter the chain (RIFT-31/RIFT-33 and contract 7.2 batch
 *    5); the filter's `here: true` is the sibling-battlefield placeholder for
 *   053.3 that the engine trigger-spec validator rejects.
 * 2. There is no `cost.pay` instruction file under effects/instructions/
 *    (`cost.pay` is a RIFT-9 inventory op; no opcode submits the declared
 *    payment), so the accepted branch cannot execute. The golden test pins the
 *    unregistered opcode and executes only the merged Score half rather than
 *    approximating the payment.
 */
export default {
  canonicalCardId: "card.hash-37ce210574e7c91a9622befdf13147021c67804d234496c259e656e10217be0e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Two merged gaps. (1) The hold timing point (383.4.d / 471.2 / 473.2.b) is never emitted into the single event pipeline: " +
    "scoring/scoring.ts only returns triggerScore/triggerMethod flags for turn-executor-v2, so the trigger cannot be put on the chain " +
    "(RIFT-31/RIFT-33, contract 7.2 batch 5); the filter's here:true is the 053.3 sibling placeholder that assertTriggerSpec rejects. " +
    "(2) No cost.pay instruction file exists under effects/instructions/ (RIFT-9 inventory op, RIFT-89 batch3-cost-plan plumbing), " +
    "so the accepted branch cannot submit the four [A] Power payment; the cost plan reader can read the declared payment " +
    "(135.2.e.5/135.2.e.5.a, all six Domains allowed) but no opcode performs it. The merged Score half (470.1/470.2, effect.score) " +
    "is executed by the golden test; the payment is not approximated.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" is this Battlefield (053.3) and "you" its Controller
        // (190.6.d); sibling battlefield programs keep the same placeholder
        // spelling while the hold pipeline is unmerged.
        filter: { event: "hold", here: true, player: "controller" }
      },
      // "you may": the printed optional decision is recorded on the ability and
      // the chosen instructions sit inside choice.optional (contract 3.9).
      optional: true,
      body: [
        {
          id: "power-nexus.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay four runes to score 1 point?" },
            body: {
              kind: "constant",
              value: [
                {
                  // Four [A] Power (135.2.e.5). As a cost each may be paid by
                  // Power of any Domain (135.2.e.5.a), which is the
                  // all-six-domain requirement the cost plan reads. The opcode
                  // itself (cost.pay) is not merged — see judgeReason.
                  id: "power-nexus.pay-four-runes",
                  op: "cost.pay",
                  args: {
                    payments: {
                      kind: "constant",
                      value: [
                        {
                          kind: "power",
                          amount: { kind: "constant", value: 4 },
                          allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
                        }
                      ]
                    }
                  }
                },
                {
                  // "score 1 point" (470.1 / 470.2): Gaining a Point through
                  // an effect, for the ability controller. Linked to the
                  // payment that the printed "pay … to …" requires.
                  id: "power-nexus.score-1",
                  op: "effect.score",
                  linkedTo: "power-nexus.pay-four-runes",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you hold here, you may pay " +
    ":rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow::rb_rune_rainbow: to score 1 point."
} satisfies CardProgram;

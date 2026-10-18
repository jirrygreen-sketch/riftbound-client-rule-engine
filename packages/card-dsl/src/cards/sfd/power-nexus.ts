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
 * Status: judge-required, re-checked 2026-10-17. The remaining current gap,
 * not approximated:
 * 1. The `hold` producer is merged (turn/flow.ts's Score wave emits `hold` with
 *    { player, details: { battlefieldId } }), and the closed discriminant
 *    spelling is the EventPattern value "held" (EVENT_PATTERN_TYPES;
 *    events/pipeline-match.ts maps held -> the hold timing point). What is
 *    still missing is the 053.3 "here" referent itself: EventPattern and
 *    ObjectFilter have no battlefield-relative anchor for a Battlefield's own
 *    Hold Effect (CR 383.4.d.2.a), a static program cannot know the runtime
 *    battlefield id carried by `details.battlefieldId`, and the merged
 *    card-program binding rejects unknown filter fields fail-closed
 *    ("Unsupported filter field here"), so a registration that stays faithful
 *    to "here" cannot be expressed. The declared printed restriction is kept
 *    as the placeholder and the trigger never reaches the chain. The cost.pay
 *    instruction is merged and the golden executes its payment (the test kernel
 *    keeps Power resources), while the anchor gap keeps the whole ability
 *    judge-required.
 */
export default {
  canonicalCardId: "card.hash-37ce210574e7c91a9622befdf13147021c67804d234496c259e656e10217be0e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The remaining current gap, not approximated: (1) the hold producer and its closed discriminant are merged " +
    "(turn/flow.ts's Score wave emits hold with { player, details: { battlefieldId } }; the EventPattern value is \"held\", " +
    "which events/pipeline-match.ts maps onto the hold timing point), but the printed 053.3 \"here\" referent still has no " +
    "vocabulary: neither EventPattern nor ObjectFilter offers a battlefield-relative \"this Battlefield\" anchor for a " +
    "Battlefield's own Hold Effect (CR 383.4.d.2.a), a static card program cannot know the runtime battlefield id that " +
    "details.battlefieldId carries, and the merged card-program binding rejects the placeholder fail-closed " +
    "(\"Unsupported filter field here\"), so no faithful trigger registration exists and the ability never reaches the chain. " +
    "The cost.pay instruction is merged and the golden executes its payment (the test kernel keeps Power resources); " +
    "the merged Score half (470.1/470.2, effect.score) and the declined branch are executed too.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" is this Battlefield (053.3) and "you" its Controller
        // (190.6.d). The discriminant uses the closed EVENT_PATTERN_TYPES value
        // "held" (pipeline-match maps it to hold) and PlayerSelector "self" is
        // the frozen spelling for the trigger's own controller ("controller" is
        // not a valid PlayerSelector); the surviving placeholder is only the
        // battlefield identity, which has no vocabulary yet (judgeReason).
        filter: { event: "held", here: true, player: "self" }
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
                  // Power of any Domain (135.2.e.5.a), so the numeric Power
                  // requirement is four and every Domain is allowed — the
                  // object payments shape cost.pay accepts.
                  id: "power-nexus.pay-four-runes",
                  op: "cost.pay",
                  args: {
                    payments: {
                      kind: "constant",
                      value: { energy: 0, power: 4 }
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

import type { CardProgram } from "../../ir/index.js";

/**
 * Ornn's Forge (sfd-213-221) — Battlefield, Fiora precon.
 *
 * "While you control this battlefield, the first friendly non-token gear
 *  played each turn costs {1 energy} less."
 *
 * Status rationale (contract §3.1): the ability is a cost modification whose
 * scope is a per-turn window keyed to the first qualifying play. The cost
 * planning/payment work is still pending in RIFT-261, and the RIFT-257 card-static
 * registration path does not feed this effect into Finalize:
 * - the "first … each turn" window needs per-turn state reset by the turn
 *   timing points plus history counting (condition.history) combined with a
 *   continuous cost layer (contract 3.4 layer arithmetic) that expires after
 *   the first qualifying play — a composite not representable by a single
 *   static ContinuousEffect.
 *
 * The static ability below is the closest structurally honest encoding:
 * condition keeps "while you control this battlefield" + the gear filter, and
 * the effect declares the energy delta, but the per-turn "first played"
 * window is the judged part.
 */
export default {
  canonicalCardId: "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The cost.modify shape is recorded, but card-static cost effects are not consumed by " +
    "Finalize (RIFT-257) and the cost.modify/cost.pay path remains pending in RIFT-261. The 'first " +
    "friendly non-token gear played each turn' window additionally needs per-turn state and " +
    "history-gated expiry after the first qualifying play; the current ContinuousEffect/condition " +
    "model cannot express that window. No cost is approximated.",
  sourceText:
    "While you control this battlefield, the first friendly non-token gear played each turn costs :rb_energy_1: less.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "cost.modify",
        value: { kind: "constant", value: { energy: -1 } },
        duration: "per-turn-first-play",
        appliesTo: "play-cost",
        filter: {
          type: "gear",
          controller: "controller",
          isToken: false
        }
      },
      condition: { kind: "always" }
    }
  ]
} satisfies CardProgram;

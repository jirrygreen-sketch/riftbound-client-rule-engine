import type { CardProgram } from "../../ir/index.js";

/**
 * Ornn's Forge (sfd-213-221) — Battlefield, Fiora precon.
 *
 * "While you control this battlefield, the first friendly non-token gear
 *  played each turn costs {1 energy} less."
 *
 * Status rationale (contract §3.1): the ability is a cost modification whose
 * scope is a per-turn window keyed to the first qualifying play. That is not
 * expressible with the merged primitive set:
 * - no cost.modify primitive file exists under engine-core/effects/instructions
 *   (RIFT-9 lists cost.modify as a required primitive; only 17 effect.*
 *   instructions are merged, and none applies a cost delta);
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
    "Cost modification is not expressible: no cost.modify primitive is merged (RIFT-9 lists it as required), and the 'first friendly non-token gear played each turn' window needs per-turn state plus a history-gated continuous cost layer that the current ContinuousEffect/condition model cannot express.",
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

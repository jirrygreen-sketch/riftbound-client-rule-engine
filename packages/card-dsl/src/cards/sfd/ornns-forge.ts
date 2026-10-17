import type { CardProgram } from "../../ir/index.js";

/**
 * Ornn's Forge (sfd-213-221) — Battlefield, Fiora precon.
 *
 * "While you control this battlefield, the first friendly non-token gear
 *  played each turn costs {1 energy} less."
 *
 * Status rationale (contract §3.1): the ability is a cost modification whose
 * scope is a per-turn window keyed to the first qualifying play. The cost.modify
 * and cost.pay primitives are merged and the primitive really applies a -1
 * Energy reduction to a caller-supplied plan, but the production static binder
 * refuses this shape: the authored `appliesTo: "play-cost"` anchor is rejected
 * ("Unsupported static appliesTo") and programs/statics.ts layerFor rejects the
 * kind itself ("no layer mapping": the layer union is only
 * copy/trait/ability/arithmetic). chain/engine.ts's Finalize only consumes the
 * plan it builds from the caller's own input, so no production path feeds the
 * effect into a Finalize cost plan:
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
    "Re-checked 2026-10-17. The cost.modify shape is recorded and the cost.modify/cost.pay " +
    "primitives plus the card-static binding are merged, but the production static binder " +
    "rejects this shape with ProgramBindingError (first on the authored appliesTo anchor: " +
    "\"Unsupported static appliesTo \\\"play-cost\\\"\"; and then on the kind itself, " +
    "programs/statics.ts layerFor: \"Static ability kind cost.modify has no layer mapping\" — " +
    "the layer union is only copy/trait/ability/arithmetic), so no production " +
    "path binds it into the Finalize cost plan (chain/engine.ts builds that plan from the " +
    "caller's own input only). The 'first " +
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

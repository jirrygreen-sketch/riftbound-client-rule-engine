import type { CardProgram } from "../../ir/index.js";

/**
 * Ornn's Forge (sfd-213-221) — Battlefield, Fiora precon.
 *
 * "While you control this battlefield, the first friendly non-token gear
 *  played each turn costs {1 energy} less."
 *
 * Status rationale (contract §3.1, re-checked 2026-10-17 against merged
 * sources): the ability is a cost modification whose scope is a per-turn window
 * keyed to the first qualifying play. The cost.modify and cost.pay primitives
 * are merged and the primitive really applies a -1 Energy reduction to a
 * caller-supplied plan, but the production static binder refuses this shape in
 * two measured steps: the authored `appliesTo: "play-cost"` anchor is rejected
 * ("Unsupported static appliesTo") and programs/statics.ts layerFor rejects the
 * kind itself ("Static ability kind cost.modify has no layer mapping": the
 * layer union is only copy/trait/ability/arithmetic). chain/engine.ts's
 * Finalize only consumes the plan it builds from the caller's own input, so no
 * production path feeds the effect into a Finalize cost plan:
 * - the "first … each turn" window needs per-turn state reset by the turn
 *   timing points plus history counting (the ResolveContext.history query, not a
 *   condition kind: CONDITION_KINDS has no history member) combined with a
 *   continuous cost layer (contract 3.4 layer arithmetic) that expires after
 *   the first qualifying play — a composite not representable by a single
 *   static ContinuousEffect.
 *
 * The static ability below is the closest structurally honest encoding:
 * condition keeps "while you control this battlefield", the filter keeps the
 * printed gear/non-token clauses, and the effect declares the energy delta; the
 * per-turn "first played" window plus the missing cost-plan consumer remain the
 * judged parts.
 */
export default {
  canonicalCardId: "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Re-checked 2026-10-17 against merged sources. The cost.modify/cost.pay primitives are merged and " +
    "the primitive really applies the declared -1 Energy delta to a caller-supplied plan, but the " +
    "printed discount is still not executable, and nothing is approximated: (1) the production static " +
    "binder refuses this shape — programs/statics.ts staticTarget rejects the authored appliesTo anchor " +
    "(\"Unsupported static appliesTo \\\"play-cost\\\"\") before any filter is translated, and " +
    "layerFor then rejects the kind itself (\"Static ability kind cost.modify has no layer mapping\"; " +
    "the layer union is only copy/trait/ability/arithmetic, CR 356.4); (2) no CardProgram → " +
    "CostPlanInput consumer exists — chain/engine.ts Finalize builds the cost plan from the caller's own " +
    "input only, so the declared discount never reaches a plan (CR 356.4 / 356.4.f). The 'first " +
    "friendly non-token gear played each turn' window additionally needs per-turn state plus " +
    "history-gated expiry after the first qualifying play (CR 356.4.b): the merged vocabulary has " +
    "neither a condition kind (ir.validation CONDITION_KINDS has no history member) nor a " +
    "ContinuousEffect shape that expires on a counted play, and history counting is only reachable " +
    "through ResolveContext.history.",
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
          // Descriptive placeholder for the printed "non-token" clause. This
          // key is not the operative gap (the merged vocabulary can express it
          // as characteristics: { isToken: false }); the ability is rejected on
          // its appliesTo anchor before the filter is ever translated, and the
          // template golden in test/cards/templates/static-667.test.mjs pins the
          // printed placeholder.
          isToken: false
        }
      },
      // 190.6.a/190.6.d: this battlefield supplies the ability only while its
      // controller controls it. The first-play window remains judge-required.
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: { object: "self", controller: "self" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ]
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Ornn's Forge (sfd-213-221) — Battlefield, Fiora precon.
 *
 * "While you control this battlefield, the first friendly non-token gear
 *  played each turn costs {1 energy} less."
 *
 * Status rationale (re-checked 2026-10-21 against integration): the DSL keeps
 * the full printed effect. The production static binder now accepts the
 * `play-cost` scope and `cost.modify`, and registers a cost capability plus an
 * ability-layer source whose filter is the played Gear. The discount collector
 * can apply the authored -1 Energy, enforce the printed non-token/friendly/gear
 * filter, and gate `per-turn-first-play` with authoritative Finalize history.
 *
 * It is not yet connected to a real card play. `staticCostSources(engine)` has
 * no production caller, and `ChainEngine#finalize` calls `buildCostPlan` with
 * the draft's caller-owned cost input instead of `finalizeCostPlan` with those
 * static sources and the current-turn Finalize history (CR 356.4/356.4.f,
 * 420.4.b). The card therefore remains judge-required: it cannot claim that its
 * own first friendly non-token Gear actually pays one Energy less.
 */
export default {
  canonicalCardId: "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Re-checked 2026-10-21 against integration. The production static binder accepts appliesTo \"play-cost\" " +
    "and routes cost.modify to a cost capability plus an ability-layer source (programs/statics.ts:769-770, " +
    "registerCost at :731-752). The discount collector also implements the printed shape: friendly owner/" +
    "controller Gear, non-token, -1 Energy, and per-turn-first-play history (cost/discounts/collect.ts:74-90, " +
    "243-330; CR 356.4/356.4.f and 420.4.b). The remaining production gap is the Finalize bridge: " +
    "staticCostSources(engine) has no caller, and chain/engine.ts:843-854 finalizes and builds from the " +
    "caller-owned draft cost input only, without passing that static source set, purpose \"play\", or the current-turn " +
    "finalized-play history. Consequently the first qualifying Gear still pays its printed cost in a real card play. " +
    "Keep this card judge-required until Chain Finalize consumes the bound static sources and records successful " +
    "card Finalize history transactionally.",
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
      // 190.6.a/190.6.d: this battlefield supplies the ability only while its
      // controller controls it. Chain Finalize still has to consume this source.
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

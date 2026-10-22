import type { CardProgram } from "../../ir/index.js";

/**
 * Ornn's Forge (sfd-213-221) — Battlefield, Fiora precon.
 *
 * "While you control this battlefield, the first friendly non-token gear
 *  played each turn costs {1 energy} less."
 *
 * Rules evidence: Core Rules v1.5, last updated 2026-10-09 and effective
 * 2026-10-16, https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 * (CR 190.6.a/190.6.d control, 356.4 cost discounts, 420.4.b Finalize history).
 *
 * Status rationale (re-checked 2026-10-22 against integration): the DSL keeps
 * the full printed effect. Production Finalize now discovers this bound static,
 * runs `finalizeCostPlan`, and pays through the same rollback transaction. The
 * collector also enforces the friendly non-token Gear and activated/purpose
 * filters. The remaining gap is the `per-turn-first-play` history input:
 * `ChainEngine#costDiscountSources` supplies statics but no
 * `finalizedPlaysThisTurn`, so `turnPlays` fails closed (CR 420.4.b). The first
 * Gear cannot be distinguished from a later Gear on the real production path.
 * Keep this card judge-required until Finalize derives the current-turn card
 * Finalize records from its authoritative event history and supplies them.
 */
export default {
  canonicalCardId: "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Re-checked 2026-10-22 against integration. Production workflow now connects the remaining cost bridge: " +
    "chain/engine.ts:876 passes finalizeCostPlan the bound static sources, purpose \"play\", and a real " +
    "rollback transaction; programs/static-adapters/capabilities.ts:113-125 exposes the bound battlefield source. " +
    "The collector implements the printed friendly non-token Gear and -1 Energy filters " +
    "(cost/discounts/collect.ts:78-90 and 241-346; CR 356.4/356.4.b, 420.4.b). " +
    "The remaining gap is the current-turn Finalize history: ChainEngine#costDiscountSources " +
    "(chain/engine.ts:923-935) does not supply finalizedPlaysThisTurn, although CostDiscountSources and " +
    "turnPlays require it (cost/discounts/collect.ts:15-28; cost/discounts/values.ts:98-100). A real first qualifying " +
    "Gear therefore fails closed with \"Cost history requires authoritative card Finalize records for the current " +
    "turn (420.4.b)\" instead of paying one Energy less. Keep this card judge-required until Finalize derives the " +
    "current-turn successful card Finalize records from authoritative history and supplies them transactionally.",
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

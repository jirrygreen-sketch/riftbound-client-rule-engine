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
 * Status rationale (re-checked 2026-10-23 against integration): every printed
 * clause has a production consumer. The lifecycle binds the on-Board Battlefield
 * ability, Finalize discovers that cost capability, and the collector applies
 * only to a Gear play by the Battlefield controller. RIFT-986 supplies the
 * transactional current-turn card-Finalize records (resetting at turn start),
 * so `per-turn-first-play` distinguishes the first qualifying Gear from later
 * plays and a rolled-back attempt consumes no discount. Finalize pays the
 * resulting 1-Energy discount in the same rollback transaction (CR 190.6.a,
 * 190.6.d, 337.1.a, 356.4-356.6, 420.4.b).
 */
export default {
  canonicalCardId: "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad",
  rulesetVersion: "core-1.5",
  status: "executable",
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

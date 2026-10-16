import type { CardProgram } from "../../ir/index.js";

/**
 * Rumble, Scrapper (sfd-089-221) — rumble-sfd (RIFT-95).
 *
 * "Your Mechs have +1 [M] (including me).
 *  When I hold, play a 3 [M] Mech unit token to your base."
 *
 * Ability 1 is a static arithmetic-layer Might buff on friendly Mechs
 * (including the source itself, which is a Mech). Ability 2 triggers on the
 * "hold" timing point (CR 315.2.b.2, 471.2, 473.2.b) and creates a 3 Might
 * Mech unit token in the controller's base (CR 187.4).
 */
export default {
  canonicalCardId: "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Static +1 Might aura depends on the unmerged layers engine for continuous.might effects; the hold trigger + effect.token mech body is expressible, but layers consumption of the static effect is pending the layers/continuous tasks.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        filter: { tag: "Mech", controller: "controller", zone: "board" },
        value: { kind: "constant", value: 1 }
      }
    },
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: {
          event: "hold",
          filter: { source: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "play-mech-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "mech" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "create" },
            location: { kind: "constant", value: { type: "base", player: "controller" } }
          }
        }
      ]
    }
  ],
  sourceText:
    "Your Mechs have +1 :rb_might: (including me).\nWhen I hold, play a 3 :rb_might: Mech unit token to your base."
} satisfies CardProgram;

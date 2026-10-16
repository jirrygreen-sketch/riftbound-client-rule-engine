import type { CardProgram } from "../../ir/index.js";

/**
 * Production Surge — sfd-076-221 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   This costs [2] less if you control a Mech.
 *   Play a 3 [M] Mech unit token to your base.
 *   Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - "This costs [2] less if you control a Mech." is a conditional printed-cost
 *   reduction evaluated at Finalize (cost.modify, contract 5.1 / CR 349 cost
 *   steps). It is a property of playing the card, not a chain-resolving
 *   instruction, so it is declared as a static ability whose
 *   continuous.cost-modification effect is consumed by the cost system at
 *   Finalize; the condition counts Mechs under the controller's control. The
 *   merged cost-plan task (RIFT-89) owns the consumer.
 * - "Play a 3 [M] Mech unit token to your base." Playing a NEW token is
 *   create-on-chain plus play (440.2.c / 185.2.a / 350.2 / 354, contract
 *   changelog RIFT-62). The merged effect.token primitive documents that the
 *   frozen kernel create-token action only creates directly on the Board, so
 *   mode "play" is explicitly blocked in merged code. The instruction is
 *   still authored with mode "play" and the Mech token definition (187.4)
 *   because the primitive accepts and validates that shape, negating with a
 *   documented blockedReason until the kernel chain-creation path lands; this
 *   keeps the card's description complete without approximating the play
 *   flow.
 * - "Draw 1." is a plain effect.draw (414.3); it is independent of the token
 *   instruction per 359.3.e.11 (resolve as much as possible).
 */
const productionSurge = {
  canonicalCardId: "card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.cost-modification",
        amount: -2,
        resource: "energy",
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "units", filter: { tags: "Mech", controller: "you" } },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    {
      kind: "play",
      body: [
        {
          id: "play-mech-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "mech" },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "you" } }
          }
        },
        {
          id: "draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "This costs :rb_energy_2: less if you control a Mech.\n" +
    "Play a 3 :rb_might: Mech unit token to your base.\n" +
    "Draw 1."
} satisfies CardProgram;

export default productionSurge;

import type { CardProgram } from "../../ir/index.js";

/**
 * Ferrous Forerunner (sfd-021-221) — Rumble SFD precon unit.
 *
 * [Deathknell] — Play two 3 [M] Mech unit tokens to your base.
 * (When I die, get the effect.)
 *
 * CR 808.1.c defines Deathknell as "When I die, [Effect]". The keyword
 * declaration supplies the self-death subscription and trigger.leave boundary;
 * the explicit object-killed ability is the printed [Effect] body, which the
 * production lifecycle binds to that boundary as one Pending Item.
 *
 * "to your base" is resolved against the ability controller, not the source's
 * current location; effect.token performs the 3 Might Mech token definition
 * through the Chain before Play (187.4 / 440.2.c / 185.2.a).
 */
export default {
  canonicalCardId: "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "deathknell" },
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { self: true }
      },
      optional: false,
      body: [
        {
          id: "ferrous-forerunner.play-tokens",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "mech" },
            amount: { kind: "constant", value: 2 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            linkKey: { kind: "constant", value: "mechTokens" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Deathknell] — Play two 3 :rb_might: Mech unit tokens to your base. (When I die, get the effect.)"
} satisfies CardProgram;

import type { CardProgram } from "../../ir/index.js";

/**
 * Plundering Poro (sfd-069-221) — rumble-sfd (RIFT-95).
 *
 * "When I conquer, play a Gold gear token exhausted."
 *
 * Trigger: the "conquer" scoring timing point, filtered to this unit
 * conquering (CR 471.1, 473.2.a).
 *
 * The body plays a NEW Gold gear token exhausted, which is not expressible
 * with the merged effect.token primitive: token "play" mode is explicitly
 * blocked, there is no Gold gear token definition (CR 187.5 carries the
 * printed ability "[Reaction][>] Kill this, [E]: [Add] [A]"), and there is
 * no exhausted entry override (CR 375 modification inheritance).
 */
export default {
  canonicalCardId: "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Body needs effect.token play-mode through the chain (CR 440.2.c/185.2.a), the Gold gear token definition with its printed activated ability (CR 187.5), and an exhausted entry override (CR 375); effect.token blocks token play mode, has no gold definition, and supports no entry overrides.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: {
          event: "conquer",
          filter: { source: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "play-gold",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            entersExhausted: { kind: "constant", value: true }
          }
        }
      ]
    }
  ],
  sourceText: "When I conquer, play a Gold gear token exhausted."
} satisfies CardProgram;

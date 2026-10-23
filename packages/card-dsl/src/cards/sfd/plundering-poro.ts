import type { CardProgram } from "../../ir/index.js";

/**
 * Plundering Poro (sfd-069-221) — rumble-sfd.
 *
 * "When I conquer, play a Gold gear token exhausted."
 *
 * Trigger: the "conquer" scoring timing point, filtered to this unit after it
 * participates in and successfully Conquers a Battlefield (CR 383.4.c.2.a,
 * 471.1, 473.2.a). The production TurnFlow Score wave now carries the exact
 * conquering Unit as object/source/it plus details.objectId and battlefieldId.
 *
 * The body plays a NEW Gold gear token exhausted. "Play" is the create-token
 * on the Chain followed by Play (CR 185.2.a, 440.2.c); exhausted is the entry
 * stipulation (CR 184.1 / 185.2.d), not a later Exhaust action. RIFT-1005
 * carries that stipulation through Finalize/Resolve, so the production Board
 * transition places the Gold at its controller's Base while preserving the
 * exhausted state. The canonical CR 187.5 Gold program supplies its later
 * Reaction Add, which adds one Universal Power source ([A]).
 *
 * Official CR v1.5 source (effective 2026-10-16):
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 */
export default {
  canonicalCardId: "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82",
  rulesetVersion: "core-1.5",
  status: "executable",
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

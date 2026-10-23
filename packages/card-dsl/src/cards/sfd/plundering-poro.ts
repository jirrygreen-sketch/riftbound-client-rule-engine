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
 * stipulation (CR 143.4 / 185.2.d), not a later Exhaust action. The token
 * primitive now accepts entersExhausted and verifies the post-play state.
 *
 * RIFT-987 makes the CR 187.5 Gold token definition executable as the same
 * canonical card program. Its Reaction Add really produces one Universal Power
 * source ([A]), but the full sentence is not yet executable: the production
 * Play route completes a Gear ready after this effect explicitly required it to
 * enter exhausted. The card remains fail-closed until that per-token entry
 * stipulation reaches the authoritative Board transition.
 *
 * Official CR v1.5 source (effective 2026-10-16):
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 */
export default {
  canonicalCardId: "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Official evidence: CR v1.5 (2026-10-09, effective 2026-10-16; " +
    "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf), " +
    "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/, and " +
    "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/. Current gap: RIFT-987 made the " +
    "canonical CR 187.5 Gold program executable, so the token binds and its Reaction Add yields one Universal Power source. " +
    "Current gap: the production Play route in engine-core/src/chain/engine.ts:423-442 / 1578-1600 applies its generic " +
    "Gear-ready result after effect.token carried entersExhausted; the created Gold is therefore ready and immediately " +
    "activatable, contrary to CR 184.1 and 185.2.a as applied over the ordinary 149.1 / 359.2.d entry rule. Required fix: " +
    "carry a trusted Play entry-state stipulation through Finalize/Resolve and the entry-replacement path; do not append " +
    "a later Exhaust action. The Conquer trigger itself and the Gold program's Play/Add halves are otherwise production-safe " +
    "(CR 383.4.c.2.a, 187.5, 420.3, 430.2 / 430.3).",
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

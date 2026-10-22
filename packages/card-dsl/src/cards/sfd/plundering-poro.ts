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
 * Status remains judge-required for the CR 187.5 Gold definition's intrinsic
 * ability. RIFT-929 made Universal Power available as a cost source, but it did
 * not add Universal Power as an effect result: effect.resources still accepts
 * only the six named Domains (135.2.e.5.b / 163.2.b), and the Add binder still
 * rejects the authored ``power: ["rainbow"]`` shape. The Gold token definition
 * therefore remains blocked before a copy can be created. This card's own
 * trigger and its play-plus-exhausted entry instruction are independently
 * production-bound; a generic or ready Gold substitute would still be wrong.
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
    "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/; those reviewed snapshots contain no matching " +
    "Plundering Poro, Gold, 187.5, 135.2.e.5, or 163.2.b entry. " +
    "Current gap: the CR 187.5 Gold gear token carries its own Reaction Add ability, but obtaining Universal Power [A] is still not " +
    "executable even though RIFT-929 added [A] as a cost source. effects/instructions/effect.resources.ts:126-170 accepts only the " +
    "six named Domains, so the canonical Gold body's rainbow Power returns negated(impossible) without gaining Power " +
    "(CR 135.2.e.5.b / 163.2.b). programs/index.ts:40-58 rejects that same body as an unverified Add shape, and " +
    "effects/tokens/definitions.ts:100 still marks the Gold token abilityBinding blocked; effect.token.ts:341-343 therefore " +
    "returns token-definition-or-abilities-judge-required before create-token/play can materialize it. This card's Conquer trigger " +
    "is production-bound: turn/flow.ts emits the conquering Unit as object/source/it and the binder matches it by exact Unit identity " +
    "(CR 383.4.c.2.a). Its effect.token instruction also supports play plus the exhausted entry stipulation " +
    "(CR 185.2.a / 440.2.c / 184.1 / 185.2.d). Dependency: a source-backed Universal Power gain result, the Gold token ability " +
    "program rebased onto it, and admission of that token program; until then no Gold token may be materialized.",
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

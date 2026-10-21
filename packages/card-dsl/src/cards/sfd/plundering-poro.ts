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
 * Status remains judge-required for two current production gaps. First, the CR
 * 187.5 Gold definition carries its own "[Reaction][>] Kill this, [E]: [Add]
 * [A]" ability and is intentionally fail-closed at
 * effects/tokens/definitions.ts:100 (abilityBinding = "blocked");
 * effect.token.ts:341 refuses it before any token enters the Chain because
 * Gold's canonical program still needs a Universal Power [A] contract (CR
 * 135.2.e.5 / 163.2.b). Second, after the definition is admitted,
 * programs/lifecycle.ts:331 routes a token with a registered program through
 * the ordinary card describePlay path, while chain/engine.ts:1194-1200 always
 * writes gear entry as ready; that path would discard this card's exhausted
 * entry stipulation. Creating a generic or later-exhausted token instead would
 * be an approximation, so the card stays non-executable.
 *
 * Official CR v1.5 source (effective 2026-10-16):
 * https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 */
export default {
  canonicalCardId: "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Current gaps: (1) the CR 187.5 Gold gear token has its own Universal Power [A] ability and remains fail-closed. " +
    "effects/tokens/definitions.ts:100 defines gold with abilityBinding = \"blocked\", and effect.token.ts:341 returns " +
    "token-definition-or-abilities-judge-required before create-token/play. Gold's canonical program is judge-required because the " +
    "closed six-Domain contract cannot represent [A] (CR 135.2.e.5 / 163.2.b). (2) after that definition is executable, a registered " +
    "token program is routed through ordinary describePlay by programs/lifecycle.ts:331, whose gear Resolve at " +
    "chain/engine.ts:1194-1200 unconditionally makes gear ready; this loses the CR 143.4 / 185.2.d exhausted entry needed by the " +
    "card. A token-play adapter must carry the entry state through Resolve while preserving the token's intrinsic program. " +
    "This card's Conquer trigger is already production-bound: " +
    "turn/flow.ts emits the conquering Unit as object/source/it and the binder matches it by exact Unit identity (CR 383.4.c.2.a), while " +
    "effect.token supports play plus entersExhausted (CR 185.2.a / 440.2.c / 143.4 / 185.2.d). Dependency: a source-backed Universal " +
    "Power contract, the Gold token ability program that uses it, and token-play entry-state preservation; otherwise no Gold token may be materialized.",
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

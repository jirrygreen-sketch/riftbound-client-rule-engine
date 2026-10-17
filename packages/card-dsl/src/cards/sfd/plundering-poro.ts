import type { CardProgram } from "../../ir/index.js";

/**
 * Plundering Poro (sfd-069-221) — rumble-sfd (RIFT-95).
 *
 * "When I conquer, play a Gold gear token exhausted."
 *
 * Trigger: the "conquer" scoring timing point, filtered to this unit
 * conquering (CR 471.1, 473.2.a).
 *
 * The body plays a NEW Gold gear token exhausted. Two gaps remain after the
 * merged token/binding batches (play mode, program binding):
 * - effect.token's frozen definition table deliberately omits the Gold gear
 *   token (CR 187.5 prints "[Reaction][>] Kill this, [E]: [Add] [A]", so the
 *   definition carries an ability), and the primitive documents that entry
 *   overrides ("enters exhausted", CR 143.4 / 185.2.d) are not supported; a
 *   later exhaust action cannot substitute for the entry state.
 * - The conquer producer emits only { player, details: { battlefieldId } }
 *   (turn/flow.ts's Score wave): the conquer timing point carries no Unit or
 *   Battlefield object, so a unit-relative Conquer Effect (CR 383.4.c.2.a)
 *   has no carrier identity to match and EventPattern/ObjectFilter have no
 *   battlefield anchor either.
 */
export default {
  canonicalCardId: "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Two gaps. (1) The body cannot create the printed token: effect.token's frozen definition table deliberately omits the Gold gear token " +
    "(CR 187.5 prints \"[Reaction][>] Kill this, [E]: [Add] [A]\", i.e. a definition with an ability, and the primitive's own contract keeps such " +
    "definitions blocked), and effect.token supports no entry override, so the token cannot enter exhausted (CR 143.4 / 185.2.d); replacing the entry " +
    "state with a later exhaust action would be an approximation. Token play mode itself is merged (create-token to chain + play). " +
    "(2) The conquer timing point has no carrier identity: turn/flow.ts's Score wave emits { player, details: { battlefieldId } } only, so the " +
    "source:self filter of a unit-relative Conquer Effect (CR 383.4.c.2.a) can never match, and neither EventPattern nor ObjectFilter offers a " +
    "battlefield-relative anchor. Dependencies: a Gold token definition with its printed activated ability, an entry-state override (or the " +
    "replacement/entry pipeline that provides it), and a conquer payload carrying the conquering Unit/Battlefield (conquer producers + binding).",
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
            location: { kind: "constant", value: { type: "base", player: "controller" } }
          }
        }
      ]
    }
  ],
  sourceText: "When I conquer, play a Gold gear token exhausted."
} satisfies CardProgram;

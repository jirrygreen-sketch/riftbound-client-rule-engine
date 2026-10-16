import type { CardProgram } from "../../ir/index.js";

/**
 * sfd-106-221 Show of Strength (Spell, Body)
 * "[Reaction] (Play any time, even before spells and abilities resolve.)
 *  Draw 1 for each of your [Mighty] units. (A unit is Mighty while it has
 *  5+ [M].)"
 *
 * Catalog evidence (deck-catalog.json, dataVersion 2026-10-12-official-gallery):
 * energy 2, power 1 (Body).
 *
 * Structure (contract 3.1 / 3.2):
 * - `keyword: "reaction"` keeps the printed [Reaction] keyword (CR v1.5 813).
 * - A single `effect.draw` instruction whose amount is a count expression over
 *   the controller's Mighty units. Mighty is a description, not a keyword
 *   (CR v1.5 706-708: a unit "is Mighty" as long as its Might is 5 or
 *   greater); "your Mighty units" is a non-target collection query (no
 *   targets are chosen, so nothing triggers "becomes a target").
 * - effect.draw submits one { type: "draw" } action for the controller
 *   (414.1/414.3 "Draw X"); deck-shortage Burn Out handling (414.4) stays
 *   with the kernel.
 *
 * Status is judge-required: the Might predicate in the count filter requires
 *   the condition.predicate / condition.value "mighty" filter supported by the
 *   Mighty keyword (kw-mighty); the frozen keyword registry is currently empty
 *   (RIFT-16 generator target, keyword implementations are the RIFT-83 scope).
 *   Until the Mighty predicate exists in the registry, the numeric
 *   `might-gte-5` filter used here is descriptive rather than verified against
 *   an official keyword definition.
 */
export default {
  canonicalCardId: "card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The amount expression counts 'your Mighty units' through a count filter " +
    "{ type: 'unit', controller: 'you', mightGte: 5 }. Mighty is CR v1.5 706-708 " +
    "(a unit is Mighty while its Might is 5+), but the keyword registry that is " +
    "supposed to own the canonical 'mighty' predicate is still empty " +
    "(keywords/registry.generated.ts has no entries; kw-mighty is part of the " +
    "RIFT-83 keyword scope). The draw instruction itself (effect.draw, " +
    "count-driven amount) is fully merged; only the official Mighty predicate " +
    "binding is missing, so the card stays judge-required rather than " +
    "approximating the predicate.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "draw-per-mighty",
          op: "effect.draw",
          args: {
            amount: {
              kind: "count",
              subject: "unit",
              filter: { type: "unit", controller: "you", mightGte: 5 }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Draw 1 for each of your [Mighty] units. (A unit is Mighty while it has " +
    "5+ :rb_might:.)"

} satisfies CardProgram;

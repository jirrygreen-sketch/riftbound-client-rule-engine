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
 * Official source: Core Rules v1.5, published 2026-10-09 and effective
 * 2026-10-16 (https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf).
 * - `keyword: "reaction"` keeps the printed [Reaction] keyword (CR v1.5 813).
 * - A single `effect.draw` instruction whose amount is a count expression over
 *   the controller's Mighty units. Mighty is a description, not a keyword
 *   (CR v1.5 706-708: a unit "is Mighty" as long as its Might is 5 or
 *   greater; 710: Board units use current Might); "your Mighty units" is a
 *   non-target collection query (no targets are chosen, so nothing triggers
 *   "becomes a target"). The amount is evaluated when this CardProgram
 *   resolves, after lower Chain items such as layer changes have resolved.
 * - effect.draw submits one { type: "draw" } action for the controller
 *   (309.1.a + 813.1.b/c permission in a Closed State; 414.1/414.3
 *   "Draw X"); deck-shortage Burn Out handling (414.4) stays with the kernel.
 *
 * Status is executable: programs/filters.ts preserves `mightGte`, the shared
 * predicate matcher compares it with the candidate's current layered Might,
 * and the interpreter's count expression queries that set when the draw
 * resolves. The production golden proves the 4/5 boundary, controller scoping,
 * layered Might, live recount after Finalize, and the real Reaction play path.
 */
export default {
  canonicalCardId: "card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f",
  rulesetVersion: "core-1.5",
  status: "executable",
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

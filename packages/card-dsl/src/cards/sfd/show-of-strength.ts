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
 * Status is judge-required, with a narrower gap than the original note: the
 * Mighty KeywordDef has since merged (effects/keywords/Mighty.ts), but it only
 * publishes a static `condition.value` predicate shape — programs/statics.ts's
 * layerFor has no mapping for `condition.value` (golden: bindStatic throws
 * ProgramBindingError "Static ability kind condition.value has no layer
 * mapping"), layers/engine.ts's conditionMatches only resolves
 * always/never/type/has-tag/has-keyword, and ObjectFilter has no Might-threshold
 * predicate slot. Every merged filter matcher silently ignores the declared
 * `mightGte: 5` key (layers/filter.ts matchesObjectFilter reads
 * type/zone/controller/owner/tags/characteristics only; the reference kernel's
 * query treats unknown keys as always-true; programs/filters.ts
 * translateObjectFilter rejects unknown keys outright), so evaluating this
 * amount through the merged query path would count every unit the controller
 * has. The predicate is therefore descriptive and cannot be executed without
 * inventing semantics. The play body itself binds through the merged adapter,
 * and the count-driven draw executes (golden).
 */
export default {
  canonicalCardId: "card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The amount expression counts 'your Mighty units' through the count filter " +
    "{ type: 'unit', controller: 'you', mightGte: 5 }. Mighty is CR v1.5 706-708 (a unit is Mighty " +
    "while its Might is 5 or greater). The Mighty KeywordDef has merged (effects/keywords/Mighty.ts), " +
    "but it only publishes a static `condition.value` 'is-mighty' shape: programs/statics.ts's layerFor " +
    "has no mapping for it (golden: bindStatic throws ProgramBindingError \"Static ability kind " +
    "condition.value has no layer mapping\"), layers/engine.ts conditionMatches only resolves " +
    "always/never/type/has-tag/has-keyword, and ObjectFilter has no Might-threshold slot. Every merged " +
    "filter matcher silently ignores the unknown `mightGte` key (layers/filter.ts matchesObjectFilter " +
    "reads type/zone/controller/owner/tags/characteristics only — golden: a Might-1 unit still " +
    "satisfies the filter once the controller placeholder is bound — the reference kernel's query " +
    "treats unknown keys as always-true, and the production translator rejects the key outright with " +
    "\"Unsupported filter field mightGte\" before any binding), so the declared amount cannot be " +
    "evaluated through the merged path without approximating the printed predicate. The play body binds " +
    "through the merged program adapter and the count-driven draw itself executes (golden); only an " +
    "executable Mighty query consumer is missing (kw-mighty).",
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

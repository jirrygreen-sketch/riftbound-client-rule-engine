import type { Ability, Condition } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * [Mighty] — keyword expansion (P0 contract 3.7).
 *
 * Core Rules v1.5 backing entries (see ruleRefs):
 * - 706: Mighty is a description that applies to some units; other game
 *   effects can check whether a unit is Mighty.
 * - 707/708: A unit "is Mighty" as long as its Might is 5 or greater.
 * - 709: A unit "becomes Mighty" at the moment its Might changes from being
 *   less than 5 to being 5 or greater (drives the might-changed timing point,
 *   whose own ruleRefs are 143.2/383.2.c/708/709).
 * - 710: Units on the board are evaluated by their current Might.
 * - 711: Units in non-board zones are evaluated by their printed Might.
 *
 * Mighty is not valued (printed "[Mighty]", never "[Mighty N]") and does not
 * stack: rules 706-711 define it as a binary description ("is Mighty" /
 * "becomes Mighty"), so multiple copies of the keyword count once
 * (stacking: "single"). Mighty itself grants no effect — cards like Rumble
 * and Fiora, Victorious author their own "While I'm Mighty, ..." static
 * abilities whose condition references this predicate — so the expansion is
 * one static ability exposing the rule 708 threshold predicate:
 *
 *   { kind: "static",
 *     effect: { kind: "condition.value", predicate: "is-mighty", subject: host,
 *               threshold: 5, zoneEvaluation: {...}, ruleRefs: [...] } }
 *
 * Dependencies NOT yet merged (declared per task instructions, not
 * approximated here):
 * - The "condition.value" continuous-effect evaluator (survey
 *   ability-templates.md maps Mighty to condition.value; RIFT-89~91 own the
 *   continuous/condition primitives). Until it lands, layers code evaluates
 *   this predicate by reading the subject unit might (current might on the
 *   board per rule 710, printed might in non-board zones per rule 711).
 * - No instruction primitives are used: Mighty has no triggered/activated
 *   body. "Becomes Mighty" events are already covered by the existing
 *   might-changed timing point.
 */

/** v1.5 rule 708: a unit "is Mighty" as long as its Might is 5 or greater. */
export const MIGHTY_THRESHOLD = 5;

/**
 * The predicate shape other abilities use to ask "is this unit Mighty?"
 * (compare subject might against the rule 708 threshold). Exposed for card
 * programs and tests; the expansion embeds the same semantics in its static
 * ability effect.
 */
export function mightyCondition(_subject: CardContextRef): Condition {
  return {
    kind: "compare",
    left: {
      kind: "object-attribute",
      // The keyword predicate reads its host, not the static catalog id.
      object: "self",
      attribute: "might"
    },
    operator: "gte",
    right: { kind: "constant", value: MIGHTY_THRESHOLD }
  };
}

const Mighty = {
  keyword: "Mighty",
  valued: false,
  stacking: "single",
  expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
    const predicate: Ability = {
      kind: "static",
      effect: {
        kind: "condition.value",
        predicate: "is-mighty",
        subject: { kind: "constant", value: input.host.canonicalCardId },
        threshold: MIGHTY_THRESHOLD,
        zoneEvaluation: { board: "current-might", nonBoard: "printed-might" },
        ruleRefs: ["706", "707", "708", "710", "711"]
      }
    };
    return Object.freeze([predicate]);
  },
  ruleRefs: ["706", "707", "708", "709", "710", "711"]
} satisfies KeywordDef;

export default Mighty;

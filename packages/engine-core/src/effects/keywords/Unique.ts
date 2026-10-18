import type { Ability } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

/**
 * Unique — Core Rules v1.5 §825.
 *
 * Unique is a deck-construction restriction. There is no gameplay ability to
 * expand, and the current KeywordDef contract has no deck-validation return
 * channel. Register the characteristic with an empty expansion rather than
 * fabricating a board effect; deck builders continue to enforce the rule from
 * card data. The lower-case registry id preserves legacy exact-key lookups
 * while programs/keywords.ts still resolves it case-insensitively.
 */
const unique = {
  keyword: "unique",
  valued: false,
  stacking: "single",
  expand(): readonly Ability[] {
    return Object.freeze([]);
  },
  ruleRefs: ["825", "825.1", "825.2", "825.3", "825.3.a", "825.3.b", "825.4", "825.5"]
} satisfies KeywordDef;

export default unique;

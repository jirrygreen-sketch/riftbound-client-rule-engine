import type { Ability } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

/**
 * Hidden (Core Rules v1.5, 811) expands to the static hidden-cost effect.
 *
 * The expansion remains deliberately additive: the static declaration is the
 * stable IR shape consumed by the program binder, while the executable Hide /
 * Facedown / next-turn lifecycle lives in `zones/hidden`.  Keeping this file
 * free of state mutation preserves the normal keyword expansion contract.
 */
const Hidden = {
  keyword: "Hidden",
  valued: false,
  stacking: "single",
  ruleRefs: [
    "811.1",
    "811.1.a",
    "811.1.b",
    "811.1.c",
    "811.1.c.1",
    "811.1.c.2",
    "811.1.c.3",
    "811.1.d",
    "811.1.d.1",
    "811.1.d.1.a",
    "811.1.d.2",
    "811.1.d.3",
    "811.1.d.3.a",
    "811.1.d.4",
    "811.1.d.5",
    "811.2",
    "811.3",
    "811.4",
    "811.5",
    "811.5.a",
    "811.6",
    "811.6.a"
  ],
  expand(): readonly Ability[] {
    return [{
      kind: "static",
      effect: { kind: "cost.hidden" }
    }];
  }
} satisfies KeywordDef;

export default Hidden;

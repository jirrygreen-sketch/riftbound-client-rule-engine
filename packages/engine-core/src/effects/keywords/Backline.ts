import type { Ability } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * [Backline] — Core Rules v1.5 rule 826.
 *
 * 826.3/.4 define Backline as the opposite combat-damage assignment
 * requirement to Tank: the host must receive lethal damage after a
 * same-controller unit that does not have Backline.  826.4.a/.4.b preserve
 * normal lethal assignment and allow free choice among multiple Backline
 * units.  826.5 makes repeated Backline instances redundant; 826.6 makes the
 * keyword a readable Unit characteristic.
 *
 * The expansion only describes the continuous combat restriction.  The
 * combat step, rather than this KeywordDef, decides which assignment is legal
 * and applies the requirement at the point damage is assigned.
 *
 * Dependencies not yet merged (RIFT-258/259 and the combat workstream):
 * - the `continuous.combat` consumer and layers path;
 * - combat-damage assignment ordering and lethal-damage checks;
 * - keyword-characteristic/ignored-ability plumbing (CR 764–767).
 * Until those pieces land, the expansion remains judge-safe declarative IR
 * and is not treated as an executable combat implementation.
 */
const BACKLINE_EFFECT = Object.freeze({
  kind: "continuous.combat",
  appliesTo: "self",
  mode: "damage-assignment",
  priority: "last",
  damage: "lethal",
  controllerScope: "same-controller",
  excludesKeyword: "Backline"
} as const);

function expand(_input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
  return [
    {
      kind: "static",
      effect: { ...BACKLINE_EFFECT }
    }
  ];
}

const backline = {
  keyword: "Backline",
  valued: false,
  stacking: "single",
  expand,
  ruleRefs: [
    "826",
    "826.1",
    "826.2",
    "826.3",
    "826.4",
    "826.4.a",
    "826.4.b",
    "826.5",
    "826.6",
    "467.2.c.6",
    "467.2.c.7",
    "467.2.c.8",
    "467.2.c.9",
    "764",
    "766",
    "767"
  ]
} satisfies KeywordDef;

export default backline;

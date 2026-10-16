import type { Ability } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * [Tank] — Core Rules v1.5 rule 815.
 *
 * 815.1.b/.c define Tank as a passive combat-damage assignment requirement:
 * the host must receive lethal damage before a same-controller unit that does
 * not have Tank.  815.1.c.1/.c.2 preserve the normal lethal-assignment rule
 * and allow the assigning player to choose freely among multiple Tank units.
 * 815.2 makes repeated Tank instances redundant; 815.3 makes the keyword a
 * readable Unit characteristic.
 *
 * The expansion is deliberately declarative.  `continuous.combat` is the
 * EffectIR shape consumed by the combat damage-assignment and layers work;
 * this keyword does not inspect a battlefield or mutate a damage plan.
 *
 * Dependencies not yet merged (RIFT-258/259 and the combat workstream):
 * - the `continuous.combat` consumer that evaluates assignment priorities;
 * - the combat-damage assignment path that enforces lethal-first ordering;
 * - keyword-characteristic/ignored-ability plumbing (CR 764–767).
 * Until those pieces land, this static ability is structurally valid IR but
 * has no runtime consumer.  No approximate damage flow is implemented here.
 */
const TANK_EFFECT = Object.freeze({
  kind: "continuous.combat",
  appliesTo: "self",
  mode: "damage-assignment",
  priority: "first",
  damage: "lethal",
  controllerScope: "same-controller",
  excludesKeyword: "Tank"
} as const);

function expand(_input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
  return [
    {
      kind: "static",
      effect: { ...TANK_EFFECT }
    }
  ];
}

const tank = {
  keyword: "Tank",
  valued: false,
  stacking: "single",
  expand,
  ruleRefs: [
    "815",
    "815.1",
    "815.1.a",
    "815.1.b",
    "815.1.c",
    "815.1.c.1",
    "815.1.c.2",
    "815.2",
    "815.3",
    "467.2.c.6",
    "467.2.c.7",
    "467.2.c.8",
    "467.2.c.9",
    "764",
    "766",
    "767"
  ]
} satisfies KeywordDef;

export default tank;

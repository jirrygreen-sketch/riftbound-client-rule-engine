import type { Ability, Expr, Value } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * Disarm — Core Rules v1.5 rule 831.
 *
 * 831.1 makes Disarm an attack trigger on Units: when the host attacks, give
 * an enemy Unit at that Battlefield -X Might this turn. 831.1.d.1 requires
 * all instances on one Unit to produce one trigger using the total value, and
 * 831.2 sums values granted from additional sources.
 *
 * Dependencies that are not yet merged (RIFT-258/259):
 * - the `continuous.might` instruction and duration/layer consumer;
 * - attack event registration and the runtime binding of the host's location.
 * The expansion keeps the exact instruction and target shape required by the
 * contract; it does not approximate a Might change with Buffs or direct state
 * mutation.
 */

const constant = (value: Value): Expr => ({ kind: "constant", value });

/** Value presumed when the printed keyword omits its Disarm Value (831.1.c.3). */
export const DISARM_DEFAULT_VALUE = 1 as const;

const disarm = {
  keyword: "Disarm",
  valued: true,
  stacking: "sum",
  expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
    const amount = input.value ?? DISARM_DEFAULT_VALUE;
    const modifier = amount === 0 ? 0 : -amount;
    return [{
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } }
      },
      optional: false,
      body: [{
        id: "disarm.give-minus-might",
        op: "continuous.might",
        args: {
          amount: constant(modifier),
          duration: constant("this-turn"),
          target: constant("disarm.enemy-unit")
        },
        targets: [{
          id: "disarm.enemy-unit",
          filter: { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source" },
          min: 1,
          max: 1,
          selection: "one"
        }]
      }]
    }];
  },
  ruleRefs: [
    "831",
    "831.1",
    "831.1.a",
    "831.1.b",
    "831.1.c",
    "831.1.c.1",
    "831.1.c.2",
    "831.1.c.3",
    "831.1.d",
    "831.1.d.1",
    "831.2",
    "831.3"
  ]
} satisfies KeywordDef;

export default disarm;

/**
 * Equip expands to an activated attachment ability.
 *
 * Dependencies that are not merged yet:
 * - `cost.activated` / `cost.pay` must bind and pay the printed Equip cost.
 * - The host card's live source and controller must be supplied by the
 *   activation layer when the target and cost are resolved.
 */
import type { Ability, Expr, Value } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

const constant = (value: Value): Expr => ({ kind: "constant", value });

const equip = {
  keyword: "Equip",
  valued: false,
  stacking: "separate",
  ruleRefs: [
    "818",
    "818.1",
    "818.1.a",
    "818.1.b",
    "818.1.b.1",
    "818.1.b.2",
    "818.1.c",
    "818.1.c.2",
    "818.1.c.3",
    "818.1.c.4",
    "818.1.c.5",
    "818.2",
    "818.2.a",
    "818.4",
    "818.5"
  ],
  expand(): readonly Ability[] {
    return [{
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        payments: [{ kind: "equip", value: constant({ kind: "source" }) }]
      },
      body: [{
        id: "equip-attach",
        op: "effect.attach",
        args: {
          host: constant({ kind: "target", id: "equip-target" })
        },
        targets: [{
          id: "equip-target",
          filter: { type: "unit", controller: "self" },
          min: 1,
          max: 1,
          selection: "one"
        }]
      }]
    }];
  }
} satisfies KeywordDef;

export default equip;

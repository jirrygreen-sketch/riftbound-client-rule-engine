/**
 * Weaponmaster expands to a play trigger with an optional Equipment choice,
 * Equip-cost calculation/payment, and attachment to the source Unit.
 *
 * Dependencies that are not merged yet:
 * - `choice.optional` must expose the chosen controlled Equipment to later
 *   instructions and allow the player to decline the choice.
 * - `cost.modify` / `cost.pay` must calculate the chosen card's Equip cost,
 *   apply the one-any-Power reduction, and pay it without activating Equip.
 */
import type { Ability, Expr, Value } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

const constant = (value: Value): Expr => ({ kind: "constant", value });
const linked = (instructionId: string, key: string): Expr => ({
  kind: "linked-value",
  instructionId,
  key
});

const weaponmaster = {
  keyword: "Weaponmaster",
  valued: false,
  stacking: "separate",
  ruleRefs: [
    "821",
    "821.1",
    "821.1.a",
    "821.1.b",
    "821.1.c",
    "821.1.c.1",
    "821.1.c.2",
    "821.1.c.2.a",
    "821.1.c.2.b",
    "821.1.c.3",
    "821.1.c.4",
    "821.1.c.5",
    "821.1.c.6",
    "821.1.c.7",
    "821.1.d",
    "821.2",
    "821.3"
  ],
  expand({ host }): readonly Ability[] {
    const source = { canonicalCardId: host.canonicalCardId };
    return [{
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          source
        }
      },
      optional: false,
      body: [
        {
          id: "weaponmaster-choice",
          op: "choice.optional",
          args: {
            choice: constant({
              id: "weaponmaster-equipment",
              filter: { type: "gear", controller: "self", tags: ["Equipment"] },
              min: 0,
              max: 1,
              selection: "up-to"
            })
          }
        },
        {
          id: "weaponmaster-cost",
          op: "cost.modify",
          linkedTo: "weaponmaster-choice",
          args: {
            source: linked("weaponmaster-choice", "choice"),
            modifier: constant({
              kind: "reduce-equip-cost",
              resource: "power",
              amount: 1,
              domain: "any"
            })
          }
        },
        {
          id: "weaponmaster-pay",
          op: "cost.pay",
          linkedTo: "weaponmaster-cost",
          args: {
            cost: linked("weaponmaster-cost", "cost")
          }
        },
        {
          id: "weaponmaster-attach",
          op: "effect.attach",
          linkedTo: "weaponmaster-pay",
          args: {
            objects: linked("weaponmaster-choice", "choice"),
            host: constant({ kind: "source" })
          }
        }
      ]
    }];
  }
} satisfies KeywordDef;

export default weaponmaster;

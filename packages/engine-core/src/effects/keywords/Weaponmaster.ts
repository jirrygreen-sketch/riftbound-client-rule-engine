/**
 * Weaponmaster expands to a play trigger with a 0..1 Equipment TargetSpec,
 * Equip-cost calculation/payment, and attachment to the source Unit.
 * The merged sequence/TargetSpec/count primitives guard the body when no
 * Equipment is selected; choice.optional only chooses a boolean, not objects.
 *
 * Status: judge-required. Dependencies that are not merged yet (CR 821.1.c):
 * - The play-effect targeting layer must bind the symbolic controller filter
 *   and supply the chosen Equipment; TestWorld does not bind "self" aliases.
 * - `cost.modify` / `cost.pay` must calculate the chosen card's Equip cost,
 *   apply the one-any-Power reduction, and pay it without activating Equip.
 */
import type { Ability, Value } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

const constant = (value: Value) => ({ kind: "constant" as const, value });
const linked = (instructionId: string, key: string) => ({
  kind: "linked-value" as const,
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
          op: "sequence",
          targets: [{
            id: "weaponmaster-equipment",
            filter: { type: "gear", controller: "self", tags: ["Equipment"] },
            min: 0,
            max: 1,
            selection: "up-to"
          }],
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "objects",
              filter: { object: { target: "weaponmaster-equipment" } }
            },
            operator: "gt",
            right: constant(0)
          },
          args: {
            body: constant([
              {
                id: "weaponmaster-cost",
                op: "cost.modify",
                args: {
                  source: constant({ kind: "target", id: "weaponmaster-equipment" }),
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
                  objects: constant({ kind: "target", id: "weaponmaster-equipment" }),
                  host: constant({ kind: "source" })
                }
              }
            ])
          }
        }
      ]
    }];
  }
} satisfies KeywordDef;

export default weaponmaster;

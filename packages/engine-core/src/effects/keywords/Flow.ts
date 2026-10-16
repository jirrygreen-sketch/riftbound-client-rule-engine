import type { Ability, CostSpec, Expr, Value } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * Flow — Core Rules v1.5 §829.
 *
 * Flow is a non-valued, separately stackable alternate-cost keyword.  Its
 * expansion declares the Flow cost for a Spell in Trash and a delayed
 * replacement that sends the finalized Flow spell to Banishment when it would
 * otherwise leave the Chain.  The card's ordinary Spell timing remains owned
 * by the card and Chain; Flow only adds the Trash source permission.
 *
 * Dependencies that are not merged yet:
 * - `flow.cost` needs the RIFT-261 cost consumer to expose a selectable
 *   alternate cost, preserve null printed costs, and record which separate
 *   Flow instance was paid.
 * - `replacement.event` needs the RIFT-260 replacement registration/ordering
 *   path.  It must distinguish a normal Chain exit from a leave instructed by
 *   the Spell itself (829.1.b.1).
 * - `continuous.timing`/play-from-Trash location checks and the Chain's
 *   finalized-item state are still unmerged.  `effect.banish` itself is
 *   merged and is used as the replacement body once the replacement path
 *   exists.
 *
 * Contract note: the frozen local KeywordDef source still exposes only
 * `{ value, host }`, while contract §3.8 specifies a `params.cost` extension.
 * This definition accepts both the existing `cost` spelling used by Repeat
 * and the §3.8 `params.cost` spelling until the shared contract is updated.
 */

export interface FlowKeywordInput {
  readonly value?: number;
  readonly host: CardContextRef;
  /** Existing keyword implementations' cost extension. */
  readonly cost?: CostSpec;
  /** Contract §3.8 spelling for a printed Flow cost. */
  readonly params?: Readonly<Record<string, Value | CostSpec | undefined>> & {
    readonly cost?: CostSpec;
  };
}

const constant = (value: Value): Expr => ({ kind: "constant", value });

function flowCost(input: FlowKeywordInput): CostSpec | undefined {
  return input.params?.cost ?? input.cost;
}

const flow = {
  keyword: "Flow",
  // 829.1.c formats Flow as “Flow [Cost]”; the parameter is a CostSpec, not a
  // numeric keyword value.
  valued: false,
  // 829.1.c.3: separate Flow instances with different costs are selectable,
  // so they remain separate rather than being merged or deduplicated.
  stacking: "separate",
  expand(input: FlowKeywordInput): readonly Ability[] {
    const cost = flowCost(input);
    const costEffect = {
      kind: "flow.cost",
      appliesTo: "self",
      // Contract §3.8 binds the live host at resolution; static IR uses the
      // symbolic selector rather than a runtime/card-catalog identity.
      host: "self",
      sourceZone: "trash",
      ...(cost === undefined ? {} : { cost })
    };

    return [
      {
        kind: "static",
        effect: costEffect
      },
      {
        kind: "replacement",
        replaces: {
          event: "object-leaves-chain",
          filter: {
            source: "self",
            zone: "chain",
            // 829.1.b.1 excludes a leave explicitly instructed by the Spell's
            // own execution.  The replacement consumer resolves this marker.
            leavingInstruction: false
          }
        },
        condition: {
          kind: "expression",
          value: constant("flow-cost-selected")
        },
        with: [
          {
            id: `flow:${input.host.canonicalCardId}:banish`,
            op: "effect.banish",
            args: {
              // effect.banish accepts the symbolic source selector as the
              // string value `source`; `{ kind: "source" }` is a runtime
              // object shape and is rejected by its argument schema.
              objects: constant("source")
            }
          }
        ]
      }
    ];
  },
  ruleRefs: [
    "829",
    "829.1",
    "829.1.a",
    "829.1.b",
    "829.1.b.1",
    "829.1.b.2",
    "829.1.c",
    "829.1.c.1",
    "829.1.c.2",
    "829.1.c.3",
    "829.2"
  ]
} satisfies KeywordDef;

export default flow;

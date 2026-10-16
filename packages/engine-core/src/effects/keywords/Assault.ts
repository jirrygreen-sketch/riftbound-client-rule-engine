import type { Ability, ObjectSelector } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * Assault - Core Rules v1.5 rule 807.
 *
 * Rule evidence (v1.5, `/root/swarm-rift/shared/rules/CR-v1.5.txt`):
 * - 807.1: Assault is a Passive Ability keyword.
 * - 807.1.a: It is present on Units.
 * - 807.1.b / 807.1.b.1 / 807.1.b.2: formatted "Assault [X]"; X is the
 *   Assault Value referenced by the functional text.
 * - 807.1.b.3: if X is omitted, it is presumed to be 1.
 * - 807.1.c: functionally short for "While I am an attacker, I have +X [M]".
 * - 807.1.d / 807.1.d.1: the attacker designation is gained during Combat
 *   (rule 461) and Assault remains in effect only while the Unit maintains it.
 * - 807.2: Assault granted by additional sources sums into a single Assault
 *   Value (Petty Officer + Cleave = Assault 4).
 * - 807.3: whether or not a Unit has Assault is a readable characteristic.
 *
 * Expansion shape (this keyword never runs game flow itself):
 *
 *   static ability {
 *     effect: { kind: "continuous.might", mode: "add", layer: "arithmetic",
 *               appliesTo: "self", amount: <Assault Value> },
 *     condition: compare(object-property(self, "designation") eq "attacker")
 *   }
 *
 * The layers system evaluates this outside the chain: +X Might in the
 * arithmetic layer for exactly as long as the host holds the Attacker
 * designation, nothing while defending or outside combat (807.1.d.1).
 *
 * Stacking is declared on the KeywordDef ("sum"): the keyword registrar
 * merges every Assault instance on one object and calls expand once with the
 * summed value, so expand always emits exactly one static ability.
 *
 * Dependencies that are NOT yet merged (written per contract, executed by
 * later workstreams - no approximate implementation here):
 * - RIFT-91 layers/continuous.might: the "continuous.might" static effect
 *   kind is authored here per contract 3.7/ability-templates; no registered
 *   instruction op or layer evaluator consumes it yet.
 * - Attacker designation characteristic: "designation" is not yet part of the
 *   interpreter's ObjectSnapshot and no "condition.predicate" primitive is
 *   merged yet, so the compare condition cannot be evaluated by the current
 *   reference interpreter.
 * - Host binding uses the contract 3.6 symbolic "self" selector; the
 *   interpreter binds the live host reference at resolution.
 */

/** Value presumed when the printed keyword omits the Assault Value (807.1.b.3). */
export const ASSAULT_DEFAULT_VALUE = 1 as const;

/** Symbolic host selector; the exported name is kept for existing callers. */
export const SELF_OBJECT_REF: ObjectSelector = "self";

const assault = {
  keyword: "Assault",
  valued: true,
  stacking: "sum",
  expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
    const amount = input.value ?? ASSAULT_DEFAULT_VALUE;
    return [
      {
        kind: "static",
        effect: {
          kind: "continuous.might",
          mode: "add",
          layer: "arithmetic",
          appliesTo: "self",
          amount: { kind: "constant", value: amount }
        },
        condition: {
          kind: "compare",
          left: { kind: "object-property", object: SELF_OBJECT_REF, property: "designation" },
          operator: "eq",
          right: { kind: "constant", value: "attacker" }
        }
      }
    ];
  },
  ruleRefs: ["807", "807.1", "807.1.b", "807.1.b.3", "807.1.c", "807.1.d", "807.1.d.1", "807.2", "807.3"]
} satisfies KeywordDef;

export default assault;

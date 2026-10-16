import type { Ability, ObjectRef } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * Shield - Core Rules v1.5 rule 814.
 *
 * Rule evidence (v1.5, `/root/swarm-rift/shared/rules/CR-v1.5.txt`):
 * - 814.1: Shield is a Passive Ability keyword.
 * - 814.1.a: It is present on Units.
 * - 814.1.b / 814.1.b.1 / 814.1.b.2: formatted "Shield [X]"; X is the
 *   Shield Value referenced by the functional text.
 * - 814.1.b.3: if X is omitted, it is presumed to be 1.
 * - 814.1.c: functionally short for "While I am a defender, I have +X [M]".
 * - 814.1.d / 814.1.d.1: the defender designation is gained during Combat
 *   (rule 461) and Shield remains in effect only while the Unit maintains it.
 * - 814.2: Shield granted by additional sources sums into a single Shield
 *   Value (Stalwart Poro + Block = Shield 4).
 * - 814.3: whether or not a Unit has Shield is a readable characteristic.
 *
 * Expansion shape (this keyword never runs game flow itself):
 *
 *   static ability {
 *     effect: { kind: "continuous.might", mode: "add", layer: "arithmetic",
 *               appliesTo: "self", amount: <Shield Value> },
 *     condition: compare(object-property(self, "designation") eq "defender")
 *   }
 *
 * The layers system evaluates this outside the chain: +X Might in the
 * arithmetic layer for exactly as long as the host holds the Defender
 * designation, nothing while attacking or outside combat (814.1.d.1).
 *
 * Stacking is declared on the KeywordDef ("sum"): the keyword registrar
 * merges every Shield instance on one object and calls expand once with the
 * summed value, so expand always emits exactly one static ability.
 *
 * Dependencies that are NOT yet merged (written per contract, executed by
 * later workstreams - no approximate implementation here):
 * - RIFT-91 layers/continuous.might: the "continuous.might" static effect
 *   kind is authored here per contract 3.7/ability-templates; no registered
 *   instruction op or layer evaluator consumes it yet.
 * - Defender designation characteristic: "designation" is not yet part of the
 *   interpreter's ObjectSnapshot and no "condition.predicate" primitive is
 *   merged yet, so the compare condition cannot be evaluated by the current
 *   reference interpreter.
 * - Host reference: expand receives only a CardContextRef (canonicalCardId),
 *   while ObjectPropertyExpr.object is typed as a zone-bound ObjectRef yet
 *   validateCardProgram requires that same field to be a plain string. The
 *   expansion therefore addresses the host through the conventional "self"
 *   string reference (accepted by validateCardProgram); binding that name to
 *   the live host object, and reconciling the ObjectRef-vs-string
 *   contradiction in the IR contract, is a contract gap (contract change
 *   request filed with this task).
 */

/** Value presumed when the printed keyword omits the Shield Value (814.1.b.3). */
export const SHIELD_DEFAULT_VALUE = 1 as const;

/**
 * Conventional "self" reference used by keyword expansions to address the
 * object that hosts the keyword, in the string form validateCardProgram
 * accepts. The cast papers over the ObjectRef-vs-string contradiction in the
 * IR contract; the resolver for this name is part of the pending KeywordDef/IR
 * contract extension (see the file header).
 */
export const SELF_OBJECT_REF: ObjectRef = "self" as unknown as ObjectRef;

const shield = {
  keyword: "Shield",
  valued: true,
  stacking: "sum",
  expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
    const amount = input.value ?? SHIELD_DEFAULT_VALUE;
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
          right: { kind: "constant", value: "defender" }
        }
      }
    ];
  },
  ruleRefs: ["814", "814.1", "814.1.b", "814.1.b.3", "814.1.c", "814.1.d", "814.1.d.1", "814.2", "814.3"]
} satisfies KeywordDef;

export default shield;

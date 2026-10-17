import type { Ability, Condition, Expr } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";

/**
 * Empower — Core Rules v1.5 442 / 827 (Empowered's dependent text is 828).
 *
 * Each instance is an independent activated ability, with a printed CostSpec
 * rather than a numeric keyword value. The source is never a target.
 * params.cost preserves resource/non-resource costs and cost modifications;
 * params.timing may carry an explicit timing override (827.1.c.2–c.4).
 * params.multiple and params.limit describe a granted multiple-Empower
 * permission (442.1.c.1 / 827.1.c.5), not additional Empower keyword instances.
 * The limit gates the effect at resolution, never activation legality.
 *
 * Shared integration still required outside this keyword's write scope:
 * - KeywordAbility / programs/keywords must carry per-instance params. Missing
 *   printed costs remain an unsupported cost kind, so binding fails closed;
 *   neither an absent cost nor the legacy numeric value means a free ability.
 * - ObjectSnapshot must expose the reference kernel's live `empowered` count.
 *   Missing information must block evaluation, not become zero. Permission
 *   grants/removals must refresh params through the ability/layers binder.
 * - The empower GameAction must enforce binary/stacking status and caps for
 *   callers other than this keyword too. Its reference-kernel implementation
 *   currently only increments; the conditions below use existing IR to keep
 *   this keyword's resolution within the permitted count.
 */

type EmpowerInput = Parameters<KeywordDef["expand"]>[0];

const constant = (value: number | boolean): Expr => ({ kind: "constant", value });
const empowered: Expr = { kind: "object-property", object: "self", property: "empowered" };
const notEmpowered: Condition = { kind: "compare", left: empowered, operator: "eq", right: constant(0) };

const empower = {
  keyword: "Empower",
  valued: false,
  stacking: "separate",
  ruleRefs: [
    "442.1", "442.1.a", "442.1.b", "442.1.c", "442.1.c.1", "442.2", "442.2.a", "442.3.a",
    "827", "827.1", "827.1.a", "827.1.b", "827.1.b.1", "827.1.c", "827.1.c.1",
    "827.1.c.2", "827.1.c.3", "827.1.c.4", "827.1.c.5", "827.2", "827.2.a", "827.3", "827.4"
  ],
  expand(input: EmpowerInput): readonly Ability[] {
    const multiple = input.params?.multiple === undefined ? false : input.params.multiple;
    const limit = input.params?.limit;
    const timing = input.params?.timing === undefined ? "action" : input.params.timing;
    if (typeof multiple !== "boolean") throw new TypeError("Empower params.multiple must be a boolean");
    if (limit !== undefined && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0)) {
      throw new TypeError("Empower params.limit must be a nonnegative safe integer");
    }
    if (limit !== undefined && !multiple) throw new TypeError("Empower params.limit requires a multiple-Empower permission");
    if (timing !== "action" && timing !== "reaction") throw new TypeError("Empower params.timing must be action or reaction");

    const condition: Condition = !multiple ? notEmpowered : limit === undefined
      ? { kind: "always" }
      : { kind: "compare", left: empowered, operator: "lt", right: constant(limit) };
    return [{
      kind: "activated",
      cost: input.params?.cost ?? { kind: "empower" },
      timing,
      restriction: {
        kind: "empower",
        // 827.1.c.5: the permission removes the normal restriction even at cap.
        condition: multiple ? { kind: "always" } : notEmpowered
      },
      body: [{
        id: `empower:${input.host.canonicalCardId}`,
        op: "effect.empower",
        // The primitive's default selection is its source (827.1.b.1).
        args: {
          amount: constant(1),
          ...(multiple ? { multiple: constant(true) } : {}),
          ...(limit === undefined ? {} : { limit: constant(limit) })
        },
        // Recheck the live count: another ability may Empower us on the chain.
        condition
      }]
    }];
  }
} satisfies KeywordDef;

export default empower;

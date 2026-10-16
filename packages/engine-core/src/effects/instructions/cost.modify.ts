/**
 * cost.modify -- lock a final CR v1.5 356-357 cost plan for this source.
 *
 * The planner already applies the full ordered modification pipeline: base,
 * alternate/ignore modifications (356.1), optional additional costs including
 * Accelerate (356.2, 805), mandatory additional costs (356.2.a), increases
 * (356.3), component discounts (356.4.c), total discounts (356.4.d), per-
 * discount minima (356.4.e), the zero floor (356.4.f / 356.6), variable
 * discounts checked at Finalize (356.4.g), and explicit total rewrites
 * (356.5). This primitive never re-implements order arithmetic: it evaluates
 * the requested discount/increase expressions, feeds them to `buildCostPlan`,
 * and links the frozen plan.
 *
 * args:
 * - id: stable plan id (required except for the Weaponmaster source form).
 * - source: accepts Weaponmaster's target selector; resolves its exact current
 *   identity, then blocks until an authoritative Equip-cost binding exists.
 * - cost: `CostSpec` for the base cost; defaults to the printed cost.
 * - printed: optional trusted catalog projection.
 * - domains: optional source domains; an empty array explicitly means the
 *   universal six-domain Power (`[A]`).
 * - baseChoices / baseChoice / baseModifications / optionalAdditional /
 *   mandatoryAdditional: existing `CostPlanInput` vocabulary.
 * - modifier / modifiers: `{ kind: 'reduce' | 'increase' |
 *   'reduce-equip-cost', resource: 'energy' | 'power', amount, minimum?,
 *   domains?, powerOrder?, component?, id? }`. Increases are appended in CR
 *   356 order. `reduce-equip-cost` stays judge-required: the current plan
 *   loses [A]/[C] symbol provenance (821.1.c.3). Never treat it as a generic
 *   Power discount. Each other modifier is one discount instance with its own
 *   minimum (356.4.e); explicit `discountOrder` stays available.
 * - ignoreAllCosts: 356.5 total rewrite.
 * - linkKey: link key for the frozen plan, default `cost` (Weaponmaster links
 *   `cost.pay` to this instruction and reads `cost`).
 *
 * Unknown modifier shapes are `judge-required`: they are never approximated
 * and never become zero costs. The plan is only a linked value; wiring it
 * into the production Finalize play pipeline is the parent-owned contract
 * integration requested in `src/cost/kinds/README.md`.
 */
import type {
  Domain,
  Expr,
  InstructionDef,
  InstructionResult,
  ResolveContext,
  Value
} from "../contract.js";
import { CostPlanError, type CostPlanInput } from "../../cost/plan-types.js";
import { buildCostPlan } from "../../cost/cost-plan.js";

export interface CostModifierInput {
  readonly kind: "reduce" | "increase" | "reduce-equip-cost";
  readonly resource: "energy" | "power";
  readonly amount: Expr;
  readonly minimum?: Expr;
  readonly domains?: readonly Domain[];
  readonly powerOrder?: readonly number[];
  readonly component?: string;
  readonly id?: string;
}

export interface CostModifyArgs {
  readonly id?: string;
  readonly source?: Expr | { readonly kind: "target"; readonly id: string };
  readonly cost?: CostPlanInput["cost"];
  readonly printed?: CostPlanInput["printed"];
  readonly domains?: readonly Domain[];
  readonly baseChoices?: CostPlanInput["baseChoices"];
  readonly baseChoice?: string;
  readonly baseModifications?: CostPlanInput["baseModifications"];
  readonly optionalAdditional?: CostPlanInput["optionalAdditional"];
  readonly mandatoryAdditional?: CostPlanInput["mandatoryAdditional"];
  readonly discountOrder?: readonly string[];
  readonly modifier?: CostModifierInput;
  readonly modifiers?: readonly CostModifierInput[];
  readonly ignoreAllCosts?: boolean;
  readonly linkKey?: string;
}

const MODIFIER_KEYS = new Set([
  "kind",
  "resource",
  "domain",
  "amount",
  "minimum",
  "domains",
  "powerOrder",
  "component",
  "id"
]);

const ARGS_KEYS = new Set([
  "id",
  "source",
  "cost",
  "printed",
  "domains",
  "baseChoices",
  "baseChoice",
  "baseModifications",
  "optionalAdditional",
  "mandatoryAdditional",
  "discountOrder",
  "modifier",
  "modifiers",
  "ignoreAllCosts",
  "linkKey"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

function parseModifier(value: unknown, label: string): CostModifierInput {
  if (!isRecord(value)) throw new TypeError(`cost.modify ${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!MODIFIER_KEYS.has(key)) throw new TypeError(`Invalid cost.modify ${label} argument: ${key}`);
  }
  if (value.kind !== "reduce" && value.kind !== "increase" && value.kind !== "reduce-equip-cost") {
    throw new TypeError("cost.modify modifier.kind must be reduce, increase, or reduce-equip-cost");
  }
  if (value.resource !== "energy" && value.resource !== "power") {
    throw new TypeError("cost.modify modifier.resource must be energy or power");
  }
  const amount = value.kind === "reduce-equip-cost" && typeof value.amount === "number"
    && Number.isSafeInteger(value.amount) && value.amount >= 0
    ? { kind: "constant" as const, value: value.amount } : value.amount;
  if (!isExpr(amount)) throw new TypeError("cost.modify modifier.amount must be an Expr");
  if (value.kind === "reduce-equip-cost" && value.resource !== "power") {
    throw new TypeError("reduce-equip-cost requires Power");
  }
  if (value.domain !== undefined && (value.kind !== "reduce-equip-cost" || value.domain !== "any")) {
    throw new TypeError("Only reduce-equip-cost accepts domain: any");
  }
  if (value.minimum !== undefined && !isExpr(value.minimum)) {
    throw new TypeError("cost.modify modifier.minimum must be an Expr");
  }
  if (value.domains !== undefined && (!Array.isArray(value.domains) || value.domains.some(domain => typeof domain !== "string"))) {
    throw new TypeError("cost.modify modifier.domains must be a domain list");
  }
  if (value.powerOrder !== undefined && (!Array.isArray(value.powerOrder) || value.powerOrder.some(entry => !Number.isSafeInteger(entry)))) {
    throw new TypeError("cost.modify modifier.powerOrder must be an integer permutation");
  }
  if (value.component !== undefined && (typeof value.component !== "string" || !value.component.length)) {
    throw new TypeError("cost.modify modifier.component must be a non-empty string");
  }
  if (value.id !== undefined && (typeof value.id !== "string" || !value.id.length)) {
    throw new TypeError("cost.modify modifier.id must be a non-empty string");
  }
  const { domain: _legacyDomain, ...normalized } = value;
  return { ...normalized, amount } as unknown as CostModifierInput;
}

export function parseCostModifyArgs(value: unknown): CostModifyArgs {
  if (!isRecord(value)) throw new TypeError("cost.modify args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARGS_KEYS.has(key)) throw new TypeError(`Invalid cost.modify argument: ${key}`);
  }
  if (value.id === undefined ? value.source === undefined : typeof value.id !== "string" || !value.id.length) {
    throw new TypeError("cost.modify id must be a non-empty string (or supply source)");
  }
  if (value.source !== undefined) {
    const source = value.source;
    const valid = isRecord(source) && (source.kind === "target"
      ? typeof source.id === "string" && source.id.length > 0 : isExpr(source));
    if (!valid) throw new TypeError("cost.modify source must be an Expr or target selector");
  }
  if (value.cost !== undefined && !isRecord(value.cost)) {
    throw new TypeError("cost.modify cost must be a CostSpec object");
  }
  if (value.modifier !== undefined && value.modifiers !== undefined) {
    throw new TypeError("cost.modify accepts either modifier or modifiers, not both");
  }
  const modifier = value.modifier === undefined ? undefined : parseModifier(value.modifier, "modifier");
  if (value.modifiers !== undefined) {
    if (!Array.isArray(value.modifiers)) throw new TypeError("cost.modify modifiers must be an array");
  }
  if (value.linkKey !== undefined && (typeof value.linkKey !== "string" || !value.linkKey.length)) {
    throw new TypeError("cost.modify linkKey must be a non-empty string");
  }
  if (value.ignoreAllCosts !== undefined && typeof value.ignoreAllCosts !== "boolean") {
    throw new TypeError("cost.modify ignoreAllCosts must be a boolean");
  }
  if (value.discountOrder !== undefined && (!Array.isArray(value.discountOrder) || value.discountOrder.some(id => typeof id !== "string"))) {
    throw new TypeError("cost.modify discountOrder must be a list of discount IDs");
  }
  return {
    ...value,
    ...(modifier === undefined ? {} : { modifier }),
    ...(value.modifiers === undefined ? {} : {
      modifiers: (value.modifiers as unknown[]).map((entry, index) => parseModifier(entry, `modifiers[${index}]`))
    })
  } as unknown as CostModifyArgs;
}

export class CostFailure extends CostPlanError {
  constructor(reason: CostPlanError["reason"], detail?: string) {
    super(reason, `cost.modify failed: ${reason}${detail ? `: ${detail}` : ""}`);
    this.name = "CostFailure";
  }
}

function modifiersToCostPlanInput(args: CostModifyArgs & { readonly id: string }): CostPlanInput {
  const modifiers = [...(args.modifier === undefined ? [] : [args.modifier]), ...(args.modifiers ?? [])];
  const discounts: { id: string; component?: string; resource: "energy" | "power"; amount: Expr; minimum?: Expr; domains?: readonly Domain[]; powerOrder?: readonly number[] }[] = [];
  const increases: { id: string; cost: { energy?: Expr; power?: Expr } }[] = [];
  for (const [index, modifier] of modifiers.entries()) {
    const id = modifier.id ?? `${args.id}:modifier:${index}`;
    if (modifier.kind === "reduce-equip-cost") {
      throw new CostPlanError("judge-required", "821.1.c.3: Equip discounts require original [A] symbols; allowedDomains cannot distinguish [A] from [C]");
    }
    if (modifier.kind === "increase") {
      increases.push({ id, cost: { [modifier.resource]: modifier.amount } });
      continue;
    }
    discounts.push({
      id,
      resource: modifier.resource,
      amount: modifier.amount,
      ...(modifier.minimum !== undefined ? { minimum: modifier.minimum } : {}),
      ...(modifier.domains !== undefined ? { domains: modifier.domains } : {}),
      ...(modifier.powerOrder !== undefined ? { powerOrder: modifier.powerOrder } : {}),
      ...(modifier.component !== undefined ? { component: modifier.component } : {})
    });
  }
  return {
    id: args.id,
    ...(args.cost !== undefined ? { cost: args.cost } : { cost: { kind: "printed" as const } }),
    ...(args.printed !== undefined ? { printed: args.printed } : {}),
    ...(args.domains !== undefined ? { domains: args.domains } : {}),
    ...(args.baseChoices !== undefined ? { baseChoices: args.baseChoices } : {}),
    ...(args.baseChoice !== undefined ? { baseChoice: args.baseChoice } : {}),
    ...(args.baseModifications !== undefined ? { baseModifications: args.baseModifications } : {}),
    ...(args.optionalAdditional !== undefined ? { optionalAdditional: args.optionalAdditional } : {}),
    ...(args.mandatoryAdditional !== undefined ? { mandatoryAdditional: args.mandatoryAdditional } : {}),
    ...(args.discountOrder !== undefined ? { discountOrder: args.discountOrder } : {}),
    ...(discounts.length ? { discounts } : {}),
    ...(increases.length ? { increases } : {}),
    ...(args.ignoreAllCosts === true ? { ignoreAllCosts: true } : {})
  };
}

const execute: InstructionDef<CostModifyArgs>["execute"] = (ctx, args): InstructionResult => {
  try {
    if (args.source !== undefined) {
      const selection = args.source.kind === "target" ? args.source : ctx.evaluate(args.source as Expr);
      if (!isRecord(selection) || selection.kind !== "target" || typeof selection.id !== "string") {
        throw new CostPlanError("invalid-cost-plan", "Weaponmaster source must select an Equipment target");
      }
      const refs = ctx.targets(selection.id);
      const equipment = refs.length === 1 ? ctx.object(refs[0]!) : null;
      if (!equipment || equipment.controller !== ctx.controller || equipment.zone !== "board"
        || !equipment.types.includes("gear") || !equipment.tags.includes("Equipment")) {
        throw new CostPlanError("cannot-pay-cost", "Weaponmaster requires one current controlled Equipment target");
      }
      // ObjectSnapshot exposes play Energy/Power and keyword names, not the
      // Equip ability's cost. Neither those fields nor a printed play cost
      // are a valid fallback. Keep the original trigger source/host intact.
      throw new CostPlanError("judge-required", `821.1.c.2: missing authoritative Equip-cost binding for ${equipment.ref.id}; original [A]/[C] symbols required`);
    }
    const plan = buildCostPlan(ctx, modifiersToCostPlanInput({ ...args, id: args.id! }));
    const key = args.linkKey ?? "cost";
    ctx.link(key, plan as unknown as Value);
    return { status: "executed", events: [], linkedValues: { [key]: plan as unknown as Value } };
  } catch (error) {
    if (!(error instanceof CostPlanError)) throw error;
    throw new CostFailure(error.reason, error.message);
  }
};

export default {
  op: "cost.modify",
  argsSchema: { parse: parseCostModifyArgs },
  execute
} satisfies InstructionDef<CostModifyArgs>;

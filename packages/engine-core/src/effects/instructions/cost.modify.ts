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
 * - id: stable plan id (required; unique per execution).
 * - cost: `CostSpec` for the base cost; defaults to the printed cost.
 * - printed: optional trusted catalog projection.
 * - domains: optional source domains; an empty array explicitly means the
 *   universal six-domain Power (`[A]`).
 * - baseChoices / baseChoice / baseModifications / optionalAdditional /
 *   mandatoryAdditional: existing `CostPlanInput` vocabulary.
 * - modifier / modifiers: `{ kind: 'reduce' | 'increase' |
 *   'reduce-equip-cost', resource: 'energy' | 'power', amount, minimum?,
 *   domains?, powerOrder?, component?, id? }`. Increases are appended in CR
 *   356 order; `reduce-equip-cost` becomes a power discount with a universal
 *   `[A]` domain scope. Each modifier is one discount instance with its own
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
  readonly id: string;
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
  "amount",
  "minimum",
  "domains",
  "powerOrder",
  "component",
  "id"
]);

const ARGS_KEYS = new Set([
  "id",
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
  if (!isExpr(value.amount)) throw new TypeError("cost.modify modifier.amount must be an Expr");
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
  return value as unknown as CostModifierInput;
}

export function parseCostModifyArgs(value: unknown): CostModifyArgs {
  if (!isRecord(value)) throw new TypeError("cost.modify args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARGS_KEYS.has(key)) throw new TypeError(`Invalid cost.modify argument: ${key}`);
  }
  if (typeof value.id !== "string" || !value.id.length) {
    throw new TypeError("cost.modify id must be a non-empty string");
  }
  if (value.cost !== undefined && !isRecord(value.cost)) {
    throw new TypeError("cost.modify cost must be a CostSpec object");
  }
  if (value.modifier !== undefined && value.modifiers !== undefined) {
    throw new TypeError("cost.modify accepts either modifier or modifiers, not both");
  }
  if (value.modifier !== undefined) parseModifier(value.modifier, "modifier");
  if (value.modifiers !== undefined) {
    if (!Array.isArray(value.modifiers)) throw new TypeError("cost.modify modifiers must be an array");
    value.modifiers.forEach((entry, index) => parseModifier(entry, `modifiers[${index}]`));
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
  return value as unknown as CostModifyArgs;
}

class CostFailure extends Error {
  constructor(readonly reason: "judge-required" | "missing-printed-cost" | "invalid-cost-plan") {
    super(`cost.modify failed: ${reason}`);
    this.name = "CostFailure";
  }
}

function modifiersToCostPlanInput(args: CostModifyArgs): CostPlanInput {
  const modifiers = [...(args.modifier === undefined ? [] : [args.modifier]), ...(args.modifiers ?? [])];
  const discounts: { id: string; component?: string; resource: "energy" | "power"; amount: Expr; minimum?: Expr; domains?: readonly Domain[]; powerOrder?: readonly number[] }[] = [];
  const increases: { id: string; cost: { energy?: Expr; power?: Expr } }[] = [];
  for (const [index, modifier] of modifiers.entries()) {
    const id = modifier.id ?? `${args.id}:modifier:${index}`;
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
    const plan = buildCostPlan(ctx, modifiersToCostPlanInput(args));
    const key = args.linkKey ?? "cost";
    ctx.link(key, plan as unknown as Value);
    return { status: "executed", events: [], linkedValues: { [key]: plan as unknown as Value } };
  } catch (error) {
    if (!(error instanceof CostPlanError)) throw error;
    throw new CostFailure(error.reason === "cannot-pay-cost" ? "judge-required" : error.reason);
  }
};

export default {
  op: "cost.modify",
  argsSchema: { parse: parseCostModifyArgs },
  execute
} satisfies InstructionDef<CostModifyArgs>;

/**
 * Settle a finalized CR v1.5 356-357 cost plan. Numeric `payments.power`
 * denotes that many [A] requirements; an explicit domain list keeps each
 * domain requirement. An empty list is zero Power, not one [A].
 *
 * Both Expr arguments (direct primitive calls) and evaluated values (ability
 * interpreter dispatch) are accepted. Full CostPlans are paid as locked.
 *
 * CR 203.3: an ordinary failed payment throws, including before the first
 * action. The exception stops the body and lets the enclosing transaction
 * discard every action, event and link. A legal missing Equip cost is handled
 * by cost.modify as Ignored before this primitive evaluates the forward link.
 * An actual insufficient-resource failure remains exceptional for ChainEngine.
 */
import type {
  Domain,
  Expr,
  InstructionDef,
  InstructionResult,
  ObjectRef,
  ResolveContext,
  Value
} from "../contract.js";
import {
  type CostPlan,
  type CostPaymentOptions,
  CostPlanError
} from "../../cost/plan-types.js";
import { payCostPlan } from "../../cost/payment.js";
import { DUEL_DOMAINS } from "../../cost/resources.js";

export interface CostPayArgs {
  readonly cost?: Expr;
  readonly power?: Expr;
  readonly nonstandardOrder?: Expr;
  readonly payments?: Expr;
  readonly linkKey?: string;
}

const ARGS_KEYS = new Set(["cost", "power", "nonstandardOrder", "payments", "linkKey"]);

function isCostPlan(value: unknown): value is CostPlan {
  return isRecord(value) && value.finalized === true && typeof value.id === "string"
    && typeof value.player === "string" && isRecord(value.source) && isRecord(value.total);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

function isArgValue(value: unknown): boolean {
  return isExpr(value) || value === null || isRecord(value) || Array.isArray(value);
}

export function parseCostPayArgs(value: unknown): CostPayArgs {
  if (!isRecord(value)) throw new TypeError("cost.pay args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARGS_KEYS.has(key)) throw new TypeError(`Invalid cost.pay argument: ${key}`);
  }
  for (const key of ["cost", "power", "nonstandardOrder", "payments"]) {
    if (value[key] !== undefined && !isArgValue(value[key])) {
      throw new TypeError(`cost.pay ${key} must be an Expr or an evaluated value`);
    }
  }
  if (value.linkKey !== undefined && (typeof value.linkKey !== "string" || !value.linkKey.length)) {
    throw new TypeError("cost.pay linkKey must be a non-empty string");
  }
  return value as unknown as CostPayArgs;
}

interface PaymentPlan {
  readonly finalized: true;
  readonly energy?: number;
  readonly power?: number | readonly Domain[] | null;
  readonly xp?: number;
  readonly exhaust?: readonly ObjectRef[];
  readonly recycle?: readonly ObjectRef[];
  readonly id?: string;
}

function finalizedPlan(value: unknown): PaymentPlan | null {
  if (!isRecord(value) || value.finalized !== true) return null;
  return value as unknown as PaymentPlan;
}

function domainList(value: unknown): readonly Domain[] | null {
  if (!Array.isArray(value) || value.some(domain => typeof domain !== "string")) return null;
  return value as readonly Domain[];
}

function scalar(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function directPlan(value: Value): PaymentPlan | null {
  const plan = finalizedPlan(value);
  if (!plan) return null;
  if ("total" in plan || "source" in plan) return null;
  if (plan.energy !== undefined && scalar(plan.energy) === null) return null;
  if (plan.xp !== undefined && scalar(plan.xp) === null) return null;
  if (plan.power !== undefined && plan.power !== null && domainList(plan.power) === null) return null;
  return plan;
}

function paymentsPlan(value: Value): PaymentPlan | null {
  if (!isRecord(value)) return null;
  if (value.total !== undefined || value.source !== undefined || value.cost !== undefined) return null;
  const keys = Object.keys(value);
  if (!keys.length || keys.some(key => !["energy", "power", "xp"].includes(key))) return null;
  if (value.energy !== undefined && scalar(value.energy) === null) return null;
  if (value.xp !== undefined && scalar(value.xp) === null) return null;
  const energy = value.energy === undefined ? 0 : value.energy as number;
  const xp = value.xp === undefined ? 0 : value.xp as number;
  if (scalar(energy) === null || scalar(xp) === null) return null;
  const requested = value.power === undefined ? [] : value.power;
  if (typeof requested === "number") {
    if (scalar(requested) === null) return null;
    return { finalized: true, energy, xp, power: requested };
  }
  const domains = domainList(requested);
  if (!domains) return null;
  return { finalized: true, energy, xp, power: domains };
}

function objectRef(value: unknown): ObjectRef | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const zoneEntryId = value.zoneEntryId;
  return typeof zoneEntryId === "number" && Number.isSafeInteger(zoneEntryId)
    ? { id: value.id, zoneEntryId }
    : null;
}

/**
 * Turn the play pipeline's plain finalized plan into the full CostPlan shape
 * the transactional payer consumes. Plain Energy/Power/XP stay resources;
 * plain exhaust/recycle references become the equivalent nonstandard payment
 * actions in the same order (CR v1.5 357.2). The payer still checks every
 * reference, so a stale or illegal object fails the payment transaction.
 */
function payablePlan(direct: PaymentPlan, ctx: ResolveContext): CostPlan | null {
  if (direct.exhaust !== undefined && !Array.isArray(direct.exhaust)) return null;
  if (direct.recycle !== undefined && !Array.isArray(direct.recycle)) return null;
  const refs = (value: unknown): readonly ObjectRef[] | null => {
    if (value === undefined) return [];
    const found: ObjectRef[] = [];
    for (const entry of value as readonly unknown[]) {
      const object = objectRef(entry);
      if (object === null) return null;
      found.push(object);
    }
    return found;
  };
  const exhaust = refs(direct.exhaust);
  const recycle = refs(direct.recycle);
  if (exhaust === null || recycle === null) return null;
  const power = typeof direct.power === "number"
    ? (direct.power === 0 ? [] : [{ amount: direct.power, allowedDomains: DUEL_DOMAINS }])
    : (direct.power ?? []).map(domain => ({ amount: 1, allowedDomains: [domain] }));
  const id = direct.id ?? `${ctx.source.ref.id}:cost-pay`;
  const actions = [
    ...exhaust.map((object, index) => ({ id: `${id}:exhaust:${index}`, componentId: id, action: { type: "exhaust" as const, object } })),
    ...recycle.map((object, index) => ({ id: `${id}:recycle:${index}`, componentId: id, action: { type: "recycle" as const, object } }))
  ];
  return {
    finalized: true,
    id,
    player: ctx.controller,
    source: { ...ctx.source.ref },
    printed: { energy: null, power: null },
    base: null,
    components: [],
    selectedAdditional: [],
    declinedAdditional: [],
    modifications: [],
    discounts: [],
    stages: ["base", "alternate", "optional-additional", "mandatory-additional", "increase", "discount", "total"],
    total: {
      energy: direct.energy ?? 0,
      power,
      xp: direct.xp ?? 0,
      actions
    }
  };
}

function cannotPay(): never {
  throw new CostPlanError("cannot-pay-cost", "cost.pay requires a valid, payable finalized cost plan");
}

const execute: InstructionDef<CostPayArgs>["execute"] = (ctx, args): InstructionResult => {
  const key = args.linkKey ?? "payment";
  const arg = (value: Expr | undefined): Value | undefined =>
    value === undefined ? undefined : isExpr(value) ? ctx.evaluate(value) : value as Value;
  let finalized: CostPlan;
  if (args.payments !== undefined) {
    if (args.cost !== undefined) throw new TypeError("cost.pay accepts either cost or payments, not both");
    const plan = paymentsPlan(arg(args.payments) as Value);
    if (!plan) cannotPay();
    const payable = payablePlan(plan, ctx);
    if (!payable) cannotPay();
    finalized = payable;
  } else if (args.cost !== undefined) {
    const evaluated = arg(args.cost) as Value;
    const direct = directPlan(evaluated);
    if (isCostPlan(evaluated)) {
      finalized = evaluated;
    } else if (direct) {
      const payable = payablePlan(direct, ctx);
      if (!payable) cannotPay();
      finalized = payable;
    } else {
      cannotPay();
    }
  } else {
    throw new TypeError("cost.pay requires cost or payments");
  }
  const options: CostPaymentOptions = {
    ...(args.power !== undefined ? { power: arg(args.power) as unknown as CostPaymentOptions["power"] } : {}),
    ...(args.nonstandardOrder !== undefined ? { nonstandardOrder: arg(args.nonstandardOrder) as unknown as CostPaymentOptions["nonstandardOrder"] } : {}),
    ...(ctx.transaction === undefined ? {} : { transaction: ctx.transaction })
  };
  // An actual resource failure remains exceptional. ChainEngine owns the
  // narrowed Weaponmaster CR 821.1.c.5 catch after this plan's transaction has
  // rolled back, then completes the resolving trigger without attachment.
  const receipt = payCostPlan(ctx, finalized, options);
  ctx.link(key, receipt as unknown as Value);
  return { status: "executed", events: [...receipt.events], linkedValues: { [key]: receipt as unknown as Value } };
};

export default {
  op: "cost.pay",
  argsSchema: { parse: parseCostPayArgs },
  execute
} satisfies InstructionDef<CostPayArgs>;

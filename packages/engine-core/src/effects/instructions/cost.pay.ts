/**
 * cost.pay -- settle a finalized CR v1.5 356-357 cost plan (you may pay X to
 * ...). Pair it with `choice.optional` (contract 3.9): the optional body runs
 * only when the player accepts, and a failed payment negates the body so
 * later instructions of that body are not executed.
 *
 * Payment runs through the existing transactional `payCostPlan`, so the
 * combined Energy/Power action goes first and nonstandard actions follow in
 * order (357.1/.2), replacements and prevention still apply, and the payment
 * window can add resources before planning (357.1.a). The enclosing
 * primitive transaction owns rollback; the reference test kernel
 * demonstrates late-failure rollback. An `AwaitChoice` propagates unchanged
 * so the owner can suspend, roll back, ask, and replay the whole
 * instruction.
 *
 * args (each value argument is an Expr; when the instruction is dispatched
 * from an ability body the interpreter has already evaluated the Expr, so
 * both the Expr shape and the evaluated value shape are accepted):
 * - cost: Expr evaluating to a finalized value this source can settle:
 *   - a plain finalized payment plan `{ finalized: true, energy?, power?:
 *     Domain[], xp?, exhaust?, recycle?, id? }` (the same shape the play
 *     pipeline accepts), or
 *   - a full `CostPlan` (for example linked by `cost.modify`), which is paid
 *     exactly as locked (CR v1.5 357.1); payment still verifies that it
 *     belongs to this source and controller.
 *   `power: []` means domainless `[A]` and is kept universal by the planner.
 * - power / nonstandardOrder: optional `CostPaymentOptions` fields (explicit
 *   allocation; 357.2 order), as Expr values.
 * - payments (optional): an Expr evaluating to
 *   `{ energy?, power?: number | Domain[], xp? }`, finalized for this source
 *   and paid. `payments` and `cost` are mutually exclusive.
 * - linkKey: link key for the payment receipt, default `payment`.
 *
 * Results: success links and returns the frozen receipt (`executed`). A
 * failed payment (insufficient resources, a no-longer-valid cost object, a
 * replaced or prevented action) returns `negated("impossible")` with its
 * events; a choice.optional body therefore skips its later instructions.
 * Wrong argument shapes throw `TypeError` at the schema stage; they never
 * silently become free payments.
 */
import type {
  Domain,
  Expr,
  GameEvent,
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

export interface CostPayArgs {
  readonly cost?: Expr;
  readonly power?: Expr;
  readonly nonstandardOrder?: Expr;
  readonly payments?: Expr;
  readonly linkKey?: string;
}

const ARGS_KEYS = new Set(["cost", "power", "nonstandardOrder", "payments", "linkKey"]);

function isCostPlan(value: unknown): value is FullCostPlanShape {
  return isRecord(value) && value.finalized === true && typeof value.id === "string"
    && typeof value.player === "string" && isRecord(value.source) && isRecord(value.total);
}

interface FullCostPlanShape {
  readonly finalized: true;
  readonly id: string;
  readonly player: string;
  readonly source: { readonly id: string };
  readonly total: { readonly energy: number; readonly power: readonly Domain[] };
  readonly cost?: unknown;
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
  readonly power?: readonly Domain[];
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
    return { finalized: true, energy, xp, power: Array.from({ length: requested }, () => "Fury" as Domain) };
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
  const domains = direct.power === undefined || direct.power === null ? [] : direct.power;
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
      power: domains.map(domain => ({ amount: 1, allowedDomains: [domain] })),
      xp: direct.xp ?? 0,
      actions
    }
  };
}

function negated(reason: "impossible", events: readonly GameEvent[]): InstructionResult {
  return { status: "negated", reason, events: [...events] };
}

const execute: InstructionDef<CostPayArgs>["execute"] = (ctx, args): InstructionResult => {
  const key = args.linkKey ?? "payment";
  const arg = (value: Expr | undefined): Value | undefined =>
    value === undefined ? undefined : isExpr(value) ? ctx.evaluate(value) : value as Value;
  let finalized: PaymentPlan;
  if (args.payments !== undefined) {
    if (args.cost !== undefined) throw new TypeError("cost.pay accepts either cost or payments, not both");
    const plan = paymentsPlan(arg(args.payments) as Value);
    if (!plan) return negated("impossible", []);
    const payable = payablePlan(plan, ctx);
    if (!payable) return negated("impossible", []);
    finalized = payable as unknown as PaymentPlan;
  } else if (args.cost !== undefined) {
    const evaluated = arg(args.cost) as Value;
    const direct = directPlan(evaluated);
    if (isCostPlan(evaluated)) {
      finalized = evaluated as unknown as PaymentPlan;
    } else if (direct) {
      const payable = payablePlan(direct, ctx);
      if (!payable) return negated("impossible", []);
      finalized = payable as unknown as PaymentPlan;
    } else {
      return negated("impossible", []);
    }
  } else {
    throw new TypeError("cost.pay requires cost or payments");
  }
  try {
    const options: CostPaymentOptions = {
      ...(args.power !== undefined ? { power: arg(args.power) as unknown as CostPaymentOptions["power"] } : {}),
      ...(args.nonstandardOrder !== undefined ? { nonstandardOrder: arg(args.nonstandardOrder) as CostPaymentOptions["nonstandardOrder"] } : {})
    };
    const receipt = payCostPlan(ctx, finalized as unknown as Parameters<typeof payCostPlan>[1], options);
    ctx.link(key, receipt as unknown as Value);
    return { status: "executed", events: [...receipt.events], linkedValues: { [key]: receipt as unknown as Value } };
  } catch (error) {
    if (!(error instanceof CostPlanError)) throw error;
    if (error.reason !== "cannot-pay-cost") throw error;
    return negated("impossible", error.outcome?.events ?? []);
  }
};

export default {
  op: "cost.pay",
  argsSchema: { parse: parseCostPayArgs },
  execute
} satisfies InstructionDef<CostPayArgs>;

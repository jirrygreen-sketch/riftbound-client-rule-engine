import type {
  ContinuousEffectSpec,
  Expr,
  InstructionResult,
  ObjectFilter,
  ResolveContext,
  Value,
} from "../contract.js";
import { bindTarget, continuousId, mergeFilter } from "../../layers/rules/registration.js";
import {
  isDurationAlias,
  resolveContinuousDuration,
  settlementIdentity,
  type DurationAlias,
} from "../../layers/ops/index.js";

/**
 * continuous.lethal-threshold — register a Lethal Damage threshold override.
 *
 * CR v1.5 evidence (/root/swarm-rift/shared/rules/CR-v1.5.txt):
 * - 142.4.b: default Lethal Damage is a non-zero amount >= the unit's Might.
 * - 142.4.c: effects may alter the amount needed to kill a unit; the printed
 *   example is Elder Dragon ("Any amount of your damage is enough to kill
 *   enemy units"). This primitive registers that override; the lethal check
 *   (cleanup, combat assignment, layer evaluation) is the consumer.
 *
 * Arguments (Expr or evaluated literal):
 * - amount?: number — the threshold. amount 1 means any positive damage is
 *   lethal (Elder Dragon). A missing or non-positive amount negates as
 *   impossible (default 142.4.b semantics are represented by no registration,
 *   not by an invented zero threshold).
 * - appliesTo?: string | object — the damage scope, passed through verbatim
 *   (Elder Dragon: { damageController: "controller", target: "enemy-units" }).
 * - filter?: ObjectFilter — object filter carried on the spec.
 * - duration / target / settlementId: as in continuous.bonus-damage.
 */
export interface ContinuousLethalThresholdArgs {
  readonly amount?: Expr;
  readonly appliesTo?: Expr;
  readonly filter?: Expr;
  readonly duration?: Expr;
  readonly target?: Expr;
  readonly settlementId?: Expr;
}

const ARGUMENT_KEYS = ["amount", "appliesTo", "filter", "duration", "target", "settlementId"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}
function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value && isValue(value.value);
    case "object-property": case "object-attribute":
      return isId(value.property ?? value.attribute);
    case "linked": case "linked-value": return isId(value.instructionId);
    case "count": return isId(value.subject);
    case "arithmetic":
      return Array.isArray(value.operands) && value.operands.length > 0 &&
        value.operands.every(operand => isExpr(operand));
    default: return false;
  }
}

function parseArgs(value: unknown): ContinuousLethalThresholdArgs {
  if (!isRecord(value)) throw new TypeError("continuous.lethal-threshold requires args");
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key as (typeof ARGUMENT_KEYS)[number])) {
      throw new TypeError("Invalid continuous.lethal-threshold argument: " + key);
    }
    if (isExpr(entry) || isValue(entry)) continue;
    throw new TypeError("Invalid continuous.lethal-threshold argument: " + key);
  }
  return value as unknown as ContinuousLethalThresholdArgs;
}

const argsSchema = {
  parse: parseArgs,
  safeParse: (value: unknown) => {
    try {
      return { success: true, data: parseArgs(value) } as const;
    } catch (error) {
      return { success: false, error } as const;
    }
  },
};

function evaluateArgument(ctx: ResolveContext, argument: Expr | Value): Value {
  return isExpr(argument) ? ctx.evaluate(argument) : (argument as Value);
}

function asFilter(value: Value | undefined): ObjectFilter | undefined {
  if (value === undefined || value === null || value === "any" || value === "all") return undefined;
  if (!isRecord(value)) throw new TypeError("continuous.lethal-threshold filter must be an object filter");
  return value as unknown as ObjectFilter;
}

// Note: scripts/gen-registries.mjs statically scans for the op literal after
// the "const <name> =" declaration, so this definition cannot carry a type
// annotation between the name and the initializer (same as continuous.restrict).
const continuousLethalThreshold = {
  op: "continuous.lethal-threshold",
  argsSchema,
  execute(ctx: ResolveContext, args: ContinuousLethalThresholdArgs): InstructionResult {
    const target = bindTarget(ctx, args.target);
    if (target === null) return { status: "ignored", reason: "mistargeted" };
    const rawAmount = args.amount === undefined ? undefined : evaluateArgument(ctx, args.amount);
    if (rawAmount !== undefined && (typeof rawAmount !== "number" || !Number.isSafeInteger(rawAmount))) {
      throw new TypeError("continuous.lethal-threshold amount must be a safe integer");
    }
    // 142.4.b remains the default when no registration exists; a missing or
    // non-positive threshold is not a printable override and is not invented.
    if (rawAmount === undefined || rawAmount <= 0) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const rawAppliesTo = args.appliesTo === undefined ? undefined : evaluateArgument(ctx, args.appliesTo);
    const rawFilter = asFilter(args.filter === undefined ? undefined : evaluateArgument(ctx, args.filter));
    const rawDuration = args.duration === undefined ? "permanent" : evaluateArgument(ctx, args.duration);
    if (!isDurationAlias(rawDuration)) {
      throw new TypeError("continuous.lethal-threshold duration is not a known alias");
    }
    const duration: DurationAlias = rawDuration;
    const sourceRef = ctx.source.ref;
    const rawSettlementId = args.settlementId === undefined ? undefined : evaluateArgument(ctx, args.settlementId);
    if (rawSettlementId !== undefined && !isId(rawSettlementId)) {
      throw new TypeError("continuous.lethal-threshold settlementId must be a non-empty string");
    }
    const settlement = settlementIdentity(
      sourceRef, "continuous.lethal-threshold",
      key => ctx.linked(key), (key, value) => ctx.link(key, value),
      rawSettlementId,
    );
    const effect: Record<string, unknown> = {
      kind: "continuous.lethal-threshold",
      amount: rawAmount,
      settlement,
      sourcePlayer: ctx.controller,
      ...(rawAppliesTo !== undefined ? { appliesTo: rawAppliesTo } : {}),
      ...(target.refs.length > 0 ? { targetRefs: target.refs } : {}),
    };
    const spec: ContinuousEffectSpec = {
      id: continuousId("continuous.lethal-threshold", ctx, settlement, { effect, filter: mergeFilter(rawFilter, target), duration }),
      layer: "ability",
      source: sourceRef,
      filter: mergeFilter(rawFilter, target),
      effect: effect as unknown as ContinuousEffectSpec["effect"],
    };
    ctx.addContinuous(spec, resolveContinuousDuration(duration, sourceRef));
    ctx.link("registered", { id: spec.id, amount: rawAmount });
    return { status: "executed", events: [], linkedValues: { registered: { id: spec.id, amount: rawAmount } } };
  },
};

export default continuousLethalThreshold;

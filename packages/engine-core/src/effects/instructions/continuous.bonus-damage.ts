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
 * continuous.bonus-damage — register a Bonus Damage grant for Deal actions.
 *
 * CR v1.5 evidence (/root/swarm-rift/shared/rules/CR-v1.5.txt):
 * - 713: Bonus Damage is granted to Deal actions and influences the amount of
 *   damage the action distributes. This primitive only registers that grant;
 *   the Deal consumer reads it at the action (715.4: no Deal, no application;
 *   715.4.a: replacements/reductions still include the bonus).
 * - 714: multiple instances are summed by the consumer. The registration
 *   keeps the granted value; 714.1/714.2 (positive only, negative grants
 *   apply nothing) are enforced where the grant meets a Deal action, so the
 *   registration itself stays a faithful record of the printed grant.
 * - 715.1/.2: the grant carries its action scope; the consumer decides
 *   single versus per-target application.
 *
 * Arguments (Expr or evaluated literal, like continuous.grant-keyword):
 * - amount?: number — the granted amount.
 * - appliesTo?: string | object — the Deal-action scope, passed through
 *   verbatim ("next-spell-you-play", "deal-actions",
 *   "controller-spells-and-abilities", or a structured scope).
 * - filter?: ObjectFilter — object filter carried on the spec.
 * - duration?: duration alias — default permanent.
 * - target?: TargetSpec id — all-invalid targets are ignored (359.3.e).
 * - settlementId?: string — replay-stable identity (settlementIdentity).
 */
export interface ContinuousBonusDamageArgs {
  readonly amount?: Expr;
  readonly appliesTo?: Expr;
  readonly filter?: Expr;
  readonly duration?: Expr;
  readonly target?: Expr;
  readonly scope?: Expr;
  readonly settlementId?: Expr;
}

const ARGUMENT_KEYS = [
  "amount", "appliesTo", "filter", "duration", "target", "scope", "settlementId",
] as const;

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

function parseArgs(value: unknown): ContinuousBonusDamageArgs {
  if (!isRecord(value)) throw new TypeError("continuous.bonus-damage requires args");
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key as (typeof ARGUMENT_KEYS)[number])) {
      throw new TypeError("Invalid continuous.bonus-damage argument: " + key);
    }
    if (isExpr(entry) || isValue(entry)) continue;
    throw new TypeError("Invalid continuous.bonus-damage argument: " + key);
  }
  return value as unknown as ContinuousBonusDamageArgs;
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
  if (!isRecord(value)) throw new TypeError("continuous.bonus-damage filter must be an object filter");
  return value as unknown as ObjectFilter;
}

// Note: scripts/gen-registries.mjs statically scans for the op literal after
// the "const <name> =" declaration, so this definition cannot carry a type
// annotation between the name and the initializer (same as continuous.restrict).
const continuousBonusDamage = {
  op: "continuous.bonus-damage",
  argsSchema,
  execute(ctx: ResolveContext, args: ContinuousBonusDamageArgs): InstructionResult {
    const target = bindTarget(ctx, args.target);
    if (target === null) return { status: "ignored", reason: "mistargeted" };
    const rawAmount = args.amount === undefined ? undefined : evaluateArgument(ctx, args.amount);
    if (rawAmount !== undefined && (typeof rawAmount !== "number" || !Number.isSafeInteger(rawAmount))) {
      throw new TypeError("continuous.bonus-damage amount must be a safe integer");
    }
    if (rawAmount === undefined || rawAmount <= 0) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const rawAppliesTo = args.appliesTo === undefined ? undefined : evaluateArgument(ctx, args.appliesTo);
    const rawFilter = asFilter(args.filter === undefined ? undefined : evaluateArgument(ctx, args.filter));
    const rawScope = args.scope === undefined ? undefined : evaluateArgument(ctx, args.scope);
    const rawDuration = args.duration === undefined ? "permanent" : evaluateArgument(ctx, args.duration);
    if (!isDurationAlias(rawDuration)) {
      throw new TypeError("continuous.bonus-damage duration is not a known alias");
    }
    const duration: DurationAlias = rawDuration;
    const sourceRef = ctx.source.ref;
    const settlement = settlementIdentity(
      sourceRef, "continuous.bonus-damage",
      key => ctx.linked(key), (key, value) => ctx.link(key, value),
      args.settlementId === undefined ? undefined :
        typeof evaluateArgument(ctx, args.settlementId) === "string"
        ? String(evaluateArgument(ctx, args.settlementId))
        : undefined,
    );
    const effect: Record<string, unknown> = {
      kind: "continuous.bonus-damage",
      amount: rawAmount,
      settlement,
      sourcePlayer: ctx.controller,
      ...(rawAppliesTo !== undefined ? { appliesTo: rawAppliesTo } : {}),
      ...(rawScope !== undefined ? { scope: rawScope } : {}),
      ...(target.refs.length > 0 ? { targetRefs: target.refs } : {}),
    };
    const spec: ContinuousEffectSpec = {
      id: continuousId("continuous.bonus-damage", ctx, settlement, { effect, filter: mergeFilter(rawFilter, target), duration }),
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

export default continuousBonusDamage;

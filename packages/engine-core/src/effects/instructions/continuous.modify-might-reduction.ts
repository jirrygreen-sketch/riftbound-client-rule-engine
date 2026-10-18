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
 * continuous.modify-might-reduction — register a modifier for Might
 * reductions that other effects apply.
 *
 * CR v1.5 evidence (/root/swarm-rift/shared/rules/CR-v1.5.txt):
 * - 479.4.a: the arithmetic layer applies increases and decreases to numeric
 *   traits; 479.4.b snapshots limited reductions when they apply.
 * - 479.4.b (Mel, Newly Awakened printed example family): an effect that
 *   would give -Might gives an additional -1 Might. The additional amount is
 *   a modifier of the reduction, recorded at registration and summed by the
 *   arithmetic consumer when it settles the reduction.
 *
 * The primitive never subtracts Might itself: the reduction that is being
 * modified belongs to the effect that gives -Might (its per-target amount,
 * its minimum floors, and its snapshotting at 479.4.b stay with that effect).
 * The registration only records { mode, amount, appliesTo } for that consumer.
 *
 * Arguments (Expr or evaluated literal):
 * - mode?: "additional" — the only printable shape in the blocked-card data;
 *   default "additional". Unknown modes negate as impossible instead of
 *   inventing semantics.
 * - amount?: number — signed additional amount (Mel: -1). A missing amount
 *   negates as impossible (no invented zero modification).
 * - appliesTo?: string | object — the reduction scope, passed through
 *   verbatim (Mel: "controller-spells-and-abilities").
 * - filter?: ObjectFilter — object filter carried on the spec.
 * - duration / target / settlementId: as in continuous.bonus-damage.
 */
export interface ContinuousModifyMightReductionArgs {
  readonly mode?: Expr;
  readonly amount?: Expr;
  readonly appliesTo?: Expr;
  readonly filter?: Expr;
  readonly duration?: Expr;
  readonly target?: Expr;
  readonly settlementId?: Expr;
}

const ARGUMENT_KEYS = ["mode", "amount", "appliesTo", "filter", "duration", "target", "settlementId"] as const;
const KNOWN_MODES = ["additional"] as const;

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

function parseArgs(value: unknown): ContinuousModifyMightReductionArgs {
  if (!isRecord(value)) throw new TypeError("continuous.modify-might-reduction requires args");
  for (const [key, entry] of Object.entries(value)) {
    if (!ARGUMENT_KEYS.includes(key as (typeof ARGUMENT_KEYS)[number])) {
      throw new TypeError("Invalid continuous.modify-might-reduction argument: " + key);
    }
    if (isExpr(entry) || isValue(entry)) continue;
    throw new TypeError("Invalid continuous.modify-might-reduction argument: " + key);
  }
  return value as unknown as ContinuousModifyMightReductionArgs;
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
  if (!isRecord(value)) throw new TypeError("continuous.modify-might-reduction filter must be an object filter");
  return value as unknown as ObjectFilter;
}

// Note: scripts/gen-registries.mjs statically scans for the op literal after
// the "const <name> =" declaration, so this definition cannot carry a type
// annotation between the name and the initializer (same as continuous.restrict).
const continuousModifyMightReduction = {
  op: "continuous.modify-might-reduction",
  argsSchema,
  execute(ctx: ResolveContext, args: ContinuousModifyMightReductionArgs): InstructionResult {
    const target = bindTarget(ctx, args.target);
    if (target === null) return { status: "ignored", reason: "mistargeted" };
    const rawMode = args.mode === undefined ? "additional" : evaluateArgument(ctx, args.mode);
    if (typeof rawMode !== "string" || !(KNOWN_MODES as readonly string[]).includes(rawMode)) {
      // Unknown modes stay unimplemented rather than approximated.
      return { status: "negated", reason: "impossible", events: [] };
    }
    const rawAmount = args.amount === undefined ? undefined : evaluateArgument(ctx, args.amount);
    if (rawAmount !== undefined && (typeof rawAmount !== "number" || !Number.isSafeInteger(rawAmount))) {
      throw new TypeError("continuous.modify-might-reduction amount must be a safe integer");
    }
    if (rawAmount === undefined) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const rawAppliesTo = args.appliesTo === undefined ? undefined : evaluateArgument(ctx, args.appliesTo);
    const rawFilter = asFilter(args.filter === undefined ? undefined : evaluateArgument(ctx, args.filter));
    const rawDuration = args.duration === undefined ? "permanent" : evaluateArgument(ctx, args.duration);
    if (!isDurationAlias(rawDuration)) {
      throw new TypeError("continuous.modify-might-reduction duration is not a known alias");
    }
    const duration: DurationAlias = rawDuration;
    const sourceRef = ctx.source.ref;
    const rawSettlementId = args.settlementId === undefined ? undefined : evaluateArgument(ctx, args.settlementId);
    if (rawSettlementId !== undefined && !isId(rawSettlementId)) {
      throw new TypeError("continuous.modify-might-reduction settlementId must be a non-empty string");
    }
    const settlement = settlementIdentity(
      sourceRef, "continuous.modify-might-reduction",
      key => ctx.linked(key), (key, value) => ctx.link(key, value),
      rawSettlementId,
    );
    const effect: Record<string, unknown> = {
      kind: "continuous.modify-might-reduction",
      mode: rawMode,
      amount: rawAmount,
      settlement,
      sourcePlayer: ctx.controller,
      ...(rawAppliesTo !== undefined ? { appliesTo: rawAppliesTo } : {}),
      ...(target.refs.length > 0 ? { targetRefs: target.refs } : {}),
    };
    const spec: ContinuousEffectSpec = {
      id: continuousId("continuous.modify-might-reduction", ctx, settlement, { effect, filter: mergeFilter(rawFilter, target), duration }),
      layer: "ability",
      source: sourceRef,
      filter: mergeFilter(rawFilter, target),
      effect: effect as unknown as ContinuousEffectSpec["effect"],
    };
    ctx.addContinuous(spec, resolveContinuousDuration(duration, sourceRef));
    ctx.link("registered", { id: spec.id, mode: rawMode, amount: rawAmount });
    return { status: "executed", events: [], linkedValues: { registered: { id: spec.id, mode: rawMode, amount: rawAmount } } };
  },
};

export default continuousModifyMightReduction;

/**
 * Continuous speed-permission effects (CR v1.5 159.2, 806, 813).
 *
 * Action grants play/activation permission during Showdowns on any player's
 * turn; Reaction grants all Action permissions plus Closed States. The
 * primitive registers an ability-layer static effect that carries the granted
 * speed names; it never touches the chain. Query helpers in layers/rules/
 * combine these grants with game state (canAct).
 *
 * Arguments (all Expr):
 * - grants or timings (alias): "action" | "reaction" or a list of speed
 *   names. Empty grants produce negated/impossible and register nothing.
 * - appliesTo: object filter for the objects that gain the speeds.
 * - duration: this-turn | this-combat | permanent | while-source-here
 * - target: TargetSpec id; if all targets are stale the instruction is
 *   ignored/mistargeted.
 */
import type {
  ContinuousEffectSpec,
  Duration, Expr, InstructionResult, ObjectFilter, ResolveContext, Value,
} from "../contract.js";
import { bindTarget, continuousId, isSelector, mergeFilter } from "../../layers/rules/registration.js";

type DurationValue = Duration;

export interface TimingArgs {
  readonly grants?: Expr;
  readonly timings?: Expr;
  readonly appliesTo?: Expr;
  readonly duration?: Expr;
  readonly target?: Expr;
  readonly instanceId?: Expr;
  readonly executionId?: Expr;
}

const DURATION_NAMES: Record<string, Value> = {
  "this-turn": "end-of-turn",
  "this-combat": "end-of-combat",
  "permanent": "permanent",
  "while-source-here": "while-source-in-zone",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isExpr(value: unknown, active = new Set<object>()): value is Expr {
  if (!isRecord(value) || active.has(value)) return false;
  active.add(value);
  let valid: boolean;
  switch (value.kind) {
    case "constant": case "literal": valid = Object.hasOwn(value, "value"); break;
    case "object-property": case "object-attribute":
      valid = isSelector(value.object) && isId(value.property ?? value.attribute); break;
    case "linked": case "linked-value":
      valid = isId(value.instructionId); break;
    case "count": valid = isId(value.subject); break;
    case "arithmetic":
      valid = Array.isArray(value.operands) && value.operands.length > 0 &&
        value.operands.every((operand: unknown) => isExpr(operand, active));
      break;
    default: valid = false;
  }
  active.delete(value);
  return valid;
}
function parseArgs(value: unknown): TimingArgs {
  if (!isRecord(value)) throw new TypeError("continuous.timing requires args");
  const allowed = ["grants", "timings", "appliesTo", "duration", "target", "instanceId", "executionId"];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) {
      throw new TypeError("Invalid continuous.timing argument: " + key);
    }
  }
  if (value.grants === undefined && value.timings === undefined) {
    throw new TypeError("continuous.timing requires grants or timings");
  }
  return { ...value } as unknown as TimingArgs;
}
function grants(value: Value): readonly string[] {
  const list = Array.isArray(value) ? value : [value];
  const speeds = list.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (speeds.length !== list.length) throw new TypeError("continuous.timing grants must be speed names");
  return speeds;
}
function appliesTo(value: Value): ObjectFilter | undefined {
  if (value === undefined || value === null || value === "any" || value === "all") return undefined;
  if (!isRecord(value)) throw new TypeError("continuous.timing appliesTo must be an object filter");
  return value as unknown as ObjectFilter;
}
function durationOf(value: Value, ctx: ResolveContext): DurationValue {
  const name = typeof value === "string" ? value : null;
  if (name === "permanent") return { type: "permanent" };
  if (name === "this-turn") return { type: "end-of-turn" };
  if (name === "this-combat") return { type: "end-of-combat" };
  if (name === "while-source-here") {
    return { type: "while-source-in-zone", source: ctx.source.ref };
  }
  throw new TypeError("continuous.timing duration must be this-turn, this-combat, permanent, or while-source-here");
}

export default {
  op: "continuous.timing",
  argsSchema: { parse: parseArgs },
  execute: (ctx: ResolveContext, args: TimingArgs): InstructionResult => {
    const target = bindTarget(ctx, args.target);
    if (target === null) return { status: "ignored", reason: "mistargeted" };
    const speeds = grants(ctx.evaluate(args.grants ?? args.timings!));
    if (speeds.length === 0) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const filter = args.appliesTo === undefined ? undefined : appliesTo(ctx.evaluate(args.appliesTo));
    const durationArg = args.duration === undefined ? "permanent" : ctx.evaluate(args.duration);
    const instance = args.instanceId === undefined && args.executionId === undefined ? undefined :
      ctx.evaluate(args.instanceId ?? args.executionId!);
    const spec: ContinuousEffectSpec = {
      id: continuousId("continuous-timing", ctx, instance, { grants: speeds, filter: mergeFilter(filter, target), duration: durationArg }),
      layer: "ability",
      source: ctx.source.ref,
      filter: mergeFilter(filter, target),
      effect: { kind: "timing", grants: speeds, ...(target.refs.length > 0 ? { targetRefs: target.refs } : {}) },
    };
    ctx.addContinuous(spec, durationOf(durationArg, ctx));
    ctx.link("registered", { id: spec.id, duration: durationArg });
    return { status: "executed", events: [] };
  },
};

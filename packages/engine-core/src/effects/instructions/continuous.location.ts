/**
 * Continuous play-location permissions and restrictions (CR v1.5 451.1).
 *
 * Speed grants do not change where cards may be played; placement permissions
 * like "any-battlefield" or explicit placement restrictions are separate
 * layer effects, checked during Finalize together with Restriction (contract
 * 3.4). The primitive only records the effect.
 *
 * Arguments (all Expr):
 * - permission: granted placement option, e.g. "any-battlefield"
 * - restriction: blocked placement label
 * - appliesTo: object filter for the objects the effect applies to
 * - duration / target: as in continuous.timing
 * Neither permission nor restriction is negated/impossible and registers
 * nothing.
 */
import type {
  ContinuousEffectSpec,
  Duration, Expr, InstructionResult, ObjectFilter, ResolveContext, Value,
} from "../contract.js";

type DurationValue = Duration;

export interface LocationArgs {
  readonly permission?: Expr;
  readonly restriction?: Expr;
  readonly appliesTo?: Expr;
  readonly duration?: Expr;
  readonly target?: Expr;
}

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
      valid = isRecord(value.object) && isId(value.property ?? value.attribute); break;
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
function parseArgs(value: unknown): LocationArgs {
  if (!isRecord(value)) throw new TypeError("continuous.location requires args");
  const allowed = ["permission", "restriction", "appliesTo", "duration", "target"];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) {
      throw new TypeError("Invalid continuous.location argument: " + key);
    }
  }
  return { ...value } as unknown as LocationArgs;
}
function name(value: Value, label: string): string | undefined {
  if (Array.isArray(value)) throw new TypeError("continuous.location " + label + " must be a single name");
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("continuous.location " + label + " must be a nonempty string");
  }
  return value;
}
function appliesTo(value: Value): ObjectFilter | undefined {
  if (value === undefined || value === null || value === "any" || value === "all") return undefined;
  if (!isRecord(value)) throw new TypeError("continuous.location appliesTo must be an object filter");
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
  throw new TypeError("continuous.location duration must be this-turn, this-combat, permanent, or while-source-here");
}

export default {
  op: "continuous.location",
  argsSchema: { parse: parseArgs },
  execute: (ctx: ResolveContext, args: LocationArgs): InstructionResult => {
    if (args.target !== undefined) {
      const selected = ctx.targets(ctx.evaluate(args.target) as string);
      if (selected.length === 0) return { status: "ignored", reason: "mistargeted" };
    }
    const permission = args.permission === undefined ? undefined : name(ctx.evaluate(args.permission), "permission");
    const restriction = args.restriction === undefined ? undefined : name(ctx.evaluate(args.restriction), "restriction");
    if (permission === undefined && restriction === undefined) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const filter = args.appliesTo === undefined ? undefined : appliesTo(ctx.evaluate(args.appliesTo));
    const durationArg = args.duration === undefined ? "permanent" : ctx.evaluate(args.duration);
    const spec: ContinuousEffectSpec = {
      id: "continuous-location:" + ctx.source.ref.id + ":" + ctx.source.ref.zoneEntryId,
      layer: "ability",
      source: ctx.source.ref,
      filter: filter ?? {},
      effect: {
        kind: "location",
        ...(permission === undefined ? {} : { permission }),
        ...(restriction === undefined ? {} : { restriction }),
      },
    };
    ctx.addContinuous(spec, durationOf(durationArg, ctx));
    ctx.link("registered", { id: spec.id, duration: durationArg });
    return { status: "executed", events: [] };
  },
};

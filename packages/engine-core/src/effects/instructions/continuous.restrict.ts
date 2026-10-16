/**
 * Continuous restrictions and requirements (contract 3.4).
 *
 * Restriction and Requirement are kept separate: "cannot be chosen as a
 * target", "cannot play spells", "cannot move" and similar prohibitions are
 * restrictions, while "must ..." obligations are requirements. The primitive
 * only registers the effect; it never enforces a rule inline, so later rule
 * wiring can query the registry through layers/rules/.
 *
 * Arguments (all Expr):
 * - mode: "prohibit" (default) registers a restriction; "require" registers a
 *   requirement; "permit" cancels a matching restriction by name; "limit"
 *   registers a numeric cap; "applied-cost" registers an applied-cost
 *   modification (204.4). Unknown modes fail closed with negated/impossible.
 * - action (alias operation): the action being limited, e.g. "play-spell",
 *   "move", "attack", "target"
 * - appliesTo: object filter for the objects the effect applies to
 * - restriction: explicit restriction label, e.g. "facedown-zone-maximum-occupancy"
 * - amount: cap size for "limit" mode
 * - cost: applied-cost value for "applied-cost" mode
 * - duration / target: as in continuous.timing
 */
import type {
  ContinuousEffectSpec,
  Duration, Expr, InstructionResult, ObjectFilter, ResolveContext, Value,
} from "../contract.js";

type DurationValue = Duration;

export interface RestrictArgs {
  readonly mode?: Expr;
  readonly action?: Expr;
  readonly operation?: Expr;
  readonly appliesTo?: Expr;
  readonly restriction?: Expr;
  readonly amount?: Expr;
  readonly cost?: Expr;
  readonly duration?: Expr;
  readonly target?: Expr;
}

const MODES = ["prohibit", "require", "permit", "limit", "applied-cost"];

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
function parseArgs(value: unknown): RestrictArgs {
  if (!isRecord(value)) throw new TypeError("continuous.restrict requires args");
  const allowed = ["mode", "action", "operation", "appliesTo", "restriction", "amount", "cost", "duration", "target"];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) {
      throw new TypeError("Invalid continuous.restrict argument: " + key);
    }
  }
  return { ...value } as unknown as RestrictArgs;
}
function appliesTo(value: Value): ObjectFilter | undefined {
  if (value === undefined || value === null || value === "any" || value === "all") return undefined;
  if (!isRecord(value)) throw new TypeError("continuous.restrict appliesTo must be an object filter");
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
  throw new TypeError("continuous.restrict duration must be this-turn, this-combat, permanent, or while-source-here");
}

export default {
  op: "continuous.restrict",
  argsSchema: { parse: parseArgs },
  execute: (ctx: ResolveContext, args: RestrictArgs): InstructionResult => {
    if (args.target !== undefined) {
      const selected = ctx.targets(ctx.evaluate(args.target) as string);
      if (selected.length === 0) return { status: "ignored", reason: "mistargeted" };
    }
    const raw = args.mode === undefined ? "prohibit" : ctx.evaluate(args.mode);
    if (typeof raw !== "string" || !MODES.includes(raw)) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const actionNames = (() => {
      const expr = args.action ?? args.operation;
      if (expr === undefined) return [] as string[];
      const value = ctx.evaluate(expr);
      const list = Array.isArray(value) ? value : [value];
      if (list.some(item => typeof item !== "string")) {
        throw new TypeError("continuous.restrict action must be action names");
      }
      return list as string[];
    })();
    const restriction = args.restriction === undefined ? undefined : ctx.evaluate(args.restriction);
    const amount = args.amount === undefined ? undefined : ctx.evaluate(args.amount);
    const cost = args.cost === undefined ? undefined : ctx.evaluate(args.cost);
    const kind = raw === "require" ? "requirement" : raw === "applied-cost" ? "applied-cost" : "restriction";
    const hasContent = actionNames.length > 0 ||
      (typeof restriction === "string" && restriction.trim().length > 0);
    if (!hasContent) return { status: "negated", reason: "impossible", events: [] };
    const filter = args.appliesTo === undefined ? undefined : appliesTo(ctx.evaluate(args.appliesTo));
    const effect: Record<string, unknown> = { kind };
    if (actionNames.length > 0) effect.actions = actionNames;
    if (typeof restriction === "string" && restriction.trim().length > 0) effect.restriction = restriction;
    if (typeof amount === "number" && Number.isSafeInteger(amount)) effect.amount = amount;
    if (cost !== undefined) effect.cost = cost;
    if (raw === "permit") effect.cancels = true;
    if (raw === "limit") effect.cap = true;
    const durationArg = args.duration === undefined ? "permanent" : ctx.evaluate(args.duration);
    const spec: ContinuousEffectSpec = {
      id: "continuous-restrict:" + ctx.source.ref.id + ":" + ctx.source.ref.zoneEntryId,
      layer: "ability",
      source: ctx.source.ref,
      filter: filter ?? {},
      effect: effect as ContinuousEffectSpec["effect"],
    };
    ctx.addContinuous(spec, durationOf(durationArg, ctx));
    ctx.link("registered", { id: spec.id, duration: durationArg });
    return { status: "executed", events: [] };
  },
};

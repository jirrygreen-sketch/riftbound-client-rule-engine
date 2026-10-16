/**
 * Continuous movement permissions and restrictions (CR v1.5 448, 450, 451,
 * 810).
 *
 * The primitive registers an ability-layer static effect. It never moves an
 * object itself: effect.move owns actual relocation. Movement permission adds
 * options to the Standard Move (like Ganking's Battlefield-to-Battlefield
 * route, 810.1.b); restrictions record blocked moves or destinations
 * ("move-from-here-to-base", "move-to-base", and similar judge-approved
 * labels). A shape with neither permission nor restriction is
 * negated/impossible and registers nothing.
 *
 * Arguments (all Expr):
 * - permission: name of the granted route, e.g. "battlefield-to-battlefield"
 * - source / destination: route endpoints (informational labels for the
 *   permission, e.g. "battlefield")
 * - move: route kind, e.g. "standard"
 * - restriction: name or list of names of blocked moves
 * - addsPermission: false records a restriction-only shape explicitly
 * - appliesTo: object filter for the objects the effect applies to
 * - duration / target: as in continuous.timing
 */
import type {
  ContinuousEffectSpec,
  Duration, Expr, InstructionResult, ObjectFilter, ResolveContext, Value,
} from "../contract.js";
import { bindTarget, continuousId, isSelector, mergeFilter } from "../../layers/rules/registration.js";

type DurationValue = Duration;

export interface MovementArgs {
  readonly permission?: Expr;
  readonly source?: Expr;
  readonly destination?: Expr;
  readonly move?: Expr;
  readonly restriction?: Expr;
  readonly addsPermission?: Expr;
  readonly appliesTo?: Expr;
  readonly duration?: Expr;
  readonly target?: Expr;
  readonly instanceId?: Expr;
  readonly executionId?: Expr;
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
function parseArgs(value: unknown): MovementArgs {
  if (!isRecord(value)) throw new TypeError("continuous.movement requires args");
  const allowed = ["permission", "source", "destination", "move", "restriction", "addsPermission", "appliesTo", "duration", "target", "instanceId", "executionId"];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) {
      throw new TypeError("Invalid continuous.movement argument: " + key);
    }
  }
  return { ...value } as unknown as MovementArgs;
}
function names(value: Value, label: string): readonly string[] {
  const list = Array.isArray(value) ? value : [value];
  const items = list.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (items.length !== list.length) throw new TypeError("continuous.movement " + label + " must be strings");
  return items;
}
function appliesTo(value: Value): ObjectFilter | undefined {
  if (value === undefined || value === null || value === "any" || value === "all") return undefined;
  if (!isRecord(value)) throw new TypeError("continuous.movement appliesTo must be an object filter");
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
  throw new TypeError("continuous.movement duration must be this-turn, this-combat, permanent, or while-source-here");
}

export default {
  op: "continuous.movement",
  argsSchema: { parse: parseArgs },
  execute: (ctx: ResolveContext, args: MovementArgs): InstructionResult => {
    const target = bindTarget(ctx, args.target);
    if (target === null) return { status: "ignored", reason: "mistargeted" };
    const permission = args.permission === undefined ? undefined : names(ctx.evaluate(args.permission), "permission");
    const endpoints = args.source === undefined && args.destination === undefined ? undefined : {
      source: args.source === undefined ? undefined : names(ctx.evaluate(args.source), "source")[0],
      destination: args.destination === undefined ? undefined : names(ctx.evaluate(args.destination), "destination")[0],
    };
    const move = args.move === undefined ? undefined : names(ctx.evaluate(args.move), "move")[0];
    const route = permission === undefined && endpoints === undefined && move === undefined ? undefined : {
      ...(permission === undefined ? {} : { routes: permission }),
      ...endpoints,
      ...(move === undefined ? {} : { move }),
    };
    const restrictionNames = args.restriction === undefined ? [] :
      names(ctx.evaluate(args.restriction), "restriction");
    const addsPermission = args.addsPermission === undefined ? true : ctx.evaluate(args.addsPermission) === true;
    const permissionNames = route === undefined ? [] : route.routes ?? [String(route.move ?? "permission")];
    const restrictions = addsPermission ? restrictionNames : [...restrictionNames, ...permissionNames];
    if (route === undefined && restrictions.length === 0) {
      return { status: "negated", reason: "impossible", events: [] };
    }
    const filter = args.appliesTo === undefined ? undefined : appliesTo(ctx.evaluate(args.appliesTo));
    const durationArg = args.duration === undefined ? "permanent" : ctx.evaluate(args.duration);
    const instance = args.instanceId === undefined && args.executionId === undefined ? undefined :
      ctx.evaluate(args.instanceId ?? args.executionId!);
    const spec: ContinuousEffectSpec = {
      id: continuousId("continuous-movement", ctx, instance, { route, restrictions, filter: mergeFilter(filter, target), duration: durationArg }),
      layer: "ability",
      source: ctx.source.ref,
      filter: mergeFilter(filter, target),
      effect: {
        kind: "movement",
        ...(addsPermission && route !== undefined ? { permission: route } : {}),
        ...(restrictions.length > 0 ? { restrictions } : {}),
        ...(target.refs.length > 0 ? { targetRefs: target.refs } : {}),
      },
    };
    ctx.addContinuous(spec, durationOf(durationArg, ctx));
    ctx.link("registered", { id: spec.id, duration: durationArg });
    return { status: "executed", events: [] };
  },
};

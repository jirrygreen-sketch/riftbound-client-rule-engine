/** Register a permission to Play specific cards from a non-default zone. */
import type {
  Expr, InstructionDef, InstructionResult, ObjectRef, ResolveContext, Value, ZoneId,
} from "../contract.js";
import { continuousId } from "../../layers/rules/registration.js";
import { isTimingPointId } from "../../events/timing-points.js";
import type { LocationFilter } from "@riftbound/card-dsl";

export interface PlayPermissionArgs {
  readonly objects?: Expr;
  readonly target?: Expr;
  readonly zone: Expr;
  readonly location?: Expr;
  readonly locations?: Expr;
  readonly player?: Expr;
  readonly payCosts?: Expr;
  readonly until?: Expr;
  readonly duration?: Expr;
  readonly instanceId?: Expr;
  readonly executionId?: Expr;
}

type AnyRecord = Record<string, unknown>;
const ZONES = new Set<ZoneId>([
  "hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain",
]);
const LOCATION_KEYS = new Set([
  "type", "kind", "player", "owner", "controller", "occupied", "open", "controlled",
  "contested", "hasUnits", "unitController", "id",
]);

function record(value: unknown): AnyRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as AnyRecord : null;
}
function isExpr(value: unknown): value is Expr {
  const item = record(value);
  if (item === null || typeof item.kind !== "string") return false;
  if (item.kind === "constant" || item.kind === "literal") return Object.hasOwn(item, "value");
  if (item.kind === "linked" || item.kind === "linked-value") return typeof item.instructionId === "string" && item.instructionId.length > 0;
  if (item.kind === "object-property" || item.kind === "object-attribute") return typeof item.property === "string" || typeof item.attribute === "string";
  return false;
}
function parseArgs(value: unknown): PlayPermissionArgs {
  const item = record(value);
  if (item === null) throw new TypeError("effect.play-permission arguments must be an object");
  const allowed = new Set(["objects", "target", "zone", "location", "locations", "player", "payCosts", "until", "duration", "instanceId", "executionId"]);
  for (const [key, expression] of Object.entries(item)) {
    if (!allowed.has(key) || !isExpr(expression)) throw new TypeError(`Invalid effect.play-permission argument: ${key}`);
  }
  if (!isExpr(item.zone)) throw new TypeError("effect.play-permission requires zone");
  if (item.objects === undefined && item.target === undefined) throw new TypeError("effect.play-permission requires objects or target");
  if (item.objects !== undefined && item.target !== undefined) throw new TypeError("effect.play-permission accepts one object source");
  return item as unknown as PlayPermissionArgs;
}
function ref(value: unknown): value is ObjectRef {
  const item = record(value);
  return typeof item?.id === "string" && Number.isSafeInteger(item?.zoneEntryId);
}
function selection(ctx: ResolveContext, value: unknown): readonly ObjectRef[] {
  if (value === "self" || value === "source") return [ctx.source.ref];
  if (ref(value)) return [{ id: value.id, zoneEntryId: value.zoneEntryId }];
  if (Array.isArray(value)) return value.filter(ref).map(item => ({ id: item.id, zoneEntryId: item.zoneEntryId }));
  const item = record(value);
  if (item === null) return [];
  if (typeof item.target === "string") return ctx.targets(item.target);
  if (typeof item.pick === "string") return ctx.picks(item.pick).filter(ref).map(item => ({ id: item.id, zoneEntryId: item.zoneEntryId }));
  if (typeof item.linked === "string") return selection(ctx, ctx.linked(item.linked));
  if (Array.isArray(item.objects)) return selection(ctx, item.objects);
  return [];
}
function linkedValue(ctx: ResolveContext, expression: Expr): Value | undefined {
  if (expression.kind !== "linked" && expression.kind !== "linked-value") return undefined;
  const key = expression.key;
  const candidates = [
    key === undefined ? expression.instructionId : `${expression.instructionId}.${key}`,
    key === undefined ? expression.instructionId : `${expression.instructionId}.${key.split(".")[0]}`,
    key,
    expression.instructionId,
  ].filter((item): item is string => typeof item === "string" && item.length > 0);
  for (const candidate of candidates) {
    const value = ctx.linked(candidate);
    if (value === undefined) continue;
    if (key === undefined || candidate.endsWith(key) || candidate === key) return value;
    const path = key.split(".").slice(1);
    let current: unknown = value;
    for (const part of path) {
      if (current === null || typeof current !== "object" || Array.isArray(current) || !(part in current)) {
        current = undefined;
        break;
      }
      current = (current as AnyRecord)[part];
    }
    if (current !== undefined) return current as Value;
  }
  return undefined;
}
function evaluateObjects(ctx: ResolveContext, expression: Expr): Value {
  const linked = linkedValue(ctx, expression);
  if (linked !== undefined) return linked;
  return ctx.evaluate(expression);
}
function location(value: Value): LocationFilter | undefined {
  const item = record(value);
  if (item === null) return undefined;
  if (Object.keys(item).some(key => !LOCATION_KEYS.has(key))) throw new TypeError("effect.play-permission location has unsupported fields");
  return item as LocationFilter;
}
function duration(value: Value | undefined, ctx: ResolveContext) {
  const name = value === undefined ? "permanent" : value;
  if (name === "permanent") return { type: "permanent" } as const;
  if (name === "this-turn") return { type: "end-of-turn" } as const;
  if (name === "your-next-ending-phase") return { type: "until", at: "turn-end", player: ctx.controller } as const;
  if (name === "this-combat") return { type: "end-of-combat" } as const;
  if (typeof name === "string" && isTimingPointId(name)) return { type: "until", at: name } as const;
  throw new TypeError(`Unsupported effect.play-permission duration: ${String(name)}`);
}

const definition: InstructionDef<PlayPermissionArgs> = {
  op: "effect.play-permission",
  argsSchema: { parse: parseArgs },
  execute: (ctx, args): InstructionResult => {
    const refs = args.target === undefined
      ? selection(ctx, evaluateObjects(ctx, args.objects!))
      : ctx.targets(String(ctx.evaluate(args.target)));
    const live = refs.filter(item => ctx.object(item) !== null);
    if (live.length === 0) return { status: "ignored", reason: "mistargeted" };
    const zoneValue = ctx.evaluate(args.zone);
    const zones = (Array.isArray(zoneValue) ? zoneValue : [zoneValue]).filter((value): value is ZoneId => typeof value === "string" && ZONES.has(value as ZoneId));
    if (zones.length === 0 || zones.length !== (Array.isArray(zoneValue) ? zoneValue.length : 1)) return { status: "negated", reason: "impossible", events: [] };
    const locationValue = args.location === undefined && args.locations === undefined ? undefined : ctx.evaluate(args.location ?? args.locations!);
    const locationSpec = locationValue === undefined || locationValue === null ? undefined : location(locationValue);
    const playerValue = args.player === undefined ? ctx.controller : ctx.evaluate(args.player);
    if (typeof playerValue !== "string") return { status: "negated", reason: "impossible", events: [] };
    const payCosts = args.payCosts === undefined ? true : ctx.evaluate(args.payCosts);
    if (typeof payCosts !== "boolean") return { status: "negated", reason: "impossible", events: [] };
    // This primitive only implements the printed "you still pay its costs"
    // permission.  An ignored-cost variant needs the cost-plan contract and
    // therefore fails closed until that separate adapter exists.
    if (!payCosts) return { status: "negated", reason: "impossible", events: [] };
    const untilValue = args.until === undefined && args.duration === undefined ? undefined : ctx.evaluate(args.until ?? args.duration!);
    const durationValue = duration(untilValue, ctx);
    const idValue = args.instanceId === undefined && args.executionId === undefined ? undefined : ctx.evaluate(args.instanceId ?? args.executionId!);
    const effect = {
      kind: "play-permission",
      objectRefs: live,
      zone: zones.length === 1 ? zones[0] : zones,
      player: playerValue,
      payCosts,
      ...(locationSpec === undefined ? {} : { location: locationSpec }),
    } as const;
    const id = continuousId("play-permission", ctx, idValue, effect);
    ctx.addContinuous({
      id,
      layer: "ability",
      source: ctx.source.ref,
      filter: { objectRefs: live as unknown as Value },
      effect,
    }, durationValue);
    const linked = { id, objects: live, zone: effect.zone, player: playerValue, payCosts, until: durationValue } as unknown as Value;
    ctx.link("registered", linked);
    ctx.link("permission", linked);
    return { status: "executed", events: [], linkedValues: { registered: linked, permission: linked } };
  },
};

export default definition;

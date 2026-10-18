/**
 * Effect movement between Board locations (CR v1.5 421, 448-455).
 * All arguments are Expr values, evaluated through ResolveContext:
 * - objects: source/self (default source), { target: TargetSpec id },
 *   { pick: PickSpec id }, or { kind: choose, id, filter, min? }. Targets are
 *   read only through targets(); picks and choose are non-target decisions.
 *   A choose selector requests up to amount distinct current Board objects,
 *   with min defaulting to that available count; min: 0 permits choosing none.
 * - to: a LocationRef supplied by target.location, controller-base (each
 *   object's current controller's Base), or { kind: choose, id, options },
 *   where options is a nonempty list of legal LocationRefs from target.location.
 *   Location choices are public mode requests, with a stable caller-supplied id.
 * - amount: nonnegative safe integer upper bound, default 1; insufficient
 *   objects means as many as possible (359.3.e.11). Zero performs no action
 *   or choice. Object and destination choice ids must be distinct.
 * - mode: move (default) or recall. Recall (CR v1.5 457-460) submits the
 *   independent RecallAction through zones/recall.ts. It never falls back to
 *   move-location, so a Move-only replacement cannot stop it and no Move event
 *   or history is produced. A Recall destination is always the object's
 *   current controller's Base (458.3). When the additive action is declared
 *   but its production consumer is unavailable, the instruction links a
 *   blockedReason and is negated/impossible instead of approximating a Move.
 * - linkKey: nonempty result key, default moved. Receipt { count, objects,
 *   movements: [{ object, from, to }] } captures actual successful movement,
 *   also on partial negation. A same-location instruction moves nothing.
 *
 * Invalidated targets are ignored (359.3.e.2-8); other impossible actions are
 * negated. Any replaced/prevented/impossible outcome negates the instruction;
 * remaining objects are still attempted. Events remain in action order.
 *
 * This is an effect Move, not the Standard Move ability: no exhaust cost,
 * Main Phase gate, or Ganking route requirement is added (144, 451.1).
 * move-location owns path restrictions and the corrective Recall of 449.2.c,
 * attached-card co-location (448.1), contested status (190.3, 452), Move timing
 * points, Showdown/Combat staging (453-454), and Cleanup (455). The reference
 * test kernel models only relocation; it does not prove those production
 * pipeline obligations. This primitive never sets battlefield control, stages
 * combat, resolves Move triggers, or advances priority. effect.zone handles
 * zone changes (448.2), effect.attach handles attachment, continuous.movement
 * handles ongoing movement permissions. A Recall must bypass Move restrictions
 * and Move triggers while preserving statuses/damage (458, 460); it cannot be
 * approximated with an ordinary Move or a zone exit/re-entry.
 */
import type {
  Expr, GameEvent, InstructionDef, InstructionResult, LocationRef, ObjectFilter,
  ObjectRef, ResolveContext, Value
} from "../contract.js";
import { performRecall } from "../../zones/recall.js";
import { queryMoveDestinations } from "../../target/location/candidates.js";

export interface MoveArgs {
  readonly objects?: Expr;
  readonly to: Expr;
  readonly amount?: Expr;
  readonly mode?: Expr;
  readonly linkKey?: Expr;
}

type Selection =
  | { readonly kind: "source" }
  | { readonly kind: "target"; readonly id: string }
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "choose"; readonly id: string; readonly filter: ObjectFilter; readonly min?: number };
type Destination = LocationRef | "controller-base" | {
  readonly kind: "choose"; readonly id: string; readonly options: readonly LocationRef[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && isCount(value.zoneEntryId);
}
function isValue(value: unknown, active = new Set<object>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  active.add(value);
  const valid = Object.values(value).every(item => isValue(item, active));
  active.delete(value);
  return valid;
}
function isExpr(value: unknown, active = new Set<object>()): value is Expr {
  if (!isRecord(value) || active.has(value)) return false;
  active.add(value);
  let valid: boolean;
  switch (value.kind) {
    case "constant": case "literal": valid = Object.hasOwn(value, "value") && isValue(value.value); break;
    case "object-property": valid = isRef(value.object) && isId(value.property); break;
    case "object-attribute": valid = isRef(value.object) && isId(value.attribute); break;
    case "linked": case "linked-value":
      valid = isId(value.instructionId) && (value.key === undefined || isId(value.key)); break;
    case "count":
      valid = isId(value.subject) && (value.filter === undefined || isRecord(value.filter) && isValue(value.filter)); break;
    case "arithmetic": {
      const operator = value.operator;
      const arity = operator === "neg" ? 1 :
        ["sub", "subtract", "div", "divide"].includes(String(operator)) ? 2 : undefined;
      valid = typeof operator === "string" &&
        ["add", "sub", "subtract", "mul", "multiply", "div", "divide", "min", "max", "neg"].includes(operator) &&
        Array.isArray(value.operands) && value.operands.length > 0 &&
        (arity === undefined || value.operands.length === arity) &&
        value.operands.every(operand => isExpr(operand, active));
      break;
    }
    default: valid = false;
  }
  active.delete(value);
  return valid;
}
function parseArgs(value: unknown): MoveArgs {
  if (!isRecord(value) || !isExpr(value.to)) throw new TypeError("effect.move requires a to Expr");
  for (const [key, expression] of Object.entries(value)) {
    if (!["objects", "to", "amount", "mode", "linkKey"].includes(key) || !isExpr(expression)) {
      throw new TypeError("Invalid effect.move argument: " + key);
    }
  }
  return { ...value } as unknown as MoveArgs;
}
function selection(value: Value): Selection {
  if (value === "source" || value === "self") return { kind: "source" };
  if (isRecord(value)) {
    if (Object.keys(value).length === 1 && isId(value.target)) return { kind: "target", id: value.target };
    if (Object.keys(value).length === 1 && isId(value.pick)) return { kind: "pick", id: value.pick };
    if (value.kind === "choose" && isId(value.id) && isRecord(value.filter) && isValue(value.filter) &&
        Object.keys(value).every(key => ["kind", "id", "filter", "min"].includes(key)) &&
        (value.min === undefined || isCount(value.min))) {
      return { kind: "choose", id: value.id, filter: value.filter, min: value.min };
    }
  }
  throw new TypeError("effect.move objects must name source, target, pick, or choose");
}
function isLocation(value: unknown): value is LocationRef {
  return isRecord(value) && (value.type === "base" && isId(value.player) ||
    value.type === "battlefield" && isId(value.id));
}
function destination(value: Value): Destination {
  if (value === "controller-base" || isLocation(value)) return value;
  if (isRecord(value) && value.kind === "choose" && isId(value.id) &&
      Array.isArray(value.options) && value.options.length > 0 && value.options.every(isLocation)) {
    return { kind: "choose", id: value.id, options: value.options };
  }
  throw new TypeError("effect.move to must be a location, controller-base, or location choice");
}
function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}
function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return left.type === "base" ? right.type === "base" && left.player === right.player :
    right.type === "battlefield" && left.id === right.id;
}
function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}
function locationValue(location: LocationRef): Value {
  return location.type === "base" ? { type: "base", player: location.player } :
    { type: "battlefield", id: location.id };
}
function currentRefs(ctx: ResolveContext, selected: Selection): ObjectRef[] {
  const candidates = selected.kind === "source" ? [ctx.source.ref] :
    selected.kind === "target" ? ctx.targets(selected.id) :
      selected.kind === "pick" ? ctx.picks(selected.id) : ctx.query(selected.filter).map(object => object.ref);
  const refs: ObjectRef[] = [];
  for (const candidate of candidates) {
    if (!isRef(candidate)) continue;
    const object = ctx.object(candidate);
    if (selected.kind === "choose" && !object?.types.some(type => type === "unit" || type === "gear")) continue;
    if (object?.zone === "board" && object.location !== null &&
        !refs.some(ref => sameRef(ref, candidate))) refs.push(candidate);
  }
  if (selected.kind === "choose") refs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.zoneEntryId - b.zoneEntryId);
  return refs;
}
function chooseRefs(ctx: ResolveContext, selected: Selection, refs: ObjectRef[], amount: number): readonly ObjectRef[] {
  const max = Math.min(amount, refs.length);
  if (selected.kind !== "choose" || max === 0) return refs.slice(0, max);
  if (selected.min !== undefined && selected.min > amount) throw new TypeError("effect.move choice min exceeds amount");
  const min = Math.min(selected.min ?? max, max);
  const answer = ctx.choose<readonly ObjectRef[]>({
    id: selected.id, type: "select-objects", chooser: ctx.controller, visibility: "public", options: refs, min, max
  });
  if (!Array.isArray(answer) || answer.length < min || answer.length > max || answer.some((ref, index) =>
    !isRef(ref) || !refs.some(option => sameRef(option, ref)) ||
    answer.slice(0, index).some(previous => sameRef(previous, ref)))) {
    throw new TypeError("Invalid effect.move object choice answer");
  }
  return answer;
}
function chooseDestination(ctx: ResolveContext, to: Destination): LocationRef | "controller-base" {
  if (to === "controller-base" || !("kind" in to)) return to;
  const options = to.options.filter((location, index) => !to.options.slice(0, index).some(other => sameLocation(location, other)));
  const answer = ctx.choose<LocationRef>({
    id: to.id, type: "mode", chooser: ctx.controller, visibility: "public", options
  });
  if (!isLocation(answer) || !options.some(option => sameLocation(option, answer))) {
    throw new TypeError("Invalid effect.move destination choice answer");
  }
  return answer;
}

/**
 * One gate for every evaluated Move destination shape. The interpreter also
 * checks dynamic selectors before the primitive, but direct constants and
 * already-evaluated linked/controller-base values only meet the same shared
 * Location rules here. A multi-object Move is rejected as a whole when no one
 * destination is legal for every selected zone entry (CR 451.2).
 */
function resolveDestinationForObjects(
  ctx: ResolveContext, objects: readonly ObjectRef[], to: Destination
): LocationRef | "controller-base" | null {
  const knownLocations: LocationRef[] = [...new Map([
    ...ctx.query({ zone: "board" }).flatMap(object => object.location === null ? [] : [object.location]),
    ...objects.map(ref => ctx.object(ref)!.location!).filter(location => location.type === "base"),
    ...(to === "controller-base" ? [] : "kind" in to ? to.options : [to]),
  ].map(location => [location.type === "base" ? `base:${location.player}` : `battlefield:${location.id}`, location] as const)).values()];
  if (to === "controller-base") {
    const legal = objects.every(ref => {
      const object = ctx.object(ref)!;
      const destination: LocationRef = { type: "base", player: object.controller };
      return sameLocation(object.location!, destination) ||
        queryMoveDestinations(ctx, [ref], {}, { locations: knownLocations.map(ref => ({ ref })) }).some(candidate => sameLocation(candidate, destination));
    });
    return legal ? to : null;
  }
  if (!("kind" in to)) {
    const current = objects.every(ref => sameLocation(ctx.object(ref)!.location!, to));
    return current || queryMoveDestinations(ctx, objects, {}, { locations: knownLocations.map(ref => ({ ref })) }).some(candidate => sameLocation(candidate, to)) ? to : null;
  }
  const options = to.options.filter(location =>
    objects.every(ref => sameLocation(ctx.object(ref)!.location!, location)) ||
    queryMoveDestinations(ctx, objects, {}, { locations: knownLocations.map(ref => ({ ref })) }).some(candidate => sameLocation(candidate, location)));
  if (options.length === 0) return null;
  return chooseDestination(ctx, { ...to, options });
}

export default {
  op: "effect.move",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const selected = args.objects === undefined ? { kind: "source" } as const : selection(ctx.evaluate(args.objects));
    const amount = args.amount === undefined ? 1 : ctx.evaluate(args.amount);
    const mode = args.mode === undefined ? "move" : ctx.evaluate(args.mode);
    const linkKey = args.linkKey === undefined ? "moved" : ctx.evaluate(args.linkKey);
    if (!isCount(amount)) throw new TypeError("effect.move amount must be a nonnegative safe integer");
    if (mode !== "move" && mode !== "recall") throw new TypeError("effect.move mode must be move or recall");
    if (!isId(linkKey)) throw new TypeError("effect.move linkKey must be a nonempty string");
    const refs = currentRefs(ctx, selected);
    if (selected.kind === "target" && refs.length === 0) return { status: "ignored", reason: "mistargeted" };
    const to = destination(ctx.evaluate(args.to));
    if (selected.kind === "choose" && typeof to === "object" && "kind" in to && selected.id === to.id) {
      throw new TypeError("effect.move object and destination choices require distinct ids");
    }
    const events: GameEvent[] = [];
    const moved: ObjectRef[] = [];
    const movements: Value[] = [];
    let reason: "replaced" | "skipped" | "impossible" | undefined;
    let blockedReason: string | undefined;
    let actionReceipt: ActionOutcome["receipt"] | undefined;
    if (amount > 0) {
      if (mode === "recall") {
        if (typeof to === "object" && "kind" in to) {
          throw new TypeError("effect.move recall cannot choose a destination (CR v1.5 457)");
        }
        if (refs.length === 0 && !(selected.kind === "choose" && selected.min === 0)) {
          reason = "impossible";
        } else {
          const objects = chooseRefs(ctx, selected, refs, amount);
          for (const ref of objects) {
            const before = ctx.object(ref);
            const explicit = to === "controller-base" ? null : to;
            // A Recall destination is always the Base of the object's current
            // controller (CR v1.5 457); any other explicit location, including
            // the other player's Base or a Battlefield, is impossible.
            if (before?.zone === "board" && before.location !== null &&
                before.types.some(type => type === "unit" || type === "gear") &&
                explicit !== null && !sameLocation(explicit, { type: "base", player: before.controller })) {
              reason ??= "impossible";
              continue;
            }
            const outcome = performRecall(ctx, ref);
            actionReceipt ??= outcome.receipt;
            events.push(...outcome.events);
            if (outcome.status !== "done") {
              reason ??= outcome.status === "prevented" ? "skipped" : outcome.status;
              blockedReason ??= outcome.blockedReason;
              continue;
            }
            if (outcome.count > 0) {
              moved.push(ref);
              movements.push({ object: refValue(ref), from: locationValue(outcome.from!), to: locationValue(outcome.to!) });
            }
          }
        }
      } else if (refs.length === 0 && !(selected.kind === "choose" && selected.min === 0)) {
        reason = "impossible";
      } else {
        const objects = chooseRefs(ctx, selected, refs, amount);
        const common = objects.length === 0 ? null : resolveDestinationForObjects(ctx, objects, to);
        if (objects.length > 0 && common === null) {
          const receipt: Value = { count: 0, objects: [], movements: [] };
          ctx.link(linkKey, receipt);
          return { status: "negated", reason: "impossible", events };
        }
        for (const ref of objects) {
          const before = ctx.object(ref);
          if (before?.zone !== "board" || before.location === null ||
              !before.types.some(type => type === "unit" || type === "gear")) {
            reason ??= "impossible";
            continue;
          }
          const target = common === "controller-base" ? { type: "base" as const, player: before.controller } : common!;
          if (sameLocation(before.location, target)) continue;
          const outcome = ctx.perform({ type: "move-location", object: ref, to: target });
          events.push(...outcome.events);
          if (outcome.status !== "done") {
            reason ??= outcome.status === "prevented" ? "skipped" : outcome.status;
            continue;
          }
          const after = ctx.object(ref);
          if (after?.zone === "board" && after.location !== null && !sameLocation(before.location, after.location)) {
            moved.push(ref);
            movements.push({ object: refValue(ref), from: locationValue(before.location), to: locationValue(after.location) });
          }
        }
      }
    }
    const receipt: Value = {
      count: moved.length, objects: moved.map(refValue), movements,
      ...(mode === "recall" ? { mode } : {}),
      ...(blockedReason === undefined ? {} : { blockedReason }),
      ...(actionReceipt === undefined ? {} : { receipt: actionReceipt as unknown as Value })
    };
    ctx.link(linkKey, receipt);
    return reason ? { status: "negated", reason, events } :
      { status: "executed", events, linkedValues: { [linkKey]: receipt } };
  }
} satisfies InstructionDef<MoveArgs>;

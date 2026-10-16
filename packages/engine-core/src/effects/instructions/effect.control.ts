/**
 * Change control through take-control (Core Rules v1.5 127.1, 188-192).
 * IR arguments are Expr values evaluated only through ResolveContext.
 * argsSchema also wraps the interpreter's already-evaluated JSON values in
 * constant Exprs; static CardProgram validation still requires Expr arguments.
 * - objects: source/self (default source), { target: TargetSpec id },
 *   { pick: PickSpec id }, or { kind: choose, id, filter, min? }. Targets use
 *   targets(); picks and public select-objects choices are non-targeting.
 *   Choice options are sorted by id and zoneEntryId for deterministic replay.
 * - player: new PlayerId, default ctx.controller, independent of owner.
 * - amount: nonnegative safe integer upper bound, default 1. Use as many
 *   available distinct objects as possible (359.3.e.11). Zero performs no
 *   action or choice. A choose selector defaults to the available count;
 *   min: 0 allows choosing none. Explicit targets/picks retain their order.
 * - duration: { type: permanent } by default; also accepts end-of-turn,
 *   end-of-combat, while-source-in-zone (the original ctx.source on Board),
 *   or until with at and optional player. All non-permanent durations remain
 *   BLOCKED: take-control has no duration/control-effect identity, so it
 *   cannot expire or restore the underlying controller in timestamp order
 *   (479.2.a, 482.3). Adding a continuous layer after mutating the underlying
 *   controller cannot restore it; a delayed trigger would incorrectly put a
 *   passive expiry on the Chain. No substitute action/effect is registered.
 *   If the while-source-in-zone source has already left the Board, ignore
 *   the instruction, including after exit/re-entry (359.3.e.16, Akshan).
 * - linkKey: nonempty receipt key, default controlled. The receipt stores
 *   { count, objects, changes: [{ object, owner, from, to }] }, recording
 *   actual changes even on partial negation. Blocked durations add
 *   blockedReason. Already-controlled objects have no change to report.
 *
 * Targets are revalidated by targets() and by current zone identity
 * (359.3.e.2-8). Target/Pick plans own card-specific restrictions. Board
 * objects, Runes and finalized Chain targets are supported; Pending exclusion
 * is owned by TargetPlan (P0 3.8). Local non-target choose queries are limited
 * to Board/Rune objects, since ObjectSnapshot cannot identify Pending items.
 * Any replaced/prevented/impossible action negates the instruction while
 * remaining objects are attempted. Actual owner is never changed (127.1).
 *
 * Control does not recall, move, ready or attach: Possession's recall belongs
 * to effect.move (457-460), Akshan's movement/attachment to effect.move and
 * effect.attach. Attached cards keep independent controllers (718.5.e-f).
 * Contested status, corrective recalls and combat designations are kernel
 * obligations (190.3.a.2, 323.2.b, 323.6); this primitive never advances them.
 * Existing abilities retain their controller when their source changes
 * control (191.5.b); no source or ability snapshots are edited here.
 */
import type {
  Duration, Expr, GameEvent, InstructionDef, InstructionResult, ObjectFilter,
  ObjectRef, ResolveContext, Value
} from "../contract.js";
import { isTimingPointId } from "../../events/timing-points.js";

export interface ControlArgs {
  readonly objects?: Expr;
  readonly player?: Expr;
  readonly amount?: Expr;
  readonly duration?: Expr;
  readonly linkKey?: Expr;
}

type Selection =
  | { readonly kind: "source" }
  | { readonly kind: "target"; readonly id: string }
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "choose"; readonly id: string; readonly filter: ObjectFilter; readonly min?: number };

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
function isSelector(value: unknown): boolean {
  return value === "source" || value === "self" || isRecord(value) &&
    Object.keys(value).length === 1 && ["target", "pick", "linked"].some(key => isId(value[key]));
}
function isValue(value: unknown, active = new Set<object>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) return false;
  active.add(value);
  const valid = Object.values(value).every(item => isValue(item, active));
  active.delete(value);
  return valid;
}
function isExpr(value: unknown, active = new Set<object>()): value is Expr {
  if (!isRecord(value) || active.has(value)) return false;
  active.add(value);
  let valid = false;
  switch (value.kind) {
    case "constant": case "literal": valid = Object.hasOwn(value, "value") && isValue(value.value); break;
    case "object-property": valid = isSelector(value.object) && isId(value.property); break;
    case "object-attribute": valid = isSelector(value.object) && isId(value.attribute); break;
    case "linked": case "linked-value":
      valid = isId(value.instructionId) && (value.key === undefined || isId(value.key)); break;
    case "count":
      valid = isId(value.subject) && (value.filter === undefined || isRecord(value.filter) && isValue(value.filter)); break;
    case "arithmetic": {
      const arity = value.operator === "neg" ? 1 :
        ["sub", "subtract", "div", "divide"].includes(String(value.operator)) ? 2 : undefined;
      valid = typeof value.operator === "string" &&
        ["add", "sub", "subtract", "mul", "multiply", "div", "divide", "min", "max", "neg"].includes(value.operator) &&
        Array.isArray(value.operands) && value.operands.length > 0 &&
        (arity === undefined || value.operands.length === arity) &&
        value.operands.every(operand => isExpr(operand, active));
      break;
    }
  }
  active.delete(value);
  return valid;
}
function parseArgs(value: unknown): ControlArgs {
  if (!isRecord(value)) throw new TypeError("effect.control args must be an object");
  const args: { -readonly [Key in keyof ControlArgs]: ControlArgs[Key] } = {};
  for (const [key, expression] of Object.entries(value)) {
    if (key !== "objects" && key !== "player" && key !== "amount" && key !== "duration" && key !== "linkKey") {
      throw new TypeError("Invalid effect.control argument: " + key);
    }
    if (isExpr(expression)) {
      args[key] = expression;
    } else if (isValue(expression) && (key === "objects" ?
      expression === "self" || expression === "source" || isRecord(expression) &&
        (!Object.hasOwn(expression, "kind") || expression.kind === "choose") :
      key === "amount" ? isCount(expression) : key === "duration" ?
        isRecord(expression) && !Object.hasOwn(expression, "kind") : isId(expression))) {
      args[key] = { kind: "constant", value: expression };
    } else {
      throw new TypeError("Invalid effect.control argument: " + key);
    }
  }
  return args;
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
  throw new TypeError("effect.control objects must name source, target, pick, or choose");
}
function duration(value: Value, source: ObjectRef): Duration {
  if (isRecord(value)) {
    if (["permanent", "end-of-turn", "end-of-combat", "while-source-in-zone"].includes(String(value.type)) &&
        Object.keys(value).length === 1) {
      if (value.type === "while-source-in-zone") return { type: "while-source-in-zone", source };
      return { type: value.type as "permanent" | "end-of-turn" | "end-of-combat" };
    }
    if (value.type === "until" && isTimingPointId(value.at) &&
        (value.player === undefined || isId(value.player)) &&
        Object.keys(value).every(key => ["type", "at", "player"].includes(key))) {
      return { type: "until", at: value.at, ...(value.player === undefined ? {} : { player: value.player }) };
    }
  }
  throw new TypeError("Invalid effect.control duration");
}
function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}
function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}
function currentRefs(ctx: ResolveContext, selected: Selection): ObjectRef[] {
  const candidates = selected.kind === "source" ? [ctx.source.ref] :
    selected.kind === "target" ? ctx.targets(selected.id) :
      selected.kind === "pick" ? ctx.picks(selected.id) : ctx.query(selected.filter).map(object => object.ref);
  const refs: ObjectRef[] = [];
  for (const candidate of candidates) {
    if (!isRef(candidate)) continue;
    const object = ctx.object(candidate);
    if (object && (object.zone === "board" || object.zone === "rune-zone" ||
        selected.kind === "target" && object.zone === "chain") &&
        !refs.some(ref => sameRef(ref, candidate))) refs.push(candidate);
  }
  if (selected.kind === "choose") refs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.zoneEntryId - b.zoneEntryId);
  return refs;
}
function chooseRefs(ctx: ResolveContext, selected: Selection, refs: ObjectRef[], amount: number): readonly ObjectRef[] {
  const max = Math.min(amount, refs.length);
  if (selected.kind !== "choose" || max === 0) return refs.slice(0, max);
  const min = Math.min(selected.min ?? max, max);
  const answer = ctx.choose<readonly ObjectRef[]>({
    id: selected.id, type: "select-objects", chooser: ctx.controller, visibility: "public", options: refs, min, max
  });
  if (!Array.isArray(answer) || answer.length < min || answer.length > max || answer.some((ref, index) =>
    !isRef(ref) || !refs.some(option => sameRef(option, ref)) ||
    answer.slice(0, index).some(previous => sameRef(previous, ref)))) {
    throw new TypeError("Invalid effect.control choice answer");
  }
  return answer;
}

export default {
  op: "effect.control",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const selected = args.objects === undefined ? { kind: "source" } as const : selection(ctx.evaluate(args.objects));
    const amount = args.amount === undefined ? 1 : ctx.evaluate(args.amount);
    const player = args.player === undefined ? ctx.controller : ctx.evaluate(args.player);
    const lifetime = args.duration === undefined ? { type: "permanent" } as const : duration(ctx.evaluate(args.duration), ctx.source.ref);
    const linkKey = args.linkKey === undefined ? "controlled" : ctx.evaluate(args.linkKey);
    if (!isCount(amount)) throw new TypeError("effect.control amount must be a nonnegative safe integer");
    if (!isId(player)) throw new TypeError("effect.control player must be a nonempty PlayerId");
    if (!isId(linkKey)) throw new TypeError("effect.control linkKey must be a nonempty string");
    if (selected.kind === "choose" && selected.min !== undefined && selected.min > amount) {
      throw new TypeError("effect.control choice min exceeds amount");
    }
    const refs = currentRefs(ctx, selected);
    if (selected.kind === "target" && refs.length === 0) return { status: "ignored", reason: "mistargeted" };
    if (amount > 0 && lifetime.type === "while-source-in-zone" && ctx.object(lifetime.source)?.zone !== "board") {
      return { status: "ignored", reason: "linked-ignored" };
    }
    const events: GameEvent[] = [];
    const controlled: ObjectRef[] = [];
    const changes: Value[] = [];
    let reason: "replaced" | "skipped" | "impossible" | undefined;
    let blockedReason: string | undefined;
    if (amount > 0) {
      if (lifetime.type !== "permanent") {
        reason = "impossible";
        blockedReason = "Temporary control requires duration-aware take-control and layered expiry/restoration (CR v1.5 479.2.a, 482.3)";
      } else if (refs.length === 0 && !(selected.kind === "choose" && selected.min === 0)) {
        reason = "impossible";
      } else {
        for (const object of chooseRefs(ctx, selected, refs, amount)) {
          const before = ctx.object(object);
          if (!before) { reason ??= "impossible"; continue; }
          if (before.controller === player) continue;
          const outcome = ctx.perform({ type: "take-control", object, player });
          events.push(...outcome.events);
          if (outcome.status !== "done") {
            reason ??= outcome.status === "prevented" ? "skipped" : outcome.status;
          } else {
            const after = ctx.object(object);
            if (after && after.controller !== before.controller) {
              controlled.push(object);
              changes.push({ object: refValue(object), owner: before.owner, from: before.controller, to: after.controller });
            }
          }
        }
      }
    }
    const value: Value = { count: controlled.length, objects: controlled.map(refValue), changes,
      ...(blockedReason === undefined ? {} : { blockedReason }) };
    ctx.link(linkKey, value);
    return reason ? { status: "negated", reason, events } :
      { status: "executed", events, linkedValues: { [linkKey]: value } };
  }
} satisfies InstructionDef<ControlArgs>;

/**
 * Banish cards/permanents directly to their owner's Banishment (CR v1.5
 * 056.1-2, 108.6, 428.1-5). This is neither Kill nor Discard (428.2.a-b).
 * Only the banish GameAction is submitted; zone routing, visibility, tokens,
 * replacement/prevention, and zone-entry identity are owned by the kernel.
 * Generic movement belongs to effect.zone; killing, discarding, looking,
 * revealing, playing, and registering delayed abilities are separate effects.
 * Card-specific target restrictions and conditional branches belong to the
 * TargetSpec and interpreter, including VEN-106/166's Might check.
 *
 * All args are Expr values evaluated at resolution:
 * The IR validator enforces Expr arguments. argsSchema also normalizes the
 * current interpreter's already-evaluated values into constant expressions,
 * so direct primitive tests and interpreter dispatch use the same definition.
 * - objects: defaults to source. Evaluates to "self" / "source", { target: id },
 *   { pick: id }, { linked: key }, { zone, player?, from? }, or
 *   { choose: id, filter, chooser?, visibility?, from? }. Targets come only from
 *   ctx.targets; non-target picks come only from ctx.picks. Linked selections
 *   accept a captured ObjectRef/list or this primitive's result record.
 *   Zone selections use zoneSlice, including top/bottom of Main/Rune Decks;
 *   player defaults to controller and from to top. A choose selector is a
 *   non-target set query followed by choose(select-objects); its id must be
 *   unique in the resolving program, chooser defaults to controller, and
 *   visibility defaults to chooser-only. Its optional from selector restricts
 *   the choice to a linked collection, pick, target, source, or query before
 *   applying the ObjectFilter. It grants no Look/Reveal permission.
 * - amount: nonnegative safe integer upper bound; defaults to all candidates
 *   except choose, which defaults to one. Excess requests banish as many as
 *   possible (055, 359.3.e.11); zero performs no action or choice. Zone slices
 *   use this count directly, never query ordering to infer a deck's top/bottom.
 * - linkKey: nonempty string, default banished. Captures { count, objects,
 *   source }: count is actual done actions, objects are the resulting current
 *   Banishment references, and source is this source instance's original ref.
 *   Tokens that cease to exist have no resulting current reference.
 *   Also links linkKey + Count (number), linkKey + Objects (reference array),
 *   and linkKey + Object (the sole resulting ref, otherwise null), so existing
 *   linked-value expressions can consume counts or a single object directly.
 *
 * Old references are never revived (124, 359.3.e.4, .7-.8). After a successful
 * action, new references are read from the owner's Banishment via context,
 * never constructed by incrementing zoneEntryId. Links are per instruction
 * and source instance, not an aggregate by card name (428.3.a, 395-398).
 * Persistent linked abilities and delayed instructions are interpreter-owned.
 * Partial successes are linked even on negation (359.3.e.14.a-b). All done
 * yields executed; any replaced/prevented/impossible yields negated; all stale
 * targets yield ignored without writing a link. Stale non-target selections
 * and positive requests from an empty pool are impossible, not mistargeted.
 * Selecting an entire empty zone, or explicitly requesting zero, executes
 * with a zero result. Action order is deterministic; choose is not order.
 */
import type {
  ChoiceVisibility, Expr, GameEvent, InstructionDef, InstructionResult,
  ObjectFilter, ObjectRef, ResolveContext, Value, ZoneId
} from "../contract.js";

export interface BanishArgs {
  readonly objects?: Expr;
  readonly amount?: Expr;
  readonly linkKey?: Expr;
}

type Selection =
  | { readonly kind: "source" }
  | { readonly kind: "target" | "pick" | "linked"; readonly id: string }
  | { readonly kind: "zone"; readonly zone: ZoneId; readonly player: string; readonly from: "top" | "bottom" }
  | {
    readonly kind: "choose"; readonly id: string; readonly filter: ObjectFilter; readonly chooser: string;
    readonly visibility: ChoiceVisibility; readonly from?: Exclude<Selection, { readonly kind: "choose" }>;
  };

const ZONES: readonly ZoneId[] = ["hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) &&
    (value.zoneEntryId as number) >= 0;
}

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!isRecord(value) && !Array.isArray(value) || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isExpr(value: unknown, ancestors = new Set<unknown>()): value is Expr {
  if (!isRecord(value) || ancestors.has(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value && isValue(value.value);
    case "object-property": return isRef(value.object) && isId(value.property);
    case "object-attribute": return isRef(value.object) && isId(value.attribute);
    case "linked": case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count": return isId(value.subject) && (value.filter === undefined || isRecord(value.filter) && isValue(value.filter));
    case "arithmetic": {
      if (!Array.isArray(value.operands)) return false;
      const arity = value.operator === "neg" ? 1 :
        ["sub", "subtract", "div", "divide"].includes(String(value.operator)) ? 2 :
          ["add", "mul", "multiply", "min", "max"].includes(String(value.operator)) ? null : 0;
      if (arity === 0 || (arity === null ? value.operands.length === 0 : value.operands.length !== arity)) return false;
      ancestors.add(value);
      const valid = value.operands.every(operand => isExpr(operand, ancestors));
      ancestors.delete(value);
      return valid;
    }
    default: return false;
  }
}

function parseArgs(value: unknown): BanishArgs {
  if (!isRecord(value)) throw new TypeError("effect.banish args must be an object");
  const args: { objects?: Expr; amount?: Expr; linkKey?: Expr } = {};
  for (const [key, expression] of Object.entries(value)) {
    if (key !== "objects" && key !== "amount" && key !== "linkKey") {
      throw new TypeError("Invalid effect.banish Expr argument: " + key);
    }
    if (isExpr(expression)) {
      args[key] = expression;
    } else if (isValue(expression) &&
        (key === "amount" ? typeof expression === "number" && Number.isSafeInteger(expression) && expression >= 0 :
          key === "linkKey" ? isId(expression) : expression === "self" || expression === "source" ||
            isRecord(expression) && !Object.hasOwn(expression, "kind"))) {
      args[key] = { kind: "constant", value: expression };
    } else {
      throw new TypeError("Invalid effect.banish Expr argument: " + key);
    }
  }
  return args;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function selection(ctx: ResolveContext, value: Value): Selection {
  if (value === "self" || value === "source") return { kind: "source" };
  if (isRecord(value)) {
    for (const kind of ["target", "pick", "linked"] as const) {
      if (onlyKeys(value, [kind]) && isId(value[kind])) return { kind, id: value[kind] };
    }
    if (onlyKeys(value, ["zone", "player", "from"]) && ZONES.includes(value.zone as ZoneId) &&
        (value.player === undefined || isId(value.player)) &&
        (value.from === undefined || value.from === "top" || value.from === "bottom")) {
      return { kind: "zone", zone: value.zone as ZoneId, player: value.player ?? ctx.controller, from: value.from ?? "top" };
    }
    const visibility = value.visibility ?? "chooser-only";
    if (onlyKeys(value, ["choose", "filter", "chooser", "visibility", "from"]) && isId(value.choose) &&
        isRecord(value.filter) && isValue(value.filter) && (value.chooser === undefined || isId(value.chooser)) &&
        (visibility === "public" || visibility === "chooser-only" || Array.isArray(visibility) && visibility.every(isId))) {
      const from = value.from === undefined ? undefined : selection(ctx, value.from as Value);
      if (from?.kind === "choose") throw new TypeError("effect.banish choose.from cannot be another choose selector");
      return {
        kind: "choose", id: value.choose, filter: value.filter, chooser: value.chooser ?? ctx.controller,
        visibility, ...(from === undefined ? {} : { from })
      };
    }
  }
  throw new TypeError("effect.banish objects must evaluate to a symbolic source, target, pick, linked, zone, or choose selector");
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function sourceValues(ctx: ResolveContext, selected: Selection, amount: number | undefined): readonly unknown[] {
  let values: readonly unknown[];
  switch (selected.kind) {
    case "source": values = [ctx.source.ref]; break;
    case "target": values = ctx.targets(selected.id); break;
    case "pick": values = ctx.picks(selected.id); break;
    case "linked": {
      const value = ctx.linked(selected.id);
      values = Array.isArray(value) ? value : isRef(value) ? [value] :
        isRecord(value) && Array.isArray(value.objects) ? value.objects : [];
      break;
    }
    case "zone": values = ctx.zoneSlice(selected.player, selected.zone, selected.from, amount).map(object => object.ref); break;
    case "choose": values = selected.from === undefined
      ? ctx.query(selected.filter).map(object => object.ref)
      : sourceValues(ctx, selected.from, undefined);
  }
  return values;
}

function candidates(ctx: ResolveContext, selected: Selection, amount: number | undefined): ObjectRef[] {
  const values = sourceValues(ctx, selected, amount);
  const refs: ObjectRef[] = [];
  for (const value of values) {
    if (isRef(value) && ctx.object(value) !== null && !refs.some(ref => sameRef(ref, value))) {
      refs.push({ id: value.id, zoneEntryId: value.zoneEntryId });
    }
  }
  if (selected.kind === "choose") {
    const allowed = new Set(ctx.query(selected.filter).map(object => `${object.ref.id}:${object.ref.zoneEntryId}`));
    for (let index = refs.length - 1; index >= 0; index--) {
      const ref = refs[index]!;
      if (!allowed.has(`${ref.id}:${ref.zoneEntryId}`)) refs.splice(index, 1);
    }
    refs.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : left.zoneEntryId - right.zoneEntryId);
  }
  return refs;
}

export default {
  op: "effect.banish",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const selected = selection(ctx, args.objects === undefined ? "source" : ctx.evaluate(args.objects));
    const amount = args.amount === undefined ? selected.kind === "choose" ? 1 : undefined : ctx.evaluate(args.amount);
    if (amount !== undefined && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) {
      throw new TypeError("effect.banish amount must evaluate to a nonnegative safe integer");
    }
    const linkKey = args.linkKey === undefined ? "banished" : ctx.evaluate(args.linkKey);
    if (!isId(linkKey)) throw new TypeError("effect.banish linkKey must evaluate to a nonempty string");
    const refs = candidates(ctx, selected, amount);
    if (selected.kind === "target" && refs.length === 0) return { status: "ignored", reason: "mistargeted" };

    const count = Math.min(amount ?? refs.length, refs.length);
    let chosen = refs.slice(0, count);
    if (selected.kind === "choose" && count > 0) {
      const answer = ctx.choose<readonly ObjectRef[]>({
        id: selected.id, type: "select-objects", chooser: selected.chooser,
        visibility: selected.visibility, options: refs, min: count, max: count
      });
      if (!Array.isArray(answer) || answer.length !== count || answer.some((ref, index) =>
        !isRef(ref) || !refs.some(option => sameRef(option, ref)) ||
        answer.slice(0, index).some(previous => sameRef(previous, ref)))) {
        throw new TypeError("Invalid effect.banish choice answer");
      }
      chosen = refs.filter(ref => answer.some(value => sameRef(ref, value)));
    }

    const events: GameEvent[] = [];
    const banished: ObjectRef[] = [];
    let actual = 0;
    let reason: "replaced" | "skipped" | "impossible" | undefined;
    if (refs.length === 0 && amount !== 0 && !(selected.kind === "zone" && amount === undefined)) reason = "impossible";
    for (const ref of chosen) {
      const before = ctx.object(ref);
      if (before === null || before.zone === "banishment") {
        reason ??= "impossible";
        continue;
      }
      const outcome = ctx.perform({ type: "banish", object: ref });
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        reason ??= outcome.status === "replaced" ? "replaced" : outcome.status === "prevented" ? "skipped" : "impossible";
        continue;
      }
      actual++;
      const after = ctx.zoneSlice(before.owner, "banishment", "top").find(object => object.ref.id === ref.id);
      if (after) banished.push(after.ref);
    }
    const value: Value = { count: actual, objects: banished.map(refValue), source: refValue(ctx.source.ref) };
    const linkedValues: Record<string, Value> = {
      [linkKey]: value,
      [linkKey + "Count"]: actual,
      [linkKey + "Objects"]: banished.map(refValue),
      [linkKey + "Object"]: actual === 1 && banished.length === 1 ? refValue(banished[0]!) : null
    };
    for (const [key, captured] of Object.entries(linkedValues)) ctx.link(key, captured);
    return reason ? { status: "negated", reason, events } :
      { status: "executed", events, linkedValues };
  }
} satisfies InstructionDef<BanishArgs>;

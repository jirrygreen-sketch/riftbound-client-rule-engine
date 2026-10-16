/**
 * effect.heal clears marked damage from Units (Core Rules v1.5 142.2, 142.5,
 * 419.1–419.3.a). It never changes player life, Might, or printed costs.
 *
 * All args are Expr values evaluated through ResolveContext:
 * - objects?: evaluates to { kind: "source" } (default), { kind: "target", id },
 *   { kind: "pick", id }, { kind: "query", filter }, or
 *   { kind: "choose", id, filter, min?, max? }. Targets come only from targets();
 *   non-target picks come from picks(). Query means every matching Board Unit
 *   (355.10.d); choose is a non-target resolution choice (355.10.e–f), with a
 *   stable request id, public visibility, and the controller as chooser.
 *   Choice bounds are nonnegative safe integers, defaulting to exactly one;
 *   when fewer Units exist, do as much as possible (359.3.e.11).
 * - amount?: a nonnegative safe integer amount of damage to clear PER Unit.
 *   Omit to clear all currently marked damage, as unqualified "heal it" does.
 *   Oversized amounts clear only existing damage; zero and undamaged Units
 *   produce no action or event. A zero amount does not ask for a choice.
 * - linkKey?: a nonempty string, default "healed". Stores { amount, count,
 *   objects }: actual damage cleared, number of Units with damage cleared, and
 *   their distinct references. Partial successes are linked even on negation.
 *
 * All targets unavailable => ignored (359.3.e.6–e.9); otherwise every heal
 * action goes through perform(). Any replaced/prevented/impossible outcome
 * negates the instruction (reasons replaced/skipped/impossible respectively),
 * while remaining Units are still processed. All done => executed, including
 * an empty all-Units query or a legal no-effect instruction. Stale source/pick
 * references cannot be healed and negate the instruction if none remain.
 * Query/choice options are sorted by identity; target/pick order is preserved.
 *
 * Multiple-Unit simultaneity (419.2), replacement/prevention, lethal-damage
 * checks, and automatic healing during turn/combat cleanup (143.3.b.1–b.2)
 * belong to the kernel. This primitive neither advances those steps nor
 * registers death replacements. In sfd-173-221 and unl-175-219, the enclosing
 * replacement supplies the affected Unit; exhaust and recall are separate
 * instructions. Damage dealing belongs to effect.damage; healing is not
 * negative damage and does not undo already resolved death or move zones.
 */
import type {
  Expr, GameEvent, InstructionDef, InstructionResult, ObjectFilter, ObjectRef,
  ResolveContext, Value
} from "../contract.js";

export interface EffectHealArgs {
  readonly objects?: Expr;
  readonly amount?: Expr;
  readonly linkKey?: Expr;
}

type Selection =
  | { readonly kind: "source" }
  | { readonly kind: "target"; readonly id: string }
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "query"; readonly filter: ObjectFilter }
  | {
      readonly kind: "choose"; readonly id: string; readonly filter: ObjectFilter;
      readonly min: number; readonly max: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && isAmount(value.zoneEntryId);
}

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if ((!isRecord(value) && !Array.isArray(value)) || ancestors.has(value)) return false;
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
    case "count":
      return isId(value.subject) && (value.filter === undefined ||
        isRecord(value.filter) && isValue(value.filter));
    case "arithmetic": {
      const operators = ["add", "sub", "subtract", "mul", "multiply", "div", "divide", "min", "max", "neg"];
      if (typeof value.operator !== "string" || !operators.includes(value.operator) ||
          !Array.isArray(value.operands) || value.operands.length === 0) return false;
      const arity = value.operator === "neg" ? 1 :
        ["sub", "subtract", "div", "divide"].includes(value.operator) ? 2 : undefined;
      if (arity !== undefined && value.operands.length !== arity) return false;
      ancestors.add(value);
      const valid = value.operands.every(operand => isExpr(operand, ancestors));
      ancestors.delete(value);
      return valid;
    }
    default: return false;
  }
}

function selection(value: unknown): Selection {
  if (isRecord(value)) {
    if (value.kind === "source") return { kind: "source" };
    if ((value.kind === "target" || value.kind === "pick") && isId(value.id)) {
      return { kind: value.kind, id: value.id };
    }
    if ((value.kind === "query" || value.kind === "choose") &&
        isRecord(value.filter) && isValue(value.filter)) {
      if (value.kind === "query") return { kind: "query", filter: value.filter };
      const max = value.max === undefined ? 1 : value.max;
      const min = value.min === undefined ? max : value.min;
      if (isId(value.id) && isAmount(min) && isAmount(max) && min <= max) {
        return { kind: "choose", id: value.id, filter: value.filter, min, max };
      }
    }
  }
  throw new TypeError("effect.heal objects must select source, target, pick, query, or choose");
}

function parseArgs(value: unknown): EffectHealArgs {
  if (!isRecord(value)) throw new TypeError("effect.heal args must be an object");
  for (const [key, expr] of Object.entries(value)) {
    if (!["objects", "amount", "linkKey"].includes(key) || !isExpr(expr)) {
      throw new TypeError("Invalid effect.heal argument: " + key);
    }
    if (expr.kind !== "constant" && expr.kind !== "literal") continue;
    if (key === "objects") selection(expr.value);
    if (key === "amount" && !isAmount(expr.value)) {
      throw new TypeError("effect.heal amount must be a nonnegative safe integer");
    }
    if (key === "linkKey" && !isId(expr.value)) {
      throw new TypeError("effect.heal linkKey must be a nonempty string");
    }
  }
  return value as unknown as EffectHealArgs;
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function candidates(ctx: ResolveContext, selected: Selection): ObjectRef[] {
  const values = selected.kind === "source" ? [ctx.source.ref] :
    selected.kind === "target" ? ctx.targets(selected.id) :
      selected.kind === "pick" ? ctx.picks(selected.id) :
        ctx.query(selected.filter).map(object => object.ref);
  const refs: ObjectRef[] = [];
  for (const value of values) {
    if (!isRef(value)) continue;
    const object = ctx.object(value);
    if (object?.zone === "board" && object.types.includes("unit") &&
        !refs.some(ref => sameRef(ref, value))) refs.push(value);
  }
  if (selected.kind === "query" || selected.kind === "choose") {
    refs.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 :
      left.zoneEntryId - right.zoneEntryId);
  }
  return refs;
}

function chooseRefs(ctx: ResolveContext, selected: Extract<Selection, { kind: "choose" }>, refs: ObjectRef[]): ObjectRef[] {
  const min = Math.min(selected.min, refs.length);
  const max = Math.min(selected.max, refs.length);
  if (max === 0) return [];
  const answer = ctx.choose<readonly ObjectRef[]>({
    id: selected.id, type: "select-objects", chooser: ctx.controller,
    visibility: "public", options: refs, min, max
  });
  if (!Array.isArray(answer) || answer.length < min || answer.length > max ||
      answer.some((ref, index) => !isRef(ref) || !refs.some(option => sameRef(option, ref)) ||
        answer.slice(0, index).some(previous => sameRef(previous, ref)))) {
    throw new TypeError("Invalid effect.heal choice answer");
  }
  return answer;
}

export default {
  op: "effect.heal",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const selected = args.objects === undefined ? { kind: "source" } as const : selection(ctx.evaluate(args.objects));
    let refs = candidates(ctx, selected);
    if (selected.kind === "target" && refs.length === 0) {
      return { status: "ignored", reason: "mistargeted" };
    }
    const amount = args.amount === undefined ? undefined : ctx.evaluate(args.amount);
    const linkKey = args.linkKey === undefined ? "healed" : ctx.evaluate(args.linkKey);
    if (amount !== undefined && !isAmount(amount)) {
      throw new TypeError("effect.heal amount must be a nonnegative safe integer");
    }
    if (!isId(linkKey)) throw new TypeError("effect.heal linkKey must be a nonempty string");
    const events: GameEvent[] = [];
    const healed: Value[] = [];
    let total = 0;
    let reason: "replaced" | "skipped" | "impossible" | undefined;
    if (amount !== 0) {
      if (refs.length === 0 && selected.kind !== "query" &&
          (selected.kind !== "choose" || selected.min > 0)) reason = "impossible";
      if (selected.kind === "choose") refs = chooseRefs(ctx, selected, refs);
      for (const ref of refs) {
        const before = ctx.object(ref);
        if (before?.zone !== "board" || !before.types.includes("unit")) {
          reason ??= "impossible";
          continue;
        }
        if (before.damage === 0) continue;
        const outcome = ctx.perform({ type: "heal", object: ref, amount: amount ?? before.damage });
        events.push(...outcome.events);
        if (outcome.status !== "done") {
          reason ??= outcome.status === "prevented" ? "skipped" : outcome.status;
          continue;
        }
        // The action result is authoritative; older kernels may only expose snapshots.
        const actual = outcome.result === undefined ?
          Math.max(0, before.damage - (ctx.object(ref)?.damage ?? before.damage)) : outcome.result;
        if (!isAmount(actual)) throw new TypeError("effect.heal action result must be a nonnegative safe integer");
        if (actual > 0) {
          total += actual;
          healed.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
        }
      }
    }
    const value: Value = { amount: total, count: healed.length, objects: healed };
    ctx.link(linkKey, value);
    return reason ? { status: "negated", reason, events } :
      { status: "executed", events, linkedValues: { [linkKey]: value } };
  }
} satisfies InstructionDef<EffectHealArgs>;

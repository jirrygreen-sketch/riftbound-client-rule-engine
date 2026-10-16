/**
 * Effect discard, CR v1.5 423.1-5, 359.3.e.5-8 and 359.3.e.11.
 * All args are Expr values evaluated at resolution:
 * - amount (required): a nonnegative safe integer, or "all" for the whole hand
 *   or explicit selection. Zero performs no action and links a zero count.
 * - player: the discarding player, default ctx.controller. Only their Hand is
 *   eligible; the discard GameAction routes cards to their owner's Trash.
 * - target / pick: mutually exclusive TargetSpec / PickSpec ids. Resolve only
 *   through ctx.targets / ctx.picks. These supply already chosen cards; an
 *   amount caps them in selection order. Stale refs and duplicates are dropped.
 *   Ordinary private Hand choices are non-targeting (355.10.a); target is only
 *   for an explicit selection whose legality the interpreter has established.
 * - choiceId: stable replay id for an ordinary Hand choice; defaults to
 *   "effect.discard:" plus player. Supply an instruction-specific id when an
 *   ability has several choices. If more cards are available than required,
 *   that player chooses exactly the required count, visibility chooser-only
 *   (423.1.a). No prompt is needed when all available cards must be discarded.
 * - linkKey: defaults to "discarded"; stores { count, objects, player }, where
 *   objects are the successful pre-discard refs (for last-known information).
 *   Actual partial results are linked even when the instruction is negated.
 *
 * Effects discard as much as possible; an unmet positive count is negated
 * (423.4). Invalid targets are removed, and all targets lost means ignored;
 * surviving targets still resolve (359.3.e.7-8). Empty/stale non-target picks
 * cannot cause mistargeting. Any replaced/prevented/impossible action negates
 * the instruction, but remaining cards are still attempted. Prevented maps to
 * skipped; the first unsuccessful action determines the reason.
 *
 * This is not cost.discard: costs require full payment (423.3). It submits
 * discard, never move-zone, kill, banish, mill, pay, or play. Discard triggers
 * (including ogn-006-298 and ogn-202-298) belong to the kernel's event/chain
 * pipeline after the action (423.1.b); no printed abilities are executed here.
 * All reads/writes use ResolveContext; no priority, random, or state mutation.
 */
import type {
  Expr, GameEvent, InstructionDef, ObjectRef, ResolveContext, Value
} from "../contract.js";

export interface EffectDiscardArgs {
  readonly amount: Expr;
  readonly player?: Expr;
  readonly target?: Expr;
  readonly pick?: Expr;
  readonly choiceId?: Expr;
  readonly linkKey?: Expr;
}

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

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value) || !isValue(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value;
    case "linked": case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "object-property": return isRef(value.object) && isId(value.property);
    case "object-attribute": return isRef(value.object) && isId(value.attribute);
    case "count": return isId(value.subject) && (value.filter === undefined || isRecord(value.filter));
    case "arithmetic": {
      if (!Array.isArray(value.operands) || !value.operands.every(isExpr)) return false;
      const count = value.operands.length;
      switch (value.operator) {
        case "add": case "mul": case "multiply": case "min": case "max": return count > 0;
        case "sub": case "subtract": case "div": case "divide": return count === 2;
        case "neg": return count === 1;
        default: return false;
      }
    }
    default: return false;
  }
}

function parseArgs(value: unknown): EffectDiscardArgs {
  if (!isRecord(value) || !isExpr(value.amount)) {
    throw new TypeError("effect.discard requires an amount Expr");
  }
  const keys = ["amount", "player", "target", "pick", "choiceId", "linkKey"];
  for (const [key, expression] of Object.entries(value)) {
    if (!keys.includes(key) || !isExpr(expression)) {
      throw new TypeError("Invalid effect.discard argument: " + key);
    }
  }
  if (value.target !== undefined && value.pick !== undefined) {
    throw new TypeError("effect.discard target and pick are mutually exclusive");
  }
  return value as unknown as EffectDiscardArgs;
}

function idValue(ctx: ResolveContext, expr: Expr | undefined, fallback: string): string {
  const value = expr === undefined ? fallback : ctx.evaluate(expr);
  if (!isId(value)) throw new TypeError("effect.discard expected a nonempty string");
  return value;
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function handRefs(ctx: ResolveContext, values: readonly unknown[], player: string): ObjectRef[] {
  const refs: ObjectRef[] = [];
  for (const value of values) {
    if (!isRef(value) || refs.some(ref => sameRef(ref, value))) continue;
    const object = ctx.object(value);
    if (object?.zone === "hand" && object.owner === player) {
      refs.push({ id: value.id, zoneEntryId: value.zoneEntryId });
    }
  }
  return refs;
}

export default {
  op: "effect.discard",
  argsSchema: { parse: parseArgs },
  execute(ctx, args) {
    const player = idValue(ctx, args.player, ctx.controller);
    const linkKey = idValue(ctx, args.linkKey, "discarded");
    const choiceId = idValue(ctx, args.choiceId, "effect.discard:" + player);
    const amount = ctx.evaluate(args.amount);
    if (amount !== "all" && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) {
      throw new TypeError("effect.discard amount must be a nonnegative safe integer or all");
    }
    const target = args.target === undefined ? undefined : idValue(ctx, args.target, "");
    const pick = args.pick === undefined ? undefined : idValue(ctx, args.pick, "");
    const explicit = target !== undefined || pick !== undefined;
    const values = target !== undefined ? ctx.targets(target) : pick !== undefined ? ctx.picks(pick) :
      ctx.zoneSlice(player, "hand", "top").map(object => object.ref);
    const refs = handRefs(ctx, values, player);
    if (target !== undefined && refs.length === 0) return { status: "ignored", reason: "mistargeted" };

    const requested = amount === "all" ? refs.length : amount;
    const count = Math.min(requested, refs.length);
    let selected = refs.slice(0, count);
    if (!explicit && count > 0 && count < refs.length) {
      const answer = ctx.choose<readonly ObjectRef[]>({
        id: choiceId, type: "select-objects", chooser: player,
        visibility: "chooser-only", options: refs, min: count, max: count
      });
      if (!Array.isArray(answer) || answer.length !== count ||
          answer.some((ref, index) => !isRef(ref) || !refs.some(candidate => sameRef(candidate, ref)) ||
            answer.slice(0, index).some(previous => sameRef(previous, ref)))) {
        throw new TypeError("effect.discard choice must contain exactly the required distinct Hand cards");
      }
      // A selection is a set; preserve Hand order regardless of answer order.
      selected = refs.filter(ref => answer.some(chosen => sameRef(ref, chosen)));
    }

    const events: GameEvent[] = [];
    const discarded: ObjectRef[] = [];
    let reason: "replaced" | "skipped" | "impossible" | undefined;
    for (const object of selected) {
      const outcome = ctx.perform({ type: "discard", object });
      events.push(...outcome.events);
      if (outcome.status === "done") discarded.push(object);
      else reason ??= outcome.status === "replaced" ? "replaced" :
        outcome.status === "prevented" ? "skipped" : "impossible";
    }
    // Invalid targets do not prevent the remaining valid targets resolving.
    if (target === undefined && requested > refs.length) reason ??= "impossible";
    const value: Value = {
      count: discarded.length, player,
      objects: discarded.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }))
    };
    ctx.link(linkKey, value);
    return reason ? { status: "negated", reason, events } :
      { status: "executed", events, linkedValues: { [linkKey]: value } };
  }
} satisfies InstructionDef<EffectDiscardArgs>;

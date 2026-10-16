/**
 * Attach/re-attach non-Units to a Unit (CR v1.5 435.1, 435.1.f-i, 435.3-4).
 * All arguments are card-dsl Expr values. `objects` (default: source) and the
 * required `host` evaluate to { kind: "source" }, { kind: "target", id },
 * { kind: "pick", id }, or { kind: "choose", id, filter }. Target ids are
 * TargetSpec ids read only through targets(); picks are non-target selections.
 * A choose selector queries current Board objects and requests an exact public
 * selection, using its id as the stable replay request id and the ability
 * controller as chooser. Host selection must yield exactly one current Unit.
 * `amount` is a nonnegative integer upper bound (default 1); when fewer objects
 * exist, attach as many as possible. `linkKey` defaults to "attached" and stores
 * { count, objects, host }, including actual partial results on negation.
 *
 * Target filters own card-specific control/location restrictions (e.g. Equip's
 * controlled-Unit target, 818.1.b.1 and 818.1.c.2). Attach does not itself target
 * or change control (435.3, 718.5.e-f). The attach GameAction owns re-attachment
 * and co-location (435.1.f, 435.4); no separate detach/move/control action is
 * submitted. An already attached object has no effect (435.1.g/i). Explicit
 * detachment belongs to effect.detach; host exit and becoming a Unit belong to
 * kernel state checks (719.5, 718.6.a). Effect text, Might bonuses, and their
 * lifetimes belong to continuous layers (435.1.c-e, 718.2-4, 719.1), including
 * Shady Spectacles' copy effect; this primitive only establishes the attachment.
 */
import type {
  Expr, GameEvent, InstructionDef, InstructionResult, ObjectFilter, ObjectRef,
  ResolveContext, Value
} from "../contract.js";

export interface AttachArgs {
  readonly objects?: Expr;
  readonly host: Expr;
  readonly amount?: Expr;
  readonly linkKey?: Expr;
}

type Selection =
  | { readonly kind: "source" }
  | { readonly kind: "target"; readonly id: string }
  | { readonly kind: "pick"; readonly id: string }
  | { readonly kind: "choose"; readonly id: string; readonly filter: ObjectFilter };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValue(value: unknown, ancestors = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) &&
    (value.zoneEntryId as number) >= 0;
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return "value" in value && isValue(value.value);
    case "object-property": return isRef(value.object) && isId(value.property);
    case "object-attribute": return isRef(value.object) && isId(value.attribute);
    case "linked": case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count":
      return isId(value.subject) && (value.filter === undefined ||
        isRecord(value.filter) && isValue(value.filter));
    default: return false;
  }
}

function parseArgs(value: unknown): AttachArgs {
  if (!isRecord(value) || !isExpr(value.host)) throw new TypeError("effect.attach requires a host Expr");
  const keys = ["objects", "host", "amount", "linkKey"];
  for (const [key, expression] of Object.entries(value)) {
    if (!keys.includes(key) || !isExpr(expression)) {
      throw new TypeError(`Invalid effect.attach argument: ${key}`);
    }
  }
  return value as unknown as AttachArgs;
}

function selection(value: Value): Selection {
  if (isRecord(value)) {
    if (value.kind === "source") return { kind: "source" };
    if ((value.kind === "target" || value.kind === "pick") && isId(value.id)) {
      return { kind: value.kind, id: value.id };
    }
    if (value.kind === "choose" && isId(value.id) && isRecord(value.filter) && isValue(value.filter)) {
      return { kind: "choose", id: value.id, filter: value.filter };
    }
  }
  throw new TypeError("effect.attach selection must name source, target, pick, or choose");
}

function sameRef(left: ObjectRef | null, right: ObjectRef): boolean {
  return left?.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function currentRefs(ctx: ResolveContext, selected: Selection, role: "objects" | "host"): ObjectRef[] {
  const values = selected.kind === "source" ? [ctx.source.ref] :
    selected.kind === "target" ? ctx.targets(selected.id) :
      selected.kind === "pick" ? ctx.picks(selected.id) :
        ctx.query(selected.filter).filter(object => role === "host" ?
          object.types.includes("unit") : !object.types.includes("unit")).map(object => object.ref);
  const refs: ObjectRef[] = [];
  for (const value of values) {
    if (isRef(value) && ctx.object(value)?.zone === "board" &&
        !refs.some(ref => sameRef(ref, value))) refs.push(value);
  }
  if (selected.kind === "choose") {
    refs.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 :
      left.zoneEntryId - right.zoneEntryId);
  }
  return refs;
}

function chooseRefs(ctx: ResolveContext, selected: Selection, refs: ObjectRef[], amount: number): ObjectRef[] {
  const count = Math.min(amount, refs.length);
  if (selected.kind !== "choose" || count === 0) return refs.slice(0, count);
  const answer = ctx.choose<readonly ObjectRef[]>({
    id: selected.id, type: "select-objects", chooser: ctx.controller,
    visibility: "public", options: refs, min: count, max: count
  });
  if (!Array.isArray(answer) || answer.length !== count || answer.some((ref, index) =>
    !isRef(ref) || !refs.some(option => sameRef(option, ref)) ||
    answer.slice(0, index).some(previous => sameRef(previous, ref)))) {
    throw new TypeError("Invalid effect.attach choice answer");
  }
  return answer;
}

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

const attach = {
  op: "effect.attach",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const objects = args.objects ? selection(ctx.evaluate(args.objects)) : { kind: "source" } as const;
    const host = selection(ctx.evaluate(args.host));
    const amount = args.amount ? ctx.evaluate(args.amount) : 1;
    const linkKey = args.linkKey ? ctx.evaluate(args.linkKey) : "attached";
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError("effect.attach amount must be a nonnegative safe integer");
    }
    if (!isId(linkKey)) throw new TypeError("effect.attach linkKey must be a nonempty string");
    const objectRefs = currentRefs(ctx, objects, "objects");
    const hostRefs = currentRefs(ctx, host, "host");
    if ((objects.kind === "target" || host.kind === "target") &&
        (objects.kind !== "target" || objectRefs.length === 0) &&
        (host.kind !== "target" || hostRefs.length === 0)) {
      return { status: "ignored", reason: "mistargeted" };
    }
    const events: GameEvent[] = [];
    const attached: ObjectRef[] = [];
    let selectedHost: ObjectRef | null = null;
    let reason: "replaced" | "impossible" | undefined;
    if (amount > 0) {
      if ((host.kind !== "choose" && hostRefs.length !== 1) || hostRefs.length === 0 || objectRefs.length === 0) {
        reason = "impossible";
      } else {
        selectedHost = chooseRefs(ctx, host, hostRefs, 1)[0]!;
        for (const object of chooseRefs(ctx, objects, objectRefs, amount)) {
          if (sameRef(ctx.object(object)?.attachedTo ?? null, selectedHost)) continue;
          const outcome = ctx.perform({ type: "attach", object, host: selectedHost });
          events.push(...outcome.events);
          if (outcome.status !== "done") {
            reason ??= outcome.status === "replaced" ? "replaced" : "impossible";
          } else if (sameRef(ctx.object(object)?.attachedTo ?? null, selectedHost)) {
            attached.push(object);
          }
        }
      }
    }
    const value: Value = {
      count: attached.length, objects: attached.map(refValue),
      host: selectedHost ? refValue(selectedHost) : null
    };
    ctx.link(linkKey, value);
    return reason ? { status: "negated", reason, events } :
      { status: "executed", events, linkedValues: { [linkKey]: value } };
  }
} satisfies InstructionDef<AttachArgs>;

export default attach;

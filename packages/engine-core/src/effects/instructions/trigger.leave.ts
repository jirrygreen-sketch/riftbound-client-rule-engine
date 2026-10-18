import type {
  Expr, GameEvent, InstructionDef, ObjectSnapshot, ObjectRef, ResolveContext, Schema, Value
} from "../contract.js";

/**
 * The resolve-time boundary for a leave trigger.
 *
 * A Deathknell subscription is collected from the `object-killed` event while
 * the source still has its Board incarnation.  The pending item resolves
 * later, after that incarnation has left the Board.  This primitive checks
 * that boundary and publishes the immutable source information that a
 * following Deathknell body may consume.  It deliberately performs no game
 * action: subscription/collection belongs to EventPipeline, while settlement
 * remains the following instruction body.
 */

export interface LeaveArgs {
  readonly cause: Expr;
  readonly destination?: Expr;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExpr(value: unknown, active = new Set<object>()): value is Expr {
  if (!isRecord(value) || active.has(value)) return false;
  active.add(value);
  let valid: boolean;
  switch (value.kind) {
    case "constant":
    case "literal":
      valid = Object.hasOwn(value, "value");
      break;
    case "linked":
    case "linked-value":
      valid = typeof value.instructionId === "string" &&
        (value.key === undefined || typeof value.key === "string");
      break;
    case "object-property":
    case "object-attribute":
      valid = isRecord(value.object) && typeof value.property === "string" ||
        isRecord(value.object) && typeof value.attribute === "string";
      break;
    case "count":
      valid = typeof value.subject === "string";
      break;
    case "arithmetic":
      valid = typeof value.operator === "string" && Array.isArray(value.operands) &&
        value.operands.length > 0 && value.operands.every(operand => isExpr(operand, active));
      break;
    default:
      valid = false;
      break;
  }
  active.delete(value);
  return valid;
}

function parseArgs(value: unknown): LeaveArgs {
  if (!isRecord(value)) throw new TypeError("trigger.leave args must be an object");
  // `resolveChainBody` preserves Expr nodes for primitive schemas.  Accepting
  // an already evaluated string as well keeps the definition usable by the
  // lower-level interpreter harness, whose registry dispatches evaluated args.
  const cause = isExpr(value.cause)
    ? value.cause
    : typeof value.cause === "string"
      ? { kind: "constant" as const, value: value.cause }
      : undefined;
  if (cause === undefined) throw new TypeError("trigger.leave requires a cause Expr");
  const destination = isExpr(value.destination)
    ? value.destination
    : typeof value.destination === "string"
      ? { kind: "constant" as const, value: value.destination }
      : value.destination === undefined
        ? undefined
        : null;
  if (destination === null) {
    throw new TypeError("trigger.leave destination must be an Expr");
  }
  return {
    cause,
    ...(destination === undefined ? {} : { destination })
  };
}

const argsSchema: Schema<LeaveArgs> = { parse: parseArgs };

function refValue(ref: ObjectRef): Value {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function snapshotValue(snapshot: ObjectSnapshot): Value {
  return structuredClone(snapshot) as unknown as Value;
}

function negated(reason: "impossible" | "replaced" = "impossible"): {
  readonly status: "negated";
  readonly reason: "impossible" | "replaced" | "skipped";
  readonly events: GameEvent[];
} {
  return { status: "negated", reason, events: [] };
}

function ignored(): { readonly status: "ignored"; readonly reason: "mistargeted" } {
  return { status: "ignored", reason: "mistargeted" };
}

function currentIncarnations(ctx: ResolveContext, source: ObjectSnapshot): readonly ObjectSnapshot[] {
  // ObjectFilter's objectId anchor is the only query that can inspect a newer
  // incarnation after the old zone-bound ref became stale.
  return ctx.query({ objectId: source.ref.id });
}

const triggerLeave: InstructionDef<LeaveArgs> = {
  op: "trigger.leave",
  argsSchema,
  execute(ctx, args) {
    let cause: Value;
    let destination: Value = "trash";
    try {
      cause = ctx.evaluate(args.cause);
      if (args.destination !== undefined) destination = ctx.evaluate(args.destination);
    } catch {
      return negated();
    }

    // Deathknell is the only executable leave body in this batch.  Keep other
    // causes explicitly blocked instead of assigning them plausible semantics.
    if (cause !== "kill" || destination !== "trash") return negated();
    // A production Pending Item resolves at `chain-item-resolve`; the
    // reference primitive harness commonly invokes the same boundary with the
    // originating `object-killed` timing point.
    if (ctx.timingPoint !== "object-killed" && ctx.timingPoint !== "chain-item-resolve") return ignored();
    if (ctx.source.zone !== "board") return ignored();

    // A trigger resolves against the source's old incarnation.  If that exact
    // ref is still live, the leave has not happened; if a newer incarnation is
    // present outside Trash, the pending trigger has gone stale or was
    // replaced.  Tokens may cease to exist after a kill, so absence is allowed.
    if (ctx.object(ctx.source.ref) !== null) return ignored();
    const current = currentIncarnations(ctx, ctx.source);
    if (current.length > 0 && !current.some(object => object.zone === "trash")) return ignored();

    const lastKnown = ctx.lastKnown(ctx.source.ref);
    if (lastKnown.ref.zoneEntryId !== ctx.source.ref.zoneEntryId || lastKnown.zone !== "board") return ignored();

    const linkedValues: Record<string, Value> = {
      leave: refValue(ctx.source.ref),
      leaveSource: snapshotValue(lastKnown),
      leaveCause: cause,
      leaveDestination: destination,
      left: true
    };
    for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);
    return { status: "executed", events: [], linkedValues };
  }
};

export default triggerLeave;

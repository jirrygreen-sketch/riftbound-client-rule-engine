import type { Expr } from "@riftbound/card-dsl";
import type { InstructionDef, ObjectRef, Schema, Value } from "../contract.js";

/**
 * Counter a spell or ability represented by a legal Chain target.
 *
 * `target` is the id of the instruction's TargetSpec and is resolved with
 * `ctx.targets()`. `amount` is an Expr and defaults to one. When the target
 * set contains more legal objects than `amount`, the primitive asks the
 * controller to choose exactly that many objects; this is a non-target
 * selection made with `ctx.choose()` over the already legal target set.
 *
 * Countering follows Core Rules v1.5 426.1-426.3: a countered card or ability
 * does nothing, is cleared from the Chain, and does not refund any cost. The
 * target legality and pending-item checks belong to target resolution under
 * 329.1-329.3 and 359.3.e.1-359.3.e.6. This primitive only rechecks that the
 * locked ObjectRef is still current, so an invalid or zone-changed reference
 * is ignored. Unlike effect.zone it does not move arbitrary objects, and
 * unlike effect.damage it does not apply a value to a target.
 */

export interface EffectCounterArgs {
  readonly target: string;
  readonly amount: Expr;
}

const DEFAULT_AMOUNT: Expr = { kind: "constant", value: 1 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string" && [
    "constant",
    "literal",
    "object-property",
    "object-attribute",
    "linked-value",
    "linked",
    "count"
  ].includes(value.kind);
}

function parseAmount(value: unknown): Expr {
  if (value === undefined) return DEFAULT_AMOUNT;
  if (typeof value === "number") return { kind: "constant", value };
  if (isExpr(value)) return value;
  throw new TypeError("effect.counter amount must be an Expr or number");
}

function parseArgs(value: unknown): EffectCounterArgs {
  if (!isRecord(value)) throw new TypeError("effect.counter args must be an object");

  const target = value.target ?? value.targetSpec ?? value.targetSpecId;
  if (typeof target !== "string" || target.length === 0) {
    throw new TypeError("effect.counter requires a target TargetSpec id");
  }

  return { target, amount: parseAmount(value.amount) };
}

function referenceKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === "string" && Number.isInteger(value.zoneEntryId);
}

function asObjectRefs(value: unknown): ObjectRef[] | null {
  if (isObjectRef(value)) return [value];
  if (!Array.isArray(value) || !value.every(isObjectRef)) return null;
  return value;
}

function negated(
  status: "replaced" | "prevented" | "impossible",
  events: readonly import("@riftbound/protocol").GameEvent[]
): ReturnType<InstructionDef<EffectCounterArgs>["execute"]> {
  return {
    status: "negated",
    reason: status === "replaced" ? "replaced" : "impossible",
    events: [...events]
  };
}

const argsSchema: Schema<EffectCounterArgs> = { parse: parseArgs };

const counter = {
  op: "effect.counter",
  argsSchema,
  execute(ctx, args) {
    const legalTargets = [...new Map(
      ctx.targets(args.target)
        .filter((ref) => ctx.object(ref)?.zone === "chain")
        .map((ref) => [referenceKey(ref), ref] as const)
    ).values()];

    if (legalTargets.length === 0) return { status: "ignored", reason: "mistargeted" };

    const evaluatedAmount = ctx.evaluate(args.amount);
    if (typeof evaluatedAmount !== "number" || !Number.isSafeInteger(evaluatedAmount) || evaluatedAmount < 0) {
      return negated("impossible", []);
    }

    const count = Math.min(evaluatedAmount, legalTargets.length);
    if (count === 0) {
      const linkedValues = { countered: 0 as Value, counteredObjects: [] as Value[] };
      ctx.link("countered", linkedValues.countered);
      ctx.link("counteredObjects", linkedValues.counteredObjects);
      return { status: "executed", events: [], linkedValues };
    }

    let selected = legalTargets.slice(0, count);
    if (legalTargets.length > count) {
      const answer = ctx.choose({
        id: `effect.counter:${args.target}`,
        type: "select-objects",
        options: legalTargets,
        min: count,
        max: count,
        chooser: ctx.controller,
        visibility: "public"
      });
      const chosen = asObjectRefs(answer);
      if (!chosen || chosen.length !== count) return negated("impossible", []);
      const available = new Set(legalTargets.map(referenceKey));
      const unique = new Set(chosen.map(referenceKey));
      if (unique.size !== chosen.length || chosen.some((ref) => !available.has(referenceKey(ref)))) {
        return negated("impossible", []);
      }
      selected = chosen;
    }

    const events: import("@riftbound/protocol").GameEvent[] = [];
    const counteredObjects: Value[] = [];
    for (const object of selected) {
      const outcome = ctx.perform({ type: "counter", object });
      events.push(...outcome.events);
      if (outcome.status !== "done") return negated(outcome.status, events);
      counteredObjects.push({ id: object.id, zoneEntryId: object.zoneEntryId });
    }

    const linkedValues = { countered: counteredObjects.length as Value, counteredObjects };
    ctx.link("countered", linkedValues.countered);
    ctx.link("counteredObjects", linkedValues.counteredObjects);
    return { status: "executed", events, linkedValues };
  }
} satisfies InstructionDef<EffectCounterArgs>;

export default counter;

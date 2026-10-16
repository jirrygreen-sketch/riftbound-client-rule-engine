import type { Expr } from "@riftbound/card-dsl";
import type {
  ChoiceVisibility,
  GameEvent,
  InstructionDef,
  LocationRef,
  ObjectRef,
  ResolveContext,
  ZoneDestination
} from "../contract.js";

/**
 * Moves the selected objects through the closed GameAction vocabulary.
 *
 * `target` names a finalized TargetSpec and is resolved with `ctx.targets()`;
 * `pick` names a non-target PickSpec and is resolved with `ctx.picks()`.
 * Exactly one is required. `amount`, `to`, and `location` are Expr values,
 * evaluated during resolution. `choice` is an optional non-target mode choice
 * for the destination and is resolved with `ctx.choose()` when `to` is absent.
 * A missing amount means all selected objects; an amount larger than the
 * available selection moves as many as possible, while zero moves none.
 *
 * This boundary follows Core Rules v1.5 §§055, 056, 124, 128, 355.7,
 * 355.9.a, 359.3.e.5–6, 359.3.e.9–14: it performs already selected moves,
 * preserves owner-zone routing in the action layer, and never exposes hidden
 * information or uses last-known information to revive an invalid reference.
 * A move to or from a non-Board zone creates a new object identity (§124), so
 * stale zoneEntryId references are ignored. `effect.zone` does not reveal or
 * inspect private cards, does not decide ownership, and does not replace the
 * distinct targeting semantics of `target.query`; use `effect.draw`,
 * `effect.recycle`, `effect.banish`, or movement-specific primitives when the
 * card text calls for their narrower operation.
 */

export interface EffectZoneChoice {
  readonly id: string;
  readonly options: readonly ZoneDestination[];
  readonly chooser?: string;
  readonly visibility?: ChoiceVisibility;
  readonly prompt?: string;
}

export interface EffectZoneArgs {
  readonly target?: string;
  readonly pick?: string;
  readonly amount?: Expr;
  readonly to?: Expr;
  readonly location?: Expr;
  readonly choice?: EffectZoneChoice;
}

const DESTINATIONS: readonly ZoneDestination[] = [
  "hand",
  "deck-top",
  "deck-bottom",
  "trash",
  "banishment",
  "base",
  "battlefield",
  "rune-deck",
  "rune-zone",
  "chain"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

function isDestination(value: unknown): value is ZoneDestination {
  return typeof value === "string" && DESTINATIONS.includes(value as ZoneDestination);
}

function parseArgs(value: unknown): EffectZoneArgs {
  if (!isRecord(value)) throw new TypeError("effect.zone args must be an object");

  const target = value.target;
  const pick = value.pick;
  if ((target === undefined) === (pick === undefined)) {
    throw new TypeError("effect.zone requires exactly one of target or pick");
  }
  if (target !== undefined && typeof target !== "string") {
    throw new TypeError("effect.zone target must be a TargetSpec id");
  }
  if (pick !== undefined && typeof pick !== "string") {
    throw new TypeError("effect.zone pick must be a PickSpec id");
  }

  const amount = value.amount;
  if (amount !== undefined && !isExpr(amount)) throw new TypeError("effect.zone amount must be an Expr");

  const to = value.to;
  if (to !== undefined && !isExpr(to)) throw new TypeError("effect.zone to must be an Expr");

  const location = value.location;
  if (location !== undefined && !isExpr(location)) throw new TypeError("effect.zone location must be an Expr");

  const choice = value.choice;
  if (to === undefined && !isRecord(choice)) {
    throw new TypeError("effect.zone requires to or choice");
  }
  if (to !== undefined && choice !== undefined) {
    throw new TypeError("effect.zone accepts only one of to or choice");
  }
  if (choice !== undefined) {
    if (!isRecord(choice) || typeof choice.id !== "string" || !Array.isArray(choice.options) ||
      choice.options.length === 0 || !choice.options.every(isDestination)) {
      throw new TypeError("effect.zone choice must contain a non-empty destination options list");
    }
    if (choice.chooser !== undefined && typeof choice.chooser !== "string") {
      throw new TypeError("effect.zone choice chooser must be a player id");
    }
    if (choice.visibility !== undefined && choice.visibility !== "public" &&
      choice.visibility !== "chooser-only" && !Array.isArray(choice.visibility)) {
      throw new TypeError("effect.zone choice visibility is invalid");
    }
  }

  return value as EffectZoneArgs;
}

function selectedObjects(ctx: ResolveContext, args: EffectZoneArgs): ObjectRef[] {
  const selected = args.target !== undefined ? ctx.targets(args.target) : ctx.picks(args.pick!);
  const seen = new Set<string>();
  const objects: ObjectRef[] = [];
  for (const candidate of selected) {
    if (typeof candidate !== "object" || candidate === null ||
      typeof candidate.id !== "string" || typeof candidate.zoneEntryId !== "number") continue;
    const ref = candidate as ObjectRef;
    const key = `${ref.id}:${ref.zoneEntryId}`;
    if (seen.has(key) || ctx.object(ref) === null) continue;
    seen.add(key);
    objects.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
  }
  return objects;
}

function evaluateDestination(ctx: ResolveContext, args: EffectZoneArgs): ZoneDestination {
  if (args.to !== undefined) {
    const destination = ctx.evaluate(args.to);
    if (!isDestination(destination)) throw new TypeError(`effect.zone evaluated invalid destination: ${String(destination)}`);
    return destination;
  }
  const choice = args.choice!;
  const selected = ctx.choose<ZoneDestination>({
    id: choice.id,
    type: "mode",
    options: choice.options,
    chooser: choice.chooser ?? ctx.controller,
    visibility: choice.visibility ?? "public",
    prompt: choice.prompt
  });
  if (!choice.options.includes(selected)) {
    throw new TypeError(`effect.zone choice returned an unavailable destination: ${String(selected)}`);
  }
  return selected;
}

function evaluateAmount(ctx: ResolveContext, args: EffectZoneArgs, available: number): number {
  if (args.amount === undefined) return available;
  const amount = ctx.evaluate(args.amount);
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) {
    throw new RangeError("effect.zone amount must evaluate to a non-negative integer");
  }
  return Math.min(Math.trunc(amount), available);
}

function evaluateLocation(ctx: ResolveContext, expression: Expr | undefined): LocationRef | undefined {
  if (expression === undefined) return undefined;
  const value = ctx.evaluate(expression);
  if (!isRecord(value) || (value.type !== "base" && value.type !== "battlefield")) {
    throw new TypeError("effect.zone location must evaluate to a base or battlefield LocationRef");
  }
  if (value.type === "base" && typeof value.player !== "string") {
    throw new TypeError("effect.zone base location requires a player");
  }
  if (value.type === "battlefield" && typeof value.id !== "string") {
    throw new TypeError("effect.zone battlefield location requires an id");
  }
  return value as LocationRef;
}

function actionFor(ctx: ResolveContext, destination: ZoneDestination, object: ObjectRef, location: LocationRef | undefined) {
  if (destination === "hand") return { type: "return-to-hand" as const, object };
  if (destination === "deck-bottom") return { type: "recycle" as const, object };
  if (destination === "banishment") return { type: "banish" as const, object };
  if (destination === "base" || destination === "battlefield") {
    const current = ctx.object(object);
    if (current?.zone === "board") {
      const boardLocation = location ?? (destination === "base"
        ? { type: "base" as const, player: current.controller }
        : undefined);
      if (boardLocation === undefined) throw new RangeError("effect.zone battlefield movement requires a location");
      return { type: "move-location" as const, object, to: boardLocation };
    }
    return { type: "move-zone" as const, object, to: destination, ...(location === undefined ? {} : { location }) };
  }
  return { type: "move-zone" as const, object, to: destination };
}

function negated(reason: "replaced" | "prevented" | "impossible", events: readonly GameEvent[]) {
  return {
    status: "negated" as const,
    reason: reason === "replaced" ? "replaced" as const : "impossible" as const,
    events: [...events]
  };
}

export default {
  op: "effect.zone",
  argsSchema: { parse: parseArgs },
  execute(ctx: ResolveContext, args: EffectZoneArgs) {
    const objects = selectedObjects(ctx, args);
    if (objects.length === 0) return { status: "ignored", reason: "mistargeted" };

    let destination: ZoneDestination;
    let location: LocationRef | undefined;
    let amount: number;
    try {
      destination = evaluateDestination(ctx, args);
      location = evaluateLocation(ctx, args.location);
      amount = evaluateAmount(ctx, args, objects.length);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        return negated("impossible", []);
      }
      throw error;
    }

    const chosen = objects.slice(0, amount);
    const events: GameEvent[] = [];
    const movedIds: string[] = [];
    for (const object of chosen) {
      let outcome;
      try {
        outcome = ctx.perform(actionFor(ctx, destination, object, location));
      } catch (error) {
        if (error instanceof RangeError) return negated("impossible", events);
        throw error;
      }
      events.push(...outcome.events);
      if (outcome.status !== "done") return negated(outcome.status, events);
      movedIds.push(object.id);
    }

    const moved = movedIds.length;
    ctx.link("moved", moved);
    ctx.link("movedIds", movedIds);
    ctx.link("destination", destination);
    return {
      status: "executed",
      events: [...events],
      linkedValues: { moved, movedIds, destination }
    };
  }
} satisfies InstructionDef<EffectZoneArgs>;

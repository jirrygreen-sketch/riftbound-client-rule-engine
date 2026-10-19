import type { Expr } from "@riftbound/card-dsl";
import type {
  ChoiceVisibility,
  GameEvent,
  InstructionDef,
  LocationRef,
  ObjectFilter,
  ObjectRef,
  ResolveContext,
  Value,
  ZoneDestination
} from "../contract.js";

/**
 * Moves the selected objects through the closed GameAction vocabulary.
 *
 * `objects` accepts the established source/self, finalized target, non-target
 * pick, linked collection, and current-query selection shapes. The legacy
 * `target` and `pick` arguments remain supported. Exactly one selection form
 * is required. `amount`, `to`, and `location` are Expr values,
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
 *
 * Legacy `target`/`pick` calls retain their original receipt exactly:
 * `moved`, `movedIds`, and `destination`. Calls through the additive `objects`
 * selector also expose `movedObjects` with the post-action current references.
 */

export interface EffectZoneChoice {
  readonly id: string;
  readonly options: readonly ZoneDestination[];
  readonly chooser?: string;
  readonly visibility?: ChoiceVisibility;
  readonly prompt?: string;
}

export interface EffectZoneArgs {
  readonly objects?: Expr;
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

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.zoneEntryId === "number" && Number.isSafeInteger(value.zoneEntryId) &&
    value.zoneEntryId >= 0;
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

function isDestination(value: unknown): value is ZoneDestination {
  return typeof value === "string" && DESTINATIONS.includes(value as ZoneDestination);
}

function parseArgs(value: unknown): EffectZoneArgs {
  if (!isRecord(value)) throw new TypeError("effect.zone args must be an object");

  let objects: Expr | undefined;
  if (value.objects !== undefined) {
    if (isExpr(value.objects)) objects = value.objects;
    else if (isValue(value.objects)) objects = { kind: "constant", value: value.objects };
    else throw new TypeError("effect.zone objects must be a card-dsl Expr or evaluated value");
  }
  const target = value.target;
  const pick = value.pick;
  if ([objects, target, pick].filter(item => item !== undefined).length !== 1) {
    throw new TypeError("effect.zone requires exactly one of objects, target, or pick");
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

  return {
    ...(objects === undefined ? {} : { objects }),
    ...(target === undefined ? {} : { target } as { target: string }),
    ...(pick === undefined ? {} : { pick } as { pick: string }),
    ...(amount === undefined ? {} : { amount }),
    ...(to === undefined ? {} : { to }),
    ...(location === undefined ? {} : { location }),
    ...(choice === undefined ? {} : { choice: choice as unknown as EffectZoneChoice })
  };
}

type Selection =
  | { readonly kind: "self" | "source" }
  | { readonly kind: "target" | "pick" | "linked"; readonly id: string }
  | { readonly kind: "query"; readonly filter: ObjectFilter };

function selection(value: unknown): Selection {
  if (value === "self") return { kind: "self" };
  if (value === "source") return { kind: "source" };
  if (!isRecord(value)) throw new TypeError("effect.zone objects must evaluate to a supported selector");
  if (Object.keys(value).length === 1) {
    for (const kind of ["target", "pick", "linked"] as const) {
      if (typeof value[kind] === "string" && value[kind].length > 0) return { kind, id: value[kind] };
    }
  }
  if (value.kind === "source" && Object.keys(value).length === 1) return { kind: "source" };
  if ((value.kind === "target" || value.kind === "pick" || value.kind === "linked") &&
      typeof value.id === "string" && value.id.length > 0 && Object.keys(value).length === 2) {
    return { kind: value.kind, id: value.id };
  }
  if (value.kind === "query" && isRecord(value.filter) && isValue(value.filter)) {
    return { kind: "query", filter: value.filter };
  }
  throw new TypeError("effect.zone objects must evaluate to self/source, target, pick, linked, or query");
}

function currentQueryRef(ctx: ResolveContext, object: ObjectRef): ObjectRef | null {
  const current = ctx.query({}).find(candidate => candidate.ref.id === object.id);
  return current === undefined ? null : { ...current.ref };
}

function linkedRefs(value: Value | undefined): ObjectRef[] {
  if (Array.isArray(value)) return value.filter(isRef);
  if (isRef(value)) return [value];
  if (isRecord(value) && Array.isArray(value.objects)) return value.objects.filter(isRef);
  return [];
}

function selectedObjects(ctx: ResolveContext, args: EffectZoneArgs): {
  refs: ObjectRef[];
  target: boolean;
  staleInput: boolean;
  legacyPick: boolean;
  includeReceipt: boolean;
} {
  const selected: Selection = args.objects === undefined
    ? args.target !== undefined
      ? { kind: "target", id: args.target }
      : { kind: "pick", id: args.pick! }
    : selection(ctx.evaluate(args.objects));
  let values: readonly unknown[];
  switch (selected.kind) {
    case "self": values = [ctx.source.ref]; break;
    case "source": values = [ctx.source.ref]; break;
    case "target": values = ctx.targets(selected.id); break;
    case "pick": values = ctx.picks(selected.id); break;
    case "linked": values = linkedRefs(ctx.linked(selected.id)); break;
    case "query": values = ctx.query(selected.filter).map(object => object.ref); break;
  }
  const seen = new Set<string>();
  const refs: ObjectRef[] = [];
  for (const candidate of values) {
    if (!isRef(candidate) || ctx.object(candidate) === null) continue;
    const key = `${candidate.id}:${candidate.zoneEntryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ id: candidate.id, zoneEntryId: candidate.zoneEntryId });
  }
  const staleInput = values.length > 0 && refs.length === 0;
  return {
    refs,
    target: selected.kind === "target",
    staleInput,
    legacyPick: args.objects === undefined && args.pick !== undefined,
    includeReceipt: args.objects !== undefined
  };
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

function negated(reason: "replaced" | "impossible", events: readonly GameEvent[]) {
  return {
    status: "negated" as const,
    reason,
    events: [...events]
  };
}

export default {
  op: "effect.zone",
  argsSchema: { parse: parseArgs },
  execute(ctx: ResolveContext, args: EffectZoneArgs) {
    const selected = selectedObjects(ctx, args);
    if (selected.refs.length === 0 && (selected.target || selected.staleInput || selected.legacyPick)) {
      return { status: "ignored", reason: "mistargeted" };
    }

    let destination: ZoneDestination;
    let location: LocationRef | undefined;
    let amount: number;
    try {
      destination = evaluateDestination(ctx, args);
      location = evaluateLocation(ctx, args.location);
      amount = evaluateAmount(ctx, args, selected.refs.length);
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        return negated("impossible", []);
      }
      throw error;
    }

    const chosen = selected.refs.slice(0, amount);
    const events: GameEvent[] = [];
    const movedIds: string[] = [];
    const movedObjects: Value[] = [];
    let failure: "replaced" | "impossible" | undefined;
    for (const object of chosen) {
      let outcome;
      try {
        outcome = ctx.perform(actionFor(ctx, destination, object, location));
      } catch (error) {
        if (error instanceof RangeError) {
          failure ??= "impossible";
          continue;
        }
        throw error;
      }
      events.push(...outcome.events);
      if (outcome.status !== "done") {
        failure ??= outcome.status === "replaced" ? "replaced" : "impossible";
        continue;
      }
      movedIds.push(object.id);
      const current = currentQueryRef(ctx, object);
      if (current) movedObjects.push({ id: current.id, zoneEntryId: current.zoneEntryId });
    }

    const moved = movedIds.length;
    ctx.link("moved", moved);
    ctx.link("movedIds", movedIds);
    ctx.link("destination", destination);
    if (selected.includeReceipt) ctx.link("movedObjects", movedObjects);
    if (failure) return negated(failure, events);
    return {
      status: "executed",
      events: [...events],
      linkedValues: { moved, movedIds, destination, ...(selected.includeReceipt ? { movedObjects } : {}) }
    };
  }
} satisfies InstructionDef<EffectZoneArgs>;

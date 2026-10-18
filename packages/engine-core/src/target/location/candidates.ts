import type { LocationFilter, LocationRef, LocationTargetSpec } from "@riftbound/card-dsl";
import type { ObjectRef, ObjectSnapshot, PlayerId, ResolveContext } from "../../effects/contract.js";
import type { LayeredObjectSnapshot } from "../../layers/types.js";
import { movement } from "../../layers/rules/query.js";
import { sameLocation, locationKey, locationOfObject } from "./ref.js";
import type { LocationCandidateOptions, LocationState } from "./types.js";

function matchesPlayer(actual: PlayerId | null | undefined, expected: unknown, controller: PlayerId): boolean {
  if (expected === "controller" || expected === "self") return actual === controller;
  if (expected === "opponent") return typeof actual === "string" && actual !== controller;
  if (expected === "uncontrolled" || expected === null) return actual === null;
  return typeof expected === "string" && actual === expected;
}

function stateFor(ref: LocationRef, context: ResolveContext, options: LocationCandidateOptions): LocationState {
  const occupants = context.query({ zone: "board" }).filter(object => object.location !== null && sameLocation(object.location, ref));
  const units = occupants.filter(object => object.types.includes("unit")).map(object => object.ref);
  const locationObject = context.query({ zone: "board", type: ref.type }).find(object => sameLocation(locationOfObject(object), ref));
  const derived: LocationState = {
    ref,
    owner: ref.type === "base" ? ref.player : locationObject?.owner,
    controller: ref.type === "base" ? ref.player : locationObject?.controller ?? null,
    occupied: units.length > 0,
    units
  };
  const supplied = options.locations?.find(item => sameLocation(item.ref, ref));
  return supplied === undefined ? derived : {
    ...derived,
    ...supplied,
    units: supplied.units ?? derived.units
  };
}

function allRefs(context: ResolveContext, options: LocationCandidateOptions): LocationRef[] {
  const explicit = options.locations?.map(item => item.ref) ?? [];
  const objects = context.query({ zone: "board" });
  // A Battlefield is itself a Location, even when no Permanent occupies it.
  // Its identity is independent of the Battlefield card's zone-entry identity.
  const fromObjects = objects.flatMap(object => {
    const location = locationOfObject(object);
    return location === null ? [] : [location];
  });
  const players = new Set([
    context.controller, context.source.owner, context.source.controller,
    ...(options.players ?? []), ...(options.opponent === undefined ? [] : [options.opponent]),
    ...context.query({}).flatMap(object => [object.owner, object.controller])
  ]);
  const bases = [...players].map(player => ({ type: "base", player } as const));
  const unique = new Map<string, LocationRef>();
  for (const ref of [...explicit, ...fromObjects, ...bases]) unique.set(locationKey(ref), ref);
  return [...unique.values()];
}

function matchesFilter(state: LocationState, filter: LocationFilter | LocationTargetSpec, context: ResolveContext): boolean {
  const supported = ["type", "kind", "occupied", "hasUnits", "open", "controlled", "contested", "player", "owner", "controller", "unitController", "id", "min", "max", "selection"];
  for (const key of Object.keys(filter)) {
    if (!supported.includes(key)) throw new TypeError(`Unsupported location filter: ${key}`);
  }
  const controller = state.controller ?? null;
  const occupied = state.occupied ?? (state.units?.length ?? 0) > 0;
  const controlled = state.ref.type === "base" ? true : controller !== null;
  const open = state.ref.type === "battlefield" && !occupied && !controlled;
  const expectedType = filter.type ?? filter.kind;
  if (expectedType !== undefined && expectedType !== "any" && state.ref.type !== expectedType) return false;
  if (filter.occupied !== undefined && occupied !== filter.occupied) return false;
  if (filter.hasUnits !== undefined && occupied !== filter.hasUnits) return false;
  if (filter.open !== undefined && open !== filter.open) return false;
  if (filter.controlled !== undefined && controlled !== filter.controlled) return false;
  if (filter.contested !== undefined && (state.contested ?? false) !== filter.contested) return false;
  if (filter.player !== undefined) {
    if (!matchesPlayer(state.ref.type === "base" ? state.ref.player : controller, filter.player, context.controller)) return false;
  }
  if (filter.owner !== undefined) {
    if (!matchesPlayer(state.owner ?? (state.ref.type === "base" ? state.ref.player : undefined), filter.owner, context.controller)) return false;
  }
  if (filter.controller !== undefined) {
    if (!matchesPlayer(controller, filter.controller, context.controller)) return false;
  }
  if (filter.unitController !== undefined) {
    if (!(state.units ?? []).some(ref => {
      const unit = context.object(ref);
      return unit?.zone === "board" && unit.types.includes("unit") && sameLocation(unit.location, state.ref) &&
        matchesPlayer(unit.controller, filter.unitController, context.controller);
    })) return false;
  }
  return true;
}

/** Read existing permissions; effect Moves do not require Standard Move routes (451.1). */
function allowsMove(object: ObjectSnapshot, destination: LocationRef, context: ResolveContext, options: LocationCandidateOptions): boolean {
  if (object.zone !== "board" || object.location === null || sameLocation(object.location, destination) ||
      !object.types.some(type => type === "unit" || type === "gear")) return false;
  const permissions = (object as Partial<LayeredObjectSnapshot>).movement;
  if (permissions?.allowed === false || permissions?.canMove === false ||
      permissions?.restrictions.some(restriction => ["cannot-move", "move", "all-movement"].includes(restriction))) return false;
  if (options.registry && !movement(options.registry, object.ref, object, object.controller).allowed) return false;
  if (destination.type === "base") return destination.player === object.controller;
  // CR 451.2: an effect cannot move a Unit into two other players' Units.
  const others = new Set(context.query({ zone: "board", type: "unit" })
    .filter(unit => sameLocation(unit.location, destination) && unit.controller !== object.controller)
    .map(unit => unit.controller));
  return !object.types.includes("unit") || others.size < 2;
}

/** Return all locations visible to the resolving context that satisfy a location target. */
export function queryLocationCandidates(
  context: ResolveContext,
  requirement: LocationTargetSpec | LocationFilter = {},
  options: LocationCandidateOptions = {}
): readonly LocationRef[] {
  const excluded = new Set((options.exclude ?? []).map(locationKey));
  if (options.current) excluded.add(locationKey(options.current));
  const moving = options.moving?.map(ref => context.object(ref));
  if (moving?.some(object => object === null)) return [];
  return allRefs(context, options)
    .filter(ref => !excluded.has(locationKey(ref)))
    .filter(ref => moving === undefined || moving.every(object => object !== null && allowsMove(object, ref, context, options)))
    .map(ref => ({ ref, state: stateFor(ref, context, options) }))
    .filter(item => matchesFilter(item.state, requirement, context))
    .map(item => item.ref);
}

/** Common destinations for a locked Move selection, preserving every zone-entry identity. */
export function queryMoveDestinations(
  context: ResolveContext,
  objects: readonly ObjectRef[],
  requirement: LocationFilter | LocationTargetSpec = {},
  options: LocationCandidateOptions = {}
): readonly LocationRef[] {
  if (objects.length === 0) return [];
  return queryLocationCandidates(context, requirement, { ...options, moving: objects });
}

export function isLegalLocation(
  context: ResolveContext,
  ref: LocationRef,
  requirement: LocationFilter | LocationTargetSpec = {},
  options: LocationCandidateOptions = {}
): boolean {
  return queryLocationCandidates(context, requirement, options).some(candidate => sameLocation(candidate, ref));
}

import type { LocationFilter, LocationRef, LocationTargetSpec } from "@riftbound/card-dsl";
import type { ObjectSnapshot, PlayerId, ResolveContext } from "../../effects/contract.js";
import { sameLocation, locationKey } from "./ref.js";
import type { LocationCandidateOptions, LocationState } from "./types.js";

function opponentOf(controller: PlayerId, options: LocationCandidateOptions): PlayerId | undefined {
  if (options.opponent !== undefined) return options.opponent;
  return options.players?.find(player => player !== controller);
}

function relationPlayer(value: unknown, controller: PlayerId, options: LocationCandidateOptions): PlayerId | null | undefined {
  if (value === "controller" || value === "self") return controller;
  if (value === "opponent") return opponentOf(controller, options);
  if (value === "uncontrolled") return null;
  return typeof value === "string" ? value : undefined;
}

function stateFor(ref: LocationRef, context: ResolveContext, options: LocationCandidateOptions): LocationState {
  const occupants = context.query({ zone: "board" }).filter(object => object.location !== null && sameLocation(object.location, ref));
  const units = occupants.filter(object => object.types.includes("unit")).map(object => object.ref);
  const locationObject = context.query({ type: ref.type }).find(object => object.location === null && (
    ref.type === "battlefield" ? object.ref.id === ref.id : object.controller === ref.player
  ));
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
  const fromObjects = context.query({}).flatMap(object => object.location === null ? [] : [object.location]);
  const bases = (options.players ?? [context.controller, ...(options.opponent ? [options.opponent] : [])]).map(player => ({ type: "base", player } as const));
  const unique = new Map<string, LocationRef>();
  for (const ref of [...explicit, ...fromObjects, ...bases]) unique.set(locationKey(ref), ref);
  return [...unique.values()];
}

function matchesFilter(state: LocationState, filter: LocationFilter | LocationTargetSpec, context: ResolveContext, options: LocationCandidateOptions): boolean {
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
    const player = relationPlayer(filter.player, context.controller, options);
    if (state.ref.type === "base" ? state.ref.player !== player : controller !== player) return false;
  }
  if (filter.owner !== undefined) {
    const owner = relationPlayer(filter.owner, context.controller, options);
    if ((state.owner ?? (state.ref.type === "base" ? state.ref.player : undefined)) !== owner) return false;
  }
  if (filter.controller !== undefined) {
    const expected = relationPlayer(filter.controller, context.controller, options);
    if (controller !== expected) return false;
  }
  return true;
}

/** Return all locations visible to the resolving context that satisfy a location target. */
export function queryLocationCandidates(
  context: ResolveContext,
  requirement: LocationTargetSpec | LocationFilter = {},
  options: LocationCandidateOptions = {}
): readonly LocationRef[] {
  const excluded = new Set((options.exclude ?? []).map(locationKey));
  return allRefs(context, options)
    .filter(ref => !excluded.has(locationKey(ref)))
    .map(ref => ({ ref, state: stateFor(ref, context, options) }))
    .filter(item => matchesFilter(item.state, requirement, context, options))
    .map(item => item.ref);
}

export function isLegalLocation(
  context: ResolveContext,
  ref: LocationRef,
  requirement: LocationFilter | LocationTargetSpec = {},
  options: LocationCandidateOptions = {}
): boolean {
  return queryLocationCandidates(context, requirement, options).some(candidate => sameLocation(candidate, ref));
}

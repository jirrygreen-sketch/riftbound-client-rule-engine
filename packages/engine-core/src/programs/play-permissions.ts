/**
 * Queries and predicates for the two kinds of Play permission that are
 * independent from a card's printed cost:
 *
 *  - a permission can add a source zone for one or more specific cards; and
 *  - a permission can add a location matching a board-state predicate.
 *
 * The registry is deliberately read-only here.  Effects register an entry
 * through ResolveContext.addContinuous; Finalize and other action owners call
 * these helpers with the current snapshots.  A permission never revives an
 * old ObjectRef and never turns an unknown location predicate into a match.
 */
import type { LocationFilter, LocationRef } from "@riftbound/card-dsl";
import type { ContinuousEffectRegistry } from "../layers/duration.js";
import type { RegisteredContinuousEffect } from "../layers/types.js";
import type { LocationState } from "../target/location/types.js";
import type { ObjectRef, ObjectSnapshot, PlayerId, ZoneId } from "../effects/contract.js";
import { sameLocation } from "../target/location/ref.js";

type AnyRecord = Record<string, unknown>;

export interface PlayPermissionSpec {
  readonly kind?: "play-permission" | "location" | "play-location-permission";
  readonly objectRefs?: readonly ObjectRef[];
  readonly zone?: ZoneId | readonly ZoneId[];
  readonly player?: PlayerId;
  readonly payCosts?: boolean;
  readonly location?: LocationFilter;
  readonly locations?: LocationFilter;
  readonly permission?: string | LocationFilter;
}

export interface PlayPermissionQuery {
  readonly source: ObjectRef;
  readonly objectRefs: readonly ObjectRef[];
  readonly zones: readonly ZoneId[];
  readonly payCosts: boolean;
  readonly location?: LocationFilter;
  readonly player?: PlayerId;
  readonly duration: RegisteredContinuousEffect["duration"];
}

export interface LocationPermissionContext {
  readonly player: PlayerId;
  readonly state?: LocationState;
  readonly objects?: readonly ObjectSnapshot[];
}

const ZONES = new Set<ZoneId>([
  "hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain",
]);

function record(value: unknown): AnyRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as AnyRecord : null;
}

function sameRef(left: unknown, right: ObjectRef): boolean {
  const value = record(left);
  return value?.id === right.id && value?.zoneEntryId === right.zoneEntryId;
}

function refs(value: unknown): readonly ObjectRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ObjectRef => {
    const ref = record(item);
    return typeof ref?.id === "string" && Number.isSafeInteger(ref?.zoneEntryId);
  }).map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

function zones(value: unknown): readonly ZoneId[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.filter((item): item is ZoneId => typeof item === "string" && ZONES.has(item as ZoneId));
}

function effectKind(entry: RegisteredContinuousEffect): string {
  return String(record(entry.effect.effect)?.kind ?? "").toLowerCase();
}

function effectValue(entry: RegisteredContinuousEffect): AnyRecord {
  return record(entry.effect.effect) ?? {};
}

function locationSpec(effect: AnyRecord): LocationFilter | undefined {
  const value = effect.location ?? effect.locations ?? effect.permission;
  const candidate = record(value);
  if (candidate === null) return undefined;
  const allowed = new Set([
    "type", "kind", "player", "owner", "controller", "occupied", "open", "controlled",
    "contested", "hasUnits", "unitController", "id",
  ]);
  if (Object.keys(candidate).some(key => !allowed.has(key))) return undefined;
  return candidate as LocationFilter;
}

/*
 * Static play-location permissions are authored as an EffectIR
 * `{ kind: 'constant', value: { zone, battlefield, appliesTo } }` wrapper.  The
 * static binder preserves that wrapper under `effect.value`; unlike the
 * instruction primitive it deliberately does not flatten the expression.  A
 * missing or malformed wrapper stays unknown rather than becoming an
 * unrestricted battlefield permission (CR v1.5 355.2.b, 355.3).
 */
function staticLocationSpec(effect: AnyRecord): LocationFilter | undefined {
  const wrapper = record(effect.value);
  if (wrapper === null || !['constant', 'literal'].includes(String(wrapper.kind))) return undefined;
  const authored = record(wrapper.value);
  if (authored === null) return undefined;
  const zone = authored.zone;
  if (zone !== 'battlefield' && zone !== 'base') return undefined;
  const battlefield = record(authored.battlefield);
  if (zone === 'battlefield' && battlefield === null) return undefined;
  const candidate = {
    type: zone,
    ...(battlefield ?? {}),
  };
  const allowed = new Set([
    "type", "kind", "player", "owner", "controller", "occupied", "open", "controlled",
    "contested", "hasUnits", "unitController", "id",
  ]);
  if (Object.keys(candidate).some(key => !allowed.has(key))) return undefined;
  return candidate as LocationFilter;
}

function queryEntry(entry: RegisteredContinuousEffect): PlayPermissionQuery | null {
  const effect = effectValue(entry);
  const objectRefs = refs(effect.objectRefs ?? effect.objects ?? entry.effect.filter.objectRefs);
  const zonesValue = zones(effect.zone ?? effect.zones);
  const location = locationSpec(effect) ?? staticLocationSpec(effect);
  if (effectKind(entry) === "play-permission") {
    if (objectRefs.length === 0 || zonesValue.length === 0) return null;
    return {
      source: entry.effect.source ?? { id: "unknown", zoneEntryId: 0 },
      objectRefs,
      zones: zonesValue,
      payCosts: effect.payCosts !== false,
      ...(location === undefined ? {} : { location }),
      ...(typeof effect.player === "string" ? { player: effect.player } : {}),
      duration: entry.duration,
    };
  }
  // A continuous.location registration may carry the structured 355.2.b
  // predicate.  String labels stay in layers/rules/query.ts for compatibility.
  if ((effectKind(entry) === "location" || effectKind(entry) === "play-location-permission") &&
      location !== undefined && objectRefs.length > 0) {
    return {
      source: entry.effect.source ?? { id: "unknown", zoneEntryId: 0 },
      objectRefs,
      zones: zones(effect.zone ?? "hand"),
      payCosts: true,
      location,
      duration: entry.duration,
    };
  }
  return null;
}

/** Return active, well-formed Play permissions for a candidate object. */
export function playPermissions(
  registry: ContinuousEffectRegistry,
  object: ObjectSnapshot | ObjectRef | null | undefined,
): readonly PlayPermissionQuery[] {
  if (object === null || object === undefined) return Object.freeze([]);
  const ref = "ref" in object ? object.ref : object;
  const snapshot = "ref" in object ? object : undefined;
  const result: PlayPermissionQuery[] = [];
  for (const entry of registry.list()) {
    const query = queryEntry(entry);
    if (query === null || !query.objectRefs.some(candidate => sameRef(candidate, ref))) continue;
    if (snapshot !== undefined && query.zones.length > 0 && !query.zones.includes(snapshot.zone)) continue;
    result.push(query);
  }
  return Object.freeze(result);
}

/** Whether a card can be played from a given zone under the registry. */
export function canPlayFromZone(
  registry: ContinuousEffectRegistry,
  object: ObjectSnapshot | ObjectRef | null | undefined,
  zone: ZoneId,
): boolean {
  return playPermissions(registry, object).some(permission => permission.zones.includes(zone));
}

function playerMatches(expected: unknown, actual: PlayerId | null | undefined, player: PlayerId): boolean {
  if (expected === undefined || expected === "any") return true;
  if (expected === "controller" || expected === "self") return actual === player;
  if (expected === "opponent") return actual !== null && actual !== undefined && actual !== player;
  if (expected === "uncontrolled" || expected === null) return actual === null;
  return actual === expected;
}

/**
 * Evaluate an open/occupied/controlled destination predicate.  A missing
 * LocationState is not enough evidence for a match, so the function fails
 * closed.  `unitController` additionally requires the authoritative object
 * snapshots for the units in that location.
 */
export function locationPermissionMatches(
  filter: LocationFilter | undefined,
  destination: LocationRef,
  context: LocationPermissionContext,
): boolean {
  if (filter === undefined) return true;
  const state = context.state;
  if (state === undefined || !sameLocation(state.ref, destination)) return false;
  const expectedType = filter.type ?? filter.kind;
  if (expectedType !== undefined && expectedType !== "any" && expectedType !== destination.type) return false;
  const occupied = state.occupied === true || (state.units?.length ?? 0) > 0;
  const controlled = state.controller !== undefined && state.controller !== null;
  const open = destination.type === "battlefield" && !occupied && !controlled;
  if (filter.occupied !== undefined && occupied !== filter.occupied) return false;
  if (filter.hasUnits !== undefined && occupied !== filter.hasUnits) return false;
  if (filter.open !== undefined && open !== filter.open) return false;
  if (filter.controlled !== undefined && controlled !== filter.controlled) return false;
  if (filter.contested !== undefined && (state.contested ?? false) !== filter.contested) return false;
  if (!playerMatches(filter.player, destination.type === "base" ? destination.player : state.controller, context.player)) return false;
  if (!playerMatches(filter.owner, state.owner ?? (destination.type === "base" ? destination.player : undefined), context.player)) return false;
  if (!playerMatches(filter.controller, state.controller, context.player)) return false;
  if (filter.unitController !== undefined) {
    if (state.units === undefined || context.objects === undefined) return false;
    const units = state.units.map(ref => context.objects!.find(object => sameRef(object.ref, ref))).filter((object): object is ObjectSnapshot => object !== undefined);
    if (units.length !== state.units.length || !units.some(unit => playerMatches(filter.unitController, unit.controller, context.player))) return false;
  }
  if (filter.id !== undefined && destination.type !== "battlefield" ||
      filter.id !== undefined && destination.type === "battlefield" && filter.id !== destination.id) return false;
  return true;
}

/** Check both the specific-object permission and its optional location scope. */
export function playPermissionAllows(
  registry: ContinuousEffectRegistry,
  object: ObjectSnapshot,
  destination?: LocationRef,
  context?: Omit<LocationPermissionContext, "player"> & { readonly player?: PlayerId },
): boolean {
  const player = context?.player ?? object.controller;
  return playPermissions(registry, object).some(permission =>
    (destination === undefined || permission.location === undefined || locationPermissionMatches(
      permission.location, destination, { player, state: context?.state, objects: context?.objects },
    )) && (permission.player === undefined || permission.player === player)
  );
}

export function isPlayPermissionEffect(value: unknown): value is PlayPermissionSpec {
  const item = record(value);
  return item !== null && (item.kind === "play-permission" || item.kind === "location");
}


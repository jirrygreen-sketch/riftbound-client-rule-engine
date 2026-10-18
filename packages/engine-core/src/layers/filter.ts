import type { ObjectFilter, ObjectRef } from "@riftbound/card-dsl";
import { matchesObjectPredicates, type FilterMatchContext } from "../effects/filters/predicates.js";
import type { LayeredObjectSnapshot } from "./types.js";
import { isRelativeLocation } from "./relative/location.js";
import type { RelativeFilterAnchor } from "./relative/types.js";
import {
  matchesRelativeController,
  matchesRelativeExclusion,
  matchesRelativeLocation,
  matchesRelativeOwner,
  matchesRelativePosition,
  matchesRelativeRegion,
  filterAnchor,
} from "./relative/filter.js";

type FilterValue = unknown;
type AnyRecord = Record<string, unknown>;

function list(value: FilterValue): readonly FilterValue[] | null {
  return Array.isArray(value) ? value : null;
}

function typeMatches(value: FilterValue, object: LayeredObjectSnapshot): boolean {
  if (value === undefined) return true;
  const values = list(value) ?? [value];
  return values.some(item => item === "object" || item === object.types[0] || object.types.includes(String(item)) || (item === "token" && object.isToken));
}

function zoneMatches(value: FilterValue, object: LayeredObjectSnapshot): boolean {
  if (value === undefined) return true;
  const values = list(value) ?? [value];
  return values.some(item => item === object.zone || (item === "discard" && object.zone === "trash") || (item === "banish" && object.zone === "banishment"));
}

function stateMatches(value: FilterValue, object: LayeredObjectSnapshot): boolean {
  if (value === undefined) return true;
  const values = list(value) ?? [value];
  return values.every(item => item === "ready" ? !object.exhausted : item === "exhausted" ? object.exhausted :
    item === "stunned" ? object.stunned : item === "attached" ? object.attachedTo !== null :
    item === "face-down" ? object.faceDown : false);
}

function characteristicsMatch(value: FilterValue, object: LayeredObjectSnapshot): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
  return Object.entries(value as Record<string, unknown>).every(([key, expected]) => {
    const actual = object[key as keyof LayeredObjectSnapshot] as unknown;
    if (Array.isArray(expected)) return expected.includes(actual as never);
    return actual === expected;
  });
}

function legacyPlayerMatches(value: unknown, actual: string, controller: string): boolean {
  if (value === undefined || value === "any") return true;
  if (value === "self") return actual === controller;
  if (value === "opponent") return actual !== controller;
  if (typeof value === "object" && value !== null && "playerId" in value) return (value as AnyRecord).playerId === actual;
  return value === actual;
}

export interface ObjectFilterMatchContext extends FilterMatchContext {
  /** Explicit compatibility entry for the historical unanchored matcher. */
  readonly legacy?: boolean;
}

function legacyMatchesObjectFilter(value: AnyRecord, object: LayeredObjectSnapshot): boolean {
  const objectId = value.objectId ?? value.id;
  if (objectId !== undefined && objectId !== object.ref.id) return false;
  const cardId = value.cardId ?? value.canonicalCardId;
  if (cardId !== undefined && cardId !== object.cardId) return false;
  if (!typeMatches(value.type ?? value.types, object)) return false;
  if (!zoneMatches(value.zone, object)) return false;
  if (value.location !== undefined && value.location !== object.location && object.location?.type !== value.location) return false;
  if (!legacyPlayerMatches(value.controller, object.controller, object.controller)) return false;
  if (!legacyPlayerMatches(value.owner, object.owner, object.controller)) return false;
  if (!stateMatches(value.states ?? value.state, object)) return false;
  if (value.tags !== undefined) {
    const tags = list(value.tags) ?? [value.tags];
    if (!tags.every(tag => object.tags.includes(String(tag)))) return false;
  }
  return characteristicsMatch(value.characteristics, object);
}

function literal(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const item = value as AnyRecord;
  return item.kind === "constant" || item.kind === "literal" ? literal(item.value) : value;
}

/**
 * Match shared object predicates plus static source-relative fields. Accepts
 * both a query context and the original direct-host/null argument. A bound
 * static filter always resolves its live host, even when a caller supplies an
 * older snapshot in its context. Historical matching is available explicitly
 * with { legacy: true }; ordinary queries use the shared strict predicates.
 */
export function matchesObjectFilter(
  filter: ObjectFilter | Record<string, unknown>,
  object: LayeredObjectSnapshot,
  contextOrAnchor?: ObjectFilterMatchContext | RelativeFilterAnchor | null,
): boolean {
  if (!filter || typeof filter !== "object") return true;
  let context: ObjectFilterMatchContext = contextOrAnchor !== null && contextOrAnchor !== undefined && "ref" in contextOrAnchor
    ? { anchor: contextOrAnchor, controller: contextOrAnchor.controller }
    : contextOrAnchor ?? { anchor: contextOrAnchor };
  const resolveAnchor = filterAnchor(filter);
  if (resolveAnchor !== undefined) {
    const anchor = resolveAnchor();
    if (anchor === null) return false;
    context = { ...context, anchor, controller: anchor.controller };
  } else if (context.legacy === true) {
    return legacyMatchesObjectFilter(filter as AnyRecord, object);
  }

  const value = filter as AnyRecord;
  const anchor = context.anchor;
  // An explicitly missing host must not fall back to the predicate matcher's
  // unanchored legacy spelling of self. A controller-only query is sufficient
  // for player predicates, but not for location or incarnation comparisons.
  if (contextOrAnchor !== undefined && context.controller === undefined && anchor == null) {
    if (!matchesRelativeController(value.controller, object.controller, anchor)) return false;
    if (!matchesRelativeOwner(value.owner, object.owner, anchor)) return false;
  }
  // Unanchored candidate queries leave selector constraints to their caller
  // (for example TargetPlan); explicit contexts and bound statics enforce them.
  if (contextOrAnchor !== undefined || resolveAnchor !== undefined) {
    if (!matchesRelativeRegion(value.region, object)) return false;
    if (!matchesRelativePosition(value.position, object, anchor)) return false;
    if (value.here !== undefined && value.here !== true) return false;
    if (value.here === true && !matchesRelativePosition("here", object, anchor)) return false;
    if (!matchesRelativePosition(value.sameLocationAs, object, anchor)) return false;
    if (!matchesRelativeExclusion(value.exclude, object, anchor)) return false;
    // The shared cost predicate also uses `other` as a comparison selector.
    // Preserve that spelling while retaining source-relative `other` filters.
    if (value.printedCostNoMoreThanKilledUnit === undefined || typeof literal(value.other) === "boolean") {
      if (!matchesRelativeExclusion(value.other, object, anchor)) return false;
    }
  }

  const location = literal(value.location);
  if (isRelativeLocation(location) || typeof location === "string") {
    if (!matchesRelativeLocation(location, object, anchor)) return false;
    return matchesObjectPredicates({ ...value, location: undefined }, object, context);
  }
  return matchesObjectPredicates(filter, object, context);
}

export function objectRefFrom(value: unknown): ObjectRef | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.zoneEntryId === "number"
    ? { id: candidate.id, zoneEntryId: candidate.zoneEntryId }
    : null;
}

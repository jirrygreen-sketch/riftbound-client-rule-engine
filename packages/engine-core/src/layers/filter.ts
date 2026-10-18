import type { ObjectFilter, ObjectRef } from "@riftbound/card-dsl";
import type { LayeredObjectSnapshot } from "./types.js";
import type { RelativeFilterAnchor } from "./relative/types.js";
import {
  matchesRelativeController,
  matchesRelativeExclusion,
  matchesRelativeLocation,
  matchesRelativeOwner,
  matchesRelativePosition,
  matchesRelativeRegion,
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

function keywordMatches(value: FilterValue, object: LayeredObjectSnapshot): boolean {
  if (value === undefined) return true;
  const values = list(value) ?? [value];
  return values.every(item => object.keywords.some(keyword => keyword.id === String(item)));
}

/**
 * Match an engine ObjectFilter. Relative fields are evaluated against the
 * optional static-ability host supplied by the layer engine. Callers that do
 * not have a host retain the historical self/opponent behavior for simple
 * filters, while host-relative anchors fail closed when no host exists.
 */
export function matchesObjectFilter(
  filter: ObjectFilter | Record<string, unknown>,
  object: LayeredObjectSnapshot,
  anchor?: RelativeFilterAnchor | null,
): boolean {
  if (!filter || typeof filter !== "object") return true;
  const value = filter as AnyRecord;
  const objectId = value.objectId ?? value.id;
  if (objectId !== undefined && objectId !== object.ref.id) return false;
  const zoneEntryId = value.zoneEntryId;
  if (zoneEntryId !== undefined && zoneEntryId !== object.ref.zoneEntryId) return false;
  const cardId = value.cardId ?? value.canonicalCardId;
  if (cardId !== undefined && cardId !== object.cardId) return false;
  if (!typeMatches(value.type ?? value.types, object)) return false;
  if (!zoneMatches(value.zone, object)) return false;
  if (value.location !== undefined && !matchesRelativeLocation(value.location, object, anchor)) return false;
  if (value.region !== undefined && !matchesRelativeRegion(value.region, object)) return false;
  if (value.position !== undefined && anchor !== undefined && anchor !== null && !matchesRelativePosition(value.position, object, anchor)) return false;
  if (value.here !== undefined && value.here !== true) return false;
  // Without an anchor the caller has no way to resolve relative fields, so the
  // historical behavior skips them instead of failing the whole filter.
  if (anchor !== undefined && anchor !== null) {
    if (value.here === true && !matchesRelativePosition("here", object, anchor)) return false;
    if (value.sameLocationAs !== undefined && !matchesRelativePosition(value.sameLocationAs, object, anchor)) return false;
  }
  if (!matchesRelativeController(value.controller, object.controller, anchor)) return false;
  if (!matchesRelativeOwner(value.owner, object.owner, anchor)) return false;
  if (anchor !== undefined && anchor !== null) {
    if (!matchesRelativeExclusion(value.exclude, object, anchor)) return false;
    if (!matchesRelativeExclusion(value.other, object, anchor)) return false;
  }
  if (!stateMatches(value.states ?? value.state, object)) return false;
  if (value.tags !== undefined) {
    const tags = list(value.tags) ?? [value.tags];
    if (!tags.every(tag => object.tags.includes(String(tag)))) return false;
  }
  if (!keywordMatches(value.keyword ?? value.keywords ?? value.hasKeyword, object)) return false;
  if (!characteristicsMatch(value.characteristics, object)) return false;
  return true;
}

export function objectRefFrom(value: unknown): ObjectRef | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.zoneEntryId === "number"
    ? { id: candidate.id, zoneEntryId: candidate.zoneEntryId }
    : null;
}

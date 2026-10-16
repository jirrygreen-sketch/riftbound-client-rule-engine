import type { ObjectFilter, ObjectRef } from "@riftbound/card-dsl";
import type { LayeredObjectSnapshot } from "./types.js";

type FilterValue = unknown;

function list(value: FilterValue): readonly FilterValue[] | null {
  return Array.isArray(value) ? value : null;
}

function selectorMatches(value: FilterValue, actual: string, owner: string): boolean {
  if (value === undefined) return true;
  if (value === "any") return true;
  if (value === "self") return actual === owner;
  if (value === "opponent") return actual !== owner;
  if (typeof value === "object" && value !== null && "playerId" in value) {
    return (value as { playerId: unknown }).playerId === actual;
  }
  return value === actual;
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

/** Matches both the engine's JSON ObjectFilter and the richer trigger filter spelling. */
export function matchesObjectFilter(filter: ObjectFilter | Record<string, unknown>, object: LayeredObjectSnapshot): boolean {
  if (!filter || typeof filter !== "object") return true;
  const value = filter as Record<string, unknown>;
  const objectId = value.objectId ?? value.id;
  if (objectId !== undefined && objectId !== object.ref.id) return false;
  const cardId = value.cardId ?? value.canonicalCardId;
  if (cardId !== undefined && cardId !== object.cardId) return false;
  if (!typeMatches(value.type ?? value.types, object)) return false;
  if (!zoneMatches(value.zone, object)) return false;
  if (value.location !== undefined && value.location !== object.location &&
      (typeof object.location !== "object" || object.location === null || object.location.type !== value.location)) return false;
  if (!selectorMatches(value.controller, object.controller, object.controller)) return false;
  if (!selectorMatches(value.owner, object.owner, object.controller)) return false;
  if (!stateMatches(value.states ?? value.state, object)) return false;
  if (value.tags !== undefined) {
    const tags = list(value.tags) ?? [value.tags];
    if (!tags.every(tag => object.tags.includes(String(tag)))) return false;
  }
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

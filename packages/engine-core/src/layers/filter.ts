import type { ObjectFilter, ObjectRef } from "@riftbound/card-dsl";
import type { LayeredObjectSnapshot } from "./types.js";
import { matchesObjectPredicates, type FilterMatchContext } from "../effects/filters/predicates.js";

/** Matches both the engine's JSON ObjectFilter and the richer trigger filter spelling. */
export function matchesObjectFilter(
  filter: ObjectFilter | Record<string, unknown>,
  object: LayeredObjectSnapshot,
  context: FilterMatchContext = {},
): boolean {
  return matchesObjectPredicates(filter, object, context);
}

export function objectRefFrom(value: unknown): ObjectRef | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.zoneEntryId === "number"
    ? { id: candidate.id, zoneEntryId: candidate.zoneEntryId }
    : null;
}

import type { ObjectFilter, ObjectRef } from "@riftbound/card-dsl";
import type { LayeredObjectSnapshot } from "../types.js";
import type { RelativeFilterAnchor } from "./types.js";
import { concreteLocation, locationKey, relativeLocation, sameLocation } from "./location.js";

type AnyRecord = Record<string, unknown>;

function sameRef(left: ObjectRef | null | undefined, right: ObjectRef | null | undefined): boolean {
  return left?.id === right?.id && left?.zoneEntryId === right?.zoneEntryId;
}

function selectorValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const item = value as AnyRecord;
  if (item.kind === "constant" || item.kind === "literal") return selectorValue(item.value);
  return value;
}

function relativePlayer(value: unknown, anchor: RelativeFilterAnchor | null | undefined): string | null | undefined {
  const resolved = selectorValue(value);
  if (resolved === "self" || resolved === "source" || resolved === "controller" || resolved === "you" || resolved === "caster") {
    return anchor?.controller;
  }
  if (resolved === "opponent" || resolved === "their" || resolved === "caster-opponent") return null;
  if (typeof resolved === "object" && resolved !== null && !Array.isArray(resolved) && "playerId" in resolved) {
    const playerId = (resolved as AnyRecord).playerId;
    return typeof playerId === "string" ? playerId : undefined;
  }
  return typeof resolved === "string" ? resolved : undefined;
}

export function matchesRelativeController(value: unknown, actual: string, anchor?: RelativeFilterAnchor | null): boolean {
  const resolved = selectorValue(value);
  if (resolved === undefined) return true;
  if (resolved === "any") return true;
  if (resolved === "opponent" || resolved === "their" || resolved === "caster-opponent") return anchor?.controller !== undefined && actual !== anchor.controller;
  if (resolved === "self" || resolved === "source" || resolved === "controller" || resolved === "you" || resolved === "caster") {
    return anchor?.controller === undefined ? true : actual === anchor.controller;
  }
  const player = relativePlayer(resolved, anchor);
  if (player === null) return anchor?.controller === undefined || actual !== anchor.controller;
  if (player !== undefined) return actual === player;
  return actual === resolved;
}

export function matchesRelativeOwner(value: unknown, actual: string, anchor?: RelativeFilterAnchor | null): boolean {
  const resolved = selectorValue(value);
  if (resolved === undefined || resolved === "any") return true;
  if (resolved === "opponent" || resolved === "their" || resolved === "caster-opponent") return anchor?.controller !== undefined && actual !== anchor.controller;
  if (resolved === "self" || resolved === "source" || resolved === "controller" || resolved === "you" || resolved === "caster") {
    return anchor?.controller === undefined ? actual === anchor?.controller : actual === anchor.controller;
  }
  const player = relativePlayer(resolved, anchor);
  if (player === null) return anchor?.controller === undefined || actual !== anchor.controller;
  if (player !== undefined) return actual === player;
  return actual === resolved;
}

export function matchesRelativeLocation(
  value: unknown,
  object: LayeredObjectSnapshot,
  anchor?: RelativeFilterAnchor | null,
): boolean {
  const resolved = selectorValue(value);
  if (resolved === undefined) return true;
  const relative = relativeLocation(resolved, anchor);
  if (relative !== undefined) return sameLocation(object.location, relative);
  if (typeof resolved === "string") return object.location?.type === resolved || locationKey(object.location) === resolved;
  const concrete = concreteLocation(resolved);
  if (concrete !== undefined) return sameLocation(object.location, concrete);
  return false;
}

export function matchesRelativeRegion(value: unknown, object: LayeredObjectSnapshot): boolean {
  const resolved = selectorValue(value);
  if (resolved === undefined) return true;
  if (resolved === "board") return object.zone === "board" && object.location?.type === "battlefield";
  if (resolved === "base" || resolved === "battlefield") return object.location?.type === resolved;
  if (typeof resolved === "string") return object.location?.type === resolved || object.location?.type === "battlefield" && object.location.id === resolved;
  const concrete = concreteLocation(resolved);
  return concrete === undefined ? false : sameLocation(object.location, concrete);
}

export function matchesRelativePosition(value: unknown, object: LayeredObjectSnapshot, anchor?: RelativeFilterAnchor | null): boolean {
  const resolved = selectorValue(value);
  if (resolved === undefined) return true;
  if (resolved === "here" || resolved === "self" || resolved === "source") return sameLocation(object.location, anchor?.location);
  return matchesRelativeLocation(resolved, object, anchor);
}

export function matchesRelativeExclusion(value: unknown, object: LayeredObjectSnapshot, anchor?: RelativeFilterAnchor | null): boolean {
  const resolved = selectorValue(value);
  if (resolved === undefined || resolved === false) return true;
  if (resolved === true || resolved === "self" || resolved === "source") return anchor !== undefined && anchor !== null && !sameRef(object.ref, anchor.ref);
  return false;
}

/** Validate and resolve only the source-relative parts of a static filter.
 * Absolute fields are left for `matchesObjectFilter`; relative fields remain
 * symbolic so a moved or stolen host is re-evaluated correctly. */
export function isSupportedRelativeFilterValue(value: unknown): boolean {
  const resolved = selectorValue(value);
  return resolved === "self" || resolved === "source" || resolved === "controller" || resolved === "you" || resolved === "caster" ||
    resolved === "opponent" || resolved === "their" || resolved === "caster-opponent" || resolved === "here" || resolved === "any" ||
    typeof resolved === "string" || (typeof resolved === "object" && resolved !== null && !Array.isArray(resolved) && "playerId" in resolved);
}

export function hasRelativeAnchor(filter: ObjectFilter | AnyRecord): boolean {
  const value = filter as AnyRecord;
  return value.other === true || value.exclude !== undefined || value.here === true || value.sameLocationAs !== undefined ||
    value.position !== undefined || value.location !== undefined && typeof value.location === "object" ||
    value.controller === "opponent" || value.owner === "opponent" || value.controller === "self" || value.owner === "self";
}

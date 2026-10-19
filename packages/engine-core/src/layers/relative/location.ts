import type { LocationRef, ObjectSnapshot } from "../../effects/contract.js";
import type { RelativeFilterAnchor } from "./types.js";

export function locationKey(location: ObjectSnapshot["location"] | null | undefined): string | null {
  if (location === null || location === undefined) return null;
  return location.type === "base"
    ? JSON.stringify(["base", location.player])
    : JSON.stringify(["battlefield", location.id]);
}

export function sameLocation(
  left: ObjectSnapshot["location"] | null | undefined,
  right: ObjectSnapshot["location"] | null | undefined,
): boolean {
  const leftKey = locationKey(left);
  const rightKey = locationKey(right);
  return leftKey !== null && leftKey === rightKey;
}

export function isRelativeLocation(value: unknown): boolean {
  if (value === "self" || value === "source" || value === "here") return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.sameLocationAs !== undefined) return isRelativeLocation(item.sameLocationAs);
  if (item.source !== undefined) return isRelativeLocation(item.source);
  if (item.kind === "relative" || item.kind === "location") {
    return item.value === undefined || isRelativeLocation(item.value);
  }
  return false;
}

export function relativeLocation(value: unknown, anchor: RelativeFilterAnchor | null | undefined): LocationRef | null | undefined {
  if (value === "self" || value === "source" || value === "here") return anchor?.location;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.sameLocationAs !== undefined) return relativeLocation(item.sameLocationAs, anchor);
  if (item.source !== undefined) return relativeLocation(item.source, anchor);
  if (item.kind === "relative" || item.kind === "location") {
    return item.value === undefined ? anchor?.location : relativeLocation(item.value, anchor);
  }
  return undefined;
}

export function concreteLocation(value: unknown): LocationRef | null | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.type === "base" && typeof item.player === "string") {
    return { type: "base", player: item.player };
  }
  if (item.type === "battlefield" && typeof item.id === "string") {
    return { type: "battlefield", id: item.id };
  }
  return undefined;
}

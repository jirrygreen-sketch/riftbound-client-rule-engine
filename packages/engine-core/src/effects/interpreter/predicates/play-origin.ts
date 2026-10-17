import type { PlayedFromHandCondition, PlayedFromZoneCondition } from "@riftbound/card-dsl";
import { readOrigin } from "./helpers.js";
import type { PredicateContext } from "./types.js";

export function evaluatePlayedFromHand(
  condition: PlayedFromHandCondition,
  context: PredicateContext
): boolean {
  return readOrigin(context, condition.object ?? "object") === "hand";
}

export function evaluatePlayedFromZone(
  condition: PlayedFromZoneCondition,
  context: PredicateContext
): boolean {
  return readOrigin(context, condition.object ?? "object") === condition.zone;
}

import type { Condition, EventItCondition, ObjectRelation, ObjectSelector, RelationCondition } from "@riftbound/card-dsl";
import { evaluatePlayedFromHand, evaluatePlayedFromZone } from "./play-origin.js";
import { evaluatePrintedCharacteristic } from "./printed.js";
import { evaluateResult } from "./result.js";
import { eventObject, record } from "./helpers.js";
import { MissingInformation } from "../values.js";
import type { PredicateContext } from "./types.js";

export type { ConditionEventPayload, ConditionCostPlan, ConditionPaymentReceipt, ConditionCostResult, PredicateContext } from "./types.js";
export { evaluatePlayedFromHand, evaluatePlayedFromZone } from "./play-origin.js";
export { evaluatePrintedCharacteristic } from "./printed.js";
export { evaluateResult } from "./result.js";

type EventRole = "object" | "source" | "target" | "it";

function eventRoleObject(context: PredicateContext, role: EventRole): Readonly<Record<string, unknown>> {
  if (role === "it") {
    const event = record(context.event);
    const candidate = event?.it;
    const object = record(candidate);
    if (object) return object;
    throw new MissingInformation("Event payload has no it object");
  }
  return eventObject(context, role);
}

function objectForSelector(context: PredicateContext, selector: EventRole | ObjectSelector): Readonly<Record<string, unknown>> {
  if (selector === "self") return context.context.source as unknown as Readonly<Record<string, unknown>>;
  if (selector === "source" || selector === "object" || selector === "target" || selector === "it") {
    return eventRoleObject(context, selector);
  }
  throw new Error(`Relation selector ${JSON.stringify(selector)} requires a bound target, pick, or link`);
}

function objectRef(value: Readonly<Record<string, unknown>>): string | null {
  const ref = record(value.ref);
  return ref && typeof ref.id === "string" && typeof ref.zoneEntryId === "number"
    ? `${ref.id}:${ref.zoneEntryId}`
    : typeof value.objectId === "string" ? value.objectId : null;
}

function locationKey(value: Readonly<Record<string, unknown>>): string | null {
  const location = record(value.location);
  if (!location || typeof location.type !== "string") return null;
  return location.type === "base"
    ? `base:${String(location.player ?? "")}`
    : `battlefield:${String(location.id ?? "")}`;
}

/** Evaluate a relation without turning it into an implicit target selection. */
export function evaluateRelation(condition: RelationCondition, context: PredicateContext): boolean {
  try {
    const left = objectForSelector(context, condition.left);
    const right = objectForSelector(context, condition.right ?? "source");
    switch (condition.relation as ObjectRelation) {
      case "same-location": return locationKey(left) !== null && locationKey(left) === locationKey(right);
      case "different-location": return locationKey(left) !== null && locationKey(right) !== null && locationKey(left) !== locationKey(right);
      case "same-controller": return left.controller !== undefined && left.controller === right.controller;
      case "different-controller": return left.controller !== undefined && right.controller !== undefined && left.controller !== right.controller;
      case "same-owner": return left.owner !== undefined && left.owner === right.owner;
      case "different-owner": return left.owner !== undefined && right.owner !== undefined && left.owner !== right.owner;
      case "another":
      case "other": {
        const a = objectRef(left), b = objectRef(right);
        return a !== null && b !== null && a !== b;
      }
      default: throw new Error(`Unsupported object relation: ${String(condition.relation)}`);
    }
  } catch (error) {
    if (error instanceof MissingInformation) return false;
    throw error;
  }
}

/** Resolve the event pronoun only when the event supplied an authoritative `it`. */
export function evaluateEventIt(condition: EventItCondition, context: PredicateContext): boolean {
  const event = record(context.event);
  if (event?.it === undefined) return false;
  try {
    if (condition.object === undefined || condition.object === "it") return true;
    eventRoleObject(context, condition.object);
    return true;
  } catch (error) {
    if (error instanceof MissingInformation) return false;
    throw error;
  }
}

/** Evaluate the condition members that require event or finalized-result data. */
export function evaluatePredicateCondition(condition: Condition, context: PredicateContext): boolean {
  switch (condition.kind) {
    case "played-from-hand":
    case "playedFromHand":
      return evaluatePlayedFromHand(condition, context);
    case "played-from-zone":
    case "playedFromZone":
      return evaluatePlayedFromZone(condition, context);
    case "event-printed":
    case "printed-characteristic":
    case "event-printed-characteristic":
      return evaluatePrintedCharacteristic(condition, context);
    case "result":
      return evaluateResult(condition, context);
    case "relation":
      return evaluateRelation(condition, context);
    case "event-it":
      return evaluateEventIt(condition, context);
    default:
      throw new Error(`Unsupported predicate condition: ${String((condition as { kind: unknown }).kind)}`);
  }
}

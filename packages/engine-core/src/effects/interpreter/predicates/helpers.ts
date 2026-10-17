import type { ObjectSnapshot, Value } from "../../contract.js";
import { MissingInformation, asValue, compareValues } from "../values.js";
import type { PredicateContext } from "./types.js";

export function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export function eventObject(context: PredicateContext, role: string): Readonly<Record<string, unknown>> {
  const event = context.event as import("./types.js").ConditionEventPayload | undefined;
  const candidate = event?.[role as "object" | "source" | "target"];
  if (candidate !== undefined) {
    const object = record(candidate);
    if (object) return object;
  }
  if (role === "source") return context.context.source as unknown as Readonly<Record<string, unknown>>;
  throw new MissingInformation(`Event payload has no ${role} object`);
}

function nested(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    const object = record(current);
    if (!object || !Object.hasOwn(object, key)) return undefined;
    current = object[key];
  }
  return current;
}

export function lookup(value: unknown, path: string): unknown {
  if (path.length === 0) return value;
  return nested(value, path.split("."));
}

export function readOrigin(context: PredicateContext, role: string): string {
  const event = context.event as import("./types.js").ConditionEventPayload | undefined;
  const object = eventObject(context, role);
  const details = record(event?.details);
  const candidates = [
    event?.playedFromHand === true ? "hand" : undefined,
    event?.playedFromZone,
    event?.fromZone,
    object.playedFromHand === true ? "hand" : undefined,
    object.playedFromZone,
    object.playedFrom,
    object.fromZone,
    details?.playedFromHand === true ? "hand" : undefined,
    details?.playedFromZone,
    details?.playedFrom,
    details?.fromZone
  ];
  const origin = candidates.find(value => typeof value === "string" && value.length > 0);
  if (typeof origin !== "string") throw new MissingInformation("Event payload has no play-origin zone");
  return origin;
}

function numericPrinted(value: unknown): number {
  if (value === null || value === undefined) throw new MissingInformation("Printed characteristic is unavailable");
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return 0;
    if (value.every(item => typeof item === "string")) return value.length;
  }
  const object = record(value);
  if (object && typeof object.amount === "number" && Number.isFinite(object.amount)) return object.amount;
  throw new Error("Printed characteristic must be a finite number or a Power-domain list");
}

function own(value: Readonly<Record<string, unknown>> | null, key: string): { readonly found: true; readonly value: unknown } | { readonly found: false } {
  return value !== null && Object.hasOwn(value, key)
    ? { found: true, value: value[key] }
    : { found: false };
}

export function readPrintedCharacteristic(
  context: PredicateContext,
  role: string,
  characteristic: "energy" | "power" | "might"
): number {
  const event = context.event as import("./types.js").ConditionEventPayload | undefined;
  const object = eventObject(context, role);
  const details = record(event?.details);
  const names = characteristic === "energy"
    ? ["energy", "energyCost"]
    : characteristic === "power" ? ["power", "powerCost"] : ["might", "mightValue"];
  const prefixed = characteristic === "energy"
    ? ["printedEnergy", "printedEnergyCost"]
    : characteristic === "power" ? ["printedPower", "printedPowerCost"] : ["printedMight", "printedMightValue"];
  for (const container of [object, details]) {
    for (const name of prefixed) {
      const candidate = own(container, name);
      if (candidate.found) return numericPrinted(candidate.value);
    }
  }
  for (const container of [object, details]) {
    for (const key of ["printed", "printedCost"]) {
      const nestedValue = own(container, key);
      if (!nestedValue.found) continue;
      if (nestedValue.value === null) throw new MissingInformation("Printed characteristic is unavailable");
      const printed = record(nestedValue.value);
      if (printed === null) continue;
      for (const name of names) {
        const candidate = own(printed, name);
        if (candidate.found) return numericPrinted(candidate.value);
      }
    }
  }
  throw new MissingInformation(`Event payload has no printed ${characteristic} characteristic`);
}

export function comparePredicate(left: Value, operator: unknown, right: Value): boolean {
  return compareValues(left, operator, right);
}

export function valueOrExpression(context: PredicateContext, value: unknown): Value {
  if (value && typeof value === "object" && !Array.isArray(value) && "kind" in value) {
    return context.context.evaluate(value as never);
  }
  return asValue(value);
}

export function readResultValue(context: PredicateContext, result: string, id?: string, key?: string): Value {
  const cost = context.cost;
  if (cost !== undefined) {
    const costValue = readCostResult(cost, result, id, key);
    if (costValue !== undefined) return asValue(costValue);
  }
  const maps = [context.results, context.result] as readonly unknown[];
  for (const map of maps) {
    const direct = lookup(map, result);
    if (direct !== undefined) {
      const selected = key === undefined ? direct : lookup(direct, key);
      if (selected !== undefined) return asValue(selected);
    }
  }
  const linked = context.linked(result, key);
  if (linked !== undefined) return asValue(linked);
  throw new MissingInformation(`Unavailable condition result: ${result}`);
}

function readCostResult(cost: PredicateContext["cost"], result: string, id?: string, key?: string): unknown {
  const receipt = cost as import("./types.js").ConditionCostResult | undefined;
  if (!receipt) return undefined;
  const direct = lookup(receipt, result.replace(/^cost\./, ""));
  if (direct !== undefined && id === undefined && key === undefined) return direct;

  const componentId = id ?? key;
  const additionalLists = [receipt.selectedAdditional, receipt.additional, receipt.optionalAdditional];
  const isAdditionalResult = /^(?:cost\.)?(?:additional|optional-additional|additional-cost)(?:\.|-|$)/.test(result)
    || result === "additional-cost-paid" || result === "optional-additional-paid";
  if (isAdditionalResult) {
    if (componentId !== undefined) {
      for (const list of additionalLists) {
        const match = list?.find(entry => entry.id === componentId);
        if (match) return match.paid === undefined ? (match.selected === undefined ? true : match.selected) : match.paid;
      }
      if (receipt.declinedAdditional?.includes(componentId)) return false;
      if (additionalLists.some(list => list !== undefined)) return false;
    } else {
      const selected = receipt.selectedAdditional ?? receipt.additional ?? receipt.optionalAdditional;
      if (selected !== undefined) return selected.length > 0;
    }
  }

  const path = result.replace(/^cost\./, "");
  const value = lookup(receipt, path);
  if (value !== undefined) return key === undefined ? value : lookup(value, key);
  return undefined;
}

export function sourceSnapshot(context: PredicateContext): ObjectSnapshot {
  return context.context.source;
}

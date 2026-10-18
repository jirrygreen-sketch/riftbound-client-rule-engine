import type { Expr, LocationSelector, LocationTargetSpec } from "@riftbound/card-dsl";
import type { LocationRef, ObjectRef, ResolveContext } from "../contract.js";
import { queryLocationCandidates } from "../../target/location/candidates.js";
import { locationSelectorOptions, resolveLocationSelector, sameLocation } from "../../target/location/ref.js";
import { resolveObjectSelector } from "./selectors.js";
import { MissingInformation } from "./values.js";
import type { LocationCandidateOptions, LocationEnvironment } from "../../target/location/types.js";

export { resolveLocationSelector } from "../../target/location/ref.js";

export interface LocationBinding {
  readonly id: string;
  readonly selected: readonly LocationRef[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEnvelope(value: unknown): value is { readonly primitiveArgs: Record<string, unknown> } {
  return isRecord(value) && isRecord(value.primitiveArgs);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string" && [
    "constant", "literal", "location", "object-property", "object-attribute",
    "linked", "linked-value", "count", "arithmetic"
  ].includes(value.kind);
}

function isDynamicSelector(value: unknown): value is LocationSelector {
  if (typeof value === "string") return ["ability-controller-base", "opponent-base", "source-location", "target-location"].includes(value);
  if (!isRecord(value)) return false;
  if (value.type === "base" && ["self", "controller", "opponent"].includes(String(value.player))) return true;
  return [
    "relative", "location-of", "location-selector", "target-location",
    "target-controller-base", "target-owner-base", "source-location", "linked-location", "choose"
  ].includes(String(value.kind));
}

function normalizeDestinationExpr(
  value: unknown,
  context: ResolveContext,
  options: Omit<LocationEnvironment, "context"> & { readonly host?: ObjectRef }
): unknown {
  if (isRecord(value) && value.kind === "location") {
    return { kind: "constant", value: moveDestination(value.value, context, options) };
  }
  if (isRecord(value) && (value.kind === "constant" || value.kind === "literal") && isDynamicSelector(value.value)) {
    return { kind: "constant", value: moveDestination(value.value, context, options) };
  }
  if (isDynamicSelector(value)) return { kind: "constant", value: moveDestination(value, context, options) };
  if (!isExpr(value)) return { kind: "constant", value };
  return value;
}

function moveDestination(value: unknown, context: ResolveContext, options: Omit<LocationEnvironment, "context">): unknown {
  if (isRecord(value) && value.kind === "choose") {
    const candidates = locationSelectorOptions(value as unknown as Extract<LocationSelector, { readonly kind: "choose" }>, { ...options, context });
    if (candidates.length === 0) throw new MissingInformation("Location choice has no options");
    // The primitive requests the choice only after amount/mode/object checks.
    return { kind: "choose", id: value.id, options: candidates };
  }
  const destination = resolveDestination(value, context, options);
  if (options.moving !== undefined && !queryLocationCandidates(context, {}, options).some(ref => sameLocation(ref, destination))) {
    throw new TypeError("Illegal Move destination for the selected objects");
  }
  return destination;
}

function movingObjects(value: unknown, amount: unknown, context: ResolveContext, options: Omit<LocationEnvironment, "context">): readonly ObjectRef[] {
  const selector = isExpr(value) ? context.evaluate(value) : value ?? "source";
  // The host must bind primitive object choices before querying their Move
  // destinations. Do not invent a selection from an unresolved candidate set.
  if (isRecord(selector) && selector.kind === "choose") throw new MissingInformation("Move object choice requires a bound selection before destination queries");
  const count = amount === undefined ? 1 : isExpr(amount) ? context.evaluate(amount) : amount;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new TypeError("effect.move amount must be a nonnegative safe integer");
  const refs = resolveObjectSelector(selector as never, {
    context,
    linked: id => options.linked?.(id) as import("@riftbound/card-dsl").Value | undefined
  }).filter(ref => {
    const object = context.object(ref);
    return object?.zone === "board" && object.location !== null;
  });
  return [...new Map(refs.map(ref => [JSON.stringify([ref.id, ref.zoneEntryId]), ref])).values()].slice(0, count);
}

/**
 * Adapt an effect.move argument object at the interpreter boundary. The
 * primitive keeps its frozen Expr schema; this helper resolves the new
 * location expression form and also wraps already-evaluated arguments when
 * runAbilityBody is used with the generated primitive registry directly.
 */
export function normalizeMoveArguments(
  value: unknown,
  context: ResolveContext,
  options: Omit<LocationEnvironment, "context"> & { readonly host?: ObjectRef } = {}
): Readonly<Record<string, unknown>> {
  const envelope = isEnvelope(value);
  const raw = envelope ? value.primitiveArgs : value;
  if (!isRecord(raw)) throw new TypeError("effect.move arguments must be an object");
  const normalized: Record<string, unknown> = { ...raw };
  if (Object.hasOwn(raw, "to")) {
    // Bind destination queries to current references, never to matching object ids.
    // Keep the primitive's legacy per-object `controller-base` spelling intact.
    const dynamic = isDynamicSelector(raw.to) || isRecord(raw.to) &&
      (raw.to.kind === "location" || ["constant", "literal"].includes(String(raw.to.kind)) && isDynamicSelector(raw.to.value));
    const amount = raw.amount === undefined ? 1 : isExpr(raw.amount) ? context.evaluate(raw.amount) : raw.amount;
    const moving = dynamic && amount !== 0 ? movingObjects(raw.objects, amount, context, options) : undefined;
    if (dynamic && moving !== undefined && (moving.length === 0 || moving.some(ref => context.object(ref) === null))) {
      throw new MissingInformation("Move selection has no current objects");
    }
    normalized.to = normalizeDestinationExpr(raw.to, context, { ...options, ...(moving === undefined ? {} : { moving }) });
  }
  if (!envelope) {
    for (const [key, item] of Object.entries(normalized)) {
      if (key !== "to" && !isExpr(item)) normalized[key] = { kind: "constant", value: item };
    }
  }
  return envelope ? { primitiveArgs: normalized } : normalized;
}

export function resolveDestination(
  value: unknown,
  context: ResolveContext,
  options: Omit<LocationEnvironment, "context"> & { readonly host?: ObjectRef } = {}
): LocationRef {
  return resolveLocationSelector(value as LocationSelector, { ...options, context });
}

export function locationCandidates(
  context: ResolveContext,
  spec: LocationTargetSpec,
  options: LocationCandidateOptions = {}
): readonly LocationRef[] {
  return queryLocationCandidates(context, spec, options);
}

function locationCombinations(candidates: readonly LocationRef[], min: number, max: number): readonly (readonly LocationRef[])[] {
  const result: LocationRef[][] = [];
  const visit = (start: number, selected: LocationRef[]) => {
    if (selected.length >= min && selected.length <= max) result.push([...selected]);
    if (selected.length === max) return;
    for (let index = start; index < candidates.length; index++) {
      selected.push(candidates[index]!);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

export function chooseLocations(
  context: ResolveContext,
  specs: readonly LocationTargetSpec[],
  options: Omit<LocationEnvironment, "context"> & { readonly host?: ObjectRef } = {}
): readonly LocationBinding[] {
  return specs.map(spec => {
    const candidates = locationCandidates(context, spec, options);
    const min = spec.min ?? (spec.selection === "up-to" || spec.selection === "any" || spec.selection === "all" ? 0 : 1);
    const limit = spec.max === null || spec.max === undefined ? (spec.selection === "one" || spec.selection === undefined ? 1 : candidates.length) : spec.max;
    if (!Number.isSafeInteger(min) || min < 0 || !Number.isSafeInteger(limit) || limit < min) throw new TypeError(`Invalid location bounds for ${spec.id}`);
    const max = Math.min(limit, candidates.length);
    if (max < min) throw new MissingInformation(`No legal locations for ${spec.id}`);
    if (spec.selection === "all" && candidates.length > max) throw new TypeError(`Location set exceeds maximum for ${spec.id}`);
    if (spec.selection === "all") return { id: spec.id, selected: candidates };
    if (min === 1 && max === 1) {
      const answer = context.choose<LocationRef>({
        id: `location:${spec.id}`,
        type: "mode",
        chooser: context.controller,
        visibility: "public",
        options: candidates
      });
      const selected = candidates.find(candidate => sameLocation(candidate, answer));
      if (!selected) throw new Error(`Invalid location choice for ${spec.id}`);
      return { id: spec.id, selected: [selected] };
    }
    const selected = context.choose<readonly LocationRef[]>({
      id: `location:${spec.id}`, type: "mode", chooser: context.controller,
      visibility: "public", options: locationCombinations(candidates, min, max)
    });
    if (!Array.isArray(selected) || selected.length < min || selected.length > max || selected.some((item, index) =>
      !candidates.some(candidate => sameLocation(candidate, item)) || selected.slice(0, index).some(previous => sameLocation(previous, item)))) {
      throw new Error(`Invalid location choice for ${spec.id}`);
    }
    return { id: spec.id, selected: selected.map(item => candidates.find(candidate => sameLocation(candidate, item))!) };
  });
}

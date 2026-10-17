import type { Expr, LocationSelector, LocationTargetSpec } from "@riftbound/card-dsl";
import type { LocationRef, ObjectRef, ResolveContext } from "../contract.js";
import { queryLocationCandidates } from "../../target/location/candidates.js";
import { resolveLocationSelector } from "../../target/location/ref.js";
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
  return [
    "relative", "location-of", "location-selector", "target-location",
    "target-controller-base", "target-owner-base", "source-location", "linked-location"
  ].includes(String(value.kind));
}

function normalizeDestinationExpr(
  value: unknown,
  context: ResolveContext,
  options: Omit<LocationEnvironment, "context"> & { readonly host?: ObjectRef }
): unknown {
  if (isRecord(value) && value.kind === "location") {
    return { kind: "constant", value: resolveDestination(value.value, context, options) };
  }
  if (isRecord(value) && (value.kind === "constant" || value.kind === "literal") && isDynamicSelector(value.value)) {
    return { kind: "constant", value: resolveDestination(value.value, context, options) };
  }
  if (!isExpr(value)) return { kind: "constant", value };
  return value;
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
  if (Object.hasOwn(raw, "to")) normalized.to = normalizeDestinationExpr(raw.to, context, options);
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
    const max = Math.min(spec.max === null || spec.max === undefined ? (spec.selection === "one" || spec.selection === undefined ? 1 : candidates.length) : spec.max, candidates.length);
    if (max < min) throw new Error(`No legal locations for ${spec.id}`);
    if (spec.selection === "all") return { id: spec.id, selected: candidates };
    if (min === 1 && max === 1) {
      const answer = context.choose<LocationRef>({
        id: `location:${spec.id}`,
        type: "mode",
        chooser: context.controller,
        visibility: "public",
        options: candidates
      });
      if (!candidates.some(candidate => JSON.stringify(candidate) === JSON.stringify(answer))) throw new Error(`Invalid location choice for ${spec.id}`);
      return { id: spec.id, selected: [answer] };
    }
    const selected = context.choose<readonly LocationRef[]>({
      id: `location:${spec.id}`, type: "mode", chooser: context.controller,
      visibility: "public", options: locationCombinations(candidates, min, max)
    });
    if (!Array.isArray(selected) || selected.length < min || selected.length > max || selected.some((item, index) =>
      !candidates.some(candidate => JSON.stringify(candidate) === JSON.stringify(item)) || selected.slice(0, index).some(previous => JSON.stringify(previous) === JSON.stringify(item)))) {
      throw new Error(`Invalid location choice for ${spec.id}`);
    }
    return { id: spec.id, selected };
  });
}

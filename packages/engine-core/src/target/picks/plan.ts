import type { Expr, ObjectFilter, PickSpec, Value } from "@riftbound/card-dsl";
import type { ChoiceRequest, ObjectRef, ObjectSnapshot, PlayerId, ResolveContext } from "../../effects/contract.js";

export type PickPhase = "finalize" | "resolve";
export type PickValue = Value | ObjectRef;
export type PickResolutionStatus = "resolved" | "partial" | "ignored" | "impossible";

export interface PickCandidateOptions {
  /** A source captured by an owner during Finalize (for example zoneSlice). */
  readonly source?: readonly PickValue[];
  /** A prevalidated answer supplied by a host or test adapter. */
  readonly selected?: readonly PickValue[];
  readonly chooser?: PlayerId;
  readonly visibility?: "public" | "chooser-only" | readonly PlayerId[];
  readonly prompt?: string;
  readonly phase?: PickPhase;
  readonly isLegal?: (value: PickValue, snapshot: ObjectSnapshot | null, phase: PickPhase) => boolean;
}

export interface PickCandidateSet {
  readonly offered: readonly PickValue[];
  readonly invalid: readonly PickValue[];
  readonly phase: PickPhase;
}

/** A Resolve-time non-target pick. It never creates target notifications. */
export interface NonTargetPickPlan {
  readonly requirement: PickSpec;
  readonly offered: readonly PickValue[];
  readonly selected: readonly PickValue[];
  readonly invalid: readonly PickValue[];
  readonly lockedAt: "resolve";
  readonly retestAtResolve: true;
}

export interface PickResolution {
  readonly status: PickResolutionStatus;
  readonly plan: NonTargetPickPlan;
  readonly selected: readonly PickValue[];
  readonly invalid: readonly PickValue[];
  readonly reason?: "unavailable" | "invalid-choice";
}

export class PickSelectionError extends Error {
  readonly code:
    | "invalid-pick"
    | "invalid-bounds"
    | "missing-source"
    | "missing-result"
    | "invalid-result"
    | "invalid-choice"
    | "choice-required"
    | "no-legal-picks";

  constructor(code: PickSelectionError["code"], message: string) {
    super(message);
    this.name = "PickSelectionError";
    this.code = code;
  }
}

const SELECTIONS = ["one", "any", "all", "up-to"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.zoneEntryId === "number" && Number.isSafeInteger(value.zoneEntryId) && value.zoneEntryId >= 0;
}

function refKey(ref: ObjectRef): string {
  return `${ref.id}\u0000${ref.zoneEntryId}`;
}

function valueKey(value: PickValue): string {
  if (isObjectRef(value)) return `ref:${refKey(value)}`;
  return `value:${JSON.stringify(value)}`;
}

function copyValue(value: PickValue): PickValue {
  if (isObjectRef(value)) return Object.freeze({ id: value.id, zoneEntryId: value.zoneEntryId });
  // PickSpec options are JSON Values. Object references only occur as the
  // top-level entries returned by linked/zone queries, so copy that identity
  // explicitly and preserve other immutable values as-is.
  return value;
}

function assertPick(spec: PickSpec): void {
  if (!isRecord(spec) || typeof spec.id !== "string" || spec.id.length === 0 || !Array.isArray(spec.options)) {
    throw new PickSelectionError("invalid-pick", "PickSpec requires an id and an options array");
  }
  if (spec.selection !== undefined && !SELECTIONS.includes(spec.selection)) {
    throw new PickSelectionError("invalid-pick", `Unknown pick selection mode: ${String(spec.selection)}`);
  }
  if (own(spec, "zoneSlice") && own(spec, "linked")) {
    throw new PickSelectionError("invalid-pick", "A pick cannot use both zoneSlice and linked sources");
  }
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PickSelectionError("invalid-bounds", `${label} must be a non-negative safe integer`);
  }
  return value;
}

export interface PickBounds {
  readonly min: number;
  readonly max: number;
}

export function pickBounds(spec: PickSpec, available: number): PickBounds {
  assertPick(spec);
  const countAvailable = count(available, "Available pick count");
  const selection = spec.selection ?? "one";
  const min = count(spec.min ?? (selection === "one" ? 1 : 0), "Pick minimum");
  const rawMax = spec.max === null || spec.max === undefined
    ? (selection === "one" ? 1 : countAvailable)
    : spec.max;
  const max = count(rawMax, "Pick maximum");
  if (max < min) throw new PickSelectionError("invalid-bounds", "Pick maximum must not be less than its minimum");
  return Object.freeze({ min, max: Math.min(max, countAvailable) });
}

function evaluateResult(context: ResolveContext, expression: PickSpec["linked"] | PickSpec["exclude"], id: string): PickValue[] {
  if (!expression || typeof expression !== "object" || typeof expression.instructionId !== "string" ||
      typeof expression.key !== "string" || expression.key.length === 0) {
    throw new PickSelectionError("invalid-pick", `${id} linked source needs an explicit result key`);
  }
  let value: Value;
  try {
    value = context.evaluate(expression as unknown as Expr);
  } catch (error) {
    if (error instanceof Error && (error.name === "MissingInformation" || /missing|unavailable/i.test(error.message))) {
      throw new PickSelectionError("missing-result", `${id} linked result is unavailable`);
    }
    throw error;
  }
  if (value === null) throw new PickSelectionError("missing-result", `${id} linked result is unavailable`);
  if (!Array.isArray(value)) throw new PickSelectionError("invalid-result", `${id} must link an array result`);
  return value.map(item => copyValue(item as PickValue));
}

function sourceValues(context: ResolveContext, spec: PickSpec, options: PickCandidateOptions): PickValue[] {
  if (spec.linked !== undefined) return evaluateResult(context, spec.linked, spec.id);
  if (options.source !== undefined) return options.source.map(copyValue);
  if (spec.zoneSlice !== undefined) {
    throw new PickSelectionError("missing-source", `${spec.id} requires a Finalize zoneSlice binding`);
  }
  // A filter is a non-target query source. Query order is retained exactly as
  // supplied by ResolveContext; zone order must use zoneSlice instead.
  if (spec.filter !== undefined) {
    return context.query(spec.filter as ObjectFilter).map(object => copyValue({
      id: object.ref.id,
      zoneEntryId: object.ref.zoneEntryId
    }));
  }
  return spec.options.map(item => copyValue(item as PickValue));
}

function filteredByObjectFilter(
  context: ResolveContext,
  values: readonly PickValue[],
  filter: ObjectFilter | undefined,
  options: PickCandidateOptions,
  invalid: PickValue[]
): PickValue[] {
  const result: PickValue[] = [];
  const seen = new Set<string>();
  const queried = filter === undefined ? undefined : new Map(
    context.query(filter).map(object => [refKey(object.ref), object] as const)
  );
  for (const value of values) {
    if (isObjectRef(value)) {
      const snapshot = context.object(value);
      const legalByFilter = queried === undefined ? true : queried.has(refKey(value));
      const legalByCallback = options.isLegal?.(value, snapshot, options.phase ?? "resolve") ?? true;
      if (snapshot === null || !legalByFilter || !legalByCallback) {
        invalid.push(value);
        continue;
      }
    } else if (filter !== undefined) {
      // A characteristic filter can only restrict game objects. Do not turn a
      // player/scalar pick into an object by guessing its meaning.
      invalid.push(value);
      continue;
    }
    const key = valueKey(value);
    if (seen.has(key)) {
      invalid.push(value);
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function subtract(values: readonly PickValue[], excluded: readonly PickValue[]): PickValue[] {
  const excludedKeys = new Set(excluded.map(valueKey));
  return values.filter(value => !excludedKeys.has(valueKey(value)));
}

/** Resolve the restricted candidate source without asking the player. */
export function queryPickCandidates(
  context: ResolveContext,
  spec: PickSpec,
  options: Omit<PickCandidateOptions, "selected"> = {}
): PickCandidateSet {
  assertPick(spec);
  const invalid: PickValue[] = [];
  let values = sourceValues(context, spec, options);
  if (spec.exclude !== undefined) values = subtract(values, evaluateResult(context, spec.exclude, spec.id));
  const offered = filteredByObjectFilter(context, values, spec.filter as ObjectFilter | undefined, options, invalid);
  return Object.freeze({ offered: Object.freeze(offered), invalid: Object.freeze(invalid), phase: options.phase ?? "resolve" });
}

function chooseObjects(
  context: ResolveContext,
  spec: PickSpec,
  values: readonly PickValue[],
  bounds: PickBounds,
  options: PickCandidateOptions
): readonly PickValue[] {
  const refs = values.every(isObjectRef);
  if (!refs) throw new PickSelectionError("choice-required", `${spec.id} needs a value-choice adapter for non-object options`);
  const answer = context.choose<readonly ObjectRef[]>({
    id: `pick:${spec.id}`,
    type: "select-objects",
    chooser: options.chooser ?? context.controller,
    visibility: options.visibility ?? "chooser-only",
    ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
    options: values as unknown as readonly ObjectRef[],
    min: bounds.min,
    max: bounds.max
  } as ChoiceRequest<readonly ObjectRef[]>);
  if (!Array.isArray(answer)) throw new PickSelectionError("invalid-choice", `${spec.id} choice must be an array`);
  const offered = new Set(values.map(value => valueKey(value)));
  const seen = new Set<string>();
  const selected: PickValue[] = [];
  for (const value of answer) {
    if (!isObjectRef(value) || !offered.has(valueKey(value)) || seen.has(valueKey(value))) {
      throw new PickSelectionError("invalid-choice", `${spec.id} choice contains an unavailable or duplicate value`);
    }
    seen.add(valueKey(value));
    selected.push(copyValue(value));
  }
  if (selected.length < bounds.min || selected.length > bounds.max) {
    throw new PickSelectionError("invalid-choice", `${spec.id} choice is outside its required count`);
  }
  return selected;
}

function validateSelected(selected: readonly PickValue[], offered: readonly PickValue[], bounds: PickBounds, id: string): PickValue[] {
  if (!Array.isArray(selected) || selected.length < bounds.min || selected.length > bounds.max) {
    throw new PickSelectionError("invalid-choice", `${id} choice is outside its required count`);
  }
  const available = new Set(offered.map(valueKey));
  const seen = new Set<string>();
  const result: PickValue[] = [];
  for (const value of selected) {
    const key = valueKey(value);
    if (!available.has(key) || seen.has(key)) throw new PickSelectionError("invalid-choice", `${id} choice contains an unavailable or duplicate value`);
    seen.add(key);
    result.push(copyValue(value));
  }
  return result;
}

/**
 * Resolve a PickSpec during Resolve. The offered source is filtered and
 * revalidated against current zone-bound references; it never emits
 * `became-target` and never uses TargetPlan callbacks.
 */
export function resolveNonTargetPick(
  context: ResolveContext,
  spec: PickSpec,
  options: PickCandidateOptions = {}
): PickResolution {
  const candidates = queryPickCandidates(context, spec, { ...options, phase: "resolve" });
  const bounds = pickBounds(spec, candidates.offered.length);
  if (candidates.offered.length < bounds.min) {
    const plan: NonTargetPickPlan = Object.freeze({
      requirement: Object.freeze({ ...spec }),
      offered: candidates.offered,
      selected: Object.freeze([]),
      invalid: candidates.invalid,
      lockedAt: "resolve",
      retestAtResolve: true
    });
    return Object.freeze({ status: "impossible", plan, selected: plan.selected, invalid: plan.invalid, reason: "unavailable" });
  }
  const selected = options.selected !== undefined
    ? validateSelected(options.selected, candidates.offered, bounds, spec.id)
    : spec.selection === "all"
      ? candidates.offered.slice(0, bounds.max).map(copyValue)
      : chooseObjects(context, spec, candidates.offered, bounds, options);
  const plan: NonTargetPickPlan = Object.freeze({
    requirement: Object.freeze({ ...spec }),
    offered: candidates.offered,
    selected: Object.freeze(selected),
    invalid: candidates.invalid,
    lockedAt: "resolve",
    retestAtResolve: true
  });
  const status: PickResolutionStatus = candidates.invalid.length === 0 ? "resolved" : selected.length === 0 ? "ignored" : "partial";
  return Object.freeze({ status, plan, selected: plan.selected, invalid: plan.invalid });
}

export const resolvePickSpec = resolveNonTargetPick;
export const queryPicks = queryPickCandidates;

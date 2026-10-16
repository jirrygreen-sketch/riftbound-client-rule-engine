import type {
  FinalizedCostPlan,
  LocationRef,
  ObjectFilter,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  ResolveContext,
  Value
} from "../effects/contract.js";

export type TargetSelectionMode = "one" | "any" | "all" | "up-to";
export type TargetPlanPhase = "finalize" | "resolve";

export interface TargetRequirement {
  readonly id: string;
  readonly filter: ObjectFilter;
  readonly min?: number;
  readonly max?: number | null;
  readonly selection?: TargetSelectionMode;
  readonly kind?: "object" | "group";
  readonly group?: boolean;
  readonly location?: LocationRef | null;
}

export interface TargetPlan {
  readonly requirement: TargetRequirement;
  readonly selected: readonly ObjectRef[];
  readonly lockedAt: "finalize";
  readonly retestAtResolve: true;
  readonly mode?: string;
  readonly repeatIndex?: number;
}

export interface TargetBounds {
  readonly min: number;
  readonly max: number;
}

export interface TargetCandidateOptions {
  readonly isPending?: (ref: ObjectRef, snapshot: ObjectSnapshot, phase: TargetPlanPhase) => boolean;
  readonly isLegal?: (snapshot: ObjectSnapshot, phase: TargetPlanPhase) => boolean;
}

export interface TargetFinalizeOptions extends TargetCandidateOptions {
  readonly selected?: readonly ObjectRef[];
  readonly chosen?: readonly ObjectRef[];
  readonly mode?: string;
  readonly repeatIndex?: number;
  readonly reselected?: boolean;
  readonly chooser?: PlayerId;
  readonly visibility?: "public" | "chooser-only" | readonly PlayerId[];
  readonly prompt?: string;
  readonly tax?: TargetTaxSpec | readonly TargetTaxSpec[] | TargetTaxForTarget;
  readonly taxAdapter?: TargetTaxAdapter;
  readonly onTargetsFinalized?: (event: TargetsFinalizedEvent) => void;
  readonly onTargeted?: (event: BecameTargetEvent) => void;
}

export interface TargetResolveOptions extends TargetCandidateOptions {
  readonly onTargetsResolved?: (event: TargetsResolvedEvent) => void;
}

export interface TargetsFinalizedEvent {
  readonly kind: "targets-finalized";
  readonly phase: "finalize";
  readonly plan: TargetPlan;
  readonly targets: readonly ObjectRef[];
  readonly repeatIndex?: number;
  readonly reselected: boolean;
}

export interface BecameTargetEvent {
  readonly kind: "became-target";
  readonly phase: "finalize";
  readonly plan: TargetPlan;
  readonly target: ObjectRef;
  readonly repeatIndex?: number;
  readonly reselected: boolean;
}

export interface TargetsResolvedEvent {
  readonly kind: "targets-resolved";
  readonly phase: "resolve";
  readonly plan: TargetPlan;
  readonly selected: readonly ObjectRef[];
  readonly invalid: readonly ObjectRef[];
  readonly status: TargetResolutionStatus;
}

export type TargetResolutionStatus = "resolved" | "partial" | "ignored";

export interface TargetResolution {
  readonly status: TargetResolutionStatus;
  readonly plan: TargetPlan;
  readonly selected: readonly ObjectRef[];
  readonly invalid: readonly ObjectRef[];
  readonly reason?: "mistargeted";
}

export interface TargetTaxSpec {
  readonly kind: "deflect";
  readonly amount: number;
  readonly payer?: PlayerId;
  readonly source?: ObjectRef;
}

export type TargetTaxForTarget = (
  target: ObjectSnapshot,
  plan: TargetPlan
) => TargetTaxSpec | null | undefined;

export interface TargetTaxAdapter {
  appendTargetTax(request: TargetTaxRequest): TargetTaxAppendResult | void;
}

export interface TargetTaxRequest {
  readonly kind: "deflect";
  readonly target: ObjectRef;
  readonly payer: PlayerId;
  readonly amount: number;
  readonly source?: ObjectRef;
  readonly targetPlan: TargetPlan;
}

export type TargetTaxAppendResult =
  | { readonly status: "appended"; readonly payment?: FinalizedCostPlan }
  | { readonly status: "unpayable"; readonly reason?: string };

export class TargetSelectionError extends Error {
  readonly code:
    | "invalid-requirement"
    | "invalid-bounds"
    | "no-legal-targets"
    | "invalid-target-choice"
    | "tax-adapter-required"
    | "target-tax-unpayable";

  constructor(code: TargetSelectionError["code"], message: string) {
    super(message);
    this.name = "TargetSelectionError";
    this.code = code;
  }
}

const DEFAULT_SELECTION: TargetSelectionMode = "one";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function refKey(ref: ObjectRef): string {
  return `${ref.id}\u0000${ref.zoneEntryId}`;
}

function copyRef(ref: ObjectRef): ObjectRef {
  return Object.freeze({ id: ref.id, zoneEntryId: ref.zoneEntryId });
}

function isObjectRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0 &&
    typeof value.zoneEntryId === "number" && Number.isSafeInteger(value.zoneEntryId) && value.zoneEntryId >= 0;
}

function assertRequirement(requirement: TargetRequirement): void {
  if (!isRecord(requirement) || typeof requirement.id !== "string" || requirement.id.length === 0 ||
      !isRecord(requirement.filter)) {
    throw new TargetSelectionError("invalid-requirement", "Target requirement must have an id and object filter");
  }
  if (requirement.selection !== undefined &&
      !(["one", "any", "all", "up-to"] as readonly string[]).includes(requirement.selection)) {
    throw new TargetSelectionError("invalid-requirement", `Unknown target selection mode: ${String(requirement.selection)}`);
  }
}

function assertCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TargetSelectionError("invalid-bounds", `${label} must be a non-negative safe integer`);
  }
  return value;
}

export function targetBounds(requirement: TargetRequirement, availableCount: number): TargetBounds {
  assertRequirement(requirement);
  const available = assertCount(availableCount, "Available target count");
  const selection = requirement.selection ?? DEFAULT_SELECTION;
  const defaultMin = selection === "one" ? 1 : 0;
  const defaultMax = selection === "one" ? 1 : available;
  const min = assertCount(requirement.min ?? defaultMin, "Target minimum");
  const rawMax = requirement.max === null || requirement.max === undefined ? defaultMax : requirement.max;
  const max = assertCount(rawMax, "Target maximum");
  if (max < min) {
    throw new TargetSelectionError("invalid-bounds", "Target maximum must not be less than its minimum");
  }
  return Object.freeze({ min, max: Math.min(max, available) });
}

function sameLocation(left: LocationRef | null, right: LocationRef | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.type !== right.type) return false;
  if (left.type === "base" && right.type === "base") return left.player === right.player;
  if (left.type === "battlefield" && right.type === "battlefield") return left.id === right.id;
  return false;
}

function matchesRequirement(snapshot: ObjectSnapshot, requirement: TargetRequirement): boolean {
  return requirement.location === undefined || sameLocation(snapshot.location, requirement.location);
}

function defaultPending(ref: ObjectRef, snapshot: ObjectSnapshot): boolean {
  return snapshot.zone === "chain" && ref.id.length > 0;
}

function legalCandidates(
  context: ResolveContext,
  requirement: TargetRequirement,
  phase: TargetPlanPhase,
  options: TargetCandidateOptions
): ObjectRef[] {
  const refs: ObjectRef[] = [];
  const seen = new Set<string>();
  const pending = options.isPending ?? defaultPending;
  for (const candidate of context.query(requirement.filter)) {
    const ref = candidate.ref;
    const key = refKey(ref);
    if (seen.has(key)) continue;
    const current = context.object(ref);
    if (current === null || !matchesRequirement(current, requirement)) continue;
    if (pending(ref, current, phase)) continue;
    if (options.isLegal && !options.isLegal(current, phase)) continue;
    seen.add(key);
    refs.push(copyRef(ref));
  }
  return refs;
}

export function queryTargetCandidates(
  context: ResolveContext,
  requirement: TargetRequirement,
  options: TargetCandidateOptions = {}
): readonly ObjectRef[] {
  return legalCandidates(context, requirement, "finalize", options);
}

function choiceId(requirement: TargetRequirement, repeatIndex: number | undefined): string {
  return repeatIndex === undefined
    ? `target:${requirement.id}`
    : `target:${requirement.id}:repeat:${repeatIndex}`;
}

function chooseTargets(
  context: ResolveContext,
  requirement: TargetRequirement,
  options: TargetFinalizeOptions,
  candidates: readonly ObjectRef[],
  bounds: TargetBounds
): readonly ObjectRef[] {
  const explicit = options.selected ?? options.chosen;
  if (explicit !== undefined) return explicit;
  if (requirement.selection === "all") return candidates.slice(0, bounds.max);
  const answer = context.choose<readonly ObjectRef[]>({
    id: choiceId(requirement, options.repeatIndex),
    type: "select-objects",
    chooser: options.chooser ?? context.controller,
    visibility: options.visibility ?? "public",
    prompt: options.prompt,
    options: candidates,
    min: bounds.min,
    max: bounds.max
  });
  return answer;
}

function validateSelection(
  selected: readonly ObjectRef[],
  candidates: readonly ObjectRef[],
  bounds: TargetBounds
): readonly ObjectRef[] {
  if (!Array.isArray(selected)) {
    throw new TargetSelectionError("invalid-target-choice", "Target choice must be an array");
  }
  if (selected.length < bounds.min || selected.length > bounds.max) {
    throw new TargetSelectionError("invalid-target-choice", "Target choice is outside its required count");
  }
  const available = new Set(candidates.map(refKey));
  const seen = new Set<string>();
  const result: ObjectRef[] = [];
  for (const item of selected) {
    if (!isObjectRef(item)) {
      throw new TargetSelectionError("invalid-target-choice", "Target choice contains an invalid object reference");
    }
    const key = refKey(item);
    if (seen.has(key) || !available.has(key)) {
      throw new TargetSelectionError("invalid-target-choice", "Target choice contains a duplicate or illegal target");
    }
    seen.add(key);
    result.push(copyRef(item));
  }
  return Object.freeze(result);
}

function makePlan(
  requirement: TargetRequirement,
  selected: readonly ObjectRef[],
  options: Pick<TargetFinalizeOptions, "mode" | "repeatIndex">
): TargetPlan {
  return Object.freeze({
    requirement: Object.freeze({ ...requirement }),
    selected: Object.freeze(selected.map(copyRef)),
    lockedAt: "finalize",
    retestAtResolve: true,
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.repeatIndex === undefined ? {} : { repeatIndex: options.repeatIndex })
  });
}

function taxSpecs(
  tax: TargetFinalizeOptions["tax"],
  target: ObjectSnapshot,
  plan: TargetPlan
): readonly TargetTaxSpec[] {
  if (tax === undefined) return [];
  const value = typeof tax === "function" ? tax(target, plan) : tax;
  if (value === null || value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(item => {
    if (item.kind !== "deflect" || !Number.isSafeInteger(item.amount) || item.amount < 0) {
      throw new TargetSelectionError("invalid-requirement", "Deflect target tax must have a non-negative amount");
    }
    return item;
  });
}

function appendTaxes(
  context: ResolveContext,
  plan: TargetPlan,
  options: TargetFinalizeOptions
): void {
  if (options.tax === undefined || plan.selected.length === 0) return;
  const requests: TargetTaxRequest[] = [];
  for (const ref of plan.selected) {
    const snapshot = context.object(ref);
    if (snapshot === null) {
      throw new TargetSelectionError("invalid-target-choice", "Target disappeared while appending its Deflect tax");
    }
    for (const tax of taxSpecs(options.tax, snapshot, plan)) {
      if (tax.amount === 0) continue;
      requests.push({
        kind: "deflect",
        target: ref,
        payer: tax.payer ?? context.controller,
        amount: tax.amount,
        source: tax.source,
        targetPlan: plan
      });
    }
  }
  if (requests.length > 0 && !options.taxAdapter) {
    throw new TargetSelectionError("tax-adapter-required", "Deflect target selection requires a cost-plan tax adapter");
  }
  for (const request of requests) {
      const result = options.taxAdapter!.appendTargetTax(request);
      if (result?.status === "unpayable") {
        throw new TargetSelectionError("target-tax-unpayable", result.reason ?? "Deflect target tax is not payable");
      }
  }
}

export function finalizeTargetPlan(
  context: ResolveContext,
  requirement: TargetRequirement,
  options: TargetFinalizeOptions = {}
): TargetPlan {
  assertRequirement(requirement);
  const candidates = legalCandidates(context, requirement, "finalize", options);
  const bounds = targetBounds(requirement, candidates.length);
  if (candidates.length < bounds.min) {
    throw new TargetSelectionError("no-legal-targets", "The required target count is not available");
  }
  const selected = validateSelection(chooseTargets(context, requirement, options, candidates, bounds), candidates, bounds);
  const plan = makePlan(requirement, selected, options);
  appendTaxes(context, plan, options);
  const event: TargetsFinalizedEvent = Object.freeze({
    kind: "targets-finalized",
    phase: "finalize",
    plan,
    targets: plan.selected,
    ...(plan.repeatIndex === undefined ? {} : { repeatIndex: plan.repeatIndex }),
    reselected: options.reselected === true
  });
  options.onTargetsFinalized?.(event);
  for (const target of plan.selected) {
    options.onTargeted?.(Object.freeze({
      kind: "became-target",
      phase: "finalize",
      plan,
      target,
      ...(plan.repeatIndex === undefined ? {} : { repeatIndex: plan.repeatIndex }),
      reselected: options.reselected === true
    }));
  }
  return plan;
}

export function resolveTargetPlan(
  context: ResolveContext,
  plan: TargetPlan,
  options: TargetResolveOptions = {}
): TargetResolution {
  const legal = new Set(legalCandidates(context, plan.requirement, "resolve", options).map(refKey));
  const selected: ObjectRef[] = [];
  const invalid: ObjectRef[] = [];
  for (const ref of plan.selected) {
    if (legal.has(refKey(ref))) selected.push(copyRef(ref));
    else invalid.push(copyRef(ref));
  }
  const status: TargetResolutionStatus = invalid.length === 0
    ? "resolved"
    : selected.length === 0
      ? "ignored"
      : "partial";
  const resolution: TargetResolution = Object.freeze({
    status,
    plan,
    selected: Object.freeze(selected),
    invalid: Object.freeze(invalid),
    ...(status === "ignored" ? { reason: "mistargeted" as const } : {})
  });
  options.onTargetsResolved?.(Object.freeze({
    kind: "targets-resolved",
    phase: "resolve",
    plan,
    selected: resolution.selected,
    invalid: resolution.invalid,
    status
  }));
  return resolution;
}

export function reselectTargetPlan(
  context: ResolveContext,
  plan: TargetPlan,
  options: Omit<TargetFinalizeOptions, "mode" | "repeatIndex" | "reselected"> = {}
): TargetPlan {
  return finalizeTargetPlan(context, plan.requirement, {
    ...options,
    mode: plan.mode,
    repeatIndex: plan.repeatIndex,
    reselected: true
  });
}

export function finalizeRepeatedTargetPlans(
  context: ResolveContext,
  requirement: TargetRequirement,
  repeatCount: number,
  options: Omit<TargetFinalizeOptions, "repeatIndex" | "selected" | "chosen"> & {
    readonly selections?: readonly (readonly ObjectRef[])[];
  } = {}
): readonly TargetPlan[] {
  assertCount(repeatCount, "Repeat count");
  const plans: TargetPlan[] = [];
  for (let index = 0; index < repeatCount; index++) {
    plans.push(finalizeTargetPlan(context, requirement, {
      ...options,
      repeatIndex: index,
      ...(options.selections?.[index] === undefined ? {} : { selected: options.selections[index] })
    }));
  }
  return Object.freeze(plans);
}

export interface PickRequirement {
  readonly id: string;
  readonly options: readonly Value[];
  readonly min?: number;
  readonly max?: number | null;
  readonly selection?: TargetSelectionMode;
}

export interface PickPlan {
  readonly requirement: PickRequirement;
  readonly selected: readonly Value[];
  readonly lockedAt: "finalize";
}

function sameValue(left: Value, right: Value): boolean {
  if (Object.is(left, right)) return true;
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every(key =>
    rightKeys.includes(key) && sameValue(left[key]!, right[key]!));
}

export function finalizePick(
  context: ResolveContext,
  requirement: PickRequirement,
  selected?: readonly Value[]
): PickPlan {
  const available = requirement.options.length;
  const bounds = targetBounds({ filter: {}, ...requirement }, available);
  const answer = selected ?? (requirement.selection === "all"
    ? requirement.options.slice(0, bounds.max)
    : context.picks(requirement.id).map(value => value as Value));
  if (!Array.isArray(answer) || answer.length < bounds.min || answer.length > bounds.max) {
    throw new TargetSelectionError("invalid-target-choice", "Pick choice is outside its required count");
  }
  const picked: Value[] = [];
  for (const value of answer) {
    if (!requirement.options.some(option => sameValue(option, value)) || picked.some(previous => sameValue(previous, value))) {
      throw new TargetSelectionError("invalid-target-choice", "Pick choice contains an unavailable or duplicate value");
    }
    picked.push(value);
  }
  return Object.freeze({
    requirement: Object.freeze({ ...requirement }),
    selected: Object.freeze(picked),
    lockedAt: "finalize"
  });
}

export const finalizeTargets = finalizeTargetPlan;
export const resolveTargets = resolveTargetPlan;
export const retestTargetPlan = resolveTargetPlan;
export const queryTargets = queryTargetCandidates;

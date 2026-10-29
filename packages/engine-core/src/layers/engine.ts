import type { Condition, Expr, ObjectRef } from "@riftbound/card-dsl";
import type {
  ContinuousEffectSpec,
  Duration,
  ObjectSnapshot,
  ResolveContext,
} from "../effects/contract.js";
import { evaluateCondition } from "../effects/interpreter/condition.js";
import { evaluateExpression, type ExpressionContext } from "../effects/interpreter/expr.js";
import { resolveLayerEffectExpressions } from "../effects/interpreter/expr-ext/layers.js";
import { MissingInformation } from "../effects/interpreter/values.js";
import { additionalMightReductions } from "../effects/modifiers/query.js";
import { getTimingPoint, type TimingPointId } from "../events/timing-points.js";
import type { DuelDerivedMightEvaluatorV2 } from "../combat/derived-might.js";
import { matchesObjectFilter, objectRefFrom } from "./filter.js";
import { ContinuousEffectRegistry } from "./duration.js";
import { copyCharacteristics } from "./copy.js";
import { EQUIPMENT_MIGHT_BONUS_EFFECT_KIND, isAttachedEquipmentBonus } from "./ops/index.js";
import {
  LAYER_ORDER,
  refKey,
  sameRef,
  type ActionTiming,
  type DerivedMightResolver,
  type LayeredObjectSnapshot,
  type LayerEngineOptions,
  type MovementPermissions,
  type RegisteredContinuousEffect,
  type TimingEvent,
} from "./types.js";

type AnyRecord = Record<string, unknown>;
type MutableSnapshot = { -readonly [Key in keyof LayeredObjectSnapshot]: LayeredObjectSnapshot[Key] } & AnyRecord;

/**
 * Cached layered snapshots are recursively frozen. Their public readers never
 * mutate nested characteristics, so retaining those immutable field objects is
 * safe and avoids rebuilding them on every detached wrapper.
 */
type FrozenSnapshot = LayeredObjectSnapshot & {
  readonly printed: ObjectSnapshot;
  readonly types: readonly string[];
  readonly tags: readonly string[];
  readonly keywords: ObjectSnapshot["keywords"];
  readonly power: readonly string[] | null;
  readonly actionTimings: readonly ActionTiming[];
  readonly availableTimings: readonly ActionTiming[];
  readonly movement: MovementPermissions;
};

type AppliedArithmetic = {
  readonly effect: AnyRecord;
};

const EMPTY_MOVEMENT: MovementPermissions = Object.freeze({
  allowed: true,
  canMove: true,
  canGank: false,
  restrictions: Object.freeze([]),
});

const DEFAULT_TIMINGS: readonly ActionTiming[] = Object.freeze([]);
const EMPTY_ARRAY: readonly never[] = Object.freeze([]);
const EMPTY_SNAPSHOT_FIELDS = Object.freeze({
  types: EMPTY_ARRAY,
  tags: EMPTY_ARRAY,
  keywords: EMPTY_ARRAY,
  power: EMPTY_ARRAY,
  actionTimings: EMPTY_ARRAY,
  availableTimings: EMPTY_ARRAY,
  movement: EMPTY_MOVEMENT,
});

/** Coarse observable counters for profiling layer semantics without changing them. */
export interface LayerDiagnostics {
  readonly evaluateCalls: number;
  readonly evaluateAllCalls: number;
  readonly attachmentSignatureCalls: number;
  readonly attachmentSignatureReuses: number;
  readonly dependencyCalls: number;
  readonly dependencyCacheHits: number;
  readonly dependencyRestarts: number;
  readonly groupEvaluations: number;
  readonly dependencyGroups: number;
  readonly dependencyCycleGroups: number;
  readonly singletonGroups: number;
  readonly multiObjectGroups: number;
  readonly passes: number;
  readonly effectApplications: number;
  readonly effectDisqualifications: number;
  readonly effectReevaluations: number;
  readonly snapshotCopies: number;
  readonly publicSnapshotCopies: number;
  /** RIFT-1109 command-scoped full-plan cache activity. */
  readonly planCacheHits: number;
  readonly planCacheReferenceHits: number;
  readonly planCacheMisses: number;
  readonly planCacheBypasses: number;
  readonly planCacheGenerationInvalidations: number;
  readonly planCacheRegistryInvalidations: number;
  readonly planCacheDerivedInvalidations: number;
  readonly planCacheTimingInvalidations: number;
  readonly planCacheAttachmentInvalidations: number;
  readonly planCacheNestedInvalidations: number;
}

const ZERO_LAYER_DIAGNOSTICS: LayerDiagnostics = Object.freeze({
  evaluateCalls: 0,
  evaluateAllCalls: 0,
  attachmentSignatureCalls: 0,
  attachmentSignatureReuses: 0,
  dependencyCalls: 0,
  dependencyCacheHits: 0,
  dependencyRestarts: 0,
  groupEvaluations: 0,
  dependencyGroups: 0,
  dependencyCycleGroups: 0,
  singletonGroups: 0,
  multiObjectGroups: 0,
  passes: 0,
  effectApplications: 0,
  effectDisqualifications: 0,
  effectReevaluations: 0,
  snapshotCopies: 0,
  publicSnapshotCopies: 0,
  planCacheHits: 0,
  planCacheReferenceHits: 0,
  planCacheMisses: 0,
  planCacheBypasses: 0,
  planCacheGenerationInvalidations: 0,
  planCacheRegistryInvalidations: 0,
  planCacheDerivedInvalidations: 0,
  planCacheTimingInvalidations: 0,
  planCacheAttachmentInvalidations: 0,
  planCacheNestedInvalidations: 0,
});
function record(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? value as AnyRecord : {};
}
function array<T>(value: readonly T[] | undefined): readonly T[] {
  if (value === undefined) return EMPTY_ARRAY as readonly T[];
  if (Object.isFrozen(value)) return value;
  return Object.freeze([...(value ?? [])]);
}

function keywords(value: ObjectSnapshot["keywords"]): ObjectSnapshot["keywords"] {
  if (Object.isFrozen(value) && value.every(keyword => Object.isFrozen(keyword))) return value;
  return Object.freeze(value.map(keyword => Object.freeze({ ...keyword })));
}

function movement(value: MovementPermissions): MovementPermissions {
  if (Object.isFrozen(value) && Object.isFrozen(value.restrictions)) return value;
  return Object.freeze({
    allowed: value.allowed !== false,
    canMove: value.canMove !== false,
    canGank: value.canGank === true,
    restrictions: array(value.restrictions),
  });
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function cloneSnapshot(source: ObjectSnapshot): FrozenSnapshot {
  const input = source as ObjectSnapshot & Partial<LayeredObjectSnapshot> & AnyRecord;
  const cardId = input.cardId === null ? null : input.cardId ?? input.ref.id;
  const permissions = input.movement ?? EMPTY_MOVEMENT;
  // A raw host snapshot is both the current and printed state at the start of
  // evaluation. Build those immutable field arrays once; every later layer
  // operation replaces a field instead of mutating the shared frozen value.
  const rawFields = input.printed === undefined ? snapshotFields(source) : undefined;
  const actionTimings = rawFields?.actionTimings ?? array(input.actionTimings ?? input.availableTimings ?? DEFAULT_TIMINGS);
  const frozenInput = source as Partial<FrozenSnapshot>;
  const frozen = Object.isFrozen(source) &&
    Object.isFrozen(frozenInput.printed) && Object.isFrozen(frozenInput.types) &&
    Object.isFrozen(frozenInput.tags) && Object.isFrozen(frozenInput.keywords) &&
    (frozenInput.power == null || Object.isFrozen(frozenInput.power)) &&
    Object.isFrozen(actionTimings) && Object.isFrozen(permissions) &&
    Object.isFrozen(permissions.restrictions);
  const printed = frozen
    ? frozenInput.printed as ObjectSnapshot
    : rawFields ?? snapshotFields(input.printed!);
  const empty = source.types.length === 0 && source.tags.length === 0 && source.keywords.length === 0 &&
    source.power !== null && source.power.length === 0 && actionTimings.length === 0 &&
    permissions === EMPTY_MOVEMENT;
  return Object.freeze({
    ...source,
    cardId,
    types: empty ? EMPTY_SNAPSHOT_FIELDS.types : frozen ? frozenInput.types : rawFields?.types ?? array(source.types),
    tags: empty ? EMPTY_SNAPSHOT_FIELDS.tags : frozen ? frozenInput.tags : rawFields?.tags ?? array(source.tags),
    keywords: empty ? EMPTY_SNAPSHOT_FIELDS.keywords : frozen ? frozenInput.keywords : rawFields?.keywords ?? keywords(source.keywords),
    power: source.power === null ? null : empty ? EMPTY_SNAPSHOT_FIELDS.power : frozen ? frozenInput.power as readonly string[] : rawFields?.power as readonly string[] ?? array(source.power),
    printed,
    actionTimings,
    availableTimings: actionTimings,
    movement: empty ? EMPTY_SNAPSHOT_FIELDS.movement : frozen ? permissions : rawFields?.movement ?? movement(permissions),
    text: input.text === undefined ? null : input.text as string | null,
    effectText: input.effectText === undefined ? (input.text as string | null | undefined) ?? null : input.effectText as string | null,
  }) as unknown as FrozenSnapshot;
}

/** Freeze nested fields reused by cached and detached snapshot wrappers. */
function snapshotFields(source: ObjectSnapshot): FrozenSnapshot {
  const input = source as ObjectSnapshot & Partial<LayeredObjectSnapshot> & AnyRecord;
  const actionTimings = array(input.actionTimings ?? input.availableTimings ?? DEFAULT_TIMINGS);
  if (Object.isFrozen(source) && Object.isFrozen(input.types) && Object.isFrozen(input.tags) &&
      Object.isFrozen(input.keywords) && input.keywords.every(keyword => Object.isFrozen(keyword)) &&
      (input.power == null || Object.isFrozen(input.power)) && Object.isFrozen(actionTimings) &&
      input.movement !== undefined && Object.isFrozen(input.movement) &&
      Object.isFrozen(input.movement.restrictions)) return source as FrozenSnapshot;
  const fields = Object.freeze({
    ...source,
    types: array(source.types),
    tags: array(source.tags),
    keywords: keywords(source.keywords),
    power: source.power === null ? null : array(source.power),
    actionTimings,
    availableTimings: actionTimings,
    movement: movement(input.movement ?? EMPTY_MOVEMENT),
  });
  return fields as unknown as FrozenSnapshot;
}

function property(object: LayeredObjectSnapshot, key: string): unknown {
  if (key === "domain") return object.power?.[0] ?? null;
  if (key === "domains") return object.power;
  return (object as unknown as AnyRecord)[key];
}

function refFrom(value: unknown): ObjectRef | null {
  if (typeof value === "object" && value !== null && "ref" in value) {
    return objectRefFrom((value as AnyRecord).ref);
  }
  return objectRefFrom(value);
}

function valueOf(
  value: unknown,
  target: LayeredObjectSnapshot,
  resolve: (ref: ObjectRef) => LayeredObjectSnapshot | null,
): unknown {
  if (typeof value !== "object" || value === null) return value;
  const item = value as AnyRecord;
  if (item.kind === "constant" || item.kind === "literal") return item.value;
  if (item.kind === "object-property" || item.kind === "object-attribute") {
    const ref = refFrom(item.object);
    const object = ref === null ? null : resolve(ref);
    return object === null ? null : property(object, String(item.property ?? item.attribute));
  }
  if (item.kind === "object-ref" || item.kind === "ref") {
    const ref = refFrom(item.ref ?? item.object);
    return ref === null ? null : resolve(ref);
  }
  if (item.kind === "add" || item.kind === "subtract" || item.kind === "multiply") {
    const left = valueOf(item.left, target, resolve);
    const right = valueOf(item.right, target, resolve);
    if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) return null;
    return item.kind === "add" ? left + right : item.kind === "subtract" ? left - right : left * right;
  }
  return value;
}

function numberValue(
  effect: AnyRecord,
  target: LayeredObjectSnapshot,
  resolve: (ref: ObjectRef) => LayeredObjectSnapshot | null,
  fallback = 0,
): number {
  const scalar = effect.amount !== undefined ? effect.amount : effect.value !== undefined ? effect.value : effect.delta;
  const value = valueOf(scalar, target, resolve);
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new MissingInformation("Layer arithmetic requires an available numeric value");
  return value;
}

function effectKind(effect: AnyRecord): string {
  return String(record(effect).kind ?? "").toLowerCase();
}

function conditionMatches(
  effect: AnyRecord,
  object: LayeredObjectSnapshot,
  environment: () => ExpressionContext,
): boolean {
  const condition = effect.condition ?? effect.when;
  if (condition === undefined) return true;
  if (typeof condition === "function") return Boolean((condition as (object: LayeredObjectSnapshot) => unknown)(object));
  if (condition === true) return true;
  if (condition === false) return false;
  const item = record(condition);
  if (item.kind === "always") return true;
  if (item.kind === "never") return false;
  if (item.kind === "type") return object.types.includes(String(item.type));
  if (item.kind === "has-tag") return object.tags.includes(String(item.tag));
  if (item.kind === "has-keyword") return object.keywords.some(keyword => keyword.id === item.keyword || keyword.id === item.id);
  // Evaluate the closed Condition vocabulary, including logical composition.
  // Unknown conditions must never silently authorize a continuous effect.
  try { return evaluateCondition(condition as Condition, environment()); }
  catch (error) {
    if (error instanceof MissingInformation) return false;
    throw error;
  }
}

/** Scalar expression slots that require the per-effect layer environment. */
function needsLayerEnvironment(effect: AnyRecord): boolean {
  if (effect.per !== undefined) return true;
  for (const key of ["amount", "value", "delta", "keywordValue"] as const) {
    const value = record(effect[key]);
    if (value.kind !== undefined) return true;
  }
  return false;
}

function keywordValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function applyKeyword(target: MutableSnapshot, id: string, value: unknown, remove = false): void {
  const keywords = [...target.keywords];
  const index = keywords.findIndex(keyword => keyword.id === id);
  if (remove) {
    if (index >= 0) keywords.splice(index, 1);
  } else if (index >= 0) {
    const previous = keywords[index];
    keywords[index] = Object.freeze({ id, value: keywordValue(value) ?? previous?.value });
  } else {
    keywords.push(Object.freeze({ id, ...(keywordValue(value) === undefined ? {} : { value: keywordValue(value) }) }));
  }
  target.keywords = Object.freeze(keywords);
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === "string") as string[] : typeof value === "string" ? [value] : [];
}

function setField(target: MutableSnapshot, key: string, value: unknown): void {
  if (key === "domain") key = "power";
  if (key === "domains") key = "power";
  if (key === "types" || key === "tags" || key === "power") {
    (target as unknown as AnyRecord)[key] = value === null ? null : Object.freeze(asStringList(value));
  } else if (key === "keywords") {
    target.keywords = Object.freeze(Array.isArray(value) ? value.map(item => Object.freeze(record(item) as { id: string; value?: number })) : []);
  } else if (key in target || ["might", "energy", "name", "cardId", "text", "effectText"].includes(key)) {
    target[key] = value;
  }
}

function applyTrait(
  target: MutableSnapshot,
  effect: AnyRecord,
  resolve: (ref: ObjectRef) => LayeredObjectSnapshot | null,
): void {
  const kind = effectKind(effect);
  const id = String(effect.keyword ?? effect.id ?? effect.name ?? effect.value ?? "");
  const value = valueOf(effect.value ?? effect.amount, target, resolve);
  if (kind === "set-might" || kind === "continuous.base-might") {
    if (typeof value === "number" && Number.isFinite(value)) target.might = value;
  } else if (kind === "set" || kind === "set-property" || kind === "set-trait" || kind === "trait") {
    setField(target, String(effect.property ?? effect.attribute ?? effect.field), value);
  } else if (kind === "set-type" || kind === "set-types") {
    setField(target, "types", effect.types ?? effect.type ?? value);
  } else if (kind === "add-type" || kind === "gain-type" || kind === "grant-type") {
    target.types = unique([...target.types, ...asStringList(effect.types ?? effect.type ?? value)]);
  } else if (kind === "remove-type" || kind === "lose-type") {
    const removed = new Set(asStringList(effect.types ?? effect.type ?? value));
    target.types = array(target.types.filter(type => !removed.has(type)));
  } else if (kind === "add-tag" || kind === "gain-tag" || kind === "grant-tag") {
    target.tags = unique([...target.tags, ...asStringList(effect.tags ?? effect.tag ?? value)]);
  } else if (kind === "remove-tag" || kind === "lose-tag") {
    const removed = new Set(asStringList(effect.tags ?? effect.tag ?? value));
    target.tags = array(target.tags.filter(tag => !removed.has(tag)));
  } else if (kind === "set-tag" || kind === "set-tags") {
    target.tags = array(asStringList(effect.tags ?? effect.tag ?? value));
  } else if (kind === "set-power" || kind === "set-domain" || kind === "set-domains") {
    setField(target, "power", effect.power ?? effect.domains ?? effect.domain ?? value);
  } else if (kind === "set-name") {
    target.name = String(effect.name ?? value);
  } else if (kind === "set-card-id") {
    target.cardId = value === null ? null : String(value);
  }
}

function applyAbility(
  target: MutableSnapshot,
  effect: AnyRecord,
  resolve: (ref: ObjectRef) => LayeredObjectSnapshot | null,
): void {
  const kind = effectKind(effect);
  const value = valueOf(effect.value ?? effect.amount, target, resolve);
  const keywords = effect.keywords ?? effect.keyword ?? effect.id;
  if (kind.includes("keyword") || kind === "grant" || kind === "ability") {
    for (const keyword of Array.isArray(keywords) ? keywords : [keywords]) {
      if (typeof keyword === "string") applyKeyword(target, keyword, effect.keywordValue ?? value);
      else if (typeof keyword === "object" && keyword !== null) {
        const item = keyword as AnyRecord;
        applyKeyword(target, String(item.id ?? item.keyword), item.value);
      }
    }
  }
  if (kind.includes("timing") || effect.timing !== undefined || effect.speed !== undefined) {
    const timings = asStringList(effect.timings ?? effect.timing ?? effect.speed ?? value);
    target.actionTimings = unique([...target.actionTimings, ...timings]);
    target.availableTimings = target.actionTimings;
  }
  if (kind.includes("movement") || effect.movement !== undefined || effect.permission !== undefined) {
    const movement = record(effect.movement ?? effect.permission);
    const restrictions = [...target.movement.restrictions, ...asStringList(effect.restriction ?? movement.restriction)];
    const allowed = movement.allowed === undefined ? target.movement.allowed : Boolean(movement.allowed);
    const canMove = movement.canMove === undefined ? (effect.canMove === undefined ? target.movement.canMove : Boolean(effect.canMove)) : Boolean(movement.canMove);
    const canGank = movement.canGank === undefined ? (effect.canGank === undefined ? target.movement.canGank : Boolean(effect.canGank)) : Boolean(movement.canGank);
    target.movement = Object.freeze({ allowed, canMove, canGank, restrictions: unique(restrictions) });
  }
  if (kind.includes("text") || kind.includes("copy-text")) {
    const text = String(effect.text ?? value ?? "");
    target.text = text;
    target.effectText = text;
  }
}

function applyCopy(
  target: MutableSnapshot,
  effect: AnyRecord,
  resolve: (ref: ObjectRef) => LayeredObjectSnapshot | null,
): void {
  const kind = effectKind(effect);
  if (!kind.includes("copy") && effect.copyFrom === undefined && effect.source === undefined) return;
  const sourceRef = refFrom(effect.source ?? effect.from ?? effect.copyFrom ?? effect.object);
  if (sourceRef === null) return;
  const source = resolve(sourceRef);
  if (source === null) return;
  if (kind.includes("text")) {
    target.text = source.text ?? source.effectText;
    target.effectText = target.text;
    return;
  }
  const properties = asStringList(effect.properties ?? effect.characteristics);
  const copied = copyCharacteristics(target, source, properties.length === 0 ? undefined : properties);
  Object.assign(target, copied);
}

function applyArithmetic(
  target: MutableSnapshot,
  effect: AnyRecord,
  resolve: (ref: ObjectRef) => LayeredObjectSnapshot | null,
): void {
  const kind = effectKind(effect);
  const amount = numberValue(effect, target, resolve);
  if (typeof effect.snapshotDelta === "number") {
    if (target.might !== null) target.might += effect.snapshotDelta;
  } else if (kind === "set" || kind === "set-might" || kind === "might-set" || kind === "set-power-value") {
    const value = valueOf(effect.value ?? effect.amount, target, resolve);
    if (typeof value === "number" && Number.isFinite(value)) target.might = value;
  } else if (kind.includes("multiply") || kind.includes("double")) {
    if (target.might !== null) target.might *= kind.includes("double") ? 2 : amount;
  } else if (kind.includes("decrease") || kind.includes("subtract") || kind.includes("debuff") || amount < 0) {
    const reduction = typeof effect.snapshottedReduction === "number" ? effect.snapshottedReduction : amount;
    if (target.might !== null) target.might -= Math.abs(reduction);
  } else if (kind === EQUIPMENT_MIGHT_BONUS_EFFECT_KIND ||
    kind.includes("increase") || kind.includes("add") || kind.includes("buff") || kind.includes("might")) {
    if (target.might !== null) target.might += amount;
  }
  if (kind === "add-buff" || kind === "buff") target.buffs += amount;
  if (kind === "remove-buff" || kind === "spend-buff") target.buffs = Math.max(0, target.buffs - amount);
  if (kind.includes("keyword") && (effect.keyword ?? effect.id) !== undefined) {
    const id = String(effect.keyword ?? effect.id);
    const keyword = target.keywords.find(item => item.id === id);
    if (keyword?.value !== undefined) applyKeyword(target, id, keyword.value + amount);
  }
}

function detachIfUnit(target: MutableSnapshot): void {
  if (target.attachedTo !== null && target.types.includes("unit")) target.attachedTo = null;
}

// A newly discovered object cycle restarts the read, never a game action.
class LayerDependencyRestart extends Error {}
class CopyDependencyRestart extends Error {}
type AppliedEffect = { readonly entry: RegisteredContinuousEffect; readonly effect: AnyRecord };

/**
 * RIFT-999: derived layer state that a host-backed layered view depends on
 * (keyword-grant expansions) bumps this epoch on every change, so a cached
 * view keyed on it can never outlive that state.
 */
let derivedLayerEpochCount = 0;
export function derivedLayerEpoch(): number { return derivedLayerEpochCount; }
export function bumpDerivedLayerEpoch(): void { derivedLayerEpochCount++; }
const OBJECT_IDS = new WeakMap<object, number>();
const DEEPLY_FROZEN = new WeakMap<object, boolean>();
let objectId = 0;
function deeplyFrozen(value: unknown, visiting = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true;
  const object = value as object;
  const cached = DEEPLY_FROZEN.get(object);
  if (cached !== undefined) return cached;
  if (!Object.isFrozen(object)) {
    DEEPLY_FROZEN.set(object, false);
    return false;
  }
  if (visiting.has(object)) return true;
  visiting.add(object);
  const result = Reflect.ownKeys(object).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor !== undefined && 'value' in descriptor && deeplyFrozen(descriptor.value, visiting);
  });
  visiting.delete(object);
  DEEPLY_FROZEN.set(object, result);
  return result;
}
/**
 * Exact immutable host generation. Frozen identities are stable; a mutable
 * fixture always produces a fresh authority and therefore fails closed.
 */
export function layerObjectGeneration(value: readonly ObjectSnapshot[]): string {
  if (!value.every(object => deeplyFrozen(object))) return `mutable:${++objectId}`;
  return value.map(object => {
    const existing = OBJECT_IDS.get(object);
    if (existing !== undefined) return existing;
    const id = ++objectId;
    OBJECT_IDS.set(object, id);
    return id;
  }).join('.');
}
/** Exact identity generation for an immutable host view; mutable input fails closed. */
export function hostObjectGeneration(value: readonly ObjectSnapshot[]): string {
  if (!value.every(object => deeplyFrozen(object))) return `mutable:${++objectId}`;
  const ids = value.map(object => {
    const existing = OBJECT_IDS.get(object);
    if (existing !== undefined) return existing;
    const id = ++objectId;
    OBJECT_IDS.set(object, id);
    return id;
  });
  // Object arrays from the production host are immutable views. Keep the
  // array identity as part of the generation so repeated calls over a stable
  // generation reuse while any replaced view fails closed.
  const existingArray = OBJECT_IDS.get(value);
  const arrayId = existingArray ?? ++objectId;
  if (existingArray === undefined) OBJECT_IDS.set(value, arrayId);
  return `${arrayId}:${ids.join('.')}`;
}

export class LayerEngine {
  readonly registry: ContinuousEffectRegistry;
  private readonly objects = new Map<string, ObjectSnapshot>();
  private readonly derivedMight?: DerivedMightResolver;
  private timingPoint?: TimingPointId;
  private cache = new Map<string, LayeredObjectSnapshot>();
  private evaluating = new Set<string>();
  private partial = new Map<string, LayeredObjectSnapshot>();
  private copyEvaluating = new Set<string>();
  private copyPartial = new Map<string, LayeredObjectSnapshot>();
  private copyCache = new Map<string, LayeredObjectSnapshot>();
  private copyFrames: string[][] = [];
  private copyGroups = new Map<string, Set<string>>();
  private registryRevision = -1;
  private attachmentRevision?: string;
  private attachmentObjects: readonly ObjectSnapshot[] = [];
  private immutableAttachmentObjects = false;
  private readonly diagnosticsState = { ...ZERO_LAYER_DIAGNOSTICS };
  private diagnosticsEnabled = false;
  private immutableSnapshotReuseEnabled = true;
  /** Normalized raw snapshots remain reusable until the explicit object boundary. */
  private baseSnapshots = new WeakMap<ObjectSnapshot, FrozenSnapshot>();
  private depth = 0;
  /** True while this engine is inside evaluate/evaluateAll (reentrant reads). */
  get inEvaluation(): boolean { return this.depth > 0; }
  get diagnostics(): LayerDiagnostics { return Object.freeze({ ...this.diagnosticsState }); }
  /** Reset counters without changing cached semantic state. */
  resetDiagnostics(): void {
    this.diagnosticsEnabled = true;
    Object.assign(this.diagnosticsState, ZERO_LAYER_DIAGNOSTICS);
  }
  enableDiagnostics(): void { this.diagnosticsEnabled = true; }
  /** Test/diagnostic switch. Production defaults to enabled. */
  setPlanCacheEnabled(enabled: boolean): void { this.commandPlanDefaultEnabled = enabled; }
  get planCacheEnabled(): boolean { return this.commandPlanDefaultEnabled; }
  /** Test switch for cache-on/off equivalence; production defaults to enabled. */
  setImmutableSnapshotReuseEnabled(enabled: boolean): void { this.immutableSnapshotReuseEnabled = enabled; }
  private count(field: keyof LayerDiagnostics): void {
    if (!this.diagnosticsEnabled) return;
    this.diagnosticsState[field]++;
  }
  private frames: string[][] = [];
  private groups = new Map<string, Set<string>>();
  private groupView = new Map<string, LayeredObjectSnapshot>();
  private currentObject?: string;
  private restartRequested = false;
  private activeEffectsCache?: {
    readonly revision: number;
    readonly objectCount: number;
    readonly entries: readonly RegisteredContinuousEffect[];
  };
  /**
   * Non-passive reductions remember their total only for the arithmetic entry
   * being applied. The same modifier remains available to other eligible
   * reductions, while later registry changes cannot rewrite this entry's
   * remembered value (CR 479.4.b).
   */
  private readonly arithmeticSnapshots = new WeakMap<RegisteredContinuousEffect, Map<string, number>>();
  /** Synthetic registrations for printed Equipment Might Bonuses (CR 137.3). */
  private readonly attachmentBonuses = new Map<string, RegisteredContinuousEffect>();
  private readonly bonusOwnerRefs = new WeakMap<RegisteredContinuousEffect, ObjectRef>();
  /** Increments at every explicit object boundary, including a reused Map. */
  private objectBoundary = 0;
  private derivedEffectsCache?: {
    readonly active: readonly RegisteredContinuousEffect[];
    readonly boundary: number;
    readonly bonusSize: number;
    readonly effects: readonly RegisteredContinuousEffect[];
  };
  /** RIFT-1109 command-scoped complete plan; its lifetime is one atomic window. */
  private commandPlan?: {
    enabled: boolean;
    disabled: boolean;
    authority: string;
    key?: string;
    view?: readonly LayeredObjectSnapshot[];
    lastCompletedKey?: string;
  };
  private commandPlanDefaultEnabled = true;
  /** Exact generation and generation components used by the last completed plan. */
  private lastCompletedPlan?: {
    readonly authority: string;
    readonly registryRevision: number;
    readonly derivedEpoch: number;
    readonly timingPoint: string | null;
    readonly attachmentRevision: string;
  };
  constructor(
    objects: readonly ObjectSnapshot[] | ReadonlyMap<string, ObjectSnapshot>,
    registry = new ContinuousEffectRegistry(),
    options: LayerEngineOptions = {},
  ) {
    this.replaceObjects(objects);
    this.registry = registry;
    this.derivedMight = options.derivedMight;
    this.timingPoint = options.timingPoint;
    this.rebuildAttachmentBonuses();
    this.refreshAttachmentSignature();
    this.registryRevision = registry.revision;
  }

  addContinuous(effect: ContinuousEffectSpec, duration: Duration, timestamp?: number): RegisteredContinuousEffect {
    const entry = this.registry.register(effect, duration, timestamp);
    this.invalidate();
    return entry;
  }

  register(effect: ContinuousEffectSpec, duration: Duration, timestamp?: number): RegisteredContinuousEffect {
    return this.addContinuous(effect, duration, timestamp);
  }

  removeContinuous(id: string): boolean {
    const removed = this.registry.remove(id);
    if (removed) this.invalidate();
    return removed;
  }

  setObjects(
    objects: readonly ObjectSnapshot[] | ReadonlyMap<string, ObjectSnapshot>,
    preserveCommandPlan = false,
  ): void {
    this.replaceObjects(objects);
    this.objectBoundary++;
    this.rebuildAttachmentBonuses();
    this.invalidate(preserveCommandPlan);
    this.refreshAttachmentSignature();
    // `setObjects` is itself an object boundary. A later host read may reuse
    // the plan after one full post-reload pass; this call never reinstalls
    // the prior view or claims it already covers the new boundary.
  }

  private rebuildAttachmentBonuses(): void {
    const live = new Set<string>();
    for (const object of this.objects.values()) {
      if (!object.types.includes("gear") || !object.tags.includes("Equipment") || object.might === null) continue;
      const id = `equipment-might-bonus:${refKey(object.ref)}`;
      live.add(id);
      const existing = this.attachmentBonuses.get(id);
      const owner = existing === undefined ? undefined : this.bonusOwnerRefs.get(existing);
      if (existing !== undefined && owner !== undefined && refKey(owner) === refKey(object.ref) &&
        (existing.effect.effect as AnyRecord).amount === object.might) continue;
      const entry = Object.freeze({
        effect: Object.freeze({
          id,
          layer: "arithmetic" as const,
          source: object.ref,
          filter: {},
          effect: Object.freeze({ kind: EQUIPMENT_MIGHT_BONUS_EFFECT_KIND, amount: object.might }),
        }),
        duration: Object.freeze({ type: "permanent" as const }),
        timestamp: 0,
        sequence: 0,
      });
      this.attachmentBonuses.set(id, entry);
      this.bonusOwnerRefs.set(entry, object.ref);
    }
    for (const [id, entry] of this.attachmentBonuses) {
      const owner = this.bonusOwnerRefs.get(entry);
      if (owner === undefined || id !== `equipment-might-bonus:${refKey(owner)}`) this.attachmentBonuses.delete(id);
    }
  }

  private refreshAttachmentSignature(): void {
    this.attachmentRevision = this.attachmentSignature();
    this.attachmentObjects = [...this.objects.values()];
    this.immutableAttachmentObjects = this.attachmentObjects.every(object =>
      Object.isFrozen(object) && Object.isFrozen(object.ref) && Object.isFrozen(object.types) &&
      Object.isFrozen(object.tags) && (object.attachedTo === null || Object.isFrozen(object.attachedTo)));
  }

  private invalidate(preserveCommandPlan = false): void {
    this.cache.clear();
    this.copyCache.clear();
    this.activeEffectsCache = undefined;
    this.baseSnapshots = new WeakMap();
    if (this.depth === 0) {
      this.partial.clear();
      this.copyPartial.clear();
      this.groups.clear();
      this.copyGroups.clear();
    }
    if (!preserveCommandPlan) this.invalidateCommandPlan();
  }

  /** Direct registry writes between reads use the same invalidation as public mutations. */
  private syncRegistry(): void {
    const revision = this.registry.revision;
    if (this.registryRevision === revision) return;
    this.registryRevision = revision;
    this.invalidate();
  }

  private raw(ref: ObjectRef): ObjectSnapshot | null {
    return this.objects.get(refKey(ref)) ?? null;
  }

  private copySnapshot(source: ObjectSnapshot): FrozenSnapshot {
    this.count("snapshotCopies");
    // Derived snapshots are recursively frozen. Reusing their immutable field
    // identities avoids rebuilding every array/object on each public detach.
    const input = source as Partial<LayeredObjectSnapshot>;
    if (this.immutableSnapshotReuseEnabled && input.printed !== undefined && input.movement !== undefined &&
        (input.actionTimings !== undefined || input.availableTimings !== undefined) && deeplyFrozen(source)) {
      return Object.freeze({ ...source }) as unknown as FrozenSnapshot;
    }
    return cloneSnapshot(source);
  }

  private replaceObjects(objects: readonly ObjectSnapshot[] | ReadonlyMap<string, ObjectSnapshot>): void {
    this.objects.clear();
    if (objects instanceof Map) for (const [key, object] of objects) this.objects.set(key, object);
    else for (const object of objects as readonly ObjectSnapshot[]) this.objects.set(refKey(object.ref), object);
  }

  /** Reuse the normalized immutable input for this explicit object boundary. */
  private baseSnapshot(source: ObjectSnapshot): FrozenSnapshot {
    const cached = this.baseSnapshots.get(source);
    if (cached !== undefined) return cached;
    const normalized = this.copySnapshot(source);
    this.baseSnapshots.set(source, normalized);
    return normalized;
  }

  /**
   * A spell's arithmetic effect can outlive the chain incarnation that created
   * it. The controller remains a stable source fact even when the card moved to
   * Trash and received a new zone-entry identity, so fall back to the same
   * object id before deciding that the source is unavailable.
   */
  private sourceObject(ref: ObjectRef): ObjectSnapshot | null {
    const exact = this.raw(ref);
    if (exact !== null) return exact;
    for (const object of this.objects.values()) if (object.ref.id === ref.id) return object;
    return null;
  }

  private resolve(ref: ObjectRef): LayeredObjectSnapshot | null {
    return this.evaluate(ref);
  }

  private layerEnvironment(entry: RegisteredContinuousEffect, target: LayeredObjectSnapshot): ExpressionContext {
    const sourceRef = entry.effect.source ?? target.ref;
    const source = () => {
      const snapshot = sameRef(sourceRef, target.ref) ? target : this.resolve(sourceRef);
      if (snapshot === null) throw new MissingInformation("Continuous effect source is unavailable");
      return snapshot;
    };
    // Layers own object characteristics, not player resources, history, picks,
    // or last-known information. Unavailable host capabilities fail closed.
    const reads = {
      get source() { return source(); },
      get controller() { return source().controller; },
      timingPoint: this.timingPoint ?? "cleanup-start",
      object: (ref: ObjectRef) => this.resolve(ref),
      query: () => this.evaluateAll(),
    };
    const context = new Proxy(reads, { get(object, key) {
      if (key in object) return Reflect.get(object, key);
      throw new MissingInformation(`Layer expression requires host capability: ${String(key)}`);
    } }) as unknown as ResolveContext;
    return {
      context, host: sourceRef,
      linked: () => { throw new MissingInformation("Layer expression requires linked values"); },
      canLookBack: () => false,
      isIgnored: () => false,
    };
  }

  private layerMatches(entry: RegisteredContinuousEffect, target: LayeredObjectSnapshot): boolean {
    if (this.isAttachmentBonus(entry)) {
      if (!target.types.includes("unit")) return false;
      const source = entry.effect.source === undefined ? null : this.resolve(entry.effect.source);
      return source !== null && isAttachedEquipmentBonus(source, target);
    }
    const source = entry.effect.source === undefined ? target : this.raw(entry.effect.source);
    if (!matchesObjectFilter(entry.effect.filter, target, { controller: source?.controller, anchor: source ?? undefined })) return false;
    const effect = record(entry.effect.effect);
    return conditionMatches(effect, target, () => this.layerEnvironment(entry, target));
  }

  private materialize(entry: RegisteredContinuousEffect, target: LayeredObjectSnapshot): AnyRecord {
    const authored = record(entry.effect.effect);
    // Most production registrations are scalar static effects. Their authored
    // object is immutable, so cloning and constructing an expression host only
    // to return identical values is unnecessary.
    if (!needsLayerEnvironment(authored)) return authored;
    const environment = this.layerEnvironment(entry, target);
    const input = { ...authored };
    for (const key of ["amount", "value", "delta", "keywordValue"] as const) {
      const value = record(input[key]);
      if (["add", "subtract", "multiply", "object-ref", "ref"].includes(String(value.kind)) ||
        ["object-property", "object-attribute"].includes(String(value.kind)) && refFrom(value.object) !== null) {
        input[key] = valueOf(value, target, ref => this.resolve(ref)) as never;
      }
    }
    const effect = record(resolveLayerEffectExpressions(input as unknown as import("@riftbound/card-dsl").ContinuousEffect, environment));
    // Existing authored IR expresses "N for each ..." in this scalar slot.
    if (effect.per !== undefined) {
      const per = evaluateExpression(effect.per as Expr, environment);
      const amount = numberValue(effect, target, ref => this.resolve(ref));
      if (typeof per !== "number" || !Number.isFinite(per)) throw new MissingInformation("Layer multiplier is not numeric");
      effect.amount = amount * per;
    }
    return effect;
  }

  /**
   * CR 479.4.b: a non-passive reduction locks its limitation and modifier at
   * application time. The registration already snapshots its printed minimum;
   * this method locks the additional-reduction modifier once. Querying from the
   * raw registry and raw source objects keeps the consumer independent of the
   * target's current layered Might and prevents re-entering this evaluation.
   */
  private appliedArithmetic(entry: RegisteredContinuousEffect, target: LayeredObjectSnapshot): AppliedArithmetic {
    const effect = this.materialize(entry, target);
    const amount = numberValue(effect, target, ref => this.resolve(ref));
    const scope = effect.reductionScope;
    const isReduction = effectKind(effect).includes("decrease") || effectKind(effect).includes("subtract") ||
      effectKind(effect).includes("debuff") || amount < 0 ||
      typeof effect.authoredAmount === "number" && effect.authoredAmount < 0;
    if (!isReduction || typeof scope !== "string" || entry.effect.source === undefined) return { effect };

    const targetKey = refKey(target.ref);
    const remembered = this.arithmeticSnapshots.get(entry)?.get(targetKey);
    if (remembered !== undefined) return { effect: { ...effect, snapshottedReduction: remembered } };

    // The limited total is remembered once for this entry and target. Later
    // expiry, source departure, or re-evaluation must not recalculate it, and
    // a reduction already limited to zero must remain zero.
    let snapshottedReduction = 0;
    if (amount !== 0) {
      const source = this.sourceObject(entry.effect.source);
      if (source === null) return { effect };
      const modifiers = new Map<string, number>();
      for (const appliesTo of [scope, { kind: "constant", value: scope }]) {
        for (const modifier of additionalMightReductions(
          this.registry,
          { controller: source.controller, appliesTo },
          ref => ref === undefined ? null : this.raw(ref),
        )) modifiers.set(modifier.id, modifier.amount);
      }
      const additional = [...modifiers.values()].reduce((sum, amount) => sum + amount, 0);
      // The registration already limited the base reduction at its snapshot
      // point. Additional modifiers join that remembered delta, then the same
      // limitation is applied once more for the augmented reduction.
      const baseReduction = typeof effect.authoredAmount === "number"
        ? effect.authoredAmount
        : amount;
      const total = baseReduction + additional;
      const basis = typeof effect.snapshotMight === "number" ? effect.snapshotMight : undefined;
      const minimum = typeof effect.minimum === "number" ? effect.minimum : undefined;
      snapshottedReduction = basis === undefined || minimum === undefined
        ? total
        : Math.min(0, Math.max(total, minimum - basis));
    }
    const snapshots = this.arithmeticSnapshots.get(entry) ?? new Map<string, number>();
    snapshots.set(targetKey, snapshottedReduction);
    this.arithmeticSnapshots.set(entry, snapshots);
    return { effect: { ...effect, snapshottedReduction } };
  }

  private resolveCopy(ref: ObjectRef): LayeredObjectSnapshot | null {
    if (this.copyFrames.length) return this.evaluateCopyDependency(ref);
    for (let attempt = 0; attempt <= this.objects.size; attempt++) {
      try { return this.evaluateCopyDependency(ref); }
      catch (error) {
        if (!(error instanceof CopyDependencyRestart)) throw error;
        this.copyCache.clear();
      }
    }
    throw new MissingInformation("Copy dependency groups did not stabilize");
  }

  private evaluateCopyDependency(ref: ObjectRef): LayeredObjectSnapshot | null {
    const key = refKey(ref);
    if (this.copyEvaluating.has(key)) {
      const index = this.copyFrames.findIndex(frame => frame.includes(key));
      if (index === this.copyFrames.length - 1) return this.copyPartial.get(key) ?? null;
      const cycle = new Set(this.copyFrames.slice(index).flat());
      for (const member of cycle) for (const existing of this.copyGroups.get(member) ?? []) cycle.add(existing);
      for (const member of cycle) this.copyGroups.set(member, cycle);
      throw new CopyDependencyRestart();
    }
    const cached = this.copyCache.get(key);
    if (cached !== undefined) return cached;
    if (this.raw(ref) === null) return null;
    const keys = [...(this.copyGroups.get(key) ?? [key])];
    for (const member of keys) {
      this.copyEvaluating.add(member);
      this.copyPartial.set(member, this.copySnapshot(this.objects.get(member)!));
    }
    this.copyFrames.push(keys);
    try {
      const effects = this.activeEffects().filter(entry => entry.effect.layer === "copy");
      for (const member of keys) {
        const mutable = { ...this.copyPartial.get(member)! } as MutableSnapshot;
        const done = new Set<string>();
        let entry: RegisteredContinuousEffect | undefined;
        while (effects.length > 0 && (entry = this.nextEffect(effects.filter(item => !done.has(item.effect.id)), mutable))) {
          this.apply(mutable, "copy", this.materialize(entry, mutable));
          done.add(entry.effect.id);
        }
        this.copyCache.set(member, this.copySnapshot(mutable));
      }
      return this.copyCache.get(key) ?? null;
    } finally {
      this.copyFrames.pop();
      for (const member of keys) {
        this.copyEvaluating.delete(member);
        this.copyPartial.delete(member);
      }
    }
  }

  private activeEffects(): readonly RegisteredContinuousEffect[] {
    const revision = this.registry.revision;
    if (this.activeEffectsCache?.revision === revision && this.activeEffectsCache.objectCount === this.objects.size) {
      const active = this.activeEffectsCache.entries;
      const allLive = active.every(entry => entry.duration.type !== "while-source-in-zone" || this.raw(entry.duration.source) !== null);
      if (allLive) return active;
    }
    const entries = this.registry.active(undefined, ref => ref === undefined ? null : this.raw(ref));
    this.activeEffectsCache = { revision, objectCount: this.objects.size, entries };
    return entries;
  }

  /**
   * CR 703: each Buff is an intrinsic +1 Might increase. Create one arithmetic
   * entry per live Unit so the Buff participates in the existing layer passes
   * and dependency ordering. The entry comes from the Unit's own counter state,
   * has no independent timestamp, and disappears with that board incarnation
   * (CR 705).
   */
  private buffMightEffects(): readonly RegisteredContinuousEffect[] {
    return Object.freeze([...this.objects.values()].flatMap(object => {
      if (object.zone !== "board" || !object.types.includes("unit") || object.buffs <= 0) return [];
      const id = `buff-might:${refKey(object.ref)}`;
      return [Object.freeze({
        effect: Object.freeze({
          id,
          layer: "arithmetic" as const,
          filter: Object.freeze({ objectId: object.ref.id, zoneEntryId: object.ref.zoneEntryId,
            type: "unit", zone: "board" }),
          effect: Object.freeze({ kind: "continuous.might", amount: object.buffs }),
        }),
        duration: Object.freeze({ type: "permanent" as const }),
        timestamp: 0,
        sequence: 0,
      })];
    }));
  }

  /** Printed Equipment bonuses and intrinsic Buff increases share arithmetic. */
  private arithmeticEffects(): readonly RegisteredContinuousEffect[] {
    const active = this.activeEffects();
    const cached = this.derivedEffectsCache;
    if (cached !== undefined && cached.active === active && cached.boundary === this.objectBoundary &&
        cached.bonusSize === this.attachmentBonuses.size) return cached.effects;
    const effects = Object.freeze([
      ...this.attachmentBonuses.values(),
      ...this.buffMightEffects(),
      ...active,
    ]);
    this.derivedEffectsCache = Object.freeze({ active, boundary: this.objectBoundary,
      bonusSize: this.attachmentBonuses.size, effects });
    return effects;
  }

  private isAttachmentBonus(entry: RegisteredContinuousEffect): boolean {
    return this.attachmentBonuses.get(entry.effect.id) === entry;
  }

  private apply(target: MutableSnapshot, layer: typeof LAYER_ORDER[number], effect: AnyRecord): void {
    if (effectKind(effect) === EQUIPMENT_MIGHT_BONUS_EFFECT_KIND) {
      if (target.might !== null && target.types.includes("unit")) {
        target.might += numberValue(effect, target, ref => this.resolve(ref));
      }
      return;
    }
    if (layer === "copy") applyCopy(target, effect, ref => {
      // Within a copy loop all members use the same copy-layer input. A copy
      // from outside the loop still receives the completed copyable traits.
      if (!this.copyFrames.length && this.copyGroups.get(refKey(target.ref))?.has(refKey(ref))) {
        const raw = this.raw(ref);
        return raw === null ? null : this.copySnapshot(raw);
      }
      return this.resolveCopy(ref);
    });
    else if (layer === "trait") applyTrait(target, effect, ref => this.resolve(ref));
    else if (layer === "ability") applyAbility(target, effect, ref => this.resolve(ref));
    else applyArithmetic(target, effect, ref => this.resolve(ref));
    detachIfUnit(target);
  }

  private withSnapshot<T>(target: LayeredObjectSnapshot, callback: () => T): T {
    const key = refKey(target.ref);
    const saved = this.partial.get(key);
    this.partial.set(key, target);
    try { return callback(); }
    finally {
      if (saved === undefined) this.partial.delete(key);
      else this.partial.set(key, saved);
    }
  }

  private signature(entry: RegisteredContinuousEffect, target: LayeredObjectSnapshot): string {
    const authored = record(entry.effect.effect);
    if (this.isAttachmentBonus(entry)) {
      return JSON.stringify({ effect: entry.effect.effect,
        attached: target.types.includes("unit") && (() => {
          const source = entry.effect.source === undefined ? null : this.resolve(entry.effect.source);
          return source !== null && isAttachedEquipmentBonus(source, target);
        })() });
    }
    return this.withSnapshot(target, () => {
      if (!this.layerMatches(entry, target)) return "inapplicable";
      const effect = this.materialize(entry, target);
      const condition = authored.condition ?? authored.when;
      if (effect === authored && condition === undefined && entry.effect.layer !== "arithmetic") {
        return `${entry.effect.layer}\u0000${JSON.stringify(authored)}`;
      }
      const after = { ...target } as MutableSnapshot;
      this.apply(after, entry.effect.layer, effect);
      // Arithmetic dependencies compare the size of the modification, not the
      // resulting total: a fixed +2 doesn't depend on a passive "set to 5".
      return JSON.stringify({ ...effect, condition: undefined, when: undefined,
        ...(entry.effect.layer === "arithmetic" ? { mightDelta: after.might === null || target.might === null ? null : after.might - target.might } : {}) });
    });
  }

  private nextEffect(entries: readonly RegisteredContinuousEffect[], target: LayeredObjectSnapshot): RegisteredContinuousEffect | undefined {
    let candidates = entries.filter(entry => this.layerMatches(entry, target));
    if (candidates[0]?.effect.layer === "arithmetic") {
      // Legacy non-additive layer payloads precede the queued increments, as
      // they did before expression IR was integrated. Game-action Double/Swap
      // already arrive here as immutable, snapshotted additive registrations.
      const legacy = candidates.find(entry => {
        if (this.isAttachmentBonus(entry)) return false;
        const effect = record(entry.effect.effect);
        const kind = effectKind(effect);
        return effect.snapshotDelta === undefined && (kind.includes("multiply") || kind.includes("double") ||
          ["set", "set-might", "might-set", "set-power-value"].includes(kind));
      });
      if (legacy !== undefined) return legacy;
      const increases = candidates.filter(entry => {
        const after = { ...target } as MutableSnapshot;
        this.apply(after, "arithmetic", this.materialize(entry, target));
        return target.might === null || after.might === null || after.might >= target.might;
      });
      if (increases.length) candidates = increases;
    }
    const signatures = new Map(candidates.map(entry => [entry, this.signature(entry, target)]));
    const depends = (dependent: RegisteredContinuousEffect, prerequisite: RegisteredContinuousEffect) => {
      if (this.legacyScalar(dependent) || this.legacyScalar(prerequisite)) return false;
      const after = { ...target } as MutableSnapshot;
      this.apply(after, prerequisite.effect.layer, this.materialize(prerequisite, target));
      if (this.isAttachmentBonus(dependent) && this.isAttachmentBonus(prerequisite)) {
        return dependent.sequence < prerequisite.sequence;
      }
      return signatures.get(dependent) !== this.signature(dependent, after);
    };
    // CR 481.1: mutual dependencies use timestamp order, just like a cycle of
    // dependencies with no available first effect (CR 482).
    return candidates.find(entry => !candidates.some(other => other !== entry && depends(entry, other) && !depends(other, entry))) ?? candidates[0];
  }

  private legacyScalar(entry: RegisteredContinuousEffect): boolean {
    const effect = record(entry.effect.effect);
    const value = record(effect.amount ?? effect.value ?? effect.delta);
    return ["add", "subtract", "multiply", "object-ref", "ref"].includes(String(value.kind)) ||
      ["object-property", "object-attribute"].includes(String(value.kind)) && refFrom(value.object) !== null;
  }

  private beforeEffect(key: string, applied: ReadonlyMap<string, AppliedEffect>, excluded: string): LayeredObjectSnapshot {
    const target = { ...this.baseSnapshot(this.objects.get(key)!) } as MutableSnapshot;
    this.withSnapshot(target, () => {
      for (const layer of LAYER_ORDER) for (const [id, item] of applied) {
        if (id === excluded || id.startsWith(excluded + ":value:") || item.entry.effect.layer !== layer) continue;
        this.apply(target, layer, item.effect);
      }
    });
    return this.copySnapshot(target);
  }

  private publishGroupView(keys: readonly string[], current: ReadonlyMap<string, MutableSnapshot>): void {
    // A singleton's only nested self-read is served by `partial` while that
    // object is current. Copying it into groupView at every layer/pass is
    // therefore redundant; multi-object SCCs still need the start-of-layer view.
    if (keys.length === 1) return;
    for (const key of keys) this.groupView.set(key, this.copySnapshot(current.get(key)!));
  }

  private finishGroup(key: string, source: MutableSnapshot): void {
    let result = this.copySnapshot(source);
    if (result.might !== null && result.might < 0) result = this.copySnapshot({ ...result, might: 0 });
    if (this.derivedMight !== undefined) {
      const derived = this.derivedMight(result);
      if (derived !== undefined && derived !== null && Number.isFinite(derived)) {
        result = this.copySnapshot({ ...result, might: Math.max(0, derived) });
      }
    }
    this.cache.set(key, result);
  }

  /** Keep cached layer state internal and detach every public read from it. */
  private publicSnapshot(snapshot: LayeredObjectSnapshot): LayeredObjectSnapshot {
    this.count("publicSnapshotCopies");
    return this.copySnapshot(snapshot);
  }

  private evaluateGroup(keys: readonly string[]): void {
    this.count("groupEvaluations");
    if (this.depth > 1) this.count("dependencyGroups");
    if (keys.length === 1) this.count("singletonGroups");
    else {
      this.count("multiObjectGroups");
      this.count("dependencyCycleGroups");
    }
    const effects = this.arithmeticEffects();
    const candidatesByLayer = new Map<string, RegisteredContinuousEffect[]>();
    for (const layer of LAYER_ORDER) {
      candidatesByLayer.set(layer, effects.filter(entry => entry.effect.layer === layer));
    }
    const current = new Map<string, MutableSnapshot>();
    const base = new Map<string, FrozenSnapshot>();
    const applied = new Map<string, Map<string, AppliedEffect>>();
    const removed = new Map<string, Set<string>>();
    for (const key of keys) {
      const raw = this.objects.get(key)!;
      const normalized = this.baseSnapshot(raw);
      base.set(key, normalized);
      current.set(key, { ...normalized } as MutableSnapshot);
      applied.set(key, new Map());
      removed.set(key, new Set());
      this.evaluating.add(key);
      this.partial.set(key, current.get(key)!);
    }
    this.frames.push([...keys]);
    const previousObject = this.currentObject;
    try {
      if (effects.length > 0) {
        let changed = true;
        let passes = 0;
        const seen = new Set<string>();
        while (changed) {
        this.count("passes");
        if (++passes > effects.length * 2 + 2) throw new MissingInformation("Continuous numeric dependencies require an explicit cycle ruling");
        changed = false;
        for (const layer of LAYER_ORDER) {
          // Objects in a dependency loop read the same start-of-layer view,
          // irrespective of object enumeration or which snapshot was requested.
          this.publishGroupView(keys, current);
          for (const key of keys) {
            this.currentObject = key;
            const target = current.get(key)!;
            const done = applied.get(key)!;
            const disqualified = removed.get(key)!;
            let entry: RegisteredContinuousEffect | undefined;
            const candidates = (candidatesByLayer.get(layer) ?? EMPTY_ARRAY).filter(item =>
              !done.has(item.effect.id) && !disqualified.has(item.effect.id));
            while (candidates.length > 0 && (entry = this.nextEffect(candidates, target))) {
              candidates.splice(candidates.indexOf(entry), 1);
              const appliedEntry = entry.effect.layer === "arithmetic" ? this.appliedArithmetic(entry, target) : { effect: this.materialize(entry, target) };
              const { effect } = appliedEntry;
              this.apply(target, layer, effect);
              this.count("effectApplications");
              done.set(entry.effect.id, { entry, effect });
              changed = true;
            }
          }
        }
        // Disqualification is separate from application and also occurs once.
        // Rebuild from the raw object, rather than trying to invert copy/set/
        // multiply effects or adding arithmetic again (CR 478.2–478.4).
        this.publishGroupView(keys, current);
        for (const key of keys) {
          this.currentObject = key;
          const done = applied.get(key)!;
          let rebuild = false;
          for (const [id, item] of done) {
            // A grant's own value (including its valued-keyword companion)
            // must not disqualify its promotion/threshold condition. Legacy
            // scalar callbacks retain their historical application snapshot.
            if (this.legacyScalar(item.entry)) continue;
            const before = this.beforeEffect(key, done, id);
            if (!this.withSnapshot(before, () => this.layerMatches(item.entry, before))) {
              done.delete(id);
              removed.get(key)!.add(id);
              this.count("effectDisqualifications");
              rebuild = true;
              continue;
            }
            const effect = this.withSnapshot(before, () => item.entry.effect.layer === "arithmetic"
              ? this.appliedArithmetic(item.entry, before).effect
              : this.materialize(item.entry, before));
            if (JSON.stringify(effect) !== JSON.stringify(item.effect)) {
              // Replacing an evaluated scalar is not a second application.
              // Replay the accumulated modifications from base characteristics.
              done.set(id, { entry: item.entry, effect });
              this.count("effectReevaluations");
              rebuild = true;
            }
          }
          if (rebuild) {
            const target = { ...base.get(key)! } as MutableSnapshot;
            current.set(key, target);
            this.partial.set(key, target);
            for (const layer of LAYER_ORDER) for (const item of done.values()) {
              if (item.entry.effect.layer === layer) this.apply(target, layer, item.effect);
            }
            changed = true;
          }
        }
        if (changed) {
          const signature = JSON.stringify(keys.map(key => [key, [...applied.get(key)!], [...removed.get(key)!]]));
          if (seen.has(signature)) throw new MissingInformation("Continuous numeric dependencies did not converge");
          seen.add(signature);
        }
        }
      }
      for (const key of keys) {
        // The derived-Might callback is an exported reentrant query. Keep the
        // current object marked so it reads this group's partial snapshot even
        // when no active effect reached the layer loop (singleton empty set).
        this.currentObject = key;
        this.finishGroup(key, current.get(key)!);
      }
    } finally {
      this.currentObject = previousObject;
      this.frames.pop();
      for (const key of keys) {
        this.evaluating.delete(key);
        this.partial.delete(key);
        this.groupView.delete(key);
      }
    }
  }

  private evaluateDependency(ref: ObjectRef): LayeredObjectSnapshot | null {
    this.count("dependencyCalls");
    const key = refKey(ref);
    if (this.raw(ref) === null) return null;
    if (this.evaluating.has(key)) {
      const index = this.frames.findIndex(frame => frame.includes(key));
      if (index === this.frames.length - 1) return (key === this.currentObject ? this.partial.get(key) : this.groupView.get(key)) ?? null;
      const cycle = new Set(this.frames.slice(index).flat());
      for (const member of cycle) for (const existing of this.groups.get(member) ?? []) cycle.add(existing);
      for (const member of cycle) this.groups.set(member, cycle);
      this.restartRequested = true;
      this.count("dependencyRestarts");
      throw new LayerDependencyRestart();
    }
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.count("dependencyCacheHits");
      return this.depth === 0 ? this.publicSnapshot(cached) : cached;
    }
    this.evaluateGroup([...(this.groups.get(key) ?? [key])]);
    const result = this.cache.get(key) ?? null;
    return result === null || this.depth > 0 ? result : this.publicSnapshot(result);
  }

  evaluate(ref: ObjectRef): LayeredObjectSnapshot | null {
    this.count("evaluateCalls");
    if (this.depth > 0) return this.evaluateDependency(ref);
    this.syncRegistry();
    const current = this.currentAttachmentSignature();
    const attachmentRevision = current;
    if (this.attachmentRevision !== attachmentRevision) {
      this.cache.clear();
      this.copyCache.clear();
      this.groups.clear();
      this.copyGroups.clear();
      this.baseSnapshots = new WeakMap();
      this.derivedEffectsCache = undefined;
      this.rebuildAttachmentBonuses();
      this.attachmentRevision = attachmentRevision;
      this.invalidateCommandPlan();
    }
    if (this.commandPlan !== undefined && this.commandPlan.enabled && !this.commandPlan.disabled &&
        this.commandPlan.key !== undefined && this.commandPlan.view !== undefined &&
        this.planKey() === this.commandPlan.key) {
      const key = refKey(ref);
      const planned = this.commandPlan.view.find(snapshot => refKey(snapshot.ref) === key);
      if (planned !== undefined) {
        this.count("planCacheReferenceHits");
        return this.publicSnapshot(planned);
      }
    }
    this.depth++;
    try {
      for (let attempt = 0; attempt <= this.objects.size; attempt++) {
        this.restartRequested = false;
        try {
          const result = this.evaluateDependency(ref);
          // Production binders catch condition errors. A discovered dependency
          // must still restart even if that wrapper swallowed the sentinel.
          if (this.restartRequested) throw new LayerDependencyRestart();
          return result === null ? null : this.publicSnapshot(result);
        }
        catch (error) {
          if (!(error instanceof LayerDependencyRestart)) throw error;
          this.cache.clear();
        }
      }
      throw new MissingInformation("Object dependency groups did not stabilize");
    } finally {
      this.depth--;
    }
  }

  /** Identity, type, and attachment facts that can change bonus eligibility. */
  /**
   * Detects in-place changes to the attachment-relevant fields of the current
   * objects. It is only ever compared with a signature of the same Map, whose
   * insertion order changes only through setObjects (which re-signs), so the
   * Map order is already canonical here and needs no sort (RIFT-1015).
   */
  private attachmentSignature(): string {
    this.count("attachmentSignatureCalls");
    return JSON.stringify([...this.objects.values()].map(object => [refKey(object.ref), object.types,
      object.tags, object.zone, object.might, object.buffs, object.attachedTo]));
  }

  /**
   * Only recursively frozen snapshots can skip content serialization across
   * calls. Mutable raw snapshots are legal at this internal boundary, so their
   * attachment fields are re-read on every top-level query to prevent a cache
   * from surviving an in-place change.
   */
  private currentAttachmentSignature(): string {
    const objects = [...this.objects.values()];
    const previous = this.attachmentObjects;
    // A production host installed through setObjects has already paid for the
    // canonical signature exactly once at this boundary. Only a direct Map
    // mutation made after an immutable boundary needs another serialization.
    if (this.immutableAttachmentObjects && objects.length === previous.length &&
        objects.every((object, index) => object === previous[index])) {
      this.count("attachmentSignatureReuses");
      return this.attachmentRevision!;
    }
    const signature = this.attachmentSignature();
    this.attachmentObjects = objects;
    this.immutableAttachmentObjects = objects.every(object =>
      Object.isFrozen(object) && Object.isFrozen(object.ref) && Object.isFrozen(object.types) &&
      Object.isFrozen(object.tags) && (object.attachedTo === null || Object.isFrozen(object.attachedTo)));
    return signature;
  }

  snapshot(ref: ObjectRef): LayeredObjectSnapshot | null {
    return this.evaluate(ref);
  }

  /**
   * Open a process-local command window. Nested calls share the outer window.
   * The completed plan is discarded on every exit, including choices and
   * rollbacks, so it can never become a cross-command cache.
   */
  withCommandPlanCache<T>(authority: string, run: () => T): T {
    if (this.commandPlan !== undefined) return run();
    // Cache activity is measured within this exact process-local window.
    if (this.diagnosticsEnabled) Object.assign(this.diagnosticsState, {
      planCacheHits: 0, planCacheReferenceHits: 0, planCacheMisses: 0, planCacheBypasses: 0,
    });
    this.lastCompletedPlan = undefined;
    this.commandPlan = { enabled: this.commandPlanDefaultEnabled, disabled: false, authority };
    try { return run(); } finally {
      this.commandPlan = undefined;
      this.lastCompletedPlan = undefined;
    }
  }

  /** Set the immutable host-view generation before installing that view. */
  setCommandPlanAuthority(authority: string): void {
    if (this.commandPlan === undefined) return;
    const completed = this.lastCompletedPlan;
    const changed = completed === undefined ? [] : [
      ["planCacheGenerationInvalidations", completed.authority !== authority],
      ["planCacheRegistryInvalidations", completed.registryRevision !== this.registry.revision],
      ["planCacheDerivedInvalidations", completed.derivedEpoch !== derivedLayerEpoch()],
      ["planCacheTimingInvalidations", completed.timingPoint !== (this.timingPoint ?? null)],
      ["planCacheAttachmentInvalidations", completed.attachmentRevision !== this.currentAttachmentSignature()],
    ] as const;
    for (const [field, didChange] of changed) if (didChange) this.count(field);
    const authorityChanged = this.commandPlan.authority !== authority;
    const componentsChanged = changed.some(([, didChange]) => didChange);
    if (authorityChanged || componentsChanged) this.invalidateCommandPlan();
    this.commandPlan.authority = authority;
    if (!authorityChanged && !componentsChanged) {
      // No host write occurred, so this reinstall is only a new read of the
      // same completed authority. Require the exact completed inputs.
      this.commandPlan.lastCompletedKey = this.lastCompletedPlan === undefined
        ? undefined : this.completedPlanKey();
    }
  }

  /** Explicitly arm the next read only when every authority component is stable. */
  rearmCommandPlan(): void {
    if (this.commandPlan === undefined || this.commandPlan.disabled || this.lastCompletedPlan === undefined) return;
    this.commandPlan.key = this.completedPlanKey();
  }

  /** Explicitly discard any completed command plan without closing the window. */
  invalidateCommandPlan(): void {
    if (this.commandPlan !== undefined) {
      this.count("planCacheNestedInvalidations");
      this.commandPlan.view = undefined;
      this.commandPlan.key = undefined;
    }
  }

  /** A suspension ends the command's reusable lane even if a caller catches it. */
  abandonCommandPlan(): void {
    if (this.commandPlan !== undefined) this.commandPlan.disabled = true;
    this.invalidateCommandPlan();
  }

  private planKey(): string {
    const attachment = this.immutableAttachmentObjects
      ? this.attachmentRevision!
      : this.currentAttachmentSignature();
    // The authority already includes the command generation and complete raw
    // host generation. Registry, epoch, timing and attachment remain
    // explicit members so an independently mutable supplier fails closed.
    return `${this.commandPlan!.authority}\u0000${this.registry.revision}\u0000${derivedLayerEpoch()}\u0000${this.timingPoint ?? ''}\u0000${attachment}`;
  }


  /** Cheap read-only key for post-pass stability; no attachment tracing or diagnostics. */
  private completionKey(): string {
    const attachment = this.immutableAttachmentObjects
      ? this.attachmentRevision!
      : this.attachmentSignature();
    return `${this.commandPlan!.authority}\u0000${this.registry.revision}\u0000${derivedLayerEpoch()}\u0000${this.timingPoint ?? ''}\u0000${attachment}`;
  }
  /** Install only the exact components observed by a completed full pass. */
  private completedPlanKey(): string {
    const completed = this.lastCompletedPlan;
    return completed === undefined ? this.completionKey()
      : `${completed.authority}\u0000${completed.registryRevision}\u0000${completed.derivedEpoch}\u0000${completed.timingPoint ?? ''}\u0000${completed.attachmentRevision}`;
  }

  /** Test/diagnostic fact: whether a completed plan is available for the next read. */
  get hasCompletedCommandPlan(): boolean { return this.commandPlan?.view !== undefined; }
  /** Exact authority installed by the latest completed read in this command. */
  get commandPlanAuthority(): string | undefined { return this.commandPlan?.key?.split('\u0000', 1)[0]; }
  /** Explicit test/diagnostic fact: a candidate view is available to rearm. */
  get canRearmCommandPlan(): boolean {
    return this.commandPlan?.view !== undefined && !this.commandPlan.disabled && this.commandPlan.lastCompletedKey !== undefined;
  }

  evaluateAll(): readonly LayeredObjectSnapshot[] {
    this.count("evaluateAllCalls");
    this.syncRegistry();
    const snapshots: LayeredObjectSnapshot[] = [];
    let key: string | undefined;
    let boundary: number | undefined;
    let authority: string | undefined;
    if (this.commandPlan !== undefined && this.depth === 0) {
      const objects = [...this.objects.values()];
      if (this.commandPlan.enabled && !this.commandPlan.disabled) key = this.planKey();
      if (key !== undefined && key === this.commandPlan.key && this.commandPlan.view !== undefined) {
        this.count("planCacheHits");
        return Object.freeze(this.commandPlan.view.map(snapshot => this.copySnapshot(snapshot)));
      }
      this.count(key === undefined ? "planCacheBypasses" : "planCacheMisses");
      // A miss is terminal for the prior plan. If the complete pass throws,
      // callers must not be able to revive the stale view by restoring only a
      // subset of the key inputs.
      if (key !== undefined) this.invalidateCommandPlan();
      boundary = this.objectBoundary;
      authority = this.commandPlan?.authority;
      // Evaluation is reentrant: a condition or derived callback may refresh
      // the host and call setObjects through the public engine. Freeze this
      // batch's identities now so replacing the live Map cannot restart its
      // iterator or omit a newly inserted incarnation.
      for (const object of objects) {
        const snapshot = this.evaluate(object.ref);
        if (snapshot !== null) snapshots.push(snapshot);
      }
    } else {
      for (const object of [...this.objects.values()]) {
        const snapshot = this.evaluate(object.ref);
        if (snapshot !== null) snapshots.push(snapshot);
      }
    }
    // Binding lifecycle may temporarily add and remove registration entries
    // while a pass is resolving live sources. The completed view was built at
    // this final revision, so the next read must compare against that fact.
    const view = Object.freeze(snapshots);
    if (this.commandPlan !== undefined && key !== undefined && boundary !== undefined &&
        authority === this.commandPlan.authority && this.objectBoundary === boundary && this.depth === 0) {
      // Recompute after evaluation: an effect may transiently consume or
      // restore registry entries, and the installed view is the post-pass one.
      // Evaluation may add or remove lifecycle registrations. Record the
      // final revision now, otherwise the next read's sync step would fail
      // closed against a revision that the completed plan already observed.
      this.registryRevision = this.registry.revision;
      this.commandPlan.view = view;
      this.lastCompletedPlan = { authority: this.commandPlan.authority,
        registryRevision: this.registryRevision, derivedEpoch: derivedLayerEpoch(),
        timingPoint: this.timingPoint ?? null, attachmentRevision: this.immutableAttachmentObjects
          ? this.attachmentRevision!
          : this.attachmentSignature() };
      this.commandPlan.lastCompletedKey = this.completedPlanKey();
      this.commandPlan.key = this.commandPlan.lastCompletedKey;
    }
    const snapshotView = Object.freeze(view.map(snapshot => this.copySnapshot(snapshot)));
    return snapshotView;
  }

  objectsView(): readonly ObjectSnapshot[] {
    return Object.freeze([...this.objects.values()]);
  }

  advance(event: TimingEvent): readonly string[] {
    getTimingPoint(event.id);
    const expired = [
      ...this.registry.expireAt(event, ref => ref === undefined ? null : this.raw(ref)),
      ...this.registry.expireInactive(ref => ref === undefined ? null : this.raw(ref)),
    ];
    this.timingPoint = event.id;
    this.invalidate();
    return Object.freeze([...new Set(expired)]);
  }

  expireAt(timingPoint: TimingPointId, player?: string): readonly string[] {
    return this.advance({ id: timingPoint, player });
  }

  get currentTimingPoint(): TimingPointId | undefined {
    return this.timingPoint;
  }
}

export function createLayerEngine(
  objects: readonly ObjectSnapshot[] | ReadonlyMap<string, ObjectSnapshot>,
  effects: readonly { readonly effect: ContinuousEffectSpec; readonly duration: Duration; readonly timestamp?: number }[] = [],
  options: Omit<LayerEngineOptions, "effects"> = {},
): LayerEngine {
  const registry = new ContinuousEffectRegistry();
  for (const entry of effects) registry.register(entry.effect, entry.duration, entry.timestamp);
  return new LayerEngine(objects, registry, options);
}

export const createContinuousLayerEngine = createLayerEngine;

export function evaluateLayeredObject(
  objects: readonly ObjectSnapshot[] | ReadonlyMap<string, ObjectSnapshot>,
  ref: ObjectRef,
  effects: readonly { readonly effect: ContinuousEffectSpec; readonly duration: Duration; readonly timestamp?: number }[] = [],
  options: Omit<LayerEngineOptions, "effects"> = {},
): LayeredObjectSnapshot | null {
  return createLayerEngine(objects, effects, options).evaluate(ref);
}

export const calculateObjectSnapshot = evaluateLayeredObject;

export function evaluateLayeredObjects(
  objects: readonly ObjectSnapshot[] | ReadonlyMap<string, ObjectSnapshot>,
  effects: readonly { readonly effect: ContinuousEffectSpec; readonly duration: Duration; readonly timestamp?: number }[] = [],
  options: Omit<LayerEngineOptions, "effects"> = {},
): readonly LayeredObjectSnapshot[] {
  return createLayerEngine(objects, effects, options).evaluateAll();
}

export const calculateObjectSnapshots = evaluateLayeredObjects;

export function registerContinuousEffect(
  registry: ContinuousEffectRegistry,
  effect: ContinuousEffectSpec,
  duration: Duration,
  timestamp?: number,
): RegisteredContinuousEffect {
  return registry.register(effect, duration, timestamp);
}

/** Bridges the batch-1 strict Duel evaluator without changing its behavior. */
export function createDuelDerivedMightResolver(
  evaluator: Pick<DuelDerivedMightEvaluatorV2, "evaluate">,
): DerivedMightResolver {
  return object => {
    const result = evaluator.evaluate(object.ref.id);
    return result.status === "complete" && "currentMight" in result ? result.currentMight : undefined;
  };
}

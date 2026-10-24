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
  private depth = 0;
  /** True while this engine is inside evaluate/evaluateAll (reentrant reads). */
  get inEvaluation(): boolean { return this.depth > 0; }
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

  constructor(
    objects: readonly ObjectSnapshot[] | ReadonlyMap<string, ObjectSnapshot>,
    registry = new ContinuousEffectRegistry(),
    options: LayerEngineOptions = {},
  ) {
    if (objects instanceof Map) {
      for (const [key, object] of objects) this.objects.set(key, object);
    } else {
      for (const object of objects as readonly ObjectSnapshot[]) this.objects.set(refKey(object.ref), object);
    }
    this.registry = registry;
    this.derivedMight = options.derivedMight;
    this.timingPoint = options.timingPoint;
    this.rebuildAttachmentBonuses();
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

  setObjects(objects: readonly ObjectSnapshot[] | ReadonlyMap<string, ObjectSnapshot>): void {
    this.objects.clear();
    if (objects instanceof Map) for (const [key, object] of objects) this.objects.set(key, object);
    else for (const object of objects as readonly ObjectSnapshot[]) this.objects.set(refKey(object.ref), object);
    this.rebuildAttachmentBonuses();
    this.invalidate();
    this.attachmentRevision = this.attachmentSignature();
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

  private invalidate(): void {
    this.cache.clear();
    this.copyCache.clear();
    this.activeEffectsCache = undefined;
    if (this.depth === 0) {
      this.partial.clear();
      this.copyPartial.clear();
      this.groups.clear();
      this.copyGroups.clear();
    }
  }

  private raw(ref: ObjectRef): ObjectSnapshot | null {
    return this.objects.get(refKey(ref)) ?? null;
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
      this.copyPartial.set(member, cloneSnapshot(this.objects.get(member)!));
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
        this.copyCache.set(member, cloneSnapshot(mutable));
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
    return Object.freeze([
      ...this.attachmentBonuses.values(),
      ...this.buffMightEffects(),
      ...this.activeEffects(),
    ]);
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
        return raw === null ? null : cloneSnapshot(raw);
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
    const target = { ...cloneSnapshot(this.objects.get(key)!) } as MutableSnapshot;
    this.withSnapshot(target, () => {
      for (const layer of LAYER_ORDER) for (const [id, item] of applied) {
        if (id === excluded || id.startsWith(excluded + ":value:") || item.entry.effect.layer !== layer) continue;
        this.apply(target, layer, item.effect);
      }
    });
    return cloneSnapshot(target);
  }

  private publishGroupView(keys: readonly string[], current: ReadonlyMap<string, MutableSnapshot>): void {
    // A singleton's only nested self-read is served by `partial` while that
    // object is current. Copying it into groupView at every layer/pass is
    // therefore redundant; multi-object SCCs still need the start-of-layer view.
    if (keys.length === 1) return;
    for (const key of keys) this.groupView.set(key, cloneSnapshot(current.get(key)!));
  }

  private finishGroup(key: string, source: MutableSnapshot): void {
    let result = cloneSnapshot(source);
    if (result.might !== null && result.might < 0) result = cloneSnapshot({ ...result, might: 0 });
    if (this.derivedMight !== undefined) {
      const derived = this.derivedMight(result);
      if (derived !== undefined && derived !== null && Number.isFinite(derived)) {
        result = cloneSnapshot({ ...result, might: Math.max(0, derived) });
      }
    }
    this.cache.set(key, result);
  }

  /** Keep cached layer state internal and detach every public read from it. */
  private publicSnapshot(snapshot: LayeredObjectSnapshot): LayeredObjectSnapshot {
    return cloneSnapshot(snapshot);
  }

  private evaluateGroup(keys: readonly string[]): void {
    const effects = this.arithmeticEffects();
    const candidatesByLayer = new Map<string, RegisteredContinuousEffect[]>();
    for (const layer of LAYER_ORDER) {
      candidatesByLayer.set(layer, effects.filter(entry => entry.effect.layer === layer));
    }
    const current = new Map<string, MutableSnapshot>();
    const applied = new Map<string, Map<string, AppliedEffect>>();
    const removed = new Map<string, Set<string>>();
    for (const key of keys) {
      const raw = this.objects.get(key)!;
      current.set(key, { ...cloneSnapshot(raw) } as MutableSnapshot);
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
              rebuild = true;
            }
          }
          if (rebuild) {
            const target = { ...cloneSnapshot(this.objects.get(key)!) } as MutableSnapshot;
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
    const key = refKey(ref);
    if (this.evaluating.has(key)) {
      const index = this.frames.findIndex(frame => frame.includes(key));
      if (index === this.frames.length - 1) return (key === this.currentObject ? this.partial.get(key) : this.groupView.get(key)) ?? null;
      const cycle = new Set(this.frames.slice(index).flat());
      for (const member of cycle) for (const existing of this.groups.get(member) ?? []) cycle.add(existing);
      for (const member of cycle) this.groups.set(member, cycle);
      this.restartRequested = true;
      throw new LayerDependencyRestart();
    }
    const cached = this.cache.get(key);
    if (cached !== undefined) return this.depth === 0 ? this.publicSnapshot(cached) : cached;
    if (this.raw(ref) === null) return null;
    this.evaluateGroup([...(this.groups.get(key) ?? [key])]);
    const result = this.cache.get(key) ?? null;
    return result === null || this.depth > 0 ? result : this.publicSnapshot(result);
  }

  evaluate(ref: ObjectRef): LayeredObjectSnapshot | null {
    if (this.depth > 0) return this.evaluateDependency(ref);
    const current = this.currentAttachmentSignature();
    const attachmentRevision = current;
    if (this.attachmentRevision !== attachmentRevision) {
      this.cache.clear();
      this.copyCache.clear();
      this.groups.clear();
      this.copyGroups.clear();
      this.rebuildAttachmentBonuses();
      this.attachmentRevision = attachmentRevision;
    }
    if (this.registryRevision !== this.registry.revision) {
      this.invalidate();
      this.registryRevision = this.registry.revision;
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
    if (this.immutableAttachmentObjects && objects.length === previous.length &&
        objects.every((object, index) => object === previous[index])) {
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

  evaluateAll(): readonly LayeredObjectSnapshot[] {
    const snapshots: LayeredObjectSnapshot[] = [];
    // Evaluation is reentrant: a condition or derived callback may refresh the
    // host and call setObjects through the public engine. Freeze this batch's
    // object identities first so replacing the live Map cannot restart its
    // iterator and emit the same incarnation twice.
    for (const object of [...this.objects.values()]) {
      const snapshot = this.evaluate(object.ref);
      if (snapshot !== null) snapshots.push(snapshot);
    }
    return Object.freeze(snapshots);
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

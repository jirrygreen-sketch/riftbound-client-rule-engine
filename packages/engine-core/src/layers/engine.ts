import type { ContinuousEffect, ObjectFilter, ObjectRef } from "@riftbound/card-dsl";
import type {
  ContinuousEffectSpec,
  Duration,
  ObjectSnapshot,
} from "../effects/contract.js";
import { getTimingPoint, type TimingPointId } from "../events/timing-points.js";
import type { DuelDerivedMightEvaluatorV2 } from "../combat/derived-might.js";
import { matchesObjectFilter, objectRefFrom } from "./filter.js";
import { ContinuousEffectRegistry } from "./duration.js";
import { copyCharacteristics } from "./copy.js";
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

const EMPTY_MOVEMENT: MovementPermissions = Object.freeze({
  allowed: true,
  canMove: true,
  canGank: false,
  restrictions: Object.freeze([]),
});

const DEFAULT_TIMINGS: readonly ActionTiming[] = Object.freeze([]);

function record(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null ? value as AnyRecord : {};
}
function array<T>(value: readonly T[] | undefined): readonly T[] {
  return Object.freeze([...(value ?? [])]);
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)]);
}

function cloneSnapshot(source: ObjectSnapshot): LayeredObjectSnapshot {
  const input = source as ObjectSnapshot & Partial<LayeredObjectSnapshot> & AnyRecord;
  const movement = input.movement ?? EMPTY_MOVEMENT;
  const actionTimings = array(input.actionTimings ?? input.availableTimings ?? DEFAULT_TIMINGS);
  const printed = input.printed ?? source;
  return Object.freeze({
    ...source,
    types: array(source.types),
    tags: array(source.tags),
    keywords: array(source.keywords.map(keyword => Object.freeze({ ...keyword }))),
    power: source.power === null ? null : array(source.power),
    printed,
    actionTimings,
    availableTimings: actionTimings,
    movement: Object.freeze({
      allowed: movement.allowed !== false,
      canMove: movement.canMove !== false,
      canGank: movement.canGank === true,
      restrictions: array(movement.restrictions),
    }),
    text: input.text === undefined ? null : input.text as string | null,
    effectText: input.effectText === undefined ? (input.text as string | null | undefined) ?? null : input.effectText as string | null,
  });
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
    const left = Number(valueOf(item.left, target, resolve));
    const right = Number(valueOf(item.right, target, resolve));
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
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
  const value = valueOf(effect.amount ?? effect.value ?? effect.delta, target, resolve);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function effectKind(effect: AnyRecord): string {
  return String(record(effect).kind ?? "").toLowerCase();
}

function conditionMatches(effect: AnyRecord, object: LayeredObjectSnapshot): boolean {
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
  return true;
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
  if (kind === "set" || kind === "set-property" || kind === "set-trait" || kind === "trait") {
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
      if (typeof keyword === "string") applyKeyword(target, keyword, effect.keywordValue ?? effect.value);
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
  effects: readonly RegisteredContinuousEffect[],
  resolve: (ref: ObjectRef) => LayeredObjectSnapshot | null,
): void {
  const increases: Array<{ readonly amount: number; readonly entry: RegisteredContinuousEffect }> = [];
  const decreases: Array<{ readonly amount: number; readonly entry: RegisteredContinuousEffect }> = [];
  for (const entry of effects) {
    const effect = record(entry.effect.effect);
    if (!conditionMatches(effect, target)) continue;
    const kind = effectKind(effect);
    const amount = numberValue(effect, target, resolve);
    if (kind === "set" || kind === "set-might" || kind === "might-set" || kind === "set-power-value") {
      const value = valueOf(effect.value ?? effect.amount, target, resolve);
      if (typeof value === "number" && Number.isFinite(value)) target.might = value;
    } else if (kind.includes("multiply") || kind.includes("double")) {
      if (target.might !== null) target.might *= kind.includes("double") ? 2 : amount;
    } else if (kind.includes("decrease") || kind.includes("subtract") || kind.includes("debuff") || amount < 0) {
      decreases.push({ amount: Math.abs(amount), entry });
    } else if (kind.includes("increase") || kind.includes("add") || kind.includes("buff") || kind.includes("might")) {
      increases.push({ amount, entry });
    }
    if (kind === "add-buff" || kind === "buff") target.buffs += amount;
    if (kind === "remove-buff" || kind === "spend-buff") target.buffs = Math.max(0, target.buffs - amount);
    if (kind.includes("keyword") && (effect.keyword ?? effect.id) !== undefined) {
      const id = String(effect.keyword ?? effect.id);
      const keyword = target.keywords.find(item => item.id === id);
      if (keyword?.value !== undefined) applyKeyword(target, id, keyword.value + amount);
    }
  }
  if (target.might !== null) {
    for (const item of increases) target.might += item.amount;
    for (const item of decreases) target.might -= item.amount;
    if (target.might < 0) target.might = 0;
  }
}

function detachIfUnit(target: MutableSnapshot): void {
  if (target.attachedTo !== null && target.types.includes("unit")) target.attachedTo = null;
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
    this.invalidate();
  }

  private invalidate(): void {
    this.cache.clear();
    this.partial.clear();
    this.copyPartial.clear();
  }

  private raw(ref: ObjectRef): ObjectSnapshot | null {
    return this.objects.get(refKey(ref)) ?? null;
  }

  private resolve(ref: ObjectRef): LayeredObjectSnapshot | null {
    const key = refKey(ref);
    if (this.evaluating.has(key)) return this.partial.get(key) ?? null;
    return this.evaluate(ref);
  }

  private resolveCopy(ref: ObjectRef): LayeredObjectSnapshot | null {
    const key = refKey(ref);
    if (this.copyEvaluating.has(key)) return this.copyPartial.get(key) ?? null;
    const raw = this.raw(ref);
    if (raw === null) return null;
    this.copyEvaluating.add(key);
    let current = cloneSnapshot(raw);
    this.copyPartial.set(key, current);
    try {
      const mutable = { ...current } as MutableSnapshot;
      this.copyPartial.set(key, mutable);
      this.applyLayer(mutable, "copy", this.activeEffects());
      current = cloneSnapshot(mutable);
      this.copyPartial.set(key, current);
      return current;
    } finally {
      this.copyEvaluating.delete(key);
      this.copyPartial.delete(key);
    }
  }

  private activeEffects(): readonly RegisteredContinuousEffect[] {
    return this.registry.active(undefined, ref => ref === undefined ? null : this.raw(ref));
  }

  private applyLayer(
    target: MutableSnapshot,
    layer: typeof LAYER_ORDER[number],
    effects: readonly RegisteredContinuousEffect[],
  ): void {
    const applicable = effects.filter(entry => {
      const source = entry.effect.source === undefined ? null : this.resolve(entry.effect.source) ?? this.raw(entry.effect.source);
      return entry.effect.layer === layer &&
      matchesObjectFilter(entry.effect.filter as ObjectFilter, target, source) &&
      conditionMatches(record(entry.effect.effect), target);
    });
    if (layer === "arithmetic") {
      applyArithmetic(target, applicable, ref => this.resolve(ref));
      return;
    }
    for (const entry of applicable) {
      const effect = record(entry.effect.effect);
      if (layer === "copy") applyCopy(target, effect, ref => this.resolveCopy(ref));
      else if (layer === "trait") applyTrait(target, effect, ref => this.resolve(ref));
      else applyAbility(target, effect, ref => this.resolve(ref));
      detachIfUnit(target);
    }
  }

  evaluate(ref: ObjectRef): LayeredObjectSnapshot | null {
    const key = refKey(ref);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const raw = this.raw(ref);
    if (raw === null) return null;
    if (this.evaluating.has(key)) return this.partial.get(key) ?? cloneSnapshot(raw);
    this.evaluating.add(key);
    let current = cloneSnapshot(raw);
    this.partial.set(key, current);
    try {
      const effects = this.activeEffects();
      for (const layer of LAYER_ORDER) {
        const mutable = { ...current } as MutableSnapshot;
        this.partial.set(key, mutable);
        this.applyLayer(mutable, layer, effects);
        detachIfUnit(mutable);
        current = cloneSnapshot(mutable);
        this.partial.set(key, current);
      }
      // Arithmetic can change the predicate used by an ability-layer effect
      // (for example, a Might threshold granting a keyword). Recheck that
      // layer against the completed arithmetic snapshot without applying
      // arithmetic a second time.
      const afterArithmetic = { ...current } as MutableSnapshot;
      this.partial.set(key, afterArithmetic);
      this.applyLayer(afterArithmetic, "ability", effects);
      detachIfUnit(afterArithmetic);
      current = cloneSnapshot(afterArithmetic);
      this.partial.set(key, current);
      if (this.derivedMight !== undefined) {
        const derived = this.derivedMight(current);
        if (derived !== undefined && derived !== null && Number.isFinite(derived)) {
          current = cloneSnapshot({ ...current, might: Math.max(0, derived) });
        }
      }
      this.cache.set(key, current);
      return current;
    } finally {
      this.evaluating.delete(key);
      this.partial.delete(key);
    }
  }

  snapshot(ref: ObjectRef): LayeredObjectSnapshot | null {
    return this.evaluate(ref);
  }

  evaluateAll(): readonly LayeredObjectSnapshot[] {
    const snapshots = [...this.objects.values()].map(object => this.evaluate(object.ref)).filter((object): object is LayeredObjectSnapshot => object !== null);
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

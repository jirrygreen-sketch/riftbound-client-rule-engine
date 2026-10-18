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

function conditionMatches(effect: AnyRecord, object: LayeredObjectSnapshot, environment: ExpressionContext): boolean {
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
  try { return evaluateCondition(condition as Condition, environment); }
  catch (error) {
    if (error instanceof MissingInformation) return false;
    throw error;
  }
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
    if (target.might !== null) target.might -= Math.abs(amount);
  } else if (kind.includes("increase") || kind.includes("add") || kind.includes("buff") || kind.includes("might")) {
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
  private depth = 0;
  private frames: string[][] = [];
  private groups = new Map<string, Set<string>>();
  private groupView = new Map<string, LayeredObjectSnapshot>();
  private currentObject?: string;
  private restartRequested = false;

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
    this.copyCache.clear();
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
    const source = entry.effect.source === undefined ? target : this.raw(entry.effect.source);
    if (!matchesObjectFilter(entry.effect.filter, target, { controller: source?.controller, anchor: source ?? undefined })) return false;
    return conditionMatches(record(entry.effect.effect), target, this.layerEnvironment(entry, target));
  }

  private materialize(entry: RegisteredContinuousEffect, target: LayeredObjectSnapshot): AnyRecord {
    const environment = this.layerEnvironment(entry, target);
    const input = { ...entry.effect.effect };
    for (const key of ["amount", "value", "delta", "keywordValue"] as const) {
      const value = record(input[key]);
      if (["add", "subtract", "multiply", "object-ref", "ref"].includes(String(value.kind)) ||
        ["object-property", "object-attribute"].includes(String(value.kind)) && refFrom(value.object) !== null) {
        input[key] = valueOf(value, target, ref => this.resolve(ref)) as never;
      }
    }
    const effect = record(resolveLayerEffectExpressions(input, environment));
    // Existing authored IR expresses "N for each ..." in this scalar slot.
    if (effect.per !== undefined) {
      const per = evaluateExpression(effect.per as Expr, environment);
      const amount = numberValue(effect, target, ref => this.resolve(ref));
      if (typeof per !== "number" || !Number.isFinite(per)) throw new MissingInformation("Layer multiplier is not numeric");
      effect.amount = amount * per;
    }
    return effect;
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
        while ((entry = this.nextEffect(effects.filter(item => !done.has(item.effect.id)), mutable))) {
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
    return this.registry.active(undefined, ref => ref === undefined ? null : this.raw(ref));
  }

  private apply(target: MutableSnapshot, layer: typeof LAYER_ORDER[number], effect: AnyRecord): void {
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
    return this.withSnapshot(target, () => {
      if (!this.layerMatches(entry, target)) return "inapplicable";
      const effect = this.materialize(entry, target);
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

  private evaluateGroup(keys: readonly string[]): void {
    const effects = this.activeEffects();
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
      let changed = true;
      let passes = 0;
      const seen = new Set<string>();
      while (changed) {
        if (++passes > effects.length * 2 + 2) throw new MissingInformation("Continuous numeric dependencies require an explicit cycle ruling");
        changed = false;
        for (const layer of LAYER_ORDER) {
          // Objects in a dependency loop read the same start-of-layer view,
          // irrespective of object enumeration or which snapshot was requested.
          for (const key of keys) this.groupView.set(key, cloneSnapshot(current.get(key)!));
          for (const key of keys) {
            this.currentObject = key;
            const target = current.get(key)!;
            const done = applied.get(key)!;
            const disqualified = removed.get(key)!;
            let entry: RegisteredContinuousEffect | undefined;
            while ((entry = this.nextEffect(effects.filter(item => item.effect.layer === layer &&
              !done.has(item.effect.id) && !disqualified.has(item.effect.id)), target))) {
              const effect = this.materialize(entry, target);
              this.apply(target, layer, effect);
              done.set(entry.effect.id, { entry, effect });
              changed = true;
            }
          }
        }
        // Disqualification is separate from application and also occurs once.
        // Rebuild from the raw object, rather than trying to invert copy/set/
        // multiply effects or adding arithmetic again (CR 478.2–478.4).
        for (const key of keys) this.groupView.set(key, cloneSnapshot(current.get(key)!));
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
            const effect = this.withSnapshot(before, () => this.materialize(item.entry, before));
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
      for (const key of keys) {
        let result = cloneSnapshot(current.get(key)!);
        if (result.might !== null && result.might < 0) result = cloneSnapshot({ ...result, might: 0 });
        if (this.derivedMight !== undefined) {
          const derived = this.derivedMight(result);
          if (derived !== undefined && derived !== null && Number.isFinite(derived)) result = cloneSnapshot({ ...result, might: Math.max(0, derived) });
        }
        this.cache.set(key, result);
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
    if (cached !== undefined) return cached;
    if (this.raw(ref) === null) return null;
    this.evaluateGroup([...(this.groups.get(key) ?? [key])]);
    return this.cache.get(key) ?? null;
  }

  evaluate(ref: ObjectRef): LayeredObjectSnapshot | null {
    if (this.depth > 0) return this.evaluateDependency(ref);
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
          return result;
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

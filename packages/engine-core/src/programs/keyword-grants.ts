import { validateCardProgram, type Ability, type Condition, type Expr } from '@riftbound/card-dsl';
import type { ContinuousEffectSpec, Duration, ObjectRef, ObjectSnapshot, ResolveContext } from '../effects/contract.js';
import type { KeywordDef } from '../effects/keyword-contract.js';
import { keywordDefinitionsById } from '../effects/keywords/registry.generated.js';
import { evaluateCondition } from '../effects/interpreter/condition.js';
import { evaluateExpression } from '../effects/interpreter/expr.js';
import { ContinuousEffectRegistry } from '../layers/duration.js';
import { LayerEngine } from '../layers/engine.js';
import { matchesObjectFilter } from '../layers/filter.js';
import { refKey, sameRef, type LayeredObjectSnapshot, type RegisteredContinuousEffect, type TimingEvent } from '../layers/types.js';
import { ProgramBindingError } from './errors.js';

type Keyword = ObjectSnapshot['keywords'][number];
type RecordValue = Record<string, unknown>;
export interface KeywordChange {
  readonly kind: 'grant' | 'remove';
  readonly keywords: readonly Keyword[];
}
export interface EffectiveKeywordExpansion {
  readonly keywords: readonly Keyword[];
  readonly abilities: readonly Ability[];
}

function blocked(message: string): never {
  throw new ProgramBindingError('judge-required', message);
}
function record(value: unknown): RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : {};
}
function definition(id: string): KeywordDef {
  const found = [...keywordDefinitionsById.values()].find(item => item.keyword.toLowerCase() === id.toLowerCase());
  return found ?? blocked(`Keyword ${id} has no executable KeywordDef`);
}
function keywordNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) blocked('Keyword values must be non-negative safe integers');
  return value;
}

/** CR 801.3, 807.2, 809.2, 810.2, 814.2: merge instances before expanding. */
export function expandEffectiveKeywords(source: ObjectSnapshot, changes: readonly KeywordChange[] = []): EffectiveKeywordExpansion {
  const instances = [...source.keywords];
  for (const change of changes) {
    if (change.kind === 'grant') instances.push(...change.keywords);
    else {
      const removed = new Set(change.keywords.map(keyword => keyword.id.toLowerCase()));
      for (let index = instances.length - 1; index >= 0; index--) {
        if (removed.has(instances[index]!.id.toLowerCase())) instances.splice(index, 1);
      }
    }
  }
  const groups = new Map<string, Keyword[]>();
  for (const keyword of instances) {
    if (keyword.value !== undefined) keywordNumber(keyword.value);
    const key = keyword.id.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), keyword]);
  }
  const keywords: Keyword[] = [];
  const abilities: Ability[] = [];
  for (const group of groups.values()) {
    const def = definition(group[0]!.id);
    const values = def.stacking === 'sum'
      ? [def.valued ? keywordNumber(group.reduce((sum, entry) => sum + (entry.value ?? 1), 0)) : undefined]
      : def.stacking === 'single' ? [group[0]!.value] : group.map(entry => entry.value);
    for (const value of values) {
      keywords.push(Object.freeze({ id: def.keyword, ...(value === undefined ? {} : { value }) }));
      abilities.push(...def.expand({ value, host: { canonicalCardId: source.cardId ?? source.ref.id } }));
    }
  }
  const validation = validateCardProgram({
    canonicalCardId: source.cardId ?? source.ref.id, rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: '[effective keyword expansion]', abilities,
  });
  if (!validation.ok) blocked(`Effective keyword expansion is invalid: ${JSON.stringify(validation.issues)}`);
  return { keywords: Object.freeze(keywords), abilities: Object.freeze(abilities) };
}

export interface KeywordGrantLayerOptions {
  /** A real host context; expressions and conditions use the shared interpreter. */
  readonly context: (source: ObjectSnapshot) => ResolveContext;
  readonly registry?: ContinuousEffectRegistry;
}

/**
 * Injectable through ChainEngineOptions.layers. This adapter owns keyword
 * expansion; callers must not also bind printed keyword expansions through
 * attachProgramLifecycle. The default lifecycle still needs that integration.
 * Non-static expansions fail closed until their lifecycle binding is available.
 * Tank's declaration is exposed, but combat must enforce its assignment rule.
 */
export class KeywordGrantLayerEngine extends LayerEngine {
  private readonly generated = new Set<string>();
  private view = new Map<string, LayeredObjectSnapshot>();
  private expansions = new Map<string, EffectiveKeywordExpansion>();
  private refreshing = false;

  constructor(objects: readonly ObjectSnapshot[], private readonly options: KeywordGrantLayerOptions) {
    super(objects, options.registry);
  }

  private clearGenerated(): void {
    for (const id of this.generated) this.registry.remove(id);
    this.generated.clear();
  }

  override setObjects(objects: Parameters<LayerEngine['setObjects']>[0]): void {
    this.clearGenerated();
    super.setObjects(objects);
  }
  override addContinuous(effect: ContinuousEffectSpec, duration: Duration, timestamp?: number): RegisteredContinuousEffect {
    this.clearGenerated();
    return super.addContinuous(effect, duration, timestamp);
  }
  override removeContinuous(id: string): boolean {
    this.clearGenerated();
    return super.removeContinuous(id);
  }
  override advance(event: TimingEvent): readonly string[] {
    this.clearGenerated();
    const expired = super.advance(event);
    this.refresh();
    return expired;
  }

  private environment(source: ObjectSnapshot) {
    const base = this.options.context(source);
    // KeywordDefs predate ObjectSnapshot.combatRole and spell it designation.
    const alias = (object: ObjectSnapshot) => ({ ...object, designation: object.combatRole });
    const context = new Proxy(base, { get: (target, key) => {
      if (key === 'source') return alias(source);
      if (key === 'controller') return source.controller;
      if (key === 'object') return (ref: ObjectRef) => {
        const object = this.view.get(refKey(ref));
        return object ? alias(object) : null;
      };
      if (key === 'query') return (filter: Parameters<ResolveContext['query']>[0]) => {
        const normalized = { ...filter };
        for (const field of ['controller', 'owner']) {
          if (normalized[field] === 'self') normalized[field] = source.controller;
          if (normalized[field] === 'opponent') normalized[field] = 'any';
        }
        return [...this.view.values()].filter(object =>
          (filter.controller !== 'opponent' || object.controller !== source.controller) &&
          (filter.owner !== 'opponent' || object.owner !== source.controller) &&
          matchesObjectFilter(normalized, object)).map(alias);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    return { context, host: source.ref, linked: (key: string) => context.linked(key), canLookBack: () => true, isIgnored: () => false };
  }

  private value(value: unknown, source: ObjectSnapshot): unknown {
    return typeof value === 'object' && value !== null && 'kind' in value
      ? evaluateExpression(value as Expr, this.environment(source)) : value;
  }

  private matches(entry: RegisteredContinuousEffect, object: LayeredObjectSnapshot): boolean {
    const filter = record(entry.effect.filter);
    if (filter.zoneEntryId !== undefined && filter.zoneEntryId !== object.ref.zoneEntryId) return false;
    const location = record(filter.location);
    if (location.type !== undefined && (object.location?.type !== location.type ||
      (location.type === 'battlefield' ? record(object.location).id !== location.id : record(object.location).player !== location.player))) return false;
    return matchesObjectFilter({ ...filter, ...(location.type === undefined ? {} : { location: undefined }) }, object);
  }

  private condition(effect: RecordValue, object: LayeredObjectSnapshot, source: ObjectSnapshot): boolean {
    const condition = effect.condition ?? effect.when;
    if (condition === undefined || condition === true) return true;
    if (condition === false) return false;
    if (typeof condition === 'function') return Boolean(condition(object));
    return evaluateCondition(condition as Condition, this.environment(source));
  }

  private keywordEffect(entry: RegisteredContinuousEffect): boolean {
    const effect = record(entry.effect.effect);
    return (String(effect.kind).includes('keyword') || effect.kind === 'continuous.combat') &&
      (effect.keyword !== undefined || effect.keywords !== undefined);
  }

  private changes(entries: readonly RegisteredContinuousEffect[], object: LayeredObjectSnapshot, printed: LayeredObjectSnapshot): KeywordChange[] {
    const changes: KeywordChange[] = [];
    for (const entry of entries) {
      if (entry.effect.layer !== 'ability' || !this.keywordEffect(entry) || !this.matches(entry, object)) continue;
      const effect = record(entry.effect.effect);
      const source = this.view.get(refKey(entry.effect.source ?? object.ref)) ?? object;
      const companions = entries.filter(other => other.effect.layer === 'arithmetic' && other.effect.id.startsWith(entry.effect.id + ':value:'));
      // The instruction's promotion predicate tests the pre-grant keyword.
      if (!this.condition(effect, companions.length ? printed : object, source)) continue;
      const raw = effect.keywords ?? effect.keyword;
      const keywords = (Array.isArray(raw) ? raw : [raw]).map((item, index): Keyword => {
        const declaration = typeof item === 'string' ? { id: item, value: effect.keywordValue ?? effect.value } : record(item);
        const id = declaration.id ?? declaration.keyword;
        if (typeof id !== 'string' || !id) blocked('Keyword grant requires an id');
        // continuous.grant-keyword stores an existing value in the ability
        // layer and its new contribution in an arithmetic companion. Read
        // that contribution once instead of counting both registrations.
        const companion = companions.find(other => other.effect.id === entry.effect.id + ':value:' + index);
        const value = this.value(companion ? record(companion.effect.effect).amount : declaration.value, source);
        return { id, ...(value === undefined ? {} : { value: keywordNumber(value) }) };
      });
      const kind = String(effect.kind);
      changes.push({ kind: kind.includes('remove') || kind.includes('lose') ? 'remove' : 'grant', keywords });
    }
    return changes;
  }

  private staticEffects(source: LayeredObjectSnapshot, expansion: EffectiveKeywordExpansion): ContinuousEffectSpec[] {
    return expansion.abilities.map((ability, index) => {
      if (ability.kind !== 'static') return blocked(`Dynamic ${ability.kind} keyword abilities need a lifecycle binder`);
      const effect = record(ability.effect);
      if (!['continuous.might', 'continuous.movement', 'continuous.combat', 'continuous.timing', 'target.tax'].includes(String(effect.kind))) {
        blocked(`Keyword static ${String(effect.kind)} needs a layer adapter`);
      }
      const movement = effect.kind === 'continuous.movement' && typeof effect.permission === 'string'
        ? { permission: { routes: [effect.permission], move: effect.move, source: effect.source, destination: effect.destination }, canGank: effect.permission === 'battlefield-to-battlefield' }
        : {};
      const normalized = Object.fromEntries(Object.entries(effect).map(([key, value]) => [key, this.value(value, source)]));
      return {
        id: `program-keyword:${JSON.stringify([source.ref.id, source.ref.zoneEntryId, index])}`,
        source: source.ref,
        layer: effect.kind === 'continuous.might' ? 'arithmetic' : 'ability',
        filter: { objectId: source.ref.id, zoneEntryId: source.ref.zoneEntryId, zone: source.zone },
        effect: {
          ...normalized, ...movement, kind: String(effect.kind),
          condition: (object: LayeredObjectSnapshot) => sameRef(object.ref, source.ref) &&
            (!ability.condition || evaluateCondition(ability.condition, this.environment(this.view.get(refKey(source.ref)) ?? source))),
        },
      };
    });
  }

  private registryFor(entries: readonly RegisteredContinuousEffect[]): ContinuousEffectRegistry {
    const registry = new ContinuousEffectRegistry();
    for (const entry of entries) registry.register(entry.effect, entry.duration, entry.timestamp);
    return registry;
  }

  private refresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    this.clearGenerated();
    try {
      const raw = this.objectsView();
      const entries = this.registry.active(undefined, ref => raw.find(object => sameRef(object.ref, ref)) ?? null);
      const prefix = new LayerEngine(raw, this.registryFor(entries.filter(entry => ['copy', 'trait'].includes(entry.effect.layer)))).evaluateAll();
      const remaining = entries.filter(entry => !['copy', 'trait'].includes(entry.effect.layer) && !this.keywordEffect(entry));
      // Begin from current printed/copy characteristics on every query. A
      // previously granted Shield must not sustain its own Might threshold.
      const seed = new LayerEngine(prefix, this.registryFor(remaining)).evaluateAll();
      this.view = new Map(seed.map(object => [refKey(object.ref), object]));
      let previous = '';
      let generated: ContinuousEffectSpec[] = [];
      const limit = entries.length + prefix.length + 4;
      for (let pass = 0; pass < limit; pass++) {
        const expansions = new Map(prefix.map(object => [refKey(object.ref), expandEffectiveKeywords(object,
          this.changes(entries, this.view.get(refKey(object.ref)) ?? object, object))]));
        const signature = JSON.stringify([...expansions].map(([key, value]) => [key, value.keywords]));
        if (signature === previous) {
          this.expansions = expansions;
          for (const effect of generated) {
            this.registry.register(effect, { type: 'permanent' });
            this.generated.add(effect.id);
          }
          return;
        }
        previous = signature;
        const objects = prefix.map(object => ({ ...object, keywords: expansions.get(refKey(object.ref))!.keywords }));
        this.view = new Map(objects.map(object => [refKey(object.ref), object]));
        generated = objects.flatMap(object => this.staticEffects(object, expansions.get(refKey(object.ref))!));
        const registry = this.registryFor(remaining);
        for (const effect of generated) registry.register(effect, { type: 'permanent' });
        const evaluated = new LayerEngine(objects, registry).evaluateAll();
        this.view = new Map(evaluated.map(object => [refKey(object.ref), object]));
      }
      blocked('Keyword layer dependencies did not converge; an explicit dependency adapter is required');
    } catch (error) {
      this.clearGenerated();
      this.view.clear();
      this.expansions.clear();
      throw error;
    } finally {
      this.refreshing = false;
    }
  }

  override evaluate(ref: ObjectRef): LayeredObjectSnapshot | null {
    this.refresh();
    return this.view.get(refKey(ref)) ?? null;
  }
  override evaluateAll(): readonly LayeredObjectSnapshot[] {
    this.refresh();
    return Object.freeze([...this.view.values()]);
  }
  keywordAbilities(ref: ObjectRef): readonly Ability[] {
    this.refresh();
    return this.expansions.get(refKey(ref))?.abilities ?? [];
  }
}

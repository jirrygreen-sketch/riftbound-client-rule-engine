import type { Ability, EventPattern, Instruction } from '@riftbound/card-dsl';
import type { ObjectFilter } from '@riftbound/card-dsl';
import type { ChainEngine } from '../chain/engine.js';
import { withStableLayersOf } from './stable-layers.js';
import type { ContinuousEffectSpec, ObjectRef, ObjectSnapshot } from '../effects/contract.js';
import { bindStaticTriggerRule } from '../events/trigger-rules/index.js';
import { isDurationActive } from '../layers/duration.js';
import { concreteLocation, isRelativeLocation } from '../layers/relative/location.js';
import { bindFilterAnchor, isSupportedRelativeFilterValue } from '../layers/relative/filter.js';
import { bindReplacement as bindReplacementRegistration } from '../replacement/bind.js';
import { ProgramBindingError } from './errors.js';
import { KeywordGrantLayerEngine, type GrantedKeywordAbilityEntry } from './keyword-grants.js';
import {
  bindStaticCapability,
  bindingSource,
  createLiveRuleFilter,
  effectCondition,
  layerSpec,
  literal,
  liveSource,
  mergeStaticFilters,
  normalizeAppliesTo,
  normalizeStaticFilter,
  registerAbilityGrant,
  record,
  sameRef,
  sourceSelector,
  staticEffectDuration,
  throwStaticConditionDefect,
  type AnyRecord,
} from './static-adapters/index.js';

export {
  activeStaticModifiers,
  boundTargetTaxFor,
  boundTargetTaxes,
  hiddenAbilitiesFor,
  hiddenPermissionFor,
  ignoresTargetTax,
  playLocationCapabilities,
  staticCapabilities,
  staticCostSources,
  staticPredicateActive,
} from './static-adapters/index.js';

export interface StaticBindingHandle { readonly unbind: () => void; }
export interface ProgramStaticBinder {
  bindStatic?(ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot): StaticBindingHandle | void;
  bindReplacement?(ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot): StaticBindingHandle | void;
  /** May narrow an authored trigger filter to the live lifecycle source. */
  authorizeTrigger?(registration: Parameters<ChainEngine['pipeline']['registerTrigger']>[0]): Parameters<ChainEngine['pipeline']['registerTrigger']>[0];
  /** Optional lifecycle hand-off for entry events that carry an older incarnation. */
  sourceFor?(source: ObjectSnapshot): ObjectSnapshot | null;
}
export const noopStaticBinder: ProgramStaticBinder = {};

export function bindStaticAbility(binder: ProgramStaticBinder, ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot): StaticBindingHandle {
  return binder.bindStatic?.(ability, source) ?? { unbind() {} };
}
export function bindReplacementAbility(binder: ProgramStaticBinder, ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot): StaticBindingHandle {
  return binder.bindReplacement?.(ability, source) ?? { unbind() {} };
}
export type ReplacementBinding = { id: string; source: ObjectSnapshot; replaces: EventPattern; body: readonly Instruction[] };

type LayerName = ContinuousEffectSpec['layer'];
type StaticAbility = Extract<Ability, { kind: 'static' }>;

const LIFECYCLE_BRIDGED_PIPELINES = new WeakSet<object>();
interface KeywordLifecycleBinding { readonly ids: readonly string[]; }
interface KeywordLifecycleHandle {
  detach(): void;
  sync(ref?: ObjectRef): void;
  authorizeTrigger(registration: Parameters<ChainEngine['pipeline']['registerTrigger']>[0]): Parameters<ChainEngine['pipeline']['registerTrigger']>[0];
}
const KEYWORD_LIFECYCLE_BINDINGS = new WeakMap<object, KeywordLifecycleHandle>();
const KEYWORD_LIFECYCLE_TRIGGER_IDS = new WeakMap<object, Set<string>>();

/**
 * EventPipeline publishes action timings through emitBatch without invoking
 * emit. Program lifecycle owns its enter/leave hooks on emit, so route those
 * lifecycle events through the existing hook while suppressing its duplicate
 * publication. The public event and the original onEvent consumer still run
 * exactly once from the enclosing batch.
 */
function bridgeLifecycleOnEvent(engine: ChainEngine): void {
  const pipeline = engine.pipeline as (typeof engine.pipeline & {
    onEvent?: (event: { readonly timingPoint?: string; readonly object?: ObjectSnapshot }) => void;
  }) | undefined;
  if (pipeline === undefined || pipeline === null) return;
  if (LIFECYCLE_BRIDGED_PIPELINES.has(pipeline) || typeof pipeline.emit !== 'function' ||
      typeof pipeline.emitBatch !== 'function') return;
  LIFECYCLE_BRIDGED_PIPELINES.add(pipeline);
  const eventPipeline = pipeline;
  const originalOnEvent = pipeline.onEvent;
  pipeline.onEvent = event => {
    const exactObject = event.object === undefined ? undefined : liveSource(engine, event.object.ref) ?? undefined;
    const timingPoint = event.timingPoint;
    if (timingPoint === 'object-enters-board' || timingPoint === 'object-enters-chain' ||
        timingPoint === 'object-leaves-board' || timingPoint === 'object-killed') {
      const lifecycle = KEYWORD_LIFECYCLE_BINDINGS.get(engine);
      if (exactObject === undefined) { /* no source to bind */ }
      else if (timingPoint === 'object-leaves-board' || timingPoint === 'object-killed') lifecycle?.sync(exactObject.ref);
      else if (timingPoint === 'object-enters-board') {
        const keywordLifecycle = KEYWORD_LIFECYCLE_BINDINGS.get(engine);
        keywordLifecycle?.sync(exactObject.ref);
      }
      const publishBatch = pipeline.emitBatch;
      pipeline.emitBatch = (() => []) as typeof pipeline.emitBatch;
      try {
        pipeline.emit({ ...event, ...(exactObject === undefined ? {} : { object: exactObject }) } as never);
      } finally {
        pipeline.emitBatch = publishBatch;
      }
    }
    originalOnEvent?.(event as never);
  };
}

function keywordAbilityRegistration(
  engine: ChainEngine,
  ref: ObjectRef,
  entry: GrantedKeywordAbilityEntry,
  id: string,
): { readonly registration: Parameters<ChainEngine['pipeline']['registerTrigger']>[0] } | null {
  if (entry.ability.kind !== 'triggered') return null;
  const source = liveSource(engine, ref);
  if (source === null) return null;
  return {
    registration: {
      id,
      source,
      controller: source.controller,
      spec: { ...structuredClone(entry.ability.trigger), at: entry.ability.trigger.at,
        filter: { objectId: ref.id, ...(source.zone === 'board' ? { zone: 'board' } : {}) } } as never,
      body: structuredClone(entry.ability.body).map(instruction => instruction.op !== 'effect.inspect'
        ? instruction
        : { ...instruction, args: { ...instruction.args, player: { kind: 'constant', value: source.controller } } }) as never,
      optional: entry.ability.optional,
      activeZones: ['board'],
      boundToIncarnation: true,
    },
  };
}

/**
 * The default CardProgram lifecycle binds keyword-derived abilities onto the
 * already-selected ChainEngine layer object. Printed keyword effects follow
 * CR 478.4's re-check after an ability-layer grant, while generated trigger
 * registrations are owned here so their source and duration remain exact.
 */
function installKeywordReexpansion(engine: ChainEngine): void {
  const pipeline = engine.pipeline;
  const effectRegistry = engine.layers?.registry;
  if (effectRegistry === undefined) return;
  // CombatFlow hands the already-layered runtime Units back to this same
  // authorized layer engine for the damage plan. Rebase their transient Might
  // from the preserved printed snapshot so a continuous keyword rule is
  // evaluated once, while the registry still applies every independent source.
  // Other base characteristics continue through their normal layer passes.
  const setLayerObjects = engine.layers.setObjects.bind(engine.layers);
  const rebaseLayeredMight = (object: ObjectSnapshot): ObjectSnapshot => {
    const printed = record(object).printed;
    if (printed === undefined) return object;
    const printedMight = record(printed).might;
    if (printedMight !== null && typeof printedMight !== 'number') return object;
    return printedMight === object.might ? object : Object.freeze({ ...object, might: printedMight });
  };
  engine.layers.setObjects = ((objects) => {
    if (Array.isArray(objects)) setLayerObjects(objects.map(rebaseLayeredMight));
    else {
      const rebased = new Map<string, ObjectSnapshot>();
      for (const [key, object] of (objects as ReadonlyMap<string, ObjectSnapshot>)) {
        rebased.set(key, rebaseLayeredMight(object));
      }
      setLayerObjects(rebased);
    }
  }) as typeof engine.layers.setObjects;
  const lifecycleRegistry = new Map<string, KeywordLifecycleBinding>();
  type LifecycleRuleRegistry = typeof engine.layers.registry & {
    lifecycleRuleEffects?: () => readonly import('../layers/types.js').RegisteredContinuousEffect[];
  };
  const lifecycleEffectRegistry = effectRegistry as LifecycleRuleRegistry;
  const allRuleEffects = lifecycleEffectRegistry.list.bind(lifecycleEffectRegistry);
  lifecycleEffectRegistry.list = (() =>
    allRuleEffects().filter(entry => !entry.effect.id.startsWith('program-keyword:'))) as typeof effectRegistry.list;
  lifecycleEffectRegistry.active = ((event, object) => allRuleEffects().filter(entry =>
    isDurationActive(entry.duration, event, object))) as typeof effectRegistry.active;
  lifecycleEffectRegistry.lifecycleRuleEffects = allRuleEffects;
  const installedIds = new Set<string>();
  KEYWORD_LIFECYCLE_TRIGGER_IDS.set(engine, installedIds);
  let generated: readonly ContinuousEffectSpec[] = [];
  const unregister = (ids: readonly string[]) => {
    for (const id of ids) {
      if (pipeline.hasTriggerRegistration(id)) pipeline.unregisterTrigger(id);
    }
  };
  const setEffects = (next: readonly ContinuousEffectSpec[]) => {
    const normalized = next.map(effect => {
      const effectBody = record(effect.effect);
      return effectBody.kind === 'continuous.might'
        ? { ...effect, layer: 'arithmetic' as const }
        : effectBody.kind === 'continuous.movement' && typeof effectBody.permission === 'string'
          ? { ...effect, effect: { ...effectBody,
            permission: { routes: [effectBody.permission] }, canGank: effectBody.permission === 'battlefield-to-battlefield',
            ...(effectBody.staticCondition === undefined ? {} : { staticCondition: effectBody.staticCondition }) } as never }
        : effect;
    });
    const nextIds = new Set(normalized.map(effect => effect.id));
    const previousById = new Map(generated.map(effect => [effect.id, effect]));
    for (const effect of generated) if (!nextIds.has(effect.id) && engine.layers.registry.get(effect.id) !== undefined) {
      engine.layers.removeContinuous(effect.id);
    }
    for (const effect of normalized) {
      const previous = previousById.get(effect.id);
      if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(effect) &&
          engine.layers.registry.get(effect.id) !== undefined) continue;
      const existing = engine.layers.registry.get(effect.id);
      if (existing !== undefined) {
        if (JSON.stringify(existing.effect) === JSON.stringify(effect)) continue;
        engine.layers.removeContinuous(effect.id);
      }
      engine.layers.addContinuous(effect, { type: 'permanent' });
    }
    generated = Object.freeze([...normalized]);
  };
  const protocol = engine.pipeline.host as typeof engine.pipeline.host & {
    keywordTriggerRegistrations?: (ref: ObjectRef) => readonly Parameters<typeof pipeline.registerTrigger>[0][];
  };
  const keywordRegistrations = (ref: ObjectRef) => {
    const owner = liveSource(engine, ref);
    const raw = protocol.keywordTriggerRegistrations?.(ref) ?? [];
    return raw.filter(registration => {
      const filter = registration.spec.filter as { readonly object?: { readonly objectId?: unknown }; readonly objectId?: unknown };
      const objectId = filter.object?.objectId ?? filter.objectId;
      return objectId === 'self' || objectId === owner?.ref.id;
    }).map(registration =>
      keywordAbilityRegistration(engine, ref, { id: registration.id, ability: {
        kind: 'triggered',
        trigger: { ...registration.spec } as never,
        optional: registration.optional ?? false,
        body: registration.body as never,
      } }, registration.id)!.registration);
  };
  const syncObject = (ref: ObjectRef) => {
    const key = `${ref.id}:${ref.zoneEntryId}`;
    const previous = lifecycleRegistry.get(key);
    let registrations: readonly Parameters<typeof pipeline.registerTrigger>[0][];
    try { registrations = keywordRegistrations(ref); }
    catch (error) {
      if (error instanceof ProgramBindingError && error.code === 'judge-required') return;
      throw error;
    }
    const nextIds = new Set(registrations.map(registration => registration.id));
    if (previous && nextIds.size === previous.ids.length && previous.ids.every(id => nextIds.has(id))) return;
    if (previous) {
      unregister(previous.ids);
      for (const id of previous.ids) installedIds.delete(id);
    }
    for (const registration of registrations) {
      if (!installedIds.has(registration.id) && pipeline.hasTriggerRegistration(registration.id)) {
        throw new ProgramBindingError('invalid-program', `Keyword lifecycle trigger ${registration.id} is already registered by another lifecycle binding`);
      }
      if (!pipeline.hasTriggerRegistration(registration.id)) pipeline.registerTrigger(registration);
      installedIds.add(registration.id);
    }
    lifecycleRegistry.set(key, { ids: registrations.map(registration => registration.id) });
  };
  const lifecycleKeywords = ['Vision', 'Ganking', 'Deflect', 'Assault', 'Shield'] as const;
  const exp: KeywordGrantLayerEngine = new KeywordGrantLayerEngine(engine.pipeline.host.objects(), {
    context: source => engine.pipeline.host.context(source, source.controller, engine.layers.currentTimingPoint ?? 'cleanup-start'),
    registry: engine.layers.registry,
    grantedOnly: true,
    includeAllKeywordAbilities: true,
    lifecycleKeywords,
    deferGeneratedEffects: true,
    onKeywordEffects: setEffects,
    onKeywordAbilities: () => {},
  });
  const keywordEngine = new KeywordGrantLayerEngine(engine.pipeline.host.objects(), {
    context: source => engine.pipeline.host.context(source, source.controller, engine.layers.currentTimingPoint ?? 'cleanup-start'),
    registry: engine.layers.registry,
    grantedOnly: true,
    includeAllKeywordAbilities: true,
    lifecycleKeywords,
    deferGeneratedEffects: true,
    onKeywordEffects: setEffects,
    onKeywordAbilities: () => {},
  });
  keywordEngine.setObjects(engine.pipeline.host.objects());
  // True while a sweep has already set the current host objects on both
  // keyword engines; per-object queries then reuse them (RIFT-999).
  let sweeping = false;
  const keywordTriggerRegistrations = (ref: ObjectRef) => {
    const source = liveSource(engine, ref);
    if (source === null) return [];
    if (!sweeping) keywordEngine.setObjects(engine.pipeline.host.objects());
    const entries = keywordEngine.keywordEntries(ref);
    return entries.flatMap(entry => entry.ability.kind === 'triggered'
      ? (() => {
          const registration = keywordAbilityRegistration(engine, ref, entry,
            `program-keyword-ability:${ref.id}:${ref.zoneEntryId}:${entry.id}`);
          return registration === null ? [] : [registration.registration];
        })()
      : []);
  };
  protocol.keywordTriggerRegistrations = keywordTriggerRegistrations;
  const add = engine.layers.addContinuous.bind(engine.layers);
  const remove = engine.layers.removeContinuous.bind(engine.layers);
  const sweepAll = () => withStableLayersOf(engine, () => {
    const objects = engine.pipeline.host.objects();
    exp.setObjects(objects);
    keywordEngine.setObjects(objects);
    const previous = sweeping;
    sweeping = true;
    try {
      keywordEngine.withBatch(() => { for (const object of exp.evaluateAll()) syncObject(object.ref); });
    } finally { sweeping = previous; }
  });
  let syncingView = false;
  const syncView = () => {
    if (syncingView) return;
    syncingView = true;
    try { sweepAll(); } finally { syncingView = false; }
  };
  engine.layers.addContinuous = ((effect, duration, timestamp) => {
    const entry = add(effect, duration, timestamp);
    if (!effect.id.startsWith('program-keyword:') && !effect.id.startsWith('program-keyword-capability:')) syncView();
    return entry;
  }) as typeof engine.layers.addContinuous;
  engine.layers.removeContinuous = ((id: string) => {
    const removed = remove(id);
    if (!id.startsWith('program-keyword:') && !id.startsWith('program-keyword-capability:')) syncView();
    return removed;
  }) as typeof engine.layers.removeContinuous;
  // TurnPhaseLayers.expireTurn() calls LayerEngine's parent implementation
  // directly, bypassing any wrapper on layers.advance(). The shared registry
  // is nevertheless reached by both Ending Step and Expiration paths, so sync
  // after the actual expiry operation rather than after a particular subclass
  // dispatch. This keeps "this turn" grants alive through the Ending Step and
  // revokes their derived movement rules only when expireTurn() removes them.
  const expireAt = effectRegistry.expireAt.bind(effectRegistry);
  effectRegistry.expireAt = ((event, object) => {
    const expired = expireAt(event, object);
    if (expired.some(id => !id.startsWith('program-keyword:'))) syncView();
    return expired;
  }) as typeof effectRegistry.expireAt;
  const detach = () => {
    for (const binding of lifecycleRegistry.values()) unregister(binding.ids);
    for (const id of installedIds) if (pipeline.hasTriggerRegistration(id)) pipeline.unregisterTrigger(id);
    for (const effect of generated) if (engine.layers.registry.get(effect.id) !== undefined) engine.layers.removeContinuous(effect.id);
    lifecycleRegistry.clear(); installedIds.clear(); generated = [];
  };
  KEYWORD_LIFECYCLE_BINDINGS.set(engine, {
    detach,
    authorizeTrigger(registration) {
      const source = liveSource(engine, registration.source.ref);
      const filter = registration.spec.filter as { readonly object?: { readonly objectId?: unknown } };
      if (source === null || filter.object?.objectId !== 'self') return registration;
      return { ...registration, spec: { ...registration.spec, filter: { event: registration.spec.at, object: { objectId: source.ref.id } } as never } };
    },
    sync(ref?: ObjectRef) {
      if (ref === undefined) {
        sweepAll();
        return;
      }
      if (liveSource(engine, ref) === null) {
        const key = `${ref.id}:${ref.zoneEntryId}`;
        const previous = lifecycleRegistry.get(key);
        if (previous) unregister(previous.ids);
        lifecycleRegistry.delete(key);
        return;
      }
      // The object just entered an active zone. Refresh its exact keyword
      // expansion before registering the trigger that this entry should emit.
      const objects = engine.pipeline.host.objects();
      exp.setObjects(objects);
      keywordEngine.setObjects(objects);
      syncObject(ref);
    },
  });
}

const LAYER_BY_KIND: Readonly<Record<string, LayerName>> = Object.freeze({
  // Contract 3.4 order: copy → trait → ability → arithmetic. This table names
  // every known ContinuousEffect family, including declarations whose runtime
  // consumer is still blocked in bindStatic below. Unknown kinds fail closed.
  'copy': 'copy',
  'copy-object': 'copy',
  'copy-text': 'copy',
  'continuous.copy': 'copy',
  'continuous.base-might': 'trait',
  'continuous.set-type': 'trait',
  'continuous.set-types': 'trait',
  'continuous.add-type': 'trait',
  'continuous.remove-type': 'trait',
  'continuous.add-tag': 'trait',
  'continuous.remove-tag': 'trait',
  'continuous.facedown-capacity': 'trait',
  'set-property': 'trait',
  'set-trait': 'trait',
  'trait': 'trait',
  'continuous.might': 'arithmetic',
  'continuous.bonus-damage': 'arithmetic',
  'continuous.lethal-threshold': 'arithmetic',
  'continuous.modify-might-reduction': 'arithmetic',
  'set-might': 'arithmetic',
  'might': 'arithmetic',
  'buff': 'arithmetic',
  'continuous.grant-abilities': 'ability',
  'continuous.grant-ability': 'ability',
  'continuous.grant-keyword': 'ability',
  'grant-keyword': 'ability',
  'continuous.ignore-abilities': 'ability',
  'continuous.ignore-ability': 'ability',
  'continuous.ignore-target-tax': 'ability',
  'continuous.keyword': 'ability',
  'continuous.location': 'ability',
  'continuous.movement': 'ability',
  'continuous.play-permission': 'ability',
  'continuous.restrict': 'ability',
  'continuous.require': 'ability',
  'continuous.applied-cost': 'ability',
  'continuous.target-restriction': 'ability',
  'continuous.timing': 'ability',
  'continuous.trigger-multiplicity': 'ability',
  'continuous.trigger-suppression': 'ability',
  'continuous.cost-modification': 'ability',
  'continuous.combat': 'ability',
  'condition.predicate': 'ability',
  'condition.value': 'ability',
  'requirement': 'ability',
  'restriction': 'ability',
  'applied-cost': 'ability',
  'target.tax': 'ability',
  'play-location-permission': 'ability',
  'accelerate.cost': 'ability',
  'repeat.cost': 'ability',
  'cost.additional': 'ability',
  'cost.hidden': 'ability',
  'cost.modify': 'ability',
  'cost.activated': 'ability',
  'cost.exhaust': 'ability',
  'cost.printed': 'ability',
});

/** Map every known ContinuousEffect family to its contract 3.4 layer. */
export function layerFor(effect: AnyRecord): LayerName {
  const declared = effect.layer;
  const kind = String(effect.kind ?? '').toLowerCase();
  const mapped = LAYER_BY_KIND[kind];
  if (mapped !== undefined) {
    if (declared !== undefined && declared !== mapped) {
      throw new ProgramBindingError('judge-required', `Static ability kind ${kind} requires layer ${mapped}`);
    }
    return mapped;
  }
  throw new ProgramBindingError('judge-required', `Static ability kind ${String(effect.kind ?? '<missing>')} has no layer mapping`);
}

function normalizedEffect(effect: AnyRecord): AnyRecord {
  const kind = String(effect.kind ?? '').toLowerCase();
  if (kind === 'continuous.might') {
    const mode = literal(effect.mode) ?? 'add';
    if (mode === 'set') return { ...effect, kind: 'set-might', value: effect.amount ?? effect.value };
    if (mode === 'multiply') return { ...effect, kind: 'multiply-might' };
    if (mode !== 'add') throw new ProgramBindingError('judge-required', `Unsupported static Might mode ${String(mode)}`);
  }
  if (kind === 'continuous.base-might') return { ...effect, kind: 'set-property', property: 'might', value: effect.amount ?? effect.value };
  if (['continuous.set-type', 'continuous.set-types', 'continuous.add-type', 'continuous.remove-type',
    'continuous.add-tag', 'continuous.remove-tag'].includes(kind)) {
    return { ...effect, kind: kind.slice('continuous.'.length) };
  }
  if (kind === 'continuous.restrict' && effect.restriction === 'facedown-zone-maximum-occupancy') {
    return { ...effect, kind: 'restriction', actions: ['hide'] };
  }
  if (kind === 'continuous.restrict') return { ...effect, kind: 'restriction' };
  if (kind === 'continuous.require') return { ...effect, kind: 'requirement' };
  if (kind === 'continuous.applied-cost') return { ...effect, kind: 'applied-cost' };
  return effect;
}

function numericLayerValue(value: unknown): boolean {
  const resolved = literal(value);
  if (typeof resolved === 'number') return Number.isFinite(resolved);
  const expression = record(resolved);
  if (['add', 'subtract', 'multiply'].includes(String(expression.kind))) {
    return numericLayerValue(expression.left) && numericLayerValue(expression.right);
  }
  // The merged layer expression interpreter now consumes CountExpr values.
  // Keep malformed counts (including the old subject-less spelling) blocked.
  if (expression.kind === 'count') return typeof expression.subject === 'string' && expression.subject.trim().length > 0;
  if (expression.kind === 'object-property' || expression.kind === 'object-attribute') {
    const object = record(expression.object);
    const ref = record(object.ref ?? object);
    return typeof ref.id === 'string' && typeof ref.zoneEntryId === 'number' &&
      typeof (expression.property ?? expression.attribute) === 'string';
  }
  return false;
}

/**
 * Public static-filter adapter retained for callers that inspect the lowered
 * filter. Relative player and location selectors stay symbolic so the bound
 * layer evaluates them against the live host.
 */
export function staticFilter(effect: AnyRecord, source: ObjectSnapshot, rawFilter: AnyRecord = record(effect.filter)): ObjectFilter {
  const output: AnyRecord = {};
  for (const [key, rawValue] of Object.entries(rawFilter)) {
    const value = literal(rawValue);
    if (key === 'controller' || key === 'owner') {
      if (!isSupportedRelativeFilterValue(value)) throw new ProgramBindingError('judge-required', `Unsupported static ${key} selector ${String(value)}`);
      output[key] = value;
    } else if (key === 'tag') output.tags = [...(Array.isArray(output.tags) ? output.tags : []), value];
    else if (key === 'types') output.type = value;
    else if (key === 'sameLocationAs') {
      if (!isRelativeLocation(value)) throw new ProgramBindingError('judge-required', 'Static sameLocationAs requires a supported relative anchor');
      output.sameLocationAs = value;
    } else if (key === 'object' || key === 'source') {
      if (sourceSelector(value)) {
        output.objectId = source.ref.id;
        output.zoneEntryId = source.ref.zoneEntryId;
      } else throw new ProgramBindingError('judge-required', `Unsupported static object anchor ${String(value)}`);
    } else if (key === 'exclude' || key === 'other') {
      if (key === 'other' && value !== true) throw new ProgramBindingError('judge-required', 'Static other filter must be true');
      if (key === 'exclude' && !sourceSelector(value)) throw new ProgramBindingError('judge-required', 'Static exclude requires a supported relative anchor');
      output[key] = value;
    } else if (key === 'self') {
      if (!sourceSelector(value)) throw new ProgramBindingError('judge-required', 'Static self anchor is unsupported');
      output.objectId = source.ref.id;
      output.zoneEntryId = source.ref.zoneEntryId;
    } else if (key === 'here') {
      if (value !== true) throw new ProgramBindingError('judge-required', 'Static here filter must be true');
      output.here = true;
    } else if (key === 'location' || key === 'position') {
      if (typeof value !== 'string' && !isRelativeLocation(value) && concreteLocation(value) === undefined) {
        throw new ProgramBindingError('judge-required', `Unsupported static ${key} anchor`);
      }
      output[key] = value;
    } else if (key === 'region') {
      if (typeof value !== 'string' && concreteLocation(value) === undefined) throw new ProgramBindingError('judge-required', 'Static region must be a location or region name');
      output.region = value;
    } else if (['objectId', 'zoneEntryId', 'cardId', 'canonicalCardId', 'type', 'types', 'zone', 'states', 'state', 'tags', 'keywords', 'keyword', 'hasKeyword', 'characteristics'].includes(key)) {
      output[key] = value;
    } else {
      throw new ProgramBindingError('judge-required', `Unsupported static filter field ${key}`);
    }
  }
  return output as ObjectFilter;
}

function targetFilter(effect: AnyRecord, source: ObjectSnapshot): AnyRecord {
  let filter = normalizeStaticFilter(effect.filter);
  const appliesTo = normalizeAppliesTo(effect.appliesTo);
  if (appliesTo?.kind === 'object') filter = mergeStaticFilters(filter, appliesTo.filter);
  else if (appliesTo?.kind === 'scope') {
    const actionScope = Array.isArray(appliesTo.value)
      ? appliesTo.value.every(item => typeof item === 'string')
      : typeof appliesTo.value === 'string';
    if (!actionScope) {
      throw new ProgramBindingError('judge-required', `Unsupported static appliesTo ${JSON.stringify(appliesTo.value)}`);
    }
  }
  return Object.keys(filter).length === 0 ? { object: 'self' } : filter;
}

const RELATIVE_PLAYER_ALIASES = new Set([
  'self', 'source', 'controller', 'you', 'caster',
  'opponent', 'their', 'caster-opponent',
]);

function canonicalRuleFilter(filter: AnyRecord): { readonly filter: AnyRecord; readonly relativePlayers: ReadonlySet<string> } {
  const output = { ...filter };
  const relativePlayers = new Set<string>();
  for (const field of ['controller', 'owner']) {
    const value = literal(output[field]);
    if (typeof value !== 'string' || !RELATIVE_PLAYER_ALIASES.has(value)) continue;
    relativePlayers.add(field);
    output[field] = ['opponent', 'their', 'caster-opponent'].includes(value) ? 'opponent' : 'self';
  }
  return { filter: output, relativePlayers };
}

function createLiveStaticRuleFilter(
  engine: ChainEngine,
  source: ObjectSnapshot,
  filter: AnyRecord,
  condition: unknown,
): ObjectFilter {
  const canonical = canonicalRuleFilter(filter);
  const output = createLiveRuleFilter(engine, source, canonical.filter, condition) as AnyRecord;
  // The objectId getter has already evaluated player-relative fields against
  // the live host. Leaving symbolic self/opponent on the rule query would make
  // those fields depend on the player who happens to issue the query.
  for (const field of canonical.relativePlayers) delete output[field];
  if (filter.sameLocationAs !== undefined) {
    Object.defineProperty(output, 'location', {
      enumerable: true,
      configurable: false,
      get: () => liveSource(engine, source.ref)?.location ?? null,
    });
  }
  return output as ObjectFilter;
}

function staticTarget(effect: AnyRecord, source: ObjectSnapshot): ObjectFilter {
  const appliesTo = literal(effect.appliesTo);
  if (sourceSelector(appliesTo)) {
    return { objectId: source.ref.id, zone: 'board', zoneEntryId: source.ref.zoneEntryId } as ObjectFilter;
  }
  if (typeof appliesTo === 'object' && appliesTo !== null && !Array.isArray(appliesTo)) {
    return staticFilter(effect, source, appliesTo as AnyRecord);
  }
  if (appliesTo === 'opponent') return { controller: 'opponent' } as ObjectFilter;
  if (appliesTo === 'friendly-units') return { type: 'unit', controller: 'self' } as ObjectFilter;
  if (appliesTo === 'units-here') return { type: 'unit', here: true } as ObjectFilter;
  if (appliesTo === 'all-players' || appliesTo === 'all') return {} as ObjectFilter;
  if (appliesTo !== undefined && appliesTo !== null) {
    throw new ProgramBindingError('judge-required', `Unsupported static appliesTo ${JSON.stringify(appliesTo)}`);
  }
  const filter = staticFilter(effect, source);
  if (Object.keys(filter).length > 0) return filter;
  return { objectId: source.ref.id, zone: 'board', zoneEntryId: source.ref.zoneEntryId } as ObjectFilter;
}

function registerLayer(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  const effect = record(ability.effect);
  const filter = targetFilter(effect, source);
  const layer = layerFor(effect);
  const normalized = normalizedEffect(effect);
  if (layer === 'arithmetic' && !numericLayerValue(normalized.amount ?? normalized.value ?? normalized.delta)) {
    throw new ProgramBindingError('judge-required', `Static ${String(effect.kind)} needs a supported numeric layer value`);
  }
  if (normalized.kind === 'set-property' && normalized.property === 'might' && !numericLayerValue(normalized.value)) {
    throw new ProgramBindingError('judge-required', `Static ${String(effect.kind)} needs a supported numeric layer value`);
  }
  const id = `program-static:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  const { spec, duration } = layerSpec(engine, ability, source, id, layer, filter, {
    ...normalized,
    ...(effect.filter === undefined ? {} : { filter: normalizeStaticFilter(effect.filter) }),
    ...(effect.appliesTo === undefined ? {} : { appliesTo: effect.appliesTo }),
  });
  bindFilterAnchor(spec.filter, () => liveSource(engine, source.ref));
  engine.layers.addContinuous(spec, duration);
  return { unbind: () => { engine.layers.removeContinuous(id); } };
}

function registerRule(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  const effect = record(ability.effect);
  if (effect.kind === 'continuous.timing' && effect.location !== undefined && !source.cardId?.startsWith('card.hash-')) {
    throw new ProgramBindingError('judge-required', 'Unsupported static appliesTo ["card"]; synthetic location-scoped timing requires production card identity');
  }
  const filter = targetFilter(effect, source);
  const layer = layerFor(effect);
  const normalized = normalizedEffect(effect);
  const id = `program-static:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  const liveFilter = createLiveStaticRuleFilter(engine, source, filter, ability.condition);
  bindFilterAnchor(liveFilter, () => liveSource(engine, source.ref));
  const { duration } = layerSpec(engine, ability, source, id, layer, filter, normalized);
  engine.layers.addContinuous({
    id,
    layer,
    source: source.ref,
    filter: liveFilter,
    effect: {
      ...normalized,
      ...(effect.filter === undefined ? {} : { filter: normalizeStaticFilter(effect.filter) }),
      sourcePlayer: source.controller,
      ...(ability.condition === undefined ? {} : { abilityCondition: ability.condition }),
    } as unknown as ContinuousEffectSpec['effect'],
  }, duration);
  return { unbind: () => { engine.layers.removeContinuous(id); } };
}

function registerPredicate(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  if (!source.cardId?.startsWith('card.hash-')) {
    throw new ProgramBindingError('judge-required', `Static ability kind ${String(record(ability.effect).kind)} has no layer mapping without a production card identity`);
  }
  const id = `program-predicate:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  return bindStaticCapability(engine, 'predicate', id, ability, source, ordinal);
}

function registerModifier(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  const effect = record(ability.effect);
  const filter = normalizeStaticFilter(effect.filter);
  const id = `program-modifier:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  const condition = effectCondition(engine, ability, source, filter);
  const spec: ContinuousEffectSpec = {
    id,
    layer: 'ability',
    source: source.ref,
    filter: filter as ObjectFilter,
    effect: {
      ...effect,
      sourcePlayer: source.controller,
      filter: normalizeStaticFilter(effect.filter ?? filter),
      ...(effect.appliesTo === undefined ? {} : { appliesTo: literal(effect.appliesTo) }),
      ...(condition === undefined ? {} : { staticCondition: condition }),
    } as unknown as ContinuousEffectSpec['effect'],
  };
  bindFilterAnchor(spec.filter, () => liveSource(engine, source.ref));
  engine.layers.addContinuous(spec, staticEffectDuration(effect, source.ref));
  return { unbind: () => { engine.layers.removeContinuous(id); } };
}

function registerAbilityGrantRoute(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, id: string): StaticBindingHandle {
  const effect = record(ability.effect);
  const withCondition = ability.condition === undefined
    ? ability
    : { ...ability, effect: { ...effect, condition: ability.condition } } as unknown as StaticAbility;
  return registerAbilityGrant(engine, withCondition, source, id);
}

function registerTriggerRule(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  const effect = record(ability.effect);
  const filter = effect.appliesTo ?? 'self';
  const bound = bindStaticTriggerRule(engine.pipeline, { ...effect, appliesTo: filter } as never, source, ordinal);
  return { unbind: bound.unbind };
}

function registerPlayLocation(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  if (source.zone === 'hand' && !source.cardId?.startsWith('card.hash-')) {
    throw new ProgramBindingError('judge-required', 'Static play-location-permission has no layer mapping while its source is in Hand');
  }
  const effect = record(ability.effect);
  const rawValue = record(effect.value);
  const value = record(rawValue.kind === 'constant' ? rawValue.value : effect.value);
  const battlefield = record(value.battlefield);
  const supportedLocation = new Set([
    'occupied', 'open', 'controlled', 'contested', 'controller', 'owner', 'hasUnits', 'unitController', 'id',
  ]);
  if (Object.keys(battlefield).some(key => !supportedLocation.has(key))) {
    throw new ProgramBindingError('judge-required', `Unsupported play-location predicate ${JSON.stringify(battlefield)}`);
  }
  const target = value.appliesTo === 'friendly-units'
    ? { type: 'unit', controller: 'self', zone: 'board' }
    : { object: 'self' };
  const id = `program-static:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  const permission: AnyRecord = {
    ...value,
    kind: 'location',
    ...(typeof value.zone === 'string' ? { zone: value.zone } : {}),
    location: {
      type: value.zone === 'base' ? 'base' : 'battlefield',
      ...battlefield,
    },
    permission: 'any-battlefield',
  };
  const liveFilter = createLiveRuleFilter(engine, source, target, ability.condition);
  bindFilterAnchor(liveFilter, () => liveSource(engine, source.ref));
  Object.defineProperty(permission, 'objectRefs', {
    enumerable: true,
    get: () => {
      const current = liveSource(engine, source.ref);
      if (current === null) return [];
      if (value.appliesTo !== 'friendly-units') return [current.ref];
      return engine.pipeline.host.objects().filter(object => object.controller === current.controller && object.types.includes('unit')).map(object => object.ref);
    },
  });
  engine.layers.addContinuous({
    id,
    layer: 'ability',
    source: source.ref,
    filter: liveFilter,
    effect: {
      ...permission,
      ...(ability.condition === undefined ? {} : { staticCondition: effectCondition(engine, ability, source, target) }),
    } as never,
  }, staticEffectDuration(effect, source.ref));
  return { unbind: () => { engine.layers.removeContinuous(id); } };
}

function registerCapability(engine: ChainEngine, kind: 'cost' | 'target-tax' | 'hidden' | 'ignore-target-tax', prefix: string, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  const id = `${prefix}:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  return bindStaticCapability(engine, kind, id, ability, source, ordinal);
}

function registerCost(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  const capability = registerCapability(engine, 'cost', 'program-cost', ability, source, ordinal);
  const effect = record(ability.effect);
  if (!['continuous.cost-modification', 'cost.modify'].includes(String(effect.kind))) return capability;
  const filter = targetFilter(effect, source);
  const id = `program-cost-layer:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  const registeredFilter = Object.fromEntries(Object.entries(filter).filter(([key]) =>
    !['object', 'source', 'exclude', 'sameLocationAs', 'differentLocationFrom', 'attachedTo', 'relation'].includes(key))) as AnyRecord;
  bindFilterAnchor(registeredFilter, () => liveSource(engine, source.ref));
  engine.layers.addContinuous({
    id,
    layer: 'ability',
    source: source.ref,
    filter: registeredFilter as never,
    effect: {
      ...effect,
      sourcePlayer: source.controller,
      filter: normalizeStaticFilter(effect.filter),
      costModification: true,
    } as unknown as ContinuousEffectSpec['effect'],
  }, { type: 'permanent' });
  return { unbind: () => { engine.layers.removeContinuous(id); capability.unbind(); } };
}

function bindStatic(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  const kind = String(record(ability.effect).kind ?? '').toLowerCase();
  const id = `program-static:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  // These contract families have no production consumer yet. Keep their old
  // fail-closed behavior even though layerFor can classify the declaration.
  if (kind === 'continuous.grant-abilities' || kind === 'continuous.ignore-abilities' ||
      kind === 'continuous.facedown-capacity' || kind === 'continuous.play-permission' ||
      kind === 'continuous.target-restriction') {
    throw new ProgramBindingError('judge-required', `Static ability kind ${kind} has no layer mapping`);
  }
  if (kind === 'continuous.grant-ability' || kind === 'continuous.ignore-ability') {
    return registerAbilityGrantRoute(engine, ability, source, id);
  }
  if (kind === 'condition.predicate' || kind === 'condition.value') return registerPredicate(engine, ability, source, ordinal);
  if (kind === 'continuous.cost-modification' || kind === 'cost.modify' || kind === 'cost.additional' ||
      kind === 'accelerate.cost' || kind === 'repeat.cost') return registerCost(engine, ability, source, ordinal);
  if (kind === 'target.tax') return registerCapability(engine, 'target-tax', 'program-target-tax', ability, source, ordinal);
  if (kind === 'cost.hidden') return registerCapability(engine, 'hidden', 'program-hidden', ability, source, ordinal);
  if (kind === 'continuous.ignore-target-tax') return registerCapability(engine, 'ignore-target-tax', 'program-ignore-target-tax', ability, source, ordinal);
  if (kind === 'play-location-permission') return registerPlayLocation(engine, ability, source, ordinal);
  if (kind === 'continuous.trigger-multiplicity' || kind === 'continuous.trigger-suppression') {
    return registerTriggerRule(engine, ability, source, ordinal);
  }
  if (kind === 'continuous.bonus-damage' || kind === 'continuous.lethal-threshold' || kind === 'continuous.modify-might-reduction') {
    return registerModifier(engine, ability, source, ordinal);
  }
  if (kind === 'continuous.movement' || kind === 'continuous.restrict' || kind === 'continuous.require' ||
      kind === 'continuous.applied-cost' || kind === 'continuous.timing' || kind === 'continuous.combat') {
    return registerRule(engine, ability, source, ordinal);
  }
  return registerLayer(engine, ability, source, ordinal);
}

/** Build the production adapter used by attachProgramLifecycle. */
export function createEngineStaticBinder(engine: ChainEngine): ProgramStaticBinder {
  bridgeLifecycleOnEvent(engine);
  if (!(engine.layers instanceof KeywordGrantLayerEngine) && !KEYWORD_LIFECYCLE_BINDINGS.has(engine)) {
    installKeywordReexpansion(engine);
  }
  const keywordLifecycle = KEYWORD_LIFECYCLE_BINDINGS.get(engine);
  // The engine layer can insert entries between refreshes. Recompute ahead of
  // every material collection before the ordinary program binder runs.
  keywordLifecycle?.sync(undefined);
  const staticOrdinals = new Map<string, Set<number>>();
  return {
    authorizeTrigger: registration => keywordLifecycle!.authorizeTrigger(registration),
    /** Expose dynamic-host rebinding for lifecycle owners without editing their files. */
    sourceFor: source => bindingSource(engine, source),
    bindStatic: (ability, source) => {
      KEYWORD_LIFECYCLE_BINDINGS.get(engine)?.sync(source.ref);
      if (!engine.layers || typeof (engine.layers as { registry?: unknown }).registry !== 'object') {
        throw new ProgramBindingError('judge-required', `Static ability kind ${String(record(ability.effect).kind ?? '<missing>')} has no layer mapping`);
      }
      const current = source;
      throwStaticConditionDefect(engine, current, ability.condition);
      const key = `${current.ref.id}:${current.ref.zoneEntryId}`;
      const used = staticOrdinals.get(key) ?? new Set<number>();
      staticOrdinals.set(key, used);
      let ordinal = 0;
      while (used.has(ordinal)) ordinal++;
      used.add(ordinal);
      try {
        const handle = bindStatic(engine, ability, current, ordinal);
        KEYWORD_LIFECYCLE_BINDINGS.get(engine)?.sync(undefined);
        let active = true;
        return { unbind: () => {
          if (!active) return;
          active = false;
          try { handle.unbind(); }
          finally {
            used.delete(ordinal);
            if (used.size === 0) staticOrdinals.delete(key);
          }
        } };
      } catch (error) {
        used.delete(ordinal);
        if (used.size === 0) staticOrdinals.delete(key);
        throw error;
      }
    },
    bindReplacement: (ability, source) => {
      KEYWORD_LIFECYCLE_BINDINGS.get(engine)?.sync(source.ref);
      const host = engine.pipeline.host;
      const bound = bindReplacementRegistration(ability, source.ref, {
        host: {
          object: ref => host.objects().find(object => sameRef(object.ref, ref)) ?? null,
          objects: () => host.objects(),
          context: (snapshot, controller) => host.context(snapshot, controller, engine.layers.currentTimingPoint ?? 'cleanup-start'),
        },
        pipeline: engine.pipeline,
      });
      return { unbind: bound.cancel };
    },
  };
}


import type { Ability, EventPattern, Instruction } from '@riftbound/card-dsl';
import type { ObjectFilter } from '@riftbound/card-dsl';
import type { ChainEngine } from '../chain/engine.js';
import type { ContinuousEffectSpec, ObjectSnapshot } from '../effects/contract.js';
import { bindStaticTriggerRule } from '../events/trigger-rules/index.js';
import { bindReplacement as bindReplacementRegistration } from '../replacement/bind.js';
import { ProgramBindingError } from './errors.js';
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
  sourceSelfFilter,
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
  /** Optional lifecycle hand-off for entry events that carry an older incarnation. */
  sourceFor?(source: ObjectSnapshot): ObjectSnapshot;
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

const LAYER_BY_KIND: Readonly<Record<string, LayerName>> = Object.freeze({
  copy: 'copy',
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
  'set-property': 'trait',
  'set-trait': 'trait',
  trait: 'trait',
  'continuous.might': 'arithmetic',
  'set-might': 'arithmetic',
  might: 'arithmetic',
  buff: 'arithmetic',
  'continuous.bonus-damage': 'ability',
  'continuous.lethal-threshold': 'ability',
  'continuous.modify-might-reduction': 'ability',
  'continuous.combat': 'ability',
  'continuous.grant-ability': 'ability',
  'continuous.grant-keyword': 'ability',
  'continuous.ignore-ability': 'ability',
  'continuous.keyword': 'ability',
  'continuous.location': 'ability',
  'continuous.movement': 'ability',
  'continuous.restrict': 'ability',
  'continuous.require': 'ability',
  'continuous.applied-cost': 'ability',
  'continuous.timing': 'ability',
  'grant-keyword': 'ability',
  requirement: 'ability',
  restriction: 'ability',
  'applied-cost': 'ability',
});

export function layerFor(effect: AnyRecord): LayerName {
  const kind = String(effect.kind ?? '').toLowerCase();
  const mapped = LAYER_BY_KIND[kind];
  const declared = effect.layer;
  if (mapped === undefined) {
    throw new ProgramBindingError('judge-required', `Static ability kind ${String(effect.kind ?? '<missing>')} has no layer mapping`);
  }
  if (declared !== undefined && declared !== mapped) {
    throw new ProgramBindingError('judge-required', `Static ability kind ${kind} requires layer ${mapped}`);
  }
  return mapped;
}

function normalizedEffect(effect: AnyRecord): AnyRecord {
  const kind = String(effect.kind ?? '').toLowerCase();
  if (kind === 'continuous.might') {
    const mode = effect.mode ?? 'add';
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
  if (kind === 'continuous.movement') {
    const permission = effect.permission;
    if (typeof permission === 'string') {
      return {
        ...effect,
        permission: {
          routes: [permission],
          ...(effect.move === undefined ? {} : { move: effect.move }),
          ...(effect.source === undefined ? {} : { source: effect.source }),
          ...(effect.destination === undefined ? {} : { destination: effect.destination }),
        },
        canGank: permission === 'battlefield-to-battlefield' || effect.canGank === true,
      };
    }
  }
  return effect;
}

function numericLayerValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as AnyRecord;
  if (['constant', 'literal'].includes(String(item.kind))) return typeof item.value === 'number' && Number.isFinite(item.value);
  if (item.kind === 'count') return typeof item.subject === 'string' && item.subject.trim().length > 0;
  if (item.kind === 'object-property' || item.kind === 'object-attribute') return true;
  if (item.kind === 'arithmetic') return Array.isArray(item.operands) && item.operands.length > 0;
  return ['player-property', 'turn-number', 'player-turn-count', 'object-designation'].includes(String(item.kind));
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

function registerLayer(engine: ChainEngine, ability: StaticAbility, source: ObjectSnapshot, ordinal: number): StaticBindingHandle {
  const effect = record(ability.effect);
  const filter = targetFilter(effect, source);
  const layer = layerFor(effect);
  const normalized = normalizedEffect(effect);
  if (layer === 'arithmetic' && !numericLayerValue(normalized.amount ?? normalized.value ?? normalized.delta)) {
    throw new ProgramBindingError('judge-required', `Static ${String(effect.kind)} needs a supported numeric layer value`);
  }
  const id = `program-static:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  const { spec, duration } = layerSpec(engine, ability, source, id, layer, filter, {
    ...normalized,
    ...(effect.filter === undefined ? {} : { filter: normalizeStaticFilter(effect.filter) }),
    ...(effect.appliesTo === undefined ? {} : { appliesTo: effect.appliesTo }),
  });
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
  const liveFilter = createLiveRuleFilter(engine, source, filter, ability.condition);
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
  engine.layers.addContinuous(spec, staticEffectDuration(effect, source.ref));
  return { unbind: () => { engine.layers.removeContinuous(id); } };
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
    filter: createLiveRuleFilter(engine, source, target, ability.condition),
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
  engine.layers.addContinuous({
    id,
    layer: 'ability',
    source: source.ref,
    filter: Object.fromEntries(Object.entries(filter).filter(([key]) =>
      !['object', 'source', 'exclude', 'sameLocationAs', 'differentLocationFrom', 'attachedTo', 'relation'].includes(key))) as never,
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
  if (kind === 'continuous.grant-ability' || kind === 'continuous.ignore-ability') {
    return registerAbilityGrant(engine, ability, source, id);
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
  const staticOrdinals = new Map<string, number>();
  return {
    /** Expose dynamic-host rebinding for lifecycle owners without editing their files. */
    sourceFor: source => bindingSource(engine, source),
    bindStatic: (ability, source) => {
      if (!engine.layers || typeof (engine.layers as { registry?: unknown }).registry !== 'object') {
        throw new ProgramBindingError('judge-required', `Static ability kind ${String(record(ability.effect).kind ?? '<missing>')} has no layer mapping`);
      }
      const current = source;
      throwStaticConditionDefect(engine, current, ability.condition);
      const key = `${current.ref.id}:${current.ref.zoneEntryId}`;
      const ordinal = staticOrdinals.get(key) ?? 0;
      staticOrdinals.set(key, ordinal + 1);
      return bindStatic(engine, ability, current, ordinal);
    },
    bindReplacement: (ability, source) => {
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


import type { Ability, Condition, ObjectFilter, ObjectRef } from '@riftbound/card-dsl';
import type { ChainEngine } from '../../chain/engine.js';
import type { ContinuousEffectSpec, Duration, ObjectSnapshot } from '../../effects/contract.js';
import { evaluateCondition } from '../../effects/interpreter/condition.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { matchesObjectFilter } from '../../layers/filter.js';
import { resolveContinuousDuration } from '../../layers/ops/index.js';
import { ProgramBindingError } from '../errors.js';

export type AnyRecord = Record<string, unknown>;

const OBJECT_FILTER_FIELDS = new Set([
  'objectId', 'id', 'zoneEntryId', 'cardId', 'canonicalCardId', 'type', 'types', 'controller', 'owner',
  'player', 'zone', 'location', 'locationType', 'states', 'state', 'tags', 'tag', 'keywords', 'keyword',
  'hasKeyword', 'characteristics', 'relation', 'damaged', 'buffed', 'empowered', 'stunned', 'exhausted',
  'faceDown', 'isToken', 'mightLt', 'mightLessThan', 'mightLessThanTarget', 'mightLte', 'mightAtMost',
  'mightGte', 'mightAtLeast', 'mightGt', 'mightGreaterThan', 'mightEq', 'energyMax', 'printedEnergyMax',
  'energyAtMost', 'powerMax', 'printedPowerMax', 'powerAtMost', 'printedCostNoMoreThanKilledUnit',
  'killedUnit', 'killed', 'costReference', 'object', 'source', 'self', 'other', 'exclude', 'here',
  'sameLocationAs', 'differentLocationFrom', 'region', 'position', 'attachedTo', 'role',
]);

const ANCHOR_FIELDS = new Set([
  'object', 'source', 'self', 'other', 'exclude', 'here', 'sameLocationAs', 'differentLocationFrom',
  'attachedTo', 'region', 'position', 'relation',
]);

export function record(value: unknown): AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as AnyRecord : {};
}

export function sameRef(left: ObjectRef | null | undefined, right: ObjectRef | null | undefined): boolean {
  return left?.id === right?.id && left?.zoneEntryId === right?.zoneEntryId;
}

export function literal(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const item = value as AnyRecord;
  if (item.kind === 'constant' || item.kind === 'literal') return literal(item.value);
  return value;
}

export function liveSource(engine: ChainEngine, ref: ObjectRef): ObjectSnapshot | null {
  return engine.pipeline.host.objects().find(object => sameRef(object.ref, ref)) ?? null;
}

/** Resolve only the exact registered incarnation. */
export function bindingSource(engine: ChainEngine, source: ObjectSnapshot): ObjectSnapshot | null {
  // A static registration belongs to one exact incarnation. Lifecycle owners
  // must create a new registration from an authoritative entry action/event;
  // an id or printed identity match cannot prove that a new object inherited
  // an old registration. Same-zone moves and control changes retain the ref.
  return liveSource(engine, source.ref);
}

export function sourceSelector(value: unknown): boolean {
  if (value === true || value === 'self' || value === 'source') return true;
  const item = record(literal(value));
  return item.kind === 'constant' && sourceSelector(item.value);
}

export function sourceSelfFilter(source: ObjectSnapshot): ObjectFilter {
  void source;
  return {} as ObjectFilter;
}

function append(target: AnyRecord, key: string, value: unknown): void {
  const values = Array.isArray(value) ? value : [value];
  target[key] = [...new Set([...(Array.isArray(target[key]) ? target[key] as unknown[] : []), ...values])];
}

function normalizeLocation(value: unknown): unknown {
  const resolved = literal(value);
  if (resolved === 'here' || resolved === 'source-location' || resolved === 'self' || resolved === 'source') {
    return { sameLocationAs: resolved === 'source' ? 'source' : 'self' };
  }
  if (typeof resolved === 'string' && !['base', 'battlefield'].includes(resolved)) {
    return { type: 'battlefield', id: resolved };
  }
  return resolved;
}

/**
 * Normalize the authored static-filter spellings without resolving the host.
 * Relative anchors remain symbolic so every layer/rule query can bind them to
 * the live source at read time.
 */
export function normalizeStaticFilter(value: unknown): AnyRecord {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ProgramBindingError('invalid-program', 'Static filters must be objects');
  }
  const input = record(value);
  const output: AnyRecord = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (!OBJECT_FILTER_FIELDS.has(rawKey)) {
      throw new ProgramBindingError('judge-required', `Unsupported static filter field ${rawKey}`);
    }
    const value = literal(rawValue);
    const key = rawKey === 'player' ? 'controller' : rawKey === 'tag' ? 'tags' : rawKey;
    if (key === 'here') {
      if (value !== true) throw new ProgramBindingError('judge-required', `Unsupported static here filter ${String(value)}`);
      output.sameLocationAs = 'self';
    } else if (key === 'other') {
      if (value !== true) throw new ProgramBindingError('judge-required', `Unsupported static other filter ${String(value)}`);
      output.exclude = 'self';
    } else if (key === 'self') {
      if (!sourceSelector(value)) throw new ProgramBindingError('judge-required', 'Static self anchor is unsupported');
      output.object = 'self';
    } else if (key === 'object' || key === 'source' || key === 'exclude' || key === 'sameLocationAs' ||
      key === 'differentLocationFrom' || key === 'attachedTo') {
      if (key === 'object' && !sourceSelector(value) && typeof value !== 'object') {
        throw new ProgramBindingError('judge-required', `Unsupported static object anchor ${String(value)}`);
      }
      if ((key === 'exclude' || key === 'sameLocationAs' || key === 'differentLocationFrom' || key === 'attachedTo') &&
          !sourceSelector(value)) {
        throw new ProgramBindingError('judge-required', `Static ${key} requires a self/source anchor`);
      }
      output[key] = value;
    } else if (key === 'location' || key === 'position') {
      const location = normalizeLocation(value);
      if (record(location).sameLocationAs !== undefined) output.sameLocationAs = record(location).sameLocationAs;
      else output.location = location;
    } else if (key === 'region') {
      if (value === 'board') output.zone = 'board';
      else if (value === 'base' || value === 'battlefield') output.locationType = value;
      else if (typeof value === 'object' && value !== null) output.location = value;
      else throw new ProgramBindingError('judge-required', `Unsupported static region ${String(value)}`);
    } else if (key === 'stunned' || key === 'exhausted' || key === 'faceDown') {
      const state = key === 'faceDown' ? 'face-down' : key;
      if (value === true) append(output, 'states', state);
      else if (value !== false) throw new ProgramBindingError('judge-required', `Unsupported static ${key} value`);
    } else if (key === 'characteristics') {
      output.characteristics = { ...record(output.characteristics), ...record(value) };
    } else if (key === 'role') {
      if (value === 'self') output.object = 'self';
      else if (value === 'other-friendly') {
        output.controller = 'self';
        output.exclude = 'self';
      } else throw new ProgramBindingError('judge-required', `Unsupported static role ${String(value)}`);
    } else if (key === 'objectId' || key === 'id') {
      if (value === 'self' || value === 'source') output.object = value;
      else output.objectId = value;
    } else if (key === 'types') {
      output.type = value;
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function mergeStaticFilters(left: unknown, right: unknown): AnyRecord {
  const a = normalizeStaticFilter(left);
  const b = normalizeStaticFilter(right);
  const merged: AnyRecord = { ...a };
  for (const [key, value] of Object.entries(b)) {
    if (merged[key] === undefined) merged[key] = value;
    else if (JSON.stringify(merged[key]) !== JSON.stringify(value)) {
      if (key === 'tags' || key === 'states') append(merged, key, value);
      else throw new ProgramBindingError('invalid-program', `Conflicting static filter field ${key}`);
    }
  }
  return merged;
}

const PLAYER_ALIASES = new Set(['self', 'source', 'controller', 'you', 'caster', 'opponent', 'their', 'caster-opponent']);
const SUPPORTED_STATIC_SCOPES = new Set([
  'self', 'source', 'card', 'play-cost', 'spell-play-cost', 'play-spell-cost',
  'optional-additional-costs-you-pay', 'empower-activation-cost', 'activated-ability-cost',
  'empower-cost', 'repeat-additional-cost', 'deal-actions',
]);

/** Convert the evidence-backed appliesTo aliases into either an object filter or an action scope. */
export function normalizeAppliesTo(value: unknown): { readonly kind: 'object'; readonly filter: AnyRecord } | { readonly kind: 'scope'; readonly value: unknown } | null {
  const resolved = literal(value);
  if (resolved === undefined || resolved === null) return null;
  if (sourceSelector(resolved)) return { kind: 'object', filter: { object: resolved === true ? 'self' : resolved } };
  if (resolved === 'friendly-units') return { kind: 'object', filter: { type: 'unit', controller: 'self' } };
  if (resolved === 'opponents') return { kind: 'object', filter: { controller: 'opponent' } };
  if (resolved === 'friendly-legends') return { kind: 'object', filter: { type: 'legend', controller: 'self' } };
  if (resolved === 'units-here') return { kind: 'object', filter: { type: 'unit', sameLocationAs: 'self' } };
  if (resolved === 'opponent') return { kind: 'object', filter: { controller: 'opponent' } };
  if (resolved === 'controller-spells-and-abilities') {
    return { kind: 'object', filter: { type: ['spell', 'ability'], controller: 'self' } };
  }
  if (resolved === 'spells-and-abilities') return { kind: 'object', filter: { type: ['spell', 'ability'] } };
  if (resolved === 'all-players' || resolved === 'all') return { kind: 'object', filter: {} };
  if (typeof resolved === 'string') {
    if (!SUPPORTED_STATIC_SCOPES.has(resolved)) {
      throw new ProgramBindingError('judge-required', `Unsupported static appliesTo ${JSON.stringify(resolved)}`);
    }
    return { kind: 'scope', value: resolved };
  }
  if (Array.isArray(resolved)) {
    if (resolved.every(item => typeof item === 'string' && SUPPORTED_STATIC_SCOPES.has(item))) {
      return { kind: 'scope', value: [...resolved] };
    }
    throw new ProgramBindingError('judge-required', `Unsupported static appliesTo ${JSON.stringify(resolved)}`);
  }
  const item = record(resolved);
  const keys = Object.keys(item);
  if (keys.length === 0) return { kind: 'object', filter: {} };
  if (keys.some(key => OBJECT_FILTER_FIELDS.has(key))) return { kind: 'object', filter: normalizeStaticFilter(item) };
  // These are action/rule scopes consumed by cost, modifier, trigger, and tax adapters.
  const scopeKeys = new Set([
    'damageController', 'target', 'sourceKind', 'window', 'cost', 'keyword', 'trigger', 'controller',
    'zone', 'here', 'type', 'selection', 'sameLocationAs', 'location', 'spellOrAbility', 'for',
  ]);
  if (keys.every(key => scopeKeys.has(key))) return { kind: 'scope', value: item };
  throw new ProgramBindingError('judge-required', `Unsupported static appliesTo ${JSON.stringify(resolved)}`);
}

function locationKey(value: ObjectSnapshot['location']): string | null {
  if (value === null) return null;
  return value.type === 'base' ? JSON.stringify(['base', value.player]) : JSON.stringify(['battlefield', value.id]);
}

function selectorMatches(value: unknown, object: ObjectSnapshot, source: ObjectSnapshot): boolean {
  if (value === 'self' || value === 'source' || value === true) return sameRef(object.ref, source.ref);
  return false;
}

function baseLayerFilter(filter: AnyRecord): AnyRecord {
  return Object.fromEntries(Object.entries(filter).filter(([key]) => !ANCHOR_FIELDS.has(key)));
}

/** Strict source-relative matching used by layer conditions and rule-query adapters. */
export function staticObjectMatches(filter: AnyRecord, object: ObjectSnapshot, source: ObjectSnapshot): boolean {
  const normalized = normalizeStaticFilter(filter);
  const base = baseLayerFilter(normalized);
  const normalizedController = base.controller === 'controller' || base.controller === 'you' || base.controller === 'self' ? 'self' : base.controller;
  if (base.controller !== undefined) base.controller = normalizedController;
  if (!matchesObjectFilter(base, object as never, { controller: source.controller, anchor: source })) return false;
  for (const key of ['object', 'source'] as const) {
    if (normalized[key] !== undefined && !selectorMatches(normalized[key], object, source)) return false;
  }
  if (normalized.exclude !== undefined && selectorMatches(normalized.exclude, object, source)) return false;
  if (normalized.sameLocationAs !== undefined) {
    const key = locationKey(object.location);
    if (key === null || key !== locationKey(source.location)) return false;
  }
  if (normalized.differentLocationFrom !== undefined) {
    const key = locationKey(object.location);
    if (key === null || key === locationKey(source.location)) return false;
  }
  if (normalized.attachedTo !== undefined && !selectorMatches(normalized.attachedTo, object.attachedTo ? { ...object, ref: object.attachedTo } : object, source)) {
    return false;
  }
  if (normalized.relation !== undefined) {
    if (!matchesObjectFilter({ relation: normalized.relation }, object as never, { controller: source.controller, anchor: source })) return false;
  }
  return true;
}

export function abilityEnvironment(engine: ChainEngine, source: ObjectSnapshot) {
  const current = bindingSource(engine, source);
  if (current === null) throw new MissingInformation('Static source incarnation is no longer current');
  const base = engine.pipeline.host.context(current, current.controller, engine.layers.currentTimingPoint ?? 'cleanup-start');
  const context = new Proxy(base, { get(target, key) {
    if (key === 'object') return (ref: ObjectRef) => engine.layers.snapshot(ref) ?? target.object(ref);
    if (key === 'query') return (filter: ObjectFilter) => engine.layers.evaluateAll().filter(object => matchesObjectFilter(filter, object));
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return {
    context,
    host: current.ref,
    linked: (key: string) => context.linked(key),
    canLookBack: () => true,
    isIgnored: () => false,
  };
}

/** Missing information fails closed; programming defects and malformed conditions do not. */
export function staticConditionMatches(engine: ChainEngine, source: ObjectSnapshot, condition: unknown): boolean {
  const current = bindingSource(engine, source);
  if (current === null) return false;
  if (condition === undefined || condition === true) return true;
  if (condition === false) return false;
  if (typeof condition === 'function') return Boolean(condition(current));
  try {
    return evaluateCondition(condition as Condition, abilityEnvironment(engine, current));
  } catch (error) {
    if (error instanceof MissingInformation) return false;
    throw error;
  }
}

export function throwStaticConditionDefect(engine: ChainEngine, source: ObjectSnapshot, condition: unknown): void {
  if (condition === undefined || condition === true || condition === false || typeof condition === 'function') return;
  try { evaluateCondition(condition as Condition, abilityEnvironment(engine, source)); }
  catch (error) { if (!(error instanceof MissingInformation)) throw error; }
}

/**
 * Rule consumers receive absolute object identities for the current query.
 * The getter is evaluated after control/location/keyword changes, so a single
 * registration follows its live host without a second mutable target cache.
 */
export function createLiveRuleFilter(
  engine: ChainEngine,
  source: ObjectSnapshot,
  filter: AnyRecord,
  condition?: unknown,
): ObjectFilter {
  const normalized = normalizeStaticFilter(filter);
  const output = Object.fromEntries(Object.entries(baseLayerFilter(normalized)).filter(([key]) =>
    key !== 'object' && key !== 'source' && key !== 'exclude' && key !== 'sameLocationAs' &&
    key !== 'differentLocationFrom' && key !== 'attachedTo' && key !== 'relation')) as AnyRecord;
  delete output.objectId;
  delete output.id;
  delete output.zoneEntryId;
  Object.defineProperty(output, 'objectId', {
    enumerable: true,
    configurable: false,
    get: () => {
      const bound = bindingSource(engine, source);
      if (bound === null) return [];
      if (!staticConditionMatches(engine, bound, condition)) return [];
      const objectIds = engine.pipeline.host.objects()
        .filter(object => staticObjectMatches(normalized, object, bound))
        .map(object => object.ref.id);
      // Rule consumers accept the singular production spelling for one live
      // host, while the typed query matcher also accepts arrays for 0 or many.
      return objectIds.length === 1 ? objectIds[0] : objectIds;
    },
  });
  return output as ObjectFilter;
}

export function staticEffectDuration(effect: AnyRecord, source: ObjectRef): Duration {
  const value = literal(effect.duration);
  if (value === undefined || value === 'permanent' || value === 'while-in-hand' || value === 'while-on-board' ||
      value === 'while-source-in-play') return { type: 'permanent' };
  return resolveContinuousDuration(value as never, source);
}

export function effectCondition(engine: ChainEngine, ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot, filter?: AnyRecord) {
  const condition = ability.condition;
  const normalized = filter === undefined ? undefined : normalizeStaticFilter(filter);
  if (condition === undefined && normalized === undefined) return undefined;
  return (object: ObjectSnapshot): boolean => {
    const current = bindingSource(engine, source);
    if (current === null) return false;
    if (normalized !== undefined && !staticObjectMatches(normalized, object, current)) return false;
    return staticConditionMatches(engine, current, condition);
  };
}

export function layerSpec(
  engine: ChainEngine,
  ability: Extract<Ability, { kind: 'static' }>,
  source: ObjectSnapshot,
  id: string,
  layer: ContinuousEffectSpec['layer'],
  filter: AnyRecord,
  effect: AnyRecord,
): { readonly spec: ContinuousEffectSpec; readonly duration: Duration } {
  const condition = effectCondition(engine, ability, source, filter);
  return {
    spec: {
      id,
      layer,
      source: source.ref,
      filter: baseLayerFilter(filter) as ObjectFilter,
      effect: { ...effect, ...(condition === undefined ? {} : { condition }) } as ContinuousEffectSpec['effect'],
    },
    duration: staticEffectDuration(effect, source.ref),
  };
}


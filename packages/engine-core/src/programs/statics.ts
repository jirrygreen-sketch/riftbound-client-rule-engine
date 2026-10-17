import type { Ability, Condition, EventPattern, Instruction, ObjectFilter } from '@riftbound/card-dsl';
import type { ChainEngine } from '../chain/engine.js';
import type { ContinuousEffectSpec, ObjectRef, ObjectSnapshot } from '../effects/contract.js';
import { evaluateCondition } from '../effects/interpreter/condition.js';
import { matchesObjectFilter } from '../layers/filter.js';
import { isRelativeLocation } from '../layers/relative/location.js';
import { isSupportedRelativeFilterValue } from '../layers/relative/filter.js';
import { bindReplacement as bindReplacementRegistration } from '../replacement/bind.js';
import { ProgramBindingError } from './errors.js';

export interface StaticBindingHandle { readonly unbind: () => void; }
export interface ProgramStaticBinder {
  bindStatic?(ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot): StaticBindingHandle | void;
  bindReplacement?(ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot): StaticBindingHandle | void;
}
export const noopStaticBinder: ProgramStaticBinder = {};

export function bindStaticAbility(binder: ProgramStaticBinder, ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot): StaticBindingHandle {
  return binder.bindStatic?.(ability, source) ?? { unbind() {} };
}
export function bindReplacementAbility(binder: ProgramStaticBinder, ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot): StaticBindingHandle {
  return binder.bindReplacement?.(ability, source) ?? { unbind() {} };
}
export type ReplacementBinding = { id: string; source: ObjectSnapshot; replaces: EventPattern; body: readonly Instruction[] };

type AnyRecord = Record<string, unknown>;
type LayerName = ContinuousEffectSpec['layer'];

function record(value: unknown): AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as AnyRecord : {};
}

function sameRef(left: ObjectRef | null | undefined, right: ObjectRef | null | undefined): boolean {
  return left?.id === right?.id && left?.zoneEntryId === right?.zoneEntryId;
}

function literal(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const item = value as AnyRecord;
  if (item.kind === 'constant' || item.kind === 'literal') return literal(item.value);
  if (item.kind === 'arithmetic' && Array.isArray(item.operands)) {
    const operands = item.operands.map(literal);
    if (operands.every(operand => typeof operand === 'number' && Number.isFinite(operand))) {
      const [left = 0, right = 0] = operands as number[];
      switch (item.operator) {
        case 'add': return left + right;
        case 'sub': case 'subtract': return left - right;
        case 'mul': case 'multiply': return left * right;
        case 'div': case 'divide': return right === 0 ? value : left / right;
      }
    }
  }
  return value;
}

const LAYER_BY_KIND: Readonly<Record<string, LayerName>> = {
  // Contract 3.4 order: copy → trait → ability → arithmetic. Every known
  // ContinuousEffect family is assigned explicitly; unknown effects still
  // fail closed instead of being guessed from a substring.
  'copy': 'copy',
  'copy-object': 'copy',
  'copy-text': 'copy',
  'continuous.copy': 'copy',
  'continuous.base-might': 'trait',
  'continuous.set-type': 'trait',
  'continuous.set-types': 'trait',
  'continuous.add-type': 'trait',
  'continuous.add-tag': 'trait',
  'continuous.remove-tag': 'trait',
  'continuous.might': 'arithmetic',
  'continuous.bonus-damage': 'arithmetic',
  'continuous.modify-might-reduction': 'arithmetic',
  'continuous.lethal-threshold': 'arithmetic',
  'set-might': 'arithmetic',
  'might': 'arithmetic',
  'buff': 'arithmetic',
  'continuous.combat': 'ability',
  'continuous.cost-modification': 'ability',
  'continuous.deck': 'ability',
  'continuous.facedown-capacity': 'ability',
  'continuous.grant-abilities': 'ability',
  'continuous.grant-ability': 'ability',
  'continuous.grant-keyword': 'ability',
  'continuous.ignore-abilities': 'ability',
  'continuous.ignore-ability': 'ability',
  'continuous.ignore-target-tax': 'ability',
  'continuous.keyword': 'ability',
  'continuous.location': 'ability',
  'continuous.movement': 'ability',
  'continuous.play-permission': 'ability',
  'continuous.restrict': 'ability',
  'continuous.target-restriction': 'ability',
  'continuous.timing': 'ability',
  'continuous.trigger-multiplicity': 'ability',
  'continuous.trigger-suppression': 'ability',
  'continuous.test': 'ability',
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
  'cost.reveal': 'ability',
  'cost.activated': 'ability',
  'cost.printed': 'ability',
  'cost.exhaust': 'ability',
  'cost-modification': 'ability',
};

export function layerFor(effect: AnyRecord): LayerName {
  const declared = effect.layer;
  if (declared === 'copy' || declared === 'trait' || declared === 'ability' || declared === 'arithmetic') return declared;
  const kind = String(effect.kind ?? '').toLowerCase();
  const mapped = LAYER_BY_KIND[kind];
  if (mapped !== undefined) return mapped;
  throw new ProgramBindingError('judge-required', `Static ability kind ${String(effect.kind ?? '<missing>')} has no layer mapping`);
}

function normalizedEffect(effect: AnyRecord): AnyRecord {
  const kind = String(effect.kind ?? '').toLowerCase();
  if (kind === 'continuous.restrict') return { ...effect, kind: 'restriction' };
  if (kind === 'continuous.require') return { ...effect, kind: 'requirement' };
  if (kind === 'continuous.applied-cost') return { ...effect, kind: 'applied-cost' };
  return effect;
}

function sourceSelector(value: unknown): boolean {
  if (value === true || value === 'self' || value === 'source') return true;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as AnyRecord;
    return item.kind === 'constant' && sourceSelector(item.value);
  }
  return false;
}

function relativeSelector(value: unknown): boolean {
  if (sourceSelector(value)) return true;
  if (value === 'controller' || value === 'you' || value === 'caster' || value === 'opponent' || value === 'their' || value === 'caster-opponent' || value === 'here') return true;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as AnyRecord;
    if (item.kind === 'constant' || item.kind === 'literal') return relativeSelector(item.value);
    if (item.kind === 'relative' || item.kind === 'location') return item.value === undefined || relativeSelector(item.value);
    if (item.source !== undefined) return relativeSelector(item.source);
    if ('playerId' in item) return typeof item.playerId === 'string';
  }
  return false;
}

/**
 * Static card filters are authored relative to the ability source. The layer
 * engine consumes absolute ObjectFilter values, so resolve the source-relative
 * player and location anchors once while preserving the layer's per-query
 * matching of zone, state, and characteristics.
 */
export function staticFilter(effect: AnyRecord, source: ObjectSnapshot, rawFilter: AnyRecord = record(effect.filter)): ObjectFilter {
  const raw = rawFilter;
  const output: AnyRecord = {};
  for (const [key, rawValue] of Object.entries(raw)) {
    const value = literal(rawValue);
    if (key === 'controller' || key === 'owner') {
      if (!isSupportedRelativeFilterValue(value)) throw new ProgramBindingError('judge-required', `Unsupported static ${key} selector ${String(value)}`);
      output[key] = value;
    } else if (key === 'tag') output.tags = [...(Array.isArray(output.tags) ? output.tags : []), value];
    else if (key === 'types') output.type = value;
    else if (key === 'sameLocationAs') {
      if (!relativeSelector(value)) throw new ProgramBindingError('judge-required', 'Static sameLocationAs requires a supported relative anchor');
      output.sameLocationAs = value;
    } else if (key === 'object' || key === 'source') {
      if (sourceSelector(value)) {
        output.objectId = source.ref.id;
        output.zoneEntryId = source.ref.zoneEntryId;
      } else throw new ProgramBindingError('judge-required', `Unsupported static object anchor ${String(value)}`);
    } else if (key === 'exclude' || key === 'other') {
      if (key === 'other' && value !== true) throw new ProgramBindingError('judge-required', 'Static other filter must be true');
      if (key === 'exclude' && !relativeSelector(value)) throw new ProgramBindingError('judge-required', 'Static exclude requires a supported relative anchor');
      output[key] = value;
    } else if (key === 'self') {
      if (!sourceSelector(value)) throw new ProgramBindingError('judge-required', 'Static self anchor is unsupported');
      output.objectId = source.ref.id;
      output.zoneEntryId = source.ref.zoneEntryId;
    } else if (key === 'here') {
      if (value !== true) throw new ProgramBindingError('judge-required', 'Static here filter must be true');
      output.here = true;
    } else if (key === 'location' || key === 'position') {
      if (isRelativeLocation(value) && !relativeSelector(value)) throw new ProgramBindingError('judge-required', `Unsupported static ${key} anchor`);
      output[key] = value;
    } else if (key === 'region') {
      if (typeof value !== 'string' && !(typeof value === 'object' && value !== null)) throw new ProgramBindingError('judge-required', 'Static region must be a location or region name');
      output.region = value;
    } else if (['objectId', 'zoneEntryId', 'cardId', 'canonicalCardId', 'type', 'types', 'zone', 'states', 'state', 'tags', 'keywords', 'keyword', 'hasKeyword', 'characteristics'].includes(key)) {
      output[key] = value;
    } else {
      throw new ProgramBindingError('judge-required', `Unsupported static filter field ${key}`);
    }
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
  if (appliesTo === 'units-here') return { type: 'unit', controller: 'self', here: true } as ObjectFilter;
  if (appliesTo === 'all-players' || appliesTo === 'all') return {} as ObjectFilter;
  if (appliesTo !== undefined && appliesTo !== null) {
    throw new ProgramBindingError('judge-required', `Unsupported static appliesTo ${JSON.stringify(appliesTo)}`);
  }
  const filter = staticFilter(effect, source);
  if (Object.keys(filter).length > 0) return filter;
  return { objectId: source.ref.id, zone: 'board', zoneEntryId: source.ref.zoneEntryId } as ObjectFilter;
}

function abilityEnvironment(engine: ChainEngine, source: ObjectSnapshot) {
  const host = engine.pipeline.host;
  const current = host.objects().find(object => sameRef(object.ref, source.ref)) ?? source;
  const base = host.context(current, current.controller, engine.layers.currentTimingPoint ?? 'cleanup-start');
  const context = new Proxy(base, { get(target, key) {
    if (key === 'object') return (ref: ObjectRef) => engine.layers.snapshot(ref) ?? target.object(ref);
    if (key === 'query') return (filter: ObjectFilter) => engine.layers.evaluateAll().filter(object => matchesObjectFilter(filter, object, current));
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

function bindStaticToLayers(
  engine: ChainEngine,
  ability: Extract<Ability, { kind: 'static' }>,
  source: ObjectSnapshot,
  ordinal: number,
): StaticBindingHandle {
  const effect = record(ability.effect);
  const filter = staticTarget(effect, source);
  const layer = layerFor(effect);
  const id = `program-static:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
  const condition = ability.condition
    ? (_object: ObjectSnapshot) => {
      try {
        const environment = abilityEnvironment(engine, source);
        return evaluateCondition(ability.condition as Condition, environment);
      } catch {
        return false;
      }
    }
    : undefined;
  const resolvedEffect = normalizedEffect(effect);
  const spec: ContinuousEffectSpec = {
    id,
    layer,
    source: source.ref,
    filter,
    effect: {
      ...Object.fromEntries(Object.entries(resolvedEffect).map(([key, value]) => [key, literal(value)])),
      ...(condition === undefined ? {} : { condition }),
    } as ContinuousEffectSpec['effect'],
  };
  engine.layers.addContinuous(spec, { type: 'permanent' });
  return { unbind: () => { engine.layers.removeContinuous(id); } };
}

/** Build the production adapter used by attachProgramLifecycle. */
export function createEngineStaticBinder(engine: ChainEngine): ProgramStaticBinder {
  const staticOrdinals = new Map<string, number>();
  return {
    bindStatic: (ability, source) => {
      const key = `${source.ref.id}:${source.ref.zoneEntryId}`;
      const ordinal = staticOrdinals.get(key) ?? 0;
      staticOrdinals.set(key, ordinal + 1);
      return bindStaticToLayers(engine, ability, source, ordinal);
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

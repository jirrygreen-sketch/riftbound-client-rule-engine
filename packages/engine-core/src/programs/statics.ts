import type { Ability, Condition, EventPattern, Instruction, ObjectFilter } from '@riftbound/card-dsl';
import type { ChainEngine } from '../chain/engine.js';
import type { ContinuousEffectSpec, ObjectRef, ObjectSnapshot } from '../effects/contract.js';
import { evaluateCondition } from '../effects/interpreter/condition.js';
import { matchesObjectFilter } from '../layers/filter.js';
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

function layerFor(effect: AnyRecord): LayerName {
  const declared = effect.layer;
  if (declared === 'copy' || declared === 'trait' || declared === 'ability' || declared === 'arithmetic') return declared;
  const kind = String(effect.kind ?? '').toLowerCase();
  if (kind.includes('might') || kind.includes('buff')) return 'arithmetic';
  if (kind.includes('copy')) return 'copy';
  if (kind.includes('type') || kind.includes('tag') || kind.includes('trait')) return 'trait';
  if (kind.includes('timing') || kind.includes('keyword') || kind.includes('movement') || kind.includes('restrict') || kind.includes('combat')) return 'ability';
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

/**
 * Static card filters are authored relative to the ability source. The layer
 * engine consumes absolute ObjectFilter values, so resolve the source-relative
 * player and location anchors once while preserving the layer's per-query
 * matching of zone, state, and characteristics.
 */
function staticFilter(effect: AnyRecord, source: ObjectSnapshot): ObjectFilter {
  const raw = record(effect.filter);
  const output: AnyRecord = {};
  for (const [key, rawValue] of Object.entries(raw)) {
    const value = literal(rawValue);
    if (key === 'controller' || key === 'owner') {
      if (value === 'controller' || value === 'you' || value === 'self') output[key] = source.controller;
      else if (value === 'opponent' || value === 'their') {
        throw new ProgramBindingError('judge-required', `Static ${key}:opponent filter needs a relative-player query`);
      } else output[key] = value;
    } else if (key === 'tag') output.tags = [...(Array.isArray(output.tags) ? output.tags : []), value];
    else if (key === 'types') output.type = value;
    else if (key === 'sameLocationAs') {
      if (!sourceSelector(value)) throw new ProgramBindingError('judge-required', 'Static sameLocationAs requires a self/source anchor');
      if (source.location === null) throw new ProgramBindingError('judge-required', 'Static sameLocationAs source has no location');
      output.location = source.location;
    } else if (key === 'object' || key === 'source') {
      if (sourceSelector(value)) {
        output.objectId = source.ref.id;
        output.zoneEntryId = source.ref.zoneEntryId;
      } else throw new ProgramBindingError('judge-required', `Unsupported static object anchor ${String(value)}`);
    } else if (key === 'exclude' || key === 'other') {
      throw new ProgramBindingError('judge-required', `Static ${key} anchor needs a dynamic relative filter`);
    } else if (key === 'self') {
      if (!sourceSelector(value)) throw new ProgramBindingError('judge-required', 'Static self anchor is unsupported');
      output.objectId = source.ref.id;
      output.zoneEntryId = source.ref.zoneEntryId;
    } else if (key === 'location' && typeof value === 'object' && value !== null && 'source' in value) {
      if (!sourceSelector((value as AnyRecord).source)) throw new ProgramBindingError('judge-required', 'Static location source anchor is unsupported');
      if (source.location === null) throw new ProgramBindingError('judge-required', 'Static location source has no location');
      output.location = source.location;
    } else if (['objectId', 'cardId', 'canonicalCardId', 'type', 'zone', 'states', 'state', 'tags', 'characteristics'].includes(key)) {
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

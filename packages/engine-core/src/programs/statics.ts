import type { Ability, Condition, EventPattern, Instruction, ObjectFilter } from '@riftbound/card-dsl';
import type { ChainEngine } from '../chain/engine.js';
import type { ContinuousEffectSpec, ObjectRef, ObjectSnapshot } from '../effects/contract.js';
import { evaluateCondition } from '../effects/interpreter/condition.js';
import { matchesObjectFilter } from '../layers/filter.js';
import { concreteLocation, isRelativeLocation } from '../layers/relative/location.js';
import { bindFilterAnchor, hasRelativeAnchor, isSupportedRelativeFilterValue } from '../layers/relative/filter.js';
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
  // Contract 3.4 order: copy → trait → ability → arithmetic. Only kinds with
  // an actual layer or rule-query consumer are executable here.
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
  'set-property': 'trait',
  'set-trait': 'trait',
  'trait': 'trait',
  'continuous.might': 'arithmetic',
  'set-might': 'arithmetic',
  'might': 'arithmetic',
  'buff': 'arithmetic',
  'continuous.grant-keyword': 'ability',
  'grant-keyword': 'ability',
  'continuous.keyword': 'ability',
  'continuous.movement': 'ability',
  'continuous.restrict': 'ability',
  'continuous.timing': 'ability',
  // The merged rule-query layer reads this declaration directly. Other
  // ContinuousEffect kinds remain blocked until their production path is
  // connected end to end; standalone collectors are not enough evidence.
  'continuous.combat': 'ability',
  'restriction': 'ability',
};

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
  if (['continuous.set-type', 'continuous.set-types', 'continuous.add-type', 'continuous.add-tag', 'continuous.remove-tag'].includes(kind)) {
    return { ...effect, kind: kind.slice('continuous.'.length) };
  }
  if (kind === 'continuous.restrict') return { ...effect, kind: 'restriction' };
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
 * binder supplies a live source lookup; keep player and location selectors
 * symbolic so movement and control changes do not freeze the aura's targets.
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

/** The rule-query adapter has its own (absolute) filter reader. Resolve its
 * supported player fields on access, rather than freezing them at bind time.
 * Rich relative fields must wait for that reader to share matchesObjectFilter.
 */
function bindRuleFilter(filter: ObjectFilter, effect: AnyRecord, ability: Extract<Ability, { kind: 'static' }>, engine: ChainEngine, source: ObjectSnapshot): void {
  const kind = String(normalizedEffect(effect).kind);
  if (!['restriction', 'continuous.movement', 'continuous.timing'].includes(kind)) return;
  const { controller, owner, here, sameLocationAs, position, location, ...rest } = filter;
  if (hasRelativeAnchor(rest) || ['region', 'keywords', 'keyword', 'hasKeyword'].some(key => key in filter) ||
      ability.condition !== undefined || effect.condition !== undefined) {
    throw new ProgramBindingError('judge-required', `Static ${kind} needs a relative rule-filter consumer`);
  }
  const relative = here === true || sameLocationAs !== undefined || isRelativeLocation(position) || isRelativeLocation(location);
  if (position !== undefined && !isRelativeLocation(position) || relative && location !== undefined && !isRelativeLocation(location)) {
    throw new ProgramBindingError('judge-required', `Static ${kind} needs a compound location rule-filter consumer`);
  }
  if (relative) {
    // The rule reader compares this live location by value. Unlike a captured
    // bind-time location it follows move-location without reinstalling effects.
    Object.defineProperty(filter, 'location', { enumerable: true, get: () => engine.layers.snapshot(source.ref)?.location ?? null });
    // Positional rule queries have no source snapshot. Once lowered to the
    // live location, do not ask the richer rule reader to resolve it again.
    delete (filter as AnyRecord).sameLocationAs;
    delete (filter as AnyRecord).here;
    delete (filter as AnyRecord).position;
  }
  for (const [key, value] of Object.entries({ controller, owner })) {
    if (['opponent', 'their', 'caster-opponent'].includes(String(value))) {
      // Rule queries receive the acting/choosing player, which can be a third
      // party. Resolve "opponent" from the live host controller instead. Core
      // Rules defines a two-player opposing side; broader multiplayer relations
      // need an explicit player-selector contract and stay fail-closed.
      if (engine.pipeline.turnOrder.length !== 2) {
        throw new ProgramBindingError('judge-required', `Static ${kind} opponent selector needs a two-player turn order`);
      }
      Object.defineProperty(filter, key, { enumerable: true, get: () => {
        const controller = engine.layers.snapshot(source.ref)?.controller;
        return controller === undefined ? null : engine.pipeline.turnOrder.find(player => player !== controller) ?? null;
      } });
      continue;
    }
    if (['self', 'source', 'controller', 'you', 'caster'].includes(String(value))) {
      Object.defineProperty(filter, key, { enumerable: true, get: () => engine.layers.snapshot(source.ref)?.controller ?? null });
    }
  }
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
  bindRuleFilter(filter, effect, ability, engine, source);
  bindFilterAnchor(filter, () => engine.layers.snapshot(source.ref));
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
  if (resolvedEffect.kind === 'continuous.movement' && typeof resolvedEffect.permission === 'string') {
    throw new ProgramBindingError('judge-required', 'Static continuous.movement needs a structured movement-permission consumer');
  }
  if ((layer === 'arithmetic' || String(effect.kind).toLowerCase() === 'continuous.base-might') &&
      !numericLayerValue(resolvedEffect.amount ?? resolvedEffect.value ?? resolvedEffect.delta)) {
    throw new ProgramBindingError('judge-required', `Static ${String(effect.kind)} needs a supported numeric layer value`);
  }
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

import type { Ability, ObjectRef } from '@riftbound/card-dsl';
import type { ChainEngine } from '../../chain/engine.js';
import type { StaticCostAbility } from '../../cost/discounts/index.js';
import type { BoundTargetTax } from '../../target/tax/index.js';
import type { ObjectSnapshot } from '../../effects/contract.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { ProgramBindingError } from '../errors.js';
import { evaluateStaticPredicate } from './predicates.js';
import { record, sameRef, staticConditionMatches } from './model.js';

export type StaticCapabilityKind =
  | 'cost'
  | 'target-tax'
  | 'ignore-target-tax'
  | 'hidden'
  | 'play-location'
  | 'predicate'
  | 'modifier';

export interface StaticCapabilityRecord {
  readonly id: string;
  readonly kind: StaticCapabilityKind;
  readonly source: ObjectRef;
  readonly ability: Extract<Ability, { kind: 'static' }>;
  readonly ordinal: number;
}

export function bindStaticCapability(
  engine: ChainEngine,
  kind: StaticCapabilityKind,
  id: string,
  ability: Extract<Ability, { kind: 'static' }>,
  source: ObjectSnapshot,
  ordinal: number,
): { readonly unbind: () => void } {
  if (engine.layers.registry.get(id) !== undefined) {
    throw new ProgramBindingError('invalid-program', `Duplicate static capability ${id}`);
  }
  engine.layers.addContinuous({
    id,
    layer: 'ability',
    source: source.ref,
    filter: {},
    effect: {
      kind: 'static.capability',
      capabilityKind: kind,
      ability,
      ordinal,
    } as never,
  }, { type: 'permanent' });
  return { unbind: () => { engine.layers.removeContinuous(id); } };
}

export function staticCapabilities(engine: ChainEngine, kind?: StaticCapabilityKind): readonly StaticCapabilityRecord[] {
  const records: StaticCapabilityRecord[] = [];
  for (const entry of engine.layers.registry.list()) {
    const effect = record(entry.effect.effect);
    if (effect.kind !== 'static.capability' || typeof effect.capabilityKind !== 'string' ||
        !['cost', 'target-tax', 'ignore-target-tax', 'hidden', 'play-location', 'predicate', 'modifier'].includes(effect.capabilityKind) ||
        entry.effect.source === undefined || typeof effect.ordinal !== 'number' ||
        typeof effect.ability !== 'object' || effect.ability === null) continue;
    const binding: StaticCapabilityRecord = {
      id: entry.effect.id,
      kind: effect.capabilityKind as StaticCapabilityKind,
      source: entry.effect.source,
      ability: effect.ability as Extract<Ability, { kind: 'static' }>,
      ordinal: effect.ordinal,
    };
    if (kind === undefined || binding.kind === kind) records.push(binding);
  }
  return Object.freeze(records.sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)));
}

function sourceSnapshot(engine: ChainEngine, ref: ObjectRef): ObjectSnapshot | null {
  const objects = engine.pipeline.host.objects();
  return objects.find(object => sameRef(object.ref, ref)) ?? null;
}

function active(engine: ChainEngine, binding: StaticCapabilityRecord): boolean {
  const live = sourceSnapshot(engine, binding.source);
  const source = live ?? engine.pipeline.host.objects().find(object => object.ref.id === binding.source.id) ?? null;
  return source !== null && staticConditionMatches(engine, source, binding.ability.condition);
}

function currentSource(engine: ChainEngine, binding: StaticCapabilityRecord): ObjectSnapshot | null {
  const exact = sourceSnapshot(engine, binding.source);
  if (exact !== null) return exact;
  return engine.pipeline.host.objects().find(object => object.ref.id === binding.source.id && object.cardId !== null) ?? null;
}

function additionalFrom(binding: StaticCapabilityRecord): Extract<Ability, { kind: 'static' }> | null {
  const effect = record(binding.ability.effect);
  if (effect.kind === 'cost.additional') return binding.ability;
  if (effect.kind !== 'accelerate.cost' && effect.kind !== 'repeat.cost') return null;
  const kind = effect.kind === 'accelerate.cost' ? 'accelerate' : 'repeat';
  const payments = effect.kind === 'accelerate.cost'
    ? [
        { kind: 'energy', amount: { kind: 'constant', value: 1 } },
        { kind: 'power', amount: { kind: 'constant', value: 1 } },
      ]
    : record(effect.cost).payments ?? [];
  return {
    ...binding.ability,
    effect: {
      kind: 'cost.additional',
      id: record(binding.ability.effect).id ?? `program:${kind}:${binding.id}`,
      appliesTo: 'self',
      optional: true,
      stage: 'optional-additional',
      payments,
    },
  } as Extract<Ability, { kind: 'static' }>;
}

/** Cost declarations are handed to the existing Finalize cost collector. */
export function staticCostSources(engine: ChainEngine): readonly StaticCostAbility[] {
  return Object.freeze(staticCapabilities(engine, 'cost').flatMap(binding => {
    const source = currentSource(engine, binding);
    if (source === null || !staticConditionMatches(engine, source, binding.ability.condition)) return [];
    const original = record(binding.ability.effect);
    const ability = additionalFrom(binding) ?? ({
      ...binding.ability,
      effect: Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'sourcePlayer' && key !== 'costModification')),
    } as Extract<Ability, { kind: 'static' }>);
    return [{ id: binding.id, source: source.ref, ability }];
  }));
}

/** Target taxes remain host-bound and are re-evaluated against the current source. */
export function boundTargetTaxes(engine: ChainEngine): readonly BoundTargetTax[] {
  return Object.freeze(staticCapabilities(engine, 'target-tax').flatMap(binding => {
    if (!active(engine, binding)) return [];
    const effect = record(binding.ability.effect);
    if (effect.kind !== 'target.tax') return [];
    const source = currentSource(engine, binding);
    if (source === null || !staticConditionMatches(engine, source, binding.ability.condition)) return [];
    return [{ id: binding.id, target: source.ref, effect: effect as never }];
  }));
}

/** The host-filtered static source for one paid target. */
export function boundTargetTaxFor(engine: ChainEngine, target: ObjectRef): BoundTargetTax | null {
  const live = engine.pipeline.host.objects().find(object => sameRef(object.ref, target));
  if (live === undefined) return null;
  const binding = staticCapabilities(engine, 'target-tax').find(binding =>
    binding.source.id === target.id && staticConditionMatches(engine, live, binding.ability.condition));
  if (binding === undefined) return null;
  const effect = record(binding.ability.effect);
  if (effect.kind !== 'target.tax') return null;
  return { id: binding.id, target: live.ref, effect: effect as never };
}

export function ignoresTargetTax(engine: ChainEngine, player?: string): boolean {
  return staticCapabilities(engine, 'ignore-target-tax').some(binding => {
    if (!active(engine, binding)) return false;
    if (player === undefined) return true;
    const source = sourceSnapshot(engine, binding.source);
    return source !== null && source.controller === player;
  });
}

export function hiddenAbilitiesFor(engine: ChainEngine, sourceOrRef: ObjectSnapshot | ObjectRef): readonly Extract<Ability, { kind: 'static' }>[] {
  const ref = 'ref' in sourceOrRef ? sourceOrRef.ref : sourceOrRef;
  return Object.freeze(staticCapabilities(engine, 'hidden').flatMap(binding =>
    sameRef(binding.source, ref) && active(engine, binding) ? [binding.ability] : []));
}

export function hiddenPermissionFor(engine: ChainEngine, sourceOrRef: ObjectSnapshot | ObjectRef): 'present' | 'absent' | 'judge-required' {
  const ref = 'ref' in sourceOrRef ? sourceOrRef.ref : sourceOrRef;
  const bindings = staticCapabilities(engine, 'hidden').filter(binding => sameRef(binding.source, ref));
  if (bindings.length === 0) return 'absent';
  try {
    return bindings.some(binding => active(engine, binding)) ? 'present' : 'absent';
  } catch (error) {
    if (error instanceof MissingInformation) return 'judge-required';
    throw error;
  }
}

export function activeStaticModifiers(engine: ChainEngine): readonly StaticCapabilityRecord[] {
  return Object.freeze(engine.layers.registry.list().flatMap(entry => {
    const effect = record(entry.effect.effect);
    if (!['continuous.bonus-damage', 'continuous.lethal-threshold', 'continuous.modify-might-reduction'].includes(String(effect.kind)) ||
        entry.effect.source === undefined) return [];
    const source = engine.pipeline.host.objects().find(object => sameRef(object.ref, entry.effect.source!)) ??
      engine.pipeline.host.objects().find(object => object.ref.id === entry.effect.source!.id);
    if (source === undefined || effect.staticCondition !== undefined && !(effect.staticCondition as (object: ObjectSnapshot) => boolean)(source)) return [];
    return [{
      id: entry.effect.id,
      kind: 'modifier' as const,
      source: entry.effect.source,
      ability: { kind: 'static' as const, effect: effect as never },
      ordinal: entry.sequence,
    }];
  }));
}

export function staticPredicateActive(engine: ChainEngine, source: ObjectSnapshot | ObjectRef, predicateId?: string): boolean {
  const ref = 'ref' in source ? source.ref : source;
  const snapshot = sourceSnapshot(engine, ref);
  if (snapshot === null) return false;
  return staticCapabilities(engine, 'predicate').some(binding => {
    const effect = record(binding.ability.effect);
    if (!sameRef(binding.source, ref) || predicateId !== undefined && effect.id !== predicateId) return false;
    try { return evaluateStaticPredicate(engine, snapshot, binding.ability); }
    catch (error) {
      if (error instanceof MissingInformation) return false;
      throw error;
    }
  });
}

export function playLocationCapabilities(engine: ChainEngine): readonly StaticCapabilityRecord[] {
  return Object.freeze(engine.layers.registry.list().flatMap(entry => {
    const effect = record(entry.effect.effect);
    if (effect.kind !== 'location' || entry.effect.source === undefined) return [];
    const source = engine.pipeline.host.objects().find(object => sameRef(object.ref, entry.effect.source!)) ??
      engine.pipeline.host.objects().find(object => object.ref.id === entry.effect.source!.id);
    if (source === undefined || effect.staticCondition !== undefined && !(effect.staticCondition as (object: ObjectSnapshot) => boolean)(source)) return [];
    return [{
      id: entry.effect.id,
      kind: 'play-location' as const,
      source: entry.effect.source,
      ability: { kind: 'static' as const, effect: effect as never },
      ordinal: entry.sequence,
    }];
  }));
}


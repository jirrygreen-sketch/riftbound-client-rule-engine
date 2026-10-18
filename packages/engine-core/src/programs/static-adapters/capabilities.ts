import type { Ability, ObjectRef } from '@riftbound/card-dsl';
import type { ChainEngine } from '../../chain/engine.js';
import type { StaticCostAbility } from '../../cost/discounts/index.js';
import type { BoundTargetTax } from '../../target/tax/index.js';
import type { ObjectSnapshot } from '../../effects/contract.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { ProgramBindingError } from '../errors.js';
import { evaluateStaticPredicate } from './predicates.js';
import { liveSource, record, sameRef, staticConditionMatches } from './model.js';

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

interface StaticCapabilityState {
  readonly records: Map<string, StaticCapabilityRecord>;
}

const states = new WeakMap<ChainEngine, StaticCapabilityState>();

function state(engine: ChainEngine): StaticCapabilityState {
  let current = states.get(engine);
  if (current === undefined) {
    current = { records: new Map() };
    states.set(engine, current);
  }
  return current;
}

export function bindStaticCapability(
  engine: ChainEngine,
  kind: StaticCapabilityKind,
  id: string,
  ability: Extract<Ability, { kind: 'static' }>,
  source: ObjectSnapshot,
  ordinal: number,
): { readonly unbind: () => void } {
  const records = state(engine).records;
  if (records.has(id)) throw new ProgramBindingError('invalid-program', `Duplicate static capability ${id}`);
  records.set(id, { id, kind, source: source.ref, ability, ordinal });
  return { unbind: () => { records.delete(id); } };
}

export function staticCapabilities(engine: ChainEngine, kind?: StaticCapabilityKind): readonly StaticCapabilityRecord[] {
  return Object.freeze([...state(engine).records.values()]
    .filter(binding => kind === undefined || binding.kind === kind)
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)));
}

function sourceSnapshot(engine: ChainEngine, ref: ObjectRef): ObjectSnapshot | null {
  return liveSource(engine, ref);
}

function active(engine: ChainEngine, binding: StaticCapabilityRecord): boolean {
  const source = sourceSnapshot(engine, binding.source);
  return source !== null && staticConditionMatches(engine, source, binding.ability.condition);
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
    if (!active(engine, binding)) return [];
    const ability = additionalFrom(binding) ?? binding.ability;
    return [{ id: binding.id, source: binding.source, ability }];
  }));
}

/** Target taxes remain host-bound and are re-evaluated against the current source. */
export function boundTargetTaxes(engine: ChainEngine): readonly BoundTargetTax[] {
  return Object.freeze(staticCapabilities(engine, 'target-tax').flatMap(binding => {
    if (!active(engine, binding)) return [];
    const effect = record(binding.ability.effect);
    if (effect.kind !== 'target.tax') return [];
    return [{ id: binding.id, target: binding.source, effect: effect as never }];
  }));
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
  return Object.freeze(staticCapabilities(engine, 'modifier').filter(binding => active(engine, binding)));
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
  return staticCapabilities(engine, 'play-location').filter(binding => active(engine, binding));
}


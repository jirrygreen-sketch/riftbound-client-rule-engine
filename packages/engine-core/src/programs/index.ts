import type { Ability, CardProgram } from '@riftbound/card-dsl';
import type { ChainEngine, ChainDraft } from '../chain/engine.js';
import type { GameAction, ObjectSnapshot, PlayerId } from '../effects/contract.js';
import { ProgramRegistry, type ProgramSource } from './registry.js';
import { describePlay as describePlayDraft } from './play.js';
import { activationAbilities as listActivationAbilities, describeActivate as describeActivateDraft } from './activate.js';
import {
  activatedAddAbilities as listActivatedAddAbilities,
  describeAddActivation,
  type AddActivation,
  type ActivatedAddAbility,
} from './add.js';
import { ProgramBindingError } from './errors.js';
import { registerProgramTriggers as registerTriggers, unregisterProgramTriggers as unregisterTriggers } from './triggers.js';
import { attachProgramLifecycle, type ProgramLifecycleHandle } from './lifecycle.js';
import { bindReplacementAbility, bindStaticAbility, type ProgramStaticBinder, noopStaticBinder, type StaticBindingHandle } from './statics.js';
import { expandProgram } from './keywords.js';

export interface ProgramBinding {
  readonly registry: ProgramRegistry;
  readonly describePlay: (action: Extract<GameAction, { type: 'play' }>, source: ObjectSnapshot) => ChainDraft;
  readonly describeActivate: (source: ObjectSnapshot, controller: PlayerId, abilityIndex?: number) => ChainDraft;
  readonly activationAbilities: (source: ObjectSnapshot) => readonly Extract<Ability, { kind: 'activated' }>[];
  readonly activatedAddAbilities: (source: ObjectSnapshot) => readonly ActivatedAddAbility[];
  readonly describeAddActivation: (source: ObjectSnapshot, controller: PlayerId, abilityIndex?: number) => AddActivation;
  readonly registerProgramTriggers: (engine: ChainEngine, source: ObjectSnapshot) => readonly string[];
  readonly unregisterProgramTriggers: (engine: ChainEngine, ids: readonly string[]) => void;
  readonly bindStatic: (ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot) => StaticBindingHandle;
  readonly bindReplacement: (ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot) => StaticBindingHandle;
  readonly attachLifecycle: (engine: ChainEngine, onError?: (error: unknown, source: ObjectSnapshot) => void) => ProgramLifecycleHandle;
  readonly inspect: (source: ObjectSnapshot) => { readonly program?: CardProgram; readonly abilities: readonly Ability[] };
}

function isDirectAddAbility(record: ActivatedAddAbility): boolean {
  const body = record.ability.body;
  const instruction = body[0];
  return body.length === 1 && instruction?.op === 'effect.resources';
}

function hasVerifiedDefaultAddShape(record: ActivatedAddAbility): boolean {
  const body = record.ability.body;
  const instruction = body[0];
  const args = instruction?.args as Readonly<Record<string, { readonly kind?: string; readonly value?: unknown }>> | undefined;
  if (instruction === undefined || !isDirectAddAbility(record) || instruction.condition !== undefined ||
      instruction.targets !== undefined || instruction.picks !== undefined || instruction.locations !== undefined ||
      args === undefined || !(args.energy !== undefined || args.power !== undefined) || args.player !== undefined ||
      !Object.keys(args).every(key => ['energy', 'power', 'linkKey'].includes(key)) ||
      (args.energy === undefined && args.power === undefined)) return false;
  if (args.energy !== undefined &&
      (args.energy.kind !== 'constant' || typeof args.energy.value !== 'number' || !Number.isSafeInteger(args.energy.value) || args.energy.value < 0)) return false;
  if (args.power !== undefined &&
      (args.power.kind !== 'constant' || !Array.isArray(args.power.value) ||
       !args.power.value.every(domain => ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'].includes(String(domain))))) return false;
  if (args.linkKey !== undefined && (args.linkKey.kind !== 'constant' || typeof args.linkKey.value !== 'string' || args.linkKey.value.length === 0)) return false;
  return instruction !== undefined &&
    record.resourceInstructionIds.length === 1 && record.resourceInstructionIds[0] === instruction.id &&
    record.ability.restriction === undefined;
}

function directAddAbilities(registry: ProgramRegistry, source: ObjectSnapshot): readonly ActivatedAddAbility[] {
  return Object.freeze(listActivatedAddAbilities(registry, source).filter(isDirectAddAbility));
}

export function createProgramBinding(options: { cardPrograms: ProgramSource; staticBinder?: ProgramStaticBinder }): ProgramBinding {
  const registry = new ProgramRegistry(options.cardPrograms);
  const binder = options.staticBinder;
  return {
    registry,
    describePlay: (action, source) => describePlayDraft(registry, action, source),
    describeActivate: (source, controller, abilityIndex = 0) => {
      const add = listActivatedAddAbilities(registry, source).find(ability => ability.abilityIndex === abilityIndex);
      if (add === undefined) return describeActivateDraft(registry, source, controller, abilityIndex);
      if (!hasVerifiedDefaultAddShape(add)) {
        throw new ProgramBindingError(
          'judge-required',
          `Activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id} has an unverified Add shape`,
        );
      }
      return describeAddActivation(registry, source, controller, abilityIndex).draft;
    },
    activationAbilities: source => listActivationAbilities(registry, source),
    activatedAddAbilities: source => directAddAbilities(registry, source),
    describeAddActivation: (source, controller, abilityIndex = 0) => {
      const add = listActivatedAddAbilities(registry, source).find(ability => ability.abilityIndex === abilityIndex);
      if (add === undefined || !isDirectAddAbility(add) || !hasVerifiedDefaultAddShape(add)) {
        throw new ProgramBindingError(
          'judge-required',
          `Activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id} has an unverified Add shape`,
        );
      }
      return describeAddActivation(registry, source, controller, abilityIndex);
    },
    registerProgramTriggers: (engine, source) => registerTriggers(registry, engine, source),
    unregisterProgramTriggers: unregisterTriggers,
    bindStatic: (ability, source) => bindStaticAbility(binder ?? noopStaticBinder, ability, source),
    bindReplacement: (ability, source) => bindReplacementAbility(binder ?? noopStaticBinder, ability, source),
    attachLifecycle: (engine, onError) => attachProgramLifecycle(engine, registry, binder, onError),
    inspect: source => {
      const program = registry.inspect(source.cardId);
      if (!program) return { abilities: [] };
      return { program, abilities: expandProgram(program, source).abilities };
    }
  };
}

export * from './errors.js';
export * from './registry.js';
export * from './filters.js';
export * from './keywords.js';
export * from './play.js';
export * from './activate.js';
export * from './add.js';
export * from './triggers.js';
export * from './statics.js';
export * from './lifecycle.js';

/** Public contract aliases used by coordinator-owned program registration. */
export type { KeywordDef, KeywordExpansionInput, KeywordParameterMap, KeywordStacking } from '../effects/keyword-contract.js';

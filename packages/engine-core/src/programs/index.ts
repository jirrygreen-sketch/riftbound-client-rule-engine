import type { Ability, CardProgram } from '@riftbound/card-dsl';
import type { ChainEngine, ChainDraft } from '../chain/engine.js';
import type { GameAction, ObjectSnapshot, PlayerId } from '../effects/contract.js';
import { ProgramRegistry, type ProgramSource } from './registry.js';
import { describePlay as describePlayDraft } from './play.js';
import { activationAbilities as listActivationAbilities, describeActivate as describeActivateDraft } from './activate.js';
import { registerProgramTriggers as registerTriggers, unregisterProgramTriggers as unregisterTriggers } from './triggers.js';
import { attachProgramLifecycle, type ProgramLifecycleHandle } from './lifecycle.js';
import { bindReplacementAbility, bindStaticAbility, type ProgramStaticBinder, noopStaticBinder, type StaticBindingHandle } from './statics.js';
import { expandProgram } from './keywords.js';

export interface ProgramBinding {
  readonly registry: ProgramRegistry;
  readonly describePlay: (action: Extract<GameAction, { type: 'play' }>, source: ObjectSnapshot) => ChainDraft;
  readonly describeActivate: (source: ObjectSnapshot, controller: PlayerId, abilityIndex?: number) => ChainDraft;
  readonly activationAbilities: (source: ObjectSnapshot) => readonly Extract<Ability, { kind: 'activated' }>[];
  readonly registerProgramTriggers: (engine: ChainEngine, source: ObjectSnapshot) => readonly string[];
  readonly unregisterProgramTriggers: (engine: ChainEngine, ids: readonly string[]) => void;
  readonly bindStatic: (ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot) => StaticBindingHandle;
  readonly bindReplacement: (ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot) => StaticBindingHandle;
  readonly attachLifecycle: (engine: ChainEngine, onError?: (error: unknown, source: ObjectSnapshot) => void) => ProgramLifecycleHandle;
  readonly inspect: (source: ObjectSnapshot) => { readonly program?: CardProgram; readonly abilities: readonly Ability[] };
}

export function createProgramBinding(options: { cardPrograms: ProgramSource; staticBinder?: ProgramStaticBinder }): ProgramBinding {
  const registry = new ProgramRegistry(options.cardPrograms);
  const binder = options.staticBinder ?? noopStaticBinder;
  return {
    registry,
    describePlay: (action, source) => describePlayDraft(registry, action, source),
    describeActivate: (source, controller, abilityIndex = 0) => describeActivateDraft(registry, source, controller, abilityIndex),
    activationAbilities: source => listActivationAbilities(registry, source),
    registerProgramTriggers: (engine, source) => registerTriggers(registry, engine, source),
    unregisterProgramTriggers: unregisterTriggers,
    bindStatic: (ability, source) => bindStaticAbility(binder, ability, source),
    bindReplacement: (ability, source) => bindReplacementAbility(binder, ability, source),
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
export * from './triggers.js';
export * from './statics.js';
export * from './lifecycle.js';

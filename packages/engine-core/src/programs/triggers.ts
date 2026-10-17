import type { TriggeredAbility } from '@riftbound/card-dsl';
import type { ChainEngine } from '../chain/engine.js';
import type { ObjectSnapshot } from '../effects/contract.js';
import type { TriggerRegistration } from '../events/pipeline-types.js';
import type { TimingPointId } from '../events/timing-points.js';
import { ProgramBindingError } from './errors.js';
import { translateInstructionTargets, translateTriggerFilter } from './filters.js';
import { expandProgram } from './keywords.js';
import { ProgramRegistry } from './registry.js';

export function triggerRegistrations(registry: ProgramRegistry, source: ObjectSnapshot): readonly TriggerRegistration[] {
  const program = registry.get(source.cardId);
  const abilities = expandProgram(program, source).abilities;
  const permanent = source.types.every(type => !['spell'].includes(type.toLowerCase()));
  const defaultZones = permanent ? ['board'] : ['chain'];
  return abilities.flatMap((ability, index) => {
    if (ability.kind !== 'triggered') return [];
    try {
      const body = translateInstructionTargets(ability.body) as any;
      // Phase timing points are not closed EventPattern types; an empty IR
      // filter stays empty so pipeline validation remains the real boundary.
      const filter = translateTriggerFilter(ability.trigger.filter as Record<string, unknown>, source.ref.id, '');
      return [{
        id: `program:${source.ref.id}:${source.ref.zoneEntryId}:${index}`,
        source,
        controller: source.controller,
        spec: { at: ability.trigger.at as TimingPointId, filter: filter as any, ...(ability.trigger.condition ? { condition: ability.trigger.condition as any } : {}), ...(ability.trigger.once ? { once: ability.trigger.once } : {}) },
        body,
        optional: ability.optional,
        activeZones: (() => {
          const at = ability.trigger.at;
          if (at === 'object-enters-chain' || at === 'object-leaves-chain') return ['chain'];
          if (at === 'object-enters-board' || at === 'object-leaves-board' || at === 'object-killed') return ['board'];
          if (at === 'card-played') return permanent ? ['board'] : ['chain'];
          return defaultZones;
        })(),
        boundToIncarnation: true
      } satisfies TriggerRegistration];
    } catch (error) {
      if (error instanceof ProgramBindingError) throw error;
      throw new ProgramBindingError('judge-required', `Trigger ${index} on ${program.canonicalCardId} cannot be bound`, error);
    }
  });
}

export function registerProgramTriggers(registry: ProgramRegistry, engine: ChainEngine, source: ObjectSnapshot): readonly string[] {
  const registrations = triggerRegistrations(registry, source);
  for (const registration of registrations) {
    try { engine.pipeline.registerTrigger(registration); }
    catch (error) {
      if (error instanceof Error && error.message === `Duplicate trigger ${registration.id}`) continue;
      throw error;
    }
  }
  return registrations.map(registration => registration.id);
}

export function unregisterProgramTriggers(engine: ChainEngine, ids: readonly string[]): void {
  for (const id of ids) engine.pipeline.unregisterTrigger(id);
}

import type { TriggeredAbility } from '@riftbound/card-dsl';
import type { ChainEngine } from '../chain/engine.js';
import type { ObjectSnapshot } from '../effects/contract.js';
import type { TriggerRegistration } from '../events/pipeline-types.js';
import type { TimingPointId } from '../events/timing-points.js';
import { ProgramBindingError } from './errors.js';
import { translateInstructionTargets, translateTriggerFilter } from './filters.js';
import { expandProgram } from './keywords.js';
import { ProgramRegistry } from './registry.js';
import { adaptLeadingChoice, isCostPay } from './trigger-adapters/leading-choice.js';

export function triggerRegistrations(registry: ProgramRegistry, source: ObjectSnapshot): readonly TriggerRegistration[] {
  const program = registry.get(source.cardId);
  const abilities = expandProgram(program, source).abilities;
  const permanent = source.types.every(type => !['spell'].includes(type.toLowerCase()));
  const defaultZones = permanent ? ['board'] : ['chain'];
  return abilities.flatMap((ability, index) => {
    if (ability.kind !== 'triggered') return [];
    try {
      const body = translateInstructionTargets(ability.body) as any;
      const filter = translateTriggerFilter(ability.trigger.filter as Record<string, unknown>, source.ref.id, ability.trigger.at as TimingPointId);
      const adapted = adaptLeadingChoice(source, body, ability.trigger);
      const conditionHistory = historyCondition(ability.trigger.condition, source);
      const leadingChoice = body[0]?.op === 'choice.optional';
      if (leadingChoice && !adapted) {
        const nested = body[0]?.args?.body;
        const first = nested?.kind === 'constant' && Array.isArray(nested.value) ? nested.value[0] : undefined;
        throw new ProgramBindingError(
          'judge-required',
          isCostPay(first)
            ? `Trigger ${index} on ${program.canonicalCardId} has an unsupported leading cost shape`
            : `Trigger ${index} on ${program.canonicalCardId} has an unsupported leading may shape`
        );
      }
      return [{
        id: `program:${source.ref.id}:${source.ref.zoneEntryId}:${index}`,
        source,
        controller: source.controller,
        spec: { at: ability.trigger.at as TimingPointId, filter: filter as any,
          ...(conditionHistory === undefined ? {} : { conditionHistory }),
          ...(conditionHistory === undefined && ability.trigger.condition ? { condition: ability.trigger.condition as any } : {}), ...(ability.trigger.once ? { once: ability.trigger.once } : {}) },
        body: adapted?.body ?? body,
        optional: adapted ? false : ability.optional,
        ...(adapted ? {
          mayAtFinalize: true as const,
          ...(adapted.cost ? { cost: adapted.cost } : {}),
          ...(adapted.targets.length ? { targets: adapted.targets } : {})
        } : {}),
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

/**
 * The CardProgram IR represents Finalize/Legion counts as a `count` over
 * `cards-finalized-this-turn`. Trigger specifications carry the equivalent
 * closed HistoryQuery, so bind it to the production event-history reader
 * instead of letting the expression fall through to a live-object count.
 */
function historyCondition(condition: unknown, source: ObjectSnapshot): import('../effects/contract.js').HistoryQuery | undefined {
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) return undefined;
  const input = condition as Readonly<Record<string, unknown>>;
  if (input.kind !== 'compare' || input.operator !== 'gte') return undefined;
  const left = input.left;
  const right = input.right;
  if (left === null || typeof left !== 'object' || Array.isArray(left) ||
      right === null || typeof right !== 'object' || Array.isArray(right)) return undefined;
  const count = left as Readonly<Record<string, unknown>>;
  const threshold = right as Readonly<Record<string, unknown>>;
  if (count.kind !== 'count' || count.subject !== 'cards-finalized-this-turn' ||
      threshold.value !== 1 || !['constant', 'literal'].includes(String(threshold.kind))) return undefined;
  const filter = count.filter;
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) return undefined;
  const fields = filter as Readonly<Record<string, unknown>>;
  if (Object.keys(fields).some(key => !['player', 'exclude', 'objectFilter'].includes(key))) return undefined;
  const player = fields.player;
  const resolve = (value: unknown): string | undefined => typeof value === 'string'
    ? (['controller', 'self', 'you'].includes(value) ? source.controller : value)
    : value !== null && typeof value === 'object' && !Array.isArray(value) &&
        typeof (value as Readonly<Record<string, unknown>>).id === 'string'
      ? (value as Readonly<Record<string, unknown>>).id as string : undefined;
  const resolved = player === undefined ? source.controller : resolve(player);
  if (resolved === undefined) return undefined;
  const exclude = fields.exclude;
  const objectFilter = fields.objectFilter;
  return {
    scope: 'turn',
    timingPoint: 'chain-item-finalize',
    player: resolved,
    ...(exclude === undefined ? {} : { exclude: exclude as import('../effects/contract.js').ObjectSelector }),
    ...(objectFilter === undefined ? {} : { objectFilter: objectFilter as import('../effects/contract.js').ObjectFilter }),
  };
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

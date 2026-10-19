import type { ActivatedAbility, Condition, Instruction, Restriction } from '@riftbound/card-dsl';
import type { ChainDraft } from '../chain/engine.js';
import type { ObjectSnapshot, PlayerId } from '../effects/contract.js';
import { ProgramBindingError, judgeRequired } from './errors.js';
import { translateInstructionTargets } from './filters.js';
import { expandProgram } from './keywords.js';
import { ProgramRegistry } from './registry.js';
import { bindProgramCost } from './cost-adapters/index.js';
import { translateRestriction } from './play.js';

function activationList(registry: ProgramRegistry, source: ObjectSnapshot): ActivatedAbility[] {
  const program = registry.get(source.cardId);
  const expanded = expandProgram(program, source);
  return expanded.abilities.filter((ability): ability is ActivatedAbility => ability.kind === 'activated');
}

function translateActivationRestriction(
  restriction: Restriction | undefined,
  source: ObjectSnapshot,
  controller: PlayerId,
  id: string,
): readonly Condition[] | undefined {
  if (!restriction) return undefined;
  if (restriction.kind === 'use-only-while-source-at-battlefield' || restriction.kind === 'use-only-while-at-battlefield') {
    if (restriction.condition !== undefined || restriction.value !== undefined) {
      judgeRequired(`Activation restriction ${id} combines a location restriction with another rule`);
    }
    if (source.location?.type !== 'battlefield') return [{ kind: 'never' }];
    // CR 377.2.b requires the condition to hold when the ability is used.
    // Chain re-evaluates this condition against the current Board at Finalize,
    // before payment. Require the exact source incarnation to remain on the
    // Board under the activator, then negate a live query for that source at
    // the activator's Base. A Board object is at its Base or a Battlefield
    // (CR 107.1.c / 146.1), so the latter distinguishes Battlefield from Base.
    // The queries are live rather than always/never snapshots, and the
    // zone-entry identity prevents a later incarnation from satisfying this
    // activation's restriction.
    return [{
      kind: 'all',
      conditions: [
        {
          kind: 'compare',
          left: {
            kind: 'count',
            subject: 'objects',
            filter: {
              objectId: source.ref.id,
              zoneEntryId: source.ref.zoneEntryId,
              zone: 'board',
              controller,
            },
          },
          operator: 'gte',
          right: { kind: 'constant', value: 1 },
        },
        {
          kind: 'not',
          condition: {
            kind: 'compare',
            left: {
              kind: 'count',
              subject: 'objects',
              filter: {
                objectId: source.ref.id,
                zoneEntryId: source.ref.zoneEntryId,
                zone: 'board',
                location: { type: 'base', player: controller },
              },
            },
            operator: 'gte',
            right: { kind: 'constant', value: 1 },
          },
        },
      ],
    }];
  }
  return translateRestriction(restriction, id);
}

export function activationAbilities(registry: ProgramRegistry, source: ObjectSnapshot): readonly ActivatedAbility[] {
  return activationList(registry, source);
}

export function describeActivate(registry: ProgramRegistry, source: ObjectSnapshot, controller: PlayerId, abilityIndex = 0): ChainDraft {
  const abilities = activationList(registry, source);
  const ability = abilities[abilityIndex];
  if (!ability) throw new ProgramBindingError('unbound-ability', `No activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id}`);
  const body = translateInstructionTargets(ability.body) as readonly Instruction[];
  const id = `activate:${source.ref.id}:${source.ref.zoneEntryId}:${controller}:${++activationSequence}`;
  const program = registry.get(source.cardId);
  const cost = bindProgramCost({ program, source, mode: 'activate', id, ability });
  if (!cost) judgeRequired(`Activated ability ${id} has no cost plan`);
  const restrictions = translateActivationRestriction(ability.restriction, source, controller, source.cardId ?? source.ref.id);
  return { id, controller, source, kind: 'activated', speed: ability.timing, body, cost: { id: `cost:${id}`, ...cost.plan }, ...(restrictions ? { restrictions } : {}) };
}
let activationSequence = 0;

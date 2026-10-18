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
  id: string,
): readonly Condition[] | undefined {
  if (!restriction) return undefined;
  if (restriction.kind === 'use-only-while-source-at-battlefield' || restriction.kind === 'use-only-while-at-battlefield') {
    if (restriction.condition !== undefined || restriction.value !== undefined) {
      judgeRequired(`Activation restriction ${id} combines a location restriction with another rule`);
    }
    return [{
      kind: 'compare',
      left: {
        kind: 'count',
        subject: 'objects',
        filter: { objectId: source.ref.id, zone: 'board', location: 'battlefield' },
      },
      operator: 'gte',
      right: { kind: 'constant', value: 1 },
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
  const restrictions = translateActivationRestriction(ability.restriction, source, source.cardId ?? source.ref.id);
  return { id, controller, source, kind: 'activated', speed: ability.timing, body, cost: { id: `cost:${id}`, ...cost.plan }, ...(restrictions ? { restrictions } : {}) };
}
let activationSequence = 0;

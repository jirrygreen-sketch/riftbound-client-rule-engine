import type { ActivatedAbility, Instruction } from '@riftbound/card-dsl';
import type { ChainDraft } from '../chain/engine.js';
import type { ObjectSnapshot, PlayerId } from '../effects/contract.js';
import { ProgramBindingError, judgeRequired } from './errors.js';
import { translateInstructionTargets } from './filters.js';
import { expandProgram } from './keywords.js';
import { ProgramRegistry } from './registry.js';
import { translateCost } from './play.js';

function activationList(registry: ProgramRegistry, source: ObjectSnapshot): ActivatedAbility[] {
  const program = registry.get(source.cardId);
  const expanded = expandProgram(program, source);
  return expanded.abilities.filter((ability): ability is ActivatedAbility => ability.kind === 'activated');
}

export function activationAbilities(registry: ProgramRegistry, source: ObjectSnapshot): readonly ActivatedAbility[] {
  return activationList(registry, source);
}

export function describeActivate(registry: ProgramRegistry, source: ObjectSnapshot, controller: PlayerId, abilityIndex = 0): ChainDraft {
  const abilities = activationList(registry, source);
  const ability = abilities[abilityIndex];
  if (!ability) throw new ProgramBindingError('unbound-ability', `No activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id}`);
  if (ability.restriction) judgeRequired(`Activation restriction for ${source.cardId} needs a rules adapter`);
  const body = translateInstructionTargets(ability.body) as readonly Instruction[];
  const id = `activate:${source.ref.id}:${source.ref.zoneEntryId}:${controller}:${++activationSequence}`;
  const cost = translateCost(ability.cost, id, 'activate');
  if (!cost) judgeRequired(`Activated ability ${id} has no cost plan`);
  return { id, controller, source, kind: 'activated', speed: ability.timing, body, cost: { id: `cost:${id}`, cost, ...(source.power ? { domains: source.power } : {}) } };
}
let activationSequence = 0;

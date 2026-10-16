import type { CardProgram, Condition, CostSpec, Instruction, PlayAbility, Requirement, Restriction } from '@riftbound/card-dsl';
import type { ChainDraft } from '../chain/engine.js';
import type { CostPlanInput } from '../cost/plan-types.js';
import type { GameAction, ObjectSnapshot } from '../effects/contract.js';
import { ProgramBindingError, judgeRequired } from './errors.js';
import { translateInstructionTargets } from './filters.js';
import { abilitySpeed, expandProgram } from './keywords.js';
import { ProgramRegistry } from './registry.js';

export function translateCost(cost: CostSpec | undefined, id: string, mode: 'play' | 'activate'): CostPlanInput['cost'] | undefined {
  if (cost === undefined) return mode === 'activate' ? {} : undefined;
  const raw = { ...(cost as Record<string, unknown>) };
  const originalKind = typeof raw.kind === 'string' ? raw.kind : undefined;
  const kind = originalKind?.startsWith('cost.') ? originalKind.slice(5) : originalKind;
  for (const key of ['additional', 'additional-cost', 'discount', 'optional', 'keyword', 'rune']) {
    if (key in raw) judgeRequired(`Unsupported ${mode} cost field ${key} on ${id}`);
  }
  if (kind === 'additional' || kind === 'additional-cost') judgeRequired(`Additional costs are not bound for ${id}`);
  if (kind !== undefined && !['printed', 'activated', 'explicit'].includes(kind)) judgeRequired(`Unsupported cost kind ${String(originalKind)} on ${id}`);
  if (kind === 'printed' && Object.keys(raw).some(key => key !== 'kind')) {
    delete raw.kind;
    return { kind: 'explicit', ...raw } as CostPlanInput['cost'];
  }
  if (kind === undefined) return raw as CostPlanInput['cost'];
  return { ...raw, kind } as CostPlanInput['cost'];
}

const CONDITION_KINDS = new Set(['always', 'never', 'compare', 'all', 'any', 'not', 'expression']);

export function translateLegalityCondition(rule: Requirement | Restriction, id: string, label: 'requirement' | 'restriction'): Condition {
  if (rule.condition !== undefined) {
    if (rule.value !== undefined) judgeRequired(`${label} ${id} combines condition and value without an adapter`);
    return rule.condition;
  }
  if (CONDITION_KINDS.has(rule.kind) && rule.value === undefined) return rule as unknown as Condition;
  judgeRequired(`${label} ${id} kind ${rule.kind} needs a rules adapter`);
}

export function translateRequirements(requirements: readonly Requirement[] | undefined, id: string): readonly Condition[] | undefined {
  if (!requirements?.length) return undefined;
  return requirements.map(requirement => translateLegalityCondition(requirement, id, 'requirement'));
}

export function translateRestriction(restriction: Restriction | undefined, id: string): readonly Condition[] | undefined {
  if (!restriction) return undefined;
  return [translateLegalityCondition(restriction, id, 'restriction')];
}

function cardKind(source: ObjectSnapshot): ChainDraft['kind'] {
  const types = source.types.map(type => type.toLowerCase());
  const kind = (['spell', 'unit', 'gear'] as const).find(type => types.includes(type));
  if (!kind) throw new ProgramBindingError('invalid-program', `Card ${source.ref.id} has no playable spell/unit/gear type`);
  return kind;
}

function validateSurface(body: readonly Instruction[]): void {
  const visit = (instructions: readonly Instruction[], nested = false) => {
    for (const instruction of instructions) {
      if (nested && instruction.targets?.length) judgeRequired('Nested instruction targets require a target lifecycle adapter');
      if (instruction.op === 'choice.mode') judgeRequired('Mode choices require a Finalize/Resolve choice-plan adapter');
      for (const expression of Object.values(instruction.args ?? {})) {
        if (expression && typeof expression === 'object' && ['constant', 'literal'].includes((expression as any).kind)) {
          const value = (expression as any).value;
          if (Array.isArray(value)) visit(value as Instruction[], true);
          if (value && typeof value === 'object' && Array.isArray(value.body)) visit(value.body as Instruction[], true);
        }
      }
    }
  };
  visit(body);
}

export function describePlay(registry: ProgramRegistry, action: Extract<GameAction, { type: 'play' }>, source: ObjectSnapshot): ChainDraft {
  const program = registry.get(source.cardId);
  const kind = cardKind(source);
  const expanded = expandProgram(program, source);
  const ability = expanded.abilities.find((candidate): candidate is PlayAbility => candidate.kind === 'play');
  const body = translateInstructionTargets(ability?.body ?? []) as readonly Instruction[];
  validateSurface(body);
  const id = `play:${source.ref.id}:${source.ref.zoneEntryId}:${action.player}:${++playSequence}`;
  const requirements = translateRequirements(ability?.requirements, program.canonicalCardId);
  const restrictions = translateRestriction(ability?.restriction, program.canonicalCardId);
  return {
    id,
    controller: action.player,
    source,
    kind,
    speed: abilitySpeed(expanded.abilities, source),
    body,
    ...(ability?.cost ? { cost: { id: `cost:${id}`, cost: translateCost(ability.cost, id, 'play')!, ...(source.power ? { domains: source.power } : {}) } } : {}),
    ...(requirements ? { requirements } : {}),
    ...(restrictions ? { restrictions } : {}),
    ...(action.location ? { location: action.location } : {})
  };
}
let playSequence = 0;

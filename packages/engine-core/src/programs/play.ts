import type { CardProgram, Condition, CostSpec, Instruction, PlayAbility, Requirement, Restriction } from '@riftbound/card-dsl';
import type { ChainDraft } from '../chain/engine.js';
import type { GameAction, ObjectSnapshot } from '../effects/contract.js';
import { ProgramBindingError, judgeRequired } from './errors.js';
import { bindProgramCost } from './cost-adapters/index.js';
import { translateInstructionTargets } from './filters.js';
import { abilitySpeed, expandProgram } from './keywords.js';
import { ProgramRegistry } from './registry.js';

export { translateCost } from './cost-adapters/index.js';

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

function repeatAdditionalCost(cost: CostSpec | undefined): CostSpec | undefined {
  if (cost === undefined) return undefined;
  const raw = cost as CostSpec & { readonly costs?: readonly Readonly<Record<string, unknown>>[] };
  const kind = raw.kind?.replace(/^cost\./, '');
  if (!['additional', 'additional-cost'].includes(kind ?? '') && raw.costs === undefined && raw.keyword !== 'repeat') return undefined;
  const cleanPayment = (payment: unknown): unknown => {
    if (payment === null || typeof payment !== 'object' || Array.isArray(payment)) return payment;
    const { choice: _choice, ...rest } = payment as Readonly<Record<string, unknown>>;
    return rest;
  };
  // The binder uses the authored discriminator to select the additional-cost
  // branch, then normalizes the resulting plan component to kind=repeat.
  const clean: Record<string, unknown> = { ...structuredClone(raw), kind: raw.kind ?? 'additional', keyword: 'repeat', optional: true };
  delete clean.stage;
  if (Array.isArray(clean.payments)) clean.payments = clean.payments.map(cleanPayment);
  if (Array.isArray(clean.costs)) {
    clean.costs = clean.costs.map(entry => {
      const nested = { ...structuredClone(entry), keyword: 'repeat', optional: true };
      delete nested.stage;
      if (Array.isArray(nested.payments)) nested.payments = nested.payments.map(cleanPayment);
      return nested;
    });
  }
  return clean as unknown as CostSpec;
}

function hasRepeatDeclaration(program: CardProgram, source: ObjectSnapshot): boolean {
  return /\[repeat\]/i.test(program.sourceText) || source.keywords.some(keyword => keyword.id.toLowerCase().replace(/[\s_-]+/g, '') === 'repeat');
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
  const repeatCost = hasRepeatDeclaration(program, source) ? repeatAdditionalCost(ability?.cost) : undefined;
  const costAbility = repeatCost === undefined ? ability : { ...ability!, cost: repeatCost };
  // The normalized component carries keyword: 'repeat', so the cost binder
  // takes its optionality from CR 820.1.b rather than from reminder prose.
  const cost = bindProgramCost({ program, source, mode: 'play', id, ability: costAbility, abilities: expanded.abilities });
  return {
    id,
    controller: action.player,
    source,
    kind,
    speed: abilitySpeed(expanded.abilities, source),
    body,
    ...(cost ? { cost: { id: `cost:${id}`, ...cost.plan } } : {}),
    ...(requirements ? { requirements } : {}),
    ...(restrictions ? { restrictions } : {}),
    ...(action.location ? { location: action.location } : {})
  };
}
let playSequence = 0;

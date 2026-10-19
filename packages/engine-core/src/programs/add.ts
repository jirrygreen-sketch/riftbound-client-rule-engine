import type { ActivatedAbility, Instruction, Restriction, TriggeredAbility } from '@riftbound/card-dsl';
import type { ChainDraft } from '../chain/engine.js';
import type { ObjectSnapshot, PlayerId } from '../effects/contract.js';
import { describeActivate, activationAbilities } from './activate.js';
import { ProgramBindingError } from './errors.js';
import { expandProgram } from './keywords.js';
import type { ProgramRegistry } from './registry.js';

/** One activated ability whose resolution can add resources (CR 430.1-430.2). */
export interface ActivatedAddAbility {
  /** Index among activated abilities after the default keyword expansion. */
  readonly abilityIndex: number;
  readonly ability: ActivatedAbility;
  /** Exact original instructions that submit the Add primitive. */
  readonly resourceInstructionIds: readonly string[];
  /** The printed source-use restriction remains available to the chain caller. */
  readonly sourcePurpose?: Restriction;
}

/** A recognized Add ability together with its default production Chain draft. */
export interface AddActivation extends ActivatedAddAbility {
  readonly draft: ChainDraft;
}

/** One triggered ability whose resolution can add resources (CR 430.2). */
export interface TriggeredAddAbility {
  /** Index among triggered abilities after the default keyword expansion. */
  readonly abilityIndex: number;
  readonly ability: TriggeredAbility;
  readonly resourceInstructionIds: readonly string[];
}

/**
 * Convert a successfully bound trigger registration into the immediate Add
 * Chain classification. Trigger timing and matching remain owned by the event
 * pipeline; this helper changes only the resolution class required by 430.2.
 */
export interface TriggeredAddDraftInput {
  readonly id: string;
  readonly controller: PlayerId;
  readonly source: ObjectSnapshot;
  readonly body: readonly Instruction[];
  readonly trigger: ChainDraft['trigger'];
  readonly cost?: ChainDraft['cost'];
  readonly targets?: ChainDraft['targets'];
  readonly mayAtFinalize?: boolean;
}

function childBodies(instruction: Instruction): readonly (readonly Instruction[])[] {
  const bodies: (readonly Instruction[])[] = [];
  const body = instruction.args.body;
  if (body !== undefined && (body.kind === 'constant' || body.kind === 'literal') && Array.isArray(body.value)) {
    bodies.push(body.value as unknown as readonly Instruction[]);
  }
  const modes = instruction.args.modes;
  if (modes !== undefined && (modes.kind === 'constant' || modes.kind === 'literal') && Array.isArray(modes.value)) {
    for (const mode of modes.value) {
      if (mode === null || typeof mode !== 'object' || Array.isArray(mode)) continue;
      const body = (mode as { readonly body?: unknown }).body;
      if (Array.isArray(body)) bodies.push(body as readonly Instruction[]);
    }
  }
  return bodies;
}

/** Collect Add instructions from the ability's authored body without rewriting it. */
export function addResourceInstructionIds(body: readonly Instruction[]): readonly string[] {
  const ids: string[] = [];
  const visit = (instructions: readonly Instruction[]): void => {
    for (const instruction of instructions) {
      if (instruction.op === 'effect.resources') ids.push(instruction.id);
      for (const nested of childBodies(instruction)) visit(nested);
    }
  };
  visit(body);
  return Object.freeze(ids);
}

/** An activated ability is an Add ability only when its body submits Add. */
export function isActivatedAddAbility(ability: ActivatedAbility): boolean {
  return addResourceInstructionIds(ability.body).length > 0;
}

/**
 * List Add abilities through the same keyword expansion and program lookup as
 * ordinary activations. This is intentionally read-only and does not classify
 * a body by card name or source text.
 */
export function activatedAddAbilities(registry: ProgramRegistry, source: ObjectSnapshot): readonly ActivatedAddAbility[] {
  const records: ActivatedAddAbility[] = [];
  for (const [abilityIndex, ability] of activationAbilities(registry, source).entries()) {
    const resourceInstructionIds = addResourceInstructionIds(ability.body);
    if (resourceInstructionIds.length === 0) continue;
    records.push(Object.freeze({
      abilityIndex,
      ability,
      resourceInstructionIds,
      ...(ability.restriction === undefined ? {} : { sourcePurpose: structuredClone(ability.restriction) }),
    }));
  }
  return Object.freeze(records);
}

/**
 * List triggered Add abilities through default keyword expansion. Trigger
 * registration and chain admission remain the trigger owner's responsibility;
 * this function supplies the Add classification those callers must preserve.
 */
export function triggeredAddAbilities(registry: ProgramRegistry, source: ObjectSnapshot): readonly TriggeredAddAbility[] {
  const program = registry.get(source.cardId);
  const records: TriggeredAddAbility[] = [];
  const expanded = expandProgram(program, source).abilities;
  let abilityIndex = -1;
  for (const ability of expanded) {
    if (ability.kind !== 'triggered') continue;
    abilityIndex++;
    const resourceInstructionIds = addResourceInstructionIds(ability.body);
    if (resourceInstructionIds.length === 0) continue;
    records.push(Object.freeze({
      abilityIndex,
      ability,
      resourceInstructionIds,
    }));
  }
  return Object.freeze(records);
}

/** Describe a production trigger registration as an immediate Add draft. */
export function describeTriggeredAdd(input: TriggeredAddDraftInput): ChainDraft {
  if (input.trigger === undefined) throw new ProgramBindingError('judge-required', 'Triggered Add requires a bound trigger event');
  if (addResourceInstructionIds(input.body).length === 0) {
    throw new ProgramBindingError('judge-required', `Triggered ability ${input.id} does not submit an Add primitive`);
  }
  return Object.freeze({
    id: input.id,
    controller: input.controller,
    source: input.source,
    kind: 'add' as const,
    body: input.body,
    trigger: input.trigger,
    ...(input.cost === undefined ? {} : { cost: input.cost }),
    ...(input.targets === undefined ? {} : { targets: input.targets }),
    ...(input.mayAtFinalize === undefined ? {} : { mayAtFinalize: input.mayAtFinalize }),
  });
}

/**
 * Describe one activated Add through the default production activation binder,
 * then change only the Chain classification required by CR 430.2. Costs,
 * targets, source purpose, and the authored body are retained verbatim.
 */
export function describeAddActivation(
  registry: ProgramRegistry,
  source: ObjectSnapshot,
  controller: PlayerId,
  abilityIndex = 0,
): AddActivation {
  const record = activatedAddAbilities(registry, source).find(entry => entry.abilityIndex === abilityIndex);
  if (record === undefined) {
    const ability = activationAbilities(registry, source)[abilityIndex];
    if (ability === undefined) {
      throw new ProgramBindingError('unbound-ability', `No activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id}`);
    }
    throw new ProgramBindingError(
      'judge-required',
      `Activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id} does not submit an Add primitive`,
    );
  }
  const draft = describeActivate(registry, source, controller, abilityIndex);
  return Object.freeze({ ...record, draft: Object.freeze({ ...draft, kind: 'add' as const }) });
}

import type { CostSpec, Instruction, PickSpec } from '@riftbound/card-dsl';
import type { ResolveContext } from '../../effects/contract.js';
import {
  costChoiceLocks,
  finalizeCostChoiceLock,
} from '../../cost/plan-values.js';
import type {
  CostChoiceLock,
  CostChoiceLocks,
  CostComponentInput,
  CostPlanInput,
  OptionalCostInput,
} from '../../cost/plan-types.js';
import { bindFinalizedTargetPlans } from '../../target/target-plan.js';
import type { TargetPlan, TargetsFinalizedEvent } from '../../target/target-plan.js';
import {
  finalizeChoicePlan,
  type ChoicePlan,
  type ChoicePlanOptions,
} from './choices.js';

export * from './add-window.js';
export * from './choice-memory.js';
export * from './choices.js';
export * from './target-tax.js';

interface CostChoiceDeclaration {
  readonly choice: PickSpec;
  readonly kind: string;
}

function normalizedKind(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.startsWith('cost.') ? value.slice(5) : value;
}

function selectedBaseCost(input: CostPlanInput): CostSpec | undefined {
  if (input.baseChoices === undefined) return input.cost;
  return input.baseChoices.find(component => component.id === input.baseChoice)?.cost;
}

function collectFromCost(cost: CostSpec | undefined, into: CostChoiceDeclaration[]): void {
  if (cost === undefined) return;
  if (cost.discard !== undefined) into.push({ choice: cost.discard, kind: 'discard' });
  for (const payment of cost.payments ?? []) {
    if (payment.choice === undefined) continue;
    const kind = normalizedKind(payment.kind);
    if (kind === null) continue;
    into.push({ choice: payment.choice, kind });
  }
}

function costChoiceDeclarations(input: CostPlanInput): readonly CostChoiceDeclaration[] {
  const declarations: CostChoiceDeclaration[] = [];
  collectFromCost(selectedBaseCost(input), declarations);
  for (const modification of input.baseModifications ?? []) {
    if (modification.kind === 'alternate' || modification.kind === 'flow') collectFromCost(modification.cost, declarations);
  }
  for (const optional of input.optionalAdditional ?? []) {
    if (optional.selected === true) collectFromCost(optional.cost, declarations);
  }
  for (const component of [...(input.mandatoryAdditional ?? []), ...(input.increases ?? [])]) {
    collectFromCost(component.cost, declarations);
  }
  return declarations;
}

function selectedOptionalCosts(context: ResolveContext, input: CostPlanInput): readonly OptionalCostInput[] {
  return (input.optionalAdditional ?? []).map(optional => {
    if (optional.selected !== undefined) {
      if (typeof optional.selected !== 'boolean') throw new TypeError('Optional additional cost selection must be boolean');
      return optional;
    }
    const selected = context.choose<boolean>({
      id: `${input.id}:optional:${optional.id}`,
      type: 'optional',
      chooser: context.controller,
      visibility: 'public',
    });
    if (typeof selected !== 'boolean') throw new TypeError('Optional additional cost selection must be boolean');
    return { ...optional, selected };
  });
}

/**
 * Freeze every production decision made while constructing a Chain item's cost.
 * The returned input contains the chosen base/optional components and stable
 * object receipts, so buildCostPlan cannot re-open a decision on a retry.
 */
export function finalizeCostPlanInput(
  context: ResolveContext,
  input: CostPlanInput,
  lockedChoices?: CostChoiceLocks,
): {
  readonly input: CostPlanInput;
  readonly locks?: ReturnType<typeof costChoiceLocks>;
} {
  let baseChoice = input.baseChoice;
  if (input.baseChoices !== undefined) {
    const options = input.baseChoices.map(component => component.id);
    baseChoice ??= context.choose<string>({
      id: `${input.id}:base`,
      type: 'mode',
      chooser: context.controller,
      visibility: 'public',
      options,
    });
    if (!options.includes(baseChoice)) throw new TypeError('Finalize selected an unknown base cost');
  } else if (baseChoice !== undefined) {
    throw new TypeError('A base cost choice requires baseChoices');
  }

  const optionalAdditional = selectedOptionalCosts(context, input);
  const normalized: CostPlanInput = {
    ...structuredClone(input),
    ...(baseChoice === undefined ? {} : { baseChoice }),
    ...(optionalAdditional.length === 0 ? {} : { optionalAdditional }),
  };
  if (normalized.ignoreAllCosts === true) return { input: normalized };
  if (lockedChoices !== undefined) {
    const expected = costChoiceDeclarations(normalized).map(declaration => `${normalized.id}\u0000${declaration.choice.id}\u0000${declaration.kind}`).sort();
    const actual = lockedChoices.locks.map(lock => `${lock.planId}\u0000${lock.choiceId}\u0000${lock.kind}`).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new TypeError('Locked cost choices do not match the current Finalize plan');
    }
    return { input: { ...normalized, costChoices: lockedChoices }, locks: lockedChoices };
  }

  const declarations = costChoiceDeclarations(normalized);
  if (declarations.length === 0) return { input: normalized };
  const declaredKinds = new Map<string, Set<string>>();
  for (const declaration of declarations) {
    const kinds = declaredKinds.get(declaration.choice.id) ?? new Set<string>();
    kinds.add(declaration.kind);
    declaredKinds.set(declaration.choice.id, kinds);
  }
  if ([...declaredKinds.values()].some(kinds => kinds.size > 1)) {
    throw new TypeError('One cost choice id cannot be reused for different payment kinds');
  }
  const byKey = new Map<string, { declaration: CostChoiceDeclaration; lock: CostChoiceLock }>();
  for (const declaration of declarations) {
    const key = declaration.choice.id;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      if (JSON.stringify(existing.declaration.choice) !== JSON.stringify(declaration.choice)) {
        throw new TypeError(`Conflicting cost choice declarations for ${declaration.choice.id}`);
      }
      continue;
    }
    const lock = finalizeCostChoiceLock(context, declaration.choice, normalized.id, declaration.kind);
    byKey.set(key, { declaration, lock });
  }
  const locks = costChoiceLocks([...byKey.values()].map(entry => entry.lock));
  return { input: { ...normalized, costChoices: locks }, locks };
}

/**
 * Finalize the one choice plan that owns the original instruction body. The
 * Chain supplies per-item memory and legality; this wrapper remains the sole
 * production entry point for mode/optional planning.
 */
export function finalizeInstructionChoices(
  context: ResolveContext,
  body: readonly Instruction[],
  options: ChoicePlanOptions = {},
): ChoicePlan {
  const finalized: TargetPlan[] = [];
  let bound = bindFinalizedTargetPlans(context, finalized);
  const refresh = (): void => { bound = bindFinalizedTargetPlans(context, finalized); };
  const targetOptions = {
    ...options.targetOptions,
    onTargetsFinalized: (event: TargetsFinalizedEvent) => {
      options.targetOptions?.onTargetsFinalized?.(event);
      finalized.push(event.plan);
      refresh();
    },
  };
  const plan = finalizeChoicePlan(bound, body, { ...options, targetOptions });
  if (finalized.length === 0) return plan;
  // `finalizeChoicePlan` exposes immutable plan records, while cross-target
  // legality is evaluated during that walk. Rebuild the returned records with
  // the exact locked selections after all relations have passed.
  const targets = plan.targets.map(target => {
    const matching = finalized.find(candidate =>
      candidate.requirement.id === target.plan.requirement.id &&
      candidate.mode === target.plan.mode && candidate.repeatIndex === target.plan.repeatIndex);
    return matching === undefined ? target : { ...target, plan: matching };
  });
  return Object.freeze({ ...plan, targets: Object.freeze(targets) });
}

export function hasFinalizeChoices(body: readonly Instruction[]): boolean {
  const visit = (instructions: readonly Instruction[], insideChoice = false): boolean => instructions.some(instruction => {
    if (instruction.op === 'choice.mode') return true;
    if (instruction.op === 'repeat') {
      if ((instruction.targets?.length ?? 0) > 0 || visit(controlBodies(instruction).flat(), insideChoice)) return true;
    }
    if (instruction.op === 'choice.optional') {
      if ((instruction.targets?.length ?? 0) > 0 || visit(controlBodies(instruction).flat(), true)) return true;
    }
    if (instruction.op === 'sequence') return visit(controlBodies(instruction).flat(), insideChoice);
    return insideChoice && (instruction.targets?.length ?? 0) > 0;
  });
  return visit(body);
}

function controlBodies(instruction: Instruction): readonly (readonly Instruction[])[] {
  const result: (readonly Instruction[])[] = [];
  if (['sequence', 'choice.optional', 'repeat'].includes(instruction.op)) {
    const expression = instruction.args.body;
    if (expression !== undefined && (expression.kind === 'constant' || expression.kind === 'literal') &&
        'value' in expression && Array.isArray(expression.value)) {
      result.push(expression.value as unknown as readonly Instruction[]);
    }
  }
  if (instruction.op === 'choice.mode') {
    const expression = instruction.args.modes;
    if (expression !== undefined && (expression.kind === 'constant' || expression.kind === 'literal') &&
        'value' in expression && Array.isArray(expression.value)) {
      for (const mode of expression.value as unknown as readonly { readonly body?: unknown }[]) {
        if (Array.isArray(mode.body)) result.push(mode.body as readonly Instruction[]);
      }
    }
  }
  return result;
}

/**
 * ChoicePlan locks ordinary instruction targets while walking selected bodies.
 * Control nodes themselves are not instructions in that walk, so their targets
 * are collected here before the ChoicePlan is evaluated.
 */
export function controlNodeTargetRequirements(
  body: readonly Instruction[],
  plan?: ChoicePlan,
): readonly import('../../target/target-plan.js').TargetRequirement[] {
  const result: import('../../target/target-plan.js').TargetRequirement[] = [];
  const samePath = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((segment, index) => segment === right[index]);
  const visit = (instructions: readonly Instruction[], modePath: readonly string[]): void => {
    for (const instruction of instructions) {
      if (['sequence', 'choice.optional', 'choice.mode', 'repeat'].includes(instruction.op)) {
        result.push(...(instruction.targets ?? []) as readonly import('../../target/target-plan.js').TargetRequirement[]);
      }
      if (instruction.op === 'sequence') {
        for (const nested of controlBodies(instruction)) visit(nested, modePath);
      } else if (instruction.op === 'choice.optional') {
        const choice = plan?.optionalChoices.find(candidate =>
          candidate.instructionId === instruction.id && samePath(candidate.modePath, modePath));
        if (plan === undefined || choice?.accepted === true) {
          for (const nested of controlBodies(instruction)) visit(nested, modePath);
        }
      } else if (instruction.op === 'choice.mode') {
        const selection = plan?.selectedModes.find(candidate =>
          candidate.instructionId === instruction.id && samePath(candidate.modePath, modePath));
        const modes = instruction.args.modes;
        if (modes === undefined || (modes.kind !== 'constant' && modes.kind !== 'literal') || !Array.isArray(modes.value)) continue;
        for (const mode of modes.value as unknown as readonly { readonly id?: unknown; readonly body?: unknown }[]) {
          if (typeof mode.id !== 'string' || !Array.isArray(mode.body)) continue;
          const copies = plan === undefined
            ? 1
            : selection?.selected.filter(selected => selected === mode.id).length ?? 0;
          for (let index = 0; index < copies; index++) {
            visit(mode.body as readonly Instruction[], [...modePath, mode.id]);
          }
        }
      }
      // A repeat body with targets is rejected before planning. Its other
      // control nodes cannot contribute stable control-level target plans
      // without an instruction-and-iteration scoped lifecycle.
    }
  };
  visit(body, []);
  return Object.freeze(result);
}

/** Backward-compatible name for the original mode-only helper. */
export function modeNodeTargetRequirements(body: readonly Instruction[]): readonly import('../../target/target-plan.js').TargetRequirement[] {
  return controlNodeTargetRequirements(body);
}

export function hasChoiceMemory(body: readonly Instruction[]): boolean {
  const visit = (instructions: readonly Instruction[]): boolean => instructions.some(instruction => {
    if (instruction.op === 'choice.mode') {
      const args = instruction.args as Readonly<Record<string, unknown>>;
      return args.memoryKey !== undefined || args.choiceMemoryKey !== undefined ||
        args.remember !== undefined || args.excludeChosen !== undefined;
    }
    return controlBodies(instruction).some(visit);
  });
  return visit(body);
}

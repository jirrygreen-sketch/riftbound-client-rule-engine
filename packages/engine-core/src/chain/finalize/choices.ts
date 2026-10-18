import type { Expr, Instruction } from '@riftbound/card-dsl';
import type {
  ObjectRef,
  PlayerId,
  ResolveContext,
} from '../../effects/contract.js';
import {
  finalizeTargetPlan,
  resolveTargetPlan,
  type TargetFinalizeOptions,
  type TargetPlan,
  type TargetRequirement,
  type TargetResolution,
} from '../../target/target-plan.js';
import { ChoiceMemory, type ChoiceMemoryKey } from './choice-memory.js';

export type ChoicePlanStatus = 'finalized' | 'declined';

export interface ChoicePlanTarget {
  readonly instructionId: string;
  readonly modePath: readonly string[];
  readonly repeatIndex?: number;
  readonly plan: TargetPlan;
}

export interface ChoicePlanOptional {
  readonly instructionId: string;
  readonly requestId: string;
  readonly accepted: boolean;
  readonly modePath: readonly string[];
  readonly repeatIndex?: number;
}

export interface ChoicePlanMode {
  readonly instructionId: string;
  readonly requestIds: readonly string[];
  readonly selected: readonly string[];
  readonly modePath: readonly string[];
  readonly repeatIndex?: number;
}

export interface ChoicePlan {
  readonly status: ChoicePlanStatus;
  readonly selectedModes: readonly ChoicePlanMode[];
  readonly optionalChoices: readonly ChoicePlanOptional[];
  readonly targets: readonly ChoicePlanTarget[];
  readonly repeats: readonly { readonly instructionId: string; readonly count: number; readonly modePath: readonly string[] }[];
  readonly memoryEntries: readonly { readonly key: ChoiceMemoryKey; readonly modes: readonly string[] }[];
}

export interface ChoicePlanOptions {
  /** Existing per-turn ledger. It is updated only after successful Finalize. */
  readonly memory?: ChoiceMemory;
  /** Turn identity used by memory; required when memory is supplied. */
  readonly turn?: string | number;
  /** Stable source/ability identity for cross-activation mode memory. */
  readonly memoryKey?: Omit<ChoiceMemoryKey, 'choiceId'>;
  readonly targetOptions?: Omit<TargetFinalizeOptions, 'mode' | 'repeatIndex'>;
}

export class ChoicePlanError extends Error {
  readonly code: 'invalid-mode' | 'no-mode-options' | 'invalid-repeat' | 'invalid-body';
  constructor(code: ChoicePlanError['code'], message: string) {
    super(message);
    this.name = 'ChoicePlanError';
    this.code = code;
  }
}

const isExpr = (value: unknown): value is Expr =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { kind?: unknown }).kind === 'string';

function evaluate(context: ResolveContext, value: unknown): unknown {
  return isExpr(value) ? context.evaluate(value) : value;
}

function bodyValue(context: ResolveContext, value: unknown): readonly Instruction[] {
  const result = evaluate(context, value);
  if (!Array.isArray(result)) throw new ChoicePlanError('invalid-body', 'Choice body must be an instruction array');
  return result as unknown as readonly Instruction[];
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ChoicePlanError('invalid-body', 'Expected a record');
  return value as Record<string, unknown>;
}

function modeEntries(context: ResolveContext, instruction: Instruction): readonly { readonly id: string; readonly body: readonly Instruction[] }[] {
  const raw = evaluate(context, instruction.args.modes);
  if (!Array.isArray(raw)) throw new ChoicePlanError('invalid-body', `${instruction.id} modes must be an array`);
  return raw.map(value => {
    const mode = recordValue(value);
    if (typeof mode.id !== 'string' || mode.id.length === 0) throw new ChoicePlanError('invalid-mode', `${instruction.id} contains an invalid mode id`);
    return Object.freeze({ id: mode.id, body: bodyValue(context, mode.body) });
  });
}

function targetRequirements(instruction: Instruction): readonly TargetRequirement[] {
  return (instruction.targets ?? []) as readonly TargetRequirement[];
}

function readCount(context: ResolveContext, instruction: Instruction): number {
  const value = evaluate(context, instruction.args.count ?? { kind: 'constant', value: 1 });
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ChoicePlanError('invalid-repeat', `${instruction.id} count must be a non-negative safe integer`);
  }
  return value;
}

function readBoolean(context: ResolveContext, value: unknown, fallback: boolean): boolean {
  const result = value === undefined ? fallback : evaluate(context, value);
  if (typeof result !== 'boolean') throw new ChoicePlanError('invalid-mode', 'Choice flag must be boolean');
  return result;
}

function memoryConfig(context: ResolveContext, instruction: Instruction, options: ChoicePlanOptions): { readonly enabled: boolean; readonly key?: string } {
  const args = instruction.args as Record<string, Expr | undefined>;
  const raw = args.memoryKey ?? args.choiceMemoryKey;
  const key = raw === undefined ? undefined : evaluate(context, raw);
  if (key !== undefined && typeof key !== 'string') throw new ChoicePlanError('invalid-mode', 'Choice memory key must be a string');
  // Supplying a memory key is an explicit caller request to apply the
  // per-turn ledger. Card IR may also opt in with the additive remember or
  // excludeChosen metadata; legacy choice.mode nodes remain unchanged when no
  // key/marker is supplied.
  const enabled = readBoolean(context, args.remember ?? args.excludeChosen, false) ||
    (options.memory !== undefined && options.memoryKey !== undefined);
  return { enabled, ...(key === undefined ? {} : { key }) };
}

function modeChoiceId(path: readonly string[], index: number): string {
  return `${path.map(segment => encodeURIComponent(segment)).join('/')}/mode%3A${index}`;
}

function planTarget(
  context: ResolveContext,
  instruction: Instruction,
  modePath: readonly string[],
  repeatIndex: number | undefined,
  options: ChoicePlanOptions,
  mode?: string,
): ChoicePlanTarget[] {
  return targetRequirements(instruction).map(requirement => {
    const target = finalizeTargetPlan(context, requirement, {
      ...options.targetOptions,
      mode,
      repeatIndex,
    });
    return Object.freeze({ instructionId: instruction.id, modePath: Object.freeze([...modePath]), ...(repeatIndex === undefined ? {} : { repeatIndex }), plan: target });
  });
}

function walk(
  context: ResolveContext,
  body: readonly Instruction[],
  options: ChoicePlanOptions,
  state: MutablePlanState,
  modePath: readonly string[],
  executionPath: readonly string[],
  repeatIndex?: number,
): void {
  for (const instruction of body) {
    const currentPath = [...executionPath, instruction.id];
    if (instruction.op === 'choice.mode') {
      const modes = modeEntries(context, instruction);
      const count = readCount(context, instruction);
      const different = readBoolean(context, instruction.args.different, true);
      const memory = options.memory;
      const config = memoryConfig(context, instruction, options);
      const available = config.enabled && memory && options.turn !== undefined && options.memoryKey
        ? memory.available({ ...options.memoryKey, choiceId: config.key ?? instruction.id }, modes.map(mode => mode.id), options.turn)
        : modes.map(mode => mode.id);
      if ((different && count > available.length) || (count > 0 && modes.length === 0)) {
        throw new ChoicePlanError('no-mode-options', `${instruction.id} has no legal mode choices`);
      }
      const selected: string[] = [];
      const requestIds: string[] = [];
      for (let index = 0; index < count; index++) {
        const remaining = modes.map(mode => mode.id).filter(id => available.includes(id) && (!different || !selected.includes(id)));
        if (remaining.length === 0) throw new ChoicePlanError('no-mode-options', `${instruction.id} has no legal mode choices`);
        const requestId = modeChoiceId(currentPath, index);
        const answer = context.choose<string>({
          id: requestId,
          type: 'mode',
          options: remaining,
          chooser: context.controller,
          visibility: 'public',
        });
        if (!remaining.includes(answer)) throw new ChoicePlanError('invalid-mode', `${instruction.id} received an illegal mode`);
        selected.push(answer);
        requestIds.push(requestId);
      }
      state.selectedModes.push(Object.freeze({ instructionId: instruction.id, requestIds: Object.freeze(requestIds), selected: Object.freeze(selected), modePath: Object.freeze([...modePath]), ...(repeatIndex === undefined ? {} : { repeatIndex }) }));
      const selectedSet = new Set(selected);
      for (const mode of modes) {
        const copies = selected.filter(id => id === mode.id).length;
        for (let index = 0; index < copies; index++) {
          const nextPath = [...modePath, mode.id];
          walk(context, mode.body, options, state, nextPath, [...currentPath, mode.id, String(index)], repeatIndex);
        }
      }
      if (config.enabled && memory && options.turn !== undefined && options.memoryKey) {
        const key = { ...options.memoryKey, choiceId: config.key ?? instruction.id };
        state.memoryEntries.push({ key, modes: Object.freeze([...selected]) });
      }
      continue;
    }
    if (instruction.op === 'choice.optional') {
      const requestId = `${currentPath.map(segment => encodeURIComponent(segment)).join('/')}/optional`;
      const accepted = context.choose<boolean>({
        id: requestId,
        type: 'optional',
        chooser: context.controller,
        visibility: 'public',
      });
      if (typeof accepted !== 'boolean') throw new ChoicePlanError('invalid-mode', `${instruction.id} received a non-boolean optional answer`);
      state.optionalChoices.push(Object.freeze({ instructionId: instruction.id, requestId, accepted, modePath: Object.freeze([...modePath]), ...(repeatIndex === undefined ? {} : { repeatIndex }) }));
      if (accepted) walk(context, bodyValue(context, instruction.args.body), options, state, modePath, currentPath, repeatIndex);
      continue;
    }
    if (instruction.op === 'repeat') {
      const count = readCount(context, instruction);
      const bodyValueForRepeat = bodyValue(context, instruction.args.body);
      state.repeats.push(Object.freeze({ instructionId: instruction.id, count, modePath: Object.freeze([...modePath]) }));
      for (let index = 0; index < count; index++) walk(context, bodyValueForRepeat, options, state, modePath, [...currentPath, String(index)], index);
      continue;
    }
    // An instruction's targets are locked only after all enclosing choices have
    // selected this instruction's branch.
    if (targetRequirements(instruction).length > 0) state.targets.push(...planTarget(context, instruction, modePath, repeatIndex, options));
    // A sequence is a control body. Other argument arrays are data and must not
    // be traversed, which keeps unselected mode data out of Finalize.
    if (instruction.op === 'sequence') walk(context, bodyValue(context, instruction.args.body), options, state, modePath, currentPath, repeatIndex);
  }
}

interface MutablePlanState {
  selectedModes: ChoicePlanMode[];
  optionalChoices: ChoicePlanOptional[];
  targets: ChoicePlanTarget[];
  repeats: { instructionId: string; count: number; modePath: readonly string[] }[];
  memoryEntries: { key: ChoiceMemoryKey; modes: readonly string[] }[];
}

/** Finalize mode, optional, repeat, and only the targets in selected bodies. */
export function finalizeChoicePlan(
  context: ResolveContext,
  body: readonly Instruction[],
  options: ChoicePlanOptions = {},
): ChoicePlan {
  const run = (): ChoicePlan => {
    if (options.memory && options.turn !== undefined) options.memory.beginTurn(options.turn);
    const state: MutablePlanState = { selectedModes: [], optionalChoices: [], targets: [], repeats: [], memoryEntries: [] };
    walk(context, body, options, state, [], []);
    if (options.memory && options.turn !== undefined && options.memoryKey) {
      for (const entry of state.memoryEntries) options.memory.recordAll(entry.key, entry.modes, options.turn);
    }
    const declined = body.length === 1 && state.optionalChoices.length === 1 && state.optionalChoices[0]?.accepted === false;
    return Object.freeze({
      status: declined ? 'declined' : 'finalized',
      selectedModes: Object.freeze(state.selectedModes),
      optionalChoices: Object.freeze(state.optionalChoices),
      targets: Object.freeze(state.targets),
      repeats: Object.freeze(state.repeats),
      memoryEntries: Object.freeze(state.memoryEntries),
    });
  };
  const atomic = () => options.memory ? options.memory.atomic(run) : run();
  return context.transaction ? context.transaction(atomic) : atomic();
}

/** Resolve a previously finalized plan, retesting every locked target. */
export function resolveChoicePlan(
  context: ResolveContext,
  plan: ChoicePlan,
  options: Parameters<typeof resolveTargetPlan>[2] = {},
): { readonly status: 'resolved' | 'partial' | 'ignored'; readonly targets: readonly TargetResolution[] } {
  if (plan.status === 'declined') return { status: 'ignored', targets: [] };
  const targets = plan.targets.map(target => resolveTargetPlan(context, target.plan, options));
  const status = targets.some(result => result.status === 'partial') ? 'partial' : targets.every(result => result.status === 'ignored') && targets.length > 0 ? 'ignored' : 'resolved';
  return Object.freeze({ status, targets: Object.freeze(targets) });
}

export function selectedTargetRefs(plan: ChoicePlan, instructionId: string): readonly ObjectRef[] {
  return plan.targets.filter(target => target.instructionId === instructionId).flatMap(target => target.plan.selected).map(ref => ({ ...ref }));
}

/**
 * Answers for replaying Finalize decisions while resolving the original IR.
 * The Chain owner can bind these answers into its ResolveContext; no card body
 * rewrite is required and unselected mode bodies remain unreachable.
 */
export function choicePlanAnswers(plan: ChoicePlan): Readonly<Record<string, unknown>> {
  const answers: Record<string, unknown> = Object.create(null);
  for (const choice of plan.selectedModes) {
    choice.requestIds.forEach((id, index) => { answers[id] = choice.selected[index]; });
  }
  for (const choice of plan.optionalChoices) answers[choice.requestId] = choice.accepted;
  return Object.freeze({ ...answers });
}

export const replayChoicePlan = choicePlanAnswers;

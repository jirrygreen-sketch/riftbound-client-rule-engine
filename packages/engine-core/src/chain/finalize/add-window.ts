import type { Restriction } from '@riftbound/card-dsl';
import type { ChainDraft, ChainEngine, ChainTrace } from '../engine.js';
import type { ObjectRef, ObjectSnapshot, PlayerId, PlayerSnapshot, PowerPaymentSource } from '../../effects/contract.js';
import type { PipelineEvent } from '../../events/pipeline-types.js';
import { describeAddActivation, type AddActivation } from '../../programs/add.js';
import type { ProgramRegistry } from '../../programs/registry.js';

export type AddWindowErrorCode =
  | 'not-paying'
  | 'not-add'
  | 'not-reaction'
  | 'controller-mismatch'
  | 'stale-source'
  | 'priority-transferred'
  | 'unresolved-add';

export class AddWindowError extends Error {
  readonly name = 'AddWindowError';
  constructor(readonly code: AddWindowErrorCode, message: string) {
    super(message);
  }
}

export interface AddPaymentResources {
  readonly energy: number;
  readonly power: readonly PowerPaymentSource[];
}

/** Evidence returned by one immediate Add settlement inside Pay Costs. */
export interface AddPaymentReceipt {
  readonly status: 'resolved';
  readonly itemId: string;
  readonly controller: PlayerId;
  readonly source: ObjectRef;
  readonly abilityIndex: number;
  readonly sourcePurpose?: Restriction;
  readonly resourceInstructionIds: readonly string[];
  readonly resources: AddPaymentResources;
  readonly cost: { readonly settled: true; readonly events: readonly PipelineEvent[] };
  readonly events: readonly PipelineEvent[];
  readonly trace: readonly ChainTrace[];
  readonly priorityTransferred: false;
}

export interface ReactionAddPaymentRequest {
  readonly engine: ChainEngine;
  readonly registry: ProgramRegistry;
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly abilityIndex?: number;
}

const PAYMENT_ACTIONS = new Set<string>([
  'pay', 'exhaust', 'discard', 'recycle', 'kill', 'banish', 'reveal', 'spend-buff', 'spend-xp', 'disempower',
]);

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function lifecycle(trace: readonly ChainTrace[], itemId: string): readonly string[] {
  return trace
    .filter(event => event.item === itemId && ['pending', 'finalized', 'resolved', 'removed'].includes(event.step))
    .map(event => `${event.step}${event.reason === undefined ? '' : `:${event.reason}`}`);
}

function addedResources(events: readonly PipelineEvent[]): AddPaymentResources {
  let energy = 0;
  const power: PowerPaymentSource[] = [];
  for (const event of events) {
    if (event.action?.type === 'gain-energy') energy += event.action.amount;
    if (event.action?.type === 'gain-power') power.push(...event.action.power);
  }
  return Object.freeze({ energy, power: Object.freeze(power) });
}

function linkedResourceValue(value: unknown): AddPaymentResources | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { readonly energy?: unknown; readonly power?: unknown };
  if (typeof record.energy !== 'number' || !Number.isSafeInteger(record.energy) || record.energy < 0 || !Array.isArray(record.power)) {
    return null;
  }
  const power: PowerPaymentSource[] = [];
  for (const domain of record.power) {
    if (!['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'universal', 'any', 'universal-power'].includes(String(domain))) return null;
    power.push(domain as PowerPaymentSource);
  }
  return Object.freeze({ energy: record.energy, power: Object.freeze(power) });
}

function linkedResources(
  context: ReturnType<ChainEngine['pipeline']['host']['context']>,
  instructionIds: readonly string[],
  before: ReadonlyMap<string, unknown>,
): AddPaymentResources | null {
  let energy = 0;
  const power: PowerPaymentSource[] = [];
  let changed = false;
  for (const id of instructionIds) {
    const key = `${id}.resources`;
    const value = linkedResourceValue(context.linked(key));
    if (value === null) continue;
    const previous = before.get(key);
    const updated = previous === undefined || previous !== value;
    if (!updated) continue;
    changed = true;
    energy += value.energy;
    power.push(...value.power);
  }
  return changed ? Object.freeze({ energy, power: Object.freeze(power) }) : null;
}

function resourceDelta(before: Pick<PlayerSnapshot, 'energy' | 'power'>, after: Pick<PlayerSnapshot, 'energy' | 'power'>): AddPaymentResources {
  const remaining = [...before.power];
  const power = after.power.filter(domain => {
    const index = remaining.indexOf(domain);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  return Object.freeze({ energy: Math.max(0, after.energy - before.energy), power: Object.freeze(power) });
}

function assertDraftShape(engine: ChainEngine, draft: ChainDraft, controller: PlayerId, source: ObjectSnapshot): void {
  if (draft.kind !== 'add') throw new AddWindowError('not-add', 'The payment window accepts only Add Chain drafts');
  if (draft.speed !== 'reaction') throw new AddWindowError('not-reaction', 'Only a Reaction Add can be activated while paying costs');
  if (draft.controller !== controller || source.controller !== controller) {
    throw new AddWindowError('controller-mismatch', 'The Add source and its controller do not match the payment request');
  }
  const live = engine.pipeline.host.objects().find(object => sameRef(object.ref, source.ref));
  if (live === undefined || live.controller !== controller || draft.source.ref.zoneEntryId !== source.ref.zoneEntryId) {
    throw new AddWindowError('stale-source', 'The Add source is no longer the requested live incarnation');
  }
}

/**
 * Recognize and activate a Reaction Add from card IR while Chain Finalize owns
 * the Pay Costs step. The existing ChainEngine call stays the timing authority;
 * this function only adds the production recognition, source/incarnation gate,
 * and receipt projection required by CR 430.2-430.3.
 */
export function activateReactionAddDuringPayment(request: ReactionAddPaymentRequest): AddPaymentReceipt {
  const { engine, registry, source, controller } = request;
  const activation: AddActivation = describeAddActivation(registry, source, controller, request.abilityIndex ?? 0);
  assertDraftShape(engine, activation.draft, controller, source);

  const beforeEvents = engine.pipeline.events.length;
  const beforeTrace = engine.trace.length;
  const beforeContext = engine.pipeline.host.context(source, controller, 'chain-item-resolve');
  const beforePlayer = beforeContext.player(controller);
  const beforeLinks = new Map(activation.resourceInstructionIds.map(id => [`${id}.resources`, beforeContext.linked(`${id}.resources`)]));
  try {
    engine.activateAddDuringPayment(activation.draft);
  } catch (error) {
    if (error instanceof Error && error.message === 'Only Reaction Add is allowed during payment') {
      throw new AddWindowError('not-paying', error.message);
    }
    throw error;
  }

  const events = engine.pipeline.events.slice(beforeEvents);
  const trace = engine.trace.slice(beforeTrace);
  if (trace.some(event => event.step === 'priority-granted' || event.step === 'focus-granted')) {
    throw new AddWindowError('priority-transferred', 'An Add ability must not transfer Priority or Focus');
  }
  const expected = ['pending', 'finalized', 'resolved', 'removed:resolved'];
  if (JSON.stringify(lifecycle(trace, activation.draft.id)) !== JSON.stringify(expected)) {
    throw new AddWindowError('unresolved-add', `Add ${activation.draft.id} did not finalize and resolve immediately`);
  }
  const afterContext = engine.pipeline.host.context(source, controller, 'chain-item-resolve');
  const afterPlayer = afterContext.player(controller);
  const eventResources = addedResources(events);
  const observed = resourceDelta(beforePlayer, afterPlayer);
  const linked = linkedResources(afterContext, activation.resourceInstructionIds, beforeLinks);
  const resources = linked ?? (eventResources.energy > 0 || eventResources.power.length > 0 ? eventResources : observed);
  const costEvents = events.filter(event => event.action !== undefined && PAYMENT_ACTIONS.has(event.action.type));
  return Object.freeze({
    status: 'resolved' as const,
    itemId: activation.draft.id,
    controller,
    source: { ...source.ref },
    abilityIndex: activation.abilityIndex,
    ...(activation.sourcePurpose === undefined ? {} : { sourcePurpose: structuredClone(activation.sourcePurpose) }),
    resourceInstructionIds: activation.resourceInstructionIds,
    resources,
    cost: Object.freeze({ settled: true as const, events: Object.freeze(costEvents) }),
    events: Object.freeze(events),
    trace: Object.freeze(trace.filter(event => ['pending', 'finalized', 'resolved', 'removed'].includes(event.step))),
    priorityTransferred: false as const,
  });
}

import type { ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import type { TimingEmission } from '../pipeline-types.js';
import { actionPayload, withActionPayload } from './payload.js';

export interface MightChangeProducerContext {
  readonly actionId?: string;
  readonly batchId?: string;
  readonly player?: PlayerId;
  readonly effectController?: PlayerId;
  readonly source?: ObjectSnapshot;
  readonly cause?: string;
  readonly simultaneousGroup?: string;
}

function sameIncarnation(left: ObjectSnapshot, right: ObjectSnapshot): boolean {
  return left.ref.id === right.ref.id && left.ref.zoneEntryId === right.ref.zoneEntryId;
}

/**
 * Produce `might-changed` after a layer evaluation has a before and after
 * snapshot. `null` remains distinct from every number, including zero; no
 * printed Might is never rewritten into a numeric value by this helper.
 */
export function deriveMightChangedEmissions(
  before: readonly ObjectSnapshot[],
  after: readonly ObjectSnapshot[],
  context: MightChangeProducerContext = {},
): readonly TimingEmission[] {
  const previousById = new Map(before.map(object => [object.ref.id, object]));
  const emissions: TimingEmission[] = [];

  for (const current of after) {
    const previous = previousById.get(current.ref.id);
    if (previous === undefined || !sameIncarnation(previous, current)) continue;
    if (!previous.types.includes('unit') || !current.types.includes('unit')) continue;
    if (Object.is(previous.might, current.might)) continue;
    const emission: TimingEmission = {
      timingPoint: 'might-changed',
      kind: 'might-changed',
      object: current,
      it: current,
      source: context.source,
      player: context.player ?? current.controller,
      details: {
        previousMight: previous.might,
        currentMight: current.might,
        ...(context.cause === undefined ? {} : { cause: context.cause }),
      },
      simultaneousGroup: context.simultaneousGroup ?? current.ref.id,
    };
    const enriched = context.actionId !== undefined || context.batchId !== undefined ||
      context.effectController !== undefined || context.source !== undefined;
    emissions.push(withActionPayload(emission, enriched ? {
        ...actionPayload(
          { type: 'buff', object: current.ref, amount: 0 },
          previous,
          current,
          { actionId: context.actionId, batchId: context.batchId, effectController: context.effectController, source: context.source, cause: context.cause, player: context.player },
        ),
        previousMight: previous.might,
        currentMight: current.might,
      } : {}, { before: previous, after: current }));
  }

  return Object.freeze(emissions);
}

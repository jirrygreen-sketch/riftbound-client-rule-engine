import type { ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import type { TimingEmission } from '../pipeline-types.js';
import { isTimingPointId, type TimingPointId } from '../timing-points.js';
import { actionPayload, withActionPayload } from './payload.js';

export interface ZoneChangeProducerContext {
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

function zoneTimings(prefix: 'object-enters-' | 'object-leaves-', object: ObjectSnapshot): readonly TimingPointId[] {
  const names = [`${prefix}zone`, `${prefix}${object.zone}`];
  if (object.zone === 'board' && object.location) names.push(`${prefix}${object.location.type}`);
  return [...new Set(names.filter(isTimingPointId))];
}

/**
 * Derive the named zone timing aliases from one committed object snapshot
 * transition. A changed zoneEntryId is a leave of the old incarnation and an
 * entry of the new incarnation, even when the object id is reused.
 *
 * This is intentionally pure: the caller supplies the before/after snapshots
 * from the atomic action result and appends the returned emissions to the
 * existing ActionExecution.emissions list before publishing the wave.
 */
export function deriveZoneChangeEmissions(
  before: readonly ObjectSnapshot[],
  after: readonly ObjectSnapshot[],
  context: ZoneChangeProducerContext = {},
): readonly TimingEmission[] {
  const previousById = new Map(before.map(object => [object.ref.id, object]));
  const currentById = new Map(after.map(object => [object.ref.id, object]));
  const emissions: TimingEmission[] = [];

  for (const previous of before) {
    const current = currentById.get(previous.ref.id);
    if (current !== undefined && sameIncarnation(previous, current)) continue;
    for (const timingPoint of zoneTimings('object-leaves-', previous)) {
      const emission: TimingEmission = {
        timingPoint,
        kind: 'object-left-zone',
        object: previous,
        source: context.source,
        player: context.player ?? previous.controller,
        fromZone: previous.zone,
        toZone: current?.zone,
        simultaneousGroup: context.simultaneousGroup ?? previous.ref.id,
      };
      const payload = actionPayload(
        { type: 'move-zone', object: previous.ref, to: current?.zone ?? previous.zone } as never,
        previous,
        current,
        { actionId: context.actionId, batchId: context.batchId, effectController: context.effectController, source: context.source, cause: context.cause, player: context.player },
      );
      const enriched = context.actionId !== undefined || context.batchId !== undefined ||
        context.effectController !== undefined || context.source !== undefined;
      emissions.push(enriched
        ? withActionPayload(emission, payload, { before: previous, after: current })
        : { ...emission, details: context.cause === undefined ? undefined : { cause: context.cause } });
    }
  }

  for (const current of after) {
    const previous = previousById.get(current.ref.id);
    if (previous !== undefined && sameIncarnation(previous, current)) continue;
    for (const timingPoint of zoneTimings('object-enters-', current)) {
      const emission: TimingEmission = {
        timingPoint,
        kind: 'object-entered-zone',
        object: current,
        source: context.source,
        player: context.player ?? current.controller,
        fromZone: previous?.zone,
        toZone: current.zone,
        simultaneousGroup: context.simultaneousGroup ?? current.ref.id,
      };
      const payload = actionPayload(
        { type: 'move-zone', object: current.ref, to: current.zone } as never,
        previous,
        current,
        { actionId: context.actionId, batchId: context.batchId, effectController: context.effectController, source: context.source, cause: context.cause, player: context.player },
      );
      const enriched = context.actionId !== undefined || context.batchId !== undefined ||
        context.effectController !== undefined || context.source !== undefined;
      emissions.push(enriched
        ? withActionPayload(emission, payload, { before: previous, after: current })
        : { ...emission, details: context.cause === undefined ? undefined : { cause: context.cause } });
    }
  }

  return Object.freeze(emissions);
}

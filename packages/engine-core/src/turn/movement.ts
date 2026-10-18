// RIFT-811 EG-MOVE: the transaction boundary between the validated Standard
// Move leaf and the event pipeline. The leaf owns movement legality; this
// adapter owns batch identity, live revalidation, rollback and the one Move
// event hand-off. Recall is a distinct contract action (CR v1.5 144.2,
// 144.4.c.1, 458.1) and is rejected before any batch work begins.
import type { ActionOutcome, ActionReceipt, GameAction, LocationRef, ObjectRef, ObjectSnapshot } from '../effects/contract.js';
import { EventPipeline } from '../events/pipeline.js';
import type { DuelBoard } from '../duel/battlefields.js';
import { createActionPipelineHost } from '../events/action-adapter.js';
import {
  assertDuelStandardMoveUnitStillLegal,
  inspectDuelStandardMove,
  type DuelMovementRuleContext,
  type DuelStandardMovePlan,
  type DuelStandardMoveRequest,
  type DuelStandardMoveTiming,
} from '../zones/movement.js';

export interface StandardMoveBatchHost {
  /** Public checkpoint/restore/commit/scan surface; a ChainEngine adapts this from its pipeline. */
  readonly pipeline: StandardMovePipelineSurface;
  /** State checkpoint/restore belonging to the same host as the pipeline. */
  readonly checkpoint: () => unknown;
  readonly restore: (checkpoint: unknown) => void;
  /** Authoritative board view used for the full preflight. */
  readonly board: DuelBoard;
  readonly unitIds: readonly string[];
  readonly actor: string;
  readonly destination: LocationRef;
  readonly timing: DuelStandardMoveTiming;
  /** Exact one-record-per-board-unit readiness snapshot. */
  readonly readiness: unknown;
  readonly ref: (objectId: string) => ObjectRef;
  readonly object: (objectId: string) => ObjectSnapshot | null;
  readonly rules?: DuelMovementRuleContext;
  readonly transactionId?: string;
}

type StandardMovePipelineSurface = Pick<EventPipeline,
  'checkpoint' | 'restore' | 'commit' | 'deferTriggerScan' | 'events'>;

export interface StandardMovePipelinePort {
  readonly checkpoint: () => unknown;
  readonly restore: (checkpoint: unknown) => void;
  readonly perform: (action: GameAction) => ActionOutcome;
  readonly objects: () => readonly ObjectSnapshot[];
  readonly choose: Parameters<typeof createActionPipelineHost>[0]['choose'];
  readonly context: Parameters<typeof createActionPipelineHost>[0]['context'];
  readonly testTrigger?: Parameters<typeof createActionPipelineHost>[0]['testTrigger'];
  readonly turnOrder: readonly [string, string];
  readonly turnPlayer: string;
}

export interface StandardMoveBatchResult {
  readonly receipt: ActionReceipt;
  readonly plan: DuelStandardMovePlan;
  readonly exhausted: readonly ObjectRef[];
  readonly moved: readonly ObjectRef[];
  readonly requiresOpenCleanup: true;
}

export class StandardMoveBatchError extends Error {
  readonly status = 'rejected' as const;
  constructor(readonly code: string, message: string, readonly receipt?: ActionReceipt) {
    super(message);
    this.name = 'StandardMoveBatchError';
  }
}

function locationId(location: LocationRef): string {
  return location.type === 'base'
    ? JSON.stringify(['duel-base', location.player])
    : JSON.stringify(['duel-battlefield', location.id]);
}

function batchAction(action: GameAction, transactionId: string, index: number): GameAction {
  // These additive runtime hints are consumed by createActionPipelineHost.
  // Keeping them structural preserves the frozen GameAction wire contract.
  return Object.freeze({
    ...action,
    actionId: `${transactionId}:${index}`,
    batchId: transactionId,
    cause: 'standard-move',
  }) as GameAction;
}

function batchHints(action: GameAction): { readonly actionId?: string; readonly batchId?: string; readonly cause?: string } {
  const hints = action as GameAction & { readonly actionId?: string; readonly batchId?: string; readonly cause?: string };
  return {
    ...(hints.actionId === undefined ? {} : { actionId: hints.actionId }),
    ...(hints.batchId === undefined ? {} : { batchId: hints.batchId }),
    ...(hints.cause === undefined ? {} : { cause: hints.cause }),
  };
}

function receipt(
  transactionId: string,
  actions: ActionReceipt['actions'],
  status: ActionReceipt['status'],
): ActionReceipt {
  return Object.freeze({
    transactionId,
    status,
    actions: Object.freeze(actions.map(action => Object.freeze({ ...action }))),
  });
}

/** Reject Recall before it can be mistaken for the closed move-location action. */
export function assertStandardMoveBatchAction(action: { readonly type: string }): void {
  if (action.type === 'recall') {
    throw new StandardMoveBatchError(
      'recall-is-not-a-move',
      'Recall is not a Move and cannot enter the Standard Move batch (CR v1.5 458.1)',
    );
  }
}

/**
 * Validate the entire group, then commit each unit's Exhaust + move-location
 * pair under one pipeline batch. The host and pipeline checkpoints cover the
 * group: a rejected/replaced action, stale later unit or changed rule restores
 * the batch start. Trigger scans remain deferred until all pairs commit.
 */
export function commitStandardMoveBatch(host: StandardMoveBatchHost): StandardMoveBatchResult {
  const transactionId = host.transactionId ??
    `standard-move:${host.actor}:${locationId(host.destination)}:${host.unitIds.join(',')}`;
  if (transactionId.trim().length === 0) {
    throw new StandardMoveBatchError('invalid-transaction', 'Standard Move needs a non-empty transaction id');
  }
  if (host.unitIds.length === 0 || host.unitIds.some(id => typeof id !== 'string' || id.trim().length === 0) ||
    new Set(host.unitIds).size !== host.unitIds.length) {
    throw new StandardMoveBatchError('invalid-unit-group', 'Standard Move needs a non-empty unique unit group');
  }
  const request: DuelStandardMoveRequest = {
    actor: host.actor,
    unitUIDs: [...host.unitIds],
    destinationLocationId: locationId(host.destination),
    timing: host.timing,
  };
  let plan: DuelStandardMovePlan;
  try {
    plan = inspectDuelStandardMove(host.board, host.readiness, request, host.rules);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid Standard Move';
    throw new StandardMoveBatchError('invalid-standard-move', message,
      receipt(transactionId, [], 'rejected'));
  }

  const hostCheckpoint = host.checkpoint();
  const pipelineCheckpoint = host.pipeline.checkpoint();
  const beforeEvents = host.pipeline.events;
  const actions: ActionReceipt['actions'][number][] = [];
  const exhausted: ObjectRef[] = [];
  const moved: ObjectRef[] = [];
  let index = 0;
  const live = (unitId: string) => {
    const object = host.object(unitId);
    if (object === null || object.zone !== 'board' || object.location === null) {
      throw new StandardMoveBatchError('unit-unavailable', `Unit ${unitId} is no longer on the Board`);
    }
    return {
      controllerPlayerId: object.controller,
      locationId: locationId(object.location),
      readied: !object.exhausted,
      hasGanking: object.keywords.some(keyword => keyword.id.toLowerCase() === 'ganking'),
    };
  };
  const recheck = {
    unit: live,
    validate: (unitId: string) => {
      const object = host.object(unitId);
      if (object === null || object.zone !== 'board' || object.controller !== host.actor ||
        object.location === null) {
        throw new StandardMoveBatchError('unit-unavailable', `Unit ${unitId} is unavailable`);
      }
    },
  };

  try {
    return host.pipeline.deferTriggerScan(() => {
      for (const unitId of plan.unitIds) {
        assertDuelStandardMoveUnitStillLegal(
          host.board, plan, unitId, recheck, host.rules, 'before-exhaust',
        );
        const ref = host.ref(unitId);
        const exhaustedOutcome: ActionOutcome = host.pipeline.commit(
          batchAction({ type: 'exhaust', object: ref }, transactionId, ++index),
        );
        actions.push({ type: 'exhaust', status: exhaustedOutcome.status });
        if (exhaustedOutcome.status !== 'done' && exhaustedOutcome.status !== 'replaced') {
          throw new StandardMoveBatchError('exhaust-rejected',
            `Exhaust for ${unitId} was ${exhaustedOutcome.status}`);
        }
        assertDuelStandardMoveUnitStillLegal(
          host.board, plan, unitId, recheck, host.rules, 'after-exhaust',
        );
        const movedOutcome: ActionOutcome = host.pipeline.commit(
          batchAction({ type: 'move-location', object: ref, to: host.destination }, transactionId, ++index),
        );
        const moveActionId = `${transactionId}:${index}`;
        actions.push({ type: 'move-location', status: movedOutcome.status });
        if (movedOutcome.status !== 'done' && movedOutcome.status !== 'replaced') {
          throw new StandardMoveBatchError('move-rejected',
            `Move for ${unitId} was ${movedOutcome.status}`);
        }
        const after = host.object(unitId);
        if (after === null || after.location === null || locationId(after.location) !== locationId(host.destination)) {
          throw new StandardMoveBatchError('move-not-committed', `Move for ${unitId} did not commit its destination`);
        }
        const moves = host.pipeline.events.filter(event => event.timingPoint === 'object-moved' &&
          (event.details as Record<string, unknown> | undefined)?.actionId === moveActionId);
        if (moves.length !== 1 || moves[0]?.details?.fromLocationId === moves[0]?.details?.toLocationId ||
          moves[0]?.details?.cause !== 'standard-move') {
          throw new StandardMoveBatchError('move-event-invalid', `Move for ${unitId} did not publish one move-location event`);
        }
        exhausted.push(ref);
        moved.push(ref);
      }
      return Object.freeze({
        receipt: receipt(transactionId, actions, 'committed'),
        plan,
        exhausted: Object.freeze([...exhausted]),
        moved: Object.freeze([...moved]),
        requiresOpenCleanup: true as const,
        events: Object.freeze(host.pipeline.events.slice(beforeEvents.length)),
      });
    });
  } catch (error) {
    host.restore(hostCheckpoint);
    host.pipeline.restore(pipelineCheckpoint);
    const rolledBack = receipt(transactionId, actions, 'rolled-back');
    if (error instanceof StandardMoveBatchError) {
      throw new StandardMoveBatchError(error.code, error.message, rolledBack);
    }
    throw new StandardMoveBatchError(
      'transaction-failed',
      error instanceof Error ? error.message : 'Standard Move transaction failed',
      rolledBack,
    );
  }
}

/**
 * Build the canonical action adapter for a Standard Move and run one batch.
 * This keeps the Move event emission in the same pipeline as ordinary
 * primitives while the port remains the state authority.
 */
export function commitStandardMoveThroughPipeline(
  port: StandardMovePipelinePort,
  input: Omit<StandardMoveBatchHost, 'pipeline' | 'checkpoint' | 'restore' | 'object'>,
): StandardMoveBatchResult {
  const pipeline = new EventPipeline(
    createActionPipelineHost({
      checkpoint: port.checkpoint,
      restore: port.restore,
      objects: port.objects,
      perform: port.perform,
      choose: port.choose,
      context: port.context,
      ...(port.testTrigger === undefined ? {} : { testTrigger: port.testTrigger }),
    }),
    port.turnOrder,
    port.turnPlayer,
  );
  return commitStandardMoveBatch({
    ...input,
    pipeline,
    checkpoint: port.checkpoint,
    restore: port.restore,
    object: id => port.objects().find(object => object.ref.id === id) ?? null,
  });
}

import type { GameAction, LocationRef, ObjectRef, ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import type { TimingEmission } from '../pipeline-types.js';

/**
 * Payload carried by an event produced from one committed primitive action.
 *
 * The public Pipeline types intentionally stay backward compatible.  These
 * fields are therefore also copied into `details` and are attached to the
 * runtime event object by `withActionPayload`; old consumers can continue to
 * read `object`, `source`, `target`, `player`, `fromZone`, and `toZone`.
 */
export interface ActionPayload {
  readonly actionId?: string;
  readonly batchId?: string;
  readonly playerId?: PlayerId;
  readonly responsiblePlayerId?: PlayerId;
  readonly affectedPlayerId?: PlayerId;
  readonly effectControllerPlayerId?: PlayerId;
  readonly sourceId?: string;
  readonly targetId?: string;
  readonly objectId?: string;
  readonly cardId?: string;
  readonly unitId?: string;
  readonly controllerId?: PlayerId;
  readonly ownerId?: PlayerId;
  readonly fromKind?: LocationRef['type'];
  readonly fromLocationId?: string;
  readonly toKind?: LocationRef['type'];
  readonly toLocationId?: string;
  readonly cause?: string;
  readonly previousMight?: number | null;
  readonly currentMight?: number | null;
  readonly cardIds?: readonly string[];
  readonly objectIds?: readonly string[];
  readonly visibility?: PlayerId | 'all' | readonly PlayerId[];
  readonly [key: string]: unknown;
}

export interface ActionPayloadContext {
  readonly actionId?: string;
  readonly batchId?: string;
  readonly effectController?: PlayerId;
  readonly source?: ObjectSnapshot;
  readonly cause?: string;
  readonly player?: PlayerId;
}

export type PayloadTimingEmission = TimingEmission & {
  readonly actionId?: string;
  readonly batchId?: string;
  readonly before?: ObjectSnapshot;
  readonly after?: ObjectSnapshot;
  readonly objects?: readonly ObjectSnapshot[];
  readonly payload?: ActionPayload;
};

export function locationKind(location: LocationRef | null | undefined): LocationRef['type'] | undefined {
  return location?.type;
}

export function locationId(location: LocationRef | null | undefined): string | undefined {
  if (location === undefined || location === null) return undefined;
  return location.type === 'base' ? location.player : location.id;
}

export function sameObjectRef(left: ObjectRef | undefined, right: ObjectRef | undefined): boolean {
  return left !== undefined && right !== undefined &&
    left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

export function objectRef(value: unknown): value is ObjectRef {
  return value !== null && typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    Number.isSafeInteger((value as { zoneEntryId?: unknown }).zoneEntryId);
}

export function actionObjectRef(action: GameAction): ObjectRef | undefined {
  if ('target' in action) return action.target;
  if ('object' in action) return action.object;
  return undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** Build stable role and identity fields from authoritative snapshots. */
export function actionPayload(
  action: GameAction,
  before: ObjectSnapshot | undefined,
  after: ObjectSnapshot | undefined,
  context: ActionPayloadContext = {},
): ActionPayload {
  const subject = after ?? before;
  const source = context.source ?? ('source' in action && before?.ref.id === action.source.id ? before : undefined);
  const player = 'player' in action ? action.player : context.player ?? before?.controller;
  const responsible = context.effectController ?? player;
  const affected = subject?.controller ?? ('player' in action ? action.player : undefined);
  return compact({
    actionId: context.actionId,
    batchId: context.batchId,
    playerId: player,
    responsiblePlayerId: responsible,
    affectedPlayerId: affected,
    effectControllerPlayerId: context.effectController,
    sourceId: source?.ref.id ?? ('source' in action ? action.source.id : undefined),
    targetId: 'target' in action ? action.target.id : undefined,
    objectId: subject?.ref.id ?? actionObjectRef(action)?.id,
    cardId: subject?.cardId === null ? undefined : subject?.cardId,
    unitId: subject?.types.includes('unit') ? subject.ref.id : undefined,
    controllerId: subject?.controller,
    ownerId: subject?.owner,
    cause: context.cause,
  });
}

/**
 * Attach payload fields without changing the legacy TimingEmission shape.
 * Keeping both `details` and top-level aliases makes this safe for existing
 * trigger consumers while giving replay/projection code one explicit payload.
 */
export function withActionPayload(
  emission: TimingEmission,
  payload: ActionPayload = {},
  snapshots: { readonly before?: ObjectSnapshot; readonly after?: ObjectSnapshot; readonly objects?: readonly ObjectSnapshot[] } = {},
): TimingEmission {
  const hasPayload = Object.keys(payload).length > 0;
  const hasSnapshots = snapshots.before !== undefined || snapshots.after !== undefined || snapshots.objects !== undefined;
  if (!hasPayload && !hasSnapshots) return emission;
  const details = {
    ...(emission.details ?? {}),
    ...(payload as Record<string, unknown>),
    ...(snapshots.before === undefined ? {} : { before: structuredClone(snapshots.before) }),
    ...(snapshots.after === undefined ? {} : { after: structuredClone(snapshots.after) }),
    ...(snapshots.objects === undefined ? {} : { objects: structuredClone(snapshots.objects) }),
  };
  const runtime = {
    ...emission,
    ...(payload as Record<string, unknown>),
    ...(snapshots.before === undefined ? {} : { before: structuredClone(snapshots.before) }),
    ...(snapshots.after === undefined ? {} : { after: structuredClone(snapshots.after) }),
    ...(snapshots.objects === undefined ? {} : { objects: structuredClone(snapshots.objects) }),
    payload: structuredClone(payload),
    details,
  } as PayloadTimingEmission;
  return runtime as TimingEmission;
}


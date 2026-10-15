// INTERNAL V4 command proof bridge. These capabilities are process-local and
// deliberately absent from the canonical session, wire projections, and archives.
import {
  applyDuelResourceCommandV2,
  inspectDuelNativeCommandSessionPathV2,
  issueDuelRequiredCostTaskV2,
  prepareDuelRequiredCostPaymentV2,
  type DuelCommandEnvelopeV2,
  type DuelCommandResultV2,
  type DuelCommandSessionV2,
  type DuelRequiredCostAuthorityV2,
  type DuelRequiredCostTaskV2,
  type DuelSourceAttestationRequestV2,
  type DuelSourceAttestorV2,
} from './canonical-session-v2.js';
import {
  inspectDuelPrintedUnitAttemptCapabilityV4,
  inspectDuelPrintedUnitChoiceProofV4,
  type DuelPrintedUnitAttemptCapabilityV4,
  type DuelPrintedUnitChoiceProofV4,
} from './cardplay-unit-chain-v4.js';
import type { DuelCanonicalPlayingStateV2 } from './core-v2.js';
import type { DuelPaymentSourceReference } from './canonical-session.js';
import type { DuelOptionalPlayReceiptDataV2 } from './optional-play-choice-v2.js';
import type { DuelRuneCost } from './resources.js';

function fail(message: string): never {
  throw new TypeError(`Duel V4 command proof: ${message}`);
}
function check(value: unknown, message: string): asserts value {
  if (!value) fail(message);
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function source(raw: unknown): DuelPaymentSourceReference {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'source record');
  const value = raw as Record<string, unknown>;
  check(value.kind === 'card' && typeof value.referenceId === 'string' &&
    typeof value.sourceUID === 'string', 'physical card source');
  return Object.freeze({ kind: 'card', referenceId: value.referenceId, sourceUID: value.sourceUID });
}

export type { DuelPrintedUnitAttemptCapabilityV4, DuelPrintedUnitChoiceProofV4 };
export type { DuelPrintedUnitAttemptInspectionV4, DuelPrintedUnitChoiceProofInspectionV4 } from './cardplay-unit-chain-v4.js';
export { inspectDuelPrintedUnitAttemptCapabilityV4, inspectDuelPrintedUnitChoiceProofV4 } from './cardplay-unit-chain-v4.js';
export { hasDuelPrintedUnitAttemptCapabilityV4 } from './cardplay-unit-chain-v4.js';

/**
 * The old public mint name remains as a hard failure for source compatibility.
 * Only the V4 coordinator has the private issuer and can create a capability.
 */
export function issueDuelPrintedUnitAttemptCapabilityV4(): never {
  throw new TypeError('Duel V4 command proof: attempt capability is issued only by the V4 lifecycle');
}

interface TaskRecord {
  readonly attempt: DuelPrintedUnitAttemptCapabilityV4;
  readonly attemptData: ReturnType<typeof inspectDuelPrintedUnitAttemptCapabilityV4>;
  issuedSession: DuelCommandSessionV2;
  readonly task: DuelRequiredCostTaskV2;
  readonly choiceProof: DuelPrintedUnitChoiceProofV4;
  readonly choiceData: DuelOptionalPlayReceiptDataV2;
  readonly sourceAttestor: DuelSourceAttestorV2;
  preparedSession?: DuelCommandSessionV2;
}

const authorities = new WeakMap<object, TaskRecord>();
const sessionTasks = new WeakMap<object, TaskRecord>();

function taskRequest(record: TaskRecord, request: DuelSourceAttestationRequestV2): void {
  const task = record.task;
  check(request.match === (record.preparedSession?.match ?? record.issuedSession.match),
    'task proof session head');
  check(request.actor === task.actor && request.paymentId === task.paymentId &&
    request.taskId === task.taskId && request.continuationId === task.continuationId &&
    same(request.finalResolvedCost, task.finalResolvedCost) &&
    same(source(request.sourceReference), source(task.opaqueSource)), 'task proof identity');
  // Choice and attempt proof identities are checked once at issue.  Prepare and
  // pay run on native successors, so they reuse this private binding rather
  // than trusting a stale receipt inspector supplied by a caller.
  const choice = record.choiceData;
  check(choice.matchId === task.matchId && choice.actor === task.actor && choice.uid === task.opaqueSource.sourceUID &&
    choice.cardId === task.opaqueSource.referenceId && choice.sourceEpoch === record.attemptData.chainEpoch,
  'choice receipt/task binding');
}

function guarded(record: TaskRecord): DuelSourceAttestorV2 {
  return request => {
    taskRequest(record, request);
    return record.sourceAttestor(request);
  };
}

/** V4 issue: the attestor cannot be called with a hand-made task capsule. */
export function issueDuelPrintedUnitRequiredCostTaskV4(
  session: DuelCommandSessionV2,
  task: DuelRequiredCostTaskV2,
  capability: DuelPrintedUnitAttemptCapabilityV4,
  choiceProof: DuelPrintedUnitChoiceProofV4,
  sourceAttestor: DuelSourceAttestorV2,
): { readonly session: DuelCommandSessionV2; readonly authority: DuelRequiredCostAuthorityV2; readonly persistRequired: boolean } {
  const sourceEpochValue = (session.match as DuelCanonicalPlayingStateV2).physicalCardsByUID[task.opaqueSource.sourceUID!]?.zoneEpoch;
  check(typeof sourceEpochValue === 'number' && Number.isSafeInteger(sourceEpochValue) && sourceEpochValue >= 0, 'required task source epoch');
  const sourceEpoch = sourceEpochValue as number;
  const choiceData = inspectDuelPrintedUnitChoiceProofV4(choiceProof, {
    match: session.match as DuelCanonicalPlayingStateV2, actor: task.actor,
    uid: task.opaqueSource.sourceUID!, cardId: task.opaqueSource.referenceId, sourceEpoch,
  });
  const attemptData = inspectDuelPrintedUnitAttemptCapabilityV4(capability, { match: session.match as DuelCanonicalPlayingStateV2,
    actor: task.actor, uid: task.opaqueSource.sourceUID!, cardId: task.opaqueSource.referenceId,
    sourceEpoch: choiceData.sourceEpoch,
  });
  check(choiceData.matchId === task.matchId && choiceData.actor === task.actor &&
    choiceData.uid === task.opaqueSource.sourceUID && choiceData.cardId === task.opaqueSource.referenceId &&
    choiceData.sourceEpoch === attemptData.chainEpoch, 'required task choice receipt');
  const record: TaskRecord = { attempt: capability, attemptData, issuedSession: session, task,
    choiceProof, choiceData, sourceAttestor };
  const issued = issueDuelRequiredCostTaskV2(session, task, guarded(record));
  record.issuedSession = issued.session;
  authorities.set(issued.authority as object, record);
  sessionTasks.set(issued.session as object, record);
  return issued;
}

export function prepareDuelPrintedUnitRequiredCostPaymentV4(
  session: DuelCommandSessionV2,
  authority: DuelRequiredCostAuthorityV2,
): { readonly session: DuelCommandSessionV2; readonly persistRequired: true } {
  const record = authority && typeof authority === 'object' ? authorities.get(authority as object) : undefined;
  check(record && record.issuedSession === session, 'foreign or stale V4 task authority');
  const prepared = prepareDuelRequiredCostPaymentV2(session, authority, guarded(record));
  record.preparedSession = prepared.session;
  sessionTasks.set(prepared.session as object, record);
  return prepared;
}

/** Carry the private V4 task proof over genuine Core resource successors. */
export function applyDuelPrintedUnitResourceCommandV4(
  session: DuelCommandSessionV2,
  actor: string,
  envelope: DuelCommandEnvelopeV2,
): DuelCommandResultV2 {
  const record = sessionTasks.get(session as object);
  check(record, 'V4 task proof missing from command session');
  const output = applyDuelResourceCommandV2(session, actor, envelope,
    { sourceAttestor: guarded(record) });
  record.preparedSession = output.session;
  sessionTasks.set(output.session as object, record);
  return output;
}


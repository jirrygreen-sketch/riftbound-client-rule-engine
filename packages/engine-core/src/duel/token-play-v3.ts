// Opt-in V3 Recruit TokenPlay. The canonical Chain identity is owned by Core V3; this
// coordinator only sequences trusted source, cost, payment and whole-program proofs.
import {
  advanceDuelCommandSessionNativeV2, applyDuelResourceCommandV2,
  inspectDuelNativeCommandSessionPathV2, issueDuelRequiredCostTaskV2,
  prepareDuelRequiredCostPaymentV2,
  type DuelCommandEnvelopeV2, type DuelCommandResultV2, type DuelCommandSessionV2,
  type DuelRequiredCostAuthorityV2, type DuelRequiredCostTaskV2, type DuelSourceAttestorV2,
} from './canonical-session-v2.js';
import {
  beginDuelRecruitTokenOnChainV3, cancelDuelRecruitTokenOnChainV3,
  finalizeDuelRecruitTokenFromChainV3, inspectDuelRecruitTokenOnChainV3,
  type DuelCanonicalPlayingStateV2, type DuelRecruitTokenChainReservationV3,
  type DuelTokenCreationRequestV2, type DuelTokenSourceAttestorV2,
} from './core-v2.js';
import { resolveDuelTotalCostV2, type DuelCostResolverAuthorityV2,
  type DuelResolvedCostV2 } from './cost-resolver-v2.js';
import { inspectDuelPhaseSourceClosureV2,
  type DuelPhaseSourceClosureContextV2, type DuelPhaseSourceClosureEventV2,
  type DuelPhaseSourceClosureJournalV2, type DuelPhaseSourceClosureRegistryV2,
} from './phase-source-closure-v2.js';
import { inspectDuelNativeHoldAttemptV3, type DuelNativeHoldAttemptV3 } from './turn-executor-v2.js';

export interface DuelRecruitTokenPlayRequestV3 {
  readonly commandId: string; readonly expectedVersion: number;
  readonly token: DuelTokenCreationRequestV2; readonly taskId: string;
  readonly paymentId: string; readonly continuationId: string; readonly transactionId: string;
}
export interface DuelRecruitTokenEffectHeadV3 {
  readonly match: DuelCanonicalPlayingStateV2; readonly commandSession: DuelCommandSessionV2;
  readonly commandId: string; readonly sourceEffectId: string; readonly eventId: string;
  readonly sourceUID: string; readonly controllerPlayerId: string;
  readonly status: 'resolving'; readonly limitedPlay: true;
  /** Present only for the stronger protected Hold path. Legacy generic V3 heads omit it. */
  readonly nativeHoldAttemptV3?: DuelNativeHoldAttemptV3;
  /** Present only when the effect head claims protected Hold provenance. */
  readonly sourceProofId?: string;
}
export interface DuelRecruitTokenCostBindingV3 {
  readonly match: DuelCanonicalPlayingStateV2; readonly tokenUID: string;
  readonly sourceEffectId: string; readonly transactionId: string;
  readonly baseProofId: string; readonly coverageProofId: string;
  readonly status: 'complete' | 'unknown';
}
export interface DuelRecruitTokenLegalityV3 {
  readonly match: DuelCanonicalPlayingStateV2; readonly tokenUID: string;
  readonly sourceEffectId: string; readonly paymentId: string; readonly status: 'complete' | 'unknown';
}
export interface DuelRecruitTokenEntryProofV3 {
  readonly match: DuelCanonicalPlayingStateV2; readonly tokenUID: string;
  readonly sourceEffectId: string; readonly eventId: string; readonly paymentId: string;
  readonly locationId: string; readonly proofId: string;
  readonly status: 'complete' | 'unknown';
  readonly disposition: 'default-exhausted-no-effects' | 'unknown';
}
export type DuelRecruitTokenClosureEventV3 = Extract<DuelPhaseSourceClosureEventV2,
  'chain' | 'zone-transition' | 'continuous' | 'effect-queue' | 'fepr-outstanding'>;
export interface DuelRecruitTokenClosureAuthorityV3 {
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly registry: DuelPhaseSourceClosureRegistryV2;
  readonly journal: DuelPhaseSourceClosureJournalV2;
}
export interface DuelRecruitTokenPlayServicesV3 {
  readonly effectHead: (session: DuelCommandSessionV2,
    request: DuelRecruitTokenPlayRequestV3) => DuelRecruitTokenEffectHeadV3 | null;
  readonly tokenSource: DuelTokenSourceAttestorV2; readonly paymentSource: DuelSourceAttestorV2;
  readonly cost: (request: Readonly<{ match: DuelCanonicalPlayingStateV2; tokenUID: string;
    sourceEffectId: string; transactionId: string }>) => DuelCostResolverAuthorityV2;
  readonly bindCost: (request: Readonly<Omit<DuelRecruitTokenCostBindingV3, 'status'>>) =>
    DuelRecruitTokenCostBindingV3;
  readonly legality?: (request: Readonly<{ match: DuelCanonicalPlayingStateV2; tokenUID: string;
    sourceEffectId: string; paymentId: string }>) => DuelRecruitTokenLegalityV3;
  readonly entry?: (request: Readonly<{ match: DuelCanonicalPlayingStateV2; tokenUID: string;
    sourceEffectId: string; eventId: string; paymentId: string; locationId: string }>) =>
    DuelRecruitTokenEntryProofV3;
  readonly closure: (match: DuelCanonicalPlayingStateV2, request: DuelRecruitTokenPlayRequestV3,
    event: DuelRecruitTokenClosureEventV3) => DuelRecruitTokenClosureAuthorityV3 | null;
}
export interface DuelRecruitTokenPlayV3 { readonly _duelRecruitTokenPlayV3: unique symbol }
export type DuelRecruitTokenPlayStageV3 = 'source-pending' | 'chain' | 'choosing' | 'cost-settled' |
  'task-issued' | 'payment' | 'paid' | 'legality' | 'entry' | 'finalizing' |
  'finalized' | 'cancelled' | 'poisoned';
export type DuelRecruitTokenPlayProgressV3 = Readonly<{ status: 'pending' | 'finalized' | 'blocked';
  stage: DuelRecruitTokenPlayStageV3; reason?: string; session: DuelCommandSessionV2 }>;
export interface DuelRecruitTokenPlayInspectionV3 {
  readonly stage: DuelRecruitTokenPlayStageV3; readonly commandSession: DuelCommandSessionV2;
  readonly tokenUID: string; readonly sourceEffectId: string; readonly eventId: string;
  readonly commandId: string; readonly paymentId: string;
  readonly finalResolvedCost?: DuelResolvedCostV2['finalResolvedCost'];
  readonly chainStatus: 'not-created' | 'on-chain' | 'finalized' | 'cancelled';
  readonly attemptProof?: DuelRecruitTokenPlayAttemptProofV3;
}
/** Process-local nominal evidence captured at the first protected callbacks. */
export interface DuelRecruitTokenPlayAttemptProofV3 {
  readonly session: DuelCommandSessionV2;
  readonly commandId: string;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly sourceUID: string;
  readonly controllerPlayerId: string;
  readonly sourceProofId: string;
  readonly lifecycle: 'source-pinned' | 'chain-pinned' | 'cost-pinned' | 'payment-task-issued' |
    'payment-open' | 'paid' | 'finalized' | 'cancelled' | 'poisoned';
  readonly resolvedCost?: DuelResolvedCostV2['finalResolvedCost'];
}
type PrivatePlayV3 = { readonly request: DuelRecruitTokenPlayRequestV3;
  readonly services: DuelRecruitTokenPlayServicesV3; readonly originalSession: DuelCommandSessionV2;
  session: DuelCommandSessionV2; stage: DuelRecruitTokenPlayStageV3;
  reservation?: DuelRecruitTokenChainReservationV3; resolved?: DuelResolvedCostV2;
  legality?: DuelRecruitTokenLegalityV3; entryProof?: DuelRecruitTokenEntryProofV3;
  nativeHoldAttempt?: DuelNativeHoldAttemptV3;
  taskAuthority?: DuelRequiredCostAuthorityV2; busy: boolean; poisoned: boolean };
const playsV3 = new WeakMap<object, PrivatePlayV3>();
const attemptProofs = new WeakMap<object, DuelRecruitTokenPlayAttemptProofV3>();
function check(value: unknown, label: string): asserts value {
  if (!value) throw new TypeError(`Duel Recruit TokenPlay V3: ${label}`);
}
function id(value: unknown, label: string): string {
  check(typeof value === 'string' && value.trim().length > 0, `${label} ID`); return value;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function play(handle: DuelRecruitTokenPlayV3): PrivatePlayV3 {
  const value = handle && typeof handle === 'object' ? playsV3.get(handle) : undefined;
  check(value, 'unknown or cloned V3 TokenPlay handle'); return value;
}
function lock<T>(entry: PrivatePlayV3, fn: () => T): T {
  if (entry.busy) { entry.poisoned = true; throw new TypeError('Duel Recruit TokenPlay V3: reentrant operation'); }
  check(!entry.poisoned, 'poisoned V3 TokenPlay'); entry.busy = true;
  try { return fn(); } finally { entry.busy = false; }
}
function guarded<T>(entry: PrivatePlayV3, fn: () => T): T {
  const value = fn(); check(!entry.poisoned, 'provider reentered V3 TokenPlay'); return value;
}
function playing(entry: PrivatePlayV3): DuelCanonicalPlayingStateV2 {
  const match = entry.session.match; check(match.stage === 'playing', 'V3 TokenPlay requires playing');
  inspectDuelNativeCommandSessionPathV2(entry.originalSession, entry.session); return match;
}
function result(entry: PrivatePlayV3, status: DuelRecruitTokenPlayProgressV3['status'], reason?: string) {
  return Object.freeze({ status, stage: entry.stage, session: entry.session, ...(reason ? { reason } : {}) });
}
function assertHead(entry: PrivatePlayV3): void {
  const match = playing(entry), token = entry.request.token;
  const head = guarded(entry, () => entry.services.effectHead(entry.session, entry.request));
  check(head && head.match === match && head.commandSession === entry.session &&
    head.commandId === entry.request.commandId && head.sourceEffectId === token.sourceEffectId &&
    head.eventId === token.eventId && head.sourceUID === token.sourceUID &&
    head.controllerPlayerId === token.controllerPlayerId && head.status === 'resolving' &&
    head.limitedPlay === true, 'current protected V3 effect head is unproved');
  const claimsProtectedHold = head.nativeHoldAttemptV3 !== undefined || head.sourceProofId !== undefined;
  if (claimsProtectedHold) {
    check(typeof head.sourceProofId === 'string' && head.sourceProofId.trim().length > 0,
      'protected native Hold source proof required');
    check(inspectDuelNativeHoldAttemptV3(head.nativeHoldAttemptV3!, entry.session,
      token.sourceUID, token.sourceZoneEpoch, token.controllerPlayerId,
      entry.request.taskId), 'native Hold attempt is foreign or stale');
    check(!entry.nativeHoldAttempt || entry.nativeHoldAttempt === head.nativeHoldAttemptV3,
      'native Hold attempt changed');
    entry.nativeHoldAttempt = head.nativeHoldAttemptV3;
  }
  const prior = attemptProofs.get(entry);
  if (claimsProtectedHold) {
    if (prior) check(prior.sourceProofId === head.sourceProofId, 'V3 effect-head source proof drift');
    else attemptProofs.set(entry, Object.freeze({
      session: entry.session, commandId: entry.request.commandId, tokenUID: token.tokenUID,
      sourceEffectId: token.sourceEffectId, eventId: token.eventId, sourceUID: token.sourceUID,
      controllerPlayerId: token.controllerPlayerId, sourceProofId: head.sourceProofId!,
      lifecycle: 'source-pinned' as const,
    }));
  } else check(!prior, 'V3 effect-head source proof disappeared');
}
function closure(entry: PrivatePlayV3, event: DuelRecruitTokenClosureEventV3): boolean {
  const match = playing(entry), supplied = guarded(entry, () => entry.services.closure(match, entry.request, event));
  if (!supplied) return false;
  const c = supplied.context;
  check(c.matchId === match.matchId && c.dataVersion === match.dataVersion &&
    c.catalogDigest === match.catalogDigest && c.turn === match.frame.turnNumber &&
    c.clock.stateVersion === match.stateVersion && c.clock.eventSeq === match.eventSeq &&
    c.event === event && id(c.taskId, 'closure task'), 'foreign V3 closure context');
  const inspected = inspectDuelPhaseSourceClosureV2(match, c, supplied.registry, supplied.journal);
  return inspected.status === 'ready' && inspected.eventSources.length === 0;
}

export function createDuelRecruitTokenPlayV3(session: DuelCommandSessionV2,
  request: DuelRecruitTokenPlayRequestV3, services: DuelRecruitTokenPlayServicesV3): DuelRecruitTokenPlayV3 {
  const match = session.match; check(match.stage === 'playing', 'playing command session required');
  inspectDuelNativeCommandSessionPathV2(session, session);
  const token = request.token;
  for (const [label, value] of Object.entries({ commandId: request.commandId, taskId: request.taskId,
    paymentId: request.paymentId, continuationId: request.continuationId,
    transactionId: request.transactionId, sourceEffectId: token.sourceEffectId,
    eventId: token.eventId, tokenUID: token.tokenUID })) id(value, label);
  check(new Set([request.commandId, request.taskId, request.paymentId, request.continuationId,
    request.transactionId, token.sourceEffectId, token.eventId, token.tokenUID]).size === 8,
  'V3 TokenPlay IDs must be distinct');
  check(request.expectedVersion === match.stateVersion && token.kind === 'recruit' &&
    token.readied === false && token.name === 'Recruit' && token.baseMight === 1 &&
    same(token.tags, ['Recruit']) && token.controllerPlayerId === token.effectControllerPlayerId &&
    match.board.bases.some(base => base.locationId === token.locationId &&
      base.ownerPlayerId === token.controllerPlayerId), 'V3 Recruit selection/identity');
  check(match.frame.pendingPayment === null && !session.requiredTasks.some(task =>
    task.status === 'issued' || task.status === 'active') &&
    !session.priorityPayments.some(payment => payment.status === 'active'), 'another payment owns session');
  check(typeof services?.effectHead === 'function' && typeof services.tokenSource === 'function' &&
    typeof services.paymentSource === 'function' && typeof services.cost === 'function' &&
    typeof services.bindCost === 'function' && typeof services.closure === 'function',
  'trusted V3 TokenPlay services required');
  const trustedRequest = Object.freeze({ ...request,
    token: Object.freeze({ ...request.token, tags: Object.freeze([...request.token.tags!]) }) });
  const handle = Object.freeze(Object.create(null)) as DuelRecruitTokenPlayV3;
  playsV3.set(handle, { request: trustedRequest, services, originalSession: session, session,
    stage: 'source-pending', busy: false, poisoned: false }); return handle;
}
export function inspectDuelRecruitTokenPlayV3(handle: DuelRecruitTokenPlayV3): DuelRecruitTokenPlayInspectionV3 {
  const entry = play(handle), token = entry.request.token; playing(entry);
  return Object.freeze({ stage: entry.stage, commandSession: entry.session, tokenUID: token.tokenUID,
    sourceEffectId: token.sourceEffectId, eventId: token.eventId, commandId: entry.request.commandId,
    paymentId: entry.request.paymentId,
    ...(entry.resolved ? { finalResolvedCost: entry.resolved.finalResolvedCost } : {}),
    chainStatus: entry.reservation ? inspectDuelRecruitTokenOnChainV3(entry.reservation).status : 'not-created',
    ...(attemptProofs.has(entry) ? { attemptProof: attemptProofs.get(entry) } : {}) });
}

/** Read-only identity check for a live V3 attempt. Clones and JSON values are rejected. */
export function inspectDuelRecruitTokenPlayAttemptV3(handle: DuelRecruitTokenPlayV3):
  DuelRecruitTokenPlayAttemptProofV3 | null {
  const entry = play(handle);
  playing(entry);
  return attemptProofs.get(entry) ?? null;
}

/**
 * Bind a live TokenPlay attempt to a native session successor created by the turn cursor
 * checkpoint or payment receipt. The handle remains process-local; a sibling/foreign session
 * cannot be attached, and the original command-session lineage is still required.
 */
export function rebindDuelRecruitTokenPlayV3(handle: DuelRecruitTokenPlayV3,
  session: DuelCommandSessionV2): void {
  const entry = play(handle);
  lock(entry, () => {
    check(entry.stage !== 'finalized' && entry.stage !== 'cancelled' && entry.stage !== 'poisoned',
      'cannot rebind closed V3 TokenPlay');
    check(session && session.match.stage === 'playing' && session.match.matchId === entry.session.match.matchId,
      'foreign V3 TokenPlay session');
    inspectDuelNativeCommandSessionPathV2(entry.session, session);
    if (entry.nativeHoldAttempt) {
      const token = entry.request.token;
      check(inspectDuelNativeHoldAttemptV3(entry.nativeHoldAttempt, session, token.sourceUID,
        token.sourceZoneEpoch, token.controllerPlayerId, entry.request.taskId),
      'native Hold continuation is foreign or stale');
    }
    entry.session = session;
  });
}

function updateAttemptProof(entry: PrivatePlayV3,
  update: Partial<Pick<DuelRecruitTokenPlayAttemptProofV3, 'lifecycle' | 'resolvedCost'>>): void {
  const prior = attemptProofs.get(entry);
  if (!prior) return;
  attemptProofs.set(entry, Object.freeze({ ...prior, ...update }));
}
export function beginDuelRecruitTokenPlayV3(handle: DuelRecruitTokenPlayV3): DuelRecruitTokenPlayProgressV3 {
  const entry = play(handle); return lock(entry, () => {
    if (entry.stage === 'finalized') return result(entry, 'finalized');
    if (entry.stage === 'cancelled' || entry.stage === 'poisoned') return result(entry, 'blocked', entry.stage);
    if (entry.stage !== 'source-pending') return result(entry, 'pending');
    try {
      assertHead(entry); const begun = beginDuelRecruitTokenOnChainV3(playing(entry), entry.request.token,
        argument => guarded(entry, () => entry.services.tokenSource(argument)));
      entry.session = advanceDuelCommandSessionNativeV2(entry.session, begun.match).session;
      entry.reservation = begun.reservation; entry.stage = 'chain';
      updateAttemptProof(entry, { lifecycle: 'chain-pinned' });
      return result(entry, 'pending');
    } catch { if (entry.poisoned) entry.stage = 'poisoned'; return result(entry, 'blocked', 'source-or-head-unproved'); }
  });
}
export function cancelDuelRecruitTokenPlayV3(handle: DuelRecruitTokenPlayV3): DuelRecruitTokenPlayProgressV3 {
  const entry = play(handle); return lock(entry, () => {
    if (entry.stage === 'finalized') return result(entry, 'finalized');
    if (entry.stage === 'cancelled') return result(entry, 'blocked', 'cancelled');
    if (entry.stage === 'source-pending') {
      entry.stage = 'cancelled'; updateAttemptProof(entry, { lifecycle: 'cancelled' });
      return result(entry, 'blocked', 'cancelled');
    }
    if (entry.stage !== 'chain' && entry.stage !== 'choosing' && entry.stage !== 'cost-settled')
      return result(entry, 'blocked', 'cancel-pending-after-payment-task');
    try {
      const cancelled = cancelDuelRecruitTokenOnChainV3(playing(entry), entry.reservation!);
      entry.session = advanceDuelCommandSessionNativeV2(entry.session, cancelled.match).session;
      entry.stage = 'cancelled'; updateAttemptProof(entry, { lifecycle: 'cancelled' });
      return result(entry, 'blocked', 'cancelled');
    } catch { return result(entry, 'blocked', 'cancel-pending-or-head-unproved'); }
  });
}
export function resumeDuelRecruitTokenPlayV3(handle: DuelRecruitTokenPlayV3): DuelRecruitTokenPlayProgressV3 {
  const entry = play(handle); return lock(entry, () => {
    if (entry.stage === 'finalized') return result(entry, 'finalized');
    if (entry.stage === 'cancelled' || entry.stage === 'poisoned') return result(entry, 'blocked', entry.stage);
    if (entry.stage === 'source-pending') return result(entry, 'blocked', 'source-or-head-unproved');
    try {
      assertHead(entry); const match = playing(entry), request = entry.request;
      if (entry.stage === 'chain' || entry.stage === 'choosing') {
        entry.stage = 'choosing'; if (!closure(entry, 'chain')) return result(entry, 'pending', 'chain-unproved');
        if (!entry.resolved) {
          const authority = guarded(entry, () => entry.services.cost({ match, tokenUID: request.token.tokenUID,
            sourceEffectId: request.token.sourceEffectId, transactionId: request.transactionId }));
          const resolved = resolveDuelTotalCostV2(authority, { transactionId: request.transactionId,
            subjectId: request.token.tokenUID, kind: 'card-play' });
          check(resolved.baseCost.energy === 0 && resolved.baseCost.power.length === 0,
            'Recruit printed/base cost is not zero'); entry.resolved = resolved;
        }
        const bindingRequest = Object.freeze({ match, tokenUID: request.token.tokenUID,
          sourceEffectId: request.token.sourceEffectId, transactionId: request.transactionId,
          baseProofId: entry.resolved.baseProofId, coverageProofId: entry.resolved.coverageProofId });
        const binding = guarded(entry, () => entry.services.bindCost(bindingRequest));
        check(binding.status === 'complete' && binding.match === match &&
          binding.tokenUID === bindingRequest.tokenUID && binding.sourceEffectId === bindingRequest.sourceEffectId &&
          binding.transactionId === bindingRequest.transactionId && binding.baseProofId === bindingRequest.baseProofId &&
          binding.coverageProofId === bindingRequest.coverageProofId, 'V3 cost coverage unproved');
        entry.stage = 'cost-settled'; updateAttemptProof(entry, {
          lifecycle: 'cost-pinned', resolvedCost: entry.resolved.finalResolvedCost });
      }
      if (entry.stage === 'cost-settled') {
        const token = request.token;
        const task: DuelRequiredCostTaskV2 = { matchId: match.matchId, expectedVersion: match.stateVersion,
          taskId: request.taskId, paymentId: request.paymentId, actor: token.controllerPlayerId,
          finalResolvedCost: entry.resolved!.finalResolvedCost,
          opaqueSource: { kind: 'effect', referenceId: token.sourceEffectId, sourceUID: token.sourceUID },
          continuationId: request.continuationId };
        const issued = issueDuelRequiredCostTaskV2(entry.session, task,
          argument => guarded(entry, () => entry.services.paymentSource(argument)));
        entry.session = issued.session; entry.taskAuthority = issued.authority; entry.stage = 'task-issued';
        updateAttemptProof(entry, { lifecycle: 'payment-task-issued' });
      }
      if (entry.stage === 'task-issued') {
        const prepared = prepareDuelRequiredCostPaymentV2(entry.session, entry.taskAuthority!,
          argument => guarded(entry, () => entry.services.paymentSource(argument)));
        entry.session = prepared.session; entry.taskAuthority = undefined; entry.stage = 'payment';
        updateAttemptProof(entry, { lifecycle: 'payment-open' });
        return result(entry, 'pending');
      }
      if (entry.stage === 'payment') return result(entry, 'pending');
      if (entry.stage === 'paid' || entry.stage === 'legality' || entry.stage === 'entry' || entry.stage === 'finalizing') {
        if (entry.stage === 'paid') entry.stage = 'legality';
        if (!entry.legality) {
          if (!entry.services.legality) return result(entry, 'pending', 'legality-unproved');
          const legalityRequest = Object.freeze({ match, tokenUID: request.token.tokenUID,
            sourceEffectId: request.token.sourceEffectId, paymentId: request.paymentId });
          const legality = guarded(entry, () => entry.services.legality!(legalityRequest));
          check(legality.status === 'complete' && legality.match === match &&
            legality.tokenUID === legalityRequest.tokenUID && legality.sourceEffectId === legalityRequest.sourceEffectId &&
            legality.paymentId === legalityRequest.paymentId, 'V3 legality unproved');
          entry.legality = Object.freeze({ ...legality });
        }
        if (!entry.entryProof) {
          entry.stage = 'entry'; if (!entry.services.entry) return result(entry, 'pending', 'entry-unproved');
          const token = request.token, entryRequest = Object.freeze({ match, tokenUID: token.tokenUID,
            sourceEffectId: token.sourceEffectId, eventId: token.eventId, paymentId: request.paymentId,
            locationId: token.locationId });
          const proof = guarded(entry, () => entry.services.entry!(entryRequest));
          check(proof.status === 'complete' && proof.disposition === 'default-exhausted-no-effects' &&
            proof.match === match && id(proof.proofId, 'entry proof') && proof.tokenUID === entryRequest.tokenUID &&
            proof.sourceEffectId === entryRequest.sourceEffectId && proof.eventId === entryRequest.eventId &&
            proof.paymentId === entryRequest.paymentId && proof.locationId === entryRequest.locationId,
          'V3 entry closure unproved');
          entry.entryProof = Object.freeze({ ...proof });
        }
        entry.stage = 'finalizing';
        check(entry.session.requiredTasks.some(task => task.taskId === request.taskId && task.paymentId === request.paymentId &&
          task.continuationId === request.continuationId && task.status === 'completed'), 'required payment incomplete');
        check(entry.session.receipts.some(receipt => receipt.actor === request.token.controllerPlayerId &&
          receipt.outcome.status === 'applied' && receipt.outcome.paymentCompleted?.paymentId === request.paymentId &&
          receipt.outcome.paymentCompleted.requiredTask?.taskId === request.taskId &&
          receipt.outcome.paymentCompleted.requiredTask.continuationId === request.continuationId), 'payment receipt absent');
        for (const event of ['zone-transition', 'continuous', 'effect-queue', 'fepr-outstanding'] as const)
          if (!closure(entry, event)) return result(entry, 'pending', `${event}-unproved`);
        const before = playing(entry), after = finalizeDuelRecruitTokenFromChainV3(before, entry.reservation!,
          argument => guarded(entry, () => entry.services.tokenSource(argument)));
        const advanced = advanceDuelCommandSessionNativeV2(entry.session, after);
        const commits = inspectDuelNativeCommandSessionPathV2(entry.originalSession, advanced.session);
        check(commits.length > 0, 'V3 Finalize produced no native commit');
        entry.session = advanced.session;
        entry.stage = 'finalized'; updateAttemptProof(entry, { lifecycle: 'finalized' });
        return result(entry, 'finalized');
      }
      return result(entry, 'blocked', 'unknown-stage');
    } catch { if (entry.poisoned) entry.stage = 'poisoned'; return result(entry, 'blocked', 'trusted-proof-or-session-unproved'); }
  });
}
export function applyDuelRecruitTokenResourceCommandV3(handle: DuelRecruitTokenPlayV3,
  actor: string, envelope: DuelCommandEnvelopeV2): DuelCommandResultV2 {
  const entry = play(handle); return lock(entry, () => {
    check(entry.stage === 'payment' || entry.stage === 'paid', 'V3 TokenPlay has no resource window');
    check(entry.stage !== 'paid' || entry.session.receipts.some(receipt => receipt.actor === actor && receipt.commandId === envelope.commandId),
      'paid V3 TokenPlay accepts only exact command receipt retry');
    if (entry.nativeHoldAttempt) assertHead(entry);
    const outcome = applyDuelResourceCommandV2(entry.session, actor, envelope, {
      sourceAttestor: argument => guarded(entry, () => entry.services.paymentSource(argument)),
    });
    check(!entry.poisoned || outcome.outcome.status !== 'applied', 'reentered V3 payment provider');
    if (outcome.persistRequired) entry.session = outcome.session;
    if (outcome.outcome.status === 'applied' && outcome.outcome.paymentCompleted?.paymentId === entry.request.paymentId &&
      outcome.outcome.paymentCompleted.requiredTask?.taskId === entry.request.taskId &&
      outcome.outcome.paymentCompleted.requiredTask.continuationId === entry.request.continuationId) {
      entry.stage = 'paid'; updateAttemptProof(entry, { lifecycle: 'paid' });
    }
    return outcome;
  });
}

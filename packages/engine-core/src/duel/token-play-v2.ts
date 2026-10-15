// Opt-in, process-local Recruit TokenPlay. This does not restore from JSON or authorize a
// public command. Its source, cost and whole-program journal providers are trusted adapters.
import {
  advanceDuelCommandSessionNativeV2, applyDuelResourceCommandV2,
  inspectDuelNativeCommandSessionPathV2, issueDuelRequiredCostTaskV2,
  prepareDuelRequiredCostPaymentV2,
  type DuelCommandEnvelopeV2, type DuelCommandResultV2, type DuelCommandSessionV2,
  type DuelRequiredCostAuthorityV2, type DuelRequiredCostTaskV2,
  type DuelSourceAttestorV2,
} from './canonical-session-v2.js';
import {
  beginDuelRecruitTokenOnChainV2, finalizeDuelRecruitTokenFromChainV2,
  cancelDuelRecruitTokenOnChainV2, inspectDuelRecruitTokenOnChainV2, inspectDuelNativeCommitPathV2,
  type DuelCanonicalPlayingStateV2, type DuelRecruitTokenChainReservationV2,
  type DuelTokenCreationRequestV2, type DuelTokenSourceAttestorV2,
} from './core-v2.js';
import { resolveDuelTotalCostV2, type DuelCostResolverAuthorityV2,
  type DuelResolvedCostV2 } from './cost-resolver-v2.js';
import { inspectDuelPhaseSourceClosureV2,
  type DuelPhaseSourceClosureContextV2, type DuelPhaseSourceClosureEventV2,
  type DuelPhaseSourceClosureJournalV2, type DuelPhaseSourceClosureRegistryV2,
} from './phase-source-closure-v2.js';

export interface DuelRecruitTokenPlayRequestV2 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly token: DuelTokenCreationRequestV2;
  readonly taskId: string;
  readonly paymentId: string;
  readonly continuationId: string;
  readonly transactionId: string;
}
export interface DuelRecruitTokenEffectHeadV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly commandSession: DuelCommandSessionV2;
  readonly commandId: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly sourceUID: string;
  readonly controllerPlayerId: string;
  readonly status: 'resolving';
  readonly limitedPlay: true;
}
export interface DuelRecruitTokenCostBindingV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly transactionId: string;
  readonly baseProofId: string;
  readonly coverageProofId: string;
  readonly status: 'complete' | 'unknown';
}
export interface DuelRecruitTokenLegalityV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly paymentId: string;
  readonly status: 'complete' | 'unknown';
}
/** Exact pre-entry census for this nominal token and this paid event. The adapter must
 * account for its own program and all replacement, entry, trigger and queue effects. */
export interface DuelRecruitTokenEntryProofV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly paymentId: string;
  readonly locationId: string;
  readonly proofId: string;
  readonly status: 'complete' | 'unknown';
  readonly disposition: 'default-exhausted-no-effects' | 'unknown';
}
export type DuelRecruitTokenClosureEventV2 = Extract<DuelPhaseSourceClosureEventV2,
  'chain' | 'zone-transition' | 'continuous' | 'effect-queue' | 'fepr-outstanding'>;
export interface DuelRecruitTokenClosureAuthorityV2 {
  readonly context: DuelPhaseSourceClosureContextV2;
  readonly registry: DuelPhaseSourceClosureRegistryV2;
  readonly journal: DuelPhaseSourceClosureJournalV2;
}
export interface DuelRecruitTokenPlayServicesV2 {
  /** Must inspect the exact protected native effect/command head, not infer it from a card kind. */
  readonly effectHead: (session: DuelCommandSessionV2,
    request: DuelRecruitTokenPlayRequestV2) => DuelRecruitTokenEffectHeadV2 | null;
  readonly tokenSource: DuelTokenSourceAttestorV2;
  readonly paymentSource: DuelSourceAttestorV2;
  /** Each attempt receives a fresh resolver. Its independent verifier covers every candidate.
   * An unfixed (unknown/thrown) attempt may be retried at the same protected head and the same
   * effect/event/transaction IDs; a fixed (successfully resolved) cost is cached and never recomputed. */
  readonly cost: (request: Readonly<{ match: DuelCanonicalPlayingStateV2;
    tokenUID: string; sourceEffectId: string; transactionId: string }>) => DuelCostResolverAuthorityV2;
  readonly bindCost: (request: Readonly<Omit<DuelRecruitTokenCostBindingV2, 'status'>>) =>
    DuelRecruitTokenCostBindingV2;
  /** 358 legality recheck after payment and before Finalizing. Omission is pending. */
  readonly legality?: (request: Readonly<{ match: DuelCanonicalPlayingStateV2;
    tokenUID: string; sourceEffectId: string; paymentId: string }>) => DuelRecruitTokenLegalityV2;
  /** Required because pre-birth source closure cannot enumerate the Chain-born token. */
  readonly entry?: (request: Readonly<{ match: DuelCanonicalPlayingStateV2;
    tokenUID: string; sourceEffectId: string; eventId: string; paymentId: string;
    locationId: string }>) => DuelRecruitTokenEntryProofV2;
  /** Supplies nominal protected journal/registry handles at this exact head and event. */
  readonly closure: (match: DuelCanonicalPlayingStateV2,
    request: DuelRecruitTokenPlayRequestV2,
    event: DuelRecruitTokenClosureEventV2) => DuelRecruitTokenClosureAuthorityV2 | null;
}
export interface DuelRecruitTokenPlayV2 { readonly _duelRecruitTokenPlayV2: unique symbol }
export type DuelRecruitTokenPlayStageV2 = 'source-pending' | 'chain' | 'choosing' |
  'cost-settled' | 'task-issued' | 'payment' | 'paid' | 'legality' | 'entry' |
  'finalizing' | 'finalized' | 'cancelled' | 'poisoned';
export interface DuelRecruitTokenPlayInspectionV2 {
  readonly stage: DuelRecruitTokenPlayStageV2;
  readonly commandSession: DuelCommandSessionV2;
  readonly tokenUID: string;
  readonly sourceEffectId: string;
  readonly eventId: string;
  readonly commandId: string;
  readonly paymentId: string;
  readonly finalResolvedCost?: DuelResolvedCostV2['finalResolvedCost'];
  readonly chainStatus: 'not-created' | 'on-chain' | 'finalized' | 'cancelled';
}
export type DuelRecruitTokenPlayProgressV2 = Readonly<{
  status: 'pending' | 'finalized' | 'blocked';
  stage: DuelRecruitTokenPlayStageV2;
  reason?: string;
  session: DuelCommandSessionV2;
}>;

type PrivatePlay = {
  readonly request: DuelRecruitTokenPlayRequestV2;
  readonly services: DuelRecruitTokenPlayServicesV2;
  readonly originalSession: DuelCommandSessionV2;
  session: DuelCommandSessionV2;
  stage: DuelRecruitTokenPlayStageV2;
  reservation?: DuelRecruitTokenChainReservationV2;
  resolved?: DuelResolvedCostV2;
  legality?: DuelRecruitTokenLegalityV2;
  entryProof?: DuelRecruitTokenEntryProofV2;
  taskAuthority?: DuelRequiredCostAuthorityV2;
  busy: boolean;
  poisoned: boolean;
};
const plays = new WeakMap<object, PrivatePlay>();
function check(value: unknown, label: string): asserts value {
  if (!value) throw new TypeError(`Duel Recruit TokenPlay V2: ${label}`);
}
function id(value: unknown, label: string): string {
  check(typeof value === 'string' && value.trim().length > 0, `${label} ID`);
  return value;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function privatePlay(handle: DuelRecruitTokenPlayV2): PrivatePlay {
  const entry = handle && typeof handle === 'object' ? plays.get(handle) : undefined;
  check(entry, 'unknown or cloned TokenPlay handle');
  return entry;
}
function withLock<T>(entry: PrivatePlay, action: () => T): T {
  if (entry.busy) { entry.poisoned = true; throw new TypeError('Duel Recruit TokenPlay V2: reentrant operation'); }
  check(!entry.poisoned, 'poisoned TokenPlay');
  entry.busy = true;
  try { return action(); } finally { entry.busy = false; }
}
function guarded<T>(entry: PrivatePlay, callback: () => T): T {
  const value = callback();
  check(!entry.poisoned, 'provider reentered TokenPlay');
  return value;
}
function result(entry: PrivatePlay, status: DuelRecruitTokenPlayProgressV2['status'],
  reason?: string): DuelRecruitTokenPlayProgressV2 {
  return Object.freeze({ status, stage: entry.stage, session: entry.session,
    ...(reason ? { reason } : {}) });
}
function playing(entry: PrivatePlay): DuelCanonicalPlayingStateV2 {
  const match = entry.session.match;
  check(match.stage === 'playing', 'TokenPlay requires playing');
  inspectDuelNativeCommandSessionPathV2(entry.originalSession, entry.session);
  return match;
}
function assertHead(entry: PrivatePlay): void {
  const match = playing(entry), token = entry.request.token;
  const head = guarded(entry, () => entry.services.effectHead(entry.session, entry.request));
  check(head && head.match === match && head.commandSession === entry.session &&
    head.commandId === entry.request.commandId && head.sourceEffectId === token.sourceEffectId &&
    head.eventId === token.eventId && head.sourceUID === token.sourceUID &&
    head.controllerPlayerId === token.controllerPlayerId && head.status === 'resolving' &&
    head.limitedPlay === true, 'current protected effect head is unproved');
}
function inspectClosure(entry: PrivatePlay, event: DuelRecruitTokenClosureEventV2): boolean {
  const match = playing(entry);
  const supplied = guarded(entry, () => entry.services.closure(match, entry.request, event));
  if (!supplied) return false;
  const context = supplied.context;
  check(context.matchId === match.matchId && context.dataVersion === match.dataVersion &&
    context.catalogDigest === match.catalogDigest && context.turn === match.frame.turnNumber &&
    context.clock.stateVersion === match.stateVersion && context.clock.eventSeq === match.eventSeq &&
    context.event === event && id(context.taskId, 'closure task'),
  'foreign TokenPlay closure context');
  const inspected = inspectDuelPhaseSourceClosureV2(match, context,
    supplied.registry, supplied.journal);
  return inspected.status === 'ready' && inspected.eventSources.length === 0;
}

/** Create only a private pending process. Begin performs the actual source attestation. */
export function createDuelRecruitTokenPlayV2(session: DuelCommandSessionV2,
  request: DuelRecruitTokenPlayRequestV2,
  services: DuelRecruitTokenPlayServicesV2): DuelRecruitTokenPlayV2 {
  const match = session.match;
  check(match.stage === 'playing', 'playing command session required');
  inspectDuelNativeCommandSessionPathV2(session, session);
  const token = request.token;
  for (const [label, value] of Object.entries({ commandId: request.commandId,
    taskId: request.taskId, paymentId: request.paymentId,
    continuationId: request.continuationId, transactionId: request.transactionId,
    sourceEffectId: token.sourceEffectId, eventId: token.eventId, tokenUID: token.tokenUID })) id(value, label);
  check(new Set([request.commandId, request.taskId, request.paymentId,
    request.continuationId, request.transactionId, token.sourceEffectId,
    token.eventId, token.tokenUID]).size === 8, 'TokenPlay IDs must be distinct');
  check(request.expectedVersion === match.stateVersion && token.kind === 'recruit' &&
    token.readied === false && token.name === 'Recruit' && token.baseMight === 1 &&
    same(token.tags, ['Recruit']) && token.controllerPlayerId === token.effectControllerPlayerId &&
    match.board.bases.some(base => base.locationId === token.locationId &&
      base.ownerPlayerId === token.controllerPlayerId), 'Recruit token selection/identity');
  check(match.frame.pendingPayment === null &&
    !session.requiredTasks.some(task => task.status !== 'completed') &&
    !session.priorityPayments.some(payment => payment.status === 'active'),
  'another payment or task owns the session');
  check(typeof services?.effectHead === 'function' && typeof services.tokenSource === 'function' &&
    typeof services.paymentSource === 'function' && typeof services.cost === 'function' &&
    typeof services.bindCost === 'function' && typeof services.closure === 'function',
  'trusted TokenPlay services required');
  const trustedRequest = Object.freeze({ ...request,
    token: Object.freeze({ ...request.token, tags: Object.freeze([...request.token.tags!]) }),
  });
  const handle = Object.freeze(Object.create(null)) as DuelRecruitTokenPlayV2;
  plays.set(handle, { request: trustedRequest, services, originalSession: session, session,
    stage: 'source-pending', busy: false, poisoned: false });
  return handle;
}

export function inspectDuelRecruitTokenPlayV2(handle: DuelRecruitTokenPlayV2):
  DuelRecruitTokenPlayInspectionV2 {
  const entry = privatePlay(handle), token = entry.request.token;
  playing(entry);
  return Object.freeze({ stage: entry.stage, commandSession: entry.session,
    tokenUID: token.tokenUID, sourceEffectId: token.sourceEffectId, eventId: token.eventId,
    commandId: entry.request.commandId, paymentId: entry.request.paymentId,
    ...(entry.resolved ? { finalResolvedCost: entry.resolved.finalResolvedCost } : {}),
    chainStatus: entry.reservation ? inspectDuelRecruitTokenOnChainV2(entry.reservation).status : 'not-created' });
}

/** CR 354: create a process-local Chain token. This is not a Core board birth or Play completion. */
export function beginDuelRecruitTokenPlayV2(handle: DuelRecruitTokenPlayV2): DuelRecruitTokenPlayProgressV2 {
  const entry = privatePlay(handle);
  return withLock(entry, () => {
    if (entry.stage === 'finalized') return result(entry, 'finalized');
    if (entry.stage === 'cancelled') return result(entry, 'blocked', 'cancelled');
    if (entry.stage === 'poisoned') return result(entry, 'blocked', 'poisoned');
    if (entry.stage !== 'source-pending') return result(entry, 'pending');
    try {
      assertHead(entry);
      entry.reservation = beginDuelRecruitTokenOnChainV2(playing(entry), entry.request.token,
        argument => guarded(entry, () => entry.services.tokenSource(argument)));
      entry.stage = 'chain';
      return result(entry, 'pending');
    } catch {
      if (entry.poisoned) entry.stage = 'poisoned';
      return result(entry, 'blocked', 'source-or-effect-head-unproved');
    }
  });
}

/** Cancel only an un-born pre-payment play. Once a payment task exists this API reports the
 * missing protected rollback primitive instead of claiming that resources were refunded. */
export function cancelDuelRecruitTokenPlayV2(handle: DuelRecruitTokenPlayV2): DuelRecruitTokenPlayProgressV2 {
  const entry = privatePlay(handle);
  return withLock(entry, () => {
    if (entry.stage === 'finalized') return result(entry, 'finalized');
    if (entry.stage === 'cancelled') return result(entry, 'blocked', 'cancelled');
    if (entry.stage === 'poisoned') return result(entry, 'blocked', 'poisoned');
    if (entry.stage === 'source-pending') {
      entry.stage = 'cancelled';
      return result(entry, 'blocked', 'cancelled');
    }
    if (entry.stage !== 'chain' && entry.stage !== 'choosing' && entry.stage !== 'cost-settled')
      return result(entry, 'blocked', 'cancel-pending-after-payment-task');
    try {
      cancelDuelRecruitTokenOnChainV2(playing(entry), entry.reservation!);
      entry.stage = 'cancelled';
      return result(entry, 'blocked', 'cancelled');
    } catch {
      return result(entry, 'blocked', 'cancel-pending-or-head-unproved');
    }
  });
}

/** CR 355-359. Selection/whole-source census precede total-cost resolution; payment is
 * always a required task, including a final cost discounted to zero. */
export function resumeDuelRecruitTokenPlayV2(handle: DuelRecruitTokenPlayV2): DuelRecruitTokenPlayProgressV2 {
  const entry = privatePlay(handle);
  return withLock(entry, () => {
    if (entry.stage === 'finalized') return result(entry, 'finalized');
    if (entry.stage === 'cancelled') return result(entry, 'blocked', 'cancelled');
    if (entry.stage === 'source-pending' || entry.stage === 'poisoned')
      return result(entry, 'blocked', 'source-or-effect-head-unproved');
    try {
      assertHead(entry);
      const match = playing(entry), request = entry.request;
      if (entry.stage === 'chain' || entry.stage === 'choosing') {
        entry.stage = 'choosing';
        if (!inspectClosure(entry, 'chain')) return result(entry, 'pending', 'selection-or-chain-unproved');
        // `entry.resolved` is the ONLY fixed-cost marker. Until a resolver succeeds, an unknown or
        // thrown coverage leaves this transaction unfixed: the trusted cost service may RETRY at
        // the same protected current head and the same effect/event/transactionIDs, and an unfixed
        // attempt never produces a task, payment or birth. Once `entry.resolved` is set, the complete
        // total cost and its proof are cached and MUST NOT be recomputed; a temporary bindCost
        // failure below reuses that exact cached result instead of resolving again.
        if (!entry.resolved) {
          const authority = guarded(entry, () => entry.services.cost({ match,
            tokenUID: request.token.tokenUID, sourceEffectId: request.token.sourceEffectId,
            transactionId: request.transactionId }));
          const resolved = resolveDuelTotalCostV2(authority, { transactionId: request.transactionId,
            subjectId: request.token.tokenUID, kind: 'card-play' });
          check(resolved.baseCost.energy === 0 && resolved.baseCost.power.length === 0,
            'Recruit printed/base cost is not zero');
          entry.resolved = resolved;
        }
        const bindingRequest = Object.freeze({ match, tokenUID: request.token.tokenUID,
          sourceEffectId: request.token.sourceEffectId, transactionId: request.transactionId,
          baseProofId: entry.resolved.baseProofId, coverageProofId: entry.resolved.coverageProofId });
        const binding = guarded(entry, () => entry.services.bindCost(bindingRequest));
        check(binding.status === 'complete' && binding.match === match &&
          binding.tokenUID === bindingRequest.tokenUID &&
          binding.sourceEffectId === bindingRequest.sourceEffectId &&
          binding.transactionId === bindingRequest.transactionId &&
          binding.baseProofId === bindingRequest.baseProofId &&
          binding.coverageProofId === bindingRequest.coverageProofId,
        'token base/complete cost coverage unproved');
        entry.stage = 'cost-settled';
      }
      if (entry.stage === 'cost-settled') {
        const token = request.token;
        const task: DuelRequiredCostTaskV2 = {
          matchId: match.matchId, expectedVersion: match.stateVersion, taskId: request.taskId,
          paymentId: request.paymentId, actor: token.controllerPlayerId,
          finalResolvedCost: entry.resolved!.finalResolvedCost,
          opaqueSource: { kind: 'effect', referenceId: token.sourceEffectId, sourceUID: token.sourceUID },
          continuationId: request.continuationId,
        };
        const issued = issueDuelRequiredCostTaskV2(entry.session, task,
          argument => guarded(entry, () => entry.services.paymentSource(argument)));
        entry.session = issued.session;
        entry.taskAuthority = issued.authority;
        entry.stage = 'task-issued';
      }
      if (entry.stage === 'task-issued') {
        const prepared = prepareDuelRequiredCostPaymentV2(entry.session, entry.taskAuthority!,
          argument => guarded(entry, () => entry.services.paymentSource(argument)));
        entry.session = prepared.session;
        entry.taskAuthority = undefined;
        entry.stage = 'payment';
        return result(entry, 'pending');
      }
      if (entry.stage === 'payment') return result(entry, 'pending');
      if (entry.stage === 'paid' || entry.stage === 'legality' || entry.stage === 'entry' ||
        entry.stage === 'finalizing') {
        if (entry.stage === 'paid') entry.stage = 'legality';
        if (!entry.legality) {
          if (!entry.services.legality) return result(entry, 'pending', 'legality-unproved');
          const legalityRequest = Object.freeze({ match, tokenUID: request.token.tokenUID,
            sourceEffectId: request.token.sourceEffectId, paymentId: request.paymentId });
          const legality = guarded(entry, () => entry.services.legality!(legalityRequest));
          check(legality.status === 'complete' && legality.match === match &&
            legality.tokenUID === legalityRequest.tokenUID &&
            legality.sourceEffectId === legalityRequest.sourceEffectId &&
            legality.paymentId === legalityRequest.paymentId,
          '358 legality is unproved');
          entry.legality = Object.freeze({ ...legality });
        }
        if (!entry.entryProof) {
          entry.stage = 'entry';
          if (!entry.services.entry) return result(entry, 'pending', 'entry-unproved');
          const token = request.token;
          const entryRequest = Object.freeze({ match, tokenUID: token.tokenUID,
            sourceEffectId: token.sourceEffectId, eventId: token.eventId,
            paymentId: request.paymentId, locationId: token.locationId });
          const proof = guarded(entry, () => entry.services.entry!(entryRequest));
          check(proof.status === 'complete' && proof.disposition === 'default-exhausted-no-effects' &&
            proof.match === match && id(proof.proofId, 'entry proof') &&
            proof.tokenUID === entryRequest.tokenUID &&
            proof.sourceEffectId === entryRequest.sourceEffectId &&
            proof.eventId === entryRequest.eventId && proof.paymentId === entryRequest.paymentId &&
            proof.locationId === entryRequest.locationId, 'exact Recruit entry closure unproved');
          entry.entryProof = Object.freeze({ ...proof });
        }
        entry.stage = 'finalizing';
        check(entry.session.requiredTasks.some(task => task.taskId === request.taskId &&
          task.paymentId === request.paymentId && task.continuationId === request.continuationId &&
          task.status === 'completed'), 'required payment has not completed');
        check(entry.session.receipts.some(receipt => receipt.actor === request.token.controllerPlayerId &&
          receipt.outcome.status === 'applied' &&
          receipt.outcome.paymentCompleted?.paymentId === request.paymentId &&
          receipt.outcome.paymentCompleted.requiredTask?.taskId === request.taskId &&
          receipt.outcome.paymentCompleted.requiredTask.continuationId === request.continuationId),
        'exact payment receipt absent');
        for (const event of ['zone-transition', 'continuous', 'effect-queue',
          'fepr-outstanding'] as const) if (!inspectClosure(entry, event))
          return result(entry, 'pending', `${event}-unproved`);
        const before = playing(entry);
        const after = finalizeDuelRecruitTokenFromChainV2(before, entry.reservation!,
          argument => guarded(entry, () => entry.services.tokenSource(argument)));
        const commits = inspectDuelNativeCommitPathV2(before, after);
        check(commits.length === 1 && commits[0]!.tokenBirths.length === 1 &&
          commits[0]!.tokenBirths[0]!.tokenUID === request.token.tokenUID &&
          commits[0]!.transitions.length === 0, 'Finalize must birth exactly one Recruit');
        entry.session = advanceDuelCommandSessionNativeV2(entry.session, after).session;
        entry.stage = 'finalized';
        return result(entry, 'finalized');
      }
      return result(entry, 'blocked', 'unknown-stage');
    } catch {
      if (entry.poisoned) entry.stage = 'poisoned';
      return result(entry, 'blocked', 'trusted-proof-or-session-unproved');
    }
  });
}

/** CR 357: only the real command session may activate Reaction resources and settle cost. */
export function applyDuelRecruitTokenResourceCommandV2(handle: DuelRecruitTokenPlayV2,
  actor: string, envelope: DuelCommandEnvelopeV2): DuelCommandResultV2 {
  const entry = privatePlay(handle);
  return withLock(entry, () => {
    check(entry.stage === 'payment' || entry.stage === 'paid', 'TokenPlay has no resource window');
    check(entry.stage !== 'paid' || entry.session.receipts.some(receipt =>
      receipt.actor === actor && receipt.commandId === envelope.commandId),
    'paid TokenPlay accepts only exact command receipt retry');
    const result = applyDuelResourceCommandV2(entry.session, actor, envelope, {
      sourceAttestor: argument => guarded(entry, () => entry.services.paymentSource(argument)),
    });
    check(!entry.poisoned || result.outcome.status !== 'applied', 'reentered payment provider');
    if (result.persistRequired) entry.session = result.session;
    if (result.outcome.status === 'applied' &&
      result.outcome.paymentCompleted?.paymentId === entry.request.paymentId &&
      result.outcome.paymentCompleted.requiredTask?.taskId === entry.request.taskId &&
      result.outcome.paymentCompleted.requiredTask.continuationId === entry.request.continuationId)
      entry.stage = 'paid';
    return result;
  });
}

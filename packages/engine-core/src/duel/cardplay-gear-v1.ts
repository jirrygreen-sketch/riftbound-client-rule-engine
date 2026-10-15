// INTERNAL, opt-in CR 354 V1 physical non-Unit Gear CardPlay coordinator.
// This module admits a physical Gear from Hand to the controller's Base through
// Chain, then delegates cost/payment to the native command ledger.  It does not
// implement Equip activation or attachment.
import {
  advanceDuelCommandSessionNativeV2, applyDuelResourceCommandV2,
  commitDuelCommandFrameV2, issueDuelRequiredCostTaskV2,
  prepareDuelRequiredCostPaymentV2, type DuelCommandEnvelopeV2,
  type DuelCommandSessionV2, type DuelRequiredCostTaskV2,
  type DuelSourceAttestorV2, inspectDuelNativeCommandSessionPathV2,
} from './canonical-session-v2.js';
import {
  assertCurrentDuelPhysicalReferenceV2, cancelDuelPhysicalGearChainToHandV1,
  finalizeDuelPhysicalGearFromChainV1, moveDuelPhysicalCardToChainV2,
  referenceDuelPhysicalCardV2, inspectDuelNativeOriginV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import { resolveDuelTotalCostV2, type DuelCostResolverAuthorityV2,
  type DuelResolvedCostV2 } from './cost-resolver-v2.js';
import { enumerateDuelPhaseSourceClosureCandidatesV2, inspectDuelPhaseSourceClosureV2,
  type DuelPhaseSourceClosureContextV2, type DuelPhaseSourceClosureJournalV2,
  type DuelPhaseSourceClosureRegistryV2 } from './phase-source-closure-v2.js';
import type { DuelOfficialProgramRegistry } from '@riftbound/card-dsl/duel';
import type { DuelRuneCost } from './resources.js';
import type { DuelPaymentSourceReference } from './canonical-session.js';

export interface DuelPrintedGearProgramRequestV1 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
}

/** A catalog-bound whole Gear source program.  Unknown or partial sources stay blocked. */
export interface DuelPrintedGearProgramBindingV1 {
  readonly status: 'known' | 'unknown';
  readonly kind: 'Gear' | 'other';
  readonly cardId: string;
  readonly programId: string;
  readonly programFingerprint: string;
}

export interface DuelPrintedGearEntryRequestV1 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly matchId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly baseLocationId: string;
  readonly programId: string;
}

export interface DuelPrintedGearEntryFactsV1 extends DuelPrintedGearEntryRequestV1 {
  readonly sourceCensus: 'complete' | 'unknown';
  readonly scopes: Readonly<Record<'play' | 'replacement' | 'static' | 'trigger' | 'pendingTasks' | 'chain',
    'clear' | 'unknown' | 'effect'>>;
  readonly resolution: 'complete' | 'unknown';
  readonly sources: readonly { readonly uid: string; readonly zoneEpoch: number;
    readonly programId: string; readonly disposition: 'known-no-effect' | 'unknown' | 'effect' }[];
}

export interface DuelPrintedGearCostBindingV1 {
  readonly matchId: string;
  readonly stateVersion: number;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly baseLocationId: string;
  readonly transactionId: string;
  readonly baseProofId: string;
  readonly coverageProofId: string;
  /** There is no optional choice in this V1 path. */
  readonly decision: 'none';
  readonly programFingerprint: string;
}

export interface DuelPrintedGearChainCostFactoryRequestV1 {
  readonly commandSession: DuelCommandSessionV2;
  readonly match: DuelCanonicalPlayingStateV2;
  readonly matchId: string;
  readonly actor: string;
  readonly cardUID: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly transactionId: string;
  readonly commandId: string;
  readonly chainVersion: number;
  readonly program: DuelPrintedGearProgramBindingV1;
}

export interface DuelPrintedGearPlayServicesV1 {
  readonly programs: DuelOfficialProgramRegistry;
  readonly program: (request: Readonly<DuelPrintedGearProgramRequestV1>) => DuelPrintedGearProgramBindingV1;
  readonly cost?: DuelCostResolverAuthorityV2;
  readonly costForChain?: (request: Readonly<DuelPrintedGearChainCostFactoryRequestV1>) => DuelCostResolverAuthorityV2;
  readonly costBinding: (request: Readonly<DuelPrintedGearCostBindingV1>) =>
    DuelPrintedGearCostBindingV1 & { readonly status: 'complete' | 'unknown' };
  readonly entry: (request: Readonly<DuelPrintedGearEntryRequestV1>) => DuelPrintedGearEntryFactsV1;
  readonly closure: (request: Readonly<DuelPrintedGearEntryRequestV1>,
    context: Readonly<DuelPhaseSourceClosureContextV2>) => {
      readonly registry: DuelPhaseSourceClosureRegistryV2;
      readonly journal: DuelPhaseSourceClosureJournalV2;
    };
  readonly sourceAttestor: DuelSourceAttestorV2;
  readonly isGearPrinting: (cardId: string) => boolean;
}

export interface DuelPrintedGearChainBeginEnvelopeV1 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly cardUID: string };
}
export interface DuelPrintedGearChainResumeEnvelopeV1 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly cardUID: string };
}
export interface DuelPrintedGearChainCancelEnvelopeV1 {
  readonly commandId: string;
  readonly expectedVersion: number;
}

export type DuelPrintedGearChainOutcomeV1 =
  | { readonly status: 'pending'; readonly cardUID: string; readonly taskId: string;
      readonly paymentId: string }
  | { readonly status: 'paid'; readonly cardUID: string }
  | { readonly status: 'applied'; readonly cardUID: string; readonly ready: true;
      readonly appliedVersion: number; readonly eventSeq: number }
  | { readonly status: 'cancelled'; readonly cardUID: string }
  | { readonly status: 'rejected'; readonly reason: 'invalid-command' | 'command-conflict' |
      'stale-version' | 'unknown-actor' | 'invalid-phase' | 'no-permission' }
  | { readonly status: 'blocked'; readonly reason: 'source-or-entry-unproved' |
      'cost-or-payment-unproved' | 'outstanding-task-or-session' | 'wrong-task-or-session' |
      'unproven-entry' | 'reentrant-command' | 'refund-unavailable' };

export interface DuelPrintedGearChainSessionV1 { readonly commandSession: DuelCommandSessionV2 }
export interface DuelPrintedGearChainResultV1 {
  readonly session: DuelPrintedGearChainSessionV1;
  readonly outcome: DuelPrintedGearChainOutcomeV1;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}
export interface DuelPrintedGearChainInspectionV1 {
  readonly phase: 'idle' | 'chain' | 'payment' | 'paid' | 'completed' | 'cancelled';
  readonly actor: string | null;
  readonly cardUID: string | null;
  readonly cardId: string | null;
  readonly sourceEpoch: number | null;
  readonly fixedCost: DuelRuneCost | null;
  readonly baseProofId: string | null;
  readonly coverageProofId: string | null;
}

type Phase = DuelPrintedGearChainInspectionV1['phase'];
type Private = {
  readonly services: DuelPrintedGearPlayServicesV1;
  readonly head: { value: DuelCanonicalPlayingStateV2 };
  origin: object | null;
  chainOrigin: DuelCommandSessionV2 | null;
  phase: Phase;
  actor: string | null;
  cardUID: string | null;
  cardId: string | null;
  sourceEpoch: number | null;
  baseLocationId: string | null;
  program: DuelPrintedGearProgramBindingV1 | null;
  fixed: DuelResolvedCostV2 | null;
  task: DuelRequiredCostTaskV2 | null;
  busy: boolean;
  poisoned: boolean;
  commandId: string | null;
  resumeCommandId: string | null;
};
const privateState = new WeakMap<object, Private>();
const spent = new WeakSet<object>();
const originClaims = new WeakMap<object, Map<string, Private>>();
const physicalChainRoundKey = (uid: string, sourceEpoch: number): string => JSON.stringify([uid, sourceEpoch]);

function fail(message: string): never { throw new TypeError(`Duel printed Gear Chain V1: ${message}`); }
function check(value: unknown, message: string): asserts value { if (!value) fail(message); }
function id(value: unknown): string { check(typeof value === 'string' && value.trim().length > 0, 'nonblank ID'); return value; }
function version(value: unknown): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'invalid version'); return value;
}
function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'plain command record');
  const proto = Object.getPrototypeOf(raw), own = Reflect.ownKeys(raw);
  check((proto === Object.prototype || proto === null) && own.length === keys.length &&
    own.every(key => typeof key === 'string' && keys.includes(key)), 'invalid command fields');
  for (const key of keys) check('value' in Object.getOwnPropertyDescriptor(raw, key)!, 'command accessor');
  return raw as Record<string, unknown>;
}
function beginEnvelope(raw: unknown): DuelPrintedGearChainBeginEnvelopeV1 {
  const e = record(raw, ['commandId', 'expectedVersion', 'command']);
  const c = record(e.command, ['cardUID']);
  return { commandId: id(e.commandId), expectedVersion: version(e.expectedVersion), command: { cardUID: id(c.cardUID) } };
}
function resumeEnvelope(raw: unknown): DuelPrintedGearChainResumeEnvelopeV1 {
  const e = record(raw, ['commandId', 'expectedVersion', 'command']);
  const c = record(e.command, ['cardUID']);
  return { commandId: id(e.commandId), expectedVersion: version(e.expectedVersion), command: { cardUID: id(c.cardUID) } };
}
function cancelEnvelope(raw: unknown): DuelPrintedGearChainCancelEnvelopeV1 {
  const e = record(raw, ['commandId', 'expectedVersion']);
  return { commandId: id(e.commandId), expectedVersion: version(e.expectedVersion) };
}
function wrap(commandSession: DuelCommandSessionV2): DuelPrintedGearChainSessionV1 {
  return Object.freeze({ commandSession });
}
function stateOf(session: DuelPrintedGearChainSessionV1): Private {
  const value = privateState.get(session as object); check(value, 'unadmitted Gear V1 session');
  check(!spent.has(session as object), 'spent Gear V1 session'); return value;
}
function successor(prior: DuelPrintedGearChainSessionV1, commandSession: DuelCommandSessionV2): DuelPrintedGearChainSessionV1 {
  const value = stateOf(prior);
  check(commandSession.match.stage === 'playing', 'Gear V1 session requires playing match');
  const next = wrap(commandSession); privateState.set(next as object, value);
  spent.add(prior as object);
  value.head.value = commandSession.match as DuelCanonicalPlayingStateV2;
  return next;
}
function result(session: DuelPrintedGearChainSessionV1, outcome: DuelPrintedGearChainOutcomeV1,
  duplicate = false, persistRequired = false): DuelPrintedGearChainResultV1 {
  return Object.freeze({ session, outcome, duplicate, persistRequired });
}
function current(session: DuelPrintedGearChainSessionV1): DuelCanonicalPlayingStateV2 {
  return stateOf(session).head.value;
}

function entryRequest(value: Private, match: DuelCanonicalPlayingStateV2): DuelPrintedGearEntryRequestV1 {
  check(value.actor && value.cardUID && value.cardId && value.sourceEpoch !== null && value.baseLocationId && value.program,
    'missing Gear entry binding');
  return Object.freeze({ match, matchId: match.matchId, stateVersion: match.stateVersion, eventSeq: match.eventSeq,
    actor: value.actor, uid: value.cardUID, cardId: value.cardId, sourceEpoch: value.sourceEpoch,
    baseLocationId: value.baseLocationId, programId: value.program.programFingerprint });
}
function verifyEntry(value: DuelPrintedGearEntryFactsV1, request: DuelPrintedGearEntryRequestV1,
  programs: DuelOfficialProgramRegistry): void {
  check(value && typeof value === 'object' && value.matchId === request.matchId && value.stateVersion === request.stateVersion &&
    value.eventSeq === request.eventSeq && value.actor === request.actor && value.uid === request.uid &&
    value.cardId === request.cardId && value.sourceEpoch === request.sourceEpoch &&
    value.baseLocationId === request.baseLocationId && value.programId === request.programId,
  'Gear entry binding mismatch');
  check(value.sourceCensus === 'complete' && value.resolution === 'complete', 'Gear entry closure is incomplete');
  const scopeNames = ['play', 'replacement', 'static', 'trigger', 'pendingTasks', 'chain'] as const;
  check(value.scopes && scopeNames.every(name => value.scopes[name] === 'clear'), 'Gear entry has unresolved scope');
  const actual = enumerateDuelPhaseSourceClosureCandidatesV2(request.match);
  check(actual.length > 0 && Array.isArray(value.sources) && value.sources.length === actual.length,
    'Gear entry source census omits a physical candidate');
  const byUID = new Map(actual.map(source => [source.uid, source]));
  check(byUID.size === actual.length, 'duplicate live Gear source candidate');
  const seen = new Set<string>();
  for (const source of value.sources) {
    check(source && typeof source.uid === 'string' && Number.isSafeInteger(source.zoneEpoch) && source.zoneEpoch >= 0 &&
      typeof source.programId === 'string' && source.disposition === 'known-no-effect' && !seen.has(source.uid),
    'Gear entry source census');
    const candidate = byUID.get(source.uid);
    check(candidate && candidate.zoneEpoch === source.zoneEpoch && candidate.cardId !== null,
      'Gear entry source is not a current physical candidate');
    check(source.uid === request.uid ? source.programId === request.programId :
      programs.getProgram(candidate.cardId)?.programId === source.programId,
    'Gear entry source program binding mismatch');
    seen.add(source.uid);
  }
  check(value.sources.some(source => source.uid === request.uid && source.zoneEpoch === request.sourceEpoch &&
    source.programId === request.programId), 'Gear entry source omits Chain Gear');
}
function verifyClosure(value: Private, request: DuelPrintedGearEntryRequestV1): void {
  const match = request.match;
  const context: DuelPhaseSourceClosureContextV2 = Object.freeze({ matchId: match.matchId,
    dataVersion: match.dataVersion, catalogDigest: match.catalogDigest, turn: match.frame.turnNumber,
    taskId: `duel-gear-v1:${match.matchId}:turn-${match.frame.turnNumber}:printed-gear:${request.uid}:${match.stateVersion}`,
    phase: 'main', event: 'chain', clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } });
  const handles = value.services.closure(request, context);
  check(!value.poisoned && handles && typeof handles === 'object', 'protected Gear closure unavailable');
  const inspection = inspectDuelPhaseSourceClosureV2(match, context, handles.registry, handles.journal);
  check(inspection.status === 'ready' && inspection.activeSources.length === 0 &&
    inspection.handlers.length === 0 && inspection.runtimeSources.length === 0,
  'protected Gear closure has unresolved effects');
  check(inspection.candidates.some(source => source.uid === request.uid && source.zone.kind === 'chain' &&
    source.zoneEpoch === request.sourceEpoch), 'protected closure lacks current Chain Gear');
}
function assertPlayable(match: DuelCanonicalPlayingStateV2, actor: string, uid: string): {
  cardId: string; sourceEpoch: number; baseLocationId: string } {
  check(match.stage === 'playing' && match.frame.phase === 'main' && match.frame.stateOpen &&
    match.frame.pendingPayment === null && match.frame.priorityPlayerId === actor && match.frame.turnPlayerId === actor,
  'requires current Main/Open Priority');
  const player = match.players.find(item => item.playerId === actor);
  const cards = player?.hand.filter(card => card.uid === uid) ?? [];
  check(player && cards.length === 1 && match.players.flatMap(item => item.hand).filter(card => card.uid === uid).length === 1,
    'Gear UID is not unique in actor Hand');
  const physical = match.physicalCardsByUID[uid];
  check(physical?.ownerPlayerId === actor && physical.cardId === cards[0]!.cardId, 'physical Gear Hand source mismatch');
  const original = match.provenance.originalPhysicalCards.find(item => item.uid === uid);
  check(original?.cardType === 'Gear' && original.cardId === cards[0]!.cardId && original.ownerPlayerId === actor,
    'original printing is not a non-Unit Gear');
  const base = match.board.bases.find(item => item.ownerPlayerId === actor);
  check(base && match.resources.bases.some(item => item.playerId === actor && item.locationId === base.locationId),
    'own Gear Base is unavailable');
  const reference = referenceDuelPhysicalCardV2(match, uid);
  assertCurrentDuelPhysicalReferenceV2(match, reference);
  return { cardId: cards[0]!.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId: base.locationId };
}
function callProgram(services: DuelPrintedGearPlayServicesV1, match: DuelCanonicalPlayingStateV2,
  actor: string, uid: string, cardId: string, sourceEpoch: number): DuelPrintedGearProgramBindingV1 {
  const output = services.program(Object.freeze({ match, matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, actor, uid, cardId, sourceEpoch }));
  check(output && output.status === 'known' && output.kind === 'Gear' && output.cardId === cardId &&
    id(output.programId) && id(output.programFingerprint), 'unknown or unsupported non-Unit Gear program');
  return output;
}
function sourceAttestor(value: Private): DuelSourceAttestorV2 {
  return request => {
    try {
      const uid = value.cardUID, cardId = value.cardId, epoch = value.sourceEpoch;
      check(uid && cardId && epoch !== null && request.match.stage === 'playing' &&
        request.match.frame.stateOpen === false && request.match.matchId === value.head.value.matchId &&
        request.actor === value.actor && request.sourceReference.kind === 'card' &&
        request.sourceReference.sourceUID === uid && request.sourceReference.referenceId === cardId,
      'payment source must be the current physical Chain Gear');
      const chain = (request.match.chainCards ?? []).filter(card => card.uid === uid);
      check(chain.length === 1 && chain[0]!.cardId === cardId && chain[0]!.controllerPlayerId === value.actor &&
        request.match.physicalCardsByUID[uid]?.zoneEpoch === epoch, 'payment source left its bound Gear Chain epoch');
      const output = value.services.sourceAttestor(request);
      check(!value.poisoned && output.mode === 'current' && output.sourceZoneEpoch === epoch &&
        output.sourceReference.sourceUID === uid, 'attestor did not prove current Gear Chain epoch');
      return output;
    } catch { throw new TypeError('Gear source attestation failed'); }
  };
}

/** Resolve the fixed printed CardPlay cost and install one required payment
 * task.  Kept as a private bridge so a transient unknown cost/binding can be
 * retried on the same closed Chain head without moving the physical card a
 * second time or issuing a second source claim. */
function issueGearPayment(session: DuelPrintedGearChainSessionV1, value: Private,
  actor: string, commandId: string, chainHead: DuelCanonicalPlayingStateV2,
  program: DuelPrintedGearProgramBindingV1): DuelPrintedGearChainResultV1 {
  const request = entryRequest(value, chainHead);
  verifyClosure(value, request);
  verifyEntry(value.services.entry(request), request, value.services.programs);
  check(!value.poisoned, 'Gear entry provider reentered');
  const transactionId = JSON.stringify(['printed-gear-chain-v1', chainHead.matchId, actor,
    commandId, value.cardUID, value.sourceEpoch]);
  let fixed = value.fixed;
  if (!fixed) {
    const authority = value.services.costForChain
      ? value.services.costForChain(Object.freeze({ commandSession: session.commandSession,
        match: chainHead, matchId: chainHead.matchId, actor, cardUID: value.cardUID!, cardId: value.cardId!,
        sourceEpoch: value.sourceEpoch!, transactionId, commandId, chainVersion: chainHead.stateVersion, program }))
      : value.services.cost;
    check(authority, 'trusted Gear Chain cost authority unavailable');
    fixed = resolveDuelTotalCostV2(authority, { transactionId, subjectId: value.cardId!, kind: 'card-play' });
    check(!value.poisoned, 'Gear cost provider reentered'); value.fixed = fixed;
  }
  const binding = Object.freeze({ matchId: chainHead.matchId, stateVersion: chainHead.stateVersion, actor,
    uid: value.cardUID!, cardId: value.cardId!, sourceEpoch: value.sourceEpoch!, baseLocationId: value.baseLocationId!,
    transactionId, baseProofId: fixed.baseProofId, coverageProofId: fixed.coverageProofId,
    decision: 'none' as const, programFingerprint: program.programFingerprint });
  const checkedBinding = value.services.costBinding(binding);
  check(!value.poisoned && checkedBinding.status === 'complete' &&
    (Object.keys(binding) as (keyof typeof binding)[]).every(key => checkedBinding[key] === binding[key]),
  'Gear cost binding drift');
  const task: DuelRequiredCostTaskV2 = { matchId: chainHead.matchId, expectedVersion: chainHead.stateVersion,
    taskId: `printed-gear-chain-v1-task:${actor}:${commandId}`,
    paymentId: `printed-gear-chain-v1-payment:${actor}:${commandId}`, actor,
    finalResolvedCost: fixed.finalResolvedCost,
    opaqueSource: { kind: 'card', referenceId: value.cardId!, sourceUID: value.cardUID! },
    continuationId: `printed-gear-chain-v1-continuation:${actor}:${commandId}` };
  const issued = issueDuelRequiredCostTaskV2(session.commandSession, task, sourceAttestor(value));
  const prepared = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, sourceAttestor(value));
  const next = successor(session, prepared.session);
  value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2;
  value.task = task; value.phase = 'payment';
  return result(next, { status: 'pending', cardUID: value.cardUID!, taskId: task.taskId,
    paymentId: task.paymentId }, false, true);
}

export function createDuelPrintedGearChainSessionV1(commandSession: DuelCommandSessionV2,
  services: DuelPrintedGearPlayServicesV1): DuelPrintedGearChainSessionV1 {
  check(commandSession && services && typeof services.program === 'function' && typeof services.entry === 'function' &&
    typeof services.closure === 'function' && typeof services.costBinding === 'function' &&
    typeof services.sourceAttestor === 'function' && typeof services.isGearPrinting === 'function' &&
    (services.cost || typeof services.costForChain === 'function'), 'trusted Gear V1 services required');
  check(commandSession.match.stage === 'playing', 'Gear V1 session requires playing match');
  inspectDuelNativeCommandSessionPathV2(commandSession, commandSession);
  const head = commandSession.match as DuelCanonicalPlayingStateV2;
  const session = wrap(commandSession);
  privateState.set(session as object, { services, head: { value: head }, origin: null, chainOrigin: null,
    phase: 'idle', actor: null, cardUID: null, cardId: null, sourceEpoch: null, baseLocationId: null,
    program: null, fixed: null, task: null, busy: false, poisoned: false, commandId: null, resumeCommandId: null });
  return session;
}

export function beginDuelPrintedGearPhysicalChainV1(session: DuelPrintedGearChainSessionV1, actor: string,
  rawEnvelope: DuelPrintedGearChainBeginEnvelopeV1): DuelPrintedGearChainResultV1 {
  const value = stateOf(session);
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true; value.poisoned = false;
  let closedSession: DuelCommandSessionV2 | null = null;
  let heldSession: DuelPrintedGearChainSessionV1 | null = null;
  let claim: { origin: object; key: string } | null = null;
  try {
    let envelope: DuelPrintedGearChainBeginEnvelopeV1;
    try { envelope = beginEnvelope(rawEnvelope); } catch { return result(session, { status: 'rejected', reason: 'invalid-command' }); }
    const match = current(session);
    check(match.roster.some(item => item.playerId === actor), 'unknown actor');
    if (envelope.expectedVersion !== match.stateVersion) return result(session, { status: 'rejected', reason: 'stale-version' });
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor && receipt.commandId === envelope.commandId))
      return result(session, { status: 'rejected', reason: 'command-conflict' });
    // A Gear has no optional CardPlay choice.  If cost/source closure was
    // temporarily unknown after Chain close, the same wrapper may retry the
    // resolver on that exact closed head.  This branch does not touch Hand,
    // Chain, epoch, or claims again.
    const retrying = value.phase === 'chain' && value.actor === actor &&
      value.cardUID === envelope.command.cardUID && value.commandId === envelope.commandId;
    if (retrying) {
      try {
        const chainHead = match;
        check(value.cardId && value.sourceEpoch !== null && value.baseLocationId && value.program,
          'missing retry Gear binding');
        const program = callProgram(value.services, chainHead, actor, value.cardUID!, value.cardId!, value.sourceEpoch!);
        check(!value.poisoned, 'Gear retry program provider reentered');
        return issueGearPayment(session, value, actor, envelope.commandId, chainHead, program);
      } catch {
        return result(session, { status: 'blocked', reason: value.poisoned ? 'reentrant-command' : 'cost-or-payment-unproved' });
      }
    }
    if (value.phase !== 'idle') return result(session, { status: 'rejected', reason: 'command-conflict' });
    if (session.commandSession.requiredTasks.some(task => task.status !== 'completed') ||
      session.commandSession.priorityPayments.some(payment => payment.status === 'active'))
      return result(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    const source = assertPlayable(match, actor, envelope.command.cardUID);
    const origin = inspectDuelNativeOriginV2(match);
    const claims = originClaims.get(origin) ?? new Map<string, Private>();
    const handRound = physicalChainRoundKey(envelope.command.cardUID, source.sourceEpoch);
    const prior = claims.get(handRound);
    if (prior) { if (prior.busy) prior.poisoned = true; return result(session, { status: 'blocked', reason: 'outstanding-task-or-session' }); }
    claims.set(handRound, value); originClaims.set(origin, claims); value.origin = origin;
    claim = { origin, key: handRound };
    const program = callProgram(value.services, match, actor, envelope.command.cardUID, source.cardId, source.sourceEpoch);
    check(!value.poisoned, 'Gear program provider reentered');
    const moved = moveDuelPhysicalCardToChainV2(match, referenceDuelPhysicalCardV2(match, envelope.command.cardUID), actor);
    const movedSession = advanceDuelCommandSessionNativeV2(session.commandSession, moved).session;
    const closed = commitDuelCommandFrameV2(movedSession, { ...moved.frame, stateOpen: false }, (before, proposed) => {
      check(before.frame.stateOpen && !proposed.stateOpen && proposed.pendingPayment === null &&
        proposed.priorityPlayerId === actor, 'Gear Chain close frame mismatch');
    }).session;
    closedSession = closed; value.chainOrigin = closed;
    value.actor = actor; value.cardUID = envelope.command.cardUID; value.cardId = source.cardId;
    const chainHead = closed.match as DuelCanonicalPlayingStateV2;
    const chainEpoch = chainHead.physicalCardsByUID[envelope.command.cardUID]!.zoneEpoch;
    const chainRound = physicalChainRoundKey(envelope.command.cardUID, chainEpoch);
    claims.set(chainRound, value); claim.key = chainRound;
    value.sourceEpoch = chainEpoch; value.baseLocationId = source.baseLocationId; value.program = program;
    value.commandId = envelope.commandId; value.head.value = chainHead; value.phase = 'chain';
    heldSession = successor(session, closed);
    return issueGearPayment(heldSession, value, actor, envelope.commandId, chainHead, program);
  } catch {
    if (heldSession || closedSession) {
      const next = heldSession ?? successor(session, closedSession!);
      value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2;
      if (value.phase === 'idle') value.phase = 'chain';
      return result(next, { status: 'blocked', reason: value.poisoned ? 'reentrant-command' : 'cost-or-payment-unproved' }, false, true);
    }
    if (claim) { originClaims.get(claim.origin)?.delete(claim.key); value.origin = null; }
    return result(session, { status: 'blocked' as const,
      reason: value.poisoned ? 'reentrant-command' as const : 'source-or-entry-unproved' as const });
  } finally { value.busy = false; }
}

export function applyDuelPrintedGearPhysicalChainResourceV1(session: DuelPrintedGearChainSessionV1,
  actor: string, envelope: DuelCommandEnvelopeV2): DuelPrintedGearChainResultV1 {
  const value = stateOf(session);
  if (value.phase !== 'payment' || value.actor !== actor)
    return result(session, { status: 'blocked', reason: 'wrong-task-or-session' });
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true; value.poisoned = false;
  try {
    check(value.chainOrigin, 'missing Gear Chain lineage');
    inspectDuelNativeCommandSessionPathV2(value.chainOrigin, session.commandSession);
    const applied = applyDuelResourceCommandV2(session.commandSession, actor, envelope,
      { sourceAttestor: sourceAttestor(value) });
    if (!applied.persistRequired)
      return result(session, applied.outcome.status === 'applied' && envelope.command.type === 'pay-pending'
        ? { status: 'paid', cardUID: value.cardUID! } : { status: 'blocked', reason: 'cost-or-payment-unproved' }, applied.duplicate);
    const next = successor(session, applied.session); value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2;
    if (applied.outcome.status !== 'applied') return result(next, { status: 'blocked', reason: 'cost-or-payment-unproved' });
    if (envelope.command.type !== 'pay-pending')
      return result(next, { status: 'pending', cardUID: value.cardUID!, taskId: value.task!.taskId, paymentId: value.task!.paymentId }, false, true);
    value.phase = 'paid'; return result(next, { status: 'paid', cardUID: value.cardUID! }, false, true);
  } catch { return result(session, { status: 'blocked', reason: 'cost-or-payment-unproved' }); }
  finally { value.busy = false; }
}

export function resumeDuelPrintedGearPhysicalChainV1(session: DuelPrintedGearChainSessionV1, actor: string,
  rawEnvelope: DuelPrintedGearChainResumeEnvelopeV1): DuelPrintedGearChainResultV1 {
  const value = stateOf(session);
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true; value.poisoned = false;
  try {
    const envelope = resumeEnvelope(rawEnvelope), match = current(session);
    if (value.phase === 'completed' && value.resumeCommandId === envelope.commandId && value.actor === actor &&
      value.cardUID === envelope.command.cardUID)
      return result(session, { status: 'applied', cardUID: value.cardUID!, ready: true,
        appliedVersion: match.stateVersion, eventSeq: match.eventSeq }, true);
    if (value.phase !== 'paid' || value.actor !== actor || value.cardUID !== envelope.command.cardUID)
      return result(session, { status: 'blocked', reason: 'wrong-task-or-session' });
    if (envelope.expectedVersion !== match.stateVersion) return result(session, { status: 'rejected', reason: 'stale-version' });
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor && receipt.commandId === envelope.commandId))
      return result(session, { status: 'rejected', reason: 'command-conflict' });
    check(match.frame.pendingPayment === null && !session.commandSession.requiredTasks.some(task => task.status === 'active'),
      'Gear payment is not settled');
    check(value.chainOrigin, 'missing Gear Chain lineage'); inspectDuelNativeCommandSessionPathV2(value.chainOrigin, session.commandSession);
    const source = (match.chainCards ?? []).find(card => card.uid === value.cardUID);
    check(source && source.cardId === value.cardId && source.controllerPlayerId === actor, 'Gear Chain source disappeared');
    check(match.physicalCardsByUID[value.cardUID!]?.zoneEpoch === value.sourceEpoch, 'Gear Chain epoch changed unexpectedly');
    const program = callProgram(value.services, match, actor, value.cardUID!, value.cardId!, value.sourceEpoch!);
    check(!value.poisoned && value.program?.programFingerprint === program.programFingerprint, 'Gear program drift during payment');
    const request = entryRequest(value, match); verifyClosure(value, request);
    verifyEntry(value.services.entry(request), request, value.services.programs);
    check(!value.poisoned, 'Gear entry provider reentered');
    const born = finalizeDuelPhysicalGearFromChainV1(match, value.cardUID!, actor, value.baseLocationId!,
      cardId => { const proved = value.services.isGearPrinting(cardId); check(!value.poisoned, 'Gear printing provider reentered'); return proved; });
    const opened = advanceDuelCommandSessionNativeV2(session.commandSession, born).session;
    const next = successor(session, opened); value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2;
    value.phase = 'completed'; value.resumeCommandId = envelope.commandId;
    return result(next, { status: 'applied', cardUID: value.cardUID!, ready: true,
      appliedVersion: next.commandSession.match.stateVersion, eventSeq: next.commandSession.match.eventSeq }, false, true);
  } catch { return result(session, { status: 'blocked', reason: 'unproven-entry' }); }
  finally { value.busy = false; }
}

export function cancelDuelPrintedGearPhysicalChainV1(session: DuelPrintedGearChainSessionV1, actor: string,
  rawEnvelope: DuelPrintedGearChainCancelEnvelopeV1): DuelPrintedGearChainResultV1 {
  const value = stateOf(session);
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true;
  try {
    const envelope = cancelEnvelope(rawEnvelope), match = current(session);
    if (value.phase === 'cancelled' && value.resumeCommandId === envelope.commandId && value.actor === actor)
      return result(session, { status: 'cancelled', cardUID: value.cardUID! }, true);
    if (value.phase === 'payment' || value.phase === 'paid') return result(session, { status: 'blocked', reason: 'refund-unavailable' });
    if (value.phase !== 'chain' || value.actor !== actor) return result(session, { status: 'blocked', reason: 'wrong-task-or-session' });
    if (envelope.expectedVersion !== match.stateVersion) return result(session, { status: 'rejected', reason: 'stale-version' });
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor && receipt.commandId === envelope.commandId))
      return result(session, { status: 'rejected', reason: 'command-conflict' });
    const returned = cancelDuelPhysicalGearChainToHandV1(match, value.cardUID!, actor);
    const advanced = advanceDuelCommandSessionNativeV2(session.commandSession, returned).session;
    const next = successor(session, advanced); value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2;
    value.phase = 'cancelled'; value.resumeCommandId = envelope.commandId;
    if (value.origin && value.cardUID && value.sourceEpoch !== null)
      originClaims.get(value.origin)?.set(physicalChainRoundKey(value.cardUID, value.sourceEpoch), value);
    return result(next, { status: 'cancelled', cardUID: value.cardUID! }, false, true);
  } catch { return result(session, { status: 'blocked', reason: 'source-or-entry-unproved' }); }
  finally { value.busy = false; }
}

export function inspectDuelPrintedGearPhysicalChainV1(session: DuelPrintedGearChainSessionV1): DuelPrintedGearChainInspectionV1 {
  const value = stateOf(session), match = current(session);
  return Object.freeze({ phase: value.phase, actor: value.actor, cardUID: value.cardUID, cardId: value.cardId,
    sourceEpoch: value.sourceEpoch, fixedCost: value.fixed?.finalResolvedCost ?? null,
    baseProofId: value.fixed?.baseProofId ?? null, coverageProofId: value.fixed?.coverageProofId ?? null });
}

// Naming aliases used by parent adapters.  All aliases retain the explicit
// opt-in V1 session and never route through Equip/attachment activation.
export const createDuelGearCardPlaySessionV1 = createDuelPrintedGearChainSessionV1;
export const beginDuelGearCardPlayV1 = beginDuelPrintedGearPhysicalChainV1;
export const applyDuelGearCardPlayResourceV1 = applyDuelPrintedGearPhysicalChainResourceV1;
export const finishDuelGearCardPlayV1 = resumeDuelPrintedGearPhysicalChainV1;
export const cancelDuelGearCardPlayV1 = cancelDuelPrintedGearPhysicalChainV1;
export const startDuelPrintedGearChainV1 = beginDuelPrintedGearPhysicalChainV1;


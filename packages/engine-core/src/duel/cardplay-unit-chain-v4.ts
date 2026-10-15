// INTERNAL, opt-in CR 354 V4 physical Unit Chain coordinator.
// The command session remains authoritative.  This module only binds the exact
// Chain head, choice receipt, fixed cost task and trusted Core finalize bridge.
import {
  advanceDuelCommandSessionNativeV2,
  commitDuelCommandFrameV2, type DuelCommandEnvelopeV2,
  type DuelCommandSessionV2, type DuelRequiredCostTaskV2,
  type DuelSourceAttestorV2,
  type DuelSourceAttestationRequestV2,
  inspectDuelNativeCommandSessionPathV2,
} from './canonical-session-v2.js';
import {
  applyDuelPrintedUnitResourceCommandV4 as applyDuelPrintedUnitResourceCommandV4Core,
  issueDuelPrintedUnitRequiredCostTaskV4,
  prepareDuelPrintedUnitRequiredCostPaymentV4,
} from './command-executor-v2.js';
import {
  assertCurrentDuelPhysicalReferenceV2, cancelDuelPhysicalUnitChainToHandV2,
  finalizeDuelPhysicalUnitFromChainV2, moveDuelPhysicalCardToChainV2,
  referenceDuelPhysicalCardV2, inspectDuelNativeOriginV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import { resolveDuelTotalCostV2, type DuelCostResolverAuthorityV2,
  type DuelResolvedCostV2 } from './cost-resolver-v2.js';
import { enumerateDuelPhaseSourceClosureCandidatesV2, inspectDuelPhaseSourceClosureV2,
  type DuelPhaseSourceClosureRegistryV2, type DuelPhaseSourceClosureJournalV2,
  type DuelPhaseSourceClosureContextV2 } from './phase-source-closure-v2.js';
import {
  createDuelOptionalPlayChoiceAuthorityV2, type DuelOptionalPlayChoiceAuthorityV2,
  type DuelOptionalPlayChoiceServicesV2, type DuelOptionalPlayReceiptDataV2,
  type DuelOptionalPlayReceiptV2, type DuelOptionalPlayPromptV2,
} from './optional-play-choice-v2.js';
import type { DuelOfficialProgramRegistry } from '@riftbound/card-dsl/duel';
import type { DuelRuneCost } from './resources.js';

export interface DuelPrintedUnitAttemptCapabilityV4 {
  readonly _duelPrintedUnitAttemptCapabilityV4: unique symbol;
}
export interface DuelPrintedUnitAttemptInspectionV4 {
  readonly matchId: string;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly handEpoch: number;
  readonly chainEpoch: number;
  readonly closedHead: DuelCanonicalPlayingStateV2;
}
export interface DuelPrintedUnitChoiceProofV4 {
  readonly _duelPrintedUnitChoiceProofV4: unique symbol;
}
export interface DuelPrintedUnitChoiceProofInspectionV4 extends DuelOptionalPlayReceiptDataV2 {
  readonly receipt: DuelOptionalPlayReceiptV2;
  readonly closedHead: DuelCanonicalPlayingStateV2;
}

export interface DuelPrintedUnitProgramRequestV4 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
}
/** A whole source program. Unknown or non-Accelerate programs stay blocked. */
export interface DuelPrintedUnitProgramBindingV4 {
  readonly status: 'known' | 'unknown';
  readonly kind: 'Unit' | 'other';
  readonly cardId: string;
  readonly programId: string;
  readonly programFingerprint: string;
  readonly optionalCost: 'accelerate' | 'none' | 'unknown';
}
export interface DuelPrintedUnitEntryRequestV4 {
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
export interface DuelPrintedUnitEntryFactsV4 extends DuelPrintedUnitEntryRequestV4 {
  readonly sourceCensus: 'complete' | 'unknown';
  readonly scopes: Readonly<Record<'play' | 'replacement' | 'static' | 'trigger' | 'pendingTasks' | 'chain',
    'clear' | 'unknown' | 'effect'>>;
  readonly resolution: 'complete' | 'unknown';
  readonly sources: readonly { readonly uid: string; readonly zoneEpoch: number;
    readonly programId: string; readonly disposition: 'known-no-effect' | 'unknown' | 'effect' }[];
}
export interface DuelPrintedUnitCostBindingV4 {
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
  readonly decision: 'pay' | 'decline';
  readonly programFingerprint: string;
}
/** Trusted server composition hook for a genuine closed Chain head. This callback
 * is internal and receives the process-local choice receipt and inspection method,
 * so a decision scalar alone cannot stand in for the original choice evidence. */
export interface DuelPrintedUnitChainCostFactoryRequestV4 {
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
  readonly program: DuelPrintedUnitProgramBindingV4;
  readonly choiceReceipt: DuelOptionalPlayReceiptV2;
  readonly inspectChoiceReceipt: () => DuelOptionalPlayReceiptDataV2;
  /** Opaque proof issued by this V4 authority after the exact answer. */
  readonly choiceProof?: DuelPrintedUnitChoiceProofV4;
  /** Opaque proof issued by this V4 lifecycle after the exact Chain close. */
  readonly attemptProof?: DuelPrintedUnitAttemptCapabilityV4;
}
export interface DuelPrintedUnitSourceAttestationRequestV4 extends DuelSourceAttestationRequestV2 {
  readonly attemptProof: DuelPrintedUnitAttemptCapabilityV4;
  readonly choiceProof: DuelPrintedUnitChoiceProofV4;
  readonly phase: 'issue' | 'prepare' | 'pay';
}
export interface DuelPrintedUnitPlayServicesV4 {
  readonly programs: DuelOfficialProgramRegistry;
  readonly program: (request: Readonly<DuelPrintedUnitProgramRequestV4>) => DuelPrintedUnitProgramBindingV4;
  readonly cost?: DuelCostResolverAuthorityV2;
  readonly costForChain?: (request: Readonly<DuelPrintedUnitChainCostFactoryRequestV4>) => DuelCostResolverAuthorityV2;
  readonly costBinding: (request: Readonly<DuelPrintedUnitCostBindingV4>) =>
    DuelPrintedUnitCostBindingV4 & { readonly status: 'complete' | 'unknown' };
  readonly entry: (request: Readonly<DuelPrintedUnitEntryRequestV4>) => DuelPrintedUnitEntryFactsV4;
  readonly closure: (request: Readonly<DuelPrintedUnitEntryRequestV4>,
    context: Readonly<DuelPhaseSourceClosureContextV2>) => {
      readonly registry: DuelPhaseSourceClosureRegistryV2;
      readonly journal: DuelPhaseSourceClosureJournalV2;
    };
  readonly sourceAttestor: DuelSourceAttestorV2;
  readonly sourceAttestorV4?: (request: DuelPrintedUnitSourceAttestationRequestV4) => ReturnType<DuelSourceAttestorV2>;
  readonly isUnitPrinting: (cardId: string) => boolean;
  readonly choice: Omit<DuelOptionalPlayChoiceServicesV2, 'readHead'> & {
    /** V4-only source route carrying a Core attempt inspector. */
    readonly readSourceV4?: (match: DuelCanonicalPlayingStateV2, actor: string, uid: string,
      attemptProof: DuelPrintedUnitAttemptCapabilityV4) => ReturnType<DuelOptionalPlayChoiceServicesV2['readSource']>;
  };
}
export interface DuelPrintedUnitChainBeginEnvelopeV4 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly cardUID: string };
}
export interface DuelPrintedUnitChainAnswerEnvelopeV4 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly choiceId: string; readonly optionId: string };
}
export interface DuelPrintedUnitChainResumeEnvelopeV4 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly cardUID: string };
}
export interface DuelPrintedUnitChainCancelEnvelopeV4 {
  readonly commandId: string;
  readonly expectedVersion: number;
}
export type DuelPrintedUnitChainOutcomeV4 =
  | { readonly status: 'choice'; readonly prompt: DuelOptionalPlayPromptV2; readonly cardUID: string;
      readonly chainVersion: number; readonly eventSeq: number }
  | { readonly status: 'pending'; readonly cardUID: string; readonly taskId: string;
      readonly paymentId: string; readonly decision: 'pay' | 'decline' }
  | { readonly status: 'paid'; readonly cardUID: string; readonly decision: 'pay' | 'decline' }
  | { readonly status: 'applied'; readonly cardUID: string; readonly ready: boolean;
      readonly appliedVersion: number; readonly eventSeq: number }
  | { readonly status: 'cancelled'; readonly cardUID: string }
  | { readonly status: 'rejected'; readonly reason: 'invalid-command' | 'command-conflict' |
      'stale-version' | 'unknown-actor' | 'invalid-phase' | 'no-permission' }
  | { readonly status: 'blocked'; readonly reason: 'source-or-entry-unproved' |
      'optional-choice-unproved' | 'cost-or-payment-unproved' | 'outstanding-task-or-session' |
      'wrong-task-or-session' | 'unproven-entry' | 'reentrant-command' | 'refund-unavailable' };
export interface DuelPrintedUnitChainSessionV4 {
  readonly commandSession: DuelCommandSessionV2;
}
export interface DuelPrintedUnitChainResultV4 {
  readonly session: DuelPrintedUnitChainSessionV4;
  readonly outcome: DuelPrintedUnitChainOutcomeV4;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}
export interface DuelPrintedUnitChainInspectionV4 {
  readonly phase: 'idle' | 'choice' | 'payment' | 'paid' | 'completed';
  readonly actor: string | null;
  readonly cardUID: string | null;
  readonly cardId: string | null;
  readonly sourceEpoch: number | null;
  readonly decision: 'pay' | 'decline' | null;
  readonly fixedCost: DuelRuneCost | null;
  readonly baseProofId: string | null;
  readonly coverageProofId: string | null;
  readonly chainVersion: number | null;
}

type Phase = 'idle' | 'choice' | 'payment' | 'paid' | 'completed';
type Private = {
  readonly services: DuelPrintedUnitPlayServicesV4;
  readonly head: { value: DuelCanonicalPlayingStateV2 };
  readonly choice: DuelOptionalPlayChoiceAuthorityV2;
  origin: object | null;
  chainOrigin: DuelCommandSessionV2 | null;
  attempt: DuelPrintedUnitAttemptCapabilityV4 | null;
  choiceProof: DuelPrintedUnitChoiceProofV4 | null;
  handEpoch: number | null;
  phase: Phase;
  actor: string | null;
  cardUID: string | null;
  cardId: string | null;
  sourceEpoch: number | null;
  baseLocationId: string | null;
  program: DuelPrintedUnitProgramBindingV4 | null;
  receipt: DuelOptionalPlayReceiptV2 | null;
  receiptData: DuelOptionalPlayReceiptDataV2 | null;
  decision: 'pay' | 'decline' | null;
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
type AttemptRecordV4 = { readonly initialSession: DuelCommandSessionV2; readonly closedSession: DuelCommandSessionV2;
  readonly actor: string; readonly uid: string; readonly cardId: string; readonly handEpoch: number; readonly chainEpoch: number };
const attemptProofs = new WeakMap<object, AttemptRecordV4>();
const attemptIssuerKey = Symbol('DuelPrintedUnitAttemptIssuerV4');
type ChoiceRecordV4 = { readonly attempt: DuelPrintedUnitAttemptCapabilityV4; readonly match: DuelCanonicalPlayingStateV2;
  readonly session: DuelCommandSessionV2; readonly receipt: DuelOptionalPlayReceiptV2; readonly data: DuelOptionalPlayReceiptDataV2 };
const choiceProofs = new WeakMap<object, ChoiceRecordV4>();
const choiceIssuerKey = Symbol('DuelPrintedUnitChoiceIssuerV4');
const physicalChainRoundKey = (uid: string, sourceEpoch: number): string =>
  JSON.stringify([uid, sourceEpoch]);

function fail(message: string): never { throw new TypeError(`Duel printed Unit Chain V4: ${message}`); }
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
function attemptRecord(capability: unknown): AttemptRecordV4 {
  check(capability !== null && typeof capability === 'object', 'attempt capability');
  const value = attemptProofs.get(capability as object); check(value, 'foreign or stale attempt capability'); return value;
}
function assertAttemptHead(record: AttemptRecordV4, match: DuelCanonicalPlayingStateV2,
  actor: string, uid: string, cardId: string, sourceEpoch: number): void {
  check(match === record.closedSession.match, 'attempt head is not the issued closed head');
  check(match.stage === 'playing' && match.frame.phase === 'main' && !match.frame.stateOpen &&
    match.frame.pendingPayment === null, 'attempt phase/head');
  check(actor === record.actor && uid === record.uid && cardId === record.cardId && sourceEpoch === record.chainEpoch,
    'attempt source binding');
  const chain = (match.chainCards ?? []).filter(card => card.uid === uid);
  const physical = match.physicalCardsByUID[uid];
  check(chain.length === 1 && chain[0]!.cardId === cardId && chain[0]!.ownerPlayerId === actor &&
    chain[0]!.controllerPlayerId === actor && physical?.zoneEpoch === sourceEpoch, 'attempt physical Chain source');
}
export function issueDuelPrintedUnitAttemptCapabilityV4(input: Readonly<{
  readonly initialSession: DuelCommandSessionV2; readonly closedSession: DuelCommandSessionV2; readonly actor: string;
  readonly uid: string; readonly cardId: string; readonly handEpoch: number; readonly chainEpoch: number;
}>, issuerKey?: symbol): DuelPrintedUnitAttemptCapabilityV4 {
  check(issuerKey === attemptIssuerKey, 'attempt capability is issued only by the V4 lifecycle');
  check(input && typeof input === 'object', 'attempt input');
  const initial = input.initialSession, closed = input.closedSession;
  check(initial && closed && initial.match.stage === 'playing' && closed.match.stage === 'playing', 'attempt sessions');
  inspectDuelNativeCommandSessionPathV2(initial, closed);
  check(initial.match.frame.phase === 'main' && initial.match.frame.stateOpen && initial.match.frame.pendingPayment === null &&
    closed.match.frame.phase === 'main' && !closed.match.frame.stateOpen && closed.match.frame.pendingPayment === null,
    'attempt open/closed Main phases');
  const actor = id(input.actor), uid = id(input.uid), cardId = id(input.cardId);
  const handEpoch = version(input.handEpoch), chainEpoch = version(input.chainEpoch); check(chainEpoch > handEpoch, 'attempt epoch did not advance');
  const hand = initial.match.players.find(player => player.playerId === actor)?.hand.filter(card => card.uid === uid) ?? [];
  const physical = initial.match.physicalCardsByUID[uid];
  check(hand.length === 1 && hand[0]!.cardId === cardId && physical?.cardId === cardId && physical.ownerPlayerId === actor && physical.zoneEpoch === handEpoch,
    'attempt source is not the original Hand card');
  const recordValue = { initialSession: initial, closedSession: closed, actor, uid, cardId, handEpoch, chainEpoch };
  assertAttemptHead(recordValue, closed.match as DuelCanonicalPlayingStateV2, actor, uid, cardId, chainEpoch);
  const token = Object.freeze(Object.create(null)) as DuelPrintedUnitAttemptCapabilityV4;
  attemptProofs.set(token as object, Object.freeze(recordValue)); return token;
}
export function inspectDuelPrintedUnitAttemptCapabilityV4(capability: unknown, expected: Readonly<{
  readonly match: DuelCanonicalPlayingStateV2; readonly actor: string; readonly uid: string; readonly cardId: string; readonly sourceEpoch: number;
}>): DuelPrintedUnitAttemptInspectionV4 {
  const recordValue = attemptRecord(capability); assertAttemptHead(recordValue, expected.match, expected.actor, expected.uid, expected.cardId, expected.sourceEpoch);
  return Object.freeze({ matchId: recordValue.closedSession.match.matchId, actor: recordValue.actor, uid: recordValue.uid, cardId: recordValue.cardId,
    handEpoch: recordValue.handEpoch, chainEpoch: recordValue.chainEpoch, closedHead: recordValue.closedSession.match as DuelCanonicalPlayingStateV2 });
}
export function issueDuelPrintedUnitChoiceProofV4(input: Readonly<{
  readonly attempt: DuelPrintedUnitAttemptCapabilityV4; readonly session: DuelCommandSessionV2;
  readonly receipt: DuelOptionalPlayReceiptV2; readonly data: DuelOptionalPlayReceiptDataV2;
}>, issuerKey?: symbol): DuelPrintedUnitChoiceProofV4 {
  check(issuerKey === choiceIssuerKey, 'choice proof is issued only by the V4 lifecycle');
  const attempt = attemptRecord(input.attempt);
  check(input.session === attempt.closedSession && input.session.match === attempt.closedSession.match, 'choice session binding');
  const data = input.data;
  check(data.matchId === attempt.closedSession.match.matchId && data.actor === attempt.actor && data.uid === attempt.uid &&
    data.cardId === attempt.cardId && data.sourceEpoch === attempt.chainEpoch && data.decision === input.receipt.decision,
    'choice proof binding');
  const token = Object.freeze(Object.create(null)) as DuelPrintedUnitChoiceProofV4;
  choiceProofs.set(token as object, Object.freeze({ attempt: input.attempt, match: input.session.match as DuelCanonicalPlayingStateV2,
    session: input.session, receipt: input.receipt, data })); return token;
}
export function inspectDuelPrintedUnitChoiceProofV4(proof: unknown, expected: Readonly<{
  readonly match: DuelCanonicalPlayingStateV2; readonly actor: string; readonly uid: string; readonly cardId: string; readonly sourceEpoch: number;
}>): DuelPrintedUnitChoiceProofInspectionV4 {
  check(proof !== null && typeof proof === 'object', 'choice proof'); const recordValue = choiceProofs.get(proof as object); check(recordValue, 'foreign or stale choice proof');
  inspectDuelPrintedUnitAttemptCapabilityV4(recordValue.attempt, { match: expected.match, actor: expected.actor, uid: expected.uid, cardId: expected.cardId, sourceEpoch: expected.sourceEpoch });
  check(recordValue.match === expected.match && recordValue.data.actor === expected.actor && recordValue.data.uid === expected.uid &&
    recordValue.data.cardId === expected.cardId && recordValue.data.sourceEpoch === expected.sourceEpoch, 'choice proof head binding');
  return Object.freeze({ ...recordValue.data, receipt: recordValue.receipt, closedHead: recordValue.match });
}
export function hasDuelPrintedUnitAttemptCapabilityV4(capability: unknown): boolean {
  return capability !== null && typeof capability === 'object' && attemptProofs.has(capability as object);
}
function beginEnvelope(raw: unknown): DuelPrintedUnitChainBeginEnvelopeV4 {
  const e = record(raw, ['commandId', 'expectedVersion', 'command']);
  const c = record(e.command, ['cardUID']);
  return { commandId: id(e.commandId), expectedVersion: version(e.expectedVersion), command: { cardUID: id(c.cardUID) } };
}
function answerEnvelope(raw: unknown): DuelPrintedUnitChainAnswerEnvelopeV4 {
  const e = record(raw, ['commandId', 'expectedVersion', 'command']);
  const c = record(e.command, ['choiceId', 'optionId']);
  return { commandId: id(e.commandId), expectedVersion: version(e.expectedVersion),
    command: { choiceId: id(c.choiceId), optionId: id(c.optionId) } };
}
function resumeEnvelope(raw: unknown): DuelPrintedUnitChainResumeEnvelopeV4 {
  const e = record(raw, ['commandId', 'expectedVersion', 'command']);
  const c = record(e.command, ['cardUID']);
  return { commandId: id(e.commandId), expectedVersion: version(e.expectedVersion), command: { cardUID: id(c.cardUID) } };
}
function cancelEnvelope(raw: unknown): DuelPrintedUnitChainCancelEnvelopeV4 {
  const e = record(raw, ['commandId', 'expectedVersion']);
  return { commandId: id(e.commandId), expectedVersion: version(e.expectedVersion) };
}
function wrap(commandSession: DuelCommandSessionV2): DuelPrintedUnitChainSessionV4 {
  return Object.freeze({ commandSession });
}
function stateOf(session: DuelPrintedUnitChainSessionV4): Private {
  const value = privateState.get(session as object); check(value, 'unadmitted V4 session');
  check(!spent.has(session as object), 'spent V4 session'); return value;
}
function successor(prior: DuelPrintedUnitChainSessionV4, commandSession: DuelCommandSessionV2): DuelPrintedUnitChainSessionV4 {
  const value = stateOf(prior);
  check(commandSession.match.stage === 'playing', 'V4 session requires playing match');
  const next = wrap(commandSession); privateState.set(next as object, value);
  spent.add(prior as object);
  value.head.value = commandSession.match as DuelCanonicalPlayingStateV2; return next;
}
function result(session: DuelPrintedUnitChainSessionV4, outcome: DuelPrintedUnitChainOutcomeV4,
  duplicate = false, persistRequired = false): DuelPrintedUnitChainResultV4 {
  return Object.freeze({ session, outcome, duplicate, persistRequired });
}
function current(session: DuelPrintedUnitChainSessionV4): DuelCanonicalPlayingStateV2 {
  const value = stateOf(session); return value.head.value;
}
function entryRequest(value: Private, match: DuelCanonicalPlayingStateV2): DuelPrintedUnitEntryRequestV4 {
  check(value.actor && value.cardUID && value.cardId && value.sourceEpoch !== null && value.baseLocationId && value.program,
    'missing Unit entry binding');
  return Object.freeze({ match, matchId: match.matchId, stateVersion: match.stateVersion, eventSeq: match.eventSeq,
    actor: value.actor, uid: value.cardUID, cardId: value.cardId, sourceEpoch: value.sourceEpoch,
    baseLocationId: value.baseLocationId, programId: value.program.programFingerprint });
}
function verifyEntry(value: DuelPrintedUnitEntryFactsV4, request: DuelPrintedUnitEntryRequestV4,
  programs: DuelOfficialProgramRegistry): void {
  check(value && typeof value === 'object' && value.matchId === request.matchId && value.stateVersion === request.stateVersion &&
    value.eventSeq === request.eventSeq && value.actor === request.actor && value.uid === request.uid &&
    value.cardId === request.cardId && value.sourceEpoch === request.sourceEpoch &&
    value.baseLocationId === request.baseLocationId && value.programId === request.programId,
  'entry binding mismatch');
  check(value.sourceCensus === 'complete' && value.resolution === 'complete', 'entry closure is incomplete');
  const scopeNames = ['play', 'replacement', 'static', 'trigger', 'pendingTasks', 'chain'] as const;
  check(value.scopes && scopeNames.every(name => value.scopes[name] === 'clear'), 'entry has unresolved scope');
  const actual = enumerateDuelPhaseSourceClosureCandidatesV2(request.match);
  check(actual.length > 0 && Array.isArray(value.sources) && value.sources.length === actual.length,
    'entry source census omits a physical candidate');
  const byUID = new Map(actual.map(source => [source.uid, source]));
  check(byUID.size === actual.length, 'duplicate live source candidate');
  const seen = new Set<string>();
  for (const source of value.sources) {
    check(source && typeof source.uid === 'string' && Number.isSafeInteger(source.zoneEpoch) &&
      source.zoneEpoch >= 0 && typeof source.programId === 'string' &&
      source.disposition === 'known-no-effect' && !seen.has(source.uid), 'entry source census');
    const candidate = byUID.get(source.uid);
    check(candidate && candidate.zoneEpoch === source.zoneEpoch && candidate.cardId !== null,
      'entry source is not a current physical candidate');
    check(source.uid === request.uid ? source.programId === request.programId :
      programs.getProgram(candidate.cardId)?.programId === source.programId,
    'entry source program binding mismatch');
    seen.add(source.uid);
  }
  check(value.sources.some(source => source.uid === request.uid && source.zoneEpoch === request.sourceEpoch &&
    source.programId === request.programId), 'entry source omits Chain Unit');
}
function verifyClosure(value: Private, request: DuelPrintedUnitEntryRequestV4): void {
  const match = request.match;
  const context: DuelPhaseSourceClosureContextV2 = Object.freeze({ matchId: match.matchId,
    dataVersion: match.dataVersion, catalogDigest: match.catalogDigest, turn: match.frame.turnNumber,
    taskId: `duel-v4:${match.matchId}:turn-${match.frame.turnNumber}:printed-unit:${request.uid}:${match.stateVersion}`,
    phase: 'main', event: 'chain',
    clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } });
  const handles = value.services.closure(request, context);
  check(!value.poisoned && handles && typeof handles === 'object', 'protected closure unavailable');
  const inspection = inspectDuelPhaseSourceClosureV2(match, context, handles.registry, handles.journal);
  check(inspection.status === 'ready' && inspection.activeSources.length === 0 &&
    inspection.handlers.length === 0 && inspection.runtimeSources.length === 0,
  'protected closure has unresolved effects');
  check(inspection.candidates.some(source => source.uid === request.uid &&
    source.zone.kind === 'chain' && source.zoneEpoch === request.sourceEpoch),
  'protected closure lacks current Chain Unit');
}
function assertPlayable(value: Private, match: DuelCanonicalPlayingStateV2, actor: string, uid: string): {
  cardId: string; sourceEpoch: number; baseLocationId: string } {
  check(match.stage === 'playing' && match.frame.phase === 'main' && match.frame.stateOpen &&
    match.frame.pendingPayment === null && match.frame.priorityPlayerId === actor && match.frame.turnPlayerId === actor,
  'requires current Main/Open Priority');
  const player = match.players.find(item => item.playerId === actor);
  const cards = player?.hand.filter(card => card.uid === uid) ?? [];
  check(player && cards.length === 1 && match.players.flatMap(item => item.hand).filter(card => card.uid === uid).length === 1,
    'UID is not unique in actor Hand');
  const physical = match.physicalCardsByUID[uid];
  check(physical?.ownerPlayerId === actor && physical.cardId === cards[0]!.cardId,
    'physical Hand source mismatch');
  const original = match.provenance.originalPhysicalCards.find(item => item.uid === uid);
  check(original?.cardType === 'Unit' && original.cardId === cards[0]!.cardId && original.ownerPlayerId === actor,
    'original printing is not a Unit');
  const base = match.board.bases.find(item => item.ownerPlayerId === actor);
  check(base && match.resources.bases.some(item => item.playerId === actor && item.locationId === base.locationId),
    'own Base is unavailable');
  const reference = referenceDuelPhysicalCardV2(match, uid);
  assertCurrentDuelPhysicalReferenceV2(match, reference);
  return { cardId: cards[0]!.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId: base.locationId };
}
function callProgram(value: Private, match: DuelCanonicalPlayingStateV2, actor: string, uid: string,
  cardId: string, sourceEpoch: number): DuelPrintedUnitProgramBindingV4 {
  const output = value.services.program(Object.freeze({ match, matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, actor, uid, cardId, sourceEpoch }));
  check(output && output.status === 'known' && output.kind === 'Unit' && output.cardId === cardId &&
    id(output.programId) && id(output.programFingerprint) && output.optionalCost === 'accelerate',
  'unknown or unsupported Unit program');
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
      'payment source must be the current physical Chain Unit');
      // Choice/task issue and prepare run on the exact closed head. Payment runs
      // on a native pending-payment successor and is independently checked by the
      // task proof bridge in command-executor-v2.
      if (value.attempt && request.match === value.chainOrigin?.match)
        inspectDuelPrintedUnitAttemptCapabilityV4(value.attempt, { match: request.match,
          actor: request.actor, uid, cardId, sourceEpoch: epoch });
      const chain = (request.match.chainCards ?? []).filter(card => card.uid === uid);
      check(chain.length === 1 && chain[0]!.cardId === cardId &&
        request.match.physicalCardsByUID[uid]?.zoneEpoch === epoch,
      'payment source left its bound Chain epoch');
      const phase = request.match === value.chainOrigin?.match
        ? (request.previous ? 'prepare' : 'issue') : 'pay';
      const output = value.services.sourceAttestorV4
        ? value.services.sourceAttestorV4(Object.freeze({ ...request, attemptProof: value.attempt!, choiceProof: value.choiceProof!, phase }))
        : value.services.sourceAttestor(request);
      check(!value.poisoned && output.mode === 'current' && output.sourceZoneEpoch === epoch &&
        output.sourceReference.sourceUID === uid,
      'attestor did not prove current Chain epoch');
      return output;
    }
    catch { throw new TypeError('source attestation failed'); }
  };
}
export function createDuelPrintedUnitChainSessionV4(commandSession: DuelCommandSessionV2,
  services: DuelPrintedUnitPlayServicesV4): DuelPrintedUnitChainSessionV4 {
  check(commandSession && services && typeof services.program === 'function' && typeof services.entry === 'function' &&
    typeof services.closure === 'function' &&
    typeof services.costBinding === 'function' && typeof services.sourceAttestor === 'function' &&
    typeof services.isUnitPrinting === 'function' && (services.cost || typeof services.costForChain === 'function'),
  'trusted V4 services required');
  // Native no-op admission rejects a copied/foreign command session before storing it.
  check(commandSession.match.stage === 'playing', 'V4 session requires playing match');
  inspectDuelNativeCommandSessionPathV2(commandSession, commandSession);
  const head = commandSession.match as DuelCanonicalPlayingStateV2;
  const headRef = { value: head };
  let privateValue: Private | undefined;
  const choice = createDuelOptionalPlayChoiceAuthorityV2({
    readHead: () => headRef.value,
    readSource: (match, actor, uid) => {
      if (privateValue?.attempt && privateValue.chainOrigin) {
        const cardId = privateValue.cardId;
        const sourceEpoch = privateValue.sourceEpoch;
        check(cardId && sourceEpoch !== null, 'missing attempt source binding');
        inspectDuelPrintedUnitAttemptCapabilityV4(privateValue.attempt, {
          match, actor, uid, cardId, sourceEpoch,
        });
      }
      if (privateValue?.attempt && services.choice.readSourceV4)
        return services.choice.readSourceV4(match, actor, uid, privateValue.attempt);
      return services.choice.readSource(match, actor, uid);
    },
    nextOpaqueId: services.choice.nextOpaqueId,
  });
  const session = wrap(commandSession);
  const value: Private = { services, head: headRef, choice, origin: null, chainOrigin: null, attempt: null, choiceProof: null, handEpoch: null,
    phase: 'idle', actor: null, cardUID: null,
    cardId: null, sourceEpoch: null, baseLocationId: null, program: null, receipt: null, receiptData: null,
    decision: null, fixed: null, task: null, busy: false, poisoned: false,
    commandId: null, resumeCommandId: null };
  privateState.set(session as object, value);
  privateValue = value;
  return session;
}

export function beginDuelPrintedUnitPhysicalChainV4(session: DuelPrintedUnitChainSessionV4, actor: string,
  rawEnvelope: DuelPrintedUnitChainBeginEnvelopeV4): DuelPrintedUnitChainResultV4 {
  const value = stateOf(session);
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true; value.poisoned = false;
  let closedSession: DuelCommandSessionV2 | null = null;
  let claim: { origin: object; uid: string } | null = null;
  try {
    let envelope: DuelPrintedUnitChainBeginEnvelopeV4;
    try { envelope = beginEnvelope(rawEnvelope); } catch { return result(session, { status: 'rejected', reason: 'invalid-command' }); }
    const match = current(session);
    check(match.roster.some(item => item.playerId === actor), 'unknown actor');
    if (envelope.expectedVersion !== match.stateVersion) return result(session, { status: 'rejected', reason: 'stale-version' });
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId))
      return result(session, { status: 'rejected', reason: 'command-conflict' });
    if (value.phase === 'choice' && value.actor === actor && value.commandId === envelope.commandId &&
      value.cardUID === envelope.command.cardUID) {
      const prompt = value.choice.issue({ actor, commandId: envelope.commandId,
        expectedVersion: match.stateVersion, uid: envelope.command.cardUID });
      return result(session, { status: 'choice', prompt, cardUID: envelope.command.cardUID,
        chainVersion: match.stateVersion, eventSeq: match.eventSeq }, true);
    }
    if (value.phase !== 'idle') return result(session, { status: 'rejected', reason: 'command-conflict' });
    if (session.commandSession.requiredTasks.some(task => task.status !== 'completed') ||
      session.commandSession.priorityPayments.some(payment => payment.status === 'active'))
      return result(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    const source = assertPlayable(value, match, actor, envelope.command.cardUID);
    const origin = inspectDuelNativeOriginV2(match);
    const claims = originClaims.get(origin) ?? new Map<string, Private>();
    const roundKey = physicalChainRoundKey(envelope.command.cardUID, source.sourceEpoch);
    const prior = claims.get(roundKey);
    if (prior) {
      if (prior.busy) prior.poisoned = true;
      return result(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    }
    claims.set(roundKey, value);
    originClaims.set(origin, claims);
    value.origin = origin;
    claim = { origin, uid: roundKey };
    const program = callProgram(value, match, actor, envelope.command.cardUID, source.cardId, source.sourceEpoch);
    check(!value.poisoned, 'program provider reentered');
    const moved = moveDuelPhysicalCardToChainV2(match, referenceDuelPhysicalCardV2(match, envelope.command.cardUID), actor);
    const movedSession = advanceDuelCommandSessionNativeV2(session.commandSession, moved).session;
    const closed = commitDuelCommandFrameV2(movedSession, { ...moved.frame, stateOpen: false }, (before, proposed) => {
      check(before.frame.stateOpen && !proposed.stateOpen && proposed.pendingPayment === null,
        'Chain close frame mismatch');
      check(proposed.priorityPlayerId === actor, 'Chain close priority drift');
    }).session;
    closedSession = closed;
    value.chainOrigin = closed;
    value.actor = actor; value.cardUID = envelope.command.cardUID; value.cardId = source.cardId;
    const chainHead = closed.match as DuelCanonicalPlayingStateV2;
    // Preserve the source epoch tombstone for stale Hand siblings, and add the
    // actual closed Chain epoch used by Core finalize claims.
    const chainRoundKey = physicalChainRoundKey(envelope.command.cardUID,
      chainHead.physicalCardsByUID[envelope.command.cardUID]!.zoneEpoch);
    claims.set(chainRoundKey, value);
    claim.uid = chainRoundKey;
    value.handEpoch = source.sourceEpoch;
    value.sourceEpoch = chainHead.physicalCardsByUID[envelope.command.cardUID]!.zoneEpoch;
    value.baseLocationId = source.baseLocationId; value.program = program; value.commandId = envelope.commandId;
    value.attempt = issueDuelPrintedUnitAttemptCapabilityV4({ initialSession: session.commandSession,
      closedSession: closed, actor, uid: envelope.command.cardUID, cardId: source.cardId,
      handEpoch: source.sourceEpoch, chainEpoch: value.sourceEpoch }, attemptIssuerKey);
    value.head.value = chainHead;
    value.phase = 'choice';
    const prompt = value.choice.issue({ actor, commandId: envelope.commandId,
      expectedVersion: chainHead.stateVersion, uid: envelope.command.cardUID });
    check(!value.poisoned, 'choice provider reentered');
    const next = successor(session, closed);
    return result(next, { status: 'choice', prompt, cardUID: envelope.command.cardUID,
      chainVersion: next.commandSession.match.stateVersion, eventSeq: next.commandSession.match.eventSeq }, false, true);
  } catch {
    if (closedSession) return result(successor(session, closedSession),
      { status: 'blocked', reason: value.poisoned ? 'reentrant-command' : 'optional-choice-unproved' }, false, true);
    return result(session, { status: 'blocked', reason: value.poisoned ? 'reentrant-command' : 'source-or-entry-unproved' });
  }
  finally {
    if (!closedSession && claim) {
      originClaims.get(claim.origin)?.delete(claim.uid);
      value.origin = null;
    }
    value.busy = false;
  }
}

export function answerDuelPrintedUnitPhysicalChainV4(session: DuelPrintedUnitChainSessionV4, actor: string,
  rawEnvelope: DuelPrintedUnitChainAnswerEnvelopeV4): DuelPrintedUnitChainResultV4 {
  const value = stateOf(session);
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true; value.poisoned = false;
  try {
    let envelope: DuelPrintedUnitChainAnswerEnvelopeV4;
    try { envelope = answerEnvelope(rawEnvelope); } catch { return result(session, { status: 'rejected', reason: 'invalid-command' }); }
    const match = current(session);
    check(value.chainOrigin, 'missing Chain lineage');
    inspectDuelNativeCommandSessionPathV2(value.chainOrigin, session.commandSession);
    if (!match.roster.some(item => item.playerId === actor)) return result(session, { status: 'rejected', reason: 'unknown-actor' });
    if (value.phase !== 'choice' || value.actor !== actor || value.commandId !== envelope.commandId)
      return result(session, { status: 'rejected', reason: 'command-conflict' });
    if (envelope.expectedVersion !== match.stateVersion) return result(session, { status: 'rejected', reason: 'stale-version' });
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId))
      return result(session, { status: 'rejected', reason: 'command-conflict' });
    const receipt = value.choice.answer({ actor, commandId: envelope.commandId, expectedVersion: envelope.expectedVersion,
      choiceId: envelope.command.choiceId, optionId: envelope.command.optionId });
    const data = value.choice.inspectReceipt(receipt);
    check(!value.poisoned, 'choice provider reentered');
    check(data.uid === value.cardUID && data.sourceEpoch === value.sourceEpoch && data.actor === actor,
      'choice physical binding changed');
    const source = (match.chainCards ?? []).find(card => card.uid === value.cardUID);
    check(source && source.cardId === value.cardId, 'Chain source disappeared');
    const program = callProgram(value, match, actor, value.cardUID!, value.cardId!, value.sourceEpoch!);
    check(!value.poisoned, 'program provider reentered');
    check(program.programFingerprint === data.sourceProgramFingerprint, 'choice program drift');
    const req = entryRequest(value, match);
    verifyClosure(value, req);
    verifyEntry(value.services.entry(req), req, value.services.programs);
    check(!value.poisoned, 'entry provider reentered');
    const transactionId = JSON.stringify(['printed-unit-chain-v4', match.matchId, actor, envelope.commandId,
      value.cardUID, value.sourceEpoch, receipt.decision]);
    const choiceProof = issueDuelPrintedUnitChoiceProofV4({ attempt: value.attempt!, session: session.commandSession,
      receipt, data }, choiceIssuerKey);
    value.choiceProof = choiceProof;
    let fixed = value.fixed;
    if (!fixed) {
      try {
        const authority = value.services.costForChain
          ? value.services.costForChain(Object.freeze({
            commandSession: session.commandSession,
            match,
            matchId: match.matchId,
            actor,
            cardUID: value.cardUID!,
            cardId: value.cardId!,
            sourceEpoch: value.sourceEpoch!,
            transactionId,
            commandId: envelope.commandId,
            chainVersion: match.stateVersion,
            program,
            choiceReceipt: receipt,
            inspectChoiceReceipt: () => value.choice.inspectReceipt(receipt),
            attemptProof: value.attempt ?? undefined,
            choiceProof,
          }))
          : value.services.cost;
        check(authority, 'trusted Chain cost authority unavailable');
        fixed = resolveDuelTotalCostV2(authority,
          { transactionId, subjectId: value.cardId!, kind: 'card-play' });
      } catch { return result(session,
        { status: 'blocked', reason: 'cost-or-payment-unproved' }); }
      check(!value.poisoned, 'cost provider reentered');
      value.fixed = fixed;
    }
    const binding = Object.freeze({ matchId: match.matchId, stateVersion: match.stateVersion, actor,
      uid: value.cardUID!, cardId: value.cardId!, sourceEpoch: value.sourceEpoch!, baseLocationId: value.baseLocationId!,
      transactionId, baseProofId: fixed.baseProofId, coverageProofId: fixed.coverageProofId,
      decision: receipt.decision, programFingerprint: program.programFingerprint });
    let checkedBinding: DuelPrintedUnitCostBindingV4 & { status: 'complete' | 'unknown' };
    try { checkedBinding = value.services.costBinding(binding); } catch { return result(session,
      { status: 'blocked', reason: 'cost-or-payment-unproved' }); }
    check(!value.poisoned, 'cost binding reentered');
    check(checkedBinding.status === 'complete' && (Object.keys(binding) as (keyof typeof binding)[])
      .every(key => checkedBinding[key] === binding[key]), 'cost binding drift');
    const task: DuelRequiredCostTaskV2 = { matchId: match.matchId, expectedVersion: match.stateVersion,
      taskId: `printed-unit-chain-v4-task:${actor}:${envelope.commandId}`,
      paymentId: `printed-unit-chain-v4-payment:${actor}:${envelope.commandId}`, actor,
      finalResolvedCost: fixed.finalResolvedCost,
      opaqueSource: { kind: 'card', referenceId: value.cardId!, sourceUID: value.cardUID! },
      continuationId: `printed-unit-chain-v4-continuation:${actor}:${envelope.commandId}` };
    const issued = issueDuelPrintedUnitRequiredCostTaskV4(session.commandSession, task, value.attempt!,
      choiceProof, sourceAttestor(value));
    const prepared = prepareDuelPrintedUnitRequiredCostPaymentV4(issued.session, issued.authority);
    const next = successor(session, prepared.session);
    value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2; value.receipt = receipt; value.receiptData = data;
    value.decision = receipt.decision; value.fixed = fixed; value.task = task; value.phase = 'payment';
    return result(next, { status: 'pending', cardUID: value.cardUID!, taskId: task.taskId,
      paymentId: task.paymentId, decision: receipt.decision }, false, true);
  } catch { return result(session, { status: 'blocked',
    reason: value.poisoned ? 'reentrant-command' : 'optional-choice-unproved' }); }
  finally { value.busy = false; }
}

export function applyDuelPrintedUnitPhysicalChainResourceV4(session: DuelPrintedUnitChainSessionV4,
  actor: string, envelope: DuelCommandEnvelopeV2): DuelPrintedUnitChainResultV4 {
  const value = stateOf(session);
  if (value.phase !== 'payment' || value.actor !== actor) return result(session, { status: 'blocked', reason: 'wrong-task-or-session' });
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true; value.poisoned = false;
  try {
    check(value.chainOrigin, 'missing Chain lineage');
    inspectDuelNativeCommandSessionPathV2(value.chainOrigin, session.commandSession);
    const applied = applyDuelPrintedUnitResourceCommandV4Core(session.commandSession, actor, envelope);
    // A resource shortfall is a non-persistent Core rejection. Do not consume
    // the V4 wrapper with the rejection receipt: funding and retry must use the
    // same private task/session proof.
    if (envelope.command.type === 'pay-pending' && applied.outcome.status === 'rejected')
      return result(session, { status: 'blocked', reason: 'cost-or-payment-unproved' });
    if (!applied.persistRequired) return result(session,
      applied.outcome.status === 'applied'
        ? envelope.command.type === 'pay-pending'
          ? { status: 'paid', cardUID: value.cardUID!, decision: value.decision! }
          : { status: 'pending', cardUID: value.cardUID!, taskId: value.task!.taskId,
            paymentId: value.task!.paymentId, decision: value.decision! }
        : { status: 'blocked', reason: 'cost-or-payment-unproved' }, applied.duplicate);
    const next = successor(session, applied.session);
    value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2;
    if (applied.outcome.status !== 'applied') return result(next, { status: 'blocked', reason: 'cost-or-payment-unproved' });
    if (envelope.command.type !== 'pay-pending')
      return result(next, { status: 'pending', cardUID: value.cardUID!, taskId: value.task!.taskId,
        paymentId: value.task!.paymentId, decision: value.decision! }, false, true);
    value.phase = 'paid';
    return result(next, { status: 'paid', cardUID: value.cardUID!, decision: value.decision! }, false, true);
  } catch { return result(session, { status: 'blocked', reason: 'cost-or-payment-unproved' }); }
  finally { value.busy = false; }
}

export function resumeDuelPrintedUnitPhysicalChainV4(session: DuelPrintedUnitChainSessionV4, actor: string,
  rawEnvelope: DuelPrintedUnitChainResumeEnvelopeV4): DuelPrintedUnitChainResultV4 {
  const value = stateOf(session);
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true; value.poisoned = false;
  try {
    let envelope: DuelPrintedUnitChainResumeEnvelopeV4;
    try { envelope = resumeEnvelope(rawEnvelope); } catch { return result(session, { status: 'rejected', reason: 'invalid-command' }); }
    const match = current(session);
    if (value.phase === 'completed' && value.resumeCommandId === envelope.commandId &&
      value.actor === actor && value.cardUID === envelope.command.cardUID)
      return result(session, { status: 'applied', cardUID: value.cardUID!, ready: value.decision === 'pay',
        appliedVersion: match.stateVersion, eventSeq: match.eventSeq }, true);
    if (value.phase !== 'paid' || value.actor !== actor || value.cardUID !== envelope.command.cardUID)
      return result(session, { status: 'blocked', reason: 'wrong-task-or-session' });
    if (envelope.expectedVersion !== match.stateVersion) return result(session, { status: 'rejected', reason: 'stale-version' });
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId))
      return result(session, { status: 'rejected', reason: 'command-conflict' });
    check(match.frame.pendingPayment === null && !session.commandSession.requiredTasks.some(task => task.status === 'active'),
      'payment is not settled');
    check(value.chainOrigin, 'missing Chain lineage');
    inspectDuelNativeCommandSessionPathV2(value.chainOrigin, session.commandSession);
    const source = (match.chainCards ?? []).find(card => card.uid === value.cardUID);
    check(source && source.cardId === value.cardId, 'Chain source disappeared');
    const physical = match.physicalCardsByUID[value.cardUID!];
    check(physical?.zoneEpoch === value.sourceEpoch, 'Chain epoch changed unexpectedly');
    const program = callProgram(value, match, actor, value.cardUID!, value.cardId!, value.sourceEpoch!);
    check(!value.poisoned, 'program provider reentered');
    check(value.receiptData?.sourceProgramFingerprint === program.programFingerprint, 'program drift during payment');
    const req = entryRequest(value, match);
    verifyClosure(value, req);
    verifyEntry(value.services.entry(req), req, value.services.programs);
    check(!value.poisoned, 'entry provider reentered');
    const born = finalizeDuelPhysicalUnitFromChainV2(match, value.cardUID!, actor, value.baseLocationId!,
      value.decision === 'pay' ? 'enter-ready' : undefined, cardId => {
        const proved = value.services.isUnitPrinting(cardId);
        check(!value.poisoned, 'printing provider reentered');
        return proved;
      });
    const opened = advanceDuelCommandSessionNativeV2(session.commandSession, born).session;
    const next = successor(session, opened);
    value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2; value.phase = 'completed'; value.resumeCommandId = envelope.commandId;
    return result(next, { status: 'applied', cardUID: value.cardUID!, ready: value.decision === 'pay',
      appliedVersion: next.commandSession.match.stateVersion, eventSeq: next.commandSession.match.eventSeq }, false, true);
  } catch { return result(session, { status: 'blocked', reason: 'unproven-entry' }); }
  finally { value.busy = false; }
}

export function cancelDuelPrintedUnitPhysicalChainV4(session: DuelPrintedUnitChainSessionV4, actor: string,
  rawEnvelope: DuelPrintedUnitChainCancelEnvelopeV4): DuelPrintedUnitChainResultV4 {
  const value = stateOf(session);
  if (value.busy) { value.poisoned = true; return result(session, { status: 'blocked', reason: 'reentrant-command' }); }
  value.busy = true;
  try {
    const envelope = cancelEnvelope(rawEnvelope), match = current(session);
    if (value.phase === 'payment' || value.phase === 'paid') return result(session, { status: 'blocked', reason: 'refund-unavailable' });
    if (value.phase !== 'choice' || value.actor !== actor) return result(session, { status: 'blocked', reason: 'wrong-task-or-session' });
    if (envelope.expectedVersion !== match.stateVersion) return result(session, { status: 'rejected', reason: 'stale-version' });
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId))
      return result(session, { status: 'rejected', reason: 'command-conflict' });
    const returned = cancelDuelPhysicalUnitChainToHandV2(match, value.cardUID!, actor);
    const advanced = advanceDuelCommandSessionNativeV2(session.commandSession, returned).session;
    const next = successor(session, advanced); value.head.value = next.commandSession.match as DuelCanonicalPlayingStateV2;
    value.phase = 'completed'; value.resumeCommandId = envelope.commandId;
    if (value.origin && value.cardUID && value.sourceEpoch !== null) {
      // Keep the cancelled round as a tombstone. A stale sibling/late wrapper
      // must not reuse the old Hand/Chain head after Core advanced its epoch.
      const claims = originClaims.get(value.origin);
      if (claims) claims.set(physicalChainRoundKey(value.cardUID, value.sourceEpoch), value);
    }
    return result(next, { status: 'cancelled', cardUID: value.cardUID! }, false, true);
  } catch { return result(session, { status: 'blocked', reason: 'source-or-entry-unproved' }); }
  finally { value.busy = false; }
}

export function inspectDuelPrintedUnitPhysicalChainV4(session: DuelPrintedUnitChainSessionV4): DuelPrintedUnitChainInspectionV4 {
  const value = stateOf(session), match = current(session);
  return Object.freeze({ phase: value.phase, actor: value.actor, cardUID: value.cardUID, cardId: value.cardId,
    sourceEpoch: value.sourceEpoch, decision: value.decision,
    fixedCost: value.fixed?.finalResolvedCost ?? null,
    baseProofId: value.fixed?.baseProofId ?? null, coverageProofId: value.fixed?.coverageProofId ?? null,
    chainVersion: value.phase === 'idle' ? null : match.stateVersion });
}

// Short aliases for parent adapters.
export const startDuelPrintedUnitChainV4 = beginDuelPrintedUnitPhysicalChainV4;
export const answerDuelPrintedUnitChainV4 = answerDuelPrintedUnitPhysicalChainV4;
export const applyDuelPrintedUnitResourceCommandV4 = applyDuelPrintedUnitPhysicalChainResourceV4;
export const finishDuelPrintedUnitChainV4 = resumeDuelPrintedUnitPhysicalChainV4;


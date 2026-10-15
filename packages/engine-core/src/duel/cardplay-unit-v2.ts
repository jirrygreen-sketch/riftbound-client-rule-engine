// INTERNAL, in-memory first CardPlay slice. A whole-session codec and public command
// namespace belong to the parent composition, not to this private action capability.
import { applyDuelResourceCommandV2, commitDuelCommandMutationV2,
  inspectDuelNativeCommandSessionPathV2,
  issueDuelRequiredCostTaskV2, prepareDuelRequiredCostPaymentV2,
  type DuelCommandEnvelopeV2, type DuelCommandOutcomeV2, type DuelCommandSessionV2,
  type DuelRequiredCostAuthorityV2, type DuelRequiredCostTaskV2,
  type DuelSourceAttestorV2 } from './canonical-session-v2.js';
import type { DuelPaymentSourceReference } from './canonical-session.js';
import { assertCurrentDuelPhysicalReferenceV2, referenceDuelPhysicalCardV2,
  type DuelCanonicalPlayingStateV2 } from './core-v2.js';
import { enumerateDuelPhaseSourceClosureCandidatesV2 } from './phase-source-closure-v2.js';
import { resolveDuelTotalCostV2, type DuelCostResolverAuthorityV2,
  type DuelResolvedCostV2 } from './cost-resolver-v2.js';
import { materializeDuelUnitFromSettledSource, type DuelUnitLifecycleState } from './unit-lifecycle.js';
import { payDuelRuneCost, type DuelPaymentPlan, type DuelRuneCost } from './resources.js';
import { applyOpenDuelCleanup } from './battlefields.js';
import type { DuelOfficialProgramRegistry } from '@riftbound/card-dsl/duel';
import type { DuelOptionalPlayCostV1Known } from '@riftbound/card-dsl/duel';
import type { DuelOptionalPlayReceiptV1, DuelOptionalPlayReceiptDataV1 } from './optional-play-choice-v1.js';
import { runDuelStartOfTurnV2, resumeDuelStartOfTurnV2,
  runDuelEndOfTurnV2, resumeDuelEndOfTurnV2,
  type DuelTurnServicesV2 } from './turn-executor-v2.js';
import { beginDuelStandardMoveV2, certifyDuelStandardMoveTriggersV2,
  resumeDuelStandardMoveV2,
  type DuelStandardMoveCursorV2 } from './standard-move-executor-v2.js';
import type { DuelMoveEvent, DuelStandardMoveTiming } from './movement.js';

export interface DuelUnitEntryRequestV2 {
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
/** The trusted service must enumerate all live and applicable off-board sources. Each
 * scope covers the complete play/entry boundary, including queued I'm-played tasks. */
export interface DuelUnitEntryFactsV2 extends Omit<DuelUnitEntryRequestV2, 'match'> {
  readonly sourceCensus: 'complete' | 'unknown';
  readonly sources: readonly { readonly uid: string; readonly zoneEpoch: number;
    readonly programId: string; readonly disposition: 'known-no-effect' | 'unknown' | 'effect' }[];
  readonly scopes: {
    readonly play: 'clear' | 'unknown' | 'effect';
    readonly replacement: 'clear' | 'unknown' | 'effect';
    readonly static: 'clear' | 'unknown' | 'effect';
    readonly trigger: 'clear' | 'unknown' | 'effect';
    readonly pendingTasks: 'clear' | 'unknown' | 'effect';
    readonly chain: 'clear' | 'unknown' | 'effect';
  };
}
export type DuelUnitEntryServiceV2 = (request: Readonly<DuelUnitEntryRequestV2>) => DuelUnitEntryFactsV2;
export interface DuelUnitCostBindingV2 {
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
}
/** Independent catalog/transaction snapshot verifier. It must check the opaque resolver's
 * base proof against this physical card; the resolver result intentionally hides source UID. */
export type DuelUnitCostBindingServiceV2 = (request: Readonly<DuelUnitCostBindingV2>) =>
  DuelUnitCostBindingV2 & { readonly status: 'complete' | 'unknown' };
export interface DuelUnitPlayCommandV2 {
  readonly cardUID: string;
  readonly paymentPlan?: DuelPaymentPlan;
}
export interface DuelOptionalUnitPlayCommandV2 {
  readonly cardUID: string;
  /** Process-local receipt returned by DuelOptionalPlayChoiceAuthorityV1. */
  readonly choiceReceipt: DuelOptionalPlayReceiptV1;
  readonly paymentPlan?: DuelPaymentPlan;
}
export interface DuelUnitPlayEnvelopeV2 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: DuelUnitPlayCommandV2;
}
export interface DuelOptionalUnitPlayEnvelopeV2 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: DuelOptionalUnitPlayCommandV2;
}
export type DuelUnitPlayOutcomeV2 =
  | { readonly status: 'applied'; readonly appliedVersion: number; readonly eventSeq: number }
  | { readonly status: 'rejected'; readonly reason: 'invalid-command' | 'command-conflict' |
      'stale-version' | 'unknown-actor' | 'invalid-phase' | 'no-permission' }
  | { readonly status: 'blocked'; readonly reason: 'source-or-entry-unproved' |
      'cost-or-payment-unproved' | 'outstanding-task-or-session' | 'optional-choice-unproved' };
export interface DuelUnitPlayReceiptV2 {
  readonly actor: string;
  readonly commandId: string;
  readonly payloadFingerprint: string;
  readonly outcome: DuelUnitPlayOutcomeV2;
}
export interface DuelUnitPlaySessionV2 {
  readonly commandSession: DuelCommandSessionV2;
  readonly receipts: readonly DuelUnitPlayReceiptV2[];
}
export interface DuelUnitPlayResultV2 {
  readonly session: DuelUnitPlaySessionV2;
  readonly outcome: DuelUnitPlayOutcomeV2;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}

export interface DuelUnitPlayServicesV2 {
  readonly programs: DuelOfficialProgramRegistry;
  readonly cost: DuelCostResolverAuthorityV2;
  readonly costBinding: DuelUnitCostBindingServiceV2;
  readonly entry: DuelUnitEntryServiceV2;
  /** Fixed whole-program turn services. A missing value keeps turn commands blocked. */
  readonly turn?: DuelTurnServicesV2;
  /** Fixed timing, Ganking and complete Move-trigger closure services. */
  readonly move?: DuelUnitMoveServicesV2;
  /** Explicit opt-in capability for whole-pure optional Unit play. The legacy
   * no-ability path never reads this field. */
  readonly optional?: DuelOptionalUnitPlayServicesV2;
  /** Explicit opt-in V3 payment authority. V2 and legacy paths never read it. */
  readonly optionalPaymentV3?: DuelOptionalUnitPaymentServicesV3;
}

export interface DuelOptionalUnitProgramRequestV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
}
export interface DuelOptionalUnitProgramBindingV2 {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly programFingerprint: string;
  readonly description: DuelOptionalPlayCostV1Known;
}
export interface DuelOptionalUnitCostRequestV2 {
  readonly transactionId: string;
  readonly cardId: string;
  readonly actor: string;
  readonly uid: string;
  readonly sourceEpoch: number;
  readonly choice: 'pay' | 'decline';
  readonly description: DuelOptionalPlayCostV1Known;
  readonly receipt: DuelOptionalPlayReceiptDataV1;
}
export interface DuelOptionalUnitPlayServicesV2 {
  /** Read and independently validate the whole source printing tuple. */
  readonly program: (request: Readonly<DuelOptionalUnitProgramRequestV2>) => DuelOptionalUnitProgramBindingV2;
  /** Identity guarded choice inspection. JSON/structuredClone copies must fail. */
  readonly inspectChoice: (receipt: DuelOptionalPlayReceiptV1) => DuelOptionalPlayReceiptDataV1;
  /** Builds a fresh source-bound resolver for this exact choice and transaction. */
  readonly cost?: (request: Readonly<DuelOptionalUnitCostRequestV2>) => DuelCostResolverAuthorityV2;
  readonly costBinding?: DuelUnitCostBindingServiceV2;
  /** Optional entry closure for printings not represented by the no-ability registry. */
  readonly entry?: DuelUnitEntryServiceV2;
}
/** V3 deliberately separates payment authority from the legacy atomic optional
 * play API. The attestor is the only authority allowed to bind the pending
 * source/task after the choice has been made. */
export interface DuelOptionalUnitPaymentServicesV3 {
  readonly sourceAttestor: DuelSourceAttestorV2;
}
export interface DuelOptionalUnitPaymentBeginEnvelopeV3 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly cardUID: string; readonly choiceReceipt: DuelOptionalPlayReceiptV1 };
}
export interface DuelOptionalUnitPaymentResumeEnvelopeV3 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly cardUID: string };
}
export type DuelOptionalUnitPaymentOutcomeV3 =
  | { readonly status: 'pending'; readonly step: 'payment'; readonly cardUID: string;
      readonly taskId: string; readonly paymentId: string; readonly decision: 'pay' | 'decline' }
  | { readonly status: 'applied'; readonly appliedVersion: number; readonly eventSeq: number;
      readonly cardUID: string; readonly decision: 'pay' | 'decline' }
  | { readonly status: 'rejected'; readonly reason: 'invalid-command' | 'command-conflict' |
      'stale-version' | 'unknown-actor' | 'invalid-phase' | 'no-permission' }
  | { readonly status: 'blocked'; readonly reason: 'optional-choice-unproved' |
      'source-or-entry-unproved' | 'cost-or-payment-unproved' | 'outstanding-task-or-session' |
      'wrong-task-or-session' | 'unproven-entry' | 'reentrant-command' };
export interface DuelOptionalUnitPaymentResultV3 {
  readonly session: DuelUnitPlaySessionV2;
  readonly outcome: DuelOptionalUnitPaymentOutcomeV3 | DuelUnitResourceOutcomeV2;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}
export interface DuelOptionalUnitPaymentPrivateStateV3 {
  readonly status: 'pending' | 'completed';
  readonly actor: string;
  readonly commandId: string;
  readonly cardUID: string;
  readonly sourceUID: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly programFingerprint: string;
  readonly baseLocationId: string;
  readonly decision: 'pay' | 'decline';
  readonly taskId: string;
  readonly paymentId: string;
  readonly continuationId: string;
  readonly transactionId: string;
  readonly baseProofId: string;
  readonly coverageProofId: string;
  readonly resolvedCost: DuelRuneCost;
  readonly applications: readonly DuelResolvedCostV2['applications'][number][];
}
export interface DuelUnitMoveServicesV2 {
  readonly timing: (match: DuelCanonicalPlayingStateV2, actor: string) => DuelStandardMoveTiming;
  readonly ganking: (match: DuelCanonicalPlayingStateV2, actor: string, unitUID: string) => boolean;
  /** Enumerates the complete live source set and resolves the whole Move group. */
  readonly triggers: (context: {
    readonly movedState: DuelCanonicalPlayingStateV2;
    readonly currentState: DuelCanonicalPlayingStateV2;
    readonly obligation: {
      readonly kind: 'move-trigger-obligation'; readonly taskId: string;
      readonly movedVersion: number; readonly events: readonly DuelMoveEvent[];
    };
  }) => { readonly status: 'pending' | 'unknown' } | {
    readonly status: 'settled'; readonly taskId: string; readonly movedVersion: number;
    readonly events: readonly DuelMoveEvent[]; readonly disposition: 'no-triggers' };
}
export interface DuelUnitResourceOptionsV2 {
  readonly randomIndex?: (exclusiveUpperBound: number) => number;
  readonly sourceAttestor?: DuelSourceAttestorV2;
}
export type DuelUnitResourceOutcomeV2 = DuelCommandOutcomeV2 |
  { readonly status: 'blocked'; readonly reason: 'source-attestor-unavailable' | 'reentrant-command' |
      'outstanding-task-or-session' };
export interface DuelUnitResourceResultV2 {
  readonly session: DuelUnitPlaySessionV2;
  readonly outcome: DuelUnitResourceOutcomeV2;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}
export interface DuelUnitTurnEnvelopeV2 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly type: 'start-turn' | 'end-turn' };
}
export type DuelUnitTurnOutcomeV2 =
  | { readonly status: 'applied'; readonly phase: 'main' | 'awaiting-turn-start' | 'ended';
      readonly appliedVersion: number; readonly eventSeq: number }
  | { readonly status: 'pending'; readonly taskId: string; readonly phase: string }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'blocked'; readonly reason: 'turn-services-unavailable' | 'turn-resolution-unproved' };
export interface DuelUnitTurnResultV2 {
  readonly session: DuelUnitPlaySessionV2;
  readonly outcome: DuelUnitTurnOutcomeV2;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}
export interface DuelUnitMoveEnvelopeV2 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: { readonly unitUIDs: readonly string[]; readonly destinationLocationId: string };
}
export type DuelUnitMoveOutcomeV2 =
  | { readonly status: 'applied'; readonly taskId: string; readonly appliedVersion: number;
      readonly eventSeq: number; readonly events: readonly DuelMoveEvent[] }
  | { readonly status: 'pending'; readonly taskId: string; readonly appliedVersion: number;
      readonly eventSeq: number }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'blocked'; readonly reason: 'move-services-unavailable' | 'move-or-ganking-unproved' |
      'move-trigger-unproved' };
export interface DuelUnitMoveResultV2 {
  readonly session: DuelUnitPlaySessionV2;
  readonly outcome: DuelUnitMoveOutcomeV2;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}
type PrivateAction = { active: boolean; busy: boolean; poisoned: boolean;
  services: DuelUnitPlayServicesV2; resourceOptions: DuelUnitResourceOptionsV2;
  ledger: Map<string, { kind: 'resource' | 'unit' | 'optional-payment-begin' |
    'optional-payment-resume' | 'turn' | 'move'; fingerprint: string;
    outcome: unknown; pendingTaskId?: string; choiceReceipt?: DuelOptionalPlayReceiptV1 }> };
const admitted = new WeakMap<object, PrivateAction>();
const ownedSessions = new WeakMap<object, DuelUnitPlaySessionV2>();
type OptionalPaymentV3State = {
  readonly actor: string;
  readonly commandId: string;
  readonly cardUID: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly decision: 'pay' | 'decline';
  readonly choiceReceipt: DuelOptionalPlayReceiptV1;
  readonly choiceData: Readonly<DuelOptionalPlayReceiptDataV1>;
  readonly description: DuelOptionalPlayCostV1Known;
  readonly programFingerprint: string;
  readonly baseLocationId: string;
  readonly transactionId: string;
  readonly task: DuelRequiredCostTaskV2;
  readonly resolved: DuelResolvedCostV2;
  readonly authority: DuelOptionalUnitPaymentServicesV3;
  readonly origin: DuelUnitPlaySessionV2;
  status: 'pending' | 'completed';
  beginOutcome: DuelOptionalUnitPaymentOutcomeV3;
  completedOutcome?: DuelOptionalUnitPaymentOutcomeV3;
  resumeCommandId?: string;
  resumeFingerprint?: string;
};
const optionalPaymentV3 = new WeakMap<object, OptionalPaymentV3State>();
type OptionalReceiptOrigin = { readonly choiceReceipt: DuelOptionalPlayReceiptV1;
  readonly service: DuelOptionalUnitPlayServicesV2;
  readonly inspectChoice: DuelOptionalUnitPlayServicesV2['inspectChoice'];
  readonly data: Readonly<DuelOptionalPlayReceiptDataV1> };
// A duplicate belongs to the exact action receipt that first consumed this
// choice, not to a service-wide cache of every choice it has ever inspected.
const optionalReceiptOrigins = new WeakMap<object, OptionalReceiptOrigin>();
const moveContinuations = new WeakMap<object, { actor: string; commandId: string;
  fingerprint: string; taskId: string; movedVersion: number;
  movedState: DuelCanonicalPlayingStateV2; events: readonly DuelMoveEvent[];
  cursor: DuelStandardMoveCursorV2; movedProjection: DuelUnitLifecycleState }>();
const turnContinuations = new WeakMap<object, { actor: string; commandId: string;
  fingerprint: string; taskId: string; kind: 'start-turn' | 'end-turn' }>();
function check(value: unknown, label: string): asserts value {
  if (!value) throw new TypeError(`Duel Unit CardPlay V2: ${label}`);
}
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'plain record required');
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null, 'plain record prototype');
  const actual = Reflect.ownKeys(value);
  check(actual.length >= keys.length && actual.length <= keys.length + optional.length &&
    keys.every(key => actual.includes(key)) && actual.every(key =>
      typeof key === 'string' && [...keys, ...optional].includes(key) &&
      'value' in Object.getOwnPropertyDescriptor(value, key)!), 'record keys/accessors');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  check(typeof value === 'string' && value.trim().length > 0, 'nonblank ID');
  return value;
}
function nonnegative(value: unknown): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'safe version/epoch');
  return value;
}
function normalized(raw: unknown): DuelUnitPlayEnvelopeV2 {
  const envelope = record(raw, ['commandId', 'expectedVersion', 'command']);
  const command = record(envelope.command, ['cardUID'], ['paymentPlan']);
  let paymentPlan: DuelPaymentPlan | undefined;
  if (Object.hasOwn(command, 'paymentPlan')) {
    const plan = record(command.paymentPlan, ['power']);
    check(Array.isArray(plan.power) && Object.getPrototypeOf(plan.power) === Array.prototype &&
      Reflect.ownKeys(plan.power).length === plan.power.length + 1, 'dense payment plan');
    const power = plan.power.map(rawEntry => {
      const entry = record(rawEntry, ['requirementIndex', 'from', 'amount']);
      check(typeof entry.from === 'string' &&
        ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'any'].includes(entry.from), 'payment source');
      return { requirementIndex: nonnegative(entry.requirementIndex),
        from: entry.from as DuelPaymentPlan['power'][number]['from'], amount: nonnegative(entry.amount) };
    });
    paymentPlan = { power };
  }
  return { commandId: id(envelope.commandId), expectedVersion: nonnegative(envelope.expectedVersion),
    command: { cardUID: id(command.cardUID), ...(paymentPlan ? { paymentPlan } : {}) } };
}
function normalizedOptional(raw: unknown): DuelOptionalUnitPlayEnvelopeV2 {
  const envelope = record(raw, ['commandId', 'expectedVersion', 'command']);
  const command = record(envelope.command, ['cardUID', 'choiceReceipt'], ['paymentPlan']);
  const receipt = record(command.choiceReceipt, ['decision']);
  check(receipt.decision === 'pay' || receipt.decision === 'decline', 'optional choice receipt');
  let paymentPlan: DuelPaymentPlan | undefined;
  if (Object.hasOwn(command, 'paymentPlan')) {
    const plan = record(command.paymentPlan, ['power']);
    check(Array.isArray(plan.power) && Object.getPrototypeOf(plan.power) === Array.prototype &&
      Reflect.ownKeys(plan.power).length === plan.power.length + 1, 'dense payment plan');
    const power = plan.power.map(rawEntry => {
      const entry = record(rawEntry, ['requirementIndex', 'from', 'amount']);
      check(typeof entry.from === 'string' &&
        ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'any'].includes(entry.from), 'payment source');
      return { requirementIndex: nonnegative(entry.requirementIndex),
        from: entry.from as DuelPaymentPlan['power'][number]['from'], amount: nonnegative(entry.amount) };
    });
    paymentPlan = { power };
  }
  return { commandId: id(envelope.commandId), expectedVersion: nonnegative(envelope.expectedVersion),
    command: { cardUID: id(command.cardUID), choiceReceipt: command.choiceReceipt as DuelOptionalPlayReceiptV1,
      ...(paymentPlan ? { paymentPlan } : {}) } };
}
function normalizedOptionalPaymentBegin(raw: unknown): DuelOptionalUnitPaymentBeginEnvelopeV3 {
  const parsed = normalizedOptional(raw);
  check(parsed.command.paymentPlan === undefined, 'V3 begin cannot carry a payment plan');
  return { commandId: parsed.commandId, expectedVersion: parsed.expectedVersion,
    command: { cardUID: parsed.command.cardUID, choiceReceipt: parsed.command.choiceReceipt } };
}
function normalizedOptionalPaymentResume(raw: unknown): DuelOptionalUnitPaymentResumeEnvelopeV3 {
  const envelope = record(raw, ['commandId', 'expectedVersion', 'command']);
  const command = record(envelope.command, ['cardUID']);
  return { commandId: id(envelope.commandId), expectedVersion: nonnegative(envelope.expectedVersion),
    command: { cardUID: id(command.cardUID) } };
}
function normalizedResource(raw: unknown): DuelCommandEnvelopeV2 {
  const envelope = record(raw, ['commandId', 'expectedVersion', 'command']);
  const command = record(envelope.command, ['type'], ['selectedUIDs', 'uid', 'paymentId', 'plan']);
  let parsed: DuelCommandEnvelopeV2['command'];
  switch (command.type) {
    case 'mulligan': {
      record(envelope.command, ['type', 'selectedUIDs']);
      check(Array.isArray(command.selectedUIDs) &&
        Object.getPrototypeOf(command.selectedUIDs) === Array.prototype &&
        Reflect.ownKeys(command.selectedUIDs).length === command.selectedUIDs.length + 1,
      'dense mulligan selection');
      parsed = { type: 'mulligan', selectedUIDs: command.selectedUIDs.map(id) };
      break;
    }
    case 'rune-energy': case 'rune-power': case 'gold-power':
      record(envelope.command, ['type', 'uid']);
      parsed = { type: command.type, uid: id(command.uid) };
      break;
    case 'pay-pending': {
      record(envelope.command, ['type', 'paymentId'], ['plan']);
      const paymentId = id(command.paymentId);
      if (!Object.hasOwn(command, 'plan')) parsed = { type: 'pay-pending', paymentId };
      else {
        const plan = record(command.plan, ['power']);
        check(Array.isArray(plan.power) && Object.getPrototypeOf(plan.power) === Array.prototype &&
          Reflect.ownKeys(plan.power).length === plan.power.length + 1, 'dense payment plan');
        parsed = { type: 'pay-pending', paymentId, plan: { power: plan.power.map(rawEntry => {
          const entry = record(rawEntry, ['requirementIndex', 'from', 'amount']);
          check(typeof entry.from === 'string' &&
            ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'any'].includes(entry.from),
          'payment source');
          return { requirementIndex: nonnegative(entry.requirementIndex),
            from: entry.from as DuelPaymentPlan['power'][number]['from'],
            amount: nonnegative(entry.amount) };
        }) } };
      }
      break;
    }
    default: throw new TypeError('Duel Unit CardPlay V2: unsupported resource command');
  }
  return { commandId: id(envelope.commandId), expectedVersion: nonnegative(envelope.expectedVersion),
    command: parsed };
}
function normalizedTurn(raw: unknown): DuelUnitTurnEnvelopeV2 {
  const envelope = record(raw, ['commandId', 'expectedVersion', 'command']);
  const command = record(envelope.command, ['type']);
  check(command.type === 'start-turn' || command.type === 'end-turn', 'turn command type');
  return { commandId: id(envelope.commandId), expectedVersion: nonnegative(envelope.expectedVersion),
    command: { type: command.type } };
}
function normalizedMove(raw: unknown): DuelUnitMoveEnvelopeV2 {
  const envelope = record(raw, ['commandId', 'expectedVersion', 'command']);
  const command = record(envelope.command, ['unitUIDs', 'destinationLocationId']);
  check(Array.isArray(command.unitUIDs) && Object.getPrototypeOf(command.unitUIDs) === Array.prototype &&
    Reflect.ownKeys(command.unitUIDs).length === command.unitUIDs.length + 1 && command.unitUIDs.length > 0,
  'dense move units');
  const unitUIDs = command.unitUIDs.map(id);
  check(new Set(unitUIDs).size === unitUIDs.length, 'unique move units');
  return { commandId: id(envelope.commandId), expectedVersion: nonnegative(envelope.expectedVersion),
    command: { unitUIDs, destinationLocationId: id(command.destinationLocationId) } };
}
function fingerprint(envelope: DuelUnitPlayEnvelopeV2): string {
  const plan = envelope.command.paymentPlan;
  return JSON.stringify([envelope.expectedVersion, envelope.command.cardUID,
    plan === undefined ? null : plan.power.map(p => [p.requirementIndex, p.from, p.amount])]);
}
function optionalFingerprint(envelope: DuelOptionalUnitPlayEnvelopeV2,
  decision: 'pay' | 'decline'): string {
  const plan = envelope.command.paymentPlan;
  return JSON.stringify([envelope.expectedVersion, envelope.command.cardUID, decision,
    plan === undefined ? null : plan.power.map(p => [p.requirementIndex, p.from, p.amount])]);
}
function resourceFingerprint(envelope: DuelCommandEnvelopeV2): string {
  return JSON.stringify([envelope.expectedVersion, envelope.command]);
}
function turnFingerprint(envelope: DuelUnitTurnEnvelopeV2): string {
  return JSON.stringify([envelope.expectedVersion, envelope.command.type]);
}
function moveFingerprint(envelope: DuelUnitMoveEnvelopeV2): string {
  return JSON.stringify([envelope.expectedVersion, envelope.command.unitUIDs,
    envelope.command.destinationLocationId]);
}
function ledgerKey(actor: string, commandId: string): string { return `${actor}\u0000${commandId}`; }
function pendingOptionalContinuation(session: DuelUnitPlaySessionV2): OptionalPaymentV3State | undefined {
  const pending = optionalPaymentV3.get(session as object);
  return pending?.status === 'pending' ? pending : undefined;
}
function closedOptionalContinuation(session: DuelUnitPlaySessionV2): OptionalPaymentV3State | undefined {
  const pending = pendingOptionalContinuation(session);
  const match = session.commandSession.match;
  return pending && match.stage === 'playing' && match.frame.pendingPayment === null ? pending : undefined;
}
function publish(session: DuelUnitPlaySessionV2, services: DuelUnitPlayServicesV2,
  resourceOptions: DuelUnitResourceOptionsV2,
  inheritedLedger?: Map<string, { kind: 'resource' | 'unit' | 'optional-payment-begin' |
    'optional-payment-resume' | 'turn' | 'move'; fingerprint: string;
    outcome: unknown; pendingTaskId?: string; choiceReceipt?: DuelOptionalPlayReceiptV1 }>): DuelUnitPlaySessionV2 {
  Object.freeze(session.receipts);
  Object.freeze(session);
  admitted.set(session, { active: true, busy: false, poisoned: false, services, resourceOptions,
    ledger: inheritedLedger ?? new Map() });
  ownedSessions.set(session.commandSession, session);
  return session;
}
function output<T extends DuelUnitPlayOutcomeV2 | DuelUnitResourceOutcomeV2 |
  DuelUnitTurnOutcomeV2 | DuelUnitMoveOutcomeV2>(
  session: DuelUnitPlaySessionV2, outcome: T,
  duplicate = false, persistRequired = false): {
    readonly session: DuelUnitPlaySessionV2; readonly outcome: T;
    readonly duplicate: boolean; readonly persistRequired: boolean } {
  return Object.freeze({ session, outcome, duplicate, persistRequired });
}
function sameFacts(facts: DuelUnitEntryFactsV2, request: DuelUnitEntryRequestV2,
  programs: DuelOfficialProgramRegistry): void {
  const raw = record(facts, ['matchId', 'stateVersion', 'eventSeq', 'actor', 'uid', 'cardId',
    'sourceEpoch', 'baseLocationId', 'programId', 'sourceCensus', 'sources', 'scopes']);
  for (const key of ['matchId', 'stateVersion', 'eventSeq', 'actor', 'uid', 'cardId',
    'sourceEpoch', 'baseLocationId', 'programId'] as const)
    check(raw[key] === request[key], `entry ${key} binding mismatch`);
  check(raw.sourceCensus === 'complete', 'incomplete entry source census');
  check(Array.isArray(raw.sources) && Object.getPrototypeOf(raw.sources) === Array.prototype &&
    Reflect.ownKeys(raw.sources).length === raw.sources.length + 1, 'entry source list');
  const seen = new Set<string>();
  for (const source of raw.sources as DuelUnitEntryFactsV2['sources']) {
    const item = record(source, ['uid', 'zoneEpoch', 'programId', 'disposition']);
    const sourceId = id(item.uid);
    check(!seen.has(sourceId) && id(item.programId) && Number.isSafeInteger(item.zoneEpoch) &&
      (item.zoneEpoch as number) >= 0 && item.disposition === 'known-no-effect',
    'unproved entry source');
    const physical = request.match.physicalCardsByUID[sourceId];
    if (physical) {
      assertCurrentDuelPhysicalReferenceV2(request.match,
        { uid: sourceId, zoneEpoch: item.zoneEpoch as number });
      check(programs.getProgram(physical.cardId)?.programId === item.programId,
        'entry source program mismatch');
    }
    seen.add(sourceId);
  }
  const scopes = record(raw.scopes,
    ['play', 'replacement', 'static', 'trigger', 'pendingTasks', 'chain']);
  check(Object.values(scopes).every(value => value === 'clear'), 'entry scope has unresolved work');
}

/** Optional-program entry census. Accelerate is a DATA descriptor and therefore
 * is intentionally not looked up as an executable official program. The census
 * still has to bind every returned source to the live physical epoch and report
 * a complete, effect-free entry closure. */
function sameOptionalFacts(facts: DuelUnitEntryFactsV2, request: DuelUnitEntryRequestV2,
  programs: DuelOfficialProgramRegistry): void {
  const raw = record(facts, ['matchId', 'stateVersion', 'eventSeq', 'actor', 'uid', 'cardId',
    'sourceEpoch', 'baseLocationId', 'programId', 'sourceCensus', 'sources', 'scopes']);
  for (const key of ['matchId', 'stateVersion', 'eventSeq', 'actor', 'uid', 'cardId',
    'sourceEpoch', 'baseLocationId', 'programId'] as const)
    check(raw[key] === request[key], `optional entry ${key} binding mismatch`);
  check(raw.sourceCensus === 'complete', 'incomplete optional entry source census');
  check(Array.isArray(raw.sources) && Object.getPrototypeOf(raw.sources) === Array.prototype &&
    Reflect.ownKeys(raw.sources).length === raw.sources.length + 1, 'optional entry source list');
  const seen = new Set<string>();
  const actualCandidates = enumerateDuelPhaseSourceClosureCandidatesV2(request.match);
  check(actualCandidates.length > 0, 'optional entry candidate census unavailable');
  const actualTarget = actualCandidates.find(candidate => candidate.uid === request.uid &&
    candidate.carrier === 'object' && candidate.cardId === request.cardId &&
    candidate.zoneEpoch === request.sourceEpoch && candidate.ownerPlayerId === request.actor &&
    candidate.zone.kind === 'hand');
  check(actualTarget !== undefined, 'optional entry target absent from candidate census');
  const actualByUID = new Map<string, typeof actualCandidates[number]>();
  for (const candidate of actualCandidates) {
    check(!actualByUID.has(candidate.uid), 'duplicate optional entry candidate');
    check(candidate.cardId !== null && Number.isSafeInteger(candidate.zoneEpoch) &&
      (candidate.zoneEpoch as number) >= 0, 'optional entry candidate lacks physical binding');
    actualByUID.set(candidate.uid, candidate);
  }
  check(raw.sources.length === actualCandidates.length,
    'optional entry source census omits an actual candidate');
  for (const source of raw.sources as DuelUnitEntryFactsV2['sources']) {
    const item = record(source, ['uid', 'zoneEpoch', 'programId', 'disposition']);
    const sourceId = id(item.uid);
    check(!seen.has(sourceId) && Number.isSafeInteger(item.zoneEpoch) &&
      (item.zoneEpoch as number) >= 0 && item.disposition === 'known-no-effect',
    'unproved optional entry source');
    const candidate = actualByUID.get(sourceId);
    check(candidate !== undefined && candidate.zoneEpoch === item.zoneEpoch,
      'optional entry source is not an actual candidate');
    const physical = request.match.physicalCardsByUID[sourceId];
    check(physical !== undefined, 'optional entry source has no physical card');
    assertCurrentDuelPhysicalReferenceV2(request.match,
      { uid: sourceId, zoneEpoch: item.zoneEpoch as number });
    check(sourceId === request.uid ? item.programId === request.programId :
      programs.getProgram(physical.cardId)?.programId === item.programId,
    'optional entry source program mismatch');
    seen.add(sourceId);
  }
  check(seen.has(request.uid), 'optional entry target omitted from source census');
  const scopes = record(raw.scopes,
    ['play', 'replacement', 'static', 'trigger', 'pendingTasks', 'chain']);
  check(Object.values(scopes).every(value => value === 'clear'), 'optional entry scope has unresolved work');
}

/** The factory accepts only an already admitted canonical session and trusted services.
 * The wrapper holds the ONE real resource session; it is not an archive restoration API. */
export function createDuelUnitPlaySessionV2(commandSession: DuelCommandSessionV2,
  services: DuelUnitPlayServicesV2,
  resourceOptions: DuelUnitResourceOptionsV2 = {}): DuelUnitPlaySessionV2 {
  check(services && typeof services.programs?.getProgram === 'function' &&
    typeof services.entry === 'function' && typeof services.costBinding === 'function' &&
    services.cost, 'trusted services required');
  check(!ownedSessions.has(commandSession), 'canonical session already has an action branch');
  check(resourceOptions && (resourceOptions.randomIndex === undefined ||
    typeof resourceOptions.randomIndex === 'function') &&
    (resourceOptions.sourceAttestor === undefined ||
      typeof resourceOptions.sourceAttestor === 'function'), 'trusted resource options required');
  commitDuelCommandMutationV2(commandSession, draft => ({ match: draft, transitions: [] }));
  return publish({ commandSession, receipts: [] }, services,
    Object.freeze({ randomIndex: resourceOptions.randomIndex,
      sourceAttestor: resourceOptions.sourceAttestor }));
}

/** Parent dispatcher handoff after another trusted action finishes on the same private
 * canonical lineage. Preserve Unit/Turn/Move receipts and consume the old branch; a
 * fresh adoption, copied ledger, pending turn/move or payment cannot replace it. */
export function advanceDuelUnitCommandSessionV2(session: DuelUnitPlaySessionV2,
  commandSession: DuelCommandSessionV2): DuelUnitPlaySessionV2 {
  const state = admitted.get(session as object);
  check(state && state.active && !state.busy && !state.poisoned, 'inactive or busy action branch');
  check(!pendingOptionalContinuation(session), 'pending optional Unit continuation owns canonical session');
  check(!turnContinuations.has(session) && !moveContinuations.has(session), 'pending action owns canonical session');
  const path = inspectDuelNativeCommandSessionPathV2(session.commandSession, commandSession);
  if (path.length === 0) return session;
  const knownReceipts = new Set(session.commandSession.receipts.map(receipt =>
    ledgerKey(receipt.actor, receipt.commandId)));
  for (const edge of path) for (const receipt of edge.after.receipts) {
    const key = ledgerKey(receipt.actor, receipt.commandId);
    if (knownReceipts.has(key)) continue;
    check(!state.ledger.has(key) && !session.receipts.some(prior =>
      prior.actor === receipt.actor && prior.commandId === receipt.commandId),
    'canonical receipt conflicts with existing action command');
    knownReceipts.add(key);
  }
  check(!ownedSessions.has(commandSession), 'canonical session already has an action branch');
  commitDuelCommandMutationV2(commandSession, draft => ({ match: draft, transitions: [] }));
  const next = publish({ commandSession, receipts: session.receipts }, state.services,
    state.resourceOptions, new Map(state.ledger));
  const optionalPayment = optionalPaymentV3.get(session as object);
  if (optionalPayment) optionalPaymentV3.set(next, optionalPayment);
  state.active = false;
  return next;
}

/** Internal forwarding only: every resource successor remains under the same Unit ledger. */
export function applyDuelUnitResourceCommandV2(session: DuelUnitPlaySessionV2, actor: string,
  rawEnvelope: DuelCommandEnvelopeV2): DuelUnitResourceResultV2 {
  const state = admitted.get(session as object);
  const optionalPayment = optionalPaymentV3.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) {
    state.poisoned = true;
    return output(session, { status: 'blocked', reason: 'reentrant-command' });
  }
  check(state.active, 'spent action session');
  state.busy = true;
  state.poisoned = false;
  try {
    let envelope: DuelCommandEnvelopeV2;
    try { envelope = normalizedResource(rawEnvelope); }
    catch { return output(session, { status: 'rejected', reason: 'invalid-command' }); }
    if (state.poisoned) return output(session, { status: 'blocked', reason: 'reentrant-command' });
    if (!session.commandSession.match.roster.some(seat => seat.playerId === actor))
      return output(session, { status: 'rejected', reason: 'unknown-actor' });
    if (session.receipts.some(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId))
      return output(session, { status: 'rejected', reason: 'command-conflict' });
    const ledgerEntry = state.ledger.get(ledgerKey(actor, envelope.commandId));
    if (ledgerEntry && ledgerEntry.kind !== 'resource')
      return output(session, { status: 'rejected', reason: 'command-conflict' });
    if (turnContinuations.has(session) || moveContinuations.has(session))
      return output(session, { status: 'blocked', reason: 'reentrant-command' });
    const canonicalReceipt = session.commandSession.receipts.find(receipt =>
      receipt.actor === actor && receipt.commandId === envelope.commandId);
    if (canonicalReceipt) {
      const result = applyDuelResourceCommandV2(session.commandSession, actor, envelope, {});
      return output(session, result.outcome, result.duplicate);
    }
    // A paid CardPlay still owns the session until entry closes. Existing
    // receipts remain replayable without funding, paying or invoking providers.
    if (closedOptionalContinuation(session)) return output(session,
      { status: 'blocked', reason: 'outstanding-task-or-session' });
    const sourceAttestor = state.resourceOptions.sourceAttestor ?? optionalPayment?.authority.sourceAttestor;
    if (envelope.command.type === 'pay-pending' && !sourceAttestor &&
      !canonicalReceipt)
      return output(session, { status: 'blocked', reason: 'source-attestor-unavailable' });
    const trusted = {
      ...(state.resourceOptions.randomIndex ? { randomIndex: (limit: number) => {
        const value = state.resourceOptions.randomIndex!(limit);
        check(!state.poisoned, 'reentered random source');
        return value;
      } } : {}),
      ...(sourceAttestor ? { sourceAttestor: ((request) => {
        const value = sourceAttestor(request);
        check(!state.poisoned, 'reentered source attestor');
        return value;
      }) as DuelSourceAttestorV2 } : {}),
    };
    const result = applyDuelResourceCommandV2(session.commandSession, actor, envelope, trusted);
    check(!state.poisoned || result.outcome.status !== 'applied',
      'reentered resource provider advanced canonical session');
    if (!result.persistRequired) return output(session, result.outcome, result.duplicate);
    const ledger = new Map(state.ledger);
    ledger.set(ledgerKey(actor, envelope.commandId), { kind: 'resource',
      fingerprint: resourceFingerprint(envelope), outcome: result.outcome });
    const next = publish({ commandSession: result.session, receipts: session.receipts },
      state.services, state.resourceOptions, ledger);
    if (optionalPayment) optionalPaymentV3.set(next, optionalPayment);
    state.active = false;
    return output(next, result.outcome, false, true);
  } finally { state.busy = false; }
}

export function playDuelNoAbilityUnitToBaseV2(session: DuelUnitPlaySessionV2, actor: string,
  rawEnvelope: DuelUnitPlayEnvelopeV2): DuelUnitPlayResultV2 {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) {
    state.poisoned = true;
    return output(session, { status: 'blocked', reason: 'source-or-entry-unproved' });
  }
  check(state.active, 'spent action session');
  if (pendingOptionalContinuation(session)) return output(session,
    { status: 'blocked', reason: 'outstanding-task-or-session' });
  const services = state.services;
  state.busy = true;
  state.poisoned = false;
  try {
  let envelope: DuelUnitPlayEnvelopeV2;
  try { envelope = normalized(rawEnvelope); }
  catch { return output(session, { status: 'rejected', reason: 'invalid-command' }); }
  if (state.poisoned) return output(session, { status: 'blocked', reason: 'source-or-entry-unproved' });
  const fp = fingerprint(envelope);
  const shared = state.ledger.get(ledgerKey(actor, envelope.commandId));
  if (shared && shared.kind !== 'unit')
    return output(session, { status: 'rejected', reason: 'command-conflict' });
  const prior = session.receipts.find(receipt => receipt.actor === actor &&
    receipt.commandId === envelope.commandId);
  if (prior) return prior.payloadFingerprint === fp
    ? output(session, prior.outcome, true) :
      output(session, { status: 'rejected', reason: 'command-conflict' });
  if (session.commandSession.receipts.some(receipt => receipt.actor === actor &&
    receipt.commandId === envelope.commandId))
    return output(session, { status: 'rejected', reason: 'command-conflict' });
  if (turnContinuations.has(session) || moveContinuations.has(session))
    return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
  const match = session.commandSession.match;
  let outcome: DuelUnitPlayOutcomeV2;
  let nextCommandSession = session.commandSession;
  if (match.stage !== 'playing') outcome = { status: 'rejected', reason: 'invalid-phase' };
  else if (!match.roster.some(seat => seat.playerId === actor))
    outcome = { status: 'rejected', reason: 'unknown-actor' };
  else if (envelope.expectedVersion !== match.stateVersion)
    outcome = { status: 'rejected', reason: 'stale-version' };
  else if (match.frame.phase !== 'main' || !match.frame.stateOpen)
    outcome = { status: 'rejected', reason: 'invalid-phase' };
  else if (match.frame.priorityPlayerId !== actor || match.frame.turnPlayerId !== actor)
    outcome = { status: 'rejected', reason: 'no-permission' };
  else if (match.frame.pendingPayment !== null ||
    session.commandSession.requiredTasks.some(task => task.status !== 'completed') ||
    session.commandSession.priorityPayments.some(payment => payment.status === 'active'))
    outcome = { status: 'blocked', reason: 'outstanding-task-or-session' };
  else {
    let costStarted = false;
    try {
      const uid = envelope.command.cardUID;
      const owner = match.players.find(player => player.playerId === actor)!;
      const card = owner.hand.find(item => item.uid === uid);
      check(card && owner.hand.filter(item => item.uid === uid).length === 1, 'UID absent from own hand');
      const physical = match.physicalCardsByUID[uid];
      check(physical && physical.ownerPlayerId === actor && physical.cardId === card.cardId,
        'physical printing/owner mismatch');
      const reference = referenceDuelPhysicalCardV2(match, uid);
      assertCurrentDuelPhysicalReferenceV2(match, reference);
      const program = services.programs.getProgram(card.cardId);
      check(program && program.cardId === card.cardId && program.source.cardId === card.cardId &&
        program.source.cardType === 'Unit' && program.source.dataVersion === match.dataVersion &&
        program.source.sourceCatalogDigest === match.catalogDigest &&
        program.semantics.kind === 'no-ability' &&
        program.semantics.playability.kind === 'printed-unit' &&
        program.semantics.playability.fromHand === true &&
        program.semantics.playability.tokenOnly === false &&
        program.source.might !== null && program.source.might >= 0,
      'whole verified printed Unit program required');
      const original = match.provenance.originalPhysicalCards.find(item => item.uid === uid);
      check(original?.cardType === 'Unit' && original.cardId === card.cardId &&
        original.ownerPlayerId === actor, 'independent physical Unit printing required');
      const baseLocationId = match.board.bases.find(base => base.ownerPlayerId === actor)?.locationId;
      check(baseLocationId && match.resources.bases.some(base =>
        base.playerId === actor && base.locationId === baseLocationId), 'own base binding');
      const request: DuelUnitEntryRequestV2 = Object.freeze({ match, matchId: match.matchId,
        stateVersion: match.stateVersion, eventSeq: match.eventSeq, actor, uid,
        cardId: card.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId,
        programId: program.programId });
      sameFacts(services.entry(request), request, services.programs);
      check(!state.poisoned, 'reentered entry service');
      const transactionId = JSON.stringify([match.matchId, match.stateVersion, actor,
        envelope.commandId, uid, reference.zoneEpoch, baseLocationId]);
      costStarted = true;
      const resolved = resolveDuelTotalCostV2(services.cost,
        { transactionId, subjectId: card.cardId, kind: 'card-play' });
      const costBinding: DuelUnitCostBindingV2 = Object.freeze({
        matchId: match.matchId, stateVersion: match.stateVersion, actor, uid,
        cardId: card.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId,
        transactionId, baseProofId: resolved.baseProofId,
        coverageProofId: resolved.coverageProofId,
      });
      const bound = record(services.costBinding(costBinding),
        ['matchId', 'stateVersion', 'actor', 'uid', 'cardId', 'sourceEpoch',
          'baseLocationId', 'transactionId', 'baseProofId', 'coverageProofId', 'status']);
      check(bound.status === 'complete' && Object.keys(costBinding).every(key =>
        bound[key] === costBinding[key as keyof DuelUnitCostBindingV2]),
      'cost base/source/clock binding unproved');
      check(!state.poisoned, 'reentered cost service');
      const payment = payDuelRuneCost(match.resources, actor, resolved.finalResolvedCost,
        { stateOpen: match.frame.stateOpen, priorityPlayerId: actor,
          resourcePaymentPlayerId: actor }, envelope.command.paymentPlan);
      assertCurrentDuelPhysicalReferenceV2(match, reference);
      const committed = commitDuelCommandMutationV2(session.commandSession, draft => {
        const playerIndex = draft.players.findIndex(player => player.playerId === actor);
        const player = draft.players[playerIndex]!;
        const index = player.hand.findIndex(item => item.uid === uid);
        check(index >= 0 && player.hand[index]!.cardId === card.cardId,
          'hand changed during CardPlay');
        const players: [typeof player, typeof player] = [...draft.players];
        players[playerIndex] = { ...player, hand: player.hand.filter(item => item.uid !== uid) };
        const settled = materializeDuelUnitFromSettledSource(
          { ...draft, players, resources: payment.resources },
          { kind: 'card', uid, cardType: 'Unit', cardId: card.cardId,
            ownerPlayerId: actor, controllerPlayerId: actor, locationId: baseLocationId },
          candidate => candidate === card.cardId);
        return { match: settled, transitions: [{ uid,
          from: { kind: 'hand', zonePlayerId: actor },
          to: { kind: 'chain', zonePlayerId: actor } }, { uid,
          from: { kind: 'chain', zonePlayerId: actor },
          to: { kind: 'board-base', locationId: baseLocationId } }] };
      });
      check(committed.persistRequired && committed.session.match.stateVersion === match.stateVersion + 1,
        'CardPlay must advance one canonical clock');
      nextCommandSession = committed.session;
      outcome = { status: 'applied', appliedVersion: nextCommandSession.match.stateVersion,
        eventSeq: nextCommandSession.match.eventSeq };
    } catch {
      outcome = { status: 'blocked', reason: costStarted ? 'cost-or-payment-unproved' :
        'source-or-entry-unproved' };
    }
  }
  const receipt = Object.freeze({ actor, commandId: envelope.commandId,
    payloadFingerprint: fp, outcome: Object.freeze(outcome) });
  const ledger = new Map(state.ledger);
  ledger.set(ledgerKey(actor, envelope.commandId), { kind: 'unit', fingerprint: fp, outcome });
  const next = publish({ commandSession: nextCommandSession, receipts: [...session.receipts, receipt] },
    services, state.resourceOptions, ledger);
  state.active = false;
  return output(next, outcome, false, true);
  } finally { state.busy = false; }
}

/**
 * Opt-in whole-pure optional Unit CardPlay. This is deliberately a separate
 * entry point: legacy no-ability callers cannot accidentally execute a DATA
 * optional descriptor. The choice receipt is inspected before any cost or
 * lifecycle work, and its decision is frozen into the transaction fingerprint.
 */
export function playDuelOptionalUnitToBaseV2(session: DuelUnitPlaySessionV2, actor: string,
  rawEnvelope: DuelOptionalUnitPlayEnvelopeV2): DuelUnitPlayResultV2 {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) {
    state.poisoned = true;
    return output(session, { status: 'blocked', reason: 'optional-choice-unproved' });
  }
  check(state.active, 'spent action session');
  if (pendingOptionalContinuation(session)) return output(session,
    { status: 'blocked', reason: 'outstanding-task-or-session' });
  const optional = state.services.optional;
  if (!optional || typeof optional.program !== 'function' || typeof optional.inspectChoice !== 'function' ||
      typeof optional.cost !== 'function' || typeof optional.costBinding !== 'function')
    return output(session, { status: 'blocked', reason: 'optional-choice-unproved' });
  state.busy = true;
  state.poisoned = false;
  try {
    let envelope: DuelOptionalUnitPlayEnvelopeV2;
    try { envelope = normalizedOptional(rawEnvelope); }
    catch { return output(session, { status: 'rejected', reason: 'invalid-command' }); }
    const prior = session.receipts.find(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId);
    if (prior) {
      const cached = optionalReceiptOrigins.get(prior);
      const previousDecision = cached?.data.decision;
      const metadataMatches = cached !== undefined && cached.choiceReceipt === envelope.command.choiceReceipt &&
        cached.service === optional && cached.data.matchId === session.commandSession.match.matchId &&
        cached.inspectChoice === optional.inspectChoice && cached.data.actor === actor &&
        cached.data.commandId === envelope.commandId && cached.data.uid === envelope.command.cardUID;
      return metadataMatches && previousDecision && prior.payloadFingerprint === optionalFingerprint(envelope, previousDecision)
        ? output(session, prior.outcome, true) :
        output(session, { status: 'rejected', reason: 'command-conflict' });
    }
    let choiceData: DuelOptionalPlayReceiptDataV1;
    try {
      choiceData = optional.inspectChoice(envelope.command.choiceReceipt);
      check(!state.poisoned, 'reentered choice service');
      record(choiceData, ['matchId', 'actor', 'uid', 'cardId', 'sourceEpoch', 'sourceProgramFingerprint',
        'commandId', 'stateVersion', 'decision']);
      check(choiceData.decision === 'pay' || choiceData.decision === 'decline', 'invalid choice decision');
    } catch {
      return output(session, { status: 'blocked', reason: 'optional-choice-unproved' });
    }
    const fp = optionalFingerprint(envelope, choiceData.decision);
    const shared = state.ledger.get(ledgerKey(actor, envelope.commandId));
    if (shared && shared.kind !== 'unit')
      return output(session, { status: 'rejected', reason: 'command-conflict' });
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId))
      return output(session, { status: 'rejected', reason: 'command-conflict' });
    if (turnContinuations.has(session) || moveContinuations.has(session))
      return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });

    const match = session.commandSession.match;
    let outcome: DuelUnitPlayOutcomeV2;
    let nextCommandSession = session.commandSession;
    if (match.stage !== 'playing') outcome = { status: 'rejected', reason: 'invalid-phase' };
    else if (!match.roster.some(seat => seat.playerId === actor))
      outcome = { status: 'rejected', reason: 'unknown-actor' };
    else if (envelope.expectedVersion !== match.stateVersion)
      outcome = { status: 'rejected', reason: 'stale-version' };
    else if (match.frame.phase !== 'main' || !match.frame.stateOpen)
      outcome = { status: 'rejected', reason: 'invalid-phase' };
    else if (match.frame.priorityPlayerId !== actor || match.frame.turnPlayerId !== actor)
      outcome = { status: 'rejected', reason: 'no-permission' };
    else if (choiceData.matchId !== match.matchId || choiceData.actor !== actor ||
      choiceData.commandId !== envelope.commandId || choiceData.stateVersion !== match.stateVersion)
      outcome = { status: 'blocked', reason: 'optional-choice-unproved' };
    else if (match.frame.pendingPayment !== null ||
      session.commandSession.requiredTasks.some(task => task.status !== 'completed') ||
      session.commandSession.priorityPayments.some(payment => payment.status === 'active'))
      outcome = { status: 'blocked', reason: 'outstanding-task-or-session' };
    else {
      let costStarted = false;
      try {
        const uid = envelope.command.cardUID;
        check(choiceData.uid === uid, 'choice UID mismatch');
        const owner = match.players.find(player => player.playerId === actor)!;
        const card = owner.hand.find(item => item.uid === uid);
        check(card && owner.hand.filter(item => item.uid === uid).length === 1,
          'UID absent from own hand');
        const physical = match.physicalCardsByUID[uid];
        check(physical && physical.ownerPlayerId === actor && physical.cardId === card.cardId,
          'physical printing/owner mismatch');
        const reference = referenceDuelPhysicalCardV2(match, uid);
        assertCurrentDuelPhysicalReferenceV2(match, reference);
        check(choiceData.sourceEpoch === reference.zoneEpoch && choiceData.cardId === card.cardId,
          'choice physical identity mismatch');
        const programRequest: DuelOptionalUnitProgramRequestV2 = Object.freeze({
          match, matchId: match.matchId, dataVersion: match.dataVersion,
          catalogDigest: match.catalogDigest, actor, uid, cardId: card.cardId,
          sourceEpoch: reference.zoneEpoch,
        });
        const binding = record(optional.program(programRequest), ['matchId', 'dataVersion',
          'catalogDigest', 'actor', 'uid', 'cardId', 'sourceEpoch', 'programFingerprint', 'description']);
        check(!state.poisoned, 'reentered optional program service');
        check(binding.matchId === match.matchId && binding.dataVersion === match.dataVersion &&
          binding.catalogDigest === match.catalogDigest && binding.actor === actor &&
          binding.uid === uid && binding.cardId === card.cardId &&
          binding.sourceEpoch === reference.zoneEpoch &&
          binding.programFingerprint === choiceData.sourceProgramFingerprint,
        'optional program/choice binding mismatch');
        const description = binding.description as DuelOptionalPlayCostV1Known;
        check(description.status === 'known' && description.kind === 'optional-play-cost-v1' &&
          description.cardId === card.cardId && description.semantics.kind === 'accelerate' &&
          description.semantics.choiceTiming === 'card-play-choices' &&
          description.semantics.optional === true &&
          description.semantics.paidEffect.kind === 'enter-ready-replacement' &&
          description.semantics.paidEffect.timing === 'unit-entry',
        'whole pure optional Unit program required');
        const original = match.provenance.originalPhysicalCards.find(item => item.uid === uid);
        check(original?.cardType === 'Unit' && original.cardId === card.cardId &&
          original.ownerPlayerId === actor, 'independent physical Unit printing required');
        const baseLocationId = match.board.bases.find(base => base.ownerPlayerId === actor)?.locationId;
        check(baseLocationId && match.resources.bases.some(base =>
          base.playerId === actor && base.locationId === baseLocationId), 'own base binding');
        const entryRequest: DuelUnitEntryRequestV2 = Object.freeze({ match,
          matchId: match.matchId, stateVersion: match.stateVersion, eventSeq: match.eventSeq,
          actor, uid, cardId: card.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId,
          programId: binding.programFingerprint });
        const entryFacts = (optional.entry ?? state.services.entry)(entryRequest);
        sameOptionalFacts(entryFacts, entryRequest, state.services.programs);
        check(!state.poisoned, 'reentered optional entry service');
        const transactionId = JSON.stringify([match.matchId, match.stateVersion, actor,
          envelope.commandId, uid, reference.zoneEpoch, choiceData.commandId,
          choiceData.decision]);
        costStarted = true;
        const resolved = resolveDuelTotalCostV2(optional.cost({ transactionId, cardId: card.cardId,
          actor, uid, sourceEpoch: reference.zoneEpoch, choice: choiceData.decision,
          description, receipt: choiceData }),
          { transactionId, subjectId: card.cardId, kind: 'card-play' });
        const accelerate = resolved.applications.filter(application =>
          application.modifierId === `accelerate:${uid}`);
        const additional = description.semantics.additionalCost;
        const validAdditional = accelerate.length === 1 && accelerate[0]!.stage === 'additional' &&
          accelerate[0]!.target.kind === 'new-component' && accelerate[0]!.before.energy === 0 &&
          accelerate[0]!.before.power.length === 0 &&
          accelerate[0]!.after.energy === additional.energy &&
          JSON.stringify(accelerate[0]!.after.power) === JSON.stringify(additional.power);
        check(choiceData.decision === 'pay' ? validAdditional : accelerate.length === 0,
          'optional cost application does not match chosen Accelerate');
        const costBinding: DuelUnitCostBindingV2 = Object.freeze({
          matchId: match.matchId, stateVersion: match.stateVersion, actor, uid,
          cardId: card.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId,
          transactionId, baseProofId: resolved.baseProofId,
          coverageProofId: resolved.coverageProofId,
        });
        const bound = record(optional.costBinding(costBinding),
          ['matchId', 'stateVersion', 'actor', 'uid', 'cardId', 'sourceEpoch',
            'baseLocationId', 'transactionId', 'baseProofId', 'coverageProofId', 'status']);
        check(bound.status === 'complete' && Object.keys(costBinding).every(key =>
          bound[key] === costBinding[key as keyof DuelUnitCostBindingV2]),
        'optional cost binding unproved');
        check(!state.poisoned, 'reentered optional cost service');
        const payment = payDuelRuneCost(match.resources, actor, resolved.finalResolvedCost,
          { stateOpen: match.frame.stateOpen, priorityPlayerId: actor,
            resourcePaymentPlayerId: actor }, envelope.command.paymentPlan);
        assertCurrentDuelPhysicalReferenceV2(match, reference);
        const committed = commitDuelCommandMutationV2(session.commandSession, draft => {
          const playerIndex = draft.players.findIndex(player => player.playerId === actor);
          const player = draft.players[playerIndex]!;
          const index = player.hand.findIndex(item => item.uid === uid);
          check(index >= 0 && player.hand[index]!.cardId === card.cardId,
            'hand changed during optional CardPlay');
          const players: [typeof player, typeof player] = [...draft.players];
          players[playerIndex] = { ...player, hand: player.hand.filter(item => item.uid !== uid) };
          const source = { kind: 'card' as const, uid, cardType: 'Unit' as const,
            cardId: card.cardId, ownerPlayerId: actor, controllerPlayerId: actor,
            locationId: baseLocationId,
            ...(choiceData.decision === 'pay' ? { entryReplacement: 'enter-ready' as const } : {}) };
          const settled = materializeDuelUnitFromSettledSource(
            { ...draft, players, resources: payment.resources }, source,
            candidate => candidate === card.cardId);
          return { match: settled, transitions: [{ uid,
            from: { kind: 'hand', zonePlayerId: actor },
            to: { kind: 'chain', zonePlayerId: actor } }, { uid,
            from: { kind: 'chain', zonePlayerId: actor },
            to: { kind: 'board-base', locationId: baseLocationId } }] };
        });
        check(committed.persistRequired && committed.session.match.stateVersion === match.stateVersion + 1,
          'optional CardPlay must advance one canonical clock');
        nextCommandSession = committed.session;
        outcome = { status: 'applied', appliedVersion: nextCommandSession.match.stateVersion,
          eventSeq: nextCommandSession.match.eventSeq };
      } catch {
        outcome = { status: 'blocked', reason: costStarted ? 'cost-or-payment-unproved' :
          'source-or-entry-unproved' };
      }
    }
    const receipt = Object.freeze({ actor, commandId: envelope.commandId,
      payloadFingerprint: fp, outcome: Object.freeze(outcome) });
    optionalReceiptOrigins.set(receipt, Object.freeze({
      choiceReceipt: envelope.command.choiceReceipt, service: optional,
      inspectChoice: optional.inspectChoice,
      data: Object.freeze({ matchId: choiceData.matchId, actor: choiceData.actor, uid: choiceData.uid,
        cardId: choiceData.cardId, sourceEpoch: choiceData.sourceEpoch,
        sourceProgramFingerprint: choiceData.sourceProgramFingerprint, commandId: choiceData.commandId,
        stateVersion: choiceData.stateVersion, decision: choiceData.decision })
    }));
    const ledger = new Map(state.ledger);
    ledger.set(ledgerKey(actor, envelope.commandId), { kind: 'unit', fingerprint: fp, outcome });
    const next = publish({ commandSession: nextCommandSession, receipts: [...session.receipts, receipt] },
      state.services, state.resourceOptions, ledger);
    state.active = false;
    return output(next, outcome, false, true);
  } finally { state.busy = false; }
}

function optionalPaymentOutput(session: DuelUnitPlaySessionV2,
  outcome: DuelOptionalUnitPaymentOutcomeV3 | DuelUnitResourceOutcomeV2,
  duplicate = false, persistRequired = false): DuelOptionalUnitPaymentResultV3 {
  return Object.freeze({ session, outcome, duplicate, persistRequired });
}

function optionalPaymentSource(cardId: string, uid: string): DuelPaymentSourceReference {
  return Object.freeze({ kind: 'card', referenceId: cardId, sourceUID: uid });
}

function optionalPaymentFingerprint(envelope: DuelOptionalUnitPaymentBeginEnvelopeV3): string {
  return JSON.stringify([envelope.expectedVersion, envelope.command.cardUID]);
}

function optionalPaymentResumeFingerprint(envelope: DuelOptionalUnitPaymentResumeEnvelopeV3): string {
  return JSON.stringify([envelope.expectedVersion, envelope.command.cardUID]);
}

/**
 * V3 begins an optional Unit play by resolving the complete choice-bound cost
 * and installing the real Core pending-payment window. The hand and board are
 * untouched until the payment command has closed that window and resume proves
 * the same native lineage at the current head.
 */
export function beginDuelOptionalUnitPaymentV3(session: DuelUnitPlaySessionV2, actor: string,
  rawEnvelope: DuelOptionalUnitPaymentBeginEnvelopeV3): DuelOptionalUnitPaymentResultV3 {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) {
    state.poisoned = true;
    return optionalPaymentOutput(session, { status: 'blocked', reason: 'reentrant-command' });
  }
  check(state.active, 'spent action session');
  state.busy = true;
  state.poisoned = false;
  try {
    let envelope: DuelOptionalUnitPaymentBeginEnvelopeV3;
    try { envelope = normalizedOptionalPaymentBegin(rawEnvelope); }
    catch { return optionalPaymentOutput(session, { status: 'rejected', reason: 'invalid-command' }); }
    const existing = optionalPaymentV3.get(session as object);
    if (existing?.status === 'pending' || (existing?.status === 'completed' &&
        existing.commandId === envelope.commandId)) {
      if (existing.actor === actor && existing.commandId === envelope.commandId &&
          existing.cardUID === envelope.command.cardUID &&
          existing.choiceReceipt === envelope.command.choiceReceipt &&
          existing.origin.commandSession.match.stateVersion === envelope.expectedVersion)
        return optionalPaymentOutput(session, existing.beginOutcome, true);
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'command-conflict' });
    }
    const fp = optionalPaymentFingerprint(envelope);
    const key = ledgerKey(actor, envelope.commandId);
    const shared = state.ledger.get(key);
    if (shared) {
      if (shared.kind === 'optional-payment-begin' && shared.fingerprint === fp &&
          shared.choiceReceipt === envelope.command.choiceReceipt)
        return optionalPaymentOutput(session, shared.outcome as DuelOptionalUnitPaymentOutcomeV3, true);
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'command-conflict' });
    }
    if (session.receipts.some(receipt => receipt.actor === actor && receipt.commandId === envelope.commandId) ||
        session.commandSession.receipts.some(receipt => receipt.actor === actor && receipt.commandId === envelope.commandId))
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'command-conflict' });
    if (turnContinuations.has(session) || moveContinuations.has(session))
      return optionalPaymentOutput(session, { status: 'blocked', reason: 'outstanding-task-or-session' });

    const optional = state.services.optional;
    const paymentServices = state.services.optionalPaymentV3;
    if (!optional || typeof optional.program !== 'function' || typeof optional.inspectChoice !== 'function' ||
        typeof optional.cost !== 'function' || typeof optional.costBinding !== 'function' ||
        !paymentServices || typeof paymentServices.sourceAttestor !== 'function')
      return optionalPaymentOutput(session, { status: 'blocked', reason: 'optional-choice-unproved' });
    const match = session.commandSession.match;
    if (match.stage !== 'playing') return optionalPaymentOutput(session,
      { status: 'rejected', reason: 'invalid-phase' });
    if (!match.roster.some(seat => seat.playerId === actor)) return optionalPaymentOutput(session,
      { status: 'rejected', reason: 'unknown-actor' });
    if (envelope.expectedVersion !== match.stateVersion) return optionalPaymentOutput(session,
      { status: 'rejected', reason: 'stale-version' });
    if (match.frame.phase !== 'main' || !match.frame.stateOpen) return optionalPaymentOutput(session,
      { status: 'rejected', reason: 'invalid-phase' });
    if (match.frame.priorityPlayerId !== actor || match.frame.turnPlayerId !== actor)
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'no-permission' });
    if (match.frame.pendingPayment !== null ||
        session.commandSession.requiredTasks.some(task => task.status !== 'completed') ||
        session.commandSession.priorityPayments.some(payment => payment.status === 'active'))
      return optionalPaymentOutput(session, { status: 'blocked', reason: 'outstanding-task-or-session' });

    let costStarted = false;
    let choiceProved = false;
    try {
      let choiceData: DuelOptionalPlayReceiptDataV1;
      try {
        choiceData = optional.inspectChoice(envelope.command.choiceReceipt);
        check(!state.poisoned, 'reentered choice service');
        record(choiceData, ['matchId', 'actor', 'uid', 'cardId', 'sourceEpoch', 'sourceProgramFingerprint',
          'commandId', 'stateVersion', 'decision']);
        check(choiceData.decision === 'pay' || choiceData.decision === 'decline', 'choice decision');
        choiceProved = true;
      } catch { throw new Error('choice'); }
      check(choiceData.matchId === match.matchId && choiceData.actor === actor &&
        choiceData.commandId === envelope.commandId && choiceData.stateVersion === match.stateVersion &&
        choiceData.uid === envelope.command.cardUID, 'choice/head binding');
      const uid = envelope.command.cardUID;
      const owner = match.players.find(player => player.playerId === actor)!;
      const card = owner.hand.find(item => item.uid === uid);
      check(card && owner.hand.filter(item => item.uid === uid).length === 1, 'UID absent from own hand');
      const physical = match.physicalCardsByUID[uid];
      check(physical && physical.ownerPlayerId === actor && physical.cardId === card.cardId,
        'physical printing/owner mismatch');
      const reference = referenceDuelPhysicalCardV2(match, uid);
      assertCurrentDuelPhysicalReferenceV2(match, reference);
      check(choiceData.sourceEpoch === reference.zoneEpoch && choiceData.cardId === card.cardId,
        'choice physical identity mismatch');
      const programRequest: DuelOptionalUnitProgramRequestV2 = Object.freeze({
        match, matchId: match.matchId, dataVersion: match.dataVersion,
        catalogDigest: match.catalogDigest, actor, uid, cardId: card.cardId,
        sourceEpoch: reference.zoneEpoch,
      });
      const binding = record(optional.program(programRequest), ['matchId', 'dataVersion', 'catalogDigest',
        'actor', 'uid', 'cardId', 'sourceEpoch', 'programFingerprint', 'description']);
      check(!state.poisoned, 'reentered optional program service');
      check(binding.matchId === match.matchId && binding.dataVersion === match.dataVersion &&
        binding.catalogDigest === match.catalogDigest && binding.actor === actor && binding.uid === uid &&
        binding.cardId === card.cardId && binding.sourceEpoch === reference.zoneEpoch &&
        binding.programFingerprint === choiceData.sourceProgramFingerprint, 'program/choice binding');
      const description = binding.description as DuelOptionalPlayCostV1Known;
      check(description.status === 'known' && description.kind === 'optional-play-cost-v1' &&
        description.cardId === card.cardId && description.semantics.kind === 'accelerate' &&
        description.semantics.choiceTiming === 'card-play-choices' && description.semantics.optional === true &&
        description.semantics.paidEffect.kind === 'enter-ready-replacement' &&
        description.semantics.paidEffect.timing === 'unit-entry', 'whole optional Unit program');
      const original = match.provenance.originalPhysicalCards.find(item => item.uid === uid);
      check(original?.cardType === 'Unit' && original.cardId === card.cardId && original.ownerPlayerId === actor,
        'independent physical Unit printing');
      const baseLocationId = match.board.bases.find(base => base.ownerPlayerId === actor)?.locationId;
      check(baseLocationId && match.resources.bases.some(base => base.playerId === actor &&
        base.locationId === baseLocationId), 'own base binding');
      const entryRequest: DuelUnitEntryRequestV2 = Object.freeze({ match,
        matchId: match.matchId, stateVersion: match.stateVersion, eventSeq: match.eventSeq,
        actor, uid, cardId: card.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId,
        programId: binding.programFingerprint });
      sameOptionalFacts((optional.entry ?? state.services.entry)(entryRequest), entryRequest, state.services.programs);
      check(!state.poisoned, 'reentered optional entry service');
      const transactionId = JSON.stringify(['optional-unit-v3', match.matchId, match.stateVersion,
        actor, envelope.commandId, uid, reference.zoneEpoch, choiceData.decision]);
      costStarted = true;
      const resolved = resolveDuelTotalCostV2(optional.cost({ transactionId, cardId: card.cardId,
        actor, uid, sourceEpoch: reference.zoneEpoch, choice: choiceData.decision,
        description, receipt: choiceData }), { transactionId, subjectId: card.cardId, kind: 'card-play' });
      const costBinding: DuelUnitCostBindingV2 = Object.freeze({
        matchId: match.matchId, stateVersion: match.stateVersion, actor, uid,
        cardId: card.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId,
        transactionId, baseProofId: resolved.baseProofId, coverageProofId: resolved.coverageProofId,
      });
      const bound = record(optional.costBinding(costBinding), ['matchId', 'stateVersion', 'actor', 'uid',
        'cardId', 'sourceEpoch', 'baseLocationId', 'transactionId', 'baseProofId', 'coverageProofId', 'status']);
      check(bound.status === 'complete' && Object.keys(costBinding).every(key =>
        bound[key] === costBinding[key as keyof DuelUnitCostBindingV2]), 'cost binding');
      check(!state.poisoned, 'reentered optional cost service');
      const source = optionalPaymentSource(card.cardId, uid);
      const task: DuelRequiredCostTaskV2 = {
        matchId: match.matchId, expectedVersion: match.stateVersion,
        taskId: `unit-optional-v3-task:${actor}:${envelope.commandId}`,
        paymentId: `unit-optional-v3-payment:${actor}:${envelope.commandId}`,
        actor, finalResolvedCost: resolved.finalResolvedCost, opaqueSource: source,
        continuationId: `unit-optional-v3-continuation:${actor}:${envelope.commandId}`,
      };
      const attestor = ((request) => {
        const result = paymentServices.sourceAttestor(request);
        check(!state.poisoned, 'reentered optional payment attestor');
        return result;
      }) as DuelSourceAttestorV2;
      const issued = issueDuelRequiredCostTaskV2(session.commandSession, task, attestor);
      const prepared = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, attestor);
      const preparedMatch = prepared.session.match as DuelCanonicalPlayingStateV2;
      check(!state.poisoned && preparedMatch.stage === 'playing' && preparedMatch.frame.pendingPayment !== null,
        'canonical pending payment was not installed');
      const beginOutcome: DuelOptionalUnitPaymentOutcomeV3 = { status: 'pending', step: 'payment',
        cardUID: uid, taskId: task.taskId, paymentId: task.paymentId, decision: choiceData.decision };
      const pending: OptionalPaymentV3State = {
        actor, commandId: envelope.commandId, cardUID: uid, cardId: card.cardId,
        sourceEpoch: reference.zoneEpoch, decision: choiceData.decision,
        choiceReceipt: envelope.command.choiceReceipt, choiceData: Object.freeze({ ...choiceData }),
        description, programFingerprint: binding.programFingerprint, baseLocationId,
        transactionId,
        task, resolved, authority: paymentServices, origin: session, status: 'pending', beginOutcome,
      };
      const ledger = new Map(state.ledger);
      ledger.set(key, { kind: 'optional-payment-begin', fingerprint: fp, outcome: beginOutcome,
        choiceReceipt: envelope.command.choiceReceipt });
      const next = publish({ commandSession: prepared.session, receipts: session.receipts },
        state.services, state.resourceOptions, ledger);
      optionalPaymentV3.set(next, pending);
      state.active = false;
      return optionalPaymentOutput(next, beginOutcome, false, true);
    } catch {
      return optionalPaymentOutput(session, { status: 'blocked',
        reason: !choiceProved ? 'optional-choice-unproved' :
          costStarted ? 'cost-or-payment-unproved' : 'source-or-entry-unproved' });
    }
  } finally { state.busy = false; }
}

/** Apply Rune/Gold commands to the V3 pending payment using the same canonical
 * Unit ledger. The V3 source attestor is selected by the forwarding V2 helper,
 * so a payment cannot be settled with a caller-supplied boolean or fake DTO. */
export function applyDuelOptionalUnitPaymentResourceCommandV3(session: DuelUnitPlaySessionV2,
  actor: string, envelope: DuelCommandEnvelopeV2): DuelOptionalUnitPaymentResultV3 {
  const pending = optionalPaymentV3.get(session as object);
  if (!pending) return optionalPaymentOutput(session,
    { status: 'blocked', reason: 'outstanding-task-or-session' });
  const result = applyDuelUnitResourceCommandV2(session, actor, envelope);
  if (result.persistRequired) optionalPaymentV3.set(result.session, pending);
  return optionalPaymentOutput(result.session, result.outcome, result.duplicate, result.persistRequired);
}

/** Read-only process-local V3 state. The choice receipt, source authority and
 * resolver service remain private; cost applications are the auditable trace. */
export function inspectDuelOptionalUnitPaymentV3(session: DuelUnitPlaySessionV2):
  Readonly<DuelOptionalUnitPaymentPrivateStateV3> | null {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  const pending = optionalPaymentV3.get(session as object);
  if (!pending) return null;
  return Object.freeze({ status: pending.status, actor: pending.actor, commandId: pending.commandId,
    cardUID: pending.cardUID, sourceUID: pending.cardUID, cardId: pending.cardId, sourceEpoch: pending.sourceEpoch,
    programFingerprint: pending.programFingerprint, baseLocationId: pending.baseLocationId,
    decision: pending.decision, taskId: pending.task.taskId, paymentId: pending.task.paymentId,
    continuationId: pending.task.continuationId, transactionId: pending.transactionId,
    baseProofId: pending.resolved.baseProofId, coverageProofId: pending.resolved.coverageProofId,
    resolvedCost: pending.resolved.finalResolvedCost, applications: pending.resolved.applications });
}

/** Close the payment continuation and enter the Unit exactly once. */
export function resumeDuelOptionalUnitPaymentV3(session: DuelUnitPlaySessionV2, actor: string,
  rawEnvelope: DuelOptionalUnitPaymentResumeEnvelopeV3): DuelOptionalUnitPaymentResultV3 {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) {
    state.poisoned = true;
    return optionalPaymentOutput(session, { status: 'blocked', reason: 'reentrant-command' });
  }
  check(state.active, 'spent action session');
  state.busy = true;
  state.poisoned = false;
  try {
    let envelope: DuelOptionalUnitPaymentResumeEnvelopeV3;
    try { envelope = normalizedOptionalPaymentResume(rawEnvelope); }
    catch { return optionalPaymentOutput(session, { status: 'rejected', reason: 'invalid-command' }); }
    const pending = optionalPaymentV3.get(session as object);
    if (!pending) return optionalPaymentOutput(session,
      { status: 'blocked', reason: 'wrong-task-or-session' });
    const fp = optionalPaymentResumeFingerprint(envelope);
    const key = ledgerKey(actor, envelope.commandId);
    const shared = state.ledger.get(key);
    if (shared) {
      if (shared.kind === 'optional-payment-resume' && shared.fingerprint === fp)
        return optionalPaymentOutput(session, shared.outcome as DuelOptionalUnitPaymentOutcomeV3, true);
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'command-conflict' });
    }
    if (session.receipts.some(receipt => receipt.actor === actor && receipt.commandId === envelope.commandId) ||
        session.commandSession.receipts.some(receipt => receipt.actor === actor &&
          receipt.commandId === envelope.commandId))
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'command-conflict' });
    if (pending.status === 'completed') {
      if (pending.resumeCommandId === envelope.commandId && pending.resumeFingerprint === fp &&
          pending.actor === actor && pending.cardUID === envelope.command.cardUID)
        return optionalPaymentOutput(session, pending.completedOutcome!, true);
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'command-conflict' });
    }
    if (pending.actor !== actor) return optionalPaymentOutput(session,
      { status: 'rejected', reason: 'no-permission' });
    const match = session.commandSession.match;
    if (envelope.expectedVersion !== match.stateVersion) return optionalPaymentOutput(session,
      { status: 'rejected', reason: 'stale-version' });
    if (envelope.command.cardUID !== pending.cardUID) return optionalPaymentOutput(session,
      { status: 'rejected', reason: 'command-conflict' });
    if (match.stage !== 'playing' || match.frame.phase !== 'main' || !match.frame.stateOpen)
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'invalid-phase' });
    if (match.frame.turnPlayerId !== actor || match.frame.priorityPlayerId !== actor)
      return optionalPaymentOutput(session, { status: 'rejected', reason: 'no-permission' });
    if (match.frame.pendingPayment !== null ||
        session.commandSession.requiredTasks.some(task => task.status !== 'completed') ||
        session.commandSession.priorityPayments.some(payment => payment.status === 'active'))
      return optionalPaymentOutput(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    try {
      const currentMatch = match as DuelCanonicalPlayingStateV2;
      const originMatch = pending.origin.commandSession.match as DuelCanonicalPlayingStateV2;
      inspectDuelNativeCommandSessionPathV2(pending.origin.commandSession, session.commandSession);
      check(currentMatch.matchId === pending.task.matchId && currentMatch.dataVersion === originMatch.dataVersion &&
        currentMatch.catalogDigest === originMatch.catalogDigest,
      'foreign current head');
      check(currentMatch.frame.turnNumber === originMatch.frame.turnNumber &&
        currentMatch.frame.turnPlayerId === pending.actor, 'turn/control changed during payment');
      const owner = match.players.find(player => player.playerId === actor)!;
      const card = owner.hand.find(item => item.uid === pending.cardUID);
      check(card && owner.hand.filter(item => item.uid === pending.cardUID).length === 1 && card.cardId === pending.cardId,
        'pending Unit source no longer in own Hand');
      const physical = match.physicalCardsByUID[pending.cardUID];
      check(physical && physical.ownerPlayerId === actor && physical.cardId === pending.cardId,
        'pending physical source mismatch');
      const reference = referenceDuelPhysicalCardV2(match, pending.cardUID);
      assertCurrentDuelPhysicalReferenceV2(match, reference);
      check(reference.zoneEpoch === pending.sourceEpoch, 'pending source epoch changed');
      const original = match.provenance.originalPhysicalCards.find(item => item.uid === pending.cardUID);
      check(original?.cardType === 'Unit' && original.cardId === pending.cardId && original.ownerPlayerId === actor,
        'pending physical provenance changed');
      const optional = state.services.optional;
      check(optional && typeof optional.program === 'function', 'optional program service unavailable');
      const binding = record(optional.program({ match, matchId: match.matchId, dataVersion: match.dataVersion,
        catalogDigest: match.catalogDigest, actor, uid: pending.cardUID, cardId: pending.cardId,
        sourceEpoch: reference.zoneEpoch }), ['matchId', 'dataVersion', 'catalogDigest', 'actor', 'uid',
          'cardId', 'sourceEpoch', 'programFingerprint', 'description']);
      check(binding.matchId === match.matchId && binding.dataVersion === match.dataVersion &&
        binding.catalogDigest === match.catalogDigest && binding.actor === actor && binding.uid === pending.cardUID &&
        binding.cardId === pending.cardId && binding.sourceEpoch === pending.sourceEpoch &&
        binding.programFingerprint === pending.programFingerprint, 'current program binding changed');
      const entryRequest: DuelUnitEntryRequestV2 = Object.freeze({ match, matchId: match.matchId,
        stateVersion: match.stateVersion, eventSeq: match.eventSeq, actor, uid: pending.cardUID,
        cardId: pending.cardId, sourceEpoch: reference.zoneEpoch, baseLocationId: pending.baseLocationId,
        programId: pending.programFingerprint });
      sameOptionalFacts((optional.entry ?? state.services.entry)(entryRequest), entryRequest, state.services.programs);
      check(!state.poisoned, 'reentered current entry proof');
      const committed = commitDuelCommandMutationV2(session.commandSession, draft => {
        const playerIndex = draft.players.findIndex(player => player.playerId === actor);
        const player = draft.players[playerIndex]!;
        const index = player.hand.findIndex(item => item.uid === pending.cardUID);
        check(index >= 0 && player.hand[index]!.cardId === pending.cardId, 'Hand changed during V3 resume');
        const players: [typeof player, typeof player] = [...draft.players];
        players[playerIndex] = { ...player, hand: player.hand.filter(item => item.uid !== pending.cardUID) };
        const source = { kind: 'card' as const, uid: pending.cardUID, cardType: 'Unit' as const,
          cardId: pending.cardId, ownerPlayerId: actor, controllerPlayerId: actor,
          locationId: pending.baseLocationId,
          ...(pending.decision === 'pay' ? { entryReplacement: 'enter-ready' as const } : {}) };
        const settled = materializeDuelUnitFromSettledSource({ ...draft, players }, source,
          candidate => candidate === pending.cardId);
        return { match: settled, transitions: [{ uid: pending.cardUID,
          from: { kind: 'hand', zonePlayerId: actor },
          to: { kind: 'chain', zonePlayerId: actor } }, { uid: pending.cardUID,
          from: { kind: 'chain', zonePlayerId: actor },
          to: { kind: 'board-base', locationId: pending.baseLocationId } }] };
      });
      check(committed.persistRequired && committed.session.match.stateVersion === match.stateVersion + 1,
        'V3 Unit entry must advance one canonical clock');
      const outcome: DuelOptionalUnitPaymentOutcomeV3 = { status: 'applied',
        appliedVersion: committed.session.match.stateVersion, eventSeq: committed.session.match.eventSeq,
        cardUID: pending.cardUID, decision: pending.decision };
      const resumeReceipt = Object.freeze({ actor, commandId: envelope.commandId,
        payloadFingerprint: fp,
        outcome: Object.freeze({ status: 'applied' as const,
          appliedVersion: outcome.appliedVersion, eventSeq: outcome.eventSeq }) });
      pending.status = 'completed';
      pending.completedOutcome = outcome;
      pending.resumeCommandId = envelope.commandId;
      pending.resumeFingerprint = fp;
      const ledger = new Map(state.ledger);
      ledger.set(key, { kind: 'optional-payment-resume', fingerprint: fp, outcome });
      const next = publish({ commandSession: committed.session,
        receipts: [...session.receipts, resumeReceipt] }, state.services, state.resourceOptions, ledger);
      optionalPaymentV3.set(next, pending);
      state.active = false;
      return optionalPaymentOutput(next, outcome, false, true);
    } catch {
      return optionalPaymentOutput(session, { status: 'blocked', reason: 'unproven-entry' });
    }
  } finally { state.busy = false; }
}

/** Descriptive aliases for parent adapters. */
export const startDuelOptionalUnitPaymentV3 = beginDuelOptionalUnitPaymentV3;
export const applyDuelOptionalUnitResourceCommandV3 = applyDuelOptionalUnitPaymentResourceCommandV3;
export const finishDuelOptionalUnitPaymentV3 = resumeDuelOptionalUnitPaymentV3;

function outcomeFromTurn(result: ReturnType<typeof runDuelStartOfTurnV2>): DuelUnitTurnOutcomeV2 {
  if (result.status === 'pending' && result.pending)
    return { status: 'pending', taskId: result.pending.taskId, phase: result.pending.step };
  if (result.status === 'main' || result.status === 'awaiting-turn-start' || result.status === 'ended')
    return { status: 'applied', phase: result.status,
      appliedVersion: result.session.match.stateVersion, eventSeq: result.session.match.eventSeq };
  return { status: 'rejected', reason: result.reason ?? result.status };
}
function turnCommand(session: DuelUnitPlaySessionV2, actor: string, raw: DuelUnitTurnEnvelopeV2,
  kind: 'start-turn' | 'end-turn'): DuelUnitTurnResultV2 {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) { state.poisoned = true;
    return output(session, { status: 'blocked', reason: 'turn-resolution-unproved' }); }
  check(state.active, 'spent action session');
  if (pendingOptionalContinuation(session)) return output(session,
    { status: 'blocked', reason: 'turn-resolution-unproved' });
  state.busy = true; state.poisoned = false;
  try {
    let envelope: DuelUnitTurnEnvelopeV2;
    try { envelope = normalizedTurn(raw); } catch {
      return output(session, { status: 'rejected', reason: 'invalid-command' }); }
    if (envelope.command.type !== kind) return output(session,
      { status: 'rejected', reason: 'invalid-command' });
    const key = ledgerKey(actor, envelope.commandId), fp = turnFingerprint(envelope);
    const prior = state.ledger.get(key);
    if (prior) return output(session, prior.kind === 'turn' && prior.fingerprint === fp
      ? prior.outcome as DuelUnitTurnOutcomeV2 : { status: 'rejected', reason: 'command-conflict' },
    prior.kind === 'turn' && prior.fingerprint === fp);
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId) || session.receipts.some(receipt =>
      receipt.actor === actor && receipt.commandId === envelope.commandId))
      return output(session, { status: 'rejected', reason: 'command-conflict' });
    if (turnContinuations.has(session) || moveContinuations.has(session))
      return output(session, { status: 'blocked', reason: 'turn-resolution-unproved' });
    const match = session.commandSession.match;
    if (match.stage !== 'playing') return output(session,
      { status: 'rejected', reason: 'invalid-phase' });
    if (!match.roster.some(seat => seat.playerId === actor))
      return output(session, { status: 'rejected', reason: 'unknown-actor' });
    if (envelope.expectedVersion !== match.stateVersion)
      return output(session, { status: 'rejected', reason: 'stale-version' });
    if (match.frame.turnPlayerId !== actor)
      return output(session, { status: 'rejected', reason: 'no-permission' });
    if (!state.services.turn) return output(session,
      { status: 'blocked', reason: 'turn-services-unavailable' });
    const result = kind === 'start-turn'
      ? runDuelStartOfTurnV2(session.commandSession, state.services.turn)
      : runDuelEndOfTurnV2(session.commandSession, actor, state.services.turn);
    if (state.poisoned) return output(session,
      { status: 'blocked', reason: 'turn-resolution-unproved' });
    const outcome = outcomeFromTurn(result);
    if (!result.persistRequired) return output(session, outcome);
    const ledger = new Map(state.ledger);
    ledger.set(key, { kind: 'turn', fingerprint: fp, outcome,
      ...(outcome.status === 'pending' ? { pendingTaskId: outcome.taskId } : {}) });
    const next = publish({ commandSession: result.session, receipts: session.receipts },
      state.services, state.resourceOptions, ledger);
    if (outcome.status === 'pending') turnContinuations.set(next, {
      actor, commandId: envelope.commandId, fingerprint: fp,
      taskId: outcome.taskId, kind });
    state.active = false;
    return output(next, outcome, false, true);
  } finally { state.busy = false; }
}
export function startDuelUnitTurnV2(session: DuelUnitPlaySessionV2, actor: string,
  envelope: DuelUnitTurnEnvelopeV2): DuelUnitTurnResultV2 {
  return turnCommand(session, actor, envelope, 'start-turn');
}
export function endDuelUnitTurnV2(session: DuelUnitPlaySessionV2, actor: string,
  envelope: DuelUnitTurnEnvelopeV2): DuelUnitTurnResultV2 {
  return turnCommand(session, actor, envelope, 'end-turn');
}
export function resumeDuelUnitTurnV2(session: DuelUnitPlaySessionV2, actor: string,
  commandId: string, taskId: string): DuelUnitTurnResultV2 {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) { state.poisoned = true;
    return output(session, { status: 'blocked', reason: 'turn-resolution-unproved' }); }
  check(state.active, 'spent action session');
  const continuation = turnContinuations.get(session);
  if (!continuation || continuation.actor !== actor || continuation.commandId !== commandId ||
    continuation.taskId !== taskId)
    return output(session, { status: 'rejected', reason: 'wrong-task-or-session' });
  if (!state.services.turn) return output(session,
    { status: 'blocked', reason: 'turn-services-unavailable' });
  state.busy = true; state.poisoned = false;
  try {
    const match = session.commandSession.match;
    if (match.stage !== 'playing') return output(session,
      { status: 'rejected', reason: 'invalid-phase' });
    const resolution = { status: 'retry' as const, matchId: match.matchId,
      turn: match.frame.turnNumber, taskId };
    const result = continuation.kind === 'start-turn'
      ? resumeDuelStartOfTurnV2(session.commandSession, taskId, resolution, state.services.turn)
      : resumeDuelEndOfTurnV2(session.commandSession, taskId, resolution, state.services.turn);
    if (state.poisoned) return output(session,
      { status: 'blocked', reason: 'turn-resolution-unproved' });
    const outcome = outcomeFromTurn(result);
    if (!result.persistRequired) return output(session, outcome);
    const ledger = new Map(state.ledger), key = ledgerKey(actor, commandId);
    ledger.set(key, { kind: 'turn', fingerprint: continuation.fingerprint, outcome,
      ...(outcome.status === 'pending' ? { pendingTaskId: outcome.taskId } : {}) });
    const next = publish({ commandSession: result.session, receipts: session.receipts },
      state.services, state.resourceOptions, ledger);
    if (outcome.status === 'pending') turnContinuations.set(next, {
      ...continuation, taskId: outcome.taskId });
    state.active = false;
    return output(next, outcome, false, true);
  } finally { state.busy = false; }
}

function moveProjection(match: DuelCanonicalPlayingStateV2): DuelUnitLifecycleState {
  return { stateVersion: match.stateVersion, board: match.board, resources: match.resources,
    players: match.players, unitMeta: match.unitMeta,
    retiredUnitTokenUIDs: match.retiredUnitTokenUIDs };
}
function moveZone(match: DuelCanonicalPlayingStateV2, locationId: string) {
  return match.board.bases.some(base => base.locationId === locationId)
    ? { kind: 'board-base' as const, locationId }
    : { kind: 'board-battlefield' as const, locationId };
}
function sameEvents(left: readonly DuelMoveEvent[], right: readonly DuelMoveEvent[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((event, index) =>
    event.objectId === right[index]!.objectId && event.actor === right[index]!.actor &&
    event.fromLocationId === right[index]!.fromLocationId &&
    event.toLocationId === right[index]!.toLocationId);
}
function settleMove(session: DuelUnitPlaySessionV2, continuation: NonNullable<
  ReturnType<typeof moveContinuations.get>>, persistBefore: boolean): DuelUnitMoveResultV2 {
  const state = admitted.get(session)!;
  const services = state.services.move;
  if (!services) return output(session, { status: 'blocked', reason: 'move-services-unavailable' });
  const moved = session.commandSession.match;
  if (moved.stage !== 'playing') return output(session,
    { status: 'rejected', reason: 'invalid-phase' });
  if (moved !== continuation.movedState) return output(session,
    { status: 'rejected', reason: 'wrong-task-or-session' });
  try {
    let commandSession = session.commandSession;
    let handlerAnswer: ReturnType<DuelUnitMoveServicesV2['triggers']>;
    const wasBusy = state.busy;
    state.busy = true;
    try {
      handlerAnswer = services.triggers({ movedState: moved, currentState: moved,
        obligation: { kind: 'move-trigger-obligation', taskId: continuation.taskId,
          movedVersion: continuation.movedVersion, events: continuation.events } });
    } catch { return output(session, { status: 'pending', taskId: continuation.taskId,
      appliedVersion: moved.stateVersion, eventSeq: moved.eventSeq }, false, persistBefore); }
    finally { state.busy = wasBusy; }
    if (state.poisoned || handlerAnswer?.status !== 'settled' ||
      handlerAnswer.taskId !== continuation.taskId || handlerAnswer.movedVersion !== moved.stateVersion ||
      !sameEvents(handlerAnswer.events, continuation.events))
      return output(session, { status: 'pending', taskId: continuation.taskId,
        appliedVersion: moved.stateVersion, eventSeq: moved.eventSeq }, false, persistBefore);
    if (handlerAnswer.disposition !== 'no-triggers')
      return output(session, { status: 'pending', taskId: continuation.taskId,
        appliedVersion: moved.stateVersion, eventSeq: moved.eventSeq }, false, persistBefore);
    const canonical = commandSession.match as DuelCanonicalPlayingStateV2;
    const cleanupBoard = applyOpenDuelCleanup(canonical.board);
    const cleanedSession = commitDuelCommandMutationV2(commandSession,
      () => ({ match: { ...canonical, board: cleanupBoard }, transitions: [] })).session;
    const currentProjection = continuation.movedProjection;
    const certified = certifyDuelStandardMoveTriggersV2(currentProjection, continuation.cursor, () =>
      ({ status: 'settled', taskId: continuation.taskId, movedVersion: continuation.movedVersion,
        settledVersion: currentProjection.stateVersion, events: continuation.events,
        disposition: 'no-triggers' }));
    check(certified.status === 'ready', 'Move trigger certification pending');
    const completed = resumeDuelStandardMoveV2(currentProjection, continuation.cursor, certified.proof);
    check(completed.state.stateVersion === cleanedSession.match.stateVersion &&
      JSON.stringify(completed.state.board) ===
        JSON.stringify((cleanedSession.match as DuelCanonicalPlayingStateV2).board),
    'Move cleanup mismatch');
    commandSession = cleanedSession;
    const outcome: DuelUnitMoveOutcomeV2 = { status: 'applied', taskId: continuation.taskId,
      appliedVersion: commandSession.match.stateVersion,
      eventSeq: commandSession.match.eventSeq, events: continuation.events };
    const ledger = new Map(state.ledger);
    ledger.set(ledgerKey(continuation.actor, continuation.commandId), {
      kind: 'move', fingerprint: continuation.fingerprint, outcome });
    const next = publish({ commandSession, receipts: session.receipts },
      state.services, state.resourceOptions, ledger);
    state.active = false;
    return output(next, outcome, false, true);
  } catch {
    return output(session, { status: 'pending', taskId: continuation.taskId,
      appliedVersion: moved.stateVersion, eventSeq: moved.eventSeq }, false, persistBefore);
  }
}
export function applyDuelUnitStandardMoveV2(session: DuelUnitPlaySessionV2, actor: string,
  raw: DuelUnitMoveEnvelopeV2): DuelUnitMoveResultV2 {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) { state.poisoned = true;
    return output(session, { status: 'blocked', reason: 'move-or-ganking-unproved' }); }
  check(state.active, 'spent action session');
  if (pendingOptionalContinuation(session)) return output(session,
    { status: 'blocked', reason: 'move-or-ganking-unproved' });
  state.busy = true; state.poisoned = false;
  try {
    let envelope: DuelUnitMoveEnvelopeV2;
    try { envelope = normalizedMove(raw); } catch {
      return output(session, { status: 'rejected', reason: 'invalid-command' }); }
    const fp = moveFingerprint(envelope), key = ledgerKey(actor, envelope.commandId);
    const prior = state.ledger.get(key);
    if (prior) return output(session, prior.kind === 'move' && prior.fingerprint === fp
      ? prior.outcome as DuelUnitMoveOutcomeV2 : { status: 'rejected', reason: 'command-conflict' },
    prior.kind === 'move' && prior.fingerprint === fp);
    if (session.commandSession.receipts.some(receipt => receipt.actor === actor &&
      receipt.commandId === envelope.commandId) || session.receipts.some(receipt =>
      receipt.actor === actor && receipt.commandId === envelope.commandId))
      return output(session, { status: 'rejected', reason: 'command-conflict' });
    if (turnContinuations.has(session) || moveContinuations.has(session))
      return output(session, { status: 'blocked', reason: 'move-trigger-unproved' });
    const match = session.commandSession.match as DuelCanonicalPlayingStateV2;
    if (match.stage !== 'playing') return output(session,
      { status: 'rejected', reason: 'invalid-phase' });
    if (!match.roster.some(seat => seat.playerId === actor))
      return output(session, { status: 'rejected', reason: 'unknown-actor' });
    if (envelope.expectedVersion !== match.stateVersion)
      return output(session, { status: 'rejected', reason: 'stale-version' });
    if (match.frame.phase !== 'main' || !match.frame.stateOpen)
      return output(session, { status: 'rejected', reason: 'invalid-phase' });
    if (match.frame.priorityPlayerId !== actor || match.frame.turnPlayerId !== actor)
      return output(session, { status: 'rejected', reason: 'no-permission' });
    if (match.frame.pendingPayment !== null || session.commandSession.requiredTasks.some(task =>
      task.status !== 'completed') || session.commandSession.priorityPayments.some(payment =>
      payment.status === 'active')) return output(session,
      { status: 'blocked', reason: 'move-or-ganking-unproved' });
    const services = state.services.move;
    if (!services) return output(session, { status: 'blocked', reason: 'move-services-unavailable' });
    let commandSession: DuelCommandSessionV2, events: readonly DuelMoveEvent[];
    let movedProjection: DuelUnitLifecycleState, cursor: DuelStandardMoveCursorV2;
    try {
      const timing = services.timing(match, actor);
      check(timing.phase === 'main' && timing.stateOpen === match.frame.stateOpen &&
        timing.turnPlayerId === match.frame.turnPlayerId &&
        timing.priorityPlayerId === match.frame.priorityPlayerId, 'trusted Move timing mismatch');
      const moved = beginDuelStandardMoveV2(moveProjection(match), { actor,
        unitUIDs: envelope.command.unitUIDs,
        destinationLocationId: envelope.command.destinationLocationId }, timing,
      uid => services.ganking(match, actor, uid));
      check(!state.poisoned, 'reentered Move service');
      events = moved.group.events;
      movedProjection = moved.state;
      cursor = moved.cursor;
      check(events.length === envelope.command.unitUIDs.length, 'incomplete paid group');
      const transitions = events.map(event => ({ uid: event.objectId,
        from: moveZone(match, event.fromLocationId),
        to: moveZone(match, event.toLocationId) }));
      commandSession = commitDuelCommandMutationV2(session.commandSession,
        () => ({ match: { ...match, board: moved.state.board,
          unitMeta: moved.state.unitMeta, stateVersion: moved.state.stateVersion },
        transitions })).session;
      check(commandSession.match.stateVersion === match.stateVersion + 1 &&
        commandSession.match.eventSeq === match.eventSeq + 1, 'Move clock');
    } catch { return output(session, { status: 'blocked', reason: 'move-or-ganking-unproved' }); }
    const taskId = cursor!.taskId;
    const continuation = { actor, commandId: envelope.commandId, fingerprint: fp,
      taskId, movedVersion: commandSession.match.stateVersion,
      movedState: commandSession.match as DuelCanonicalPlayingStateV2, events: events!,
      cursor: cursor!, movedProjection: movedProjection! };
    const pendingOutcome: DuelUnitMoveOutcomeV2 = { status: 'pending', taskId,
      appliedVersion: commandSession.match.stateVersion, eventSeq: commandSession.match.eventSeq };
    const ledger = new Map(state.ledger);
    ledger.set(key, { kind: 'move', fingerprint: fp, outcome: pendingOutcome, pendingTaskId: taskId });
    const next = publish({ commandSession, receipts: session.receipts },
      state.services, state.resourceOptions, ledger);
    moveContinuations.set(next, continuation);
    state.active = false;
    return settleMove(next, continuation, true);
  } finally { state.busy = false; }
}
export function resumeDuelUnitStandardMoveV2(session: DuelUnitPlaySessionV2, actor: string,
  commandId: string, taskId: string): DuelUnitMoveResultV2 {
  const state = admitted.get(session as object);
  check(state, 'unadmitted action session');
  if (state.busy) { state.poisoned = true;
    return output(session, { status: 'blocked', reason: 'move-trigger-unproved' }); }
  check(state.active, 'spent action session');
  const continuation = moveContinuations.get(session);
  if (!continuation || continuation.actor !== actor || continuation.commandId !== commandId ||
    continuation.taskId !== taskId)
    return output(session, { status: 'rejected', reason: 'wrong-task-or-session' });
  state.busy = true; state.poisoned = false;
  try { return settleMove(session, continuation, false); }
  finally { state.busy = false; }
}

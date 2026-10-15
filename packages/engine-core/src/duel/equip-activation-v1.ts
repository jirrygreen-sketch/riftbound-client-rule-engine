// INTERNAL, opt-in CR 818 Equip activation coordinator.
//
// Equip is an activated ability of an on-board Gear.  It is intentionally kept
// separate from cardplay-gear-v1: the source never enters Hand/Chain and the
// Gear remains on its original board carrier for the entire ability Chain.
import type { DuelOfficialProgramRegistry } from '@riftbound/card-dsl/duel';
import {
  advanceDuelCommandSessionNativeV2, applyDuelResourceCommandV2,
  commitDuelCommandFrameV2, issueDuelRequiredCostTaskV2,
  prepareDuelRequiredCostPaymentV2, inspectDuelNativeCommandSessionPathV2,
  type DuelCommandEnvelopeV2, type DuelCommandSessionV2,
  type DuelRequiredCostAuthorityV2, type DuelRequiredCostTaskV2,
  type DuelSourceAttestationRequestV2, type DuelSourceAttestorV2, type DuelSourceBindingV2,
} from './canonical-session-v2.js';
import {
  assertCurrentDuelPhysicalReferenceV2, attachDuelGearV2, commitDuelPlayingMutationV2,
  referenceDuelPhysicalCardV2, inspectDuelNativeOriginV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import { resolveDuelTotalCostV2, type DuelCostResolverAuthorityV2,
  type DuelResolvedCostV2 } from './cost-resolver-v2.js';
import { DUEL_DOMAINS, type DuelRuneCost } from './resources.js';
import {
  appendDuelChainItemV2, commitDuelChainResolutionV2,
  createDuelChainResolutionAuthorityV2, createDuelChainScopedExecutorV2,
  createDuelChainV2, finalizeDuelChainItemV2, passDuelChainPriorityV2,
  queryDuelChainCommittedProofV2, requestDuelChainResolutionV2, inspectDuelChainPrivateStateV2,
  type DuelChainExecutorV2,
  type DuelChainResolutionAuthorityV2, type DuelChainResolutionTicketV2,
  type DuelChainV2,
} from './chain-v2.js';

export interface DuelEquipActivationProgramRequestV1 {
  readonly attempt: DuelEquipActivationAttemptV1;
  readonly match: DuelCanonicalPlayingStateV2;
  readonly commandSession: DuelCommandSessionV2;
  readonly actor: string;
  readonly gearUID: string;
  readonly gearCardId: string;
  readonly sourceEpoch: number;
  readonly targetUID: string;
  readonly targetEpoch: number;
  readonly attemptId: string;
}

/** In-process proof issued only by a validated begin on a native command session. */
export interface DuelEquipActivationAttemptV1 { readonly _duelEquipActivationAttemptV1: unique symbol }

/** A binding is returned by trusted, catalog-bound program composition. */
export interface DuelEquipActivationProgramBindingV1 {
  readonly status: 'known' | 'unknown';
  readonly kind: 'equip-activated-ability' | 'other';
  readonly cardId: string;
  readonly programId: string;
  readonly programFingerprint: string;
  /** The printed Equip cost, deliberately distinct from Gear CardPlay cost. */
  readonly equipCost: DuelRuneCost;
}

export interface DuelEquipActivationCostRequestV1 extends DuelEquipActivationProgramRequestV1 {
  readonly transactionId: string;
  readonly commandId: string;
  readonly program: DuelEquipActivationProgramBindingV1;
  readonly abilityKind: 'equip-activation';
}

export interface DuelEquipActivationCostBindingV1 {
  readonly attempt: DuelEquipActivationAttemptV1;
  readonly matchId: string;
  readonly stateVersion: number;
  readonly actor: string;
  readonly gearUID: string;
  readonly gearCardId: string;
  readonly sourceEpoch: number;
  readonly targetUID: string;
  readonly targetEpoch: number;
  readonly transactionId: string;
  readonly baseProofId: string;
  readonly coverageProofId: string;
  readonly programFingerprint: string;
}

export interface DuelEquipActivationSourceAttestationRequestV1 extends DuelSourceAttestationRequestV2 {
  readonly attempt: DuelEquipActivationAttemptV1;
}

export interface DuelEquipActivationServicesV1 {
  readonly programs: DuelOfficialProgramRegistry;
  /** The parent-owned committed branch head. Working native descendants stay local until
   * the outer command publishes the returned session. */
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  /** Optional parent publication hook. When present it must publish every returned head. */
  readonly commitHead?: (head: DuelCanonicalPlayingStateV2) => void;
  readonly program: (request: Readonly<DuelEquipActivationProgramRequestV1>) => DuelEquipActivationProgramBindingV1;
  readonly cost?: DuelCostResolverAuthorityV2;
  readonly costForActivation?: (request: Readonly<DuelEquipActivationCostRequestV1>) => DuelCostResolverAuthorityV2;
  readonly costBinding: (request: Readonly<DuelEquipActivationCostBindingV1>) =>
    DuelEquipActivationCostBindingV1 & { readonly status: 'complete' | 'unknown' };
  readonly sourceAttestor: (request: Readonly<DuelEquipActivationSourceAttestationRequestV1>) => DuelSourceBindingV2;
  readonly chainId?: string;
  readonly identityFactory?: () => string;
}

export interface DuelEquipActivationCommandV1 {
  readonly gearUID: string;
  readonly targetUID: string;
}
export interface DuelEquipActivationEnvelopeV1 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: DuelEquipActivationCommandV1;
}

export type DuelEquipActivationOutcomeV1 =
  | { readonly status: 'pending'; readonly step: 'payment' | 'finalize' | 'priority' | 'resolve';
      readonly gearUID: string; readonly targetUID: string; readonly taskId?: string; readonly paymentId?: string;
      readonly chain: DuelChainV2 }
  | { readonly status: 'paid'; readonly gearUID: string; readonly targetUID: string }
  | { readonly status: 'applied'; readonly gearUID: string; readonly targetUID: string;
      readonly attached: boolean; readonly appliedVersion: number; readonly eventSeq: number }
  | { readonly status: 'rejected'; readonly reason: 'invalid-command' | 'command-conflict' |
      'stale-version' | 'unknown-actor' | 'invalid-phase' | 'no-permission' | 'illegal-target' |
      'source-or-target-unproved' | 'resource-rejected' | 'payment-rejected' }
  | { readonly status: 'blocked'; readonly reason: 'source-unproved' | 'cost-unproved' |
      'chain-unproved' | 'effect-unproved' | 'outstanding-task-or-session' | 'wrong-task-or-session' |
      'reentrant-command' | 'source-or-target-unproved' | 'stale-head' };

export interface DuelEquipActivationSessionV1 {
  readonly commandSession: DuelCommandSessionV2;
  readonly chain: DuelChainV2;
}
export interface DuelEquipActivationResultV1 {
  readonly session: DuelEquipActivationSessionV1;
  readonly outcome: DuelEquipActivationOutcomeV1;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}
export interface DuelEquipActivationInspectionV1 {
  readonly phase: 'idle' | 'chain' | 'issued' | 'payment' | 'paid' | 'finalize' | 'priority' | 'resolve' | 'completed' | 'fizzled';
  readonly actor: string | null;
  readonly gearUID: string | null;
  readonly gearCardId: string | null;
  readonly sourceEpoch: number | null;
  readonly targetUID: string | null;
  readonly targetEpoch: number | null;
  readonly fixedCost: DuelRuneCost | null;
  readonly attached: boolean;
}

type Phase = DuelEquipActivationInspectionV1['phase'];
type BlockReason = Extract<DuelEquipActivationOutcomeV1, { readonly status: 'blocked' }>['reason'];
interface Binding {
  readonly actor: string; readonly gearUID: string; readonly gearCardId: string;
  readonly sourceEpoch: number; readonly targetUID: string; readonly targetEpoch: number;
  readonly attempt: DuelEquipActivationAttemptV1;
  readonly program: DuelEquipActivationProgramBindingV1; readonly attemptId: string;
}
interface PrivateState {
  readonly services: DuelEquipActivationServicesV1;
  executor: DuelChainExecutorV2;
  resolutionAuthority: DuelChainResolutionAuthorityV2;
  chainIdentities: string[];
  committed: Map<string, { readonly status: 'committed'; readonly idempotencyKey: string;
    readonly chainId: string; readonly itemId: string; readonly executorId: string }>;
  active: boolean; busy: boolean; poisoned: boolean;
  phase: Phase; actor: string | null; commandId: string | null;
  binding: Binding | null; fixed: DuelResolvedCostV2 | null; costBound: boolean;
  task: DuelRequiredCostTaskV2 | null; authority?: DuelRequiredCostAuthorityV2;
  ticket?: DuelChainResolutionTicketV2; attached: boolean;
  closedChain?: DuelChainV2;
  effectApplied: boolean;
  effectSession?: DuelCommandSessionV2;
  head: { value: DuelCanonicalPlayingStateV2 };
  parentHead: DuelCanonicalPlayingStateV2;
  receipts: Map<string, { readonly fingerprint: string; readonly outcome: DuelEquipActivationOutcomeV1 }>;
  operationBase?: DuelEquipActivationSessionV1;
  operationSnapshot?: OperationSnapshot;
  operationPublished: DuelEquipActivationSessionV1[];
  activationClaim?: { readonly origin: object; readonly key: string };
}

interface OperationSnapshot {
  readonly session: DuelEquipActivationSessionV1;
  readonly phase: Phase;
  readonly actor: string | null;
  readonly commandId: string | null;
  readonly binding: Binding | null;
  readonly fixed: DuelResolvedCostV2 | null;
  readonly costBound: boolean;
  readonly task: DuelRequiredCostTaskV2 | null;
  readonly authority?: DuelRequiredCostAuthorityV2;
  readonly ticket?: DuelChainResolutionTicketV2;
  readonly attached: boolean;
  readonly closedChain?: DuelChainV2;
  readonly effectApplied: boolean;
  readonly effectSession?: DuelCommandSessionV2;
  readonly head: DuelCanonicalPlayingStateV2;
  readonly parentHead: DuelCanonicalPlayingStateV2;
  readonly receipts: Map<string, { readonly fingerprint: string; readonly outcome: DuelEquipActivationOutcomeV1 }>;
  readonly committed: Map<string, { readonly status: 'committed'; readonly idempotencyKey: string;
    readonly chainId: string; readonly itemId: string; readonly executorId: string }>;
  readonly activationClaim?: { readonly origin: object; readonly key: string };
  readonly executor: DuelChainExecutorV2;
  readonly resolutionAuthority: DuelChainResolutionAuthorityV2;
  readonly chainIdentities: readonly string[];
}

const states = new WeakMap<object, PrivateState>();
const spent = new WeakSet<object>();
const activationClaims = new WeakMap<object, Set<string>>();
const preparedPayments = new WeakMap<object, {
  readonly origin: DuelCommandSessionV2; readonly session: DuelCommandSessionV2;
}>();
const resolvedCosts = new WeakMap<object, Map<string, {
  readonly origin: DuelCommandSessionV2; readonly fixed: DuelResolvedCostV2;
}>>();
const attempts = new WeakMap<object, { readonly state: PrivateState; readonly origin: DuelCommandSessionV2;
  readonly actor: string; readonly gearUID: string; readonly sourceEpoch: number;
  readonly targetUID: string; readonly targetEpoch: number }>();

/** Reject DATA copies and foreign/stale attempt objects without issuing anything. */
export function inspectDuelEquipActivationAttemptV1(attempt: DuelEquipActivationAttemptV1): Readonly<{
  readonly matchId: string; readonly actor: string; readonly gearUID: string; readonly sourceEpoch: number;
  readonly targetUID: string; readonly targetEpoch: number;
}> {
  const entry = attempt && typeof attempt === 'object' ? attempts.get(attempt as object) : undefined;
  check(entry && entry.state.busy && !entry.state.poisoned, 'unadmitted Equip attempt');
  const head = entry.state.head.value;
  const gear = head.gears.find(value => value.uid === entry.gearUID);
  const unit = head.board.units.find(value => value.objectId === entry.targetUID);
  check(head.matchId === entry.origin.match.matchId && gear?.controllerPlayerId === entry.actor &&
    head.physicalCardsByUID[entry.gearUID]?.zoneEpoch === entry.sourceEpoch &&
    unit?.controllerPlayerId === entry.actor &&
    head.physicalCardsByUID[entry.targetUID]?.zoneEpoch === entry.targetEpoch,
    'Equip attempt source/target changed');
  return Object.freeze({ matchId: head.matchId, actor: entry.actor, gearUID: entry.gearUID,
    sourceEpoch: entry.sourceEpoch, targetUID: entry.targetUID, targetEpoch: entry.targetEpoch });
}

function fail(message: string): never { throw new TypeError(`Duel Equip Activation V1: ${message}`); }
function check(value: unknown, message: string): asserts value { if (!value) fail(message); }
function id(value: unknown, message: string): string {
  check(typeof value === 'string' && value.trim().length > 0, message); return value;
}
function version(value: unknown): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'safe version'); return value;
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'plain record');
  check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'record prototype');
  const keys = Reflect.ownKeys(value);
  check(keys.length >= required.length && keys.length <= required.length + optional.length &&
    keys.every(key => typeof key === 'string' && [...required, ...optional].includes(key) &&
      'value' in Object.getOwnPropertyDescriptor(value, key)!) && required.every(key => keys.includes(key)), 'record fields');
  return value as Record<string, unknown>;
}
function parse(raw: unknown): DuelEquipActivationEnvelopeV1 {
  const value = record(raw, ['commandId', 'expectedVersion', 'command']);
  const command = record(value.command, ['gearUID', 'targetUID']);
  return Object.freeze({ commandId: id(value.commandId, 'command ID'), expectedVersion: version(value.expectedVersion),
    command: Object.freeze({ gearUID: id(command.gearUID, 'Gear UID'), targetUID: id(command.targetUID, 'target UID') }) });
}
function outcome(session: DuelEquipActivationSessionV1, value: DuelEquipActivationOutcomeV1,
  duplicate = false, persistRequired = false): DuelEquipActivationResultV1 {
  return Object.freeze({ session, outcome: value, duplicate, persistRequired });
}
function updateReceipt(state: PrivateState, value: DuelEquipActivationOutcomeV1): void {
  const key = `${state.actor ?? ''}:${state.commandId ?? ''}`;
  const previous = state.receipts.get(key);
  if (previous) state.receipts.set(key, { fingerprint: previous.fingerprint, outcome: value });
}
function stateOf(session: DuelEquipActivationSessionV1): PrivateState {
  const value = states.get(session as object); check(value && !spent.has(session as object), 'inactive Equip session'); return value;
}
function current(session: DuelEquipActivationSessionV1): DuelCanonicalPlayingStateV2 {
  return stateOf(session).head.value;
}
function assertActive(session: DuelEquipActivationSessionV1): PrivateState {
  const state = states.get(session as object);
  check(state, 'inactive Equip session');
  if (state.busy) { state.poisoned = true; fail('reentrant command'); }
  stateOf(session);
  check(state.active, 'spent Equip session');
  return state;
}

function beginOperation(session: DuelEquipActivationSessionV1): PrivateState {
  const state = assertActive(session);
  state.operationBase = session;
  state.operationPublished = [];
  state.operationSnapshot = {
    session, phase: state.phase, actor: state.actor, commandId: state.commandId,
    binding: state.binding, fixed: state.fixed, costBound: state.costBound,
    task: state.task, authority: state.authority, ticket: state.ticket,
    attached: state.attached, closedChain: state.closedChain,
    effectApplied: state.effectApplied, effectSession: state.effectSession,
    head: state.head.value, parentHead: state.parentHead,
    receipts: new Map(state.receipts), committed: new Map(state.committed),
    activationClaim: state.activationClaim,
    executor: state.executor, resolutionAuthority: state.resolutionAuthority,
    chainIdentities: [...state.chainIdentities],
  };
  state.busy = true;
  state.poisoned = false;
  return state;
}

function rollbackOperation(state: PrivateState): DuelEquipActivationSessionV1 {
  const snapshot = state.operationSnapshot;
  check(snapshot && state.operationBase, 'missing Equip operation snapshot');
  if (state.binding && state.binding.attempt !== snapshot.binding?.attempt) attempts.delete(state.binding.attempt);
  for (const published of state.operationPublished) {
    states.delete(published as object);
    spent.delete(published as object);
  }
  states.set(snapshot.session as object, state);
  spent.delete(snapshot.session as object);
  state.phase = snapshot.phase; state.actor = snapshot.actor; state.commandId = snapshot.commandId;
  state.binding = snapshot.binding; state.fixed = snapshot.fixed; state.costBound = snapshot.costBound;
  state.task = snapshot.task; state.authority = snapshot.authority; state.ticket = snapshot.ticket;
  state.attached = snapshot.attached; state.closedChain = snapshot.closedChain;
  state.effectApplied = snapshot.effectApplied; state.effectSession = snapshot.effectSession;
  state.head.value = snapshot.head; state.parentHead = snapshot.parentHead;
  state.receipts = new Map(snapshot.receipts);
  state.committed = new Map(snapshot.committed);
  state.executor = snapshot.executor; state.resolutionAuthority = snapshot.resolutionAuthority;
  state.chainIdentities = [...snapshot.chainIdentities];
  if (state.activationClaim && state.activationClaim !== snapshot.activationClaim) {
    activationClaims.get(state.activationClaim.origin)?.delete(state.activationClaim.key);
  }
  state.activationClaim = snapshot.activationClaim;
  state.operationPublished = [];
  return snapshot.session;
}

function endOperation(state: PrivateState): void {
  state.operationBase = undefined;
  state.operationSnapshot = undefined;
  state.operationPublished = [];
  state.busy = false;
}

function assertHealthy(state: PrivateState, message = 'reentrant command'): void {
  check(!state.poisoned, message);
}

function blockedReason(state: PrivateState, error: unknown, fallback: BlockReason): BlockReason {
  return state.poisoned ? 'reentrant-command' : staleBlocked(error, fallback);
}

function externalCall<T>(state: PrivateState, callback: () => T): T {
  assertHealthy(state);
  try { return callback(); }
  finally { assertHealthy(state); }
}

function readParentHead(state: PrivateState): DuelCanonicalPlayingStateV2 {
  const head = externalCall(state, () => state.services.readHead());
  check(head && typeof head === 'object' && head.stage === 'playing', 'invalid Equip parent head');
  return head;
}

/**
 * A command may build several native working descendants before returning one result. The
 * parent head may therefore still be the last published match at the start of a transition;
 * an unrelated changed identity is the stale-branch case. Once the caller has published a
 * returned descendant, adopt that exact identity for the next transition.
 */
function admitHead(state: PrivateState, session: DuelEquipActivationSessionV1): DuelCanonicalPlayingStateV2 {
  const expected = session.commandSession.match as DuelCanonicalPlayingStateV2;
  const observed = readParentHead(state);
  check(observed === state.parentHead || observed === expected, 'stale Equip head');
  assertHealthy(state);
  if (observed === expected) state.parentHead = observed;
  return observed;
}

function settleHead(state: PrivateState, session: DuelEquipActivationSessionV1,
  parentBefore: DuelCanonicalPlayingStateV2): void {
  const expected = session.commandSession.match as DuelCanonicalPlayingStateV2;
  let observed = readParentHead(state);
  check(observed === parentBefore || observed === expected, 'stale Equip head');
  assertHealthy(state);
  if (state.services.commitHead) {
    try {
      externalCall(state, () => state.services.commitHead!(expected));
      observed = readParentHead(state);
      check(observed === expected, 'Equip parent head was not committed');
    }
    catch (error) {
      try { state.services.commitHead(parentBefore); } catch {}
      throw error;
    }
  }
  if (observed === expected) state.parentHead = expected;
}

function finish(state: PrivateState, result: DuelEquipActivationResultV1,
  parentBefore: DuelCanonicalPlayingStateV2): DuelEquipActivationResultV1 {
  try {
    settleHead(state, result.session, parentBefore);
    assertHealthy(state);
    return result;
  } catch (error) {
    const session = rollbackOperation(state);
    return outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'stale-head') });
  }
}

function finishSession(state: PrivateState, session: DuelEquipActivationSessionV1,
  parentBefore: DuelCanonicalPlayingStateV2): DuelEquipActivationSessionV1 {
  try {
    settleHead(state, session, parentBefore);
    assertHealthy(state);
    return session;
  } catch (error) {
    rollbackOperation(state);
    throw error;
  }
}

function staleBlocked(error: unknown, fallback: BlockReason): BlockReason {
  return error instanceof TypeError && error.message.includes('stale Equip head') ? 'stale-head' : fallback;
}
function publish(previous: DuelEquipActivationSessionV1 | null, commandSession: DuelCommandSessionV2,
  chain: DuelChainV2, state: PrivateState): DuelEquipActivationSessionV1 {
  assertHealthy(state);
  const session = Object.freeze({ commandSession, chain });
  states.set(session as object, state);
  // The private state object is deliberately shared by native descendants. The
  // predecessor is invalidated by `spent`; clearing `active` here would also
  // clear the successor because both handles retain the same state capability.
  if (previous) {
    spent.add(previous as object);
    if (state.operationBase) state.operationPublished.push(previous);
  }
  if (state.operationBase) state.operationPublished.push(session);
  state.head.value = commandSession.match as DuelCanonicalPlayingStateV2;
  return session;
}
function next(previous: DuelEquipActivationSessionV1, commandSession: DuelCommandSessionV2,
  chain: DuelChainV2): DuelEquipActivationSessionV1 {
  const state = stateOf(previous);
  inspectDuelNativeCommandSessionPathV2(previous.commandSession, commandSession);
  return publish(previous, commandSession, chain, state);
}

function forkChain(state: PrivateState, previous: DuelChainV2): DuelChainV2 {
  assertHealthy(state);
  inspectDuelChainPrivateStateV2(previous);
  let identityIndex = 0;
  const resolutionAuthority = createDuelChainResolutionAuthorityV2(ticket => {
    const value = state.committed.get(ticket.idempotencyKey);
    return value ? Object.freeze({ ...value }) : null;
  });
  let chain = createDuelChainV2({ turnOrder: previous.turnOrder,
    initialPriorityPlayerId: previous.closeContext.kind === 'main-phase'
      ? previous.closeContext.returnPriorityPlayerId : previous.turnOrder[0]!,
    chainId: previous.chainId, closeContext: previous.closeContext, resolutionAuthority,
    identityFactory: () => {
      const index = identityIndex++;
      if (state.chainIdentities[index] !== undefined) return state.chainIdentities[index]!;
      const identity = externalCall(state, () => state.services.identityFactory?.() ?? crypto.randomUUID());
      state.chainIdentities[index] = id(identity, 'Chain identity');
      return identity;
    } });
  const executor = createDuelChainScopedExecutorV2(chain);
  state.executor = executor; state.resolutionAuthority = resolutionAuthority;
  for (const item of previous.items) {
    chain = appendDuelChainItemV2(chain, { actor: item.controllerPlayerId, expectedVersion: chain.stateVersion,
      executor, item: { id: item.id, kind: item.kind, controllerPlayerId: item.controllerPlayerId,
        resolutionMode: item.resolutionMode } });
    if (item.status === 'finalized') chain = finalizeDuelChainItemV2(chain,
      { actor: item.controllerPlayerId, expectedVersion: chain.stateVersion });
  }
  for (let pass = 0; pass < previous.consecutivePasses; pass++) {
    chain = passDuelChainPriorityV2(chain, { actor: chain.priorityPlayerId!, expectedVersion: chain.stateVersion });
  }
  if (previous.phase === 'await-commit') {
    const requested = requestDuelChainResolutionV2(chain, { expectedVersion: chain.stateVersion });
    chain = requested.chain; state.ticket = requested.ticket;
  }
  check(JSON.stringify(chain) === JSON.stringify(previous), 'Equip working Chain drift');
  assertHealthy(state);
  return chain;
}
function sourceReference(binding: Binding): { readonly kind: 'card'; readonly referenceId: string; readonly sourceUID: string } {
  return Object.freeze({ kind: 'card', referenceId: binding.gearCardId, sourceUID: binding.gearUID });
}
function sourceAttestor(state: PrivateState, binding: Binding): DuelSourceAttestorV2 {
  return request => {
    check(request.match === state.head.value, 'foreign source head');
    check(request.actor === binding.actor && request.sourceReference.kind === 'card' &&
      request.sourceReference.referenceId === binding.gearCardId && request.sourceReference.sourceUID === binding.gearUID,
      'Equip source identity');
    const match = request.match;
    const gear = match.gears.find(value => value.uid === binding.gearUID);
    check(gear && gear.controllerPlayerId === binding.actor && match.physicalCardsByUID[binding.gearUID]?.zoneEpoch === binding.sourceEpoch,
      'Equip source left board or changed epoch');
    inspectDuelEquipActivationAttemptV1(binding.attempt);
    const output = externalCall(state, () => state.services.sourceAttestor(Object.freeze({ ...request, attempt: binding.attempt })));
    check(!state.poisoned && output.mode === 'current' && output.sourceZoneEpoch === binding.sourceEpoch &&
      output.sourceReference.sourceUID === binding.gearUID && output.sourceReference.referenceId === binding.gearCardId,
      'Equip source attestation drift');
    check(!state.poisoned, 'reentered Equip source attestor');
    return output;
  };
}
function assertTiming(match: DuelCanonicalPlayingStateV2, actor: string): void {
  check(match.frame.phase === 'main' && match.frame.stateOpen && match.frame.priorityPlayerId === actor &&
    match.frame.turnPlayerId === actor &&
    match.frame.pendingPayment === null && match.frame.focusPlayerId === null, 'Equip requires open Main priority');
  check(!match.board.battlefields.some(field => field.showdown !== 'none' || field.combat !== 'none'),
    'Equip is closed during Showdown/Combat');
}
function assertSourceAndTarget(match: DuelCanonicalPlayingStateV2, actor: string,
  gearUID: string, targetUID: string): Binding {
  const gear = match.gears.find(value => value.uid === gearUID);
  check(gear && gear.controllerPlayerId === actor, 'Gear is not controlled by actor');
  const physical = match.physicalCardsByUID[gearUID];
  const original = match.provenance.originalPhysicalCards.find(value => value.uid === gearUID);
  check(physical && original?.cardType === 'Gear' && original.cardId === physical.cardId &&
    original.ownerPlayerId === physical.ownerPlayerId, 'canonical Gear source');
  const source = referenceDuelPhysicalCardV2(match, gearUID);
  assertCurrentDuelPhysicalReferenceV2(match, source);
  const unit = match.board.units.find(value => value.objectId === targetUID);
  check(unit && unit.controllerPlayerId === actor, 'target must be a friendly Unit');
  // The current permanent-state attachment authority admits card-Unit hosts
  // only. A token Unit must stay pending for the shared Core host rule owner.
  check(match.unitMeta[targetUID]?.trait.kind !== 'token', 'token host attachment is unsupported by Core');
  const target = referenceDuelPhysicalCardV2(match, targetUID);
  assertCurrentDuelPhysicalReferenceV2(match, target);
  return Object.freeze({ actor, gearUID, gearCardId: physical.cardId, sourceEpoch: source.zoneEpoch,
    targetUID, targetEpoch: target.zoneEpoch, attempt: null as unknown as DuelEquipActivationAttemptV1,
    program: null as unknown as DuelEquipActivationProgramBindingV1,
    attemptId: '' });
}
function syncChainFrame(commandSession: DuelCommandSessionV2, chain: DuelChainV2): DuelCommandSessionV2 {
  const match = commandSession.match as DuelCanonicalPlayingStateV2;
  const priorityPlayerId = chain.phase === 'resolve' || chain.phase === 'await-commit' ? null : chain.priorityPlayerId;
  const open = chain.stateOpen && chain.phase === 'open';
  if (match.frame.priorityPlayerId === priorityPlayerId && match.frame.stateOpen === open) return commandSession;
  return commitDuelCommandFrameV2(commandSession, { ...match.frame, priorityPlayerId, stateOpen: open },
    (before, proposed) => check(before.frame.phase === 'main' && before.frame.pendingPayment === null &&
      proposed.phase === 'main' && proposed.turnPlayerId === before.frame.turnPlayerId &&
      proposed.turnNumber === before.frame.turnNumber && proposed.focusPlayerId === before.frame.focusPlayerId,
    'Chain cannot change phase/focus/payment')).session;
}
function issuePayment(previous: DuelEquipActivationSessionV1, state: PrivateState): DuelEquipActivationResultV1 {
  const binding = state.binding; check(binding && state.fixed, 'Equip payment binding');
  const attestor = sourceAttestor(state, binding);
  let working = previous;
  if (!state.task) {
    const match = current(previous);
    const task: DuelRequiredCostTaskV2 = { matchId: match.matchId, expectedVersion: match.stateVersion,
      taskId: `equip-activation-task:${binding.attemptId}`, paymentId: `equip-activation-payment:${binding.attemptId}`,
      actor: binding.actor, finalResolvedCost: state.fixed.finalResolvedCost, opaqueSource: sourceReference(binding),
      continuationId: `equip-activation-continuation:${binding.attemptId}` };
    const issued = issueDuelRequiredCostTaskV2(previous.commandSession, task, attestor);
    state.task = task; state.authority = issued.authority; state.phase = 'issued';
    working = next(previous, issued.session, previous.chain);
  }
  check(state.task && state.authority && state.phase === 'issued', 'Equip issued task lost');
  try {
    let prepared = preparedPayments.get(state.authority);
    if (!prepared) {
      const result = prepareDuelRequiredCostPaymentV2(working.commandSession, state.authority, attestor);
      prepared = { origin: working.commandSession, session: result.session };
      preparedPayments.set(state.authority, prepared);
    }
    check(prepared.origin === working.commandSession, 'foreign Equip payment preparation');
    assertHealthy(state);
    state.phase = 'payment'; state.authority = undefined;
    const session = next(working, prepared.session, working.chain);
    return outcome(session, { status: 'pending', step: 'payment', gearUID: binding.gearUID, targetUID: binding.targetUID,
      taskId: state.task.taskId, paymentId: state.task.paymentId, chain: session.chain }, false, true);
  } catch {
    return outcome(working, { status: 'blocked', reason: state.poisoned ? 'reentrant-command' : 'cost-unproved' },
      false, working !== previous);
  }
}
function validateProgram(state: PrivateState, request: DuelEquipActivationProgramRequestV1): DuelEquipActivationProgramBindingV1 {
  const official = externalCall(state, () => state.services.programs.getProgram(request.gearCardId));
  check(official?.cardId === request.gearCardId && official.semantics.kind === 'equip-activated-ability' &&
    official.source.cardType === 'Gear' && official.source.dataVersion === request.match.dataVersion &&
    official.source.sourceCatalogDigest === request.match.catalogDigest, 'official Equip source is unresolved');
  const semantics = official.semantics;
  check(semantics.sourceScope === 'source-gear-on-board' && semantics.abilityClass === 'activated-ability' &&
    semantics.event === 'activate' && semantics.timing === 'main-open-outside-showdown' &&
    semantics.target.kind === 'unit' && semantics.target.controller === 'source-controller' &&
    semantics.target.scope === 'controlled-unit' && semantics.target.selection === 'target' &&
    semantics.attach.kind === 'attach-source-gear' && semantics.attach.destination === 'target-unit' &&
    semantics.attach.resolution === 'deferred-attachment' && semantics.cost.kind === 'base-cost' &&
    semantics.cost.nonResourceLiteral === null && semantics.costAlternatives.length === 0 &&
    semantics.costAlterations.length === 0, 'unsupported Equip semantics');
  const printedPower = semantics.cost.power;
  const expectedPower = printedPower === null ? [] : [{ allowedDomains: printedPower.kind === 'specific-domain'
    ? [printedPower.domain] : [...DUEL_DOMAINS], amount: 1 }];
  const value = externalCall(state, () => state.services.program(Object.freeze({ ...request })));
  check(!state.poisoned, 'reentered Equip program provider');
  check(value && value.status === 'known' && value.kind === 'equip-activated-ability' && value.cardId === request.gearCardId &&
    value.programId === official.programId && id(value.programFingerprint, 'Equip fingerprint') && value.equipCost &&
    value.equipCost.energy === semantics.cost.energy && JSON.stringify(value.equipCost.power) === JSON.stringify(expectedPower),
    'unknown Equip program');
  check(!state.poisoned, 'reentered Equip program data');
  return Object.freeze({ status: 'known', kind: 'equip-activated-ability', cardId: request.gearCardId,
    programId: official.programId, programFingerprint: value.programFingerprint,
    equipCost: Object.freeze({ energy: semantics.cost.energy,
      power: Object.freeze(expectedPower.map(power => Object.freeze({ allowedDomains: Object.freeze([...power.allowedDomains]),
        amount: power.amount }))) }) });
}

function prepareCost(session: DuelEquipActivationSessionV1, state: PrivateState): DuelEquipActivationResultV1 {
  const binding = state.binding; check(binding && state.commandId && state.phase === 'chain', 'Equip Chain binding');
  const match = current(session);
  check(match === session.commandSession.match, 'Equip Chain head drift');
  const request: DuelEquipActivationCostRequestV1 = Object.freeze({ attempt: binding.attempt,
    match, commandSession: session.commandSession,
    actor: binding.actor, gearUID: binding.gearUID, gearCardId: binding.gearCardId,
    sourceEpoch: binding.sourceEpoch, targetUID: binding.targetUID, targetEpoch: binding.targetEpoch,
    attemptId: binding.attemptId, transactionId: `equip-activation-cost:${binding.attemptId}`,
    commandId: state.commandId, program: binding.program, abilityKind: 'equip-activation' });
  if (!state.fixed) {
    const authority = externalCall(state, () => state.services.costForActivation
      ? state.services.costForActivation(request) : state.services.cost);
    check(!state.poisoned && authority, 'Equip cost authority');
    const fixed = externalCall(state, () => {
      const cached = resolvedCosts.get(authority)?.get(request.transactionId);
      const origin = state.operationBase!.commandSession;
      if (cached?.origin === origin) return cached.fixed;
      const resolved = resolveDuelTotalCostV2(authority, {
        transactionId: request.transactionId, subjectId: `${binding.gearCardId}:equip`, kind: 'card-play' });
      const transactions = resolvedCosts.get(authority) ?? new Map();
      transactions.set(request.transactionId, { origin, fixed: resolved });
      resolvedCosts.set(authority, transactions);
      return resolved;
    });
    check(!state.poisoned && fixed.baseCost.energy === binding.program.equipCost.energy &&
      JSON.stringify(fixed.baseCost.power) === JSON.stringify(binding.program.equipCost.power), 'Equip base-cost binding');
    state.fixed = fixed;
  }
  if (!state.costBound) {
    const costBinding = Object.freeze({ attempt: binding.attempt, matchId: match.matchId, stateVersion: match.stateVersion,
      actor: binding.actor, gearUID: binding.gearUID, gearCardId: binding.gearCardId,
      sourceEpoch: binding.sourceEpoch, targetUID: binding.targetUID, targetEpoch: binding.targetEpoch,
      transactionId: request.transactionId, baseProofId: state.fixed.baseProofId,
      coverageProofId: state.fixed.coverageProofId, programFingerprint: binding.program.programFingerprint });
    const checked = externalCall(state, () => state.services.costBinding(costBinding));
    check(!state.poisoned && checked.status === 'complete' && Object.keys(costBinding).every(key =>
      checked[key as keyof typeof costBinding] === costBinding[key as keyof typeof costBinding]), 'Equip cost binding drift');
    check(!state.poisoned, 'reentered Equip cost binding');
    state.costBound = true;
  }
  return issuePayment(session, state);
}
function validateCurrentBinding(match: DuelCanonicalPlayingStateV2, binding: Binding): boolean {
  try {
    const gear = match.gears.find(value => value.uid === binding.gearUID);
    const unit = match.board.units.find(value => value.objectId === binding.targetUID);
    if (!gear || gear.controllerPlayerId !== binding.actor || !unit || unit.controllerPlayerId !== binding.actor) return false;
    assertCurrentDuelPhysicalReferenceV2(match, { uid: binding.gearUID, zoneEpoch: binding.sourceEpoch });
    assertCurrentDuelPhysicalReferenceV2(match, { uid: binding.targetUID, zoneEpoch: binding.targetEpoch });
    return true;
  } catch { return false; }
}

function boardZone(match: DuelCanonicalPlayingStateV2, locationId: string):
  { readonly kind: 'board-base' | 'board-battlefield'; readonly locationId: string } {
  check(match.board.bases.some(base => base.locationId === locationId) ||
    match.board.battlefields.some(field => field.locationId === locationId), 'unknown board location');
  return { kind: match.board.bases.some(base => base.locationId === locationId) ? 'board-base' : 'board-battlefield',
    locationId };
}

function attachAtTarget(match: DuelCanonicalPlayingStateV2, binding: Binding): DuelCanonicalPlayingStateV2 {
  const gear = match.gears.find(value => value.uid === binding.gearUID);
  const unit = match.board.units.find(value => value.objectId === binding.targetUID);
  check(gear && unit, 'Equip source/target left Board');
  let colocated = match;
  if (gear.locationId !== unit.locationId) {
    const moved = new Set([gear.uid]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const value of match.gears) if (value.attachedToUID && moved.has(value.attachedToUID) && !moved.has(value.uid)) {
        moved.add(value.uid); expanded = true;
      }
    }
    const to = boardZone(match, unit.locationId);
    colocated = commitDuelPlayingMutationV2(match, draft => ({
      match: { ...draft, gears: draft.gears.map(value => moved.has(value.uid)
        ? { ...value, locationId: unit.locationId,
          attachedToUID: value.uid === binding.gearUID ? null : value.attachedToUID } : value) },
      transitions: draft.gears.filter(value => moved.has(value.uid)).map(value => ({
        uid: value.uid, from: boardZone(draft, value.locationId), to })),
    }));
  }
  return attachDuelGearV2(colocated, binding.gearUID, binding.targetUID);
}

export function createDuelEquipActivationSessionV1(commandSession: DuelCommandSessionV2,
  services: DuelEquipActivationServicesV1): DuelEquipActivationSessionV1 {
  check(commandSession && services && typeof services.readHead === 'function' &&
    (services.commitHead === undefined || typeof services.commitHead === 'function') &&
    typeof services.program === 'function' && typeof services.costBinding === 'function' &&
    typeof services.sourceAttestor === 'function' && (services.cost || typeof services.costForActivation === 'function'),
    'trusted Equip services required');
  check(commandSession.match.stage === 'playing', 'Equip requires playing match');
  inspectDuelNativeCommandSessionPathV2(commandSession, commandSession);
  const match = commandSession.match as DuelCanonicalPlayingStateV2;
  check(services.readHead() === match, 'stale Equip head');
  check(match.frame.phase === 'main' && match.frame.stateOpen && match.frame.pendingPayment === null,
    'Equip session requires open Main');
  check(commandSession.requiredTasks.every(task => task.status === 'completed') &&
    commandSession.priorityPayments.every(payment => payment.status === 'completed'), 'outstanding payment/session');
  const committed = new Map<string, { status: 'committed'; idempotencyKey: string; chainId: string; itemId: string; executorId: string }>();
  const chainIdentities: string[] = [];
  let creatingState: PrivateState | undefined;
  const resolutionAuthority = createDuelChainResolutionAuthorityV2(ticket => {
    const value = committed.get(ticket.idempotencyKey);
    return value ? Object.freeze({ status: 'committed', idempotencyKey: value.idempotencyKey,
      chainId: value.chainId, itemId: value.itemId, executorId: value.executorId }) : null;
  });
  const chain = createDuelChainV2({ turnOrder: match.turnOrder, initialPriorityPlayerId: match.frame.priorityPlayerId!,
    closeContext: { kind: 'main-phase', returnPriorityPlayerId: match.frame.priorityPlayerId! },
    ...(services.chainId ? { chainId: services.chainId } : {}),
    identityFactory: () => {
      const callback = () => services.identityFactory?.() ?? crypto.randomUUID();
      const identity = creatingState ? externalCall(creatingState, callback) : callback();
      chainIdentities.push(id(identity, 'Chain identity'));
      return identity;
    }, resolutionAuthority });
  const executor = createDuelChainScopedExecutorV2(chain);
  const state: PrivateState = { services, executor, resolutionAuthority, chainIdentities,
    committed, active: true, busy: false, poisoned: false,
    phase: 'idle', actor: null, commandId: null, binding: null, fixed: null, costBound: false,
    task: null, attached: false,
    effectApplied: false,
    head: { value: match }, parentHead: match, receipts: new Map(), operationPublished: [] };
  creatingState = state;
  return publish(null, commandSession, chain, state);
}

export function beginDuelEquipActivationV1(session: DuelEquipActivationSessionV1, actor: string,
  rawEnvelope: DuelEquipActivationEnvelopeV1): DuelEquipActivationResultV1 {
  const state = beginOperation(session);
  let parentBefore: DuelCanonicalPlayingStateV2;
  try { parentBefore = admitHead(state, session); }
  catch (error) {
    // A sibling handle from the same native origin is the existing one-attempt guard. It
    // remains an outstanding session; an unrelated parent branch is reported stale below.
    try {
      const origin = inspectDuelNativeOriginV2(session.commandSession.match);
      if (!state.poisoned && (activationClaims.get(origin)?.size ?? 0) > 0) {
        endOperation(state);
        return outcome(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
      }
    } catch { /* fall through to stale-head */ }
    endOperation(state);
    return outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'stale-head') });
  }
  let workingSession = session;
  let claim: { readonly origin: object; readonly key: string } | null = null;
  let attempt: DuelEquipActivationAttemptV1 | undefined;
  try {
    let envelope: DuelEquipActivationEnvelopeV1;
    try { envelope = parse(rawEnvelope); }
    catch { return outcome(session, { status: 'rejected', reason: 'invalid-command' }); }
    const match = current(session);
    const key = `${actor}:${envelope.commandId}`;
    const fingerprint = JSON.stringify([envelope.expectedVersion, envelope.command.gearUID, envelope.command.targetUID]);
    const previous = state.receipts.get(key);
    if (previous) return finish(state, previous.fingerprint === fingerprint
      ? outcome(session, previous.outcome, true)
      : outcome(session, { status: 'rejected', reason: 'command-conflict' }), parentBefore);
    if (!match.roster.some(value => value.playerId === actor)) return finish(state, outcome(session, { status: 'rejected', reason: 'unknown-actor' }), parentBefore);
    if (envelope.expectedVersion !== match.stateVersion) return finish(state, outcome(session, { status: 'rejected', reason: 'stale-version' }), parentBefore);
    if (state.phase !== 'idle') return finish(state, outcome(session, { status: 'rejected', reason: 'command-conflict' }), parentBefore);
    assertTiming(match, actor);
    check(!state.task && !state.authority && !match.chainCards?.length, 'outstanding task/session');
    let binding = assertSourceAndTarget(match, actor, envelope.command.gearUID, envelope.command.targetUID);
    const origin = inspectDuelNativeOriginV2(match);
    const claims = activationClaims.get(origin) ?? new Set<string>();
    const claimKey = JSON.stringify([match.stateVersion, binding.gearUID, binding.sourceEpoch]);
    if (claims.has(claimKey)) return finish(state, outcome(session, { status: 'blocked', reason: 'outstanding-task-or-session' }), parentBefore);
    claims.add(claimKey); activationClaims.set(origin, claims);
    claim = { origin, key: claimKey };
    state.activationClaim = claim;
    attempt = Object.freeze(Object.create(null)) as DuelEquipActivationAttemptV1;
    attempts.set(attempt, { state, origin: session.commandSession, actor,
      gearUID: binding.gearUID, sourceEpoch: binding.sourceEpoch,
      targetUID: binding.targetUID, targetEpoch: binding.targetEpoch });
    const attemptId = JSON.stringify(['equip-activation-v1', match.matchId, actor, envelope.commandId,
      binding.gearUID, binding.sourceEpoch, binding.targetUID, binding.targetEpoch]);
    const program = validateProgram(state, { attempt, match, commandSession: session.commandSession, actor,
      gearUID: binding.gearUID, gearCardId: binding.gearCardId, sourceEpoch: binding.sourceEpoch,
      targetUID: binding.targetUID, targetEpoch: binding.targetEpoch, attemptId });
    binding = Object.freeze({ ...binding, attempt, program, attemptId }); state.binding = binding;
    state.actor = actor; state.commandId = envelope.commandId;
    // The ability item is the sole Chain carrier. The physical Gear itself never moves.
    const itemId = `equip:${actor}:${envelope.commandId}`;
    const workingChain = forkChain(state, session.chain);
    const appended = appendDuelChainItemV2(workingChain, { actor, expectedVersion: workingChain.stateVersion,
      executor: state.executor, item: { id: itemId, kind: 'equip-activated-ability', controllerPlayerId: actor, resolutionMode: 'fepr' } });
    const closedSession = next(session, syncChainFrame(session.commandSession, appended), appended);
    workingSession = closedSession;
    state.phase = 'chain';
    const result = prepareCost(closedSession, state);
    state.receipts.set(key, { fingerprint, outcome: result.outcome }); return finish(state, result, parentBefore);
  } catch (error) {
    const message = error instanceof TypeError ? error.message : '';
    if (!state.binding && attempt) attempts.delete(attempt);
    if (state.poisoned && workingSession === session) {
      return outcome(rollbackOperation(state), { status: 'rejected', reason: 'source-or-target-unproved' });
    }
    if (state.binding && workingSession !== session)
      return finish(state, outcome(workingSession, { status: 'blocked', reason: blockedReason(state, error, state.poisoned ? 'reentrant-command' : 'cost-unproved') }, false, true), parentBefore);
    if (claim) {
      activationClaims.get(claim.origin)?.delete(claim.key);
      state.activationClaim = undefined;
    }
    if (message.includes('token host attachment'))
      return finish(state, outcome(session, { status: 'blocked', reason: 'source-or-target-unproved' }), parentBefore);
    if (message.includes('stale Equip head'))
      return outcome(session, { status: 'blocked', reason: 'stale-head' });
    const reason = message.includes('target') || message.includes('Gear') ? 'illegal-target' : 'source-or-target-unproved';
    return finish(state, outcome(session, { status: 'rejected', reason }), parentBefore);
  } finally { endOperation(state); }
}

export function applyDuelEquipActivationResourceV1(session: DuelEquipActivationSessionV1, actor: string,
  envelope: DuelCommandEnvelopeV2): DuelEquipActivationResultV1 {
  const state = beginOperation(session);
  let parentBefore: DuelCanonicalPlayingStateV2;
  try { parentBefore = admitHead(state, session); }
  catch (error) {
    endOperation(state);
    return outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'stale-head') });
  }
  try {
    const binding = state.binding; check(binding && (state.phase === 'payment' || state.phase === 'paid') && state.task,
      'Equip payment session');
    check(actor === binding.actor, 'wrong Equip payer');
    if (state.phase === 'paid' && envelope.command.type !== 'pay-pending')
      return finish(state, outcome(session, { status: 'blocked', reason: 'wrong-task-or-session' }), parentBefore);
    const applied = applyDuelResourceCommandV2(session.commandSession, actor, envelope, { sourceAttestor: sourceAttestor(state, binding) });
    assertHealthy(state);
    if (!applied.persistRequired) {
      if (applied.duplicate && applied.outcome.status === 'applied' &&
          applied.outcome.paymentCompleted?.paymentId === state.task.paymentId) {
        const value = { status: 'paid' as const, gearUID: binding.gearUID, targetUID: binding.targetUID };
        updateReceipt(state, value);
        return finish(state, outcome(session, value, true), parentBefore);
      }
      return finish(state, outcome(session, { status: 'blocked', reason: 'cost-unproved' }, applied.duplicate), parentBefore);
    }
    const nextSession = next(session, applied.session, session.chain);
    if (applied.outcome.status === 'rejected') {
      const value = { status: 'rejected' as const, reason: applied.outcome.reason === 'payment-rejected'
        ? 'payment-rejected' as const : 'resource-rejected' as const };
      updateReceipt(state, value);
      return finish(state, outcome(nextSession, value, applied.duplicate, true), parentBefore);
    }
    if (envelope.command.type === 'pay-pending' && applied.outcome.status === 'applied') {
      state.phase = 'paid';
      const value = { status: 'paid' as const, gearUID: binding.gearUID, targetUID: binding.targetUID };
      updateReceipt(state, value);
      return finish(state, outcome(nextSession, value, applied.duplicate, true), parentBefore);
    }
    const value = { status: 'pending' as const, step: 'payment' as const, gearUID: binding.gearUID,
      targetUID: binding.targetUID, taskId: state.task.taskId, paymentId: state.task.paymentId, chain: nextSession.chain };
    updateReceipt(state, value);
    return finish(state, outcome(nextSession, value, applied.duplicate, true), parentBefore);
  } catch (error) {
    return finish(state, outcome(session, { status: 'blocked', reason: blockedReason(state, error,
      state.poisoned ? 'reentrant-command' : 'cost-unproved') }), parentBefore);
  }
  finally { endOperation(state); }
}

export function finalizeDuelEquipActivationV1(session: DuelEquipActivationSessionV1, actor: string): DuelEquipActivationResultV1 {
  const state = beginOperation(session);
  let parentBefore: DuelCanonicalPlayingStateV2;
  try { parentBefore = admitHead(state, session); }
  catch (error) {
    endOperation(state);
    return outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'stale-head') });
  }
  try {
    const binding = state.binding; check(binding && state.phase === 'paid' && actor === binding.actor, 'Equip must be paid');
    check((session.commandSession.match as DuelCanonicalPlayingStateV2).frame.pendingPayment === null &&
      session.commandSession.requiredTasks.every(task => task.status === 'completed'), 'payment remains active');
    const workingChain = forkChain(state, session.chain);
    const chain = finalizeDuelChainItemV2(workingChain, { actor, expectedVersion: workingChain.stateVersion });
    state.phase = 'finalize';
    const nextSession = next(session, syncChainFrame(session.commandSession, chain), chain);
    updateReceipt(state, { status: 'pending', step: 'priority',
      gearUID: binding.gearUID, targetUID: binding.targetUID, chain });
    return finish(state, outcome(nextSession, { status: 'pending', step: 'priority', gearUID: binding.gearUID, targetUID: binding.targetUID, chain }, false, true), parentBefore);
  } catch (error) { return finish(state, outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'chain-unproved') }), parentBefore); }
  finally { endOperation(state); }
}

export function passDuelEquipActivationPriorityV1(session: DuelEquipActivationSessionV1, actor: string): DuelEquipActivationResultV1 {
  const state = beginOperation(session);
  let parentBefore: DuelCanonicalPlayingStateV2;
  try { parentBefore = admitHead(state, session); }
  catch (error) {
    endOperation(state);
    return outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'stale-head') });
  }
  try {
    const binding = state.binding; check(binding && (state.phase === 'finalize' || state.phase === 'priority'), 'Equip priority session');
    const workingChain = forkChain(state, session.chain);
    const chain = passDuelChainPriorityV2(workingChain, { actor, expectedVersion: workingChain.stateVersion });
    state.phase = chain.phase === 'resolve' ? 'resolve' : 'priority';
    const nextSession = next(session, syncChainFrame(session.commandSession, chain), chain);
    const value = { status: 'pending' as const, step: chain.phase === 'resolve' ? 'resolve' as const : 'priority' as const,
      gearUID: binding.gearUID, targetUID: binding.targetUID, chain };
    updateReceipt(state, value);
    return finish(state, outcome(nextSession, value, false, true), parentBefore);
  } catch (error) { return finish(state, outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'chain-unproved') }), parentBefore); }
  finally { endOperation(state); }
}

/** Admit a trusted native continuation while an already-paid ability waits on
 * Chain. A target may leave in this interval; Resolve will fizzle it without
 * refunding or offering a new target. DATA copies and sibling sessions fail. */
export function advanceDuelEquipActivationNativeV1(session: DuelEquipActivationSessionV1,
  descendant: DuelCommandSessionV2): DuelEquipActivationSessionV1 {
  const state = beginOperation(session);
  let parentBefore: DuelCanonicalPlayingStateV2;
  try {
    parentBefore = admitHead(state, session);
    check(state.binding &&
      (state.phase === 'paid' || state.phase === 'finalize' || state.phase === 'priority' || state.phase === 'resolve') &&
      !state.ticket, 'Equip native continuation window');
    inspectDuelNativeCommandSessionPathV2(session.commandSession, descendant);
    check(descendant.match.stage === 'playing' && descendant.requiredTasks.every(task => task.status === 'completed') &&
      descendant.priorityPayments.every(payment => payment.status === 'completed'), 'foreign payment/session');
    const before = session.commandSession.match as DuelCanonicalPlayingStateV2;
    const after = descendant.match as DuelCanonicalPlayingStateV2;
    check(after.matchId === before.matchId && after.frame.phase === before.frame.phase &&
      after.frame.turnNumber === before.frame.turnNumber && after.frame.turnPlayerId === before.frame.turnPlayerId &&
      after.frame.focusPlayerId === before.frame.focusPlayerId &&
      after.frame.priorityPlayerId === before.frame.priorityPlayerId && after.frame.stateOpen === before.frame.stateOpen &&
      after.frame.pendingPayment === null, 'native continuation changed Chain window');
    return finishSession(state, next(session, descendant, session.chain), parentBefore);
  } catch (error) {
    rollbackOperation(state);
    throw error;
  } finally { endOperation(state); }
}

function commitResolution(session: DuelEquipActivationSessionV1, state: PrivateState,
  ticket: DuelChainResolutionTicketV2): DuelEquipActivationResultV1 {
  const binding = state.binding; check(binding, 'Equip binding missing');
  const before = current(session);
  let canonical = state.effectSession ?? session.commandSession;
  if (!state.effectApplied) {
    if (validateCurrentBinding(before, binding)) {
      canonical = advanceDuelCommandSessionNativeV2(canonical, attachAtTarget(before, binding)).session;
      state.attached = true;
    }
    state.effectSession = canonical;
    state.effectApplied = true;
  }
  const receipt = Object.freeze({ status: 'committed' as const, idempotencyKey: ticket.idempotencyKey,
    chainId: ticket.chainId, itemId: ticket.itemId, executorId: ticket.executorId });
  state.committed.set(ticket.idempotencyKey, receipt);
  let chain = state.closedChain;
  if (!chain) {
    const proof = queryDuelChainCommittedProofV2(state.resolutionAuthority, ticket);
    check(proof, 'Equip resolution receipt');
    chain = commitDuelChainResolutionV2(session.chain, { expectedVersion: session.chain.stateVersion, ticket, proof });
    state.closedChain = chain;
  }
  canonical = syncChainFrame(canonical, chain);
  state.phase = state.attached ? 'completed' : 'fizzled';
  const nextSession = next(session, canonical, chain);
  const value = { status: 'applied' as const, gearUID: binding.gearUID, targetUID: binding.targetUID, attached: state.attached,
    appliedVersion: canonical.match.stateVersion, eventSeq: canonical.match.eventSeq };
  updateReceipt(state, value);
  return outcome(nextSession, value, false, true);
}

export function resolveDuelEquipActivationV1(session: DuelEquipActivationSessionV1): DuelEquipActivationResultV1 {
  const state = beginOperation(session);
  let parentBefore: DuelCanonicalPlayingStateV2;
  try { parentBefore = admitHead(state, session); }
  catch (error) {
    endOperation(state);
    return outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'stale-head') });
  }
  let workingSession = session;
  try {
    const binding = state.binding; check(binding && state.phase === 'resolve', 'Equip resolve session');
    const workingChain = forkChain(state, session.chain);
    const requested = state.ticket ? { chain: workingChain, ticket: state.ticket } :
      requestDuelChainResolutionV2(workingChain, { expectedVersion: workingChain.stateVersion });
    state.ticket = requested.ticket;
    const locked = next(session, syncChainFrame(session.commandSession, requested.chain), requested.chain);
    workingSession = locked;
    return finish(state, commitResolution(locked, state, requested.ticket), parentBefore);
  } catch (error) { return finish(state, outcome(workingSession, { status: 'blocked', reason: blockedReason(state, error,
    state.poisoned ? 'reentrant-command' : 'effect-unproved') }, false, workingSession !== session), parentBefore); }
  finally { endOperation(state); }
}

export function resumeDuelEquipActivationPaymentV1(session: DuelEquipActivationSessionV1): DuelEquipActivationResultV1 {
  const state = beginOperation(session);
  let parentBefore: DuelCanonicalPlayingStateV2;
  try { parentBefore = admitHead(state, session); }
  catch (error) {
    endOperation(state);
    return outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'stale-head') });
  }
  try {
    check(state.binding && (state.phase === 'chain' || state.phase === 'issued'), 'no pending Equip preparation');
    const result = state.phase === 'chain' ? prepareCost(session, state) : issuePayment(session, state);
    updateReceipt(state, result.outcome);
    return finish(state, result, parentBefore);
  } catch (error) { return finish(state, outcome(session, { status: 'blocked', reason: blockedReason(state, error, 'cost-unproved') }), parentBefore); }
  finally { endOperation(state); }
}

export function inspectDuelEquipActivationV1(session: DuelEquipActivationSessionV1): DuelEquipActivationInspectionV1 {
  const state = beginOperation(session);
  try {
    admitHead(state, session);
    const binding = state.binding;
    return Object.freeze({ phase: state.phase, actor: state.actor, gearUID: binding?.gearUID ?? null,
      gearCardId: binding?.gearCardId ?? null, sourceEpoch: binding?.sourceEpoch ?? null,
      targetUID: binding?.targetUID ?? null, targetEpoch: binding?.targetEpoch ?? null,
      fixedCost: state.fixed?.finalResolvedCost ?? null, attached: state.attached });
  } finally { endOperation(state); }
}

// INTERNAL staged session wrapper. This file does not install an official turn executor or a public API.
import {
  resolveDuelMulligan, projectDuelMatch,
  type DuelMatchState, type DuelMatchSetupState, type DuelMatchPlayingState,
  type PublicDuelMatchSetup, type PublicDuelMatchPlaying, type PublicDuelMatchPlayer,
} from './match-state.js';
import { projectPublicDuelBoard } from './battlefields.js';
import { projectPublicDuelUnitObjects } from './unit-lifecycle.js';
import { commitDuelPlayingMutation } from './canonical-transaction.js';
import { projectPublicDuelScoring } from './scoring.js';
import {
  activateBasicRuneEnergy, activateBasicRunePower, activateDuelGoldPower,
  payDuelRuneCost, projectPublicDuelResources, DUEL_DOMAINS,
  type DuelPaymentPlan, type DuelRuneCost, type DuelResourceTiming,
} from './resources.js';

export type DuelPhase = 'awaiting-turn-start' | 'awaken' | 'beginning' | 'scoring' |
  'channel' | 'draw' | 'main' | 'ending' | 'expiration' | 'ended';
const PHASES: readonly DuelPhase[] = ['awaiting-turn-start', 'awaken', 'beginning', 'scoring',
  'channel', 'draw', 'main', 'ending', 'expiration', 'ended'];
/** Opaque trusted origin, never accepted in a client command or public frame. */
export interface DuelPaymentSourceReference {
  readonly kind: 'card' | 'effect';
  readonly referenceId: string;
  readonly sourceUID?: string;
}
export interface DuelPendingPayment {
  readonly paymentId: string;
  readonly actor: string;
  /** Final cost from the trusted Cost Resolver, NOT automatically the printed base cost. */
  readonly resolvedCost: DuelRuneCost;
  readonly sourceReference: DuelPaymentSourceReference;
}
export interface DuelCanonicalFrame {
  readonly phase: DuelPhase;
  readonly turnNumber: number;
  readonly turnPlayerId: string;
  readonly priorityPlayerId: string | null;
  readonly focusPlayerId: string | null;
  readonly stateOpen: boolean;
  readonly pendingPayment: DuelPendingPayment | null;
}
export type DuelCanonicalPlayingState = Omit<DuelMatchPlayingState, 'frame'> & {
  readonly frame: DuelCanonicalFrame;
};
export type DuelCanonicalMatchState = DuelMatchSetupState | DuelCanonicalPlayingState;
// Verify structurally that the approved constructor's initial frame is a subtype of the new frame.
const constructorIsCanonical: DuelMatchPlayingState extends DuelCanonicalPlayingState ? true : never = true;
void constructorIsCanonical;
const matchIsCanonical: DuelMatchState extends DuelCanonicalMatchState ? true : never = true;
void matchIsCanonical;

export type DuelResourceCommand =
  | { readonly type: 'mulligan'; readonly selectedUIDs: readonly string[] }
  | { readonly type: 'rune-energy' | 'rune-power' | 'gold-power'; readonly uid: string }
  | { readonly type: 'pay-pending'; readonly paymentId: string; readonly plan?: DuelPaymentPlan };
export interface DuelCommandEnvelope {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: DuelResourceCommand;
}
export type DuelCommandRejection = 'invalid-command' | 'unknown-actor' | 'command-conflict' |
  'stale-version' | 'invalid-stage' | 'invalid-phase' | 'no-permission' |
  'mulligan-rejected' | 'resource-rejected' | 'payment-rejected' | 'version-overflow';
export interface DuelPaymentCompleted {
  readonly paymentId: string;
  readonly sourceReference: DuelPaymentSourceReference;
  readonly plan: DuelPaymentPlan;
  /** Private continuation binding; never included in a public match projection. */
  readonly requiredTask?: { readonly taskId: string; readonly continuationId: string };
}
export type DuelCommandOutcome =
  | { readonly status: 'applied'; readonly appliedVersion: number; readonly eventSeq: number;
      readonly paymentCompleted?: DuelPaymentCompleted }
  | { readonly status: 'rejected'; readonly reason: DuelCommandRejection };
export interface DuelCommandReceipt {
  readonly actor: string;
  readonly commandId: string;
  /** Canonical full semantic command, deliberately without expectedVersion. Private ledger only. */
  readonly payloadFingerprint: string;
  readonly outcome: DuelCommandOutcome;
}
export interface DuelRequiredCostTask {
  readonly matchId: string;
  readonly expectedVersion: number;
  readonly taskId: string;
  readonly paymentId: string;
  readonly actor: string;
  readonly finalResolvedCost: DuelRuneCost;
  readonly opaqueSource: DuelPaymentSourceReference;
  readonly continuationId: string;
}
export interface DuelRequiredTaskLedgerEntry extends DuelRequiredCostTask {
  /** Immutable task identity, persisted privately and checked before activation. */
  readonly status: 'issued' | 'active' | 'completed';
}
export interface DuelCommandSession {
  readonly match: DuelCanonicalMatchState;
  /** Private persistence ledger, NOT a game-state field or a client projection. */
  readonly receipts: readonly DuelCommandReceipt[];
  /** Private JSON-compatible reserved/completed task identities; future archive must validate it. */
  readonly requiredTasks?: readonly DuelRequiredTaskLedgerEntry[];
}
export interface DuelCommandResult {
  readonly session: DuelCommandSession;
  /** Always the current session.match, including duplicates after subsequent commands. */
  readonly match: DuelCanonicalMatchState;
  readonly outcome: DuelCommandOutcome;
  readonly duplicate: boolean;
  /** Atomically persist the complete session before acknowledging this new receipt. */
  readonly persistRequired: boolean;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`Duel session: ${message}`);
}
function record(raw: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'expected plain record');
  const prototype = Object.getPrototypeOf(raw);
  check(prototype === Object.prototype || prototype === null, 'expected plain record');
  const keys = Reflect.ownKeys(raw);
  check(keys.every(key => typeof key === 'string' && [...required, ...optional].includes(key)) &&
    required.every(key => keys.includes(key)) &&
    keys.every(key => 'value' in Object.getOwnPropertyDescriptor(raw, key)!), 'unexpected or missing fields/accessors');
  return raw as Record<string, unknown>;
}
function list(raw: unknown): readonly unknown[] {
  check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype, 'expected plain array');
  check(Reflect.ownKeys(raw).length === raw.length + 1 &&
    Array.from({ length: raw.length }, (_, i) => Object.getOwnPropertyDescriptor(raw, String(i)))
      .every(descriptor => descriptor !== undefined && 'value' in descriptor), 'sparse/extra/accessor array');
  return raw;
}
function id(raw: unknown): string {
  check(typeof raw === 'string' && raw.trim().length > 0, 'expected nonblank identifier');
  return raw;
}
function count(raw: unknown): number {
  check(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0, 'expected nonnegative safe integer');
  return raw;
}
function semanticCommand(raw: unknown): DuelResourceCommand {
  const command = record(raw, ['type'], ['selectedUIDs', 'uid', 'paymentId', 'plan']);
  switch (command.type) {
    case 'mulligan': {
      record(raw, ['type', 'selectedUIDs']);
      return { type: 'mulligan', selectedUIDs: list(command.selectedUIDs).map(id) };
    }
    case 'rune-energy':
    case 'rune-power':
    case 'gold-power':
      record(raw, ['type', 'uid']);
      return { type: command.type, uid: id(command.uid) };
    case 'pay-pending': {
      const payment = record(raw, ['type', 'paymentId'], ['plan']);
      const paymentId = id(payment.paymentId);
      if (!Object.hasOwn(payment, 'plan')) return { type: 'pay-pending', paymentId };
      const rawPlan = record(payment.plan, ['power']);
      const power = list(rawPlan.power).map(value => {
        const allocation = record(value, ['requirementIndex', 'from', 'amount']);
        check(typeof allocation.from === 'string' &&
          ([...DUEL_DOMAINS, 'any'] as readonly string[]).includes(allocation.from), 'invalid Power source');
        return { requirementIndex: count(allocation.requirementIndex),
          from: allocation.from as (typeof DUEL_DOMAINS)[number] | 'any', amount: count(allocation.amount) };
      });
      return { type: 'pay-pending', paymentId, plan: { power } };
    }
    default: throw new TypeError('Duel session: unknown command type');
  }
}
function canonicalJSON(value: unknown): string {
  // Only cloned, validated command objects reach here; sorting object keys ignores insertion order,
  // while arrays remain in submitted order. A fingerprint is not a secrecy-preserving hash.
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function result(session: DuelCommandSession, outcome: DuelCommandOutcome,
  duplicate: boolean, persistRequired: boolean): DuelCommandResult {
  return { session, match: session.match, outcome, duplicate, persistRequired };
}
function detachedOutcome(outcome: DuelCommandOutcome): DuelCommandOutcome {
  if (outcome.status === 'rejected') return { status: 'rejected', reason: outcome.reason };
  const completed = outcome.paymentCompleted;
  return { status: 'applied', appliedVersion: outcome.appliedVersion, eventSeq: outcome.eventSeq,
    ...(completed ? { paymentCompleted: { paymentId: completed.paymentId,
      sourceReference: { ...completed.sourceReference },
      plan: { power: completed.plan.power.map(item => ({ ...item })) },
      ...(completed.requiredTask ? { requiredTask: { ...completed.requiredTask } } : {}) } } : {}) };
}
function knownSeat(match: DuelCanonicalMatchState, actor: unknown): actor is string {
  return typeof actor === 'string' && match.roster.some(person => person.playerId === actor);
}
function timing(frame: DuelCanonicalFrame): DuelResourceTiming {
  return { stateOpen: frame.stateOpen, priorityPlayerId: frame.priorityPlayerId,
    resourcePaymentPlayerId: frame.pendingPayment?.actor ?? null };
}
function active(frame: DuelCanonicalFrame): boolean {
  return PHASES.includes(frame.phase) && frame.phase !== 'awaiting-turn-start' &&
    frame.phase !== 'ended' && Number.isSafeInteger(frame.turnNumber) && frame.turnNumber > 0;
}
/** Never JSON-serializable: a trusted TaskExecutor must issue this in-process capability. */
export interface DuelRequiredCostAuthority { readonly _requiredCostAuthority: unique symbol }
const issuedTasks = new WeakMap<object, { readonly session: DuelCommandSession; readonly task: DuelRequiredCostTask }>();
function taskIdentity(task: DuelRequiredCostTask): string {
  return canonicalJSON(task);
}
function checkedRequiredTask(raw: DuelRequiredCostTask | DuelRequiredTaskLedgerEntry): DuelRequiredCostTask {
  const task = record(raw, ['matchId', 'expectedVersion', 'taskId', 'paymentId', 'actor',
    'finalResolvedCost', 'opaqueSource', 'continuationId'], ['status']);
  if (Object.hasOwn(task, 'status')) check(task.status === 'issued' || task.status === 'active' ||
    task.status === 'completed', 'required task status');
  return { matchId: id(task.matchId), expectedVersion: count(task.expectedVersion),
    taskId: id(task.taskId), paymentId: id(task.paymentId), actor: id(task.actor),
    finalResolvedCost: detachedFinalCost(task.finalResolvedCost as DuelRuneCost),
    opaqueSource: detachedSource(task.opaqueSource as DuelPaymentSourceReference),
    continuationId: id(task.continuationId) };
}
function taskLedger(session: DuelCommandSession): readonly DuelRequiredTaskLedgerEntry[] {
  return session.requiredTasks ?? [];
}
/**
 * Trusted TaskExecutor seam, NOT a client command. Issuing reserves both taskId and paymentId in
 * JSON-compatible private metadata before a required cost can be prepared. Persist this session
 * before acknowledging issuance; on restart a validated restore may reissue a fresh opaque handle
 * for the same unchanged 'issued' ledger entry through a trusted TaskExecutor, never for
 * active/completed tasks. An unvalidated JSON payload MUST NOT be used as a trusted session.
 */
export function issueDuelRequiredCostTask(session: DuelCommandSession, raw: DuelRequiredCostTask):
  { readonly session: DuelCommandSession; readonly authority: DuelRequiredCostAuthority; readonly persistRequired: boolean } {
  const task = checkedRequiredTask(raw);
  check(!Object.hasOwn(raw, 'status'), 'required task issuance cannot set status');
  check(session.match.stage === 'playing' && session.match.matchId === task.matchId &&
    session.match.stateVersion === task.expectedVersion && knownSeat(session.match, task.actor),
  'required task match/actor/expectedVersion');
  checkedFrame(session.match.frame, session.match);
  check(active(session.match.frame) && session.match.frame.pendingPayment === null, 'required task window');
  check(session.match.eventSeq === session.match.stateVersion, 'required task clock mismatch');
  const ledger = taskLedger(session);
  check(!ledger.some(entry => entry.status === 'active'), 'another required task is active');
  check(!session.receipts.some(receipt => receipt.outcome.status === 'applied' &&
    receipt.outcome.paymentCompleted?.paymentId === task.paymentId), 'payment ID already completed');
  const collisions = ledger.filter(entry => entry.taskId === task.taskId || entry.paymentId === task.paymentId);
  check(collisions.length <= 1, 'duplicate required task identity');
  const existing = collisions[0];
  if (existing) check(existing.status === 'issued' && existing.taskId === task.taskId &&
    existing.paymentId === task.paymentId && taskIdentity(checkedRequiredTask(existing)) === taskIdentity(task),
  'required task ID conflict or already active/completed');
  const prepared = existing ? session : { ...session, requiredTasks: [...ledger, { ...task, status: 'issued' as const }] };
  const authority = Object.freeze(Object.create(null)) as DuelRequiredCostAuthority;
  issuedTasks.set(authority, { session: prepared, task });
  return { session: prepared, authority, persistRequired: !existing };
}
/** Consume only an issued in-process capability, with exact session/ledger/clock binding. */
export function prepareDuelRequiredCostPayment(session: DuelCommandSession, authority: DuelRequiredCostAuthority):
  { readonly session: DuelCommandSession; readonly persistRequired: true } {
  const issued = authority !== null && typeof authority === 'object' ? issuedTasks.get(authority) : undefined;
  check(issued && issued.session === session, 'unissued or stale required task authority');
  const task = issued.task, match = session.match;
  check(match.stage === 'playing' && active(match.frame) && match.frame.pendingPayment === null &&
    match.eventSeq === match.stateVersion &&
    match.matchId === task.matchId && match.stateVersion === task.expectedVersion &&
    knownSeat(match, task.actor), 'expired required task or mismatched match/actor/payment');
  const ledger = taskLedger(session);
  const entry = ledger.find(item => item.taskId === task.taskId);
  check(!ledger.some(item => item.status === 'active') &&
    !session.receipts.some(receipt => receipt.outcome.status === 'applied' &&
      receipt.outcome.paymentCompleted?.paymentId === task.paymentId), 'already active or paid task');
  check(ledger.filter(item => item.taskId === task.taskId || item.paymentId === task.paymentId).length === 1,
    'required task duplicate ID collision');
  check(entry && entry.status === 'issued' && entry.paymentId === task.paymentId &&
    taskIdentity(checkedRequiredTask(entry)) === taskIdentity(task), 'required task ledger mismatch');
  const pendingPayment: DuelPendingPayment = { paymentId: task.paymentId, actor: task.actor,
    resolvedCost: detachedFinalCost(task.finalResolvedCost), sourceReference: detachedSource(task.opaqueSource) };
  const next = commitDuelPlayingMutation(match, draft =>
    ({ ...draft, frame: { ...draft.frame, pendingPayment } }));
  const updated: DuelCommandSession = { ...session, match: next,
    requiredTasks: ledger.map(item => item.taskId === task.taskId ? { ...entry, status: 'active' as const } : item) };
  issuedTasks.delete(authority);
  return { session: updated, persistRequired: true };
}

function activeRequiredTask(session: DuelCommandSession, pending: DuelPendingPayment | null):
  DuelRequiredTaskLedgerEntry | undefined {
  const active = taskLedger(session).filter(entry => entry.status === 'active');
  check(active.length <= 1, 'multiple active required tasks');
  const entry = active[0];
  if (entry) {
    const task = checkedRequiredTask(entry);
    check(pending !== null && task.matchId === session.match.matchId &&
      task.actor === pending.actor && task.paymentId === pending.paymentId &&
      canonicalJSON(task.finalResolvedCost) === canonicalJSON(pending.resolvedCost) &&
      canonicalJSON(task.opaqueSource) === canonicalJSON(pending.sourceReference),
    'active required task/pending mismatch');
  }
  return entry;
}
function advanced(match: DuelCanonicalPlayingState,
  updates: Partial<Pick<DuelCanonicalPlayingState, 'resources' | 'frame'>>): DuelCanonicalPlayingState {
  return commitDuelPlayingMutation(match, draft => ({ ...draft, ...updates }));
}

/** Trusted executor may inject RNG for mulligan recycling; the client cannot set it in its command. */
export function applyDuelResourceCommand(
  session: DuelCommandSession, authenticatedActor: string, envelope: DuelCommandEnvelope,
  trusted?: { readonly randomIndex?: (exclusiveUpperBound: number) => number },
): DuelCommandResult {
  // No archive validation here: session comes from trusted server memory or an independently
  // validated/durable restore. An invalid transport envelope cannot claim a ledger entry.
  let commandId: string, expectedVersion: number, command: DuelResourceCommand;
  try {
    const raw = record(envelope, ['commandId', 'expectedVersion', 'command']);
    commandId = id(raw.commandId);
    expectedVersion = count(raw.expectedVersion);
    command = semanticCommand(raw.command);
  } catch {
    return result(session, { status: 'rejected', reason: 'invalid-command' }, false, false);
  }
  if (!knownSeat(session.match, authenticatedActor))
    return result(session, { status: 'rejected', reason: 'unknown-actor' }, false, false);
  const fingerprint = canonicalJSON(command);
  // A durable ledger is append-only and unique per (actor, commandId). Malformed restored
  // sessions are outside this staged executor's contract; archive validation belongs upstream.
  const existing = session.receipts.find(receipt =>
    receipt.actor === authenticatedActor && receipt.commandId === commandId);
  if (existing) return existing.payloadFingerprint === fingerprint
    ? result(session, detachedOutcome(existing.outcome), true, false)
    : result(session, { status: 'rejected', reason: 'command-conflict' }, false, false);
  let next: DuelCanonicalMatchState = session.match;
  let completedTaskId: string | undefined;
  let outcome: DuelCommandOutcome | undefined;
  if (expectedVersion !== next.stateVersion) {
    outcome = { status: 'rejected', reason: 'stale-version' };
  } else if (next.stateVersion >= Number.MAX_SAFE_INTEGER || next.eventSeq >= Number.MAX_SAFE_INTEGER) {
    outcome = { status: 'rejected', reason: 'version-overflow' };
  } else if (command.type === 'mulligan') {
    if (next.stage !== 'setup') outcome = { status: 'rejected', reason: 'invalid-stage' };
    else {
      try {
        next = resolveDuelMulligan(next, authenticatedActor, command.selectedUIDs, trusted?.randomIndex);
        outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq };
      } catch {
        outcome = { status: 'rejected', reason: 'mulligan-rejected' };
      }
    }
  } else if (next.stage !== 'playing') {
    outcome = { status: 'rejected', reason: 'invalid-stage' };
  } else if (!active(next.frame)) {
    outcome = { status: 'rejected', reason: 'invalid-phase' };
  } else {
    // A playing frame comes only from the trusted turn executor; fail closed on malformed
    // snapshots rather than silently trusting a forged Priority/payment actor.
    try { checkedFrame(next.frame, next); }
    catch { outcome = { status: 'rejected', reason: 'invalid-phase' }; }
  }
  if (outcome === undefined && command.type === 'pay-pending' && next.stage === 'playing') {
    const pending = next.frame.pendingPayment;
    if (!pending || pending.paymentId !== command.paymentId || pending.actor !== authenticatedActor) {
      outcome = { status: 'rejected', reason: 'no-permission' };
    } else {
      try {
        const required = activeRequiredTask(session, pending);
        const paid = payDuelRuneCost(next.resources, authenticatedActor, pending.resolvedCost,
          timing(next.frame), command.plan);
        const completed: DuelPaymentCompleted = { paymentId: pending.paymentId,
          sourceReference: { ...pending.sourceReference },
          plan: { power: paid.plan.power.map(entry => ({ ...entry })) },
          ...(required ? { requiredTask: { taskId: required.taskId,
            continuationId: required.continuationId } } : {}) };
        next = advanced(next, { resources: paid.resources, frame: { ...next.frame, pendingPayment: null } });
        completedTaskId = required?.taskId;
        outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq,
          paymentCompleted: completed };
      } catch {
        outcome = { status: 'rejected', reason: 'payment-rejected' };
      }
    }
  } else if (outcome === undefined && next.stage === 'playing' &&
    (command.type === 'rune-energy' || command.type === 'rune-power' || command.type === 'gold-power')) {
    // Resolve the private ledger binding before applying the ordinary Priority rule. A required
    // task owns the whole payment-resource window: Priority may still point at the other seat, but
    // that seat cannot react until the bound actor completes the task. Do not infer this from the
    // pending actor alone; the ledger also authenticates task identity, cost, and source.
    let required: DuelRequiredTaskLedgerEntry | undefined;
    try {
      required = activeRequiredTask(session, next.frame.pendingPayment);
    } catch {
      outcome = { status: 'rejected', reason: 'resource-rejected' };
    }
    if (outcome === undefined && required && required.actor !== authenticatedActor) {
      outcome = { status: 'rejected', reason: 'no-permission' };
    } else if (outcome === undefined && next.frame.priorityPlayerId !== authenticatedActor &&
      next.frame.pendingPayment?.actor !== authenticatedActor) {
      // Preserve the ordinary Priority or payment-owner path once task restrictions are satisfied.
      outcome = { status: 'rejected', reason: 'no-permission' };
    } else if (outcome === undefined) {
      try {
        const source = command.type === 'rune-energy'
          ? activateBasicRuneEnergy(next.resources, authenticatedActor, command.uid, timing(next.frame))
          : command.type === 'rune-power'
            ? activateBasicRunePower(next.resources, authenticatedActor, command.uid, timing(next.frame))
            : activateDuelGoldPower(next.resources, authenticatedActor, command.uid, timing(next.frame));
        next = advanced(next, { resources: source });
        outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq };
      } catch {
        outcome = { status: 'rejected', reason: 'resource-rejected' };
      }
    }
  }
  check(outcome !== undefined, 'unhandled command outcome');
  const receipt: DuelCommandReceipt = { actor: authenticatedActor, commandId,
    payloadFingerprint: fingerprint, outcome: detachedOutcome(outcome) };
  const updated: DuelCommandSession = { ...session, match: next, receipts: [...session.receipts, receipt],
    ...(completedTaskId ? { requiredTasks: taskLedger(session).map(entry =>
      entry.taskId === completedTaskId ? { ...entry, status: 'completed' as const } : entry) } : {}) };
  return result(updated, detachedOutcome(receipt.outcome), false, true);
}

function detachedFinalCost(raw: DuelRuneCost): DuelRuneCost {
  const cost = record(raw, ['energy', 'power']);
  const energy = count(cost.energy);
  let total = energy;
  const power = list(cost.power).map(value => {
    const requirement = record(value, ['allowedDomains', 'amount']);
    const domains = list(requirement.allowedDomains).map(value => {
      check(typeof value === 'string' && (DUEL_DOMAINS as readonly string[]).includes(value), 'invalid cost domain');
      return value as (typeof DUEL_DOMAINS)[number];
    });
    check(domains.length > 0 && domains.length <= DUEL_DOMAINS.length &&
      new Set(domains).size === domains.length, 'invalid cost domain set');
    const amount = count(requirement.amount);
    check(amount > 0, 'zero Power requirement');
    total += amount;
    check(Number.isSafeInteger(total), 'cost overflow');
    return { allowedDomains: domains, amount };
  });
  return { energy, power };
}
function detachedSource(raw: DuelPaymentSourceReference): DuelPaymentSourceReference {
  const source = record(raw, ['kind', 'referenceId'], ['sourceUID']);
  check(source.kind === 'card' || source.kind === 'effect', 'source kind');
  return { kind: source.kind, referenceId: id(source.referenceId),
    ...(Object.hasOwn(source, 'sourceUID') ? { sourceUID: id(source.sourceUID) } : {}) };
}
/** Validated trusted turn-frame shape; not a public setter or an official turn transition. */
function checkedFrame(frame: DuelCanonicalFrame, match: DuelCanonicalMatchState): void {
  const raw = record(frame, ['phase', 'turnNumber', 'turnPlayerId', 'priorityPlayerId',
    'focusPlayerId', 'stateOpen', 'pendingPayment']);
  check(PHASES.some(phase => phase === raw.phase), 'frame phase');
  check(count(raw.turnNumber) > 0, 'frame turn number');
  check(knownSeat(match, raw.turnPlayerId), 'frame turn player');
  check(raw.priorityPlayerId === null || knownSeat(match, raw.priorityPlayerId), 'frame priority player');
  check(raw.focusPlayerId === null || knownSeat(match, raw.focusPlayerId), 'frame focus player');
  check(typeof raw.stateOpen === 'boolean', 'frame Open/Closed');
  if (raw.pendingPayment !== null) {
    const payment = record(raw.pendingPayment, ['paymentId', 'actor', 'resolvedCost', 'sourceReference']);
    id(payment.paymentId);
    check(knownSeat(match, payment.actor), 'pending payment actor');
    detachedFinalCost(payment.resolvedCost as DuelRuneCost);
    detachedSource(payment.sourceReference as DuelPaymentSourceReference);
    check(raw.phase !== 'awaiting-turn-start' && raw.phase !== 'ended', 'pending payment phase');
  }
}
/** Trusted ordinary preparation + outer clock allocation; session metadata remains private. */
export function commitDuelPriorityPayment(session: DuelCommandSession, actor: string,
  paymentId: string, finalResolvedCost: DuelRuneCost, opaqueSource: DuelPaymentSourceReference):
  { readonly session: DuelCommandSession; readonly persistRequired: true } {
  check(session.match.stage === 'playing' && !taskLedger(session).some(entry => entry.status === 'active'),
    'priority preparation while required task active or not playing');
  check(!taskLedger(session).some(entry => entry.paymentId === paymentId) &&
    !session.receipts.some(receipt => receipt.outcome.status === 'applied' &&
      receipt.outcome.paymentCompleted?.paymentId === paymentId), 'payment ID reserved or completed');
  const next = commitDuelPlayingMutation(session.match,
    draft => prepareDuelPayment(draft, actor, paymentId, finalResolvedCost, opaqueSource));
  check(next !== session.match, 'payment preparation must install pending');
  return { session: { ...session, match: next }, persistRequired: true };
}
/** Trusted Cost Resolver only. Pure transform: outer transaction owns version, persistence, and continuation. */
export function prepareDuelPayment(
  match: DuelCanonicalMatchState, actor: string, paymentId: string,
  resolvedCost: DuelRuneCost, sourceReference: DuelPaymentSourceReference,
): DuelCanonicalPlayingState {
  check(match.stage === 'playing', 'payment preparation requires playing');
  checkedFrame(match.frame, match);
  check(active(match.frame), 'payment preparation requires an active turn phase');
  check(knownSeat(match, actor) && match.frame.priorityPlayerId === actor,
    'trusted payment preparation requires current priority actor');
  check(match.frame.pendingPayment === null, 'payment already pending');
  const pendingPayment: DuelPendingPayment = { paymentId: id(paymentId), actor,
    resolvedCost: detachedFinalCost(resolvedCost), sourceReference: detachedSource(sourceReference) };
  // Pure preparation for a trusted outer card transaction: caller must commit this via the outer
  // allocator. Required-cost bypass is only available through the issued task/session path above.
  return { ...match, frame: { ...match.frame, pendingPayment } };
}

export interface PublicDuelCanonicalPlayer extends PublicDuelMatchPlayer {
  /** Public unordered zone, deliberately only UID and cardId (CR 108). */
  readonly trash: readonly { readonly uid: string; readonly cardId: string }[];
}
export interface PublicDuelCanonicalFrame extends Omit<DuelCanonicalFrame, 'pendingPayment'> {
  readonly pendingPayment: null | { readonly active: true;
    readonly paymentId?: string; readonly resolvedCost?: DuelRuneCost };
}
export type PublicDuelCanonicalPlaying = Omit<PublicDuelMatchPlaying, 'players' | 'frame'> & {
  readonly players: readonly [PublicDuelCanonicalPlayer, PublicDuelCanonicalPlayer];
  readonly frame: PublicDuelCanonicalFrame;
};
export type PublicDuelCanonicalMatch = PublicDuelMatchSetup | PublicDuelCanonicalPlaying;

/** Public allowlist from the one current match; the private session ledger is never an input. */
export function projectCanonicalDuelMatch(
  match: DuelCanonicalMatchState, viewer: string | null,
): PublicDuelCanonicalMatch {
  check(viewer === null || knownSeat(match, viewer), 'unknown viewer');
  if (match.stage === 'setup') return projectDuelMatch(match, viewer) as PublicDuelMatchSetup;
  const players = match.players.map((player): PublicDuelCanonicalPlayer => ({
    playerId: player.playerId, champion: player.champion ? { cardId: player.champion.cardId } : null,
    legend: { cardId: player.legend.cardId }, handCount: player.hand.length,
    mainDeckCount: player.remainingMainDeck.length,
    ...(viewer === player.playerId ? { hand: player.hand.map(card => ({ uid: card.uid, cardId: card.cardId })) } : {}),
    trash: player.trash.map(card => ({ uid: card.uid, cardId: card.cardId })),
  })) as [PublicDuelCanonicalPlayer, PublicDuelCanonicalPlayer];
  const pending = match.frame.pendingPayment;
  const pendingPayment: PublicDuelCanonicalFrame['pendingPayment'] = pending === null ? null
    : viewer === pending.actor
      ? { active: true, paymentId: pending.paymentId, resolvedCost: detachedFinalCost(pending.resolvedCost) }
      : { active: true };
  return { schemaVersion: match.schemaVersion, rulesetId: match.rulesetId,
    matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    stateVersion: match.stateVersion, eventSeq: match.eventSeq,
    roster: match.roster.map(person => ({ playerId: person.playerId, displayName: person.displayName })) as
      [{ playerId: string; displayName: string }, { playerId: string; displayName: string }],
    turnOrder: [...match.turnOrder] as [string, string], stage: 'playing', players,
    board: { ...projectPublicDuelBoard(match.board),
      units: match.board.units.length ? projectPublicDuelUnitObjects(match) : [] },
    resources: projectPublicDuelResources(match.resources),
    scoring: projectPublicDuelScoring(match.scoring, match.board),
    frame: { phase: match.frame.phase, turnNumber: match.frame.turnNumber,
      turnPlayerId: match.frame.turnPlayerId, priorityPlayerId: match.frame.priorityPlayerId,
      focusPlayerId: match.frame.focusPlayerId, stateOpen: match.frame.stateOpen, pendingPayment },
  };
}

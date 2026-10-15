// INTERNAL Standard Move handoff. This is not a client command, source-closure oracle, archive
// restore API, or trigger executor. Only a trusted handler service may certify the entire Move
// event group; absent/unknown coverage cannot be promoted into a no-trigger assertion.
// Trusted timing, Ganking and handler lineage plus a durable canonical-state CAS remain the
// integrator's responsibility; object identity and locks below last only for this JS process.
import { applyOpenDuelCleanup } from './battlefields.js';
import { moveDuelUnitsWithMetadata, assertDuelUnitLifecycleState,
  type DuelUnitLifecycleState } from './unit-lifecycle.js';
import type { DuelMoveEvent, DuelStandardMoveGroup, DuelStandardMoveTiming } from './movement.js';

export interface DuelStandardMoveIntentV2 {
  readonly actor: string;
  readonly unitUIDs: readonly string[];
  readonly destinationLocationId: string;
}
/** Scalar, process-local continuation; neither this JSON nor its clone is an authority. */
export interface DuelStandardMoveCursorV2 {
  readonly kind: 'duel-standard-move-v2';
  readonly taskId: string;
  readonly beforeVersion: number;
  readonly movedVersion: number;
  readonly step: 'awaiting-move-triggers';
}
/** Every event of the *one paid group action* must be covered, including a certified empty handler set. */
export interface DuelStandardMoveTriggerObligationV2 {
  readonly kind: 'move-trigger-obligation';
  readonly taskId: string;
  readonly movedVersion: number;
  readonly events: readonly DuelMoveEvent[];
}
export interface DuelStandardMovePendingV2<S extends DuelUnitLifecycleState> {
  readonly status: 'pending';
  readonly state: S;
  readonly group: DuelStandardMoveGroup;
  readonly cursor: DuelStandardMoveCursorV2;
  readonly obligation: DuelStandardMoveTriggerObligationV2;
}
/** A service must cover the whole group, not just report the first event or an unbound Boolean. */
export type DuelStandardMoveHandlerAnswerV2<S extends DuelUnitLifecycleState = DuelUnitLifecycleState> =
  | { readonly status: 'pending' | 'unknown' }
  | { readonly status: 'settled'; readonly taskId: string; readonly movedVersion: number;
      readonly settledVersion: number; readonly events: readonly DuelMoveEvent[];
      readonly disposition: 'no-triggers' }
  | { readonly status: 'settled'; readonly taskId: string; readonly movedVersion: number;
      readonly settledVersion: number; readonly events: readonly DuelMoveEvent[];
      readonly disposition: 'handlers-settled';
      /** Identity attested by the trusted handler, not merely an arbitrary caller-supplied clone. */
      readonly successorState: S };
export type DuelStandardMoveHandlerServiceV2<S extends DuelUnitLifecycleState> =
  (context: { readonly movedState: S; readonly currentState: S;
    readonly obligation: DuelStandardMoveTriggerObligationV2 }) => DuelStandardMoveHandlerAnswerV2<S>;
/** Opaque in-memory capability issued only after a trusted service's exact full-event answer. */
export interface DuelStandardMoveSettlementProofV2 {
  readonly kind: 'duel-standard-move-settlement-v2';
  readonly taskId: string;
  readonly movedVersion: number;
  readonly settledVersion: number;
  readonly disposition: 'no-triggers' | 'handlers-settled';
  readonly events: readonly DuelMoveEvent[];
}
export type DuelStandardMoveCertificationV2 =
  | { readonly status: 'pending'; readonly obligation: DuelStandardMoveTriggerObligationV2 }
  | { readonly status: 'ready'; readonly proof: DuelStandardMoveSettlementProofV2 };
export interface DuelStandardMoveCompletedV2<S extends DuelUnitLifecycleState> {
  readonly status: 'completed';
  readonly state: S;
  readonly group: DuelStandardMoveGroup;
  readonly cleanupApplied: true;
}

type Snapshot = null | string | number | boolean | readonly Snapshot[] | SnapshotRecord;
interface SnapshotRecord { readonly [key: string]: Snapshot }
interface PendingBond {
  readonly movedState: DuelUnitLifecycleState;
  readonly movedSnapshot: Snapshot;
  readonly cursor: DuelStandardMoveCursorV2;
  readonly obligation: DuelStandardMoveTriggerObligationV2;
  /** Detached from both the primitive's group and every publicly returned group. */
  readonly groupSnapshot: DuelStandardMoveGroup;
  readonly lockedStates: Map<object, Snapshot>;
  proof: DuelStandardMoveSettlementProofV2 | null;
  certifying: boolean;
  resuming: boolean;
  consumed: boolean;
}
interface ProofBond {
  readonly pending: PendingBond;
  readonly currentState: DuelUnitLifecycleState;
  readonly currentSnapshot: Snapshot;
}
const pendingBonds = new WeakMap<object, PendingBond>();
const proofBonds = new WeakMap<object, ProofBond>();
// This is process-local admission, NOT a durable CAS or an identity for cloned/restored aggregates.
// 'used' prevents a stale source/branch from starting another paid action in this process.
const admissions = new WeakMap<object, 'beginning' | 'used' | PendingBond>();
const STATE_KEYS = ['stateVersion', 'board', 'resources', 'players', 'unitMeta', 'retiredUnitTokenUIDs'] as const;
let nextTask = 0;
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new TypeError(`V2 Standard Move: ${message}`);
}
function record(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), `${label} record`);
  check(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null,
    `${label} plain object`);
  const actual = Reflect.ownKeys(raw);
  check(actual.length === keys.length && keys.every(key => actual.includes(key)) &&
    actual.every(key => typeof key === 'string' && 'value' in Object.getOwnPropertyDescriptor(raw, key)!),
  `${label} keys/accessors`);
  return raw as Record<string, unknown>;
}
function events(raw: unknown, expected: readonly DuelMoveEvent[]): boolean {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype ||
      Reflect.ownKeys(raw).length !== expected.length + 1 || raw.length !== expected.length) return false;
  return expected.every((event, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor || !('value' in descriptor)) return false;
    const value = descriptor.value as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const e = record(value, ['objectId', 'actor', 'fromLocationId', 'toLocationId'], `events[${index}]`);
    return e.objectId === event.objectId && e.actor === event.actor &&
      e.fromLocationId === event.fromLocationId && e.toLocationId === event.toLocationId;
  });
}
function cloneEvents(source: readonly DuelMoveEvent[]): readonly DuelMoveEvent[] {
  return Object.freeze(source.map(event => Object.freeze({
    objectId: event.objectId, actor: event.actor,
    fromLocationId: event.fromLocationId, toLocationId: event.toLocationId,
  })));
}
function cloneGroup(source: DuelStandardMoveGroup, boundEvents: readonly DuelMoveEvent[]): DuelStandardMoveGroup {
  check(boundEvents.length > 0 && boundEvents.every(event => event.actor === source.actor &&
    event.toLocationId === source.destinationLocationId), 'group/events mismatch');
  return Object.freeze({ kind: 'standard-move', actor: source.actor,
    destinationLocationId: source.destinationLocationId,
    objectIds: Object.freeze(boundEvents.map(event => event.objectId)),
    exhaustedCount: boundEvents.length, events: cloneEvents(boundEvents),
    requiresMoveTriggers: true, requiresOpenCleanup: true });
}
/** Strict, descriptor-only copy of the *entire* supported aggregate; no object toJSON/JSON coercion. */
function snapshotValue(raw: unknown, ancestors = new Set<object>()): Snapshot {
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    check(Number.isFinite(raw), 'non-finite state number');
    return raw;
  }
  check(typeof raw === 'object', 'non-data state value');
  check(!ancestors.has(raw), 'cyclic state');
  ancestors.add(raw);
  try {
    if (Array.isArray(raw)) {
      check(Object.getPrototypeOf(raw) === Array.prototype, 'non-plain state array');
      const keys = Reflect.ownKeys(raw);
      check(keys.length === raw.length + 1 && keys.includes('length'), 'sparse/extra state array');
      const output: Snapshot[] = [];
      for (let index = 0; index < raw.length; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        check(item && 'value' in item && item.enumerable, 'state array accessor/hole');
        output.push(snapshotValue(item.value, ancestors));
      }
      return Object.freeze(output);
    }
    check(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null,
      'non-plain state object');
    const output: Record<string, Snapshot> = Object.create(null);
    const keys = Reflect.ownKeys(raw);
    check(keys.every(key => typeof key === 'string' && key !== 'toJSON'), 'state symbol/toJSON');
    for (const key of (keys as string[]).sort()) {
      const item = Object.getOwnPropertyDescriptor(raw, key);
      check(item && 'value' in item && item.enumerable, 'state accessor/non-enumerable key');
      Object.defineProperty(output, key, { value: snapshotValue(item.value, ancestors), enumerable: true });
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(raw);
  }
}
function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length &&
    a.every((value, index) => sameSnapshot(value, b[index]!));
  if (Array.isArray(b)) return false;
  const left = Object.keys(a).sort();
  const right = Object.keys(b).sort();
  return left.length === right.length && left.every((key, index) => key === right[index] &&
    sameSnapshot((a as Readonly<Record<string, Snapshot>>)[key]!,
      (b as Readonly<Record<string, Snapshot>>)[key]!));
}
function stateSnapshot(state: DuelUnitLifecycleState): Snapshot {
  // The lifecycle type admits other root fields for other consumers; this executor cannot infer
  // their authority. An explicit adapter/extension is needed rather than silently ignoring them.
  record(state, STATE_KEYS, 'state');
  const result = snapshotValue(state);
  assertDuelUnitLifecycleState(state);
  return result;
}
function pending(cursor: DuelStandardMoveCursorV2, state: DuelUnitLifecycleState): PendingBond {
  const bond = cursor && typeof cursor === 'object' ? pendingBonds.get(cursor) : undefined;
  check(bond && bond.cursor === cursor && !bond.consumed && bond.proof === null,
    'unbound, consumed, or already-certified cursor');
  check(!bond.certifying && !bond.resuming, 'trigger settlement already in-flight');
  check(bond.movedState.stateVersion === cursor.movedVersion &&
    sameSnapshot(stateSnapshot(bond.movedState), bond.movedSnapshot), 'moved state drift');
  check(state.stateVersion >= cursor.movedVersion, 'stale trigger state version');
  return bond;
}

/** Pay exhaustion and move once via the existing metadata-backed primitive; NEVER use moveDuelUnitV2. */
export function beginDuelStandardMoveV2<S extends DuelUnitLifecycleState>(
  state: S, intent: DuelStandardMoveIntentV2, trustedTiming: DuelStandardMoveTiming,
  trustedGanking: (unitUID: string) => boolean,
): DuelStandardMovePendingV2<S> {
  check(typeof trustedGanking === 'function', 'trusted Ganking evaluator required');
  check(!admissions.has(state), 'source state already used or has outstanding Standard Move');
  const before = stateSnapshot(state);
  const request = record(intent, ['actor', 'unitUIDs', 'destinationLocationId'], 'intent');
  // Reserve before invoking trusted Ganking (which is synchronous, but can re-enter this API).
  admissions.set(state, 'beginning');
  try {
    // The timing is a separate trusted input, not an optional client field on the intent.
    const moved = moveDuelUnitsWithMetadata(state, {
      actor: request.actor, unitUIDs: request.unitUIDs,
      destinationLocationId: request.destinationLocationId, timing: trustedTiming,
    }, trustedGanking);
    check(sameSnapshot(stateSnapshot(state), before), 'source state drift during paid move');
    check(moved.state !== state && moved.state.stateVersion === state.stateVersion + 1,
      'paid move must advance exactly one version');
    const movedSnapshot = stateSnapshot(moved.state);
    check(nextTask < Number.MAX_SAFE_INTEGER, 'task identity overflow');
    const cursor: DuelStandardMoveCursorV2 = Object.freeze({
      kind: 'duel-standard-move-v2', taskId: `duel-standard-move-v2:${++nextTask}`,
      beforeVersion: state.stateVersion, movedVersion: moved.state.stateVersion,
      step: 'awaiting-move-triggers',
    });
    const obligation: DuelStandardMoveTriggerObligationV2 = Object.freeze({
      kind: 'move-trigger-obligation', taskId: cursor.taskId, movedVersion: cursor.movedVersion,
      events: cloneEvents(moved.group.events),
    });
    const groupSnapshot = cloneGroup(moved.group, obligation.events);
    const bond: PendingBond = { cursor, movedState: moved.state, movedSnapshot,
      obligation, groupSnapshot, lockedStates: new Map([[moved.state, movedSnapshot]]),
      proof: null, certifying: false, resuming: false, consumed: false };
    pendingBonds.set(cursor, bond);
    admissions.set(state, 'used');
    admissions.set(moved.state, bond);
    return { status: 'pending', state: moved.state, group: cloneGroup(groupSnapshot, obligation.events),
      cursor, obligation };
  } catch (error) {
    // A failed move did not issue a cursor or pay a cost; another attempt may retry the source.
    if (admissions.get(state) === 'beginning') admissions.delete(state);
    throw error;
  }
}

/**
 * Call only with a trusted *whole-event-group* handler-settlement service after its actual
 * handlers/replacements have completed. For an advanced state that service must attest the exact
 * successor identity, not just its version. This module cannot decide whether the service actually
 * ran any effects; the outer canonical transaction must provide the service AND durable version CAS.
 * Pending/unknown never becomes a no-trigger assertion. No archive/clone is a process-local identity.
 */
export function certifyDuelStandardMoveTriggersV2<S extends DuelUnitLifecycleState>(
  currentState: S, cursor: DuelStandardMoveCursorV2,
  trustedHandler: DuelStandardMoveHandlerServiceV2<S>,
): DuelStandardMoveCertificationV2 {
  const bond = pending(cursor, currentState);
  check(typeof trustedHandler === 'function', 'trusted handler service required');
  check(currentState === bond.movedState || currentState.stateVersion > cursor.movedVersion,
    'handler state must advance its version');
  // Lock the candidate *before* calling the handler: a reentrant begin must not run cleanup here.
  check(!admissions.has(currentState) || admissions.get(currentState) === bond,
    'handler successor belongs to another Standard Move');
  // Snapshot a new candidate before binding it: a failed malformed state cannot reserve a branch.
  const currentSnapshot = stateSnapshot(currentState);
  const previousSnapshot = bond.lockedStates.get(currentState);
  check(previousSnapshot === undefined || sameSnapshot(currentSnapshot, previousSnapshot),
    'handler successor state drift');
  admissions.set(currentState, bond);
  bond.lockedStates.set(currentState, currentSnapshot);
  bond.certifying = true;
  try {
    let response: DuelStandardMoveHandlerAnswerV2<S>;
    try {
      response = trustedHandler({ movedState: bond.movedState as S, currentState,
        obligation: bond.obligation });
    } finally {
      check(sameSnapshot(stateSnapshot(bond.movedState), bond.movedSnapshot) &&
        sameSnapshot(stateSnapshot(currentState), currentSnapshot), 'handler mutated authoritative state');
    }
    if (response?.status === 'pending' || response?.status === 'unknown') {
      record(response, ['status'], 'unresolved handler answer');
      return { status: 'pending', obligation: bond.obligation };
    }
    const settlementKeys = ['status', 'taskId', 'movedVersion', 'settledVersion', 'events', 'disposition'];
    const hasSuccessor = response !== null && typeof response === 'object' &&
      Reflect.ownKeys(response).includes('successorState');
    const answer = record(response, hasSuccessor ? [...settlementKeys, 'successorState'] : settlementKeys,
      'handler settlement');
    check(answer.status === 'settled' && answer.taskId === cursor.taskId &&
      answer.movedVersion === cursor.movedVersion && answer.settledVersion === currentState.stateVersion &&
      (answer.disposition === 'no-triggers' || answer.disposition === 'handlers-settled') &&
      events(answer.events, bond.obligation.events), 'foreign or incomplete trigger settlement');
    check(answer.disposition !== 'no-triggers' || (!hasSuccessor && currentState === bond.movedState),
      'no-trigger proof cannot follow a handler mutation');
    check(answer.disposition !== 'handlers-settled' || (hasSuccessor && answer.successorState === currentState),
      'handler successor identity mismatch');
    const proof: DuelStandardMoveSettlementProofV2 = Object.freeze({
      kind: 'duel-standard-move-settlement-v2', taskId: cursor.taskId,
      movedVersion: cursor.movedVersion, settledVersion: currentState.stateVersion,
      disposition: answer.disposition, events: cloneEvents(bond.obligation.events),
    });
    bond.proof = proof;
    proofBonds.set(proof, { pending: bond, currentState, currentSnapshot });
    return { status: 'ready', proof };
  } finally {
    // A thrown/unresolved handler leaves its cursor pending; it can be retried, never half-certified.
    bond.certifying = false;
  }
}

/** Exactly one Open cleanup, only with the matching in-process proof and unchanged settled state. */
export function resumeDuelStandardMoveV2<S extends DuelUnitLifecycleState>(
  currentState: S, cursor: DuelStandardMoveCursorV2,
  proof: DuelStandardMoveSettlementProofV2,
): DuelStandardMoveCompletedV2<S> {
  const bond = cursor && typeof cursor === 'object' ? pendingBonds.get(cursor) : undefined;
  check(bond && bond.cursor === cursor && !bond.consumed, 'unbound or consumed cursor');
  check(!bond.certifying && !bond.resuming, 'settlement or cleanup already in-flight');
  const certified = proof && typeof proof === 'object' ? proofBonds.get(proof) : undefined;
  check(certified && certified.pending === bond && bond.proof === proof &&
    certified.currentState === currentState &&
    proof.taskId === cursor.taskId && proof.movedVersion === cursor.movedVersion &&
    proof.settledVersion === currentState.stateVersion &&
    events(proof.events, bond.obligation.events), 'foreign, forged, or stale settlement proof');
  check(sameSnapshot(stateSnapshot(bond.movedState), bond.movedSnapshot) &&
    sameSnapshot(stateSnapshot(currentState), certified.currentSnapshot), 'settled state drift');
  bond.resuming = true;
  try {
    const cleaned = applyOpenDuelCleanup(currentState.board);
    const changed = !sameSnapshot(snapshotValue(cleaned), snapshotValue(currentState.board));
    check(!changed || currentState.stateVersion < Number.MAX_SAFE_INTEGER, 'cleanup version overflow');
    const state = (changed ? { ...currentState, board: cleaned,
      stateVersion: currentState.stateVersion + 1 } : currentState) as S;
    stateSnapshot(state);
    check(sameSnapshot(stateSnapshot(bond.movedState), bond.movedSnapshot) &&
      sameSnapshot(stateSnapshot(currentState), certified.currentSnapshot), 'settled state drift');
    const group = cloneGroup(bond.groupSnapshot, bond.obligation.events);
    // Nothing is consumed until cleanup and the resulting graph both validate. Stale branches may
    // never restart; only the completed state is eligible for the next paid move.
    bond.consumed = true;
    proofBonds.delete(proof);
    for (const locked of bond.lockedStates.keys()) admissions.set(locked, 'used');
    // A no-op cleanup returns the very same object. Releasing only this completed identity
    // permits the next action; the source and any older handler candidates remain spent.
    if (bond.lockedStates.has(state)) admissions.delete(state);
    bond.lockedStates.clear();
    return { status: 'completed', state, group, cleanupApplied: true };
  } finally {
    bond.resuming = false;
  }
}

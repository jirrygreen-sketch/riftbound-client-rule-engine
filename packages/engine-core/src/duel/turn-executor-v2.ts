// INTERNAL authoritative V2 turn pipeline. Only admitted V2 sessions and a separately trusted
// full-program source registry may drive this. This is NOT a public Main/server provider.
import { commitDuelCommandMutationV2, checkpointDuelTurnCursorV2,
  advanceDuelCommandSessionNativeV2, inspectDuelNativeCommandSessionPathV2,
  type DuelCommandSessionV2 } from './canonical-session-v2.js';
import { inspectDuelPhaseSourcesV2, type DuelPhaseEventV2, type DuelPhaseRegistryV2,
  type DuelPhaseSourceV2 } from './phase-source-authority-v2.js';
import { inspectDuelNativeCommitPathV2, inspectDuelNativeOriginV2,
  type DuelCanonicalPlayingStateV2 } from './core-v2.js';
import type { DuelPhysicalZoneTransition } from './permanent-state.js';
import { beginDuelScoreTurn, scoreDuelBattlefield, gainDuelPoints, getDuelWinnerAtCleanup } from './scoring.js';
import { channelDuelRunes, clearAllDuelRunePools } from './resources.js';
import { startDuelDraw, resumeDuelDraw, type DuelDrawCursor, type DuelDrawStepResult } from './draw-burnout.js';
import { applyOpenDuelCleanup } from './battlefields.js';
import { readyDuelUnits, healAllDuelUnitDamage, queryLethalDuelUnitCandidates,
  planDuelUnitKills, commitApprovedDuelUnitKills, type DuelKillPlan, type PublicDuelUnitObject } from './unit-lifecycle.js';

type StartStep = 'awaken' | 'begin' | 'hold' | 'hold-effects' | 'channel' |
  'channel-effects' | 'draw' | 'draw-effects' | 'burnout-first' |
  'burnout-intervention' | 'main' | 'main-effects';
type EndStep = 'ending' | 'special-designations' | 'special-lethal' | 'special-expiration' |
  'special-remaining' | 'special-fepr' | 'ordinary-designations' | 'ordinary-lethal' |
  'ordinary-remaining' | 'ordinary-fepr' | 'awaiting-turn-start' | 'ended';
type Step = StartStep | EndStep;
/** Only scalar continuation, never board/resources/zones/scoring or a duplicated match. */
export interface DuelTurnCursorV2 {
  readonly kind: 'v2-turn';
  readonly matchId: string;
  readonly turn: number;
  readonly rootTaskID: string;
  readonly step: Step;
  readonly holdIndex: number;
  readonly pendingTaskID: string | null;
  readonly consumedIDs: readonly string[];
  /** Full live-source/program-registry identities settled in this boundary's fixed point.
   * A retry may execute newly qualified identities, but never replay a settled identity. */
  readonly handlerSettledIDs: readonly string[];
  readonly firstChannelProcessedPlayerIDs: readonly string[];
  readonly drawCursor: DuelDrawCursor | null;
  readonly expirationIteration: number;
  readonly cleanupRound: number;
  readonly cleanupChanged: boolean;
  readonly feprProcessed: boolean;
  readonly stateVersion: number;
  readonly eventSeq: number;
}
export interface DuelTurnServicesV2 {
  /** Whole-program catalog/IR range authority, constructed only inside the trusted runtime. */
  readonly sources: DuelPhaseRegistryV2;
  /** Receives the actual admitted head before each boundary and at terminal handoff.
   * A runtime may advance its private operation journal along native Core commits here.
   * This is observation, not source/effect coverage. Refusal or throw retains a pending
   * cursor at the current head; it cannot roll already committed steps back to the input. */
  readonly observeCheckpoint?: (checkpoint: DuelTurnCheckpointV2) => boolean;
  /** Required only for lethal Units: actual derived Might and lethal threshold, NEVER printed metadata. */
  readonly lethalEvaluators?: {
    readonly currentMight: (unit: PublicDuelUnitObject) => number;
    readonly lethalDamageThreshold: (unit: PublicDuelUnitObject, might: number) => number;
  };
  /** Registers pre-exit triggers/replacements before approving Kills. Absence is pending. */
  readonly approveLethal?: (plan: DuelKillPlan, match: DuelCanonicalPlayingStateV2) =>
    { readonly status: 'pending' } | { readonly status: 'approved'; readonly approvedUnitUIDs: readonly string[] };
  /** Trusted outstanding-item service, including FEPR. `processed` MUST be a concrete
   * changed V2 aggregate plus physical trace. The next pass repeats cleanup/Expiration. */
  readonly fepr?: (match: DuelCanonicalPlayingStateV2, taskId: string) =>
    { readonly status: 'pending' | 'none' } | { readonly status: 'processed';
      readonly match: DuelCanonicalPlayingStateV2; readonly transitions: readonly DuelPhysicalZoneTransition[] };
  /** Burnout point one may be prevented/replaced; no automatic scoring without this resolver. */
  readonly firstBurnout?: (match: DuelCanonicalPlayingStateV2, taskId: string) =>
    { readonly status: 'pending' } | { readonly status: 'scored' | 'prevented' };
  /** After a Burnout point the trusted provider resolves triggered pending items and
   * cleans up before the next attempt. Unsupported effects cannot be bypassed by retry. */
  readonly burnoutIntervention?: (match: DuelCanonicalPlayingStateV2, taskId: string) =>
    { readonly status: 'pending' } | { readonly status: 'settled' };
  readonly randomIndex?: (bound: number) => number;
  /** Trusted actual handler/replacement executor. Must return a concrete V2 draft and ordered
   * physical transfers; it cannot self-certify a missing or unknown source. */
  readonly resolveHandlers?: (context: { readonly match: DuelCanonicalPlayingStateV2;
    readonly turn: number; readonly taskId: string; readonly step: Step;
    readonly sources: readonly DuelPhaseSourceV2[] }) =>
    { readonly status: 'pending' } | { readonly status: 'applied';
      readonly match: DuelCanonicalPlayingStateV2;
      readonly transitions: readonly DuelPhysicalZoneTransition[] };
  /** Explicit native handler capability. The returned match MUST be a genuinely admitted
   * descendant of the exact context head, produced by Core native kernels. This is opt-in:
   * when absent, `resolveHandlers` retains its draft/transition semantics. */
  readonly resolveNativeHandlers?: (context: { readonly session: DuelCommandSessionV2;
    readonly match: DuelCanonicalPlayingStateV2;
    readonly turn: number; readonly taskId: string; readonly step: Step;
    readonly sources: readonly DuelPhaseSourceV2[]; readonly holdIndex?: number;
    /** Only the live, protected Hold callback receives this nominal invocation. */
    readonly nativeHoldInvocationV3?: DuelNativeHoldInvocationV3 }) =>
    { readonly status: 'pending'; readonly session?: DuelCommandSessionV2 } | { readonly status: 'applied';
      readonly match: DuelCanonicalPlayingStateV2;
      /** Native execution receipt. Hold must explicitly identify the proven subject trigger. */
      readonly handledSources?: readonly DuelPhaseSourceV2[] } |
    { readonly status: 'continuing'; readonly session: DuelCommandSessionV2;
      readonly tokenPlay: unknown;
      readonly handledSources: readonly DuelPhaseSourceV2[] };
}
export interface DuelNativeHoldInvocationV3 { readonly _duelNativeHoldInvocationV3: unique symbol }
export interface DuelNativeHoldAttemptV3 { readonly _duelNativeHoldAttemptV3: unique symbol }
interface NativeHoldInvocationEntryV3 {
  readonly session: DuelCommandSessionV2; readonly match: DuelCanonicalPlayingStateV2;
  readonly taskId: string; readonly holdIndex: number; readonly subject: DuelPhaseSourceV2;
  readonly marker: { poisoned: boolean };
  /** `active` gates minting; an already issued attempt has its own continuation lifetime. */
  active: boolean; issued: boolean; attemptActive: boolean;
}
const nativeHoldInvocationsV3 = new WeakMap<object, NativeHoldInvocationEntryV3>();
const nativeHoldAttemptsV3 = new WeakMap<object, NativeHoldInvocationEntryV3>();
/** No caller can create this capability from a head, clock, source ID, or registry result. */
export function issueDuelNativeHoldAttemptV3(invocation: DuelNativeHoldInvocationV3,
  source: DuelPhaseSourceV2): DuelNativeHoldAttemptV3 {
  const entry = invocation && typeof invocation === 'object' ? nativeHoldInvocationsV3.get(invocation) : undefined;
  check(entry?.active && !entry.issued && !entry.marker.poisoned &&
    samePhaseSourceDataV3(entry.subject, source), 'inactive or foreign native Hold invocation');
  entry.issued = true;
  entry.attemptActive = true;
  const attempt = Object.freeze(Object.create(null)) as DuelNativeHoldAttemptV3;
  nativeHoldAttemptsV3.set(attempt, entry);
  return attempt;
}
/** A live attempt is checked against the exact callback head and private command lineage. */
export function inspectDuelNativeHoldAttemptV3(attempt: DuelNativeHoldAttemptV3,
  session: DuelCommandSessionV2, sourceUID: string, sourceZoneEpoch: number,
  controllerPlayerId: string, taskId: string): boolean {
  const entry = attempt && typeof attempt === 'object' ? nativeHoldAttemptsV3.get(attempt) : undefined;
  if (!entry?.attemptActive || entry.marker.poisoned || entry.taskId !== taskId ||
      entry.subject.uid !== sourceUID || entry.subject.zoneEpoch !== sourceZoneEpoch ||
      entry.subject.controllerPlayerId !== controllerPlayerId) return false;
  try {
    const sessions = inspectDuelNativeCommandSessionPathV2(entry.session, session);
    const sameContinuation = (current: DuelCommandSessionV2): boolean => {
      const cursor = current.turnCursorV2;
      return !!cursor && cursorBonds.get(current) === cursor &&
        cursor.step === entry.session.turnCursorV2!.step && cursor.holdIndex === entry.holdIndex &&
        cursor.turn === entry.match.frame.turnNumber && cursor.matchId === entry.match.matchId &&
        task(cursor) === entry.taskId && cursor.pendingTaskID === entry.taskId &&
        !cursor.consumedIDs.includes(entry.taskId);
    };
    if (!sameContinuation(entry.session) || sessions.some(commit => !sameContinuation(commit.after)))
      return false;
    const data = (value: unknown, key: PropertyKey): unknown => {
      if (value === null || typeof value !== 'object') return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    };
    const sameSource = (currentMatch: DuelCanonicalPlayingStateV2): boolean => {
      if (currentMatch.frame.phase !== entry.match.frame.phase ||
          currentMatch.frame.turnNumber !== entry.match.frame.turnNumber ||
          currentMatch.frame.turnPlayerId !== entry.match.frame.turnPlayerId ||
          currentMatch.frame.priorityPlayerId !== entry.match.frame.priorityPlayerId ||
          currentMatch.frame.focusPlayerId !== entry.match.frame.focusPlayerId) return false;
      const board = data(currentMatch, 'board');
      const fields = data(board, 'battlefields');
      const field = data(fields, String(entry.holdIndex));
      const physical = data(data(currentMatch, 'physicalCardsByUID'), sourceUID);
      const uid = data(field, 'instanceId');
      const cardId = data(field, 'cardId');
      const locationId = data(field, 'locationId');
      const controller = data(field, 'controllerPlayerId');
      const zoneEpoch = data(physical, 'zoneEpoch');
      if (typeof uid !== 'string' || typeof cardId !== 'string' || typeof locationId !== 'string' ||
          (typeof controller !== 'string' && controller !== null) ||
          !Number.isSafeInteger(zoneEpoch)) return false;
      const current: DuelPhaseSourceV2 = { uid, kind: 'battlefield', cardId,
        zoneEpoch: zoneEpoch as number, controllerPlayerId: controller,
        zone: { kind: 'board-battlefield', locationId } };
      return samePhaseSourceDataV3(entry.subject, current);
    };
    return sameSource(entry.match) && inspectDuelNativeCommitPathV2(entry.match, session.match)
      .every(commit => commit.after.stage === 'playing' && sameSource(commit.after));
  } catch { return false; }
}
export interface DuelTurnCheckpointV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly turn: number;
  readonly taskId: string;
  readonly step: DuelTurnCursorV2['step'];
  readonly event: DuelPhaseEventV2;
}
export interface DuelTurnResultV2 {
  readonly session: DuelCommandSessionV2;
  readonly status: 'pending' | 'main' | 'awaiting-turn-start' | 'ended' | 'duplicate' | 'rejected';
  readonly pending?: { readonly taskId: string; readonly turn: number; readonly step: Step };
  readonly reason?: string;
  readonly persistRequired: boolean;
}
const startSteps: readonly Step[] = ['awaken', 'begin', 'hold', 'hold-effects', 'channel',
  'channel-effects', 'draw', 'draw-effects', 'burnout-first', 'burnout-intervention', 'main', 'main-effects', 'ended'];
const endSteps: readonly Step[] = ['ending', 'special-designations', 'special-lethal', 'special-expiration',
  'special-remaining', 'special-fepr', 'ordinary-designations', 'ordinary-lethal', 'ordinary-remaining',
  'ordinary-fepr', 'awaiting-turn-start', 'ended'];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** A private in-process cursor bond; an arbitrary clone/JSON sidecar has no authority.
 * Archive restoration remains unavailable until independent ledger + cursor journal proof. */
const cursorBonds = new WeakMap<object, DuelTurnCursorV2>();
// Trusted registry handles are private identities. Bind the settled-key to the whole-program
// registry (not an arbitrary caller-controlled printing string); switching registries during
// a pending boundary cannot silently reuse earlier handler evidence.
const registryIDs = new WeakMap<object, number>();
let nextRegistryID = 0;
const nativeResolutionActive = new WeakMap<object, Map<string, { poisoned: boolean }>>();
/** Compare source records through data descriptors only; no toJSON or getters run. */
function samePhaseSourceDataV3(leftSource: DuelPhaseSourceV2, rightSource: DuelPhaseSourceV2): boolean {
  const equal = (left: unknown, right: unknown, depth: number): boolean => {
    if (Object.is(left, right)) return true;
    if (depth > 2 || !left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftKeys = Reflect.ownKeys(left), rightKeys = Reflect.ownKeys(right);
    if (leftKeys.length !== rightKeys.length || leftKeys.some(key => !rightKeys.includes(key))) return false;
    for (const key of leftKeys) {
      const ld = Object.getOwnPropertyDescriptor(left, key);
      const rd = Object.getOwnPropertyDescriptor(right, key);
      if (!ld || !rd || !('value' in ld) || !('value' in rd) || !equal(ld.value, rd.value, depth + 1)) return false;
    }
    return true;
  };
  return equal(leftSource, rightSource, 0);
}
function registryID(handle: DuelPhaseRegistryV2): number {
  if (!handle || typeof handle !== 'object') return -1;
  let id = registryIDs.get(handle);
  if (id === undefined) { id = ++nextRegistryID; registryIDs.set(handle, id); }
  return id;
}
function handlerKey(c: DuelTurnCursorV2, source: DuelPhaseSourceV2,
  registry: DuelPhaseRegistryV2): string {
  // Handler qualification is about the complete live source identity, not only the physical
  // card's UID/epoch. Board-only relocation preserves zoneEpoch, while control changes can
  // change eligibility without changing either value; both must therefore create a fresh key.
  return `${task(c)}:handler:${JSON.stringify([registryID(registry), source.uid,
    source.zoneEpoch, source.kind, source.cardId, source.controllerPlayerId, source.zone])}`;
}
function handlerKeyAtStep(c: DuelTurnCursorV2, step: Step, source: DuelPhaseSourceV2,
  registry: DuelPhaseRegistryV2): string {
  return handlerKey({ ...c, step }, source, registry);
}
/** Carry a bound scalar turn cursor across a native command successor. Ledger-owned payment
 * successors may intentionally retain a stale cursor clock until payment closure; they are
 * returned directly to the payment owner and aligned only after that ledger closes. */
export function inheritDuelTurnCursorBondV2(before: DuelCommandSessionV2, after: DuelCommandSessionV2): void {
  const beforeCursor = before.turnCursorV2, afterCursor = after.turnCursorV2;
  const holdPayment = beforeCursor && (beforeCursor.step === 'hold' || beforeCursor.step === 'hold-effects') &&
    beforeCursor.pendingTaskID === task(beforeCursor);
  if (beforeCursor && cursorBonds.get(before) === beforeCursor && afterCursor &&
      before.match.stage === 'playing' && after.match.stage === 'playing' &&
      after.match.matchId === before.match.matchId &&
      afterCursor.matchId === beforeCursor.matchId &&
      afterCursor.turn === beforeCursor.turn && afterCursor.rootTaskID === beforeCursor.rootTaskID &&
      afterCursor.step === beforeCursor.step &&
      beforeCursor.stateVersion <= before.match.stateVersion &&
      beforeCursor.eventSeq <= before.match.eventSeq &&
      (holdPayment || beforeCursor.stateVersion === before.match.stateVersion &&
        beforeCursor.eventSeq === before.match.eventSeq) &&
      before.match.eventSeq === before.match.stateVersion &&
      after.match.eventSeq === after.match.stateVersion &&
      afterCursor.stateVersion <= after.match.stateVersion &&
      afterCursor.eventSeq <= after.match.eventSeq &&
      (holdPayment || afterCursor.stateVersion === after.match.stateVersion &&
        afterCursor.eventSeq === after.match.eventSeq) &&
      afterCursor.stateVersion >= beforeCursor.stateVersion &&
      afterCursor.eventSeq >= beforeCursor.eventSeq &&
      same({ ...afterCursor, stateVersion: beforeCursor.stateVersion, eventSeq: beforeCursor.eventSeq },
        beforeCursor)) {
    try {
      inspectDuelNativeCommandSessionPathV2(before, after);
      cursorBonds.set(after, afterCursor);
    } catch { return; }
  }
}
function check(ok: unknown, label: string): asserts ok { if (!ok) throw new TypeError(`V2 turn: ${label}`); }
function match(session: DuelCommandSessionV2): DuelCanonicalPlayingStateV2 {
  check(session?.match?.stage === 'playing' && session.schemaVersion === 2, 'playing V2 session required');
  return session.match;
}
function clean(session: DuelCommandSessionV2): void {
  const m = match(session);
  check(m.frame.pendingPayment === null &&
    !session.requiredTasks.some(t => t.status === 'issued' || t.status === 'active') &&
    !session.priorityPayments.some(t => t.status === 'active'), 'outstanding cost/payment owns phase');
}
function root(m: DuelCanonicalPlayingStateV2): string {
  return `duel-v2:${m.matchId}:turn-${m.frame.turnNumber}`;
}
function task(c: DuelTurnCursorV2): string {
  return `${c.rootTaskID}:${c.step}:${c.step === 'hold' || c.step === 'hold-effects' ? c.holdIndex :
    c.step.startsWith('special-') || c.step.startsWith('ordinary-') ?
      `${c.expirationIteration}:${c.cleanupRound}` :
      c.step.startsWith('burnout-') ? c.drawCursor?.burnoutIndex : '0'}`;
}
function fresh(m: DuelCanonicalPlayingStateV2, step: Step, first: readonly string[]): DuelTurnCursorV2 {
  return { kind: 'v2-turn', matchId: m.matchId, turn: m.frame.turnNumber, rootTaskID: root(m),
    step, holdIndex: 0, pendingTaskID: null, consumedIDs: [], handlerSettledIDs: [],
    firstChannelProcessedPlayerIDs: [...first], drawCursor: null,
    expirationIteration: 0, cleanupRound: 0, cleanupChanged: false, feprProcessed: false,
    stateVersion: m.stateVersion, eventSeq: m.eventSeq };
}
function valid(s: DuelCommandSessionV2, kind: 'start' | 'end'): DuelTurnCursorV2 {
  const m = match(s), c = s.turnCursorV2;
  check(c !== undefined && cursorBonds.get(s) === c, 'unbound private cursor');
  check(c?.kind === 'v2-turn' && c.matchId === m.matchId && c.turn === m.frame.turnNumber &&
    c.rootTaskID === root(m) && c.stateVersion === m.stateVersion && c.eventSeq === m.eventSeq &&
    (kind === 'start' ? startSteps : endSteps).includes(c.step) &&
    Number.isSafeInteger(c.holdIndex) && c.holdIndex >= 0 && c.holdIndex <= m.board.battlefields.length &&
    Number.isSafeInteger(c.expirationIteration) && c.expirationIteration >= 0 && c.expirationIteration <= 64 &&
    Number.isSafeInteger(c.cleanupRound) && c.cleanupRound >= 0 && c.cleanupRound <= 64 &&
    Array.isArray(c.consumedIDs) && new Set(c.consumedIDs).size === c.consumedIDs.length &&
    c.consumedIDs.every(id => typeof id === 'string' && id.startsWith(`${c.rootTaskID}:`)) &&
    Array.isArray(c.handlerSettledIDs) && new Set(c.handlerSettledIDs).size === c.handlerSettledIDs.length &&
    c.handlerSettledIDs.every(id => typeof id === 'string' && id.startsWith(`${c.rootTaskID}:`) &&
      id.includes(':handler:') && !c.consumedIDs.includes(id)) &&
    (c.pendingTaskID === null || c.pendingTaskID === task(c)) &&
    !c.consumedIDs.includes(task(c)) &&
    !(c.step === 'draw' && c.consumedIDs.includes(`${c.rootTaskID}:draw:0`)) &&
    !(c.step === 'channel' && c.consumedIDs.includes(`${c.rootTaskID}:channel:0`)) &&
    (c.step !== 'hold-effects' || c.consumedIDs.includes(`${c.rootTaskID}:hold:${c.holdIndex}`)) &&
    (c.step !== 'channel-effects' || c.consumedIDs.includes(`${c.rootTaskID}:channel:0`)) &&
    (c.step !== 'draw-effects' || c.consumedIDs.includes(`${c.rootTaskID}:draw:0`)) &&
    (!c.step.startsWith('burnout-') || c.consumedIDs.includes(`${c.rootTaskID}:draw:0`)) &&
    (c.step !== 'main-effects' || c.consumedIDs.includes(`${c.rootTaskID}:draw-effects:0`)) &&
    (c.step !== 'main' || c.consumedIDs.includes(`${c.rootTaskID}:main-effects:0`)) &&
    Array.isArray(c.firstChannelProcessedPlayerIDs) &&
    c.firstChannelProcessedPlayerIDs.every(id => id === m.turnOrder[1]) &&
    new Set(c.firstChannelProcessedPlayerIDs).size === c.firstChannelProcessedPlayerIDs.length,
  'invalid cursor/clock/task history');
  check((c.step === 'awaiting-turn-start' ? m.frame.phase === 'awaiting-turn-start' :
    c.step === 'ended' ? m.frame.phase === 'ended' :
    c.step === 'awaken' ? m.frame.phase === 'awaiting-turn-start' || m.frame.phase === 'awaken' :
    c.step === 'begin' ? m.frame.phase === 'awaken' || m.frame.phase === 'beginning' :
    c.step === 'hold' || c.step === 'hold-effects' ? m.frame.phase === 'beginning' || m.frame.phase === 'scoring' :
    c.step === 'channel' || c.step === 'channel-effects' ? m.frame.phase === 'scoring' || m.frame.phase === 'channel' :
    c.step === 'draw' || c.step === 'draw-effects' || c.step.startsWith('burnout-') ?
      m.frame.phase === 'channel' || m.frame.phase === 'draw' :
    c.step === 'main' || c.step === 'main-effects' ? m.frame.phase === 'main' :
    c.step === 'ending' ? m.frame.phase === 'main' || m.frame.phase === 'ending' :
    m.frame.phase === 'ending' || m.frame.phase === 'expiration'), 'cursor phase mismatch');
  check((c.step.startsWith('burnout-')) === (c.drawCursor !== null), 'draw continuation mismatch');
  return c;
}
function reply(session: DuelCommandSessionV2, status: DuelTurnResultV2['status'],
  persistRequired: boolean, reason?: string): DuelTurnResultV2 {
  const c = session.turnCursorV2;
  return { session, status, persistRequired, ...(reason ? { reason } : {}),
    ...(status === 'pending' && c?.pendingTaskID ?
      { pending: { taskId: c.pendingTaskID, turn: c.turn, step: c.step } } : {}) };
}
function reject(s: DuelCommandSessionV2, reason: string): DuelTurnResultV2 {
  return reply(s, 'rejected', false, reason);
}
function store(s: DuelCommandSessionV2, c: DuelTurnCursorV2): DuelCommandSessionV2 {
  const m = match(s);
  const next = checkpointDuelTurnCursorV2(s, { ...c, stateVersion: m.stateVersion, eventSeq: m.eventSeq });
  cursorBonds.set(next, next.turnCursorV2!);
  return next;
}
/** Payment preparation/receipt commits can advance a non-Main Hold cursor through the
 * canonical session ledger. Rebind that private scalar only after the payment is closed;
 * an open/issued task can never be aligned by this helper. */
function alignClosedPaymentCursor(session: DuelCommandSessionV2): DuelCommandSessionV2 {
  const cursor = session.turnCursorV2;
  if (!cursor || cursorBonds.get(session) !== cursor ||
      (cursor.step !== 'hold' && cursor.step !== 'hold-effects') || cursor.pendingTaskID !== task(cursor) ||
      cursor.stateVersion === match(session).stateVersion || match(session).frame.pendingPayment !== null ||
      session.requiredTasks.some(item => item.status === 'issued' || item.status === 'active') ||
      session.priorityPayments.some(item => item.status === 'active')) return session;
  try {
    const currentMatch = match(session);
    if (cursor.matchId !== currentMatch.matchId || cursor.turn !== currentMatch.frame.turnNumber ||
        (currentMatch.frame.phase !== 'beginning' && currentMatch.frame.phase !== 'scoring')) return session;
    return store(session, { ...cursor, stateVersion: currentMatch.stateVersion, eventSeq: currentMatch.eventSeq });
  } catch { return session; }
}
function move(s: DuelCommandSessionV2, mutate: (draft: DuelCanonicalPlayingStateV2) => {
  readonly match: DuelCanonicalPlayingStateV2; readonly transitions: readonly DuelPhysicalZoneTransition[];
}): DuelCommandSessionV2 {
  const next = commitDuelCommandMutationV2(s, mutate).session;
  return next;
}
function frame(s: DuelCommandSessionV2, phase: DuelCanonicalPlayingStateV2['frame']['phase'],
  open = true, priority: string | null = null): DuelCommandSessionV2 {
  return move(s, m => ({ match: { ...m, frame: { ...m.frame, phase, stateOpen: open,
    priorityPlayerId: priority, focusPlayerId: null, pendingPayment: null } }, transitions: [] }));
}
function finish(c: DuelTurnCursorV2, step: Step, extras: Partial<DuelTurnCursorV2> = {}): DuelTurnCursorV2 {
  const id = task(c);
  check(!c.consumedIDs.includes(id), 'replayed task');
  return { ...c, ...extras, step, pendingTaskID: null, consumedIDs: [...c.consumedIDs, id],
    handlerSettledIDs: c.handlerSettledIDs.filter(item => !item.startsWith(`${id}:handler:`)) };
}
function wait(s: DuelCommandSessionV2, c: DuelTurnCursorV2): DuelTurnResultV2 {
  if (match(s).frame.pendingPayment !== null || s.requiredTasks.some(item => item.status === 'active') ||
      s.requiredTasks.some(item => item.status === 'issued') ||
      s.priorityPayments.some(item => item.status === 'active')) {
    check(s.turnCursorV2 && cursorBonds.get(s) === s.turnCursorV2 &&
      s.turnCursorV2.pendingTaskID === task(c), 'payment lost protected task');
    return reply(s, 'pending', true);
  }
  return reply(store(s, { ...c, pendingTaskID: task(c) }), 'pending', true);
}
function event(step: Step): DuelPhaseEventV2 {
  if (step === 'awaken') return 'awaken';
  if (step === 'begin') return 'begin';
  if (step === 'hold' || step === 'hold-effects') return 'hold';
  if (step === 'channel' || step === 'channel-effects') return 'channel';
  if (step === 'draw' || step === 'draw-effects') return 'draw';
  if (step.startsWith('burnout-')) return 'burnout';
  if (step === 'main' || step === 'main-effects') return 'main';
  if (step === 'ending') return 'ending';
  if (step.endsWith('-designations') || step.endsWith('-remaining')) return 'required-cleanup';
  if (step.endsWith('-lethal')) return 'lethal-kill';
  if (step.endsWith('-fepr')) return 'fepr';
  return 'expiration';
}
function observe(s: DuelCommandSessionV2, c: DuelTurnCursorV2,
  services: DuelTurnServicesV2): boolean {
  if (!services.observeCheckpoint) return true;
  try {
    return services.observeCheckpoint(Object.freeze({ match: match(s), turn: c.turn,
      taskId: task(c), step: c.step, event: event(c.step) })) === true;
  } catch { return false; }
}
function nativeHeadMatchesBoundary(before: DuelCanonicalPlayingStateV2,
  next: DuelCanonicalPlayingStateV2, boundaryCursor: DuelTurnCursorV2,
  subject: DuelCanonicalPlayingStateV2['board']['battlefields'][number] | undefined,
  cursor: DuelTurnCursorV2 | undefined): boolean {
  return next.stage === 'playing' && next.matchId === before.matchId &&
    next.frame.phase === before.frame.phase && next.frame.turnNumber === before.frame.turnNumber &&
    next.frame.turnPlayerId === before.frame.turnPlayerId &&
    next.frame.priorityPlayerId === before.frame.priorityPlayerId &&
    next.frame.focusPlayerId === before.frame.focusPlayerId &&
    (!subject || next.board.battlefields[boundaryCursor.holdIndex]?.instanceId === subject.instanceId) &&
    !!cursor && same({ ...cursor, stateVersion: 0, eventSeq: 0 },
      { ...boundaryCursor, stateVersion: 0, eventSeq: 0 }) &&
    cursor.stateVersion <= next.stateVersion && cursor.eventSeq <= next.eventSeq;
}
function reenteredNativeBoundary(session: DuelCommandSessionV2): boolean {
  const cursor = session.turnCursorV2;
  if (!cursor) return false;
  inspectDuelNativeCommandSessionPathV2(session, session);
  const active = nativeResolutionActive.get(inspectDuelNativeOriginV2(session.match))
    ?.get(`${event(cursor.step)}:${task(cursor)}`);
  if (!active) return false;
  active.poisoned = true;
  return true;
}
function cover(s: DuelCommandSessionV2, c: DuelTurnCursorV2, services: DuelTurnServicesV2):
  { readonly session: DuelCommandSessionV2; readonly ready: boolean; readonly handled: boolean;
    readonly handledKeys: readonly string[] } {
  const before = match(s);
  if (reenteredNativeBoundary(s))
    return { session: s, ready: false, handled: false, handledKeys: [] };
  const subject = c.step === 'hold' || c.step === 'hold-effects'
    ? before.board.battlefields[c.holdIndex]
    : undefined;
  if ((c.step === 'hold' || c.step === 'hold-effects') && !subject)
    return { session: s, ready: true, handled: false, handledKeys: [] };
  const proof = inspectDuelPhaseSourcesV2(before, event(c.step), c.turn, task(c), services.sources,
    subject?.instanceId);
  if (proof.status !== 'ready')
    return { session: s, ready: false, handled: false, handledKeys: [] };
  // A boundary is a fixed point over the current source set. An already-settled identity
  // is skipped, while a changed UID/epoch, registry/program, controller or zone is still
  // presented to the trusted resolver.
  const pendingHandlers = proof.handlers.filter(source =>
    !c.handlerSettledIDs.includes(handlerKey(c, source, services.sources)));
  if (!pendingHandlers.length) return { session: s, ready: true, handled: false, handledKeys: [] };
  if (services.resolveNativeHandlers) {
    const boundaryKey = `${event(c.step)}:${task(c)}`;
    const origin = inspectDuelNativeOriginV2(before);
    let boundaries = nativeResolutionActive.get(origin);
    if (!boundaries) {
      boundaries = new Map();
      nativeResolutionActive.set(origin, boundaries);
    }
    const active = boundaries.get(boundaryKey);
    if (active) {
      active.poisoned = true;
      return { session: s, ready: false, handled: false, handledKeys: [] };
    }
    s = store(s, { ...c, pendingTaskID: task(c) });
    c = s.turnCursorV2!;
    const marker = { poisoned: false };
    boundaries.set(boundaryKey, marker);
    let invocation: DuelNativeHoldInvocationV3 | undefined;
    if ((c.step === 'hold' || c.step === 'hold-effects') && subject) {
      invocation = Object.freeze(Object.create(null)) as DuelNativeHoldInvocationV3;
      nativeHoldInvocationsV3.set(invocation, { session: s, match: before, taskId: task(c),
        holdIndex: c.holdIndex, subject: pendingHandlers.find(source => source.uid === subject.instanceId) ??
          pendingHandlers[0]!, marker, active: true, issued: false, attemptActive: false });
    }
    try {
      const resolved = services.resolveNativeHandlers({ session: s, match: before, turn: c.turn,
        taskId: task(c), step: c.step, sources: pendingHandlers,
        ...(c.step === 'hold' || c.step === 'hold-effects' ? { holdIndex: c.holdIndex,
          nativeHoldInvocationV3: invocation } : {}) });
      if (marker.poisoned) return { session: s, ready: false, handled: false, handledKeys: [] };
      if (resolved?.status === 'continuing') {
        if (!resolved.session || resolved.session === s || !Array.isArray(resolved.handledSources) ||
            resolved.handledSources.length !== 1 || !subject ||
            !resolved.handledSources.some(source => samePhaseSourceDataV3(source,
              pendingHandlers.find(item => item.uid === subject.instanceId)!)))
          return { session: s, ready: false, handled: false, handledKeys: [] };
        try {
          inspectDuelNativeCommandSessionPathV2(s, resolved.session);
          const next = match(resolved.session);
          if (!nativeHeadMatchesBoundary(before, next, c, subject, resolved.session.turnCursorV2))
            return { session: s, ready: false, handled: false, handledKeys: [] };
          return { session: resolved.session, ready: false, handled: false, handledKeys: [] };
        } catch { return { session: s, ready: false, handled: false, handledKeys: [] }; }
      }
      const pendingSession = resolved?.status === 'pending' ? resolved.session : undefined;
      if (pendingSession && pendingSession !== s) {
        try {
          inspectDuelNativeCommandSessionPathV2(s, pendingSession);
          if (!nativeHeadMatchesBoundary(before, match(pendingSession), c, subject,
            pendingSession.turnCursorV2))
            return { session: s, ready: false, handled: false, handledKeys: [] };
          return { session: pendingSession, ready: false, handled: false, handledKeys: [] };
        } catch { return { session: s, ready: false, handled: false, handledKeys: [] }; }
      }
      if (resolved?.status !== 'applied' || resolved.match === before ||
          resolved.match.frame.phase !== before.frame.phase ||
          resolved.match.frame.turnNumber !== before.frame.turnNumber ||
          resolved.match.frame.turnPlayerId !== before.frame.turnPlayerId ||
        resolved.match.frame.priorityPlayerId !== before.frame.priorityPlayerId ||
          resolved.match.frame.pendingPayment !== null) {
        return { session: s, ready: false, handled: false, handledKeys: [] };
      }
      const path = inspectDuelNativeCommitPathV2(before, resolved.match);
      if (!path.length || path.some(commit => commit.before.stage !== 'playing' ||
          commit.after.stage !== 'playing' || commit.before.frame.phase !== before.frame.phase ||
          commit.after.frame.phase !== before.frame.phase ||
          commit.before.frame.turnNumber !== before.frame.turnNumber ||
          commit.after.frame.turnNumber !== before.frame.turnNumber ||
          commit.before.frame.turnPlayerId !== before.frame.turnPlayerId ||
          commit.after.frame.turnPlayerId !== before.frame.turnPlayerId ||
          commit.before.frame.priorityPlayerId !== before.frame.priorityPlayerId ||
          commit.after.frame.priorityPlayerId !== before.frame.priorityPlayerId ||
          commit.before.frame.focusPlayerId !== before.frame.focusPlayerId ||
          commit.after.frame.focusPlayerId !== before.frame.focusPlayerId ||
          commit.before.frame.pendingPayment !== null || commit.after.frame.pendingPayment !== null))
        return { session: s, ready: false, handled: false, handledKeys: [] };
      const handledSources = resolved.handledSources;
      if ((c.step === 'hold' || c.step === 'hold-effects') && !Array.isArray(handledSources))
        return { session: s, ready: false, handled: false, handledKeys: [] };
      const settledSources = handledSources ?? pendingHandlers;
      if (!Array.isArray(settledSources) || settledSources.length === 0 ||
          settledSources.some((source, index) => settledSources.slice(0, index).some(previous =>
            samePhaseSourceDataV3(previous, source))) ||
          settledSources.some(source => !pendingHandlers.some(candidate =>
            samePhaseSourceDataV3(candidate, source))))
        return { session: s, ready: false, handled: false, handledKeys: [] };
      if (c.step === 'hold' || c.step === 'hold-effects') {
        const heldSubject = subject && proof.sources.find(source =>
          source.uid === subject.instanceId && source.kind === 'battlefield' &&
          source.zone.kind === 'board-battlefield' && source.zone.locationId === subject.locationId &&
          source.controllerPlayerId === subject.controllerPlayerId);
        if (!heldSubject || settledSources.length !== 1 ||
            !samePhaseSourceDataV3(heldSubject, settledSources[0]!))
          return { session: s, ready: false, handled: false, handledKeys: [] };
      }
      let tokenBirthCount = 0;
      for (const commit of path) {
        tokenBirthCount += commit.tokenBirths.length;
        if (commit.tokenBirths.length > 1 || (c.step === 'hold' || c.step === 'hold-effects') &&
            commit.tokenBirths.some(birth => birth.kind !== 'recruit' ||
              birth.sourceUID !== settledSources[0]!.uid ||
              birth.controllerPlayerId !== settledSources[0]!.controllerPlayerId))
          return { session: s, ready: false, handled: false, handledKeys: [] };
      }
      if ((c.step === 'hold' || c.step === 'hold-effects') && tokenBirthCount > settledSources.length)
        return { session: s, ready: false, handled: false, handledKeys: [] };
      const next = advanceDuelCommandSessionNativeV2(s, resolved.match).session;
      if (next === s) return { session: s, ready: false, handled: false, handledKeys: [] };
      return { session: next, ready: true, handled: true,
        handledKeys: settledSources.flatMap(source => [handlerKey(c, source, services.sources),
          ...(c.step === 'hold' && subject ? [handlerKeyAtStep(c, 'hold-effects', source, services.sources)] : [])]) };
    } catch { return { session: s, ready: false, handled: false, handledKeys: [] }; }
    finally {
      if (invocation) {
        const issued = nativeHoldInvocationsV3.get(invocation);
        if (issued) issued.active = false;
      }
      if (boundaries.get(boundaryKey) === marker) boundaries.delete(boundaryKey);
      if (!boundaries.size) nativeResolutionActive.delete(origin);
    }
  }
  if (!services.resolveHandlers) return { session: s, ready: false, handled: false, handledKeys: [] };
  try {
    const resolved = services.resolveHandlers({ match: before, turn: c.turn,
      taskId: task(c), step: c.step, sources: pendingHandlers });
    if (resolved?.status !== 'applied' || resolved.match === before ||
        resolved.match.frame.phase !== before.frame.phase ||
        resolved.match.frame.turnNumber !== before.frame.turnNumber ||
        resolved.match.frame.turnPlayerId !== before.frame.turnPlayerId ||
        resolved.match.stateVersion !== before.stateVersion || resolved.match.eventSeq !== before.eventSeq ||
        resolved.match.frame.pendingPayment !== null) return { session: s, ready: false, handled: false, handledKeys: [] };
    const next = move(s, () => ({ match: resolved.match, transitions: resolved.transitions }));
    if (next === s) return { session: s, ready: false, handled: false, handledKeys: [] };
    return { session: next, ready: true, handled: true,
      handledKeys: pendingHandlers.flatMap(source => [handlerKey(c, source, services.sources),
        ...(c.step === 'hold' && subject && source.kind === 'battlefield' &&
          source.uid === subject.instanceId && source.controllerPlayerId === subject.controllerPlayerId
          ? [handlerKeyAtStep(c, 'hold-effects', source, services.sources)] : [])]) };
  } catch { return { session: s, ready: false, handled: false, handledKeys: [] }; }
}
function won(s: DuelCommandSessionV2): boolean {
  const m = match(s);
  return getDuelWinnerAtCleanup(m.scoring, m.board) !== null;
}
function ended(s: DuelCommandSessionV2, c: DuelTurnCursorV2,
  services: DuelTurnServicesV2): DuelTurnResultV2 {
  const next = frame(s, 'ended', false);
  const terminal = finish(c, 'ended', { drawCursor: null });
  if (!observe(next, terminal, services)) return wait(next, terminal);
  return reply(store(next, terminal), 'ended', true);
}
function drawResult(s: DuelCommandSessionV2, c: DuelTurnCursorV2, result: DuelDrawStepResult,
  services: DuelTurnServicesV2):
  { session: DuelCommandSessionV2; cursor: DuelTurnCursorV2 } | DuelTurnResultV2 {
  const actor = match(s).frame.turnPlayerId;
  const next = move(s, m => {
    const before = m.players.find(p => p.playerId === actor)!;
    const drawn = result.zones.hand.slice(before.hand.length);
    const recycled = result.recycledCount ? result.zones.mainDeck : [];
    check(result.zones.hand.length === before.hand.length + result.drawnCount &&
      before.hand.every((card, index) => card.uid === result.zones.hand[index]?.uid &&
        card.cardId === result.zones.hand[index]?.cardId) &&
      drawn.every((card, index) => card.uid === before.remainingMainDeck[index]?.uid &&
        card.cardId === before.remainingMainDeck[index]?.cardId) &&
      result.zones.mainDeck.length === before.remainingMainDeck.length - result.drawnCount +
        result.recycledCount &&
      (result.recycledCount === 0
        ? before.remainingMainDeck.slice(result.drawnCount).every((card, index) =>
          card.uid === result.zones.mainDeck[index]?.uid && card.cardId === result.zones.mainDeck[index]?.cardId) &&
          before.trash.length === result.zones.trash.length &&
          before.trash.every((card, index) => card.uid === result.zones.trash[index]?.uid &&
            card.cardId === result.zones.trash[index]?.cardId)
        : before.remainingMainDeck.length === result.drawnCount &&
          before.trash.length === result.recycledCount && result.zones.trash.length === 0 &&
          new Set(before.trash.map(card => card.uid)).size === recycled.length &&
          recycled.every(card => before.trash.some(old => old.uid === card.uid && old.cardId === card.cardId))),
      'draw step transfer order/count mismatch');
    // The draw kernel performs main-deck draw BEFORE trash recycle. A recycled card can be
    // drawn by the *next* continuation step; preserve that physical order in the journal.
    const trace: DuelPhysicalZoneTransition[] = [
      ...drawn.map(card => ({ uid: card.uid, from: { kind: 'main-deck' as const, zonePlayerId: actor },
        to: { kind: 'hand' as const, zonePlayerId: actor } })),
      ...recycled.map(card => ({ uid: card.uid, from: { kind: 'trash' as const, zonePlayerId: actor },
        to: { kind: 'main-deck' as const, zonePlayerId: actor } })),
    ];
    return { match: { ...m, scoring: result.scoring, players: m.players.map(p => p.playerId === actor
      ? { ...p, hand: result.zones.hand, remainingMainDeck: result.zones.mainDeck, trash: result.zones.trash }
      : p) as unknown as DuelCanonicalPlayingStateV2['players'] }, transitions: trace };
  });
  if (result.status === 'winner') return ended(next, c, services);
  if (result.cursor) return { session: next, cursor: {
    ...(c.step === 'draw' ? { ...c, consumedIDs: [...c.consumedIDs, task(c)] } : c),
    step: result.cursor.step === 'awaiting-first-resolution' ? 'burnout-first' : 'burnout-intervention',
    pendingTaskID: null, drawCursor: result.cursor,
    ...(c.step === 'burnout-intervention' ? { consumedIDs: [...c.consumedIDs, task(c)] } : {}) } };
  return { session: next, cursor: finish(c, 'draw-effects', { drawCursor: null }) };
}
function startDrive(original: DuelCommandSessionV2, services: DuelTurnServicesV2): DuelTurnResultV2 {
  let s = original, c = valid(s, 'start');
  for (let loop = 0; loop < 32; loop++) {
    try {
      if (!observe(s, c, services)) return wait(s, c);
      if (c.step === 'main' || c.step === 'ended') return reply(store(s, c), c.step, s !== original);
      const coverage = cover(s, c, services);
      if (!coverage.ready) {
        s = coverage.session;
        if (match(s).frame.pendingPayment !== null || s.requiredTasks.some(item =>
            item.status === 'issued' || item.status === 'active') ||
            s.priorityPayments.some(item => item.status === 'active')) return wait(s, c);
        c = valid(s, 'start');
        return wait(s, c);
      }
      s = coverage.session;
      if (coverage.handled) {
        c = { ...c, handlerSettledIDs: [...c.handlerSettledIDs, ...coverage.handledKeys] };
        s = store(s, c);
        // Re-inspect the same boundary before advancing its intrinsic step: a concrete handler
        // result may have introduced a newly qualified identity for this fixed point.
        continue;
      }
      let m = match(s);
      if (c.step === 'awaken') {
        // The first Awaken must atomically establish BOTH Legend states and the phase;
        // Core V2 forbids intermediate non-awakening Legend objects outside setup.
        s = move(s, draft => {
          const actor = draft.frame.turnPlayerId;
          const units = draft.board.units.filter(u => u.controllerPlayerId === actor &&
            !draft.unitMeta[u.objectId]!.readied).map(u => u.objectId);
          const ready = units.length ? readyDuelUnits(draft, units).state : draft;
          const resources = { ...ready.resources, bases: ready.resources.bases.map(base => ({ ...base,
            baseRunes: base.baseRunes.map(r => r.controllerPlayerId === actor ? { ...r, readied: true } : r),
            goldTokens: base.goldTokens.map(g => g.controllerPlayerId === actor ? { ...g, readied: true } : g),
          })) as unknown as typeof draft.resources.bases };
          const legends = Object.fromEntries(Object.entries(draft.legendStates).map(([uid, value]) =>
            [uid, value.readiness === 'not-established' || value.controllerPlayerId === actor
              ? { ...value, readiness: 'ready' as const } : value]));
          const gears = ready.gears.map(g => g.controllerPlayerId === actor ? { ...g, readied: true } : g);
          return { match: { ...ready, resources, legendStates: legends, gears,
            scoring: beginDuelScoreTurn(ready.scoring, ready.board, ready.frame.turnNumber),
            frame: { ...ready.frame, phase: 'awaken', stateOpen: true, priorityPlayerId: null,
              focusPlayerId: null, pendingPayment: null } }, transitions: [] };
        });
        c = finish(c, 'begin');
      } else if (c.step === 'begin') {
        s = frame(s, 'beginning');
        c = finish(c, 'hold');
      } else if (c.step === 'hold') {
        if (m.frame.phase === 'beginning') s = frame(s, 'scoring');
        m = match(s);
        if (c.holdIndex < m.board.battlefields.length) {
          const field = m.board.battlefields[c.holdIndex]!;
          if (field.controllerPlayerId === m.frame.turnPlayerId &&
              !m.scoring.players.find(p => p.playerId === m.frame.turnPlayerId)!
                .scoredBattlefieldLocationIds.includes(field.locationId)) {
            s = move(s, draft => ({ match: { ...draft, scoring: scoreDuelBattlefield(
              draft.scoring, draft.board, draft.frame.turnPlayerId, field.locationId, 'hold',
              { phase: 'beginning-scoring', turnPlayerId: draft.frame.turnPlayerId,
                controlEstablishedForPlayerId: null, controlEstablishedLocationId: null }).state }, transitions: [] }));
          }
          c = finish(c, 'hold-effects');
          if (won(s)) return ended(s, c, services);
        } else c = finish(c, 'channel');
      } else if (c.step === 'hold-effects') {
        c = finish(c, 'hold', { holdIndex: c.holdIndex + 1 });
        if (won(s)) return ended(s, c, services);
      } else if (c.step === 'channel') {
        const second = m.turnOrder[1];
        const first = m.frame.turnPlayerId === second && !c.firstChannelProcessedPlayerIDs.includes(second);
        s = move(s, draft => {
          const actor = draft.frame.turnPlayerId, count = first ? 3 : 2;
          const before = draft.resources.players.find(p => p.playerId === actor)!;
          const taken = before.runeDeck.slice(0, count);
          const resources = channelDuelRunes(draft.resources, actor, count);
          const base = resources.bases.find(b => b.playerId === actor)!;
          return { match: { ...draft, resources,
            frame: { ...draft.frame, phase: 'channel', stateOpen: false } },
            transitions: taken.map(r => ({ uid: r.uid,
              from: { kind: 'rune-deck' as const, zonePlayerId: actor },
              to: { kind: 'board-base' as const, locationId: base.locationId } })) };
        });
        c = finish(c, 'channel-effects', { firstChannelProcessedPlayerIDs: first
          ? [...c.firstChannelProcessedPlayerIDs, second] : c.firstChannelProcessedPlayerIDs });
      } else if (c.step === 'channel-effects') {
        if (won(s)) return ended(s, c, services);
        c = finish(c, 'draw');
      } else if (c.step === 'draw') {
        s = frame(s, 'draw', false);
        m = match(s);
        const player = m.players.find(p => p.playerId === m.frame.turnPlayerId)!;
        const result = startDuelDraw({ hand: player.hand, mainDeck: player.remainingMainDeck, trash: player.trash },
          m.board, m.scoring, m.frame.turnPlayerId, 1, services.randomIndex);
        const progress = drawResult(s, c, result, services);
        if ('status' in progress) return progress;
        ({ session: s, cursor: c } = progress);
      } else if (c.step === 'burnout-first') {
        if (!services.firstBurnout) return wait(s, c);
        const resolution = services.firstBurnout(m, task(c));
        if (resolution?.status !== 'scored' && resolution?.status !== 'prevented') return wait(s, c);
        if (resolution.status === 'scored') s = move(s, draft => ({ match: { ...draft,
          scoring: gainDuelPoints(draft.scoring, draft.board,
            draft.turnOrder.find(p => p !== draft.frame.turnPlayerId)!, 1).state }, transitions: [] }));
        m = match(s);
        const player = m.players.find(p => p.playerId === m.frame.turnPlayerId)!;
        const result = resumeDuelDraw({ hand: player.hand, mainDeck: player.remainingMainDeck, trash: player.trash },
          m.board, m.scoring, c.drawCursor, { firstBurnoutResolution: {
            kind: resolution.status, scoring: m.scoring } });
        const done = finish(c, 'burnout-intervention', { drawCursor: result.cursor });
        if (won(s)) return ended(s, done, services);
        c = done;
      } else if (c.step === 'burnout-intervention') {
        if (c.drawCursor?.step !== 'awaiting-intervention' ||
            services.burnoutIntervention?.(match(s), task(c))?.status !== 'settled') return wait(s, c);
        if (won(s)) return ended(s, c, services);
        m = match(s);
        const player = m.players.find(p => p.playerId === m.frame.turnPlayerId)!;
        const result = resumeDuelDraw({ hand: player.hand, mainDeck: player.remainingMainDeck, trash: player.trash },
          m.board, m.scoring, c.drawCursor, { interventionComplete: true }, services.randomIndex);
        // A Burnout intervention may cause another physical draw, but the original Draw
        // phase task is already consumed. Keep its identity and settle the new transfer.
        const progress = drawResult(s, c, result, services);
        if ('status' in progress) return progress;
        ({ session: s, cursor: c } = progress);
      } else if (c.step === 'draw-effects') {
        if (won(s)) return ended(s, c, services);
        s = move(s, draft => ({ match: { ...draft, resources: clearAllDuelRunePools(draft.resources),
          frame: { ...draft.frame, phase: 'main', stateOpen: false,
            priorityPlayerId: null, focusPlayerId: null } }, transitions: [] }));
        c = finish(c, 'main-effects');
      } else if (c.step === 'main-effects') {
        if (won(s)) return ended(s, c, services);
        s = move(s, draft => ({ match: { ...draft, frame: { ...draft.frame,
          phase: 'main', stateOpen: true, priorityPlayerId: draft.frame.turnPlayerId,
          focusPlayerId: null } }, transitions: [] }));
        c = finish(c, 'main');
      }
      if (c.step === 'main' && won(s)) return ended(s, c, services);
      s = store(s, c);
    } catch { return reject(original, 'invalid-resolution-or-transaction'); }
  }
  return reject(original, 'step-limit');
}
/** Start from a constructor/mulligan-admitted V2 session, not a fabricated Main frame. */
export function runDuelStartOfTurnV2(session: DuelCommandSessionV2,
  services: DuelTurnServicesV2): DuelTurnResultV2 {
  try {
    if (reenteredNativeBoundary(session)) return reply(session, 'pending', false);
    clean(session);
    const m = match(session), previous = session.turnCursorV2;
    if (m.frame.phase === 'awaiting-turn-start') {
      check(!previous || cursorBonds.get(session) === previous, 'unbound previous turn');
      check(previous?.pendingTaskID === null || previous === undefined, 'pending task requires exact resume');
      check(m.frame.turnNumber >= 1 && m.frame.priorityPlayerId === null &&
        m.frame.turnPlayerId === m.turnOrder[(m.frame.turnNumber - 1) % 2] &&
        (!previous || (previous.step === 'awaiting-turn-start' && previous.turn === m.frame.turnNumber &&
          previous.stateVersion === m.stateVersion && previous.eventSeq === m.eventSeq)), 'untrusted turn handoff');
      const freshSession = store(session, fresh(m, 'awaken', previous?.firstChannelProcessedPlayerIDs ?? []));
      return startDrive(freshSession, services);
    }
    const cursor = valid(session, 'start');
    check(cursor.pendingTaskID === null, 'pending task requires exact resume');
    return startDrive(session, services);
  } catch { return reject(session, 'invalid-session-or-cost-window'); }
}
/** Only retry the exact outstanding bound task; no bare no-effect resolution is accepted. */
export function resumeDuelStartOfTurnV2(session: DuelCommandSessionV2, taskId: string,
  resolution: unknown, services: DuelTurnServicesV2): DuelTurnResultV2 {
  try {
    if (reenteredNativeBoundary(session)) return reply(session, 'pending', false);
    clean(session);
    session = alignClosedPaymentCursor(session);
    const c = valid(session, 'start');
    if (c.consumedIDs.includes(taskId)) return reply(session, 'duplicate', false);
    check(c.pendingTaskID === taskId && taskId === task(c) && same(resolution,
      { status: 'retry', matchId: c.matchId, turn: c.turn, taskId }), 'wrong or stale task');
    return startDrive(session, services);
  } catch { return reject(session, 'wrong-task-or-session'); }
}
function endDrive(original: DuelCommandSessionV2, services: DuelTurnServicesV2): DuelTurnResultV2 {
  let s = original, c = valid(s, 'end');
  for (let loop = 0; loop < 512; loop++) {
    try {
      if (!observe(s, c, services)) return wait(s, c);
      if (c.step === 'awaiting-turn-start' || c.step === 'ended') return reply(s, c.step, s !== original);
      const coverage = cover(s, c, services);
      if (!coverage.ready) {
        s = coverage.session;
        if (match(s).frame.pendingPayment !== null || s.requiredTasks.some(item =>
            item.status === 'issued' || item.status === 'active') ||
            s.priorityPayments.some(item => item.status === 'active')) return wait(s, c);
        c = valid(s, 'end');
        return wait(s, c);
      }
      s = coverage.session;
      if (coverage.handled) {
        c = { ...c, handlerSettledIDs: [...c.handlerSettledIDs, ...coverage.handledKeys] };
        s = store(s, c);
        // Re-inspect the same boundary before advancing its intrinsic step: a concrete handler
        // result may have introduced a newly qualified identity for this fixed point.
        continue;
      }
      let m = match(s);
      if (c.step === 'ending') {
        s = frame(s, 'ending'); c = finish(c, 'special-designations');
      } else if (c.step.endsWith('-designations')) {
        if (won(s)) return ended(s, c, services);
        if (m.board.battlefields.some(f => f.combat !== 'none' || f.showdown !== 'none')) return wait(s, c);
        if (m.frame.phase === 'ending') s = frame(s, 'expiration');
        c = finish(c, c.step === 'special-designations' ? 'special-lethal' : 'ordinary-lethal');
      } else if (c.step.endsWith('-lethal')) {
        if (m.board.units.length && !services.lethalEvaluators) return wait(s, c);
        const lethal = m.board.units.length ? queryLethalDuelUnitCandidates(m, {
          currentMight: u => services.lethalEvaluators!.currentMight(structuredClone(u)),
          lethalDamageThreshold: (u, might) => services.lethalEvaluators!.lethalDamageThreshold(structuredClone(u), might),
        }) : [];
        if (lethal.length) {
          // Core V2 has no token retirement nor attached Gear pre-exit journal. Fail closed.
          if (lethal.some(u => m.unitMeta[u.objectId]?.trait.kind === 'token' ||
              m.gears.some(g => g.attachedToUID === u.objectId))) return wait(s, c);
          const plan = planDuelUnitKills(m, lethal.map(u => u.objectId), 'passive');
          const answer = services.approveLethal?.(structuredClone(plan), m);
          if (answer?.status !== 'approved' || !Array.isArray(answer.approvedUnitUIDs) ||
              new Set(answer.approvedUnitUIDs).size !== answer.approvedUnitUIDs.length ||
              !answer.approvedUnitUIDs.every(uid => lethal.some(u => u.objectId === uid))) return wait(s, c);
          s = move(s, draft => {
            const approved = commitApprovedDuelUnitKills(draft,
              { plan, approvedUnitUIDs: answer.approvedUnitUIDs }).state;
            const transitions: DuelPhysicalZoneTransition[] = answer.approvedUnitUIDs.map(uid => {
              const u = m.board.units.find(unit => unit.objectId === uid)!;
              const from = m.board.bases.some(base => base.locationId === u.locationId)
                ? { kind: 'board-base' as const, locationId: u.locationId }
                : { kind: 'board-battlefield' as const, locationId: u.locationId };
              return { uid, from, to: { kind: 'trash' as const, zonePlayerId: m.unitMeta[uid]!.ownerPlayerId } };
            });
            return { match: approved, transitions };
          });
        }
        if (c.step === 'special-lethal') {
          s = move(s, draft => {
            const damaged = draft.board.units.filter(u => draft.unitMeta[u.objectId]!.damageMarks.length)
              .map(u => u.objectId);
            return { match: damaged.length ? healAllDuelUnitDamage(draft, damaged).state : draft,
              transitions: [] };
          });
        }
        c = finish(c, c.step === 'special-lethal' ? 'special-expiration' : 'ordinary-remaining',
          { cleanupChanged: c.cleanupChanged || s !== original && lethal.length > 0 });
      } else if (c.step === 'special-expiration') {
        // Absence of a phase handler is not evidence that registered temporary effects
        // have expired; source coverage must explicitly attest their simultaneous scope.
        s = move(s, draft => ({ match: { ...draft, resources: clearAllDuelRunePools(draft.resources) },
          transitions: [] }));
        c = finish(c, 'special-remaining', { cleanupChanged: c.cleanupChanged ||
          match(s).resources !== m.resources && m.resources.players.some(p =>
            p.runePool.energy !== 0 || Object.values(p.runePool.power).some(v => v !== 0)) });
      } else if (c.step.endsWith('-remaining')) {
        // CR 323.6/8/9/11: real Open board cleanup; staged combat/showdown needs a
        // full choice/engagement executor and cannot silently disappear.
        if (m.gears.length || m.board.battlefields.some(f => f.combat !== 'none' ||
          f.showdown !== 'none')) return wait(s, c);
        const cleaned = applyOpenDuelCleanup(m.board);
        if (cleaned.battlefields.some(f => f.combat !== 'none' || f.showdown !== 'none')) return wait(s, c);
        const changed = !same(cleaned, m.board);
        if (changed) s = move(s, draft => ({ match: { ...draft, board: cleaned }, transitions: [] }));
        c = finish(c, c.step === 'special-remaining' ? 'special-fepr' : 'ordinary-fepr',
          { cleanupChanged: c.cleanupChanged || changed });
      } else if (c.step.endsWith('-fepr')) {
        // FEPR is queried even after a cleanup mutation: a changed cleanup state cannot
        // certify the absence of newly outstanding items. Ordinary cleanup is still run.
        const answer = services.fepr?.(m, task(c));
        if (answer?.status === 'processed') {
          check(answer.match !== m && answer.match.frame.phase === m.frame.phase &&
            answer.match.frame.turnNumber === m.frame.turnNumber &&
            answer.match.stateVersion === m.stateVersion && answer.match.eventSeq === m.eventSeq,
          'FEPR may not change phase, turn or inner clocks');
          s = move(s, () => ({ match: answer.match, transitions: answer.transitions }));
          check(s !== coverage.session, 'FEPR processed without a concrete mutation');
          c = finish(c, 'ordinary-designations', { cleanupRound: c.cleanupRound + 1,
            cleanupChanged: false, feprProcessed: true });
        } else if (answer?.status !== 'none') return wait(s, c);
        else if (c.step === 'special-fepr' || c.cleanupChanged) {
          c = finish(c, 'ordinary-designations', { cleanupRound: c.cleanupRound + 1,
            cleanupChanged: false });
        } else if (c.feprProcessed) {
          c = finish(c, 'special-designations', { expirationIteration: c.expirationIteration + 1,
            cleanupRound: 0, feprProcessed: false });
        } else {
          check(m.frame.turnNumber < Number.MAX_SAFE_INTEGER, 'turn overflow');
          s = move(s, draft => ({ match: { ...draft, frame: { ...draft.frame,
            phase: 'awaiting-turn-start', turnNumber: draft.frame.turnNumber + 1,
            turnPlayerId: draft.turnOrder[draft.frame.turnNumber % 2]!, priorityPlayerId: null,
            focusPlayerId: null, stateOpen: true, pendingPayment: null } }, transitions: [] }));
          const after = match(s);
          const next = fresh(after, 'awaiting-turn-start', c.firstChannelProcessedPlayerIDs);
          if (!observe(s, next, services)) return wait(s, next);
          return reply(store(s, next), 'awaiting-turn-start', true);
        }
      }
      s = store(s, c);
    } catch { return reject(original, 'invalid-resolution-or-transaction'); }
  }
  return reject(original, 'step-limit');
}
export function runDuelEndOfTurnV2(session: DuelCommandSessionV2, actor: string,
  services: DuelTurnServicesV2): DuelTurnResultV2 {
  try {
    clean(session);
    const m = match(session), c = valid(session, 'start');
    check(c.pendingTaskID === null && c.step === 'main' && m.frame.phase === 'main' && m.frame.stateOpen &&
      m.frame.turnPlayerId === actor && m.frame.priorityPlayerId === actor &&
      m.frame.focusPlayerId === null && m.scoring.turnNumber === m.frame.turnNumber &&
      m.board.battlefields.every(f => f.combat === 'none' && f.showdown === 'none'), 'not completed neutral Main');
    const next = store(session, { ...c, step: 'ending', pendingTaskID: null,
      consumedIDs: [], expirationIteration: 0, cleanupRound: 0, cleanupChanged: false, feprProcessed: false });
    return endDrive(next, services);
  } catch { return reject(session, 'invalid-main-or-cost-window'); }
}
export function resumeDuelEndOfTurnV2(session: DuelCommandSessionV2, taskId: string,
  resolution: unknown, services: DuelTurnServicesV2): DuelTurnResultV2 {
  try {
    clean(session);
    const c = valid(session, 'end');
    if (c.consumedIDs.includes(taskId)) return reply(session, 'duplicate', false);
    check(c.pendingTaskID === taskId && taskId === task(c) && same(resolution,
      { status: 'retry', matchId: c.matchId, turn: c.turn, taskId }), 'wrong or stale task');
    return endDrive(session, services);
  } catch { return reject(session, 'wrong-task-or-session'); }
}

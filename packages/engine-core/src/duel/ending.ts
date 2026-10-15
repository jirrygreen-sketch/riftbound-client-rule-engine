// CR v1.4 316.9, 317, 318–324, 333–335. INTERNAL trusted Ending executor.
// The canonical match alone owns game state. This private sidecar records only task identities,
// iteration counters and the clock at which a pending task was issued; it is not a wire/archive API.
import { commitDuelPlayingMutation, detachedDuelPlaying } from './canonical-transaction.js';
import type { DuelCanonicalPlayingState } from './canonical-session.js';
import type { DuelTurnFlowSession } from './turn-flow.js';
import { clearAllDuelRunePools } from './resources.js';
import { getDuelWinnerAtCleanup } from './scoring.js';
import {
  healAllDuelUnitDamage, queryLethalDuelUnitCandidates, planDuelUnitKills,
  commitApprovedDuelUnitKills, type DuelKillPlan, type PublicDuelUnitObject,
} from './unit-lifecycle.js';

export type DuelEndingTaskKind = 'ending-effects' | 'required-cleanup' | 'lethal-kill' |
  'simultaneous-this-turn-expiration' | 'remaining-cleanup' | 'fepr';
type Step = 'ending-effects' | 'special-designations' | 'special-lethal' | 'special-expiration' |
  'special-remaining' | 'special-fepr' | 'ordinary-designations' | 'ordinary-lethal' |
  'ordinary-remaining' | 'ordinary-fepr' | 'awaiting-turn-start' | 'ended';
const STEPS: readonly Step[] = ['ending-effects', 'special-designations', 'special-lethal',
  'special-expiration', 'special-remaining', 'special-fepr', 'ordinary-designations',
  'ordinary-lethal', 'ordinary-remaining', 'ordinary-fepr', 'awaiting-turn-start', 'ended'];
const CURSOR_FIELDS = ['kind', 'turn', 'rootTaskID', 'step', 'expirationIteration', 'cleanupRound',
  'cleanupChanged', 'feprProcessed', 'pendingTaskID', 'consumedIDs', 'stateVersion', 'eventSeq'];
const PRIOR_FIELDS = ['turn', 'consumedIDs'];
/** Scalar-only histories of completed Endings; no previous match, frame, zones or cursor snapshots. */
interface CompletedEndingTurn {
  readonly turn: number;
  readonly consumedIDs: readonly string[];
}
const FLOW_FIELDS = ['kind', 'turn', 'rootTaskID', 'step', 'holdIndex', 'pendingTaskID',
  'consumedIDs', 'firstChannelProcessedPlayerIDs', 'drawCursor'];

export interface DuelEndingCursor {
  readonly kind: 'ending';
  readonly turn: number;
  readonly rootTaskID: string;
  readonly step: Step;
  readonly expirationIteration: number;
  readonly cleanupRound: number;
  /** Actual game mutations within this cleanup require an ordinary cleanup (322, 324.2). */
  readonly cleanupChanged: boolean;
  /** FEPR actually processed an item in this Expiration iteration (317.2.f). */
  readonly feprProcessed: boolean;
  readonly pendingTaskID: string | null;
  readonly consumedIDs: readonly string[];
  readonly stateVersion: number;
  readonly eventSeq: number;
}
export type DuelEndingSession = DuelTurnFlowSession & {
  readonly endingProgress?: DuelEndingCursor;
  /** Private scalar-only exactly-once ledger for replaced, fully completed Ending cursors. */
  readonly priorEndingTurns?: readonly CompletedEndingTurn[];
};
export interface DuelEndingContext {
  /** Fully validated detached playing aggregate, never the session or a public projection. */
  readonly match: DuelCanonicalPlayingState;
  readonly turnPlayerId: string;
  readonly turnNumber: number;
  readonly taskId: string;
  readonly kind: DuelEndingTaskKind;
  readonly expirationIteration: number;
  readonly cleanupRound: number;
  readonly cleanupKind: 'special' | 'ordinary' | null;
}
export type DuelEndingHookResolution =
  | { readonly status: 'verified-no-effect' }
  | { readonly status: 'applied'; readonly match: DuelCanonicalPlayingState };
export type DuelEndingProviderResult = { readonly status: 'pending' } | DuelEndingHookResolution;
export interface DuelLethalEvaluators {
  /** Trusted derived current Might, accounting for all buffs/replacements, not printed base Might. */
  readonly currentMight: (unit: PublicDuelUnitObject) => number;
  readonly lethalDamageThreshold: (unit: PublicDuelUnitObject, currentMight: number) => number;
}
export interface DuelLethalKillContext extends DuelEndingContext {
  /** CR 323.3a PRE-kill snapshots; provider registers Deathknell/other pending items first.
   * Its approval must incorporate Kill replacements before the kernel performs 323.3b. */
  readonly plan: DuelKillPlan;
}
export type DuelLethalKillResult = { readonly status: 'pending' } |
  { readonly status: 'approved'; readonly approvedUnitUIDs: readonly string[] };
export type DuelFEPRResult = { readonly status: 'pending' } |
  { readonly status: 'verified-no-effect' } |
  /** Actual changed aggregate proves an item underwent FEPR. Replay the Expiration step (317.2.f). */
  { readonly status: 'processed'; readonly match: DuelCanonicalPlayingState };
export interface DuelEndingServices {
  readonly endingEffects?: (context: DuelEndingContext) => DuelEndingProviderResult;
  /** CR 323.2; victory (323.1) and lethal 323.3a/b are handled separately in strict order. */
  readonly requiredCleanup?: (context: DuelEndingContext) => DuelEndingProviderResult;
  readonly lethalEvaluators?: DuelLethalEvaluators;
  readonly lethalKillApproval?: (context: DuelLethalKillContext) => DuelLethalKillResult;
  /** A single trusted operation expires ALL this-turn effects simultaneously, after healing. */
  readonly simultaneousThisTurnExpiration?: (context: DuelEndingContext) => DuelEndingProviderResult;
  /** CR 323.6–323.14, including staged engagements and further outstanding tasks. */
  readonly remainingCleanup?: (context: DuelEndingContext) => DuelEndingProviderResult;
  /** Must resolve real outstanding items; absent FEPR service is never interpreted as no items. */
  readonly fepr?: (context: DuelEndingContext) => DuelFEPRResult;
}
export interface DuelEndingPending {
  readonly taskId: string;
  readonly kind: DuelEndingTaskKind;
  readonly turn: number;
  readonly expirationIteration: number;
  readonly cleanupRound: number;
}
export interface DuelEndingResult {
  readonly session: DuelEndingSession;
  readonly status: 'pending' | 'awaiting-turn-start' | 'ended' | 'duplicate' | 'rejected';
  readonly persistRequired: boolean;
  readonly pending?: DuelEndingPending;
  readonly reason?: string;
}
function plain(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && fields.every(key => keys.includes(key)) &&
    keys.every(key => typeof key === 'string' && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
}
function id(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function ids(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(i));
    if (!entry || !('value' in entry) || !id(entry.value)) return false;
  }
  return new Set(value).size === value.length;
}
function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function playing(session: DuelEndingSession): DuelCanonicalPlayingState | undefined {
  return session.match.stage === 'playing' ? session.match : undefined;
}
function root(match: DuelCanonicalPlayingState): string {
  return `duel-ending:${match.matchId}:turn-${match.frame.turnNumber}`;
}
function rootFor(matchId: string, turn: number): string {
  return `duel-ending:${matchId}:turn-${turn}`;
}
function validCompletedHistory(matchId: string, turn: number, raw: unknown): raw is readonly string[] {
  if (!ids(raw) || raw.length < 6 || raw.length > 512) return false;
  const rootID = rootFor(matchId, turn);
  if (raw[0] !== `${rootID}:expiration-0:cleanup-0:ending-effects`) return false;
  let iteration = 0, round = 0, step: Step = 'special-designations';
  for (let index = 1; index < raw.length; index++) {
    const value = raw[index]!;
    if (value !== `${rootID}:expiration-${iteration}:cleanup-${round}:${step}`) return false;
    const next = raw[index + 1];
    if (step === 'special-designations') step = 'special-lethal';
    else if (step === 'special-lethal') step = 'special-expiration';
    else if (step === 'special-expiration') step = 'special-remaining';
    else if (step === 'ordinary-designations') step = 'ordinary-lethal';
    else if (step === 'ordinary-lethal') step = 'ordinary-remaining';
    else if (step === 'special-remaining' || step === 'ordinary-remaining' ||
        step === 'special-fepr' || step === 'ordinary-fepr') {
      const wasFEPR = step.endsWith('-fepr');
      const newRound = `${rootID}:expiration-${iteration}:cleanup-${round + 1}:ordinary-designations`;
      const newIteration = `${rootID}:expiration-${iteration + 1}:cleanup-0:special-designations`;
      if (wasFEPR && index === raw.length - 1) return true;
      if (next === newRound && round < 64) { round++; step = 'ordinary-designations'; }
      else if (wasFEPR && next === newIteration && iteration < 64) {
        iteration++; round = 0; step = 'special-designations';
      } else if (!wasFEPR && next === `${rootID}:expiration-${iteration}:cleanup-${round}:${round === 0 ? 'special-fepr' : 'ordinary-fepr'}`) {
        step = round === 0 ? 'special-fepr' : 'ordinary-fepr';
      } else return false;
    } else return false;
  }
  return false;
}
function parsedPrior(session: DuelEndingSession, cursorTurn: number): readonly CompletedEndingTurn[] | null {
  const history = ownData(session, 'priorEndingTurns');
  if (history === undefined && !Object.hasOwn(session, 'priorEndingTurns'))
    return cursorTurn === 1 ? [] : null;
  if (!Array.isArray(history) || Object.getPrototypeOf(history) !== Array.prototype ||
      Reflect.ownKeys(history).length !== history.length + 1 || !Number.isSafeInteger(cursorTurn) ||
      history.length !== cursorTurn - 1) return null;
  for (let index = 0; index < history.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(history, String(index));
    if (!descriptor || !('value' in descriptor)) return null;
    const entry = descriptor.value;
    if (!plain(entry, PRIOR_FIELDS) || !count(entry.turn) || entry.turn < 1 ||
        entry.turn !== cursorTurn - history.length + index ||
        !validCompletedHistory(session.match.matchId, entry.turn, entry.consumedIDs)) return null;
  }
  return history as readonly CompletedEndingTurn[];
}
function cleanupKind(step: Step): 'special' | 'ordinary' | null {
  return step.startsWith('special-') ? 'special' : step.startsWith('ordinary-') ? 'ordinary' : null;
}
function kind(step: Step): DuelEndingTaskKind | null {
  if (step === 'ending-effects') return 'ending-effects';
  if (step.endsWith('-designations')) return 'required-cleanup';
  if (step.endsWith('-lethal')) return 'lethal-kill';
  if (step === 'special-expiration') return 'simultaneous-this-turn-expiration';
  if (step.endsWith('-remaining')) return 'remaining-cleanup';
  if (step.endsWith('-fepr')) return 'fepr';
  return null;
}
function task(cursor: DuelEndingCursor): string {
  return `${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-${cursor.cleanupRound}:${cursor.step}`;
}
function pending(cursor: DuelEndingCursor): DuelEndingPending {
  return { taskId: task(cursor), kind: kind(cursor.step)!, turn: cursor.turn,
    expirationIteration: cursor.expirationIteration, cleanupRound: cursor.cleanupRound };
}
function response(session: DuelEndingSession, status: DuelEndingResult['status'],
  persistRequired: boolean, reason?: string): DuelEndingResult {
  const cursor = session.endingProgress;
  return { session, status, persistRequired, ...(reason ? { reason } : {}),
    ...(status === 'pending' && cursor ? { pending: pending(cursor) } : {}) };
}
function reject(session: DuelEndingSession, reason: string): DuelEndingResult {
  return response(session, 'rejected', false, reason);
}
function withCursor(session: DuelEndingSession, cursor: DuelEndingCursor): DuelEndingSession {
  return { ...session, endingProgress: cursor };
}
function sync(session: DuelEndingSession, cursor: DuelEndingCursor): DuelEndingCursor {
  const match = playing(session)!;
  return { ...cursor, stateVersion: match.stateVersion, eventSeq: match.eventSeq };
}
function commit(session: DuelEndingSession,
  mutate: (draft: DuelCanonicalPlayingState) => DuelCanonicalPlayingState): DuelEndingSession {
  const before = playing(session)!;
  const after = commitDuelPlayingMutation(before, mutate);
  return after === before ? session : { ...session, match: after };
}
function transition(session: DuelEndingSession, phase: 'ending' | 'expiration' | 'ended' | 'awaiting-turn-start'):
  DuelEndingSession {
  return commit(session, match => ({ ...match, frame: { ...match.frame, phase,
    priorityPlayerId: null, focusPlayerId: null, stateOpen: true, pendingPayment: null,
    ...(phase === 'awaiting-turn-start' ? { turnNumber: match.frame.turnNumber + 1,
      turnPlayerId: match.turnOrder[(match.turnOrder.indexOf(match.frame.turnPlayerId) + 1) % 2]! } : {}) } }));
}
function expectedPhase(step: Step): string {
  return step === 'ending-effects' ? 'ending' :
    step === 'awaiting-turn-start' ? 'awaiting-turn-start' : step === 'ended' ? 'ended' : 'expiration';
}
function parsedCursor(session: DuelEndingSession): DuelEndingCursor | null {
  const match = playing(session), raw = ownData(session, 'endingProgress');
  if (!match || !plain(raw, CURSOR_FIELDS) || raw.kind !== 'ending' || !count(raw.turn) || raw.turn < 1 ||
      !id(raw.rootTaskID) || !STEPS.includes(raw.step as Step) ||
      !count(raw.expirationIteration) || !count(raw.cleanupRound) ||
      typeof raw.cleanupChanged !== 'boolean' || typeof raw.feprProcessed !== 'boolean' ||
      (raw.pendingTaskID !== null && !id(raw.pendingTaskID)) ||
      !ids(raw.consumedIDs) || !count(raw.stateVersion) || !count(raw.eventSeq)) return null;
  const cursor = raw as unknown as DuelEndingCursor;
  if (parsedPrior(session, cursor.turn) === null) return null;
  if (cursor.rootTaskID !== rootFor(match.matchId, cursor.turn) ||
      cursor.consumedIDs.length > 512 || cursor.expirationIteration > 64 || cursor.cleanupRound > 64 ||
      (cursor.cleanupRound > 0 && !cursor.consumedIDs.includes(`${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-0:special-remaining`)) ||
      cursor.consumedIDs.some(value => !value.startsWith(`${cursor.rootTaskID}:expiration-`) ||
        !/^expiration-(0|[1-9]\d*):cleanup-(0|[1-9]\d*):(ending-effects|special-designations|special-lethal|special-expiration|special-remaining|special-fepr|ordinary-designations|ordinary-lethal|ordinary-remaining|ordinary-fepr)$/.test(value.slice(cursor.rootTaskID.length + 1)))) return null;
  const terminal = cursor.step === 'awaiting-turn-start' || cursor.step === 'ended';
  if (cursor.step === 'awaiting-turn-start' && (
      !validCompletedHistory(match.matchId, cursor.turn, cursor.consumedIDs) ||
      !cursor.consumedIDs.at(-1)?.startsWith(
        `${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-${cursor.cleanupRound}:`))) return null;
  if (cursor.pendingTaskID !== null && (terminal || cursor.pendingTaskID !== task(cursor) ||
      cursor.consumedIDs.includes(cursor.pendingTaskID))) return null;
  if (cursor.step === 'ending-effects' && (cursor.expirationIteration !== 0 || cursor.cleanupRound !== 0 ||
      cursor.consumedIDs.length !== 0)) return null;
  if (cleanupKind(cursor.step) === 'special' && cursor.cleanupRound !== 0) return null;
  if (cursor.step === 'ending-effects' && (cursor.feprProcessed || cursor.cleanupChanged)) return null;
  if (cursor.feprProcessed && !cursor.consumedIDs.some(value =>
      value.startsWith(`${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-`) &&
      (value.endsWith(':special-fepr') || value.endsWith(':ordinary-fepr')))) return null;
  if (cursor.step === 'special-designations' && cursor.expirationIteration === 0 &&
      cursor.consumedIDs.length !== 1) return null;
  if (cursor.step === 'special-designations' && cursor.expirationIteration > 0 &&
      (!cursor.consumedIDs.at(-1)?.startsWith(
        `${cursor.rootTaskID}:expiration-${cursor.expirationIteration - 1}:cleanup-`) ||
       (!cursor.consumedIDs.at(-1)?.endsWith(':special-fepr') &&
        !cursor.consumedIDs.at(-1)?.endsWith(':ordinary-fepr')))) return null;
  if (terminal && cursor.feprProcessed) return null;
  if (terminal && cursor.step === 'awaiting-turn-start' &&
      cursor.consumedIDs.at(-1) !== `${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-${cursor.cleanupRound}:${cursor.cleanupRound === 0 ? 'special-fepr' : 'ordinary-fepr'}`) return null;
  if (cursor.consumedIDs.length > 0 &&
      cursor.consumedIDs[0] !== `${cursor.rootTaskID}:expiration-0:cleanup-0:ending-effects`) return null;
  if (terminal && cursor.consumedIDs.length === 0) return null;
  if (cursor.step !== 'ending-effects' &&
      !cursor.consumedIDs.includes(`${cursor.rootTaskID}:expiration-0:cleanup-0:ending-effects`)) return null;
  const base = `${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-${cursor.cleanupRound}:`;
  const has = (step: Step) => cursor.consumedIDs.includes(`${base}${step}`);
  if (cursor.consumedIDs.includes(task(cursor)) && !terminal) return null;
  if (cursor.step === 'special-lethal' && !has('special-designations') ||
      cursor.step === 'special-expiration' && !has('special-lethal') ||
      cursor.step === 'special-remaining' && !has('special-expiration') ||
      cursor.step === 'special-fepr' && !has('special-remaining') ||
      cursor.step === 'ordinary-lethal' && !has('ordinary-designations') ||
      cursor.step === 'ordinary-remaining' && !has('ordinary-lethal') ||
      cursor.step === 'ordinary-fepr' && !has('ordinary-remaining')) return null;
  if (cleanupKind(cursor.step) === 'ordinary' && cursor.cleanupRound < 1) return null;
  if (!terminal && (cursor.turn !== match.frame.turnNumber ||
      expectedPhase(cursor.step) !== match.frame.phase ||
      cursor.stateVersion !== match.stateVersion || cursor.eventSeq !== match.eventSeq ||
      match.frame.priorityPlayerId !== null || match.frame.focusPlayerId !== null ||
      !match.frame.stateOpen || match.frame.pendingPayment !== null ||
      match.scoring.turnNumber !== match.frame.turnNumber ||
      match.board.battlefields.some(field => field.combat === 'active' || field.showdown === 'active'))) return null;
  if (terminal && (cursor.pendingTaskID !== null || cursor.cleanupChanged ||
      match.frame.turnNumber < cursor.turn ||
      (cursor.step === 'ended' && (match.frame.turnNumber !== cursor.turn || match.frame.phase !== 'ended' ||
        match.stateVersion !== cursor.stateVersion || match.eventSeq !== cursor.eventSeq)) ||
      (cursor.step === 'awaiting-turn-start' && (
        !Number.isSafeInteger(cursor.turn + 1) || match.frame.turnNumber !== cursor.turn + 1 ||
        match.frame.turnPlayerId !== match.turnOrder[cursor.turn % 2] ||
        match.stateVersion < cursor.stateVersion || match.eventSeq < cursor.eventSeq ||
        match.stateVersion - cursor.stateVersion !== match.eventSeq - cursor.eventSeq ||
        (match.frame.phase !== 'awaiting-turn-start' &&
         match.stateVersion === cursor.stateVersion) ||
        (match.frame.phase === 'awaiting-turn-start' &&
          (match.scoring.turnNumber !== cursor.turn ||
           match.stateVersion !== cursor.stateVersion || match.eventSeq !== cursor.eventSeq)) ||
        (match.frame.phase !== 'awaiting-turn-start' &&
          (match.frame.phase !== 'main' && match.frame.phase !== 'awaken' &&
           match.frame.phase !== 'beginning' && match.frame.phase !== 'scoring' &&
           match.frame.phase !== 'channel' && match.frame.phase !== 'draw' ||
           match.scoring.turnNumber !== match.frame.turnNumber)))))) return null;
  return cursor;
}
/** The 83 cursor must be genuinely completed in the current Main; do not accept a manually forged
 * phase or an outstanding prefix/flow task as permission to end a turn. */
function validMain(session: DuelEndingSession, actor: string): string | null {
  const match = playing(session);
  if (!match) return 'invalid-stage';
  const frame = match.frame, flow = session.turnFlow;
  if (!id(actor) || !match.turnOrder.includes(actor) || !Number.isSafeInteger(frame.turnNumber) ||
      frame.turnNumber < 1 || match.turnOrder.indexOf(frame.turnPlayerId) < 0) return 'invalid-session';
  if (frame.phase !== 'main' || frame.turnPlayerId !== actor || frame.priorityPlayerId !== actor ||
      frame.focusPlayerId !== null || frame.pendingPayment !== null || !frame.stateOpen ||
      match.scoring.turnNumber !== frame.turnNumber) return 'invalid-phase';
  if (!plain(flow, FLOW_FIELDS) || flow.kind !== 'turn-flow' || flow.step !== 'main' ||
      flow.turn !== frame.turnNumber || flow.rootTaskID !== `duel-turn-start:${match.matchId}:turn-${frame.turnNumber}` ||
      flow.pendingTaskID !== null || flow.drawCursor !== null || !count(flow.holdIndex) ||
      flow.holdIndex !== match.board.battlefields.length || !ids(flow.consumedIDs) ||
      !ids(flow.firstChannelProcessedPlayerIDs) ||
      !flow.firstChannelProcessedPlayerIDs.every(seat => seat === match.turnOrder[1]) ||
      (frame.turnPlayerId === match.turnOrder[1] &&
       !flow.firstChannelProcessedPlayerIDs.includes(match.turnOrder[1])) ||
      flow.consumedIDs.some(value => !value.startsWith(`${flow.rootTaskID}:flow:`) ||
        !/:(hold-effects:[01]|channel-effects|draw-effects|main-effects|burnout-first:1|burnout-intervention:[1-9]\d*)$/.test(value)) ||
      !['channel-effects', 'draw-effects', 'main-effects'].every(name =>
        flow.consumedIDs.includes(`${flow.rootTaskID}:flow:${name}`)) ||
      flow.consumedIDs.indexOf(`${flow.rootTaskID}:flow:channel-effects`) >=
        flow.consumedIDs.indexOf(`${flow.rootTaskID}:flow:draw-effects`) ||
      flow.consumedIDs.indexOf(`${flow.rootTaskID}:flow:draw-effects`) >=
        flow.consumedIDs.indexOf(`${flow.rootTaskID}:flow:main-effects`)) return 'invalid-session';
  const prefix = session.turnProgress, startRoot = `duel-turn-start:${match.matchId}:turn-${frame.turnNumber}`;
  if (frame.turnNumber > 1 && !prefix) return 'task-conflict';
  if (prefix && (prefix.kind !== 'start' || prefix.turn !== frame.turnNumber || prefix.step !== 'scoring' ||
      prefix.pendingTaskID !== null || prefix.rootTaskID !== startRoot ||
      !ids(prefix.consumedIDs) ||
      !['awaken:readiness', 'awaken:other-permanents', 'beginning:effects'].every((name, index) =>
        prefix.consumedIDs[index] === `${startRoot}:${name}`) || prefix.consumedIDs.length !== 3))
    return 'task-conflict';
  const required = ownData(session, 'requiredTasks');
  if (required !== undefined && (!Array.isArray(required) || required.some(entry =>
      ownData(entry, 'status') === 'active' || ownData(entry, 'status') === 'issued'))) return 'task-conflict';
  if (match.board.battlefields.some(field => field.combat !== 'none' || field.showdown !== 'none'))
    return 'engagement-in-progress';
  return null;
}
function context(session: DuelEndingSession, cursor: DuelEndingCursor): DuelEndingContext {
  const match = playing(session)!;
  return { match: detachedDuelPlaying(match), turnPlayerId: match.frame.turnPlayerId,
    turnNumber: cursor.turn, taskId: task(cursor), kind: kind(cursor.step)!,
    expirationIteration: cursor.expirationIteration, cleanupRound: cursor.cleanupRound,
    cleanupKind: cleanupKind(cursor.step) };
}
function isPending(raw: unknown): boolean { return plain(raw, ['status']) && raw.status === 'pending'; }
function hook(raw: unknown): raw is DuelEndingHookResolution {
  return (plain(raw, ['status']) && raw.status === 'verified-no-effect') ||
    (plain(raw, ['status', 'match']) && raw.status === 'applied');
}
function installed(session: DuelEndingSession, proposal: DuelCanonicalPlayingState): DuelEndingSession {
  const before = playing(session)!;
  const candidate = detachedDuelPlaying(proposal);
  if (candidate.frame.phase !== before.frame.phase ||
      candidate.frame.turnNumber !== before.frame.turnNumber ||
      candidate.frame.turnPlayerId !== before.frame.turnPlayerId ||
      candidate.frame.priorityPlayerId !== before.frame.priorityPlayerId ||
      candidate.frame.focusPlayerId !== before.frame.focusPlayerId ||
      candidate.frame.stateOpen !== before.frame.stateOpen ||
      candidate.frame.pendingPayment !== null ||
      candidate.scoring.turnNumber !== before.scoring.turnNumber ||
      candidate.stateVersion !== before.stateVersion || candidate.eventSeq !== before.eventSeq)
    throw new TypeError('Ending provider changed frame, scoring turn or clocks');
  const next = commit(session, () => candidate);
  if (next === session) throw new TypeError('Applied Ending provider did not change the aggregate');
  return next;
}
function consumed(cursor: DuelEndingCursor): DuelEndingCursor {
  if (cursor.consumedIDs.includes(task(cursor))) throw new TypeError('Task already consumed');
  return { ...cursor, pendingTaskID: null, consumedIDs: [...cursor.consumedIDs, task(cursor)] };
}
function advance(cursor: DuelEndingCursor, step: Step, options: Partial<DuelEndingCursor> = {}): DuelEndingCursor {
  return { ...cursor, ...options, step, pendingTaskID: null };
}
function wait(session: DuelEndingSession, cursor: DuelEndingCursor): DuelEndingResult {
  return response(withCursor(session, { ...sync(session, cursor), pendingTaskID: task(cursor) }), 'pending', true);
}
function service(services: DuelEndingServices, step: Step):
  ((context: DuelEndingContext) => unknown) | undefined {
  if (step === 'ending-effects') return services.endingEffects;
  if (step.endsWith('-designations')) return services.requiredCleanup;
  if (step === 'special-expiration') return services.simultaneousThisTurnExpiration;
  if (step.endsWith('-remaining')) return services.remainingCleanup;
  if (step.endsWith('-fepr')) return services.fepr;
  return undefined;
}
function winner(session: DuelEndingSession, cursor: DuelEndingCursor): DuelEndingResult | null {
  const match = playing(session)!;
  if (getDuelWinnerAtCleanup(match.scoring, match.board) === null) return null;
  const ended = transition(session, 'ended');
  const complete = advance(sync(ended, cursor), 'ended', { cleanupChanged: false });
  return response(withCursor(ended, complete), 'ended', true);
}
function settledHook(session: DuelEndingSession, cursor: DuelEndingCursor, raw: unknown):
  { session: DuelEndingSession; cursor: DuelEndingCursor } {
  if (!hook(raw)) throw new TypeError('Uncertified required Ending effect');
  const applied = raw.status === 'applied' ? installed(session, raw.match) : session;
  const changed = applied !== session;
  const done = sync(applied, consumed(cursor));
  if (cursor.step === 'ending-effects') {
    const next = transition(applied, 'expiration');
    return { session: next, cursor: advance(sync(next, done), 'special-designations') };
  }
  if (cursor.step.endsWith('-designations'))
    return { session: applied, cursor: advance(done,
      cursor.step === 'special-designations' ? 'special-lethal' : 'ordinary-lethal',
      { cleanupChanged: cursor.cleanupChanged || changed }) };
  if (cursor.step === 'special-expiration') {
    // The 317.2d expiration provider runs BEFORE the 317.2e pool clear; neither is a no-op by default.
    const cleared = commit(applied, draft => ({ ...draft,
      resources: clearAllDuelRunePools(draft.resources) }));
    return { session: cleared, cursor: advance(sync(cleared, done), 'special-remaining',
      { cleanupChanged: cursor.cleanupChanged || changed || cleared !== applied }) };
  }
  if (cursor.step.endsWith('-remaining')) return { session: applied, cursor: advance(done,
    cursor.step === 'special-remaining' ? 'special-fepr' : 'ordinary-fepr',
    { cleanupChanged: cursor.cleanupChanged || changed }) };
  throw new TypeError('Unexpected Ending effect step');
}
function lethalPlan(session: DuelEndingSession, services: DuelEndingServices): DuelKillPlan | null | undefined {
  const match = playing(session)!;
  if (match.board.units.length === 0) return null;
  const evaluators = services.lethalEvaluators;
  if (!evaluators) return undefined;
  // A trusted evaluator receives a detached validated aggregate's Unit view. It cannot turn
  // printed Might into a guess when temporary buffs/altered lethal thresholds are unknown.
  const candidate = detachedDuelPlaying(match);
  const lethal = queryLethalDuelUnitCandidates(candidate, {
    currentMight: unit => evaluators.currentMight(structuredClone(unit)),
    lethalDamageThreshold: (unit, might) => evaluators.lethalDamageThreshold(structuredClone(unit), might),
  });
  return lethal.length ? planDuelUnitKills(candidate, lethal.map(unit => unit.objectId), 'passive') : null;
}
function finishLethal(session: DuelEndingSession, cursor: DuelEndingCursor,
  plan: DuelKillPlan | null, raw: unknown): { session: DuelEndingSession; cursor: DuelEndingCursor } {
  let next = session;
  if (plan !== null) {
    if (!plain(raw, ['status', 'approvedUnitUIDs']) || raw.status !== 'approved' || !ids(raw.approvedUnitUIDs) ||
        !raw.approvedUnitUIDs.every(uid => plan.snapshots.some(snapshot => snapshot.objectId === uid)))
      throw new TypeError('Missing trusted Deathknell/Kill approval');
    const approved = [...raw.approvedUnitUIDs] as string[];
    next = commit(session, draft => commitApprovedDuelUnitKills(draft,
      { plan, approvedUnitUIDs: approved }).state as DuelCanonicalPlayingState);
  }
  const done = sync(next, consumed(cursor));
  if (cursor.step === 'ordinary-lethal') return { session: next,
    cursor: advance(done, 'ordinary-remaining', { cleanupChanged: cursor.cleanupChanged || next !== session }) };
  // Heal only surviving Units, after PRE-exit Deathknell snapshots and actual approved Kills.
  const healed = commit(next, draft => {
    const damaged = draft.board.units.filter(unit => draft.unitMeta[unit.objectId]!.damageMarks.length > 0)
      .map(unit => unit.objectId);
    return damaged.length ? healAllDuelUnitDamage(draft, damaged).state : draft;
  });
  return { session: healed, cursor: advance(sync(healed, done), 'special-expiration',
    { cleanupChanged: cursor.cleanupChanged || next !== session || healed !== next }) };
}
function finishFEPR(session: DuelEndingSession, cursor: DuelEndingCursor, raw: unknown):
  { session: DuelEndingSession; cursor: DuelEndingCursor } | DuelEndingResult {
  // Repeat an ordinary cleanup BEFORE FEPR if a special/ordinary cleanup caused another cleanup.
  if (cursor.cleanupChanged) throw new TypeError('FEPR before repeating required cleanup');
  if (!plain(raw, ['status']) && !plain(raw, ['status', 'match']))
    throw new TypeError('Uncertified FEPR outcome');
  if (raw.status === 'processed') {
    if (!Object.hasOwn(raw, 'match')) throw new TypeError('FEPR must supply an actual aggregate');
    const applied = installed(session, raw.match as DuelCanonicalPlayingState);
    const done = consumed(cursor);
    // 334.2.a: FEPR can create further outstanding cleanups. Resolve those as ordinary
    // cleanups first; only then may 317.2.f replay Expiration. Remember the processed item
    // in scalar metadata so a later `verified-no-effect` does not erase the replay duty.
    return { session: applied, cursor: advance(sync(applied, done), 'ordinary-designations',
      { cleanupRound: cursor.cleanupRound + 1, cleanupChanged: false, feprProcessed: true }) };
  }
  if (raw.status !== 'verified-no-effect' || Object.hasOwn(raw, 'match'))
    throw new TypeError('Uncertified FEPR outcome');
  const done = consumed(cursor);
  if (cursor.feprProcessed) {
    // The last ordinary cleanup is stable; at least one FEPR item was processed in this
    // Expiration iteration. Return to 317.2's beginning (not 317.1 Ending effects).
    return { session, cursor: advance(sync(session, done), 'special-designations',
      { expirationIteration: cursor.expirationIteration + 1, cleanupRound: 0,
        cleanupChanged: false, feprProcessed: false }) };
  }
  if (!Number.isSafeInteger(playing(session)!.frame.turnNumber + 1)) throw new RangeError('Turn number overflow');
  const next = transition(session, 'awaiting-turn-start');
  const complete = advance(sync(next, done), 'awaiting-turn-start', { cleanupChanged: false });
  return response(withCursor(next, complete), 'awaiting-turn-start', true);
}
function drive(original: DuelEndingSession, session: DuelEndingSession,
  cursor: DuelEndingCursor, services: DuelEndingServices,
  resolution?: { taskId: string; value: unknown }): DuelEndingResult {
  let supplied = resolution;
  // Repeat until stable, never accidentally spin with an effect provider that continually changes state.
  for (let steps = 0; steps < 512; steps++) {
    try {
      if (cursor.expirationIteration > 64 || cursor.cleanupRound > 64 || cursor.consumedIDs.length > 510)
        return reject(original, 'step-limit');
      if (cursor.step === 'awaiting-turn-start' || cursor.step === 'ended')
        return response(withCursor(session, cursor), cursor.step, true);
      if (cursor.step.endsWith('-designations')) {
        const won = winner(session, cursor); // CR 323.1, before 323.2/3a/3b/heal.
        if (won) return won;
      }
      if (cursor.step.endsWith('-lethal')) {
        const plan = lethalPlan(session, services);
        if (plan === undefined) {
          if (supplied && (!plain(supplied.value, ['status']) || supplied.value.status !== 'pending'))
            throw new TypeError('Trusted Might evaluators still required for lethal resolution');
          return wait(session, cursor);
        }
        if (plan !== null && !supplied && !services.lethalKillApproval) return wait(session, cursor);
        if (plan === null && supplied) {
          // An outstanding task may have been issued before trusted Might became available.
          // A now-proven empty lethal set is an explicit result; do not silently consume an
          // unrelated resolution, and never treat a supplied approval as proof of a Kill.
          if (supplied.taskId !== task(cursor) || !hook(supplied.value) ||
              supplied.value.status !== 'verified-no-effect') throw new TypeError('Unexpected lethal resolution');
          supplied = undefined;
        }
        let raw: unknown;
        if (plan !== null) {
          if (supplied) {
            if (supplied.taskId !== task(cursor)) throw new TypeError('Unexpected trusted resolution');
            raw = supplied.value; supplied = undefined;
          } else raw = services.lethalKillApproval!({ ...context(session, cursor), plan: structuredClone(plan) });
          if (isPending(raw)) return wait(session, cursor);
        }
        ({ session, cursor } = finishLethal(session, cursor, plan, raw));
        continue;
      }
      if (cursor.step === 'special-fepr' || cursor.step === 'ordinary-fepr') {
        if (cursor.cleanupChanged) {
          cursor = advance(cursor, 'ordinary-designations', {
            cleanupRound: cursor.cleanupRound + 1, cleanupChanged: false });
          continue;
        }
      }
      const provider = service(services, cursor.step);
      if (!supplied && !provider) return wait(session, cursor);
      let raw: unknown;
      if (supplied) {
        if (supplied.taskId !== task(cursor)) throw new TypeError('Unexpected trusted resolution');
        raw = supplied.value; supplied = undefined;
      } else raw = provider!(context(session, cursor));
      if (isPending(raw)) return wait(session, cursor);
      if (cursor.step.endsWith('-fepr')) {
        const finished = finishFEPR(session, cursor, raw);
        if ('status' in finished) return finished;
        ({ session, cursor } = finished);
      } else ({ session, cursor } = settledHook(session, cursor, raw));
    } catch {
      return reject(original, 'invalid-resolution-or-provider');
    }
  }
  return reject(original, 'step-limit');
}
/** Only the authenticated real Neutral-Open Main turn player may end Main (316.9). */
export function runDuelEndOfTurn(session: DuelEndingSession, authenticatedTurnActor: string,
  services: DuelEndingServices): DuelEndingResult {
  if (!services || typeof services !== 'object') return reject(session, 'invalid-services');
  const match = playing(session);
  const progress = ownData(session, 'endingProgress');
  const hasProgress = Object.hasOwn(session, 'endingProgress');
  const prior = hasProgress && progress !== undefined ? parsedCursor(session) : undefined;
  if (prior === null || (hasProgress &&
      !('value' in Object.getOwnPropertyDescriptor(session, 'endingProgress')!)) ||
      (prior === undefined && (Object.hasOwn(session, 'priorEndingTurns') ||
        match?.frame.turnNumber !== 1))) return reject(session, 'invalid-session');
  if (prior && (prior.step !== 'awaiting-turn-start' || !match ||
      match.frame.turnNumber !== prior.turn + 1)) return reject(session, 'task-conflict');
  if (!id(authenticatedTurnActor)) return reject(session, 'wrong-actor');
  const gate = validMain(session, authenticatedTurnActor);
  if (gate) return reject(session, gate);
  try {
    const history: readonly CompletedEndingTurn[] = prior
      ? [...parsedPrior(session, prior.turn)!, { turn: prior.turn, consumedIDs: [...prior.consumedIDs] }]
      : [];
    const entered = transition({ ...session, priorEndingTurns: history }, 'ending');
    const cursor: DuelEndingCursor = { kind: 'ending', turn: match!.frame.turnNumber,
      rootTaskID: root(match!), step: 'ending-effects', expirationIteration: 0, cleanupRound: 0,
      cleanupChanged: false, feprProcessed: false, pendingTaskID: null, consumedIDs: [],
      stateVersion: playing(entered)!.stateVersion, eventSeq: playing(entered)!.eventSeq };
    return drive(session, entered, cursor, services);
  } catch { return reject(session, 'transaction-rejected'); }
}
/** Exactly-once private task resolution. Reject wrong/stale tasks; a consumed ID returns latest session. */
export function resumeDuelEndOfTurn(session: DuelEndingSession, taskId: string,
  trustedResolution: unknown, services: DuelEndingServices): DuelEndingResult {
  if (!id(taskId)) return reject(session, 'wrong-task');
  if (!services || typeof services !== 'object') return reject(session, 'invalid-services');
  const cursor = parsedCursor(session);
  if (!cursor) return reject(session, 'invalid-session');
  const history = parsedPrior(session, cursor.turn)!;
  if (cursor.consumedIDs.includes(taskId) ||
      history.some(previous => previous.consumedIDs.includes(taskId)))
    return response(session, 'duplicate', false);
  if (cursor.step === 'awaiting-turn-start' || cursor.step === 'ended' ||
      cursor.pendingTaskID !== taskId || task(cursor) !== taskId) return reject(session, 'wrong-task');
  if (session.turnProgress && (session.turnProgress.turn !== cursor.turn ||
      session.turnProgress.step !== 'scoring' || session.turnProgress.pendingTaskID !== null))
    return reject(session, 'task-conflict');
  if (session.turnFlow?.step !== 'main' || session.turnFlow.turn !== cursor.turn ||
      session.turnFlow.rootTaskID !== `duel-turn-start:${session.match.matchId}:turn-${cursor.turn}` ||
      session.turnFlow.pendingTaskID !== null || session.turnFlow.drawCursor !== null)
    return reject(session, 'task-conflict');
  const required = ownData(session, 'requiredTasks');
  if (required !== undefined && (!Array.isArray(required) || required.some(entry =>
      ownData(entry, 'status') === 'active' || ownData(entry, 'status') === 'issued')))
    return reject(session, 'task-conflict');
  return drive(session, session, cursor, services, { taskId, value: trustedResolution });
}

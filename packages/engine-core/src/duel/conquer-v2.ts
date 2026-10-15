// CR 348.2 / 466.5 / 469.1 / 470–471: INTERNAL, process-local bridge from a
// canonical admitted control transition to Conquer scoring. A legal board pair,
// replayable resolution, or serialized archive is NOT authority to create a Score.
import {
  endDuelCombat, endDuelNonCombatShowdown, restoreDuelBoard,
  type DuelBoard, type DuelCombatResult,
} from './battlefields.js';
import {
  restoreDuelScoring, scoreDuelBattlefield, type DuelScoreResult, type DuelScoringState,
} from './scoring.js';

export interface DuelControlPositionV2 {
  readonly matchId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
}
export type DuelControlResolutionV2 =
  | { readonly kind: 'non-combat-showdown' }
  | { readonly kind: 'combat'; readonly recalledAttackersDuringCleanup: boolean;
      readonly result: DuelCombatResult };

/** The ONLY caller-controlled input. In particular there is no board, Score state,
 * resolution, winner, turn player, or timing pair on this request. */
export interface DuelConquerEventRequestV2 {
  readonly controlEventId: string;
  readonly expectedPosition: DuelControlPositionV2;
}
/** One atomic read from the trusted executor's admitted event journal AND current
 * match head. The executor, not the client or this factory, must establish that the
 * event belongs to this match and that scoring/turn/recall/result are canonical. */
export interface DuelConquerAuthorityRecordV2 {
  readonly controlEventId: string;
  readonly beforeBoard: DuelBoard;
  readonly afterBoard: DuelBoard;
  readonly beforePosition: DuelControlPositionV2;
  readonly afterPosition: DuelControlPositionV2;
  readonly actor: string;
  readonly locationId: string;
  readonly resolution: DuelControlResolutionV2;
  readonly scoring: DuelScoringState;
  readonly turnPlayerId: string;
  readonly head: {
    readonly position: DuelControlPositionV2;
    readonly board: DuelBoard;
    readonly scoring: DuelScoringState;
  };
}
export type DuelConquerResolverV2 = (controlEventId: string) => DuelConquerAuthorityRecordV2 | null;
declare const duelConquerAuthorityBrandV2: unique symbol;
export interface DuelConquerAuthorityV2 { readonly [duelConquerAuthorityBrandV2]: true }
declare const duelControlEstablishedBrandV2: unique symbol;

// Resolver failures are an INTERNAL boundary failure. Never expose a provider's
// Error/message/cause (providers may carry card text, private zones, or secrets).
const AUTHORITY_INTERNAL_ERROR = 'Duel conquer authority internal error';
function authorityInternalFailure(): never {
  throw new TypeError(AUTHORITY_INTERNAL_ERROR);
}
export interface DuelControlEstablishedEventV2 { readonly [duelControlEstablishedBrandV2]: true }
export interface DuelControlConsumptionV2 extends DuelControlPositionV2 {
  readonly controlEventId: string;
  readonly actor: string;
  readonly locationId: string;
  readonly previousControllerPlayerId: string | null;
  readonly resolution: DuelControlResolutionV2;
  readonly consumed: true;
}
export interface DuelConquerScoreResultV2 extends DuelScoreResult {
  readonly eventConsumption: DuelControlConsumptionV2;
}

interface AuthorityState {
  readonly resolve: DuelConquerResolverV2;
  readonly issuedIds: Set<string>;
  readonly transitions: Map<string, { controlEventId: string; consumed: boolean }>;
  busy: boolean;
  reentered: boolean;
}
interface CanonicalEvent {
  readonly controlEventId: string;
  readonly position: DuelControlPositionV2;
  readonly actor: string;
  readonly locationId: string;
  readonly previousControllerPlayerId: string | null;
  readonly resolution: DuelControlResolutionV2;
  readonly board: DuelBoard;
  readonly scoring: DuelScoringState;
  readonly turnPlayerId: string;
  readonly fingerprint: string;
  readonly transitionIdentity: string;
}
interface IssuedEvent {
  readonly authority: object;
  readonly canonical: CanonicalEvent;
  consumed: boolean;
}
const authorities = new WeakMap<object, AuthorityState>();
const issued = new WeakMap<object, IssuedEvent>();

type PlainRecord = Record<string, unknown>;
function check(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new TypeError(`Invalid duel control event: ${reason}`);
}
function range(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new RangeError(`Duel control event out of range: ${reason}`);
}
function record(input: unknown, fields: readonly string[], reason: string): PlainRecord {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), reason);
  const prototype = Object.getPrototypeOf(input);
  check(prototype === Object.prototype || prototype === null, `${reason} prototype`);
  const keys = Reflect.ownKeys(input);
  check(keys.length === fields.length && fields.every(key => keys.includes(key)), `${reason} keys`);
  check(keys.every(key => 'value' in Object.getOwnPropertyDescriptor(input, key)!), `${reason} accessors`);
  return input as PlainRecord;
}
function id(input: unknown, reason: string): string {
  check(typeof input === 'string' && input.trim().length > 0, reason);
  return input;
}
function position(input: unknown): DuelControlPositionV2 {
  const value = record(input, ['matchId', 'stateVersion', 'eventSeq'], 'position');
  const matchId = id(value.matchId, 'matchId');
  for (const key of ['stateVersion', 'eventSeq'] as const) {
    check(typeof value[key] === 'number' && Number.isSafeInteger(value[key]), `${key} must be a safe integer`);
    range((value[key] as number) >= 0, `${key} must be nonnegative`);
  }
  check(value.stateVersion === value.eventSeq, 'stateVersion and eventSeq must agree');
  return { matchId, stateVersion: value.stateVersion as number, eventSeq: value.eventSeq as number };
}
function samePosition(left: DuelControlPositionV2, right: DuelControlPositionV2): boolean {
  return left.matchId === right.matchId && left.stateVersion === right.stateVersion &&
    left.eventSeq === right.eventSeq;
}
function request(input: unknown): DuelConquerEventRequestV2 {
  const value = record(input, ['controlEventId', 'expectedPosition'], 'request');
  return { controlEventId: id(value.controlEventId, 'controlEventId'),
    expectedPosition: position(value.expectedPosition) };
}
function resolution(input: unknown, players: readonly string[]): DuelControlResolutionV2 {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), 'resolution');
  const kind = Object.getOwnPropertyDescriptor(input, 'kind');
  check(kind && 'value' in kind, 'resolution kind accessor or missing');
  if (kind.value === 'non-combat-showdown') {
    record(input, ['kind'], 'resolution');
    return { kind: 'non-combat-showdown' };
  }
  const data = record(input, ['kind', 'recalledAttackersDuringCleanup', 'result'], 'resolution');
  check(data.kind === 'combat' && typeof data.recalledAttackersDuringCleanup === 'boolean',
    'combat resolution kind/recall flag');
  let result: DuelCombatResult;
  if (data.result === 'no-result') result = 'no-result';
  else {
    const winner = record(data.result, ['winnerPlayerId'], 'combat result');
    const playerId = id(winner.winnerPlayerId, 'winnerPlayerId');
    check(players.includes(playerId), 'unknown combat winner');
    result = { winnerPlayerId: playerId };
  }
  return { kind: 'combat', recalledAttackersDuringCleanup: data.recalledAttackersDuringCleanup as boolean, result };
}
function field(board: DuelBoard, locationId: string) {
  const selected = board.battlefields.find(value => value.locationId === locationId);
  check(selected, 'unknown battlefield location');
  return selected;
}
/** Strict, detached copies of the entire board and scoring ledger; never retain a
 * mutable provider value or infer the Score ledger from the board. */
function boardSnapshot(input: unknown): { board: DuelBoard; fingerprint: string } {
  const board = restoreDuelBoard(input);
  return { board, fingerprint: JSON.stringify(board) };
}
function scoringSnapshot(input: unknown, board: DuelBoard): { scoring: DuelScoringState; fingerprint: string } {
  const scoring = restoreDuelScoring(input, board);
  return { scoring, fingerprint: JSON.stringify(scoring) };
}
function readCanonical(state: AuthorityState, controlEventId: string): CanonicalEvent {
  let resolved: DuelConquerAuthorityRecordV2 | null;
  try {
    resolved = state.resolve(controlEventId);
  } catch {
    authorityInternalFailure();
  }
  check(!state.reentered, 'authority resolver reentry');
  const raw = record(resolved, [
    'controlEventId', 'beforeBoard', 'afterBoard', 'beforePosition', 'afterPosition',
    'actor', 'locationId', 'resolution', 'scoring', 'turnPlayerId', 'head',
  ], 'canonical admitted transition');
  check(raw.controlEventId === controlEventId, 'resolver returned a different event');
  const before = boardSnapshot(raw.beforeBoard);
  const after = boardSnapshot(raw.afterBoard);
  const earlier = position(raw.beforePosition);
  const later = position(raw.afterPosition);
  check(earlier.matchId === later.matchId, 'match changed across control transition');
  range(earlier.stateVersion < Number.MAX_SAFE_INTEGER, 'control transition version overflow');
  check(later.stateVersion === earlier.stateVersion + 1 && later.eventSeq === earlier.eventSeq + 1,
    'control transition must advance exactly one version/event');
  const actor = id(raw.actor, 'actor');
  const at = id(raw.locationId, 'locationId');
  check(before.board.playerIds.includes(actor) && after.board.playerIds.includes(actor), 'unknown actor');
  const previous = field(before.board, at);
  const next = field(after.board, at);
  check(previous.controllerPlayerId !== actor && next.controllerPlayerId === actor,
    'control must change from a different controller to actor');
  check(!next.contested && next.contestingPlayerId === null && next.showdown === 'none' && next.combat === 'none',
    'control establishment must resolve the engagement');
  const how = resolution(raw.resolution, before.board.playerIds);
  if (how.kind === 'non-combat-showdown') {
    check(JSON.stringify(endDuelNonCombatShowdown(before.board, at)) === after.fingerprint,
      'after board does not match non-combat resolution');
  } else {
    // The board alone CANNOT distinguish recalled attackers from no recall. Only
    // the trusted Combat Cleanup executor can provide this flag and its result.
    const replay = endDuelCombat(before.board, at,
      { recalledAttackersDuringCleanup: how.recalledAttackersDuringCleanup });
    check(JSON.stringify(replay.board) === after.fingerprint, 'after board does not match combat resolution');
    check(JSON.stringify(replay.result) === JSON.stringify(how.result) && !replay.restaged,
      'combat winner/no-result does not match executor proof');
  }
  const scoring = scoringSnapshot(raw.scoring, after.board);
  const turnPlayerId = id(raw.turnPlayerId, 'turnPlayerId');
  check(after.board.playerIds.includes(turnPlayerId), 'unknown turn player');
  const head = record(raw.head, ['position', 'board', 'scoring'], 'canonical current head');
  const headPosition = position(head.position);
  check(samePosition(headPosition, later), 'event is not the current authoritative match head');
  const headBoard = boardSnapshot(head.board);
  check(headBoard.fingerprint === after.fingerprint, 'head board does not match admitted after board');
  const headScoring = scoringSnapshot(head.scoring, headBoard.board);
  check(headScoring.fingerprint === scoring.fingerprint, 'head scoring does not match current event scoring');
  const fingerprint = JSON.stringify({ controlEventId, before: before.fingerprint, after: after.fingerprint,
    earlier, later, actor, at, how, scoring: scoring.fingerprint, turnPlayerId });
  const transitionIdentity = JSON.stringify({ earlier, later, before: before.fingerprint,
    after: after.fingerprint, actor, locationId: at, resolution: how });
  return { controlEventId, position: later, actor, locationId: at,
    previousControllerPlayerId: previous.controllerPlayerId, resolution: how,
    board: after.board, scoring: scoring.scoring, turnPlayerId, fingerprint, transitionIdentity };
}
function authorityState(input: unknown): AuthorityState {
  check(input !== null && typeof input === 'object' && authorities.has(input), 'missing, cloned or foreign authority');
  return authorities.get(input as object)!;
}
function exclusive<T>(state: AuthorityState, operation: () => T): T {
  if (state.busy) {
    state.reentered = true;
    throw new TypeError('Invalid duel control event: authority resolver reentry');
  }
  state.busy = true;
  state.reentered = false;
  try {
    const result = operation();
    check(!state.reentered, 'authority resolver reentry');
    return result;
  } finally {
    state.busy = false;
    state.reentered = false;
  }
}

/** ONLY trusted server/executor composition may create this capability. Its callback
 * must atomically resolve an ALREADY ADMITTED event alongside the current live head;
 * it must never manufacture events from a client board, archive JSON, or raw timing.
 * Replay and WeakMap identity check consistency, not the provider's provenance.
 * Durable event receipts and a transaction/CAS around Score + Final Point draw +
 * triggers are STILL required across process restarts and failed commits. */
export function createDuelConquerAuthorityV2(trustedResolver: DuelConquerResolverV2): DuelConquerAuthorityV2 {
  check(typeof trustedResolver === 'function', 'trusted canonical resolver required');
  const authority = Object.freeze(Object.create(null)) as DuelConquerAuthorityV2;
  authorities.set(authority, { resolve: trustedResolver, issuedIds: new Set(),
    transitions: new Map(), busy: false, reentered: false });
  return authority;
}

/** Issue once per authority/event ID and canonical transition, only while its
 * admitted after snapshot is the current head. Failed validation reserves neither. */
export function issueDuelControlEstablishedEventV2(
  authority: DuelConquerAuthorityV2, input: unknown,
): DuelControlEstablishedEventV2 {
  const state = authorityState(authority);
  const wanted = request(input);
  return exclusive(state, () => {
    check(!state.issuedIds.has(wanted.controlEventId), 'control event already issued');
    const canonical = readCanonical(state, wanted.controlEventId);
    check(!state.reentered, 'authority resolver reentry');
    check(samePosition(wanted.expectedPosition, canonical.position), 'control event expected match/clock mismatch');
    check(!state.transitions.has(canonical.transitionIdentity), 'canonical transition already issued');
    const token = Object.freeze(Object.create(null)) as DuelControlEstablishedEventV2;
    issued.set(token, { authority, canonical, consumed: false });
    state.issuedIds.add(wanted.controlEventId);
    state.transitions.set(canonical.transitionIdentity,
      { controlEventId: wanted.controlEventId, consumed: false });
    return token;
  });
}

/** Fetch the SAME admitted event and live scoring/head again before scoring. Neither
 * the board nor the Score ledger nor the turn player may be supplied at this entry.
 * A failed read/kernel leaves the token unspent; a successful return spends it once.
 * This is not an atomic persistent commit: the executor must CAS the event receipt,
 * new scoring, Final Point draw and triggered continuation together. */
export function scoreDuelConquerWithEventV2(
  authority: DuelConquerAuthorityV2, input: unknown, event: unknown,
): DuelConquerScoreResultV2 {
  const state = authorityState(authority);
  const wanted = request(input);
  check(event !== null && typeof event === 'object' && issued.has(event),
    'missing, cloned or foreign control event');
  const proof = issued.get(event as object)!;
  check(proof.authority === authority, 'control event belongs to another authority');
  check(!proof.consumed, 'control event already consumed');
  check(proof.canonical.controlEventId === wanted.controlEventId &&
    samePosition(proof.canonical.position, wanted.expectedPosition), 'control event request mismatch');
  return exclusive(state, () => {
    const current = readCanonical(state, wanted.controlEventId);
    check(current.fingerprint === proof.canonical.fingerprint, 'canonical event drift after issuance');
    const transition = state.transitions.get(proof.canonical.transitionIdentity);
    check(transition?.controlEventId === wanted.controlEventId && !transition.consumed,
      'canonical transition already consumed or claimed by another event');
    const result = scoreDuelBattlefield(current.scoring, current.board, current.actor, current.locationId,
      'conquer', { phase: 'other', turnPlayerId: current.turnPlayerId,
        controlEstablishedForPlayerId: current.actor, controlEstablishedLocationId: current.locationId });
    check(!state.reentered, 'authority resolver reentry');
    proof.consumed = true;
    transition.consumed = true;
    const how = current.resolution.kind === 'combat' && typeof current.resolution.result === 'object'
      ? { ...current.resolution, result: Object.freeze({ ...current.resolution.result }) }
      : { ...current.resolution };
    return { ...result, eventConsumption: Object.freeze({ ...current.position,
      controlEventId: current.controlEventId, actor: current.actor, locationId: current.locationId,
      previousControllerPlayerId: current.previousControllerPlayerId, resolution: Object.freeze(how),
      consumed: true as const }) };
  });
}

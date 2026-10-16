// CR v1.4: 193–194 (winning / Victory Score / no negative points), 315.2.b (Beginning Phase Scoring
// Step), 467–472 (Scoring, Hold, Conquer, the Final Point restriction, cleanup victory).
// Board rules are never re-implemented here; the board module is the single authority for
// locations, control, contested and engagements.
import { assertDuelBoard, type DuelBoard } from '../duel/battlefields.js';

export interface DuelScoringPlayer {
  readonly playerId: string;
  readonly points: number;
  readonly scoredBattlefieldLocationIds: readonly string[];
}
export interface DuelScoringState {
  readonly playerIds: readonly string[];
  readonly battlefieldLocationIds: readonly string[];
  readonly victoryScore: number;
  readonly turnNumber: number;
  readonly players: readonly DuelScoringPlayer[];
}
export type DuelScoreMethod = 'hold' | 'conquer';
/** Trusted context derived by the canonical executor, NEVER accepted from a client or wire payload. */
export interface DuelScoreTiming {
  readonly phase: 'beginning-scoring' | 'other';
  readonly turnPlayerId: string;
  readonly controlEstablishedForPlayerId: string | null;
  readonly controlEstablishedLocationId: string | null;
}
export interface DuelScoreOutcome {
  readonly playerId: string;
  readonly locationId: string;
  readonly method: DuelScoreMethod;
  readonly pointsGained: 0 | 1;
  readonly drawRequired: 0 | 1;
  readonly triggerScore: true;
  readonly triggerMethod: DuelScoreMethod;
}
export interface DuelScoreResult {
  readonly state: DuelScoringState;
  readonly outcome: DuelScoreOutcome;
}
export interface DuelPointGain {
  readonly state: DuelScoringState;
  readonly actualGained: number;
}
export interface DuelPointLoss {
  readonly state: DuelScoringState;
  readonly actualLost: number;
  readonly triggerLoss: boolean;
}

type MutablePlayer = { playerId: string; points: number; scoredBattlefieldLocationIds: string[] };
type MutableScoring = {
  playerIds: string[]; battlefieldLocationIds: string[]; victoryScore: number;
  turnNumber: number; players: MutablePlayer[];
};
type RecordValue = Record<string, unknown>;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const STATE_FIELDS = ['playerIds', 'battlefieldLocationIds', 'victoryScore', 'turnNumber', 'players'];
const PLAYER_FIELDS = ['playerId', 'points', 'scoredBattlefieldLocationIds'];
const TIMING_FIELDS = ['phase', 'turnPlayerId', 'controlEstablishedForPlayerId', 'controlEstablishedLocationId'];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid duel scoring state: ${message}`);
}
function range(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(`Duel scoring value out of range: ${message}`);
}
function record(value: unknown, fields: readonly string[], label: string): RecordValue {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), label);
  const keys = Reflect.ownKeys(value);
  check(keys.length === fields.length && fields.every(key => keys.includes(key)), `${label} keys`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor && 'value' in descriptor, `${label} must not contain accessors`);
  }
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null, `${label} must be a plain object`);
  return value as RecordValue;
}
function list(value: unknown, count: number | null, label: string): unknown[] {
  check(Array.isArray(value) && (count === null || value.length === count), label);
  check(Reflect.ownKeys(value).length === value.length + 1, `${label} extra keys or sparse entries`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    check(descriptor && 'value' in descriptor, `${label} sparse or accessor entry`);
  }
  return value;
}
function text(value: unknown, label: string): string {
  check(typeof value === 'string' && value.trim().length > 0, label);
  return value;
}
function integer(value: unknown, label: string): number {
  check(typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value), `${label} must be a safe integer`);
  return value;
}
function unique(values: readonly string[], label: string): void {
  check(new Set(values).size === values.length, `${label} duplicate`);
}
function player(value: unknown, players: readonly string[], label: string): string {
  const valueId = text(value, label);
  check(players.includes(valueId), `${label} unknown player`);
  return valueId;
}
function positiveScore(value: unknown, label: string): number {
  const score = integer(value, label);
  range(score >= 1, `${label} must be a positive safe integer`);
  return score;
}
function count(value: unknown, label: string): number {
  const number = integer(value, label);
  range(number >= 0, `${label} must not be negative`);
  return number;
}

/** Requires an already validated board; returns a fully validated, detached, mutable copy. */
function checkedScoring(input: unknown, board: DuelBoard): MutableScoring {
  const value = record(input, STATE_FIELDS, 'scoring');
  const seats = board.playerIds;
  const fields = board.battlefields.map(field => field.locationId);
  const playerIds = list(value.playerIds, 2, 'scoring.playerIds').map((seat, i) => text(seat, `scoring.playerIds[${i}]`));
  check(playerIds.every((seat, i) => seat === seats[i]), 'playerIds must match the board seats in order');
  const battlefieldLocationIds = list(value.battlefieldLocationIds, 2, 'scoring.battlefieldLocationIds')
    .map((field, i) => text(field, `scoring.battlefieldLocationIds[${i}]`));
  unique(battlefieldLocationIds, 'scoring.battlefieldLocationIds');
  check(battlefieldLocationIds.every((field, i) => field === fields[i]),
    'battlefieldLocationIds must match the board battlefields in order');
  const victoryScore = positiveScore(value.victoryScore, 'scoring.victoryScore');
  const turnNumber = integer(value.turnNumber, 'scoring.turnNumber');
  range(turnNumber >= 0, 'scoring.turnNumber must not be negative');
  const players = list(value.players, 2, 'scoring.players').map((raw, i) => {
    const seat = record(raw, PLAYER_FIELDS, `scoring.players[${i}]`);
    const playerId = text(seat.playerId, `scoring.players[${i}].playerId`);
    check(playerId === playerIds[i], `scoring.players[${i}].playerId must match the seat order`);
    const points = integer(seat.points, `scoring.players[${i}].points`);
    range(points >= 0, `scoring.players[${i}].points must not be negative`);
    const ledger = list(seat.scoredBattlefieldLocationIds, null, `scoring.players[${i}].scoredBattlefieldLocationIds`)
      .map((field, j) => text(field, `scoring.players[${i}].scoredBattlefieldLocationIds[${j}]`));
    unique(ledger, `scoring.players[${i}].scoredBattlefieldLocationIds`);
    check(ledger.every(field => battlefieldLocationIds.includes(field)),
      `scoring.players[${i}].scoredBattlefieldLocationIds must belong to the shared battlefields`);
    return { playerId, points, scoredBattlefieldLocationIds: ledger };
  });
  return { playerIds, battlefieldLocationIds, victoryScore, turnNumber, players };
}
function publicScoring(state: MutableScoring): DuelScoringState {
  return {
    playerIds: [...state.playerIds],
    battlefieldLocationIds: [...state.battlefieldLocationIds],
    victoryScore: state.victoryScore,
    turnNumber: state.turnNumber,
    players: state.players.map(seat => ({ playerId: seat.playerId, points: seat.points,
      scoredBattlefieldLocationIds: [...seat.scoredBattlefieldLocationIds] })),
  };
}
function scorerOf(state: MutableScoring, playerId: string): MutablePlayer {
  const scorer = state.players.find(seat => seat.playerId === playerId);
  check(scorer, `unknown scorer ${playerId}`);
  return scorer!;
}

/** 194.3: the Victory Score is 8 by default; a mode or effect may pass another trusted value. */
export function createDuelScoring(board: unknown, victoryScore: unknown = 8): DuelScoringState {
  assertDuelBoard(board);
  const score = positiveScore(victoryScore, 'victoryScore');
  return {
    playerIds: [...board.playerIds],
    battlefieldLocationIds: board.battlefields.map(field => field.locationId),
    victoryScore: score,
    turnNumber: 0,
    players: board.playerIds.map(playerId => ({ playerId, points: 0, scoredBattlefieldLocationIds: [] })),
  };
}

/** Trusted serialized engine state only; never a client snapshot or a proof of history. */
export function restoreDuelScoring(raw: unknown, board: unknown): DuelScoringState {
  assertDuelBoard(board);
  return publicScoring(checkedScoring(raw, board));
}

/**
 * Advances to `turnNumber + 1` and clears both players' current-turn Score ledger (470).
 * Points and the Victory Score survive (194). Which player is the turn player, and any extra
 * turn, stay the outer executor's responsibility.
 */
export function beginDuelScoreTurn(state: unknown, board: unknown, nextTurnNumber: unknown): DuelScoringState {
  assertDuelBoard(board);
  const current = checkedScoring(state, board);
  const next = integer(nextTurnNumber, 'nextTurnNumber');
  range(next === current.turnNumber + 1, 'nextTurnNumber must be exactly turnNumber + 1');
  current.turnNumber = next;
  for (const seat of current.players) seat.scoredBattlefieldLocationIds = [];
  return publicScoring(current);
}

function checkedTiming(input: unknown, state: MutableScoring): DuelScoreTiming {
  const value = record(input, TIMING_FIELDS, 'score timing');
  check(value.phase === 'beginning-scoring' || value.phase === 'other', 'score timing phase');
  const turnPlayerId = player(value.turnPlayerId, state.playerIds, 'score timing turnPlayerId');
  const establishedFor = value.controlEstablishedForPlayerId === null
    ? null : player(value.controlEstablishedForPlayerId, state.playerIds, 'score timing controlEstablishedForPlayerId');
  const establishedAt = value.controlEstablishedLocationId === null
    ? null : text(value.controlEstablishedLocationId, 'score timing controlEstablishedLocationId');
  check((establishedFor === null) === (establishedAt === null), 'score timing control event must be a complete pair');
  if (establishedAt !== null) {
    check(state.battlefieldLocationIds.includes(establishedAt),
      'score timing controlEstablishedLocationId unknown battlefield');
  }
  return { phase: value.phase as DuelScoreTiming['phase'], turnPlayerId,
    controlEstablishedForPlayerId: establishedFor, controlEstablishedLocationId: establishedAt };
}

/**
 * 468–471: one Score per player per battlefield per turn across both methods. The caller's board
 * must already show the actor as current controller; Conquer additionally requires the canonical
 * outer control-established event. The Score ledger is written before the all-battlefields check
 * (471.1.b.1), otherwise the second Final Point battlefield could never be scored. Returned flags
 * are executor instructions: this primitive does not draw a card or resolve abilities.
 */
export function scoreDuelBattlefield(
  state: unknown, board: unknown, actor: unknown, locationId: unknown, method: unknown, timing: unknown,
): DuelScoreResult {
  assertDuelBoard(board);
  const current = checkedScoring(state, board);
  check(current.turnNumber >= 1, 'no Battlefield can be Scored on turn 0');
  const actorId = player(actor, current.playerIds, 'actor');
  const fieldId = text(locationId, 'locationId');
  check(current.battlefieldLocationIds.includes(fieldId), 'unknown battlefield location');
  check(method === 'hold' || method === 'conquer', 'method must be hold or conquer');
  const context = checkedTiming(timing, current);
  const field = board.battlefields.find(value => value.locationId === fieldId)!;
  check(field.controllerPlayerId === actorId, 'actor must currently control the battlefield');
  if (method === 'hold') {
    // 315.2.b / 469.2: only the Turn Player Holds, only in the canonical Scoring Step.
    check(context.phase === 'beginning-scoring', 'Hold requires the canonical beginning-scoring step');
    check(context.turnPlayerId === actorId, 'Hold requires the turn player');
  } else {
    // 469.1 / 471.1.b: the outer executor just established control; a raw client boolean may not
    // stand in for that trusted event.
    check(context.controlEstablishedForPlayerId === actorId && context.controlEstablishedLocationId === fieldId,
      'Conquer requires the canonical control-established event for this battlefield');
  }
  const scorer = scorerOf(current, actorId);
  check(!scorer.scoredBattlefieldLocationIds.includes(fieldId), 'battlefield already scored this turn by this player');
  scorer.scoredBattlefieldLocationIds = [...scorer.scoredBattlefieldLocationIds, fieldId];
  const scoredEveryBattlefield = current.battlefieldLocationIds
    .every(entry => scorer.scoredBattlefieldLocationIds.includes(entry));
  let pointsGained: 0 | 1 = 1;
  let drawRequired: 0 | 1 = 0;
  if (method === 'conquer' && scorer.points >= current.victoryScore - 1 && !scoredEveryBattlefield) {
    // 471.1.b.1: the Final Point draw replaces the point but the Score still happened (471.2).
    pointsGained = 0;
    drawRequired = 1;
  }
  range(scorer.points + pointsGained <= MAX_SAFE, 'point total overflow');
  scorer.points += pointsGained;
  return { state: publicScoring(current), outcome: { playerId: actorId, locationId: fieldId,
    method: method as DuelScoreMethod, pointsGained, drawRequired, triggerScore: true,
    triggerMethod: method as DuelScoreMethod } };
}

/** 194.1.c/d: trusted ability or Burn Out point gain. No Score ledger entry, no Final Point limit. */
export function gainDuelPoints(state: unknown, board: unknown, actor: unknown, amount: unknown): DuelPointGain {
  assertDuelBoard(board);
  const current = checkedScoring(state, board);
  const actorId = player(actor, current.playerIds, 'actor');
  const gained = count(amount, 'amount');
  const scorer = scorerOf(current, actorId);
  range(scorer.points + gained <= MAX_SAFE, 'point total overflow');
  scorer.points += gained;
  return { state: publicScoring(current), actualGained: gained };
}

/** 194.4: points never fall below zero, and a zero loss does not trigger loss abilities. */
export function loseDuelPoints(state: unknown, board: unknown, actor: unknown, amount: unknown): DuelPointLoss {
  assertDuelBoard(board);
  const current = checkedScoring(state, board);
  const actorId = player(actor, current.playerIds, 'actor');
  const requested = count(amount, 'amount');
  const scorer = scorerOf(current, actorId);
  const lost = Math.min(scorer.points, requested);
  scorer.points -= lost;
  return { state: publicScoring(current), actualLost: lost, triggerLoss: lost > 0 };
}

/** 194.3.a: minimal trusted internal setter for modes/effects. Scores and ledger are preserved. */
export function setDuelVictoryScoreForEffect(
  state: unknown, board: unknown, newVictoryScore: unknown,
): DuelScoringState {
  assertDuelBoard(board);
  const current = checkedScoring(state, board);
  current.victoryScore = positiveScore(newVictoryScore, 'newVictoryScore');
  return publicScoring(current);
}

/**
 * 194.2 / 472: pure query for the canonical cleanup. Returns the unique leader at or above the
 * Victory Score, otherwise null (8/8 keeps playing, 9/8 wins for 9). This never ends the match,
 * never writes state and never stops a chain.
 */
export function getDuelWinnerAtCleanup(state: unknown, board: unknown): string | null {
  assertDuelBoard(board);
  const current = checkedScoring(state, board);
  const leader = current.players.find(seat => seat.points >= current.victoryScore &&
    current.players.every(other => other === seat || seat.points > other.points));
  return leader ? leader.playerId : null;
}

/** Whitelist projection: copies exactly the public scoring fields and never spreads unknown state. */
export function projectPublicDuelScoring(state: unknown, board: unknown): DuelScoringState {
  assertDuelBoard(board);
  return publicScoring(checkedScoring(state, board));
}

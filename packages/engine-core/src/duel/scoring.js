// CR v1.4: 193–194 (winning / Victory Score / no negative points), 315.2.b (Beginning Phase Scoring
// Step), 467–472 (Scoring, Hold, Conquer, the Final Point restriction, cleanup victory).
// Staged kernel: the parent promotes this file unchanged and only rewrites the board import below to
// `./battlefields.js`. Board rules are never re-implemented here; the board module is the single
// authority for locations, control, contested and engagements.
import { assertDuelBoard } from './battlefields.js';
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const STATE_FIELDS = ['playerIds', 'battlefieldLocationIds', 'victoryScore', 'turnNumber', 'players'];
const PLAYER_FIELDS = ['playerId', 'points', 'scoredBattlefieldLocationIds'];
const TIMING_FIELDS = ['phase', 'turnPlayerId', 'controlEstablishedForPlayerId', 'controlEstablishedLocationId'];
function check(condition, message) {
    if (!condition)
        throw new TypeError(`Invalid duel scoring state: ${message}`);
}
function range(condition, message) {
    if (!condition)
        throw new RangeError(`Duel scoring value out of range: ${message}`);
}
function record(value, fields, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), label);
    const keys = Reflect.ownKeys(value);
    check(keys.length === fields.length && fields.every(key => keys.includes(key)), `${label} keys`);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        check(descriptor && 'value' in descriptor, `${label} must not contain accessors`);
    }
    const prototype = Object.getPrototypeOf(value);
    check(prototype === Object.prototype || prototype === null, `${label} must be a plain object`);
    return value;
}
function list(value, count, label) {
    check(Array.isArray(value) && (count === null || value.length === count), label);
    check(Reflect.ownKeys(value).length === value.length + 1, `${label} extra keys or sparse entries`);
    for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, i);
        check(descriptor && 'value' in descriptor, `${label} sparse or accessor entry`);
    }
    return value;
}
function text(value, label) {
    check(typeof value === 'string' && value.trim().length > 0, label);
    return value;
}
function integer(value, label) {
    check(typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value), `${label} must be a safe integer`);
    return value;
}
function unique(values, label) {
    check(new Set(values).size === values.length, `${label} duplicate`);
}
function player(value, players, label) {
    const valueId = text(value, label);
    check(players.includes(valueId), `${label} unknown player`);
    return valueId;
}
function positiveScore(value, label) {
    const score = integer(value, label);
    range(score >= 1, `${label} must be a positive safe integer`);
    return score;
}
function count(value, label) {
    const number = integer(value, label);
    range(number >= 0, `${label} must not be negative`);
    return number;
}
/** Requires an already validated board; returns a fully validated, detached, mutable copy. */
function checkedScoring(input, board) {
    const value = record(input, STATE_FIELDS, 'scoring');
    const seats = board.playerIds;
    const fields = board.battlefields.map(field => field.locationId);
    const playerIds = list(value.playerIds, 2, 'scoring.playerIds').map((seat, i) => text(seat, `scoring.playerIds[${i}]`));
    check(playerIds.every((seat, i) => seat === seats[i]), 'playerIds must match the board seats in order');
    const battlefieldLocationIds = list(value.battlefieldLocationIds, 2, 'scoring.battlefieldLocationIds')
        .map((field, i) => text(field, `scoring.battlefieldLocationIds[${i}]`));
    unique(battlefieldLocationIds, 'scoring.battlefieldLocationIds');
    check(battlefieldLocationIds.every((field, i) => field === fields[i]), 'battlefieldLocationIds must match the board battlefields in order');
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
        check(ledger.every(field => battlefieldLocationIds.includes(field)), `scoring.players[${i}].scoredBattlefieldLocationIds must belong to the shared battlefields`);
        return { playerId, points, scoredBattlefieldLocationIds: ledger };
    });
    return { playerIds, battlefieldLocationIds, victoryScore, turnNumber, players };
}
function publicScoring(state) {
    return {
        playerIds: [...state.playerIds],
        battlefieldLocationIds: [...state.battlefieldLocationIds],
        victoryScore: state.victoryScore,
        turnNumber: state.turnNumber,
        players: state.players.map(seat => ({ playerId: seat.playerId, points: seat.points,
            scoredBattlefieldLocationIds: [...seat.scoredBattlefieldLocationIds] })),
    };
}
function scorerOf(state, playerId) {
    const scorer = state.players.find(seat => seat.playerId === playerId);
    check(scorer, `unknown scorer ${playerId}`);
    return scorer;
}
/** 194.3: the Victory Score is 8 by default; a mode or effect may pass another trusted value. */
export function createDuelScoring(board, victoryScore = 8) {
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
export function restoreDuelScoring(raw, board) {
    assertDuelBoard(board);
    return publicScoring(checkedScoring(raw, board));
}
/**
 * Advances to `turnNumber + 1` and clears both players' current-turn Score ledger (470).
 * Points and the Victory Score survive (194). Which player is the turn player, and any extra
 * turn, stay the outer executor's responsibility.
 */
export function beginDuelScoreTurn(state, board, nextTurnNumber) {
    assertDuelBoard(board);
    const current = checkedScoring(state, board);
    const next = integer(nextTurnNumber, 'nextTurnNumber');
    range(next === current.turnNumber + 1, 'nextTurnNumber must be exactly turnNumber + 1');
    current.turnNumber = next;
    for (const seat of current.players)
        seat.scoredBattlefieldLocationIds = [];
    return publicScoring(current);
}
function checkedTiming(input, state) {
    const value = record(input, TIMING_FIELDS, 'score timing');
    check(value.phase === 'beginning-scoring' || value.phase === 'other', 'score timing phase');
    const turnPlayerId = player(value.turnPlayerId, state.playerIds, 'score timing turnPlayerId');
    const establishedFor = value.controlEstablishedForPlayerId === null
        ? null : player(value.controlEstablishedForPlayerId, state.playerIds, 'score timing controlEstablishedForPlayerId');
    const establishedAt = value.controlEstablishedLocationId === null
        ? null : text(value.controlEstablishedLocationId, 'score timing controlEstablishedLocationId');
    check((establishedFor === null) === (establishedAt === null), 'score timing control event must be a complete pair');
    if (establishedAt !== null) {
        check(state.battlefieldLocationIds.includes(establishedAt), 'score timing controlEstablishedLocationId unknown battlefield');
    }
    return { phase: value.phase, turnPlayerId,
        controlEstablishedForPlayerId: establishedFor, controlEstablishedLocationId: establishedAt };
}
/**
 * 468–471: one Score per player per battlefield per turn across both methods. The caller's board
 * must already show the actor as current controller; Conquer additionally requires the canonical
 * outer control-established event. The Score ledger is written before the all-battlefields check
 * (471.1.b.1), otherwise the second Final Point battlefield could never be scored. Returned flags
 * are executor instructions: this primitive does not draw a card or resolve abilities.
 */
export function scoreDuelBattlefield(state, board, actor, locationId, method, timing) {
    assertDuelBoard(board);
    const current = checkedScoring(state, board);
    check(current.turnNumber >= 1, 'no Battlefield can be Scored on turn 0');
    const actorId = player(actor, current.playerIds, 'actor');
    const fieldId = text(locationId, 'locationId');
    check(current.battlefieldLocationIds.includes(fieldId), 'unknown battlefield location');
    check(method === 'hold' || method === 'conquer', 'method must be hold or conquer');
    const context = checkedTiming(timing, current);
    const field = board.battlefields.find(value => value.locationId === fieldId);
    check(field.controllerPlayerId === actorId, 'actor must currently control the battlefield');
    if (method === 'hold') {
        // 315.2.b / 469.2: only the Turn Player Holds, only in the canonical Scoring Step.
        check(context.phase === 'beginning-scoring', 'Hold requires the canonical beginning-scoring step');
        check(context.turnPlayerId === actorId, 'Hold requires the turn player');
    }
    else {
        // 469.1 / 471.1.b: the outer executor just established control; a raw client boolean may not
        // stand in for that trusted event.
        check(context.controlEstablishedForPlayerId === actorId && context.controlEstablishedLocationId === fieldId, 'Conquer requires the canonical control-established event for this battlefield');
    }
    const scorer = scorerOf(current, actorId);
    check(!scorer.scoredBattlefieldLocationIds.includes(fieldId), 'battlefield already scored this turn by this player');
    scorer.scoredBattlefieldLocationIds = [...scorer.scoredBattlefieldLocationIds, fieldId];
    const scoredEveryBattlefield = current.battlefieldLocationIds
        .every(entry => scorer.scoredBattlefieldLocationIds.includes(entry));
    let pointsGained = 1;
    let drawRequired = 0;
    if (method === 'conquer' && scorer.points >= current.victoryScore - 1 && !scoredEveryBattlefield) {
        // 471.1.b.1: the Final Point draw replaces the point but the Score still happened (471.2).
        pointsGained = 0;
        drawRequired = 1;
    }
    range(scorer.points + pointsGained <= MAX_SAFE, 'point total overflow');
    scorer.points += pointsGained;
    return { state: publicScoring(current), outcome: { playerId: actorId, locationId: fieldId,
            method: method, pointsGained, drawRequired, triggerScore: true,
            triggerMethod: method } };
}
/** 194.1.c/d: trusted ability or Burn Out point gain. No Score ledger entry, no Final Point limit. */
export function gainDuelPoints(state, board, actor, amount) {
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
export function loseDuelPoints(state, board, actor, amount) {
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
export function setDuelVictoryScoreForEffect(state, board, newVictoryScore) {
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
export function getDuelWinnerAtCleanup(state, board) {
    assertDuelBoard(board);
    const current = checkedScoring(state, board);
    const leader = current.players.find(seat => seat.points >= current.victoryScore &&
        current.players.every(other => other === seat || seat.points > other.points));
    return leader ? leader.playerId : null;
}
/** Whitelist projection: copies exactly the public scoring fields and never spreads unknown state. */
export function projectPublicDuelScoring(state, board) {
    assertDuelBoard(board);
    return publicScoring(checkedScoring(state, board));
}

import { assertDuelBoard } from './battlefields.js';
import { gainDuelPoints, getDuelWinnerAtCleanup, restoreDuelScoring, } from './scoring.js';
const ZONES_FIELDS = ['hand', 'mainDeck', 'trash'];
const CARD_FIELDS = ['uid', 'cardId'];
const CURSOR_FIELDS = ['actor', 'remainingCount', 'burnoutIndex', 'step'];
const FIRST_RESOLUTION_FIELDS = ['kind', 'scoring'];
const FIRST_OPTIONS_FIELDS = ['firstBurnoutResolution'];
const INTERVENTION_OPTIONS_FIELDS = ['interventionComplete'];
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
function check(condition, message) {
    if (!condition)
        throw new TypeError(`Invalid duel Draw/Burn Out state: ${message}`);
}
function range(condition, message) {
    if (!condition)
        throw new RangeError(`Duel Draw/Burn Out value out of range: ${message}`);
}
function record(value, fields, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), label);
    const keys = Reflect.ownKeys(value);
    check(keys.length === fields.length && fields.every(field => keys.includes(field)), `${label} keys`);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        check(descriptor && 'value' in descriptor, `${label} must not contain accessors`);
    }
    const prototype = Object.getPrototypeOf(value);
    check(prototype === Object.prototype || prototype === null, `${label} must be a plain object`);
    return value;
}
function list(value, label) {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, label);
    check(Reflect.ownKeys(value).length === value.length + 1, `${label} extra keys or sparse entries`);
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        check(descriptor && 'value' in descriptor, `${label}[${index}] accessor or hole`);
    }
    return value;
}
function text(value, label) {
    check(typeof value === 'string' && value.trim().length > 0, label);
    return value;
}
function safeInteger(value, label) {
    check(typeof value === 'number' && Number.isInteger(value), `${label} must be an integer`);
    range(Number.isSafeInteger(value), `${label} must be a safe integer`);
    return value;
}
function nonNegative(value, label) {
    const result = safeInteger(value, label);
    range(result >= 0, `${label} must not be negative`);
    return result;
}
function unique(values, label) {
    check(new Set(values).size === values.length, `${label} duplicate`);
}
function boolean(value, label) {
    check(typeof value === 'boolean', `${label} must be boolean`);
    return value;
}
function card(value, label) {
    const item = record(value, CARD_FIELDS, label);
    return { uid: text(item.uid, `${label}.uid`), cardId: text(item.cardId, `${label}.cardId`) };
}
function copyCard(value) {
    return { uid: value.uid, cardId: value.cardId };
}
/** Parse and detach all private zones. Every UID is a single game object, never a shared alias. */
function checkedZones(input, board) {
    const value = record(input, ZONES_FIELDS, 'zones');
    const references = new Set();
    const parseZone = (raw, label) => list(raw, label).map((entry, index) => {
        check(entry !== null && typeof entry === 'object', `${label}[${index}] must be an object`);
        const reference = entry;
        check(!references.has(reference), `${label}[${index}] aliases another card record`);
        references.add(reference);
        return card(entry, `${label}[${index}]`);
    });
    const zones = {
        hand: parseZone(value.hand, 'zones.hand'),
        mainDeck: parseZone(value.mainDeck, 'zones.mainDeck'),
        trash: parseZone(value.trash, 'zones.trash'),
    };
    const cards = [...zones.hand, ...zones.mainDeck, ...zones.trash];
    unique(cards.map(entry => entry.uid), 'zone card UID');
    // Card UIDs are game objects. They may not silently collide with board or player identity.
    const boardIds = new Set([
        ...board.playerIds,
        ...board.bases.map(base => base.locationId),
        ...board.battlefields.flatMap(field => [field.locationId, field.instanceId]),
        ...board.units.map(unit => unit.objectId),
    ]);
    check(cards.every(entry => !boardIds.has(entry.uid)), 'card UID collides with board/player identity');
    return zones;
}
function publicZones(zones) {
    return {
        hand: zones.hand.map(copyCard),
        mainDeck: zones.mainDeck.map(copyCard),
        trash: zones.trash.map(copyCard),
    };
}
function validateRandomIndex(randomIndex) {
    check(randomIndex === undefined || typeof randomIndex === 'function', 'randomIndex');
}
function randomIndex(random, bound) {
    const result = random(bound);
    check(typeof result === 'number' && Number.isSafeInteger(result) && result >= 0 && result < bound, `randomIndex(${bound}) result`);
    return result;
}
function shuffled(cards, random) {
    const result = cards.map(copyCard);
    if (result.length < 2)
        return result;
    check(typeof random === 'function', 'randomIndex is required to Recycle multiple cards');
    for (let index = result.length - 1; index > 0; index -= 1) {
        const other = randomIndex(random, index + 1);
        [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
}
function boardScore(boardInput, scoringInput) {
    assertDuelBoard(boardInput);
    return { board: boardInput, scoring: restoreDuelScoring(scoringInput, boardInput) };
}
function actorAndOpponent(actorInput, board, scoring) {
    const actor = text(actorInput, 'actor');
    check(board.playerIds.includes(actor), 'actor is not a board player');
    check(scoring.playerIds.length === 2 && scoring.playerIds.every((playerId, index) => playerId === board.playerIds[index]), 'scoring seats must match board seats');
    const opponentPlayerId = board.playerIds.find(playerId => playerId !== actor);
    check(opponentPlayerId !== undefined, 'Duel must have exactly one opponent');
    return { actor, opponentPlayerId };
}
function cursor(value, board, scoring) {
    const item = record(value, CURSOR_FIELDS, 'draw cursor');
    const actor = text(item.actor, 'cursor.actor');
    check(board.playerIds.includes(actor), 'cursor actor unknown');
    check(scoring.playerIds.includes(actor), 'cursor/score actor mismatch');
    const remainingCount = nonNegative(item.remainingCount, 'cursor.remainingCount');
    const burnoutIndex = safeInteger(item.burnoutIndex, 'cursor.burnoutIndex');
    range(burnoutIndex >= 1, 'cursor.burnoutIndex must be at least one');
    check(item.step === 'awaiting-first-resolution' || item.step === 'awaiting-intervention', 'cursor.step');
    check(remainingCount > 0, 'cursor.remainingCount must be positive while pending');
    check(item.step !== 'awaiting-first-resolution' || burnoutIndex === 1, 'only Burn Out point one may await prevention/replacement');
    return { actor, remainingCount, burnoutIndex, step: item.step };
}
function makeCursor(actor, remainingCount, burnoutIndex, step) {
    return { actor, remainingCount, burnoutIndex, step };
}
function makeTask(cursorValue, opponentPlayerId, canPreventOrReplace) {
    return {
        kind: 'burnout-point', actor: cursorValue.actor, opponentPlayerId,
        burnoutIndex: cursorValue.burnoutIndex, remainingCount: cursorValue.remainingCount,
        canPreventOrReplace,
    };
}
function makeIntervention(cursorValue) {
    return {
        kind: 'burnout-intervention', actor: cursorValue.actor,
        burnoutIndex: cursorValue.burnoutIndex, remainingCount: cursorValue.remainingCount,
    };
}
function nextBurnoutIndex(current) {
    range(current < MAX_SAFE, 'burnoutIndex overflow');
    return current + 1;
}
/** Perform only the available portion, then Recycle before opening exactly one Burn Out point. */
function attemptDraw(zones, requested, random) {
    if (requested === 0)
        return { zones, remainingCount: 0, drawnCount: 0, recycledCount: 0 };
    const available = Math.min(requested, zones.mainDeck.length);
    const drawn = zones.mainDeck.slice(0, available).map(copyCard);
    zones.hand = [...zones.hand.map(copyCard), ...drawn];
    zones.mainDeck = zones.mainDeck.slice(available).map(copyCard);
    if (available === requested) {
        return { zones, remainingCount: 0, drawnCount: available, recycledCount: 0 };
    }
    // 431.2.a has already drawn all cards possible. 431.2.b Recycles the entire Trash into the
    // now-empty Main Deck. The point is opened before any of that newly recycled deck is drawn.
    const recycled = shuffled(zones.trash, random);
    zones.mainDeck = recycled;
    zones.trash = [];
    return {
        zones,
        remainingCount: requested - available,
        drawnCount: available,
        recycledCount: recycled.length,
    };
}
function completeResult(zones, scoring, drawnCount, recycledCount) {
    return {
        zones: publicZones(zones), scoring, cursor: null, status: 'complete', task: null,
        intervention: null, winner: null, drawnCount, recycledCount,
    };
}
function pendingFirstResult(zones, scoring, actor, opponentPlayerId, remainingCount, drawnCount, recycledCount) {
    const pending = makeCursor(actor, remainingCount, 1, 'awaiting-first-resolution');
    return {
        zones: publicZones(zones), scoring, cursor: pending, status: 'awaiting-first-resolution',
        task: makeTask(pending, opponentPlayerId, true), intervention: null, winner: null, drawnCount, recycledCount,
    };
}
function interventionResult(zones, scoring, continuation, drawnCount, recycledCount) {
    return {
        zones: publicZones(zones), scoring, cursor: continuation, status: 'awaiting-intervention',
        task: null, intervention: makeIntervention(continuation), winner: null, drawnCount, recycledCount,
    };
}
function checkedFirstResolution(value, current, board) {
    const item = record(value, FIRST_RESOLUTION_FIELDS, 'firstBurnoutResolution');
    check(item.kind === 'prevented' || item.kind === 'replaced' || item.kind === 'scored', 'firstBurnoutResolution.kind');
    const resolved = restoreDuelScoring(item.scoring, board);
    // A trusted replacement may change actual point ledgers, but this one result cannot quietly replace
    // the board seats, turn, or victory threshold with a second authority.
    check(resolved.victoryScore === current.victoryScore, 'first resolution changed victoryScore');
    check(resolved.turnNumber === current.turnNumber, 'first resolution changed turnNumber');
    return resolved;
}
function checkedFirstOptions(value, current, board) {
    const options = record(value, FIRST_OPTIONS_FIELDS, 'first Draw resume options');
    return checkedFirstResolution(options.firstBurnoutResolution, current, board);
}
function checkedInterventionOptions(value) {
    const options = record(value, INTERVENTION_OPTIONS_FIELDS, 'intervention resume options');
    check(boolean(options.interventionComplete, 'interventionComplete'), 'interventionComplete must be true');
}
/**
 * Start one trusted Draw instruction. The operation draws normally until either complete or the
 * first Burn Out point is opened. It never resolves that point in the same call.
 */
export function startDuelDraw(zonesInput, boardInput, scoringInput, actorInput, countInput, randomIndex) {
    validateRandomIndex(randomIndex);
    const { board, scoring } = boardScore(boardInput, scoringInput);
    const zones = checkedZones(zonesInput, board);
    const { actor, opponentPlayerId } = actorAndOpponent(actorInput, board, scoring);
    const count = nonNegative(countInput, 'count');
    const attempt = attemptDraw(zones, count, randomIndex);
    if (attempt.remainingCount === 0)
        return completeResult(attempt.zones, scoring, attempt.drawnCount, attempt.recycledCount);
    return pendingFirstResult(attempt.zones, scoring, actor, opponentPlayerId, attempt.remainingCount, attempt.drawnCount, attempt.recycledCount);
}
/**
 * Resume one cursor step. A first point accepts exactly one trusted actual resolution. A subsequent
 * point accepts only the explicit outer intervention boundary, then performs one draw attempt and,
 * if needed, applies exactly one unpreventable point. There is intentionally no point-settling loop.
 */
export function resumeDuelDraw(zonesInput, boardInput, scoringInput, cursorInput, optionsInput, randomIndex) {
    validateRandomIndex(randomIndex);
    const { board, scoring } = boardScore(boardInput, scoringInput);
    const zones = checkedZones(zonesInput, board);
    const continuation = cursor(cursorInput, board, scoring);
    check(continuation.step === 'awaiting-first-resolution' || continuation.step === 'awaiting-intervention', 'unsupported cursor step');
    if (continuation.step === 'awaiting-first-resolution') {
        const resolved = checkedFirstOptions(optionsInput, scoring, board);
        const next = makeCursor(continuation.actor, continuation.remainingCount, continuation.burnoutIndex, 'awaiting-intervention');
        // The first point is deliberately not checked for immediate victory. Cleanup belongs outside.
        return interventionResult(zones, resolved, next, 0, 0);
    }
    checkedInterventionOptions(optionsInput);
    const attempt = attemptDraw(zones, continuation.remainingCount, randomIndex);
    if (attempt.remainingCount === 0) {
        return completeResult(attempt.zones, scoring, attempt.drawnCount, attempt.recycledCount);
    }
    const index = nextBurnoutIndex(continuation.burnoutIndex);
    const pointCursor = makeCursor(continuation.actor, attempt.remainingCount, index, 'awaiting-intervention');
    // 431.3.b: after point one, prevention/replacement is impossible. This call applies exactly one
    // point and then returns a boundary before another draw attempt.
    const opponentPlayerId = board.playerIds.find(playerId => playerId !== continuation.actor);
    check(opponentPlayerId !== undefined, 'Duel must have exactly one opponent');
    const gained = gainDuelPoints(scoring, board, opponentPlayerId, 1);
    const winner = getDuelWinnerAtCleanup(gained.state, board) === opponentPlayerId
        ? opponentPlayerId : null;
    if (winner !== null) {
        return {
            zones: publicZones(attempt.zones), scoring: gained.state, cursor: null, status: 'winner',
            task: makeTask(pointCursor, opponentPlayerId, false), intervention: null, winner,
            drawnCount: attempt.drawnCount, recycledCount: attempt.recycledCount,
        };
    }
    return {
        zones: publicZones(attempt.zones), scoring: gained.state, cursor: pointCursor,
        status: 'awaiting-intervention', task: makeTask(pointCursor, opponentPlayerId, false),
        intervention: makeIntervention(pointCursor), winner: null,
        drawnCount: attempt.drawnCount, recycledCount: attempt.recycledCount,
    };
}
/** Descriptive alias for callers that name the instruction by its action. */
export const drawDuelCards = startDuelDraw;
/** Descriptive alias for callers that name continuation as a step. */
export const continueDuelDraw = resumeDuelDraw;

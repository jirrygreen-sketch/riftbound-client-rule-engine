// CR v1.4: 143.4 (units enter the Board exhausted), 144.1–144.4 (Standard Move: Main Phase, Open
// State, no ongoing Showdown/Combat, exhausting is the cost, simultaneous multi-unit group move,
// destination restrictions), 312 (Priority gates whose Discretionary Action this is), 420.3 (the
// Standard Move IS a Discretionary Action — unlike a Move Effect, which 420.2 makes a Limited
// Action), 447 (Origin/Destination), 810 + 144.4.c (Ganking adds the Battlefield→Battlefield
// option to the Standard Move).
//
// Internal duel kernel. It re-implements no board rule and introduces no public command or IR
// vocabulary: the accepted `DuelBoard` is the ONLY authority for locations, control
// and contested, and the trusted readiness records only describe per-unit state / already-derived
// keywords (they carry no location and no controller at all).
//
// Boundary of this helper (do not over-claim): it validates and performs exactly ONE Standard Move
// group action. It resolves no triggered ability, runs no cleanup, and establishes no Conquer,
// Showdown, Combat or Recall. The caller must queue Move triggers and then run one Open cleanup.
import { assertDuelBoard, relocateDuelUnit, restoreDuelBoard } from './battlefields.js';
const READINESS_FIELDS = ['objectId', 'readied', 'hasGanking'];
const REQUEST_FIELDS = ['actor', 'unitUIDs', 'destinationLocationId', 'timing'];
const TIMING_FIELDS = ['phase', 'stateOpen', 'turnPlayerId', 'priorityPlayerId'];
function check(condition, message) {
    if (!condition)
        throw new TypeError(`Invalid duel standard move: ${message}`);
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
function player(value, board, label) {
    const valueId = text(value, label);
    check(board.playerIds.includes(valueId), `${label} unknown player`);
    return valueId;
}
function unique(values, label) {
    check(new Set(values).size === values.length, `${label} duplicate`);
}
function boolean(value, label) {
    check(typeof value === 'boolean', `${label} must be boolean`);
    return value;
}
/** Exact correspondence with `board.units`; returns detached, validated records in input order. */
function checkedReadiness(board, input) {
    const raw = list(input, null, 'readiness').map((value, i) => {
        const item = record(value, READINESS_FIELDS, `readiness[${i}]`);
        return {
            objectId: text(item.objectId, `readiness[${i}].objectId`),
            readied: boolean(item.readied, `readiness[${i}].readied`),
            hasGanking: boolean(item.hasGanking, `readiness[${i}].hasGanking`),
        };
    });
    unique(raw.map(entry => entry.objectId), 'readiness objectId');
    const boardIds = new Set(board.units.map(unit => unit.objectId));
    for (const entry of raw)
        check(boardIds.has(entry.objectId), `readiness unknown unit ${entry.objectId}`);
    check(raw.length === boardIds.size, 'readiness must hold exactly one record per board unit');
    return raw;
}
function checkedRequest(board, input) {
    const value = record(input, REQUEST_FIELDS, 'request');
    const actor = player(value.actor, board, 'request.actor');
    const unitUIDs = list(value.unitUIDs, null, 'request.unitUIDs')
        .map((raw, i) => text(raw, `request.unitUIDs[${i}]`));
    check(unitUIDs.length > 0, 'request.unitUIDs must not be empty');
    unique(unitUIDs, 'request.unitUIDs');
    const boardIds = new Set(board.units.map(unit => unit.objectId));
    for (const unitId of unitUIDs)
        check(boardIds.has(unitId), `request.unitUIDs unknown unit ${unitId}`);
    const destinationLocationId = text(value.destinationLocationId, 'request.destinationLocationId');
    const timingValue = record(value.timing, TIMING_FIELDS, 'request.timing');
    const phase = timingValue.phase;
    check(phase === 'main' || phase === 'other', 'request.timing.phase');
    const stateOpen = boolean(timingValue.stateOpen, 'request.timing.stateOpen');
    const turnPlayerId = player(timingValue.turnPlayerId, board, 'request.timing.turnPlayerId');
    const priorityPlayerId = timingValue.priorityPlayerId === null
        ? null : player(timingValue.priorityPlayerId, board, 'request.timing.priorityPlayerId');
    return { actor, unitUIDs, destinationLocationId, timing: { phase, stateOpen, turnPlayerId, priorityPlayerId } };
}
/** Validates a readiness snapshot against the board without copying it. */
export function assertDuelReadiness(board, input) {
    assertDuelBoard(board);
    checkedReadiness(board, input);
}
/** Validates and returns a detached readiness copy with the same record order. */
export function restoreDuelReadiness(board, snapshot) {
    assertDuelBoard(board);
    return checkedReadiness(board, snapshot).map(entry => ({ ...entry }));
}
/**
 * 144: performs one simultaneous Standard Move group action.
 *
 * Every selected unit is validated up front (exists, controlled by the actor, readied, no duplicate
 * UID, origin ≠ destination, a legal origin/destination pair, and Ganking for Battlefield→
 * Battlefield). Ownership is never consulted: a unit always moves with its controller, so a unit
 * owned by another player still moves between its controller's base and the shared battlefields.
 * Only after the whole group validates are the board and readiness copied; the selected units are
 * exhausted together and then relocated, and no cleanup runs in between.
 *
 * Out of scope here (outer engine): Move triggers, cleanup/Recall, Conquer/Showdown/Combat,
 * multi-player or team destination restrictions (144.4.a.1 / 447.2) and any occupancy cap.
 */
export function moveDuelUnitsStandard(board, readiness, request) {
    assertDuelBoard(board);
    const records = checkedReadiness(board, readiness);
    const { actor, unitUIDs, destinationLocationId, timing } = checkedRequest(board, request);
    // 144.1.a/144.1.b: only an Open Main Phase may hold this action.
    check(timing.phase === 'main', 'timing phase must be main');
    check(timing.stateOpen, 'timing state must be Open');
    // 420.3 + 312.1: the Standard Move is a Discretionary Action, so only the player with Priority may
    // take it; 312.2.a gives Priority to the turn player in a Neutral Open Main Phase, so the actor
    // must be both the turn player and the Priority holder.
    check(timing.turnPlayerId === actor, 'the actor is not the turn player of this discretionary move');
    check(timing.priorityPlayerId === actor, 'the actor does not hold Priority for this discretionary move');
    // 144.1.c: no ongoing Showdown or Combat anywhere on the board.
    check(board.battlefields.every(field => field.showdown !== 'active' && field.combat !== 'active'), 'an active Showdown or Combat is ongoing');
    const unitsById = new Map(board.units.map(unit => [unit.objectId, unit]));
    const readinessById = new Map(records.map(entry => [entry.objectId, entry]));
    const basesById = new Map(board.bases.map(base => [base.locationId, base]));
    const fieldsById = new Map(board.battlefields.map(field => [field.locationId, field]));
    const destinationBase = basesById.get(destinationLocationId);
    const destinationField = fieldsById.get(destinationLocationId);
    check(destinationBase !== undefined || destinationField !== undefined, `unknown destination ${destinationLocationId}`);
    // 144.4.a/144.4.b: a base destination is only ever the actor's own base.
    if (destinationBase)
        check(destinationBase.ownerPlayerId === actor, 'destination is another player’s base');
    for (const unitId of unitUIDs) {
        const unit = unitsById.get(unitId);
        check(unit.controllerPlayerId === actor, `unit ${unitId} is not controlled by the actor`);
        check(readinessById.get(unitId).readied, `unit ${unitId} is not readied to move`);
        check(unit.locationId !== destinationLocationId, `unit ${unitId} is already at the destination`);
        if (basesById.has(unit.locationId)) {
            // 144.4.a: base → battlefield. The battlefield is shared, so no ownership check applies.
            check(destinationField !== undefined, `unit ${unitId} may only leave a base for a battlefield`);
        }
        else {
            // 144.4.b/144.4.c: battlefield → own base, or battlefield → battlefield with Ganking.
            check(destinationBase !== undefined || readinessById.get(unitId).hasGanking, `unit ${unitId} needs Ganking to move battlefield to battlefield`);
        }
    }
    // 144.2/144.3.c: the exhaustion cost is paid simultaneously for the whole group.
    const selected = new Set(unitUIDs);
    const nextReadiness = records.map(entry => ({
        objectId: entry.objectId,
        readied: selected.has(entry.objectId) ? false : entry.readied,
        hasGanking: entry.hasGanking,
    }));
    const origins = new Map(unitUIDs.map(unitId => [unitId, unitsById.get(unitId).locationId]));
    let nextBoard = restoreDuelBoard(board);
    const events = [];
    for (const unitId of unitUIDs) {
        nextBoard = relocateDuelUnit(nextBoard, unitId, destinationLocationId);
        events.push({
            objectId: unitId, actor,
            fromLocationId: origins.get(unitId), toLocationId: destinationLocationId,
        });
    }
    // Post-conditions: the board is valid and readiness still matches it exactly.
    assertDuelBoard(nextBoard);
    checkedReadiness(nextBoard, nextReadiness);
    return {
        board: nextBoard,
        readiness: nextReadiness,
        group: {
            kind: 'standard-move',
            actor,
            destinationLocationId,
            objectIds: [...unitUIDs],
            exhaustedCount: unitUIDs.length,
            events,
            requiresMoveTriggers: true,
            requiresOpenCleanup: true,
        },
    };
}

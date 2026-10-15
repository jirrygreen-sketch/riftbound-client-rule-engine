function check(condition, message) {
    if (!condition)
        throw new TypeError(`Invalid duel battlefield state: ${message}`);
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
function id(value, label) {
    check(typeof value === 'string' && value.trim().length > 0, label);
    return value;
}
function player(value, players, label) {
    const valueId = id(value, label);
    check(players.includes(valueId), `${label} unknown player`);
    return valueId;
}
function nullablePlayer(value, players, label) {
    return value === null ? null : player(value, players, label);
}
function unique(values, label) {
    check(new Set(values).size === values.length, `${label} duplicate`);
}
function entry(value, label) {
    const item = record(value, ['instanceId', 'cardId'], label);
    return { instanceId: id(item.instanceId, `${label}.instanceId`), cardId: id(item.cardId, `${label}.cardId`) };
}
function baseId(playerId) { return JSON.stringify(['duel-base', playerId]); }
function battlefieldId(instanceId) { return JSON.stringify(['duel-battlefield', instanceId]); }
/** The injected index source is called once per fully validated seat, in seat order. */
export function selectDuelBattlefields(seats, randomIndex) {
    check(typeof randomIndex === 'function', 'randomIndex');
    const data = list(seats, 2, 'seats').map((raw, i) => {
        const seat = record(raw, ['playerId', 'battlefields'], `seats[${i}]`);
        const playerId = id(seat.playerId, `seats[${i}].playerId`);
        const battlefields = list(seat.battlefields, 3, `seats[${i}].battlefields`)
            .map((value, j) => entry(value, `seats[${i}].battlefields[${j}]`));
        return { playerId, battlefields };
    });
    unique(data.map(seat => seat.playerId), 'playerId');
    unique(data.flatMap(seat => seat.battlefields.map(field => field.instanceId)), 'instanceId');
    // CR 103.4.c: a seat cannot hold the same battlefield printing twice. Canonical-name
    // uniqueness is owned by the upstream constructed validator; this helper only sees printings.
    data.forEach((seat, i) => unique(seat.battlefields.map(field => field.cardId), `seats[${i}].battlefields cardId`));
    const indices = data.map(() => {
        const index = randomIndex(3);
        check(typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 3, 'randomIndex result must be 0..2');
        return index;
    });
    return {
        selected: data.map((seat, i) => ({ playerId: seat.playerId, ...seat.battlefields[indices[i]] })),
        removedByPlayer: data.map((seat, i) => ({ playerId: seat.playerId,
            battlefields: seat.battlefields.filter((_, j) => j !== indices[i]) })),
    };
}
function checkedSelection(input) {
    const selection = record(input, ['selected', 'removedByPlayer'], 'selection');
    const selected = list(selection.selected, 2, 'selected').map((value, i) => {
        const item = record(value, ['playerId', 'instanceId', 'cardId'], `selected[${i}]`);
        return { playerId: id(item.playerId, 'selected.playerId'),
            instanceId: id(item.instanceId, 'selected.instanceId'), cardId: id(item.cardId, 'selected.cardId') };
    });
    const removedByPlayer = list(selection.removedByPlayer, 2, 'removedByPlayer').map((value, i) => {
        const item = record(value, ['playerId', 'battlefields'], `removedByPlayer[${i}]`);
        return { playerId: id(item.playerId, 'removedByPlayer.playerId'),
            battlefields: list(item.battlefields, 2, 'removedByPlayer.battlefields')
                .map((field, j) => entry(field, `removedByPlayer[${i}].battlefields[${j}]`)) };
    });
    unique(selected.map(field => field.playerId), 'selected player');
    check(removedByPlayer.every((seat, i) => seat.playerId === selected[i].playerId), 'removedByPlayer seat order');
    unique([...selected.map(field => field.instanceId),
        ...removedByPlayer.flatMap(seat => seat.battlefields.map(field => field.instanceId))], 'selection instanceId');
    // CR 103.4.c: each seat's selected + removed printings must stay distinct. The two seats may
    // share a printing, so this is per-seat, never a global cardId uniqueness check.
    removedByPlayer.forEach((seat, i) => unique([selected[i].cardId, ...seat.battlefields.map(field => field.cardId)], `selection seat ${i} cardId`));
    return { selected, removedByPlayer };
}
/** The private removed cards are intentionally not stored on the public board. */
export function createDuelBoard(selection) {
    const { selected } = checkedSelection(selection);
    const playerIds = selected.map(field => field.playerId);
    const bases = playerIds.map(ownerPlayerId => ({ locationId: baseId(ownerPlayerId), ownerPlayerId, occupancy: [] }));
    const battlefields = selected.map(field => ({
        locationId: battlefieldId(field.instanceId), instanceId: field.instanceId, cardId: field.cardId,
        ownerPlayerId: field.playerId, controllerPlayerId: null, contested: false,
        contestingPlayerId: null, showdown: 'none', combat: 'none', occupancy: [],
    }));
    const board = { playerIds, bases, battlefields, units: [] };
    assertDuelBoard(board);
    return board;
}
/** Strict shape + relational invariants; pending cleanup is not itself an error. */
export function assertDuelBoard(input) {
    const board = record(input, ['playerIds', 'bases', 'battlefields', 'units'], 'board');
    const players = list(board.playerIds, 2, 'playerIds').map((value, i) => id(value, `playerIds[${i}]`));
    unique(players, 'playerIds');
    const occupied = new Map();
    const validateOccupancy = (value, locationId, label) => {
        const ids = list(value, null, `${label}.occupancy`).map((unit, i) => id(unit, `${label}.occupancy[${i}]`));
        for (const unitId of ids) {
            check(!occupied.has(unitId), `duplicate occupancy for ${unitId}`);
            occupied.set(unitId, locationId);
        }
    };
    const bases = list(board.bases, 2, 'bases').map((raw, i) => {
        const base = record(raw, ['locationId', 'ownerPlayerId', 'occupancy'], `bases[${i}]`);
        const owner = player(base.ownerPlayerId, players, `bases[${i}].ownerPlayerId`);
        const locationId = id(base.locationId, 'base.locationId');
        check(locationId === baseId(owner), 'base location identity');
        validateOccupancy(base.occupancy, locationId, `bases[${i}]`);
        return { owner, locationId };
    });
    unique(bases.map(base => base.owner), 'base owner');
    const fieldCardIds = [];
    let activeEngagements = 0;
    const fields = list(board.battlefields, 2, 'battlefields').map((raw, i) => {
        const field = record(raw, ['locationId', 'instanceId', 'cardId', 'ownerPlayerId',
            'controllerPlayerId', 'contested', 'contestingPlayerId', 'showdown', 'combat', 'occupancy'], `battlefields[${i}]`);
        const owner = player(field.ownerPlayerId, players, 'battlefield.ownerPlayerId');
        const instanceId = id(field.instanceId, 'battlefield.instanceId');
        fieldCardIds.push(id(field.cardId, 'battlefield.cardId'));
        const locationId = id(field.locationId, 'battlefield.locationId');
        check(locationId === battlefieldId(instanceId), 'battlefield location identity');
        const controller = nullablePlayer(field.controllerPlayerId, players, 'battlefield.controllerPlayerId');
        const contender = nullablePlayer(field.contestingPlayerId, players, 'battlefield.contestingPlayerId');
        check(typeof field.contested === 'boolean' && field.contested === (contender !== null), 'contested and contestingPlayerId');
        check(contender === null || contender !== field.controllerPlayerId, 'contesting player already controls battlefield');
        check(field.showdown === 'none' || field.showdown === 'staged' || field.showdown === 'active', 'showdown status');
        check(field.combat === 'none' || field.combat === 'staged' || field.combat === 'active', 'combat status');
        check(field.showdown !== 'none' || field.combat === 'none', 'combat needs showdown');
        check(field.combat !== 'active' || field.showdown === 'active', 'active combat needs active showdown');
        check(field.showdown === 'none' || field.contested, 'showdown needs contested battlefield');
        if (field.showdown === 'active' || field.combat === 'active')
            activeEngagements++;
        validateOccupancy(field.occupancy, locationId, `battlefields[${i}]`);
        return { owner, instanceId, locationId, controller, contested: field.contested };
    });
    unique(fields.map(field => field.owner), 'battlefield owner');
    unique(fields.map(field => field.instanceId), 'battlefield instanceId');
    check(activeEngagements <= 1, 'simultaneous active engagements at different battlefields');
    unique([...bases.map(base => base.locationId), ...fields.map(field => field.locationId)], 'locationId');
    const locations = new Set([...bases.map(base => base.locationId), ...fields.map(field => field.locationId)]);
    check(fieldCardIds.every(cardId => !locations.has(cardId)), 'cardId collides with locationId');
    const units = list(board.units, null, 'units').map((raw, i) => {
        const unit = record(raw, ['objectId', 'controllerPlayerId', 'locationId'], `units[${i}]`);
        const objectId = id(unit.objectId, 'unit.objectId');
        const controller = player(unit.controllerPlayerId, players, 'unit.controllerPlayerId');
        const locationId = id(unit.locationId, 'unit.locationId');
        check(locations.has(locationId), `unit ${objectId} unknown location`);
        check(occupied.get(objectId) === locationId, `unit ${objectId} occupancy mismatch`);
        const base = bases.find(value => value.locationId === locationId);
        check(!base || base.owner === controller, `unit ${objectId} at another player's base`);
        return { objectId, controller, locationId };
    });
    unique(units.map(unit => unit.objectId), 'unit objectId');
    check(occupied.size === units.length, 'occupancy contains unknown units');
    for (const { objectId } of units) {
        check(!locations.has(objectId) && !fields.some(field => field.instanceId === objectId), 'unit objectId collides with location/game object');
    }
    // CR v1.4 190.3.a: a unit that moves or otherwise becomes present where it does not already
    // control immediately applies contested. So an uncontested battlefield may only hold units of
    // its own controller, and an uncontrolled battlefield must be empty. This deliberately does
    // NOT require a controlled field to hold a unit or a contested field to hold the contender:
    // an empty controlled field and a departed-contender field are valid pending-cleanup states.
    for (const field of fields) {
        if (field.contested)
            continue;
        const present = units.filter(unit => unit.locationId === field.locationId);
        check(field.controller !== null || present.length === 0, `uncontested battlefield ${field.locationId} has units but no controller`);
        check(present.every(unit => unit.controller === field.controller), `uncontested battlefield ${field.locationId} holds a unit not controlled by its controller`);
    }
}
/** Restore checks the full persisted state and returns completely detached values. */
export function restoreDuelBoard(snapshot) {
    assertDuelBoard(snapshot);
    return {
        playerIds: [...snapshot.playerIds],
        bases: snapshot.bases.map(base => ({ locationId: base.locationId, ownerPlayerId: base.ownerPlayerId,
            occupancy: [...base.occupancy] })),
        battlefields: snapshot.battlefields.map(field => ({
            locationId: field.locationId, instanceId: field.instanceId, cardId: field.cardId,
            ownerPlayerId: field.ownerPlayerId, controllerPlayerId: field.controllerPlayerId,
            contested: field.contested, contestingPlayerId: field.contestingPlayerId,
            showdown: field.showdown, combat: field.combat, occupancy: [...field.occupancy],
        })),
        units: snapshot.units.map(unit => ({ objectId: unit.objectId, controllerPlayerId: unit.controllerPlayerId,
            locationId: unit.locationId })),
    };
}
function copyBoard(board) { return restoreDuelBoard(board); }
function getLocation(board, locationId) {
    const location = [...board.bases, ...board.battlefields].find(value => value.locationId === locationId);
    check(location, `unknown location ${locationId}`);
    return location;
}
function getField(board, locationId) {
    const field = board.battlefields.find(value => value.locationId === locationId);
    check(field, `unknown battlefield location ${locationId}`);
    return field;
}
function getUnit(board, objectId) {
    const unit = board.units.find(value => value.objectId === objectId);
    check(unit, `unknown unit ${objectId}`);
    return unit;
}
function occupancyOf(board, locationId) {
    return getLocation(board, locationId).occupancy;
}
function enter(board, unit, locationId) {
    const location = getLocation(board, locationId);
    if ('instanceId' in location) {
        if (!location.contested && location.controllerPlayerId !== unit.controllerPlayerId) {
            location.contested = true;
            location.contestingPlayerId = unit.controllerPlayerId;
        }
    }
    else {
        check(location.ownerPlayerId === unit.controllerPlayerId, 'unit cannot enter another player’s base');
    }
    location.occupancy.push(unit.objectId);
    unit.locationId = locationId;
}
function commit(board) { assertDuelBoard(board); return board; }
/** Internal placement, NOT an authorized standard Move/Play operation. */
export function placeDuelUnit(board, input) {
    const state = copyBoard(board);
    const value = record(input, ['objectId', 'controllerPlayerId', 'locationId'], 'placement');
    const objectId = id(value.objectId, 'placement.objectId');
    const controllerPlayerId = player(value.controllerPlayerId, state.playerIds, 'placement.controllerPlayerId');
    const locationId = id(value.locationId, 'placement.locationId');
    check(!state.units.some(unit => unit.objectId === objectId), 'unit already exists');
    check(!state.battlefields.some(field => field.instanceId === objectId) &&
        ![...state.bases, ...state.battlefields].some(location => location.locationId === objectId), 'unit identity collides with game object/location');
    const unit = { objectId, controllerPlayerId, locationId };
    enter(state, unit, locationId);
    state.units.push(unit);
    return commit(state);
}
/** Internal relocation only; no exhaustion, timing, capacity, triggers or recall rules. */
export function relocateDuelUnit(board, objectId, toLocationId) {
    const state = copyBoard(board);
    const unit = getUnit(state, id(objectId, 'objectId'));
    id(toLocationId, 'toLocationId');
    check(unit.locationId !== toLocationId, 'destination equals origin');
    const origin = occupancyOf(state, unit.locationId);
    origin.splice(origin.indexOf(unit.objectId), 1);
    enter(state, unit, toLocationId);
    return commit(state);
}
/** Removal does not perform the subsequent Open cleanup. */
export function removeDuelUnit(board, objectId) {
    const state = copyBoard(board);
    const unit = getUnit(state, id(objectId, 'objectId'));
    const origin = occupancyOf(state, unit.locationId);
    origin.splice(origin.indexOf(unit.objectId), 1);
    state.units.splice(state.units.indexOf(unit), 1);
    return commit(state);
}
function controllersAt(board, field) {
    return new Set(board.units.filter(unit => unit.locationId === field.locationId).map(unit => unit.controllerPlayerId));
}
function clearContest(field) {
    field.contested = false;
    field.contestingPlayerId = null;
}
function refreshStages(board, field) {
    const present = controllersAt(board, field);
    field.showdown = field.contested && field.contestingPlayerId !== null && present.has(field.contestingPlayerId) ? 'staged' : 'none';
    field.combat = field.showdown === 'staged' && present.size === 2 ? 'staged' : 'none';
}
/** Caller must invoke at a real Open cleanup; active engagements retain their control/contest. */
export function applyOpenDuelCleanup(board) {
    const state = copyBoard(board);
    for (const field of state.battlefields) {
        const present = controllersAt(state, field);
        if (field.combat === 'active')
            continue;
        if (field.showdown === 'active') {
            // 323.9/323.14: an active non-combat Showdown may become a Combat Showdown.
            // 190.3.b/190.4.b: do not clear control or contested mid-Showdown.
            field.combat = present.size === 2 ? 'staged' : 'none';
            continue;
        }
        if (field.controllerPlayerId !== null && !present.has(field.controllerPlayerId))
            field.controllerPlayerId = null;
        if (field.contested && !present.has(field.contestingPlayerId))
            clearContest(field);
        // 323.11.a: after clearing an absent contender, a remaining non-controller may apply contested.
        if (!field.contested) {
            const challenger = state.units.find(unit => unit.locationId === field.locationId &&
                unit.controllerPlayerId !== field.controllerPlayerId);
            if (challenger) {
                field.contested = true;
                field.contestingPlayerId = challenger.controllerPlayerId;
            }
        }
        refreshStages(state, field);
    }
    return commit(state);
}
/** Begin a staged non-combat Showdown; a staged Combat uses beginDuelCombat. */
export function beginDuelShowdown(board, locationId) {
    const state = copyBoard(board);
    const field = getField(state, locationId);
    check(!state.battlefields.some(other => other.showdown === 'active' || other.combat === 'active'), 'engagement already ongoing');
    check(field.showdown === 'staged' && field.combat === 'none', 'non-combat showdown is not staged');
    check(controllersAt(state, field).has(field.contestingPlayerId), 'contesting player has no unit here');
    field.showdown = 'active';
    return commit(state);
}
/** Begin staged Combat (its Showdown) or convert an active non-combat Showdown. */
export function beginDuelCombat(board, locationId) {
    const state = copyBoard(board);
    const field = getField(state, locationId);
    check(!state.battlefields.some(other => other.locationId !== locationId &&
        (other.showdown === 'active' || other.combat === 'active')), 'engagement ongoing at another battlefield');
    check((field.showdown === 'staged' || field.showdown === 'active') && field.combat === 'staged', 'combat is not staged');
    check(controllersAt(state, field).size === 2 && controllersAt(state, field).has(field.contestingPlayerId), 'combat requires opposing units and contender');
    field.showdown = 'active';
    field.combat = 'active';
    return commit(state);
}
/** 348.2: no combat damage/score, and no ownership change for an already controlling player. */
export function endDuelNonCombatShowdown(board, locationId) {
    const state = copyBoard(board);
    const field = getField(state, locationId);
    check(field.showdown === 'active' && field.combat === 'none', 'no active non-combat showdown');
    const present = controllersAt(state, field);
    check(present.size <= 1, 'cannot close a non-combat showdown with opposing units');
    field.showdown = 'none';
    if (present.size === 1) {
        const remaining = [...present][0];
        if (field.controllerPlayerId !== remaining) {
            field.controllerPlayerId = remaining;
            clearContest(field); // 190.3.b: control was established/re-established.
        }
    }
    // If control did not change, or the field is empty, deferred contest/control is
    // handled at the next Open cleanup (323.6/323.11), not by an invented 348.2 step.
    return commit(state);
}
/** Input is the board AFTER caller's Combat Cleanup/recalls; no damage or recall is simulated here. */
export function endDuelCombat(board, locationId, options) {
    const state = copyBoard(board);
    const field = getField(state, locationId);
    const params = record(options, ['recalledAttackersDuringCleanup'], 'combat result options');
    check(typeof params.recalledAttackersDuringCleanup === 'boolean', 'recalledAttackersDuringCleanup must be boolean');
    check(field.showdown === 'active' && field.combat === 'active', 'no active combat');
    const present = controllersAt(state, field);
    const result = params.recalledAttackersDuringCleanup || present.size !== 1
        ? 'no-result' : { winnerPlayerId: [...present][0] };
    if (present.size === 2) {
        // 466.3.d.1: No Result while both remain re-stages both; 466.5 MUST NOT establish control.
        field.showdown = 'staged';
        field.combat = 'staged';
        return { board: commit(state), result, restaged: true };
    }
    field.showdown = 'none';
    field.combat = 'none';
    field.controllerPlayerId = present.size === 1 ? [...present][0] : null;
    clearContest(field);
    return { board: commit(state), result, restaged: false };
}
/** Whitelist-only projection: never spreads input or includes the private setup selection. */
export function projectPublicDuelBoard(board) {
    const snapshot = restoreDuelBoard(board);
    return { bases: snapshot.bases, battlefields: snapshot.battlefields, units: snapshot.units };
}

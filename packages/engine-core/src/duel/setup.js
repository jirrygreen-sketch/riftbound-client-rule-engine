// Standalone authoritative setup primitives, CR v1.4 111–118, 416.5, 485.4–5.
// Internal setup: the parent owns the canonical setup→playing transition. The server owns
// deck/catalog validation, command versions and playing-state transfer.
export const DUEL_SETUP_DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];
function check(condition, message) {
    if (!condition)
        throw new TypeError(`Invalid duel setup: ${message}`);
}
function record(raw, fields, label) {
    check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), label);
    const keys = Reflect.ownKeys(raw);
    check(keys.length === fields.length && fields.every(field => keys.includes(field)), `${label} keys`);
    check(keys.every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(raw, key);
        return descriptor && 'value' in descriptor;
    }), `${label} accessors`);
    const prototype = Object.getPrototypeOf(raw);
    check(prototype === Object.prototype || prototype === null, `${label} prototype`);
    return raw;
}
function list(raw, label, length = null) {
    check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype &&
        (length === null || raw.length === length), label);
    check(Reflect.ownKeys(raw).length === raw.length + 1, `${label} sparse/extra entries`);
    for (let i = 0; i < raw.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(raw, i);
        check(descriptor && 'value' in descriptor, `${label}[${i}] accessor or hole`);
    }
    return raw;
}
function id(raw, label) {
    check(typeof raw === 'string' && raw.trim().length !== 0, label);
    return raw;
}
function domain(raw, label) {
    check(typeof raw === 'string' && DUEL_SETUP_DOMAINS.includes(raw), label);
    return raw;
}
function unique(values, label) {
    check(new Set(values).size === values.length, `${label} duplicates`);
}
function card(raw, label) {
    const data = record(raw, ['uid', 'cardId'], label);
    return { uid: id(data.uid, `${label}.uid`), cardId: id(data.cardId, `${label}.cardId`) };
}
function rune(raw, label) {
    const data = record(raw, ['uid', 'cardId', 'domain'], label);
    return { uid: id(data.uid, `${label}.uid`), cardId: id(data.cardId, `${label}.cardId`),
        domain: domain(data.domain, `${label}.domain`) };
}
function field(raw, label) {
    const data = record(raw, ['instanceId', 'cardId'], label);
    return { instanceId: id(data.instanceId, `${label}.instanceId`), cardId: id(data.cardId, `${label}.cardId`) };
}
function orderedDeck(raw, label, min) {
    const result = list(raw, label).map((value, i) => card(value, `${label}[${i}]`));
    check(result.length >= min, `${label} must contain at least ${min} cards`);
    return result;
}
function runes(raw, label) {
    return list(raw, label).map((value, i) => rune(value, `${label}[${i}]`));
}
function fields(raw, label, count) {
    return list(raw, label, count).map((value, i) => field(value, `${label}[${i}]`));
}
function validateIds(players) {
    unique(players.map(player => player.playerId), 'player IDs');
    const objects = players.flatMap(player => [player.champion.uid, player.legend.uid,
        ...player.main.map(value => value.uid), ...player.runes.map(value => value.uid),
        ...player.battlefields.map(value => value.instanceId)]);
    unique(objects, 'game object IDs (uid/instanceId)');
    for (const player of players) {
        unique(player.battlefields.map(value => value.cardId), `${player.playerId} battlefield printings`);
    }
    // These are derived board locations; never treat a printing as a location or a UID.
    const locations = players.flatMap(player => [JSON.stringify(['duel-base', player.playerId]),
        ...player.battlefields.map(value => JSON.stringify(['duel-battlefield', value.instanceId]))]);
    unique(locations, 'derived locations');
    check(objects.every(objectId => !locations.includes(objectId) && !players.some(player => player.playerId === objectId)), 'game object collides with player/location ID');
    // Identity, Game Object UID and location strings stay in disjoint partitions: a player ID may
    // never be (or be spelled as) another participant's derived location.
    check(players.every(player => !locations.includes(player.playerId)), 'player ID collides with a derived location');
    check(players.every(player => player.battlefields.every(value => !locations.includes(value.cardId))), 'battlefield printing collides with location');
}
function parseSeats(raw) {
    const seats = list(raw, 'seats', 2).map((value, i) => {
        const data = record(value, ['playerId', 'mainDeck', 'champion', 'legend', 'runeDeck', 'battlefields'], `seats[${i}]`);
        return { playerId: id(data.playerId, `seats[${i}].playerId`),
            mainDeck: orderedDeck(data.mainDeck, `seats[${i}].mainDeck`, 6),
            champion: card(data.champion, `seats[${i}].champion`),
            legend: card(data.legend, `seats[${i}].legend`),
            runeDeck: runes(data.runeDeck, `seats[${i}].runeDeck`),
            battlefields: fields(data.battlefields, `seats[${i}].battlefields`, 3) };
    });
    validateIds(seats.map(seat => ({ ...seat, main: seat.mainDeck, runes: seat.runeDeck })));
    return seats;
}
function index(randomIndex, bound) {
    const result = randomIndex(bound);
    check(typeof result === 'number' && Number.isSafeInteger(result) && result >= 0 && result < bound, `randomIndex(${bound}) result`);
    return result;
}
function shuffled(input, randomIndex) {
    const result = [...input];
    for (let i = result.length - 1; i > 0; i--) {
        const j = index(randomIndex, i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function cloneSelection(selection) {
    return { selected: selection.selected.map(value => ({ playerId: value.playerId,
            instanceId: value.instanceId, cardId: value.cardId })),
        removedByPlayer: selection.removedByPlayer.map(value => ({ playerId: value.playerId,
            battlefields: value.battlefields.map(part => ({ instanceId: part.instanceId, cardId: part.cardId })) })) };
}
/** Set up all four shuffled decks, random first player and simultaneous selected Battlefields. */
export function createDuelSetup(seats, randomIndex) {
    const data = parseSeats(seats);
    check(typeof randomIndex === 'function', 'randomIndex');
    const decks = data.map(seat => ({ main: shuffled(seat.mainDeck, randomIndex),
        runes: shuffled(seat.runeDeck, randomIndex) }));
    const first = index(randomIndex, 2);
    const selectedIndices = data.map(() => index(randomIndex, 3));
    const playerIds = [data[0].playerId, data[1].playerId];
    const selection = {
        selected: data.map((seat, i) => ({ playerId: seat.playerId, ...seat.battlefields[selectedIndices[i]] })),
        removedByPlayer: data.map((seat, i) => ({ playerId: seat.playerId,
            battlefields: seat.battlefields.filter((_, j) => j !== selectedIndices[i]) })),
    };
    return {
        stage: 'mulligan', playerIds, firstPlayerId: playerIds[first],
        turnOrder: [playerIds[first], playerIds[1 - first]],
        players: data.map((seat, i) => ({ playerId: seat.playerId, champion: seat.champion,
            legend: seat.legend, hand: decks[i].main.slice(0, 4),
            remainingMainDeck: decks[i].main.slice(4), shuffledRuneDeck: decks[i].runes,
            mulliganStatus: 'pending' })),
        selection,
    };
}
/** Validate a trusted archive, including stage/ownership/zone identities, and detach every array/object. */
export function restoreDuelSetup(snapshot) {
    const data = record(snapshot, ['stage', 'playerIds', 'turnOrder', 'firstPlayerId', 'players', 'selection'], 'snapshot');
    check(data.stage === 'mulligan' || data.stage === 'complete', 'stage');
    const playerIds = list(data.playerIds, 'playerIds', 2).map((value, i) => id(value, `playerIds[${i}]`));
    unique(playerIds, 'playerIds');
    const turnOrder = list(data.turnOrder, 'turnOrder', 2).map((value, i) => id(value, `turnOrder[${i}]`));
    check(new Set(turnOrder).size === 2 && turnOrder.every(player => playerIds.includes(player)), 'turnOrder permutation');
    const firstPlayerId = id(data.firstPlayerId, 'firstPlayerId');
    check(firstPlayerId === turnOrder[0], 'firstPlayerId must lead turnOrder');
    const players = list(data.players, 'players', 2).map((raw, i) => {
        const player = record(raw, ['playerId', 'champion', 'legend', 'hand', 'remainingMainDeck',
            'shuffledRuneDeck', 'mulliganStatus'], `players[${i}]`);
        const playerId = id(player.playerId, `players[${i}].playerId`);
        check(playerId === playerIds[i], 'players must follow playerIds seat order');
        check(player.mulliganStatus === 'pending' || player.mulliganStatus === 'complete', 'mulliganStatus');
        return { playerId, champion: card(player.champion, `players[${i}].champion`),
            legend: card(player.legend, `players[${i}].legend`), hand: orderedDeck(player.hand, `players[${i}].hand`, 4),
            remainingMainDeck: orderedDeck(player.remainingMainDeck, `players[${i}].remainingMainDeck`, 2),
            shuffledRuneDeck: runes(player.shuffledRuneDeck, `players[${i}].shuffledRuneDeck`),
            mulliganStatus: player.mulliganStatus };
    });
    check(players.every(player => player.hand.length === 4), 'hand must contain exactly four cards');
    const inTurnOrder = turnOrder.map(playerId => players.find(player => player.playerId === playerId));
    check((data.stage === 'mulligan' && inTurnOrder[1].mulliganStatus === 'pending') ||
        (data.stage === 'complete' && inTurnOrder.every(player => player.mulliganStatus === 'complete')), 'stage/second player status');
    const rawSelection = record(data.selection, ['selected', 'removedByPlayer'], 'selection');
    const selected = list(rawSelection.selected, 'selection.selected', 2).map((raw, i) => {
        const value = record(raw, ['playerId', 'instanceId', 'cardId'], `selection.selected[${i}]`);
        return { playerId: id(value.playerId, 'selected.playerId'),
            instanceId: id(value.instanceId, 'selected.instanceId'), cardId: id(value.cardId, 'selected.cardId') };
    });
    const removedByPlayer = list(rawSelection.removedByPlayer, 'selection.removedByPlayer', 2).map((raw, i) => {
        const value = record(raw, ['playerId', 'battlefields'], `selection.removedByPlayer[${i}]`);
        return { playerId: id(value.playerId, 'removedByPlayer.playerId'),
            battlefields: fields(value.battlefields, `removedByPlayer[${i}].battlefields`, 2) };
    });
    check(selected.every((value, i) => value.playerId === playerIds[i]) &&
        removedByPlayer.every((value, i) => value.playerId === playerIds[i]), 'selection seat mapping');
    validateIds(players.map((player, i) => ({ ...player,
        main: [...player.hand, ...player.remainingMainDeck], runes: player.shuffledRuneDeck,
        battlefields: [selected[i], ...removedByPlayer[i].battlefields] })));
    return { stage: data.stage, playerIds: playerIds,
        turnOrder: turnOrder, firstPlayerId,
        players: players, selection: { selected, removedByPlayer } };
}
/**
 * Complete one private mulligan, in turn order. Set-aside cards cannot be replacement draws.
 * `randomIndex` is required only for the two-card recycle, which is when RNG is actually consumed.
 */
export function mulliganDuelSetup(snapshot, actor, selectedUids, randomIndex) {
    const state = restoreDuelSetup(snapshot);
    check(state.stage === 'mulligan', 'mulligan already finished');
    const playerId = id(actor, 'actor');
    const due = state.turnOrder.find(value => state.players.find(player => player.playerId === value).mulliganStatus === 'pending');
    check(playerId === due, 'actor is not current mulligan owner');
    const chosen = list(selectedUids, 'selectedUids');
    check(chosen.length <= 2, 'at most two mulligan cards');
    const uids = chosen.map((value, i) => id(value, `selectedUids[${i}]`));
    unique(uids, 'selectedUids');
    const original = state.players.find(player => player.playerId === playerId);
    check(uids.every(uid => original.hand.some(value => value.uid === uid)), 'selected UID not in own hand');
    check(original.remainingMainDeck.length >= uids.length, 'insufficient replacements');
    // An explicit non-function callback is always rejected; `undefined` is allowed only while the
    // recycle below stays deterministic.
    check(randomIndex === undefined || typeof randomIndex === 'function', 'randomIndex');
    const aside = original.hand.filter(value => uids.includes(value.uid));
    const replacement = original.remainingMainDeck.slice(0, aside.length);
    // RNG is invoked only after *all* input checks, and only after replacement is selected.
    let recycled = aside;
    if (aside.length === 2) {
        check(typeof randomIndex === 'function', 'randomIndex');
        recycled = shuffled(aside, randomIndex);
    }
    const players = state.players.map(player => player.playerId !== playerId ? player : ({
        ...player, hand: [...player.hand.filter(value => !uids.includes(value.uid)), ...replacement],
        remainingMainDeck: [...player.remainingMainDeck.slice(aside.length), ...recycled],
        mulliganStatus: 'complete',
    }));
    return { ...state, players,
        stage: players.every(player => player.mulliganStatus === 'complete') ? 'complete' : 'mulligan' };
}
/** Explicit allowlist; never expose private set-aside or removed Battlefield fields. */
export function projectPublicDuelSetup(state, viewerPlayerId = null) {
    const source = restoreDuelSetup(state);
    check(viewerPlayerId === null || (typeof viewerPlayerId === 'string' && viewerPlayerId.trim().length > 0), 'viewerPlayerId');
    const currentMulliganOwner = source.stage === 'complete' ? null : source.turnOrder.find(playerId => source.players.find(player => player.playerId === playerId).mulliganStatus === 'pending');
    const players = source.players.map(player => ({
        playerId: player.playerId, legend: { cardId: player.legend.cardId },
        champion: { cardId: player.champion.cardId },
        handCount: player.hand.length, mainDeckCount: player.remainingMainDeck.length,
        runeDeckCount: player.shuffledRuneDeck.length, mulliganStatus: player.mulliganStatus,
        ...(viewerPlayerId === player.playerId ? { hand: player.hand.map(value => ({ uid: value.uid, cardId: value.cardId })) } : {}),
    }));
    return { stage: source.stage, turnOrder: [...source.turnOrder],
        firstPlayerId: source.firstPlayerId, currentMulliganOwner,
        players, selectedBattlefields: source.selection.selected.map(value => ({ playerId: value.playerId,
            instanceId: value.instanceId, cardId: value.cardId })) };
}
/** One-time tagged-state transition belongs to the parent, not this pure DTO producer. */
export function completeDuelSetup(state) {
    const source = restoreDuelSetup(state);
    check(source.stage === 'complete', 'cannot transfer until both mulligans complete');
    return { playerIds: [...source.playerIds],
        turnOrder: [...source.turnOrder], firstPlayerId: source.firstPlayerId,
        players: source.players.map(player => ({ playerId: player.playerId,
            champion: { ...player.champion }, legend: { ...player.legend },
            hand: player.hand.map(value => ({ ...value })),
            remainingMainDeck: player.remainingMainDeck.map(value => ({ ...value })) })),
        selection: cloneSelection(source.selection),
        runeDecks: source.players.map(player => player.shuffledRuneDeck.map(value => ({ ...value }))) };
}

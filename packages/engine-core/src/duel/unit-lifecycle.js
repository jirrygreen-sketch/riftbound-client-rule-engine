// Isolated INTERNAL duel unit kernel (CR v1.4 141–143, 179–186, 417–418, 428).
// The root executor owns Chain/Play, replacement, Deathknell, cleanup and promotion into formal sources.
import { assertDuelBoard, placeDuelUnit, removeDuelUnit, restoreDuelBoard, } from './battlefields.js';
import { assertDuelResources, restoreDuelResources, } from './resources.js';
import { moveDuelUnitsStandard, } from './movement.js';
function check(ok, message) {
    if (!ok)
        throw new TypeError(`Invalid duel unit lifecycle: ${message}`);
}
function record(raw, keys, label) {
    check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), `${label} record`);
    check(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null, `${label} prototype`);
    const actual = Reflect.ownKeys(raw);
    check(actual.every(key => typeof key === 'string' && 'value' in Object.getOwnPropertyDescriptor(raw, key)), `${label} accessors/symbols`);
    if (keys !== null)
        check(actual.length === keys.length && keys.every(key => actual.includes(key)), `${label} keys`);
    return raw;
}
function array(raw, label) {
    check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype, `${label} array`);
    const keys = Reflect.ownKeys(raw);
    check(keys.length === raw.length + 1, `${label} sparse/extra`);
    for (let i = 0; i < raw.length; i++)
        check('value' in Object.getOwnPropertyDescriptor(raw, String(i)), `${label}[${i}] accessor/hole`);
    return raw;
}
function id(raw, label) {
    check(typeof raw === 'string' && raw.trim().length > 0, label);
    return raw;
}
function count(raw, label) {
    check(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0, label);
    return raw;
}
function safeAdd(a, b) {
    const sum = a + b;
    check(Number.isSafeInteger(sum), 'damage overflow');
    return sum;
}
function player(raw, board, label) {
    const value = id(raw, label);
    check(board.playerIds.includes(value), `${label} unknown player`);
    return value;
}
function unique(values, label) {
    check(new Set(values).size === values.length, `${label} duplicate UID`);
}
function card(raw, label) {
    const c = record(raw, ['uid', 'cardId'], label);
    return { uid: id(c.uid, `${label}.uid`), cardId: id(c.cardId, `${label}.cardId`) };
}
function trait(raw, label) {
    const t = record(raw, null, label);
    if (t.kind === 'card') {
        record(raw, ['kind', 'cardId'], label);
        return { kind: 'card', cardId: id(t.cardId, `${label}.cardId`) };
    }
    check(t.kind === 'token', `${label}.kind`);
    record(raw, ['kind', 'name', 'baseMight', 'tags'], label);
    const tags = array(t.tags, `${label}.tags`).map((value, i) => id(value, `${label}.tags[${i}]`));
    unique(tags, `${label}.tags`);
    return { kind: 'token', name: id(t.name, `${label}.name`), baseMight: count(t.baseMight, `${label}.baseMight`), tags };
}
function marks(raw, board, label) {
    let total = 0;
    return array(raw, label).map((value, i) => {
        const mark = record(value, ['amount', 'responsiblePlayerId', 'sourceObjectIds'], `${label}[${i}]`);
        const amount = count(mark.amount, `${label}[${i}].amount`);
        check(amount > 0, 'resolved damage must be positive');
        total = safeAdd(total, amount);
        const sourceObjectIds = array(mark.sourceObjectIds, `${label}[${i}].sourceObjectIds`)
            .map((source, n) => id(source, `${label}[${i}].sourceObjectIds[${n}]`));
        check(sourceObjectIds.length > 0, 'resolved damage must have a source');
        unique(sourceObjectIds, 'damage sources');
        return { amount, responsiblePlayerId: player(mark.responsiblePlayerId, board, 'damage responsiblePlayerId'),
            sourceObjectIds };
    });
}
function meta(raw, board, label) {
    const m = record(raw, ['ownerPlayerId', 'readied', 'damageMarks', 'trait'], label);
    check(typeof m.readied === 'boolean', `${label}.readied`);
    return { ownerPlayerId: player(m.ownerPlayerId, board, `${label}.ownerPlayerId`),
        readied: m.readied, damageMarks: marks(m.damageMarks, board, `${label}.damageMarks`),
        trait: trait(m.trait, `${label}.trait`) };
}
function privatePlayer(raw, board, label) {
    const p = record(raw, ['playerId', 'champion', 'legend', 'hand', 'remainingMainDeck', 'trash'], label);
    return { playerId: player(p.playerId, board, `${label}.playerId`),
        champion: p.champion === null ? null : card(p.champion, `${label}.champion`),
        legend: card(p.legend, `${label}.legend`),
        hand: array(p.hand, `${label}.hand`).map((c, i) => card(c, `${label}.hand[${i}]`)),
        remainingMainDeck: array(p.remainingMainDeck, `${label}.remainingMainDeck`)
            .map((c, i) => card(c, `${label}.remainingMainDeck[${i}]`)),
        trash: array(p.trash, `${label}.trash`).map((c, i) => card(c, `${label}.trash[${i}]`)) };
}
function trustedState(input) {
    const s = record(input, null, 'state');
    for (const field of ['stateVersion', 'board', 'resources', 'players', 'unitMeta', 'retiredUnitTokenUIDs'])
        check(Object.hasOwn(s, field), `missing state.${field}`);
    count(s.stateVersion, 'stateVersion');
    assertDuelBoard(s.board);
    const board = s.board;
    const baseLocations = board.bases.map(({ ownerPlayerId, locationId }) => ({ playerId: ownerPlayerId, locationId }));
    assertDuelResources(s.resources, baseLocations);
    const resources = s.resources;
    check(board.playerIds.length === 2 && board.playerIds.every((p, i) => p === resources.playerIds[i]), 'resource/board seats');
    const players = array(s.players, 'players');
    check(players.length === 2, 'two private seats');
    const ps = players.map((p, i) => privatePlayer(p, board, `players[${i}]`));
    check(ps.every((p, i) => p.playerId === board.playerIds[i]), 'private/board seats');
    const metadata = record(s.unitMeta, null, 'unitMeta');
    const boardUIDs = board.units.map(u => u.objectId);
    const metaUIDs = Object.keys(metadata);
    check(metaUIDs.length === boardUIDs.length && metaUIDs.every(uid => boardUIDs.includes(uid)), 'board units must have exactly one metadata record each');
    const reservedIds = [...board.playerIds, ...board.bases.map(b => b.locationId),
        ...board.battlefields.flatMap(b => [b.locationId, b.instanceId])];
    unique(reservedIds, 'player/location/battlefield');
    const reserved = new Set(reservedIds);
    const physical = ps.flatMap(p => [
        ...(p.champion ? [p.champion.uid] : []), p.legend.uid,
        ...p.hand.map(c => c.uid), ...p.remainingMainDeck.map(c => c.uid), ...p.trash.map(c => c.uid),
    ]);
    physical.push(...resources.players.flatMap(p => p.runeDeck.map(r => r.uid)), ...resources.bases.flatMap(b => b.baseRunes.map(r => r.uid)));
    const goldUIDs = resources.bases.flatMap(b => b.goldTokens.map(g => g.uid));
    const retiredTokens = array(s.retiredUnitTokenUIDs, 'retiredUnitTokenUIDs')
        .map((uid, i) => id(uid, `retiredUnitTokenUIDs[${i}]`));
    const allUIDs = [...physical, ...boardUIDs, ...goldUIDs, ...resources.retiredGoldUids, ...retiredTokens];
    unique(allUIDs, 'all physical/live/retired');
    check(allUIDs.every(uid => !reserved.has(uid)), 'UID collides with player/location/battlefield ID');
    for (const unit of board.units) {
        const m = meta(metadata[unit.objectId], board, `unitMeta[${unit.objectId}]`);
    }
    // A Board card is a physical UID and was checked in allUIDs exactly once; tokens cannot
    // appear in any physical card zone (all physical zones and Board are disjoint).
    return input;
}
/** Strict board/resources/private-zone cross-references; intentionally no Chain archive here. */
export function assertDuelUnitLifecycleState(input) {
    trustedState(input);
}
function copy(state) {
    const board = restoreDuelBoard(state.board);
    const resources = restoreDuelResources(state.resources, board.bases.map(b => ({ playerId: b.ownerPlayerId, locationId: b.locationId })));
    const players = state.players.map((p) => ({
        playerId: p.playerId, champion: p.champion ? { ...p.champion } : null, legend: { ...p.legend },
        hand: p.hand.map(c => ({ ...c })), remainingMainDeck: p.remainingMainDeck.map(c => ({ ...c })),
        trash: p.trash.map(c => ({ ...c })),
    }));
    const unitMeta = Object.fromEntries(Object.entries(state.unitMeta).map(([uid, m]) => [uid, { ownerPlayerId: m.ownerPlayerId, readied: m.readied,
            damageMarks: m.damageMarks.map(mark => ({ ...mark, sourceObjectIds: [...mark.sourceObjectIds] })),
            trait: m.trait.kind === 'card' ? { ...m.trait } : { ...m.trait, tags: [...m.trait.tags] } }]));
    return { ...state, board, resources, players, unitMeta, retiredUnitTokenUIDs: [...state.retiredUnitTokenUIDs] };
}
function increment(version) {
    check(version < Number.MAX_SAFE_INTEGER, 'stateVersion overflow');
    return version + 1;
}
function unitIds(state, raw, allowEmpty = false) {
    const uids = array(raw, 'unit UIDs').map((value, i) => id(value, `unit UIDs[${i}]`));
    check(allowEmpty || uids.length > 0, 'unit UIDs must not be empty');
    unique(uids, 'unit UIDs');
    for (const uid of uids)
        check(Object.hasOwn(state.unitMeta, uid), `unknown board unit UID ${uid}`);
    return uids;
}
function changed(state, updates) {
    const next = copy(state);
    const metadata = { ...next.unitMeta };
    for (const [uid, value] of updates)
        Object.defineProperty(metadata, uid, { value, enumerable: true, configurable: true, writable: true });
    const out = { ...next, stateVersion: increment(state.stateVersion), unitMeta: metadata };
    assertDuelUnitLifecycleState(out);
    return out;
}
function settled(raw, board) {
    const entry = record(raw, null, 'settled source');
    const shared = ['kind', 'uid', 'ownerPlayerId', 'controllerPlayerId', 'locationId'];
    if (entry.kind === 'card') {
        record(raw, [...shared, 'cardType', 'cardId', ...(Object.hasOwn(entry, 'entryReplacement') ? ['entryReplacement'] : [])], 'settled card');
        check(entry.cardType === 'Unit', 'settled card must be a Unit');
    }
    else {
        check(entry.kind === 'token', 'settled source kind');
        record(raw, [...shared, 'unitType', 'name', 'baseMight', 'tags',
            ...(Object.hasOwn(entry, 'entryReplacement') ? ['entryReplacement'] : [])], 'settled token');
        check(entry.unitType === 'Unit', 'settled token must be a Unit');
    }
    check(!Object.hasOwn(entry, 'entryReplacement') || entry.entryReplacement === 'enter-ready', 'entryReplacement must be trusted enter-ready');
    const common = { uid: id(entry.uid, 'settled UID'),
        ownerPlayerId: player(entry.ownerPlayerId, board, 'settled owner'),
        controllerPlayerId: player(entry.controllerPlayerId, board, 'settled controller'),
        locationId: id(entry.locationId, 'settled location'),
        ...(Object.hasOwn(entry, 'entryReplacement') ? { entryReplacement: 'enter-ready' } : {}) };
    if (entry.kind === 'card')
        return { ...common, kind: 'card', cardType: 'Unit', cardId: id(entry.cardId, 'settled cardId') };
    const parsed = trait({ kind: 'token', name: entry.name, baseMight: entry.baseMight, tags: entry.tags }, 'settled token trait');
    check(parsed.kind === 'token', 'settled token trait');
    return { ...common, unitType: 'Unit', ...parsed };
}
/** ONLY trusted outer settled-Card/Token executor entry; origin/Chain removal is the caller's atomic duty. */
export function materializeDuelUnitFromSettledSource(state, source, trustedIsUnitPrinting) {
    assertDuelUnitLifecycleState(state);
    check(typeof trustedIsUnitPrinting === 'function', 'trusted card catalog binding required');
    const value = settled(source, state.board);
    check(value.kind !== 'card' || trustedIsUnitPrinting(value.cardId) === true, 'card printing is not a trusted Unit');
    const current = copy(state);
    const uid = value.uid;
    const occupied = [
        ...current.players.flatMap(p => [p.champion?.uid, p.legend.uid,
            ...p.hand.map(c => c.uid), ...p.remainingMainDeck.map(c => c.uid), ...p.trash.map(c => c.uid)]),
        ...current.resources.players.flatMap(p => p.runeDeck.map(r => r.uid)),
        ...current.resources.bases.flatMap(b => [...b.baseRunes.map(r => r.uid), ...b.goldTokens.map(g => g.uid)]),
        ...current.resources.retiredGoldUids, ...current.retiredUnitTokenUIDs, ...current.board.units.map(u => u.objectId),
    ];
    check(!occupied.includes(uid), 'settled UID still in physical zone, Board or retired');
    const board = placeDuelUnit(current.board, { objectId: uid,
        controllerPlayerId: value.controllerPlayerId, locationId: value.locationId });
    const entryMeta = { ownerPlayerId: value.ownerPlayerId,
        readied: value.entryReplacement === 'enter-ready', damageMarks: [],
        trait: value.kind === 'card' ? { kind: 'card', cardId: value.cardId } :
            { kind: 'token', name: value.name, baseMight: value.baseMight, tags: [...value.tags] } };
    const metadata = { ...current.unitMeta };
    Object.defineProperty(metadata, uid, { value: entryMeta, enumerable: true, configurable: true, writable: true });
    const out = { ...current, board, unitMeta: metadata, stateVersion: increment(current.stateVersion) };
    assertDuelUnitLifecycleState(out);
    return out;
}
/** Already-ready units do not change readiness and do not appear in changedUnitUIDs. */
export function readyDuelUnits(state, rawUIDs) {
    assertDuelUnitLifecycleState(state);
    const ids = unitIds(state, rawUIDs);
    const modified = ids.filter(uid => !state.unitMeta[uid].readied);
    if (!modified.length)
        return { state: copy(state), changedUnitUIDs: [] };
    const updates = new Map(modified.map(uid => [uid, { ...state.unitMeta[uid], readied: true }]));
    return { state: changed(state, updates), changedUnitUIDs: modified };
}
/** All-or-nothing trusted exhaustion COST; no UID is charged when any selected unit is exhausted. */
export function exhaustDuelUnitsAsCost(state, rawUIDs) {
    assertDuelUnitLifecycleState(state);
    const ids = unitIds(state, rawUIDs);
    check(ids.every(uid => state.unitMeta[uid].readied), 'cannot pay exhaustion cost with exhausted unit');
    return changed(state, new Map(ids.map(uid => [uid, { ...state.unitMeta[uid], readied: false }])));
}
/** Trusted effect exhaustion; already-exhausted units cause no change. */
export function exhaustDuelUnitsByEffect(state, rawUIDs) {
    assertDuelUnitLifecycleState(state);
    const ids = unitIds(state, rawUIDs);
    const modified = ids.filter(uid => state.unitMeta[uid].readied);
    if (!modified.length)
        return { state: copy(state), changedUnitUIDs: [] };
    return { state: changed(state, new Map(modified.map(uid => [uid, { ...state.unitMeta[uid], readied: false }]))),
        changedUnitUIDs: modified };
}
/** Records only a resolved positive Deal, after outer prevention/replacement/attribution. */
export function recordResolvedDuelDamage(state, uid, mark) {
    assertDuelUnitLifecycleState(state);
    const [unitId] = unitIds(state, [uid]);
    const parsed = marks([mark], state.board, 'resolved damage')[0];
    const existing = state.unitMeta[unitId];
    safeAdd(existing.damageMarks.reduce((sum, current) => safeAdd(sum, current.amount), 0), parsed.amount);
    return changed(state, new Map([[unitId, { ...existing, damageMarks: [...existing.damageMarks, parsed] }]]));
}
/** Heal ALL marks, preserving no arbitrary FIFO/LIFO attribution for unsupported partial Heal. */
export function healAllDuelUnitDamage(state, rawUIDs) {
    assertDuelUnitLifecycleState(state);
    const ids = unitIds(state, rawUIDs);
    const healed = ids.filter(uid => state.unitMeta[uid].damageMarks.length > 0);
    if (!healed.length)
        return { state: copy(state), healedUnitUIDs: [] };
    return { state: changed(state, new Map(healed.map(uid => [uid, { ...state.unitMeta[uid], damageMarks: [] }]))),
        healedUnitUIDs: healed };
}
function view(state, uid) {
    const unit = state.board.units.find(item => item.objectId === uid);
    const m = state.unitMeta[uid];
    const damageMarks = m.damageMarks.map(mark => ({ ...mark, sourceObjectIds: [...mark.sourceObjectIds] }));
    return { objectId: uid, controllerPlayerId: unit.controllerPlayerId, locationId: unit.locationId,
        ownerPlayerId: m.ownerPlayerId, readied: m.readied,
        trait: m.trait.kind === 'card' ? { ...m.trait } : { ...m.trait, tags: [...m.trait.tags] },
        damageMarks, totalDamage: damageMarks.reduce((sum, mark) => safeAdd(sum, mark.amount), 0) };
}
/** Board-only public Unit details; never spreads private players/resources/tombstones. */
export function projectPublicDuelUnitObjects(state) {
    assertDuelUnitLifecycleState(state);
    return state.board.units.map(unit => {
        const { damageMarks, ...publicUnit } = view(state, unit.objectId);
        return { ...publicUnit,
            damageMarks: damageMarks.map(({ amount, responsiblePlayerId }) => ({ amount, responsiblePlayerId })) };
    });
}
/** Always demand current Might AND threshold evaluation, including 142.4.c alteration. */
export function queryLethalDuelUnitCandidates(state, evaluators) {
    const units = projectPublicDuelUnitObjects(state);
    const e = record(evaluators, ['currentMight', 'lethalDamageThreshold'], 'trusted lethal evaluators');
    check(typeof e.currentMight === 'function' && typeof e.lethalDamageThreshold === 'function', 'trusted current Might and lethal-threshold evaluators required');
    return units.filter(unit => {
        const might = evaluators.currentMight(unit);
        check(Number.isSafeInteger(might), `invalid current Might of ${unit.objectId}`);
        const threshold = count(evaluators.lethalDamageThreshold(unit, might), `lethal threshold of ${unit.objectId}`);
        return unit.totalDamage > 0 && unit.totalDamage >= threshold;
    });
}
/** Snapshot is PRE-exit for Active Deathknell registration; this step changes no game state. */
export function planDuelUnitKills(state, rawUIDs, kind) {
    assertDuelUnitLifecycleState(state);
    check(kind === 'active' || kind === 'passive', 'Kill kind');
    return { kind, stateVersion: state.stateVersion, snapshots: unitIds(state, rawUIDs).map(uid => view(state, uid)) };
}
/** Commits only unchanged, explicitly approved selected snapshots; no automatic Deathknell/cleanup/Move. */
export function commitApprovedDuelUnitKills(state, rawApproved) {
    assertDuelUnitLifecycleState(state);
    const approved = record(rawApproved, ['plan', 'approvedUnitUIDs'], 'approved Kill plan');
    const plan = record(approved.plan, ['kind', 'stateVersion', 'snapshots'], 'Kill plan');
    check(plan.kind === 'active' || plan.kind === 'passive', 'Kill plan kind');
    check(count(plan.stateVersion, 'Kill plan version') === state.stateVersion, 'stale Kill plan version');
    const snapshots = array(plan.snapshots, 'Kill snapshots');
    check(snapshots.length > 0, 'empty Kill plan');
    const ids = snapshots.map((raw, index) => {
        const snap = record(raw, ['objectId', 'controllerPlayerId', 'locationId', 'ownerPlayerId',
            'readied', 'trait', 'totalDamage', 'damageMarks'], `Kill snapshots[${index}]`);
        return id(snap.objectId, 'Kill snapshot UID');
    });
    unique(ids, 'Kill snapshot UIDs');
    unitIds(state, ids);
    for (let i = 0; i < snapshots.length; i++)
        check(JSON.stringify(snapshots[i]) === JSON.stringify(view(state, ids[i])), `Kill snapshot ${ids[i]} changed since planning`);
    const selected = array(approved.approvedUnitUIDs, 'approved Kill UIDs')
        .map((uid, i) => id(uid, `approved Kill UIDs[${i}]`));
    unique(selected, 'approved Kill UIDs');
    check(selected.every(uid => ids.includes(uid)), 'Kill approval includes unplanned UID');
    if (selected.length === 0)
        return { state: copy(state), notices: [] };
    const next = copy(state);
    let board = next.board;
    const metadata = { ...next.unitMeta };
    const players = next.players.map(p => ({ ...p, trash: [...p.trash] }));
    const retired = [...next.retiredUnitTokenUIDs];
    const notices = [];
    for (const uid of selected) {
        const snapshot = view(state, uid);
        board = removeDuelUnit(board, uid); // Does not run Open cleanup or issue Move events.
        delete metadata[uid];
        if (snapshot.trait.kind === 'card') {
            const owner = players.find(p => p.playerId === snapshot.ownerPlayerId);
            owner.trash = [...owner.trash, { uid, cardId: snapshot.trait.cardId }];
        }
        else
            retired.push(uid); // Transient Trash-entry notice, immediately cease, no token card in Trash.
        notices.push({ kind: 'Killed', snapshot, tokenCeasesImmediately: false,
            destinationPlayerId: snapshot.ownerPlayerId });
        notices.push({ kind: 'TrashEntry', snapshot,
            tokenCeasesImmediately: snapshot.trait.kind === 'token', destinationPlayerId: snapshot.ownerPlayerId });
    }
    const out = { ...next, board, players, unitMeta: metadata, retiredUnitTokenUIDs: retired,
        stateVersion: increment(state.stateVersion) };
    assertDuelUnitLifecycleState(out);
    return { state: out, notices };
}
/** Derived solely from canonical metadata + trusted current Ganking evaluator, never a client keyword. */
export function deriveDuelReadinessFromUnitMeta(state, deriveGanking) {
    assertDuelUnitLifecycleState(state);
    check(typeof deriveGanking === 'function', 'trusted Ganking evaluator required');
    return state.board.units.map(unit => {
        const hasGanking = deriveGanking(unit.objectId);
        check(typeof hasGanking === 'boolean', 'Ganking evaluator must return Boolean');
        return { objectId: unit.objectId, readied: state.unitMeta[unit.objectId].readied, hasGanking };
    });
}
/** Actual movement.ts action once; root still queues Move triggers then runs one Open cleanup. */
export function moveDuelUnitsWithMetadata(state, request, deriveGanking) {
    const readiness = deriveDuelReadinessFromUnitMeta(state, deriveGanking);
    const moved = moveDuelUnitsStandard(state.board, readiness, request);
    const next = copy(state);
    const byId = new Map(moved.readiness.map(entry => [entry.objectId, entry.readied]));
    const metadata = Object.fromEntries(Object.entries(next.unitMeta).map(([uid, m]) => [uid, { ...m, readied: byId.get(uid) }]));
    const out = { ...next, board: moved.board, unitMeta: metadata,
        stateVersion: increment(state.stateVersion) };
    assertDuelUnitLifecycleState(out);
    return { state: out, group: moved.group };
}

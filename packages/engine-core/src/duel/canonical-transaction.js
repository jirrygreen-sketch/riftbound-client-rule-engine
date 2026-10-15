// INTERNAL trusted executor seam. One committed mutation has one outer clock allocation.
// This is NOT a client command dispatcher, turn executor, or validated archive restore.
import { restoreDuelBoard } from './battlefields.js';
import { restoreDuelResources } from './resources.js';
import { restoreDuelScoring } from './scoring.js';
import { assertDuelUnitLifecycleState } from './unit-lifecycle.js';
function check(value, message) {
    if (!value)
        throw new TypeError(`Duel transaction: ${message}`);
}
function id(value) { return typeof value === 'string' && value.trim().length > 0; }
function counter(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function dense(value, label) {
    check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, `${label} array`);
    check(Reflect.ownKeys(value).length === value.length + 1 &&
        Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
            .every(descriptor => descriptor !== undefined && 'value' in descriptor), `${label} dense values`);
}
function plain(value, keys, label) {
    check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} record`);
    check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${label} prototype`);
    const actual = Reflect.ownKeys(value);
    check(actual.length === keys.length && keys.every(key => actual.includes(key)) &&
        actual.every(key => typeof key === 'string' && 'value' in Object.getOwnPropertyDescriptor(value, key)), `${label} keys/accessors`);
}
function same(left, right) {
    if (left === right)
        return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
        return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
            left.every((value, index) => same(value, right[index]));
    }
    const a = left, b = right;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}
/**
 * Protect an authoritative playing snapshot without changing any value.  The
 * transaction boundary owns this descriptor-only change; every nested array
 * and record is protected before trusted callback code runs.  A WeakSet keeps
 * the helper safe for malformed cyclic input even though canonical state is
 * acyclic after validation.
 */
function freezeDuelSnapshot(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object')
        return;
    if (seen.has(value))
        return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor)
            freezeDuelSnapshot(descriptor.value, seen);
    }
    Object.freeze(value);
}
function checkedFrame(frame, seats) {
    plain(frame, ['phase', 'turnNumber', 'turnPlayerId', 'priorityPlayerId', 'focusPlayerId', 'stateOpen', 'pendingPayment'], 'frame');
    check(['awaiting-turn-start', 'awaken', 'beginning', 'scoring', 'channel', 'draw', 'main',
        'ending', 'expiration', 'ended'].includes(frame.phase), 'phase');
    check(counter(frame.turnNumber) && frame.turnNumber > 0 && seats.includes(frame.turnPlayerId), 'turn');
    check(frame.priorityPlayerId === null || seats.includes(frame.priorityPlayerId), 'priority');
    check(frame.focusPlayerId === null || seats.includes(frame.focusPlayerId), 'focus');
    check(typeof frame.stateOpen === 'boolean', 'Open/Closed');
    let pending = null;
    if (frame.pendingPayment !== null) {
        const value = frame.pendingPayment;
        plain(value, ['paymentId', 'actor', 'resolvedCost', 'sourceReference'], 'pending payment');
        check(id(value.paymentId) && seats.includes(value.actor), 'pending identity');
        check(frame.phase !== 'awaiting-turn-start' && frame.phase !== 'ended', 'pending phase');
        plain(value.resolvedCost, ['energy', 'power'], 'cost');
        dense(value.resolvedCost.power, 'cost power');
        check(counter(value.resolvedCost.energy), 'cost energy/power');
        let sum = value.resolvedCost.energy;
        const power = value.resolvedCost.power.map(requirement => {
            plain(requirement, ['allowedDomains', 'amount'], 'cost requirement');
            dense(requirement.allowedDomains, 'cost allowed domains');
            check(requirement.allowedDomains.length > 0 && requirement.allowedDomains.length <= 6 &&
                counter(requirement.amount) && requirement.amount > 0, 'cost requirement amount/domains');
            const domains = requirement.allowedDomains;
            check(new Set(domains).size === domains.length && domains.every(domain => ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'].includes(domain)), 'cost domains');
            sum += requirement.amount;
            check(Number.isSafeInteger(sum), 'cost overflow');
            return { allowedDomains: [...domains], amount: requirement.amount };
        });
        const ref = value.sourceReference;
        const hasUID = Object.hasOwn(ref, 'sourceUID');
        plain(ref, hasUID ? ['kind', 'referenceId', 'sourceUID'] : ['kind', 'referenceId'], 'source');
        check((ref.kind === 'card' || ref.kind === 'effect') && id(ref.referenceId) &&
            (!hasUID || id(ref.sourceUID)), 'source identity');
        pending = { paymentId: value.paymentId, actor: value.actor, resolvedCost: { energy: value.resolvedCost.energy, power },
            sourceReference: { kind: ref.kind, referenceId: ref.referenceId,
                ...(hasUID ? { sourceUID: ref.sourceUID } : {}) } };
    }
    return { phase: frame.phase, turnNumber: frame.turnNumber, turnPlayerId: frame.turnPlayerId,
        priorityPlayerId: frame.priorityPlayerId, focusPlayerId: frame.focusPlayerId,
        stateOpen: frame.stateOpen, pendingPayment: pending };
}
/** Validate the full playing cross-UID and frame/scoring/seat graph, then detach every authoritative field. */
export function detachedDuelPlaying(match) {
    plain(match, ['stage', 'schemaVersion', 'rulesetId', 'matchId', 'dataVersion', 'catalogDigest',
        'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'players', 'board', 'resources', 'scoring',
        'unitMeta', 'retiredUnitTokenUIDs', 'frame'], 'playing state');
    check(match.stage === 'playing' && match.schemaVersion === 1 && match.rulesetId === 'riftbound-duel' &&
        id(match.matchId) && id(match.dataVersion) && id(match.catalogDigest) &&
        counter(match.stateVersion) && counter(match.eventSeq), 'common fields');
    dense(match.roster, 'roster');
    dense(match.turnOrder, 'turnOrder');
    check(match.roster.length === 2 && match.turnOrder.length === 2, 'two seats');
    const roster = match.roster.map(person => {
        plain(person, ['playerId', 'displayName'], 'roster seat');
        check(id(person.playerId) && id(person.displayName), 'roster seat identity');
        return { playerId: person.playerId, displayName: person.displayName };
    });
    const ids = roster.map(person => person.playerId);
    check(ids[0] !== ids[1] && new Set(match.turnOrder).size === 2 &&
        match.turnOrder.every(id => ids.includes(id)), 'turn order');
    assertDuelUnitLifecycleState(match);
    check(match.board.playerIds.every((id, i) => id === ids[i]), 'board/roster seats');
    const board = restoreDuelBoard(match.board);
    const resources = restoreDuelResources(match.resources, board.bases.map(base => ({ playerId: base.ownerPlayerId, locationId: base.locationId })));
    const scoring = restoreDuelScoring(match.scoring, board);
    const players = match.players.map(player => ({ playerId: player.playerId,
        champion: player.champion ? { uid: player.champion.uid, cardId: player.champion.cardId } : null,
        legend: { uid: player.legend.uid, cardId: player.legend.cardId },
        hand: player.hand.map(card => ({ uid: card.uid, cardId: card.cardId })),
        remainingMainDeck: player.remainingMainDeck.map(card => ({ uid: card.uid, cardId: card.cardId })),
        trash: player.trash.map(card => ({ uid: card.uid, cardId: card.cardId })),
    }));
    const unitMeta = Object.create(null);
    for (const [uid, meta] of Object.entries(match.unitMeta)) {
        Object.defineProperty(unitMeta, uid, { enumerable: true, writable: true, configurable: true,
            value: { ownerPlayerId: meta.ownerPlayerId, readied: meta.readied,
                damageMarks: meta.damageMarks.map(mark => ({ amount: mark.amount,
                    responsiblePlayerId: mark.responsiblePlayerId, sourceObjectIds: [...mark.sourceObjectIds] })),
                trait: meta.trait.kind === 'card' ? { kind: 'card', cardId: meta.trait.cardId } :
                    { kind: 'token', name: meta.trait.name, baseMight: meta.trait.baseMight, tags: [...meta.trait.tags] } } });
    }
    const frame = checkedFrame(match.frame, ids);
    // Do not equate `scoring.turnNumber` to the frame's turn before a turn executor advances
    // Beginning/Scoring; turn 0 scoring with constructor frame turn 1 is intentional.
    check(scoring.turnNumber <= frame.turnNumber, 'scoring exceeds frame turn');
    check(frame.phase !== 'awaiting-turn-start' || (frame.priorityPlayerId === null &&
        frame.pendingPayment === null), 'pre-turn authority');
    return { stage: 'playing', schemaVersion: 1, rulesetId: 'riftbound-duel', matchId: match.matchId,
        dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
        stateVersion: match.stateVersion, eventSeq: match.eventSeq, roster,
        turnOrder: [...match.turnOrder], players, board, resources, scoring,
        unitMeta, retiredUnitTokenUIDs: [...match.retiredUnitTokenUIDs], frame };
}
/**
 * Only this outer boundary publishes clocks. Trusted callback operates on a detached draft and may
 * return B helper output (helper version +1) or update the draft. No-op returns the original match;
 * failures throw with all authoritative values unchanged; this boundary may make their descriptors
 * read-only as part of the snapshot contract. Caller must persist the result before acknowledging it.
 */
export function commitDuelPlayingMutation(match, mutate) {
    // Validate every value before protecting the caller-owned authoritative graph. The callback gets
    // only a detached mutable draft, while a closure over `match` can no longer alter this snapshot.
    const original = detachedDuelPlaying(match);
    check(original.stateVersion < Number.MAX_SAFE_INTEGER && original.eventSeq < Number.MAX_SAFE_INTEGER, 'version overflow');
    freezeDuelSnapshot(match);
    const raw = mutate(detachedDuelPlaying(original));
    // A trusted callback can only return a draft or a one-step lifecycle-helper result. Check
    // immutable common fields before even reading/detaching candidate zones, and never publish
    // callback-owned references.
    check(raw.matchId === original.matchId && raw.dataVersion === original.dataVersion &&
        raw.catalogDigest === original.catalogDigest &&
        same(raw.roster, original.roster) && same(raw.turnOrder, original.turnOrder), 'match/catalog/roster/turn order changed');
    const next = detachedDuelPlaying(raw);
    check(next.stateVersion === original.stateVersion || next.stateVersion === original.stateVersion + 1, 'helper clock drift');
    check(next.eventSeq === original.eventSeq, 'event clock belongs to outer transaction');
    // A callback cannot mutate or roll back the input match even if it closes over that reference.
    check(same(detachedDuelPlaying(match), original), 'original match mutated');
    const unchanged = { ...next, stateVersion: original.stateVersion, eventSeq: original.eventSeq };
    if (same(unchanged, original))
        return match;
    const published = { ...next, stateVersion: original.stateVersion + 1, eventSeq: original.eventSeq + 1 };
    freezeDuelSnapshot(published);
    return published;
}

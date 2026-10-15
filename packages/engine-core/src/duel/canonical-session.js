// INTERNAL staged session wrapper. This file does not install an official turn executor or a public API.
import { resolveDuelMulligan, projectDuelMatch, } from './match-state.js';
import { projectPublicDuelBoard } from './battlefields.js';
import { projectPublicDuelUnitObjects } from './unit-lifecycle.js';
import { commitDuelPlayingMutation } from './canonical-transaction.js';
import { projectPublicDuelScoring } from './scoring.js';
import { activateBasicRuneEnergy, activateBasicRunePower, activateDuelGoldPower, payDuelRuneCost, projectPublicDuelResources, DUEL_DOMAINS, } from './resources.js';
const PHASES = ['awaiting-turn-start', 'awaken', 'beginning', 'scoring',
    'channel', 'draw', 'main', 'ending', 'expiration', 'ended'];
// Verify structurally that the approved constructor's initial frame is a subtype of the new frame.
const constructorIsCanonical = true;
void constructorIsCanonical;
const matchIsCanonical = true;
void matchIsCanonical;
function check(condition, message) {
    if (!condition)
        throw new TypeError(`Duel session: ${message}`);
}
function record(raw, required, optional = []) {
    check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'expected plain record');
    const prototype = Object.getPrototypeOf(raw);
    check(prototype === Object.prototype || prototype === null, 'expected plain record');
    const keys = Reflect.ownKeys(raw);
    check(keys.every(key => typeof key === 'string' && [...required, ...optional].includes(key)) &&
        required.every(key => keys.includes(key)) &&
        keys.every(key => 'value' in Object.getOwnPropertyDescriptor(raw, key)), 'unexpected or missing fields/accessors');
    return raw;
}
function list(raw) {
    check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype, 'expected plain array');
    check(Reflect.ownKeys(raw).length === raw.length + 1 &&
        Array.from({ length: raw.length }, (_, i) => Object.getOwnPropertyDescriptor(raw, String(i)))
            .every(descriptor => descriptor !== undefined && 'value' in descriptor), 'sparse/extra/accessor array');
    return raw;
}
function id(raw) {
    check(typeof raw === 'string' && raw.trim().length > 0, 'expected nonblank identifier');
    return raw;
}
function count(raw) {
    check(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0, 'expected nonnegative safe integer');
    return raw;
}
function semanticCommand(raw) {
    const command = record(raw, ['type'], ['selectedUIDs', 'uid', 'paymentId', 'plan']);
    switch (command.type) {
        case 'mulligan': {
            record(raw, ['type', 'selectedUIDs']);
            return { type: 'mulligan', selectedUIDs: list(command.selectedUIDs).map(id) };
        }
        case 'rune-energy':
        case 'rune-power':
        case 'gold-power':
            record(raw, ['type', 'uid']);
            return { type: command.type, uid: id(command.uid) };
        case 'pay-pending': {
            const payment = record(raw, ['type', 'paymentId'], ['plan']);
            const paymentId = id(payment.paymentId);
            if (!Object.hasOwn(payment, 'plan'))
                return { type: 'pay-pending', paymentId };
            const rawPlan = record(payment.plan, ['power']);
            const power = list(rawPlan.power).map(value => {
                const allocation = record(value, ['requirementIndex', 'from', 'amount']);
                check(typeof allocation.from === 'string' &&
                    [...DUEL_DOMAINS, 'any'].includes(allocation.from), 'invalid Power source');
                return { requirementIndex: count(allocation.requirementIndex),
                    from: allocation.from, amount: count(allocation.amount) };
            });
            return { type: 'pay-pending', paymentId, plan: { power } };
        }
        default: throw new TypeError('Duel session: unknown command type');
    }
}
function canonicalJSON(value) {
    // Only cloned, validated command objects reach here; sorting object keys ignores insertion order,
    // while arrays remain in submitted order. A fingerprint is not a secrecy-preserving hash.
    if (Array.isArray(value))
        return `[${value.map(canonicalJSON).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const object = value;
        return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(object[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function result(session, outcome, duplicate, persistRequired) {
    return { session, match: session.match, outcome, duplicate, persistRequired };
}
function detachedOutcome(outcome) {
    if (outcome.status === 'rejected')
        return { status: 'rejected', reason: outcome.reason };
    const completed = outcome.paymentCompleted;
    return { status: 'applied', appliedVersion: outcome.appliedVersion, eventSeq: outcome.eventSeq,
        ...(completed ? { paymentCompleted: { paymentId: completed.paymentId,
                sourceReference: { ...completed.sourceReference },
                plan: { power: completed.plan.power.map(item => ({ ...item })) },
                ...(completed.requiredTask ? { requiredTask: { ...completed.requiredTask } } : {}) } } : {}) };
}
function knownSeat(match, actor) {
    return typeof actor === 'string' && match.roster.some(person => person.playerId === actor);
}
function timing(frame) {
    return { stateOpen: frame.stateOpen, priorityPlayerId: frame.priorityPlayerId,
        resourcePaymentPlayerId: frame.pendingPayment?.actor ?? null };
}
function active(frame) {
    return PHASES.includes(frame.phase) && frame.phase !== 'awaiting-turn-start' &&
        frame.phase !== 'ended' && Number.isSafeInteger(frame.turnNumber) && frame.turnNumber > 0;
}
const issuedTasks = new WeakMap();
function taskIdentity(task) {
    return canonicalJSON(task);
}
function checkedRequiredTask(raw) {
    const task = record(raw, ['matchId', 'expectedVersion', 'taskId', 'paymentId', 'actor',
        'finalResolvedCost', 'opaqueSource', 'continuationId'], ['status']);
    if (Object.hasOwn(task, 'status'))
        check(task.status === 'issued' || task.status === 'active' ||
            task.status === 'completed', 'required task status');
    return { matchId: id(task.matchId), expectedVersion: count(task.expectedVersion),
        taskId: id(task.taskId), paymentId: id(task.paymentId), actor: id(task.actor),
        finalResolvedCost: detachedFinalCost(task.finalResolvedCost),
        opaqueSource: detachedSource(task.opaqueSource),
        continuationId: id(task.continuationId) };
}
function taskLedger(session) {
    return session.requiredTasks ?? [];
}
/**
 * Trusted TaskExecutor seam, NOT a client command. Issuing reserves both taskId and paymentId in
 * JSON-compatible private metadata before a required cost can be prepared. Persist this session
 * before acknowledging issuance; on restart a validated restore may reissue a fresh opaque handle
 * for the same unchanged 'issued' ledger entry through a trusted TaskExecutor, never for
 * active/completed tasks. An unvalidated JSON payload MUST NOT be used as a trusted session.
 */
export function issueDuelRequiredCostTask(session, raw) {
    const task = checkedRequiredTask(raw);
    check(!Object.hasOwn(raw, 'status'), 'required task issuance cannot set status');
    check(session.match.stage === 'playing' && session.match.matchId === task.matchId &&
        session.match.stateVersion === task.expectedVersion && knownSeat(session.match, task.actor), 'required task match/actor/expectedVersion');
    checkedFrame(session.match.frame, session.match);
    check(active(session.match.frame) && session.match.frame.pendingPayment === null, 'required task window');
    check(session.match.eventSeq === session.match.stateVersion, 'required task clock mismatch');
    const ledger = taskLedger(session);
    check(!ledger.some(entry => entry.status === 'active'), 'another required task is active');
    check(!session.receipts.some(receipt => receipt.outcome.status === 'applied' &&
        receipt.outcome.paymentCompleted?.paymentId === task.paymentId), 'payment ID already completed');
    const collisions = ledger.filter(entry => entry.taskId === task.taskId || entry.paymentId === task.paymentId);
    check(collisions.length <= 1, 'duplicate required task identity');
    const existing = collisions[0];
    if (existing)
        check(existing.status === 'issued' && existing.taskId === task.taskId &&
            existing.paymentId === task.paymentId && taskIdentity(checkedRequiredTask(existing)) === taskIdentity(task), 'required task ID conflict or already active/completed');
    const prepared = existing ? session : { ...session, requiredTasks: [...ledger, { ...task, status: 'issued' }] };
    const authority = Object.freeze(Object.create(null));
    issuedTasks.set(authority, { session: prepared, task });
    return { session: prepared, authority, persistRequired: !existing };
}
/** Consume only an issued in-process capability, with exact session/ledger/clock binding. */
export function prepareDuelRequiredCostPayment(session, authority) {
    const issued = authority !== null && typeof authority === 'object' ? issuedTasks.get(authority) : undefined;
    check(issued && issued.session === session, 'unissued or stale required task authority');
    const task = issued.task, match = session.match;
    check(match.stage === 'playing' && active(match.frame) && match.frame.pendingPayment === null &&
        match.eventSeq === match.stateVersion &&
        match.matchId === task.matchId && match.stateVersion === task.expectedVersion &&
        knownSeat(match, task.actor), 'expired required task or mismatched match/actor/payment');
    const ledger = taskLedger(session);
    const entry = ledger.find(item => item.taskId === task.taskId);
    check(!ledger.some(item => item.status === 'active') &&
        !session.receipts.some(receipt => receipt.outcome.status === 'applied' &&
            receipt.outcome.paymentCompleted?.paymentId === task.paymentId), 'already active or paid task');
    check(ledger.filter(item => item.taskId === task.taskId || item.paymentId === task.paymentId).length === 1, 'required task duplicate ID collision');
    check(entry && entry.status === 'issued' && entry.paymentId === task.paymentId &&
        taskIdentity(checkedRequiredTask(entry)) === taskIdentity(task), 'required task ledger mismatch');
    const pendingPayment = { paymentId: task.paymentId, actor: task.actor,
        resolvedCost: detachedFinalCost(task.finalResolvedCost), sourceReference: detachedSource(task.opaqueSource) };
    const next = commitDuelPlayingMutation(match, draft => ({ ...draft, frame: { ...draft.frame, pendingPayment } }));
    const updated = { ...session, match: next,
        requiredTasks: ledger.map(item => item.taskId === task.taskId ? { ...entry, status: 'active' } : item) };
    issuedTasks.delete(authority);
    return { session: updated, persistRequired: true };
}
function activeRequiredTask(session, pending) {
    const active = taskLedger(session).filter(entry => entry.status === 'active');
    check(active.length <= 1, 'multiple active required tasks');
    const entry = active[0];
    if (entry) {
        const task = checkedRequiredTask(entry);
        check(pending !== null && task.matchId === session.match.matchId &&
            task.actor === pending.actor && task.paymentId === pending.paymentId &&
            canonicalJSON(task.finalResolvedCost) === canonicalJSON(pending.resolvedCost) &&
            canonicalJSON(task.opaqueSource) === canonicalJSON(pending.sourceReference), 'active required task/pending mismatch');
    }
    return entry;
}
function advanced(match, updates) {
    return commitDuelPlayingMutation(match, draft => ({ ...draft, ...updates }));
}
/** Trusted executor may inject RNG for mulligan recycling; the client cannot set it in its command. */
export function applyDuelResourceCommand(session, authenticatedActor, envelope, trusted) {
    // No archive validation here: session comes from trusted server memory or an independently
    // validated/durable restore. An invalid transport envelope cannot claim a ledger entry.
    let commandId, expectedVersion, command;
    try {
        const raw = record(envelope, ['commandId', 'expectedVersion', 'command']);
        commandId = id(raw.commandId);
        expectedVersion = count(raw.expectedVersion);
        command = semanticCommand(raw.command);
    }
    catch {
        return result(session, { status: 'rejected', reason: 'invalid-command' }, false, false);
    }
    if (!knownSeat(session.match, authenticatedActor))
        return result(session, { status: 'rejected', reason: 'unknown-actor' }, false, false);
    const fingerprint = canonicalJSON(command);
    // A durable ledger is append-only and unique per (actor, commandId). Malformed restored
    // sessions are outside this staged executor's contract; archive validation belongs upstream.
    const existing = session.receipts.find(receipt => receipt.actor === authenticatedActor && receipt.commandId === commandId);
    if (existing)
        return existing.payloadFingerprint === fingerprint
            ? result(session, detachedOutcome(existing.outcome), true, false)
            : result(session, { status: 'rejected', reason: 'command-conflict' }, false, false);
    let next = session.match;
    let completedTaskId;
    let outcome;
    if (expectedVersion !== next.stateVersion) {
        outcome = { status: 'rejected', reason: 'stale-version' };
    }
    else if (next.stateVersion >= Number.MAX_SAFE_INTEGER || next.eventSeq >= Number.MAX_SAFE_INTEGER) {
        outcome = { status: 'rejected', reason: 'version-overflow' };
    }
    else if (command.type === 'mulligan') {
        if (next.stage !== 'setup')
            outcome = { status: 'rejected', reason: 'invalid-stage' };
        else {
            try {
                next = resolveDuelMulligan(next, authenticatedActor, command.selectedUIDs, trusted?.randomIndex);
                outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq };
            }
            catch {
                outcome = { status: 'rejected', reason: 'mulligan-rejected' };
            }
        }
    }
    else if (next.stage !== 'playing') {
        outcome = { status: 'rejected', reason: 'invalid-stage' };
    }
    else if (!active(next.frame)) {
        outcome = { status: 'rejected', reason: 'invalid-phase' };
    }
    else {
        // A playing frame comes only from the trusted turn executor; fail closed on malformed
        // snapshots rather than silently trusting a forged Priority/payment actor.
        try {
            checkedFrame(next.frame, next);
        }
        catch {
            outcome = { status: 'rejected', reason: 'invalid-phase' };
        }
    }
    if (outcome === undefined && command.type === 'pay-pending' && next.stage === 'playing') {
        const pending = next.frame.pendingPayment;
        if (!pending || pending.paymentId !== command.paymentId || pending.actor !== authenticatedActor) {
            outcome = { status: 'rejected', reason: 'no-permission' };
        }
        else {
            try {
                const required = activeRequiredTask(session, pending);
                const paid = payDuelRuneCost(next.resources, authenticatedActor, pending.resolvedCost, timing(next.frame), command.plan);
                const completed = { paymentId: pending.paymentId,
                    sourceReference: { ...pending.sourceReference },
                    plan: { power: paid.plan.power.map(entry => ({ ...entry })) },
                    ...(required ? { requiredTask: { taskId: required.taskId,
                            continuationId: required.continuationId } } : {}) };
                next = advanced(next, { resources: paid.resources, frame: { ...next.frame, pendingPayment: null } });
                completedTaskId = required?.taskId;
                outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq,
                    paymentCompleted: completed };
            }
            catch {
                outcome = { status: 'rejected', reason: 'payment-rejected' };
            }
        }
    }
    else if (outcome === undefined && next.stage === 'playing' &&
        (command.type === 'rune-energy' || command.type === 'rune-power' || command.type === 'gold-power')) {
        // Resolve the private ledger binding before applying the ordinary Priority rule. A required
        // task owns the whole payment-resource window: Priority may still point at the other seat, but
        // that seat cannot react until the bound actor completes the task. Do not infer this from the
        // pending actor alone; the ledger also authenticates task identity, cost, and source.
        let required;
        try {
            required = activeRequiredTask(session, next.frame.pendingPayment);
        }
        catch {
            outcome = { status: 'rejected', reason: 'resource-rejected' };
        }
        if (outcome === undefined && required && required.actor !== authenticatedActor) {
            outcome = { status: 'rejected', reason: 'no-permission' };
        }
        else if (outcome === undefined && next.frame.priorityPlayerId !== authenticatedActor &&
            next.frame.pendingPayment?.actor !== authenticatedActor) {
            // Preserve the ordinary Priority or payment-owner path once task restrictions are satisfied.
            outcome = { status: 'rejected', reason: 'no-permission' };
        }
        else if (outcome === undefined) {
            try {
                const source = command.type === 'rune-energy'
                    ? activateBasicRuneEnergy(next.resources, authenticatedActor, command.uid, timing(next.frame))
                    : command.type === 'rune-power'
                        ? activateBasicRunePower(next.resources, authenticatedActor, command.uid, timing(next.frame))
                        : activateDuelGoldPower(next.resources, authenticatedActor, command.uid, timing(next.frame));
                next = advanced(next, { resources: source });
                outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq };
            }
            catch {
                outcome = { status: 'rejected', reason: 'resource-rejected' };
            }
        }
    }
    check(outcome !== undefined, 'unhandled command outcome');
    const receipt = { actor: authenticatedActor, commandId,
        payloadFingerprint: fingerprint, outcome: detachedOutcome(outcome) };
    const updated = { ...session, match: next, receipts: [...session.receipts, receipt],
        ...(completedTaskId ? { requiredTasks: taskLedger(session).map(entry => entry.taskId === completedTaskId ? { ...entry, status: 'completed' } : entry) } : {}) };
    return result(updated, detachedOutcome(receipt.outcome), false, true);
}
function detachedFinalCost(raw) {
    const cost = record(raw, ['energy', 'power']);
    const energy = count(cost.energy);
    let total = energy;
    const power = list(cost.power).map(value => {
        const requirement = record(value, ['allowedDomains', 'amount']);
        const domains = list(requirement.allowedDomains).map(value => {
            check(typeof value === 'string' && DUEL_DOMAINS.includes(value), 'invalid cost domain');
            return value;
        });
        check(domains.length > 0 && domains.length <= DUEL_DOMAINS.length &&
            new Set(domains).size === domains.length, 'invalid cost domain set');
        const amount = count(requirement.amount);
        check(amount > 0, 'zero Power requirement');
        total += amount;
        check(Number.isSafeInteger(total), 'cost overflow');
        return { allowedDomains: domains, amount };
    });
    return { energy, power };
}
function detachedSource(raw) {
    const source = record(raw, ['kind', 'referenceId'], ['sourceUID']);
    check(source.kind === 'card' || source.kind === 'effect', 'source kind');
    return { kind: source.kind, referenceId: id(source.referenceId),
        ...(Object.hasOwn(source, 'sourceUID') ? { sourceUID: id(source.sourceUID) } : {}) };
}
/** Validated trusted turn-frame shape; not a public setter or an official turn transition. */
function checkedFrame(frame, match) {
    const raw = record(frame, ['phase', 'turnNumber', 'turnPlayerId', 'priorityPlayerId',
        'focusPlayerId', 'stateOpen', 'pendingPayment']);
    check(PHASES.some(phase => phase === raw.phase), 'frame phase');
    check(count(raw.turnNumber) > 0, 'frame turn number');
    check(knownSeat(match, raw.turnPlayerId), 'frame turn player');
    check(raw.priorityPlayerId === null || knownSeat(match, raw.priorityPlayerId), 'frame priority player');
    check(raw.focusPlayerId === null || knownSeat(match, raw.focusPlayerId), 'frame focus player');
    check(typeof raw.stateOpen === 'boolean', 'frame Open/Closed');
    if (raw.pendingPayment !== null) {
        const payment = record(raw.pendingPayment, ['paymentId', 'actor', 'resolvedCost', 'sourceReference']);
        id(payment.paymentId);
        check(knownSeat(match, payment.actor), 'pending payment actor');
        detachedFinalCost(payment.resolvedCost);
        detachedSource(payment.sourceReference);
        check(raw.phase !== 'awaiting-turn-start' && raw.phase !== 'ended', 'pending payment phase');
    }
}
/** Trusted ordinary preparation + outer clock allocation; session metadata remains private. */
export function commitDuelPriorityPayment(session, actor, paymentId, finalResolvedCost, opaqueSource) {
    check(session.match.stage === 'playing' && !taskLedger(session).some(entry => entry.status === 'active'), 'priority preparation while required task active or not playing');
    check(!taskLedger(session).some(entry => entry.paymentId === paymentId) &&
        !session.receipts.some(receipt => receipt.outcome.status === 'applied' &&
            receipt.outcome.paymentCompleted?.paymentId === paymentId), 'payment ID reserved or completed');
    const next = commitDuelPlayingMutation(session.match, draft => prepareDuelPayment(draft, actor, paymentId, finalResolvedCost, opaqueSource));
    check(next !== session.match, 'payment preparation must install pending');
    return { session: { ...session, match: next }, persistRequired: true };
}
/** Trusted Cost Resolver only. Pure transform: outer transaction owns version, persistence, and continuation. */
export function prepareDuelPayment(match, actor, paymentId, resolvedCost, sourceReference) {
    check(match.stage === 'playing', 'payment preparation requires playing');
    checkedFrame(match.frame, match);
    check(active(match.frame), 'payment preparation requires an active turn phase');
    check(knownSeat(match, actor) && match.frame.priorityPlayerId === actor, 'trusted payment preparation requires current priority actor');
    check(match.frame.pendingPayment === null, 'payment already pending');
    const pendingPayment = { paymentId: id(paymentId), actor,
        resolvedCost: detachedFinalCost(resolvedCost), sourceReference: detachedSource(sourceReference) };
    // Pure preparation for a trusted outer card transaction: caller must commit this via the outer
    // allocator. Required-cost bypass is only available through the issued task/session path above.
    return { ...match, frame: { ...match.frame, pendingPayment } };
}
/** Public allowlist from the one current match; the private session ledger is never an input. */
export function projectCanonicalDuelMatch(match, viewer) {
    check(viewer === null || knownSeat(match, viewer), 'unknown viewer');
    if (match.stage === 'setup')
        return projectDuelMatch(match, viewer);
    const players = match.players.map((player) => ({
        playerId: player.playerId, champion: player.champion ? { cardId: player.champion.cardId } : null,
        legend: { cardId: player.legend.cardId }, handCount: player.hand.length,
        mainDeckCount: player.remainingMainDeck.length,
        ...(viewer === player.playerId ? { hand: player.hand.map(card => ({ uid: card.uid, cardId: card.cardId })) } : {}),
        trash: player.trash.map(card => ({ uid: card.uid, cardId: card.cardId })),
    }));
    const pending = match.frame.pendingPayment;
    const pendingPayment = pending === null ? null
        : viewer === pending.actor
            ? { active: true, paymentId: pending.paymentId, resolvedCost: detachedFinalCost(pending.resolvedCost) }
            : { active: true };
    return { schemaVersion: match.schemaVersion, rulesetId: match.rulesetId,
        matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
        stateVersion: match.stateVersion, eventSeq: match.eventSeq,
        roster: match.roster.map(person => ({ playerId: person.playerId, displayName: person.displayName })),
        turnOrder: [...match.turnOrder], stage: 'playing', players,
        board: { ...projectPublicDuelBoard(match.board),
            units: match.board.units.length ? projectPublicDuelUnitObjects(match) : [] },
        resources: projectPublicDuelResources(match.resources),
        scoring: projectPublicDuelScoring(match.scoring, match.board),
        frame: { phase: match.frame.phase, turnNumber: match.frame.turnNumber,
            turnPlayerId: match.frame.turnPlayerId, priorityPlayerId: match.frame.priorityPlayerId,
            focusPlayerId: match.frame.focusPlayerId, stateOpen: match.frame.stateOpen, pendingPayment }, };
}

// CR v1.4 316.9, 317, 318–324, 333–335. INTERNAL trusted Ending executor.
// The canonical match alone owns game state. This private sidecar records only task identities,
// iteration counters and the clock at which a pending task was issued; it is not a wire/archive API.
import { commitDuelPlayingMutation, detachedDuelPlaying } from './canonical-transaction.js';
import { clearAllDuelRunePools } from './resources.js';
import { getDuelWinnerAtCleanup } from './scoring.js';
import { healAllDuelUnitDamage, queryLethalDuelUnitCandidates, planDuelUnitKills, commitApprovedDuelUnitKills, } from './unit-lifecycle.js';
const STEPS = ['ending-effects', 'special-designations', 'special-lethal',
    'special-expiration', 'special-remaining', 'special-fepr', 'ordinary-designations',
    'ordinary-lethal', 'ordinary-remaining', 'ordinary-fepr', 'awaiting-turn-start', 'ended'];
const CURSOR_FIELDS = ['kind', 'turn', 'rootTaskID', 'step', 'expirationIteration', 'cleanupRound',
    'cleanupChanged', 'feprProcessed', 'pendingTaskID', 'consumedIDs', 'stateVersion', 'eventSeq'];
const FLOW_FIELDS = ['kind', 'turn', 'rootTaskID', 'step', 'holdIndex', 'pendingTaskID',
    'consumedIDs', 'firstChannelProcessedPlayerIDs', 'drawCursor'];
function plain(value, fields) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
        return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === fields.length && fields.every(key => keys.includes(key)) &&
        keys.every(key => typeof key === 'string' && 'value' in Object.getOwnPropertyDescriptor(value, key));
}
function id(value) { return typeof value === 'string' && value.trim().length > 0; }
function count(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function ids(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        Reflect.ownKeys(value).length !== value.length + 1)
        return false;
    for (let i = 0; i < value.length; i++) {
        const entry = Object.getOwnPropertyDescriptor(value, String(i));
        if (!entry || !('value' in entry) || !id(entry.value))
            return false;
    }
    return new Set(value).size === value.length;
}
function ownData(value, key) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function playing(session) {
    return session.match.stage === 'playing' ? session.match : undefined;
}
function root(match) {
    return `duel-ending:${match.matchId}:turn-${match.frame.turnNumber}`;
}
function rootFor(matchId, turn) {
    return `duel-ending:${matchId}:turn-${turn}`;
}
function cleanupKind(step) {
    return step.startsWith('special-') ? 'special' : step.startsWith('ordinary-') ? 'ordinary' : null;
}
function kind(step) {
    if (step === 'ending-effects')
        return 'ending-effects';
    if (step.endsWith('-designations'))
        return 'required-cleanup';
    if (step.endsWith('-lethal'))
        return 'lethal-kill';
    if (step === 'special-expiration')
        return 'simultaneous-this-turn-expiration';
    if (step.endsWith('-remaining'))
        return 'remaining-cleanup';
    if (step.endsWith('-fepr'))
        return 'fepr';
    return null;
}
function task(cursor) {
    return `${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-${cursor.cleanupRound}:${cursor.step}`;
}
function pending(cursor) {
    return { taskId: task(cursor), kind: kind(cursor.step), turn: cursor.turn,
        expirationIteration: cursor.expirationIteration, cleanupRound: cursor.cleanupRound };
}
function response(session, status, persistRequired, reason) {
    const cursor = session.endingProgress;
    return { session, status, persistRequired, ...(reason ? { reason } : {}),
        ...(status === 'pending' && cursor ? { pending: pending(cursor) } : {}) };
}
function reject(session, reason) {
    return response(session, 'rejected', false, reason);
}
function withCursor(session, cursor) {
    return { ...session, endingProgress: cursor };
}
function sync(session, cursor) {
    const match = playing(session);
    return { ...cursor, stateVersion: match.stateVersion, eventSeq: match.eventSeq };
}
function commit(session, mutate) {
    const before = playing(session);
    const after = commitDuelPlayingMutation(before, mutate);
    return after === before ? session : { ...session, match: after };
}
function transition(session, phase) {
    return commit(session, match => ({ ...match, frame: { ...match.frame, phase,
            priorityPlayerId: null, focusPlayerId: null, stateOpen: true, pendingPayment: null,
            ...(phase === 'awaiting-turn-start' ? { turnNumber: match.frame.turnNumber + 1,
                turnPlayerId: match.turnOrder[(match.turnOrder.indexOf(match.frame.turnPlayerId) + 1) % 2] } : {}) } }));
}
function expectedPhase(step) {
    return step === 'ending-effects' ? 'ending' :
        step === 'awaiting-turn-start' ? 'awaiting-turn-start' : step === 'ended' ? 'ended' : 'expiration';
}
function parsedCursor(session) {
    const match = playing(session), raw = session.endingProgress;
    if (!match || !plain(raw, CURSOR_FIELDS) || raw.kind !== 'ending' || !count(raw.turn) || raw.turn < 1 ||
        !id(raw.rootTaskID) || !STEPS.includes(raw.step) ||
        !count(raw.expirationIteration) || !count(raw.cleanupRound) ||
        typeof raw.cleanupChanged !== 'boolean' || typeof raw.feprProcessed !== 'boolean' ||
        (raw.pendingTaskID !== null && !id(raw.pendingTaskID)) ||
        !ids(raw.consumedIDs) || !count(raw.stateVersion) || !count(raw.eventSeq))
        return null;
    const cursor = raw;
    if (cursor.rootTaskID !== rootFor(match.matchId, cursor.turn) ||
        cursor.consumedIDs.length > 512 || cursor.expirationIteration > 64 || cursor.cleanupRound > 64 ||
        (cursor.cleanupRound > 0 && !cursor.consumedIDs.includes(`${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-0:special-remaining`)) ||
        cursor.consumedIDs.some(value => !value.startsWith(`${cursor.rootTaskID}:expiration-`) ||
            !/^expiration-(0|[1-9]\d*):cleanup-(0|[1-9]\d*):(ending-effects|special-designations|special-lethal|special-expiration|special-remaining|special-fepr|ordinary-designations|ordinary-lethal|ordinary-remaining|ordinary-fepr)$/.test(value.slice(cursor.rootTaskID.length + 1))))
        return null;
    const terminal = cursor.step === 'awaiting-turn-start' || cursor.step === 'ended';
    if (cursor.pendingTaskID !== null && (terminal || cursor.pendingTaskID !== task(cursor) ||
        cursor.consumedIDs.includes(cursor.pendingTaskID)))
        return null;
    if (cursor.step === 'ending-effects' && (cursor.expirationIteration !== 0 || cursor.cleanupRound !== 0 ||
        cursor.consumedIDs.length !== 0))
        return null;
    if (cleanupKind(cursor.step) === 'special' && cursor.cleanupRound !== 0)
        return null;
    if (cursor.step === 'ending-effects' && cursor.feprProcessed)
        return null;
    if (cursor.step === 'special-designations' && cursor.expirationIteration > 0 &&
        !cursor.consumedIDs.includes(`${cursor.rootTaskID}:expiration-${cursor.expirationIteration - 1}:cleanup-0:special-fepr`))
        return null;
    if (cursor.feprProcessed && !cursor.consumedIDs.some(value => value.startsWith(`${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-`) &&
        (value.endsWith(':special-fepr') || value.endsWith(':ordinary-fepr'))))
        return null;
    if (terminal && cursor.feprProcessed)
        return null;
    if (cursor.consumedIDs.length > 0 &&
        cursor.consumedIDs[0] !== `${cursor.rootTaskID}:expiration-0:cleanup-0:ending-effects`)
        return null;
    if (cursor.step !== 'ending-effects' &&
        !cursor.consumedIDs.includes(`${cursor.rootTaskID}:expiration-0:cleanup-0:ending-effects`))
        return null;
    const base = `${cursor.rootTaskID}:expiration-${cursor.expirationIteration}:cleanup-${cursor.cleanupRound}:`;
    const has = (step) => cursor.consumedIDs.includes(`${base}${step}`);
    if (cursor.consumedIDs.includes(task(cursor)) && !terminal)
        return null;
    if (cursor.step === 'special-lethal' && !has('special-designations') ||
        cursor.step === 'special-expiration' && !has('special-lethal') ||
        cursor.step === 'special-remaining' && !has('special-expiration') ||
        cursor.step === 'special-fepr' && !has('special-remaining') ||
        cursor.step === 'ordinary-lethal' && !has('ordinary-designations') ||
        cursor.step === 'ordinary-remaining' && !has('ordinary-lethal') ||
        cursor.step === 'ordinary-fepr' && !has('ordinary-remaining'))
        return null;
    if (cleanupKind(cursor.step) === 'ordinary' && cursor.cleanupRound < 1)
        return null;
    if (!terminal && (cursor.turn !== match.frame.turnNumber ||
        expectedPhase(cursor.step) !== match.frame.phase ||
        cursor.stateVersion !== match.stateVersion || cursor.eventSeq !== match.eventSeq ||
        match.frame.priorityPlayerId !== null || match.frame.focusPlayerId !== null ||
        !match.frame.stateOpen || match.frame.pendingPayment !== null ||
        match.scoring.turnNumber !== match.frame.turnNumber ||
        match.board.battlefields.some(field => field.combat === 'active' || field.showdown === 'active')))
        return null;
    if (terminal && (cursor.pendingTaskID !== null || cursor.cleanupChanged ||
        match.frame.turnNumber < cursor.turn ||
        (cursor.step === 'ended' && (match.frame.turnNumber !== cursor.turn || match.frame.phase !== 'ended')) ||
        (cursor.step === 'awaiting-turn-start' && (match.frame.turnNumber !== cursor.turn + 1 ||
            (match.frame.phase === 'awaiting-turn-start' &&
                (match.scoring.turnNumber !== cursor.turn ||
                    match.stateVersion !== cursor.stateVersion || match.eventSeq !== cursor.eventSeq)) ||
            (match.frame.phase !== 'awaiting-turn-start' && match.scoring.turnNumber !== match.frame.turnNumber)))))
        return null;
    return cursor;
}
/** The 83 cursor must be genuinely completed in the current Main; do not accept a manually forged
 * phase or an outstanding prefix/flow task as permission to end a turn. */
function validMain(session, actor) {
    const match = playing(session);
    if (!match)
        return 'invalid-stage';
    const frame = match.frame, flow = session.turnFlow;
    if (!id(actor) || !match.turnOrder.includes(actor) || !Number.isSafeInteger(frame.turnNumber) ||
        frame.turnNumber < 1 || match.turnOrder.indexOf(frame.turnPlayerId) < 0)
        return 'invalid-session';
    if (frame.phase !== 'main' || frame.turnPlayerId !== actor || frame.priorityPlayerId !== actor ||
        frame.focusPlayerId !== null || frame.pendingPayment !== null || !frame.stateOpen ||
        match.scoring.turnNumber !== frame.turnNumber)
        return 'invalid-phase';
    if (!plain(flow, FLOW_FIELDS) || flow.kind !== 'turn-flow' || flow.step !== 'main' ||
        flow.turn !== frame.turnNumber || flow.rootTaskID !== `duel-turn-start:${match.matchId}:turn-${frame.turnNumber}` ||
        flow.pendingTaskID !== null || flow.drawCursor !== null || !ids(flow.consumedIDs) ||
        !ids(flow.firstChannelProcessedPlayerIDs) ||
        !flow.firstChannelProcessedPlayerIDs.every(seat => seat === match.turnOrder[1]) ||
        !['channel-effects', 'draw-effects', 'main-effects'].every(name => flow.consumedIDs.includes(`${flow.rootTaskID}:flow:${name}`)))
        return 'invalid-session';
    const prefix = session.turnProgress;
    if (prefix && (prefix.turn !== frame.turnNumber || prefix.step !== 'scoring' ||
        prefix.pendingTaskID !== null ||
        prefix.rootTaskID !== `duel-turn-start:${match.matchId}:turn-${frame.turnNumber}`))
        return 'task-conflict';
    const required = ownData(session, 'requiredTasks');
    if (required !== undefined && (!Array.isArray(required) || required.some(entry => ownData(entry, 'status') === 'active' || ownData(entry, 'status') === 'issued')))
        return 'task-conflict';
    if (match.board.battlefields.some(field => field.combat !== 'none' || field.showdown !== 'none'))
        return 'engagement-in-progress';
    return null;
}
function context(session, cursor) {
    const match = playing(session);
    return { match: detachedDuelPlaying(match), turnPlayerId: match.frame.turnPlayerId,
        turnNumber: cursor.turn, taskId: task(cursor), kind: kind(cursor.step),
        expirationIteration: cursor.expirationIteration, cleanupRound: cursor.cleanupRound,
        cleanupKind: cleanupKind(cursor.step) };
}
function isPending(raw) { return plain(raw, ['status']) && raw.status === 'pending'; }
function hook(raw) {
    return (plain(raw, ['status']) && raw.status === 'verified-no-effect') ||
        (plain(raw, ['status', 'match']) && raw.status === 'applied');
}
function installed(session, proposal) {
    const before = playing(session);
    const candidate = detachedDuelPlaying(proposal);
    if (candidate.frame.phase !== before.frame.phase ||
        candidate.frame.turnNumber !== before.frame.turnNumber ||
        candidate.frame.turnPlayerId !== before.frame.turnPlayerId ||
        candidate.frame.priorityPlayerId !== before.frame.priorityPlayerId ||
        candidate.frame.focusPlayerId !== before.frame.focusPlayerId ||
        candidate.frame.stateOpen !== before.frame.stateOpen ||
        candidate.frame.pendingPayment !== null ||
        candidate.scoring.turnNumber !== before.scoring.turnNumber ||
        candidate.stateVersion !== before.stateVersion || candidate.eventSeq !== before.eventSeq)
        throw new TypeError('Ending provider changed frame, scoring turn or clocks');
    const next = commit(session, () => candidate);
    if (next === session)
        throw new TypeError('Applied Ending provider did not change the aggregate');
    return next;
}
function consumed(cursor) {
    if (cursor.consumedIDs.includes(task(cursor)))
        throw new TypeError('Task already consumed');
    return { ...cursor, pendingTaskID: null, consumedIDs: [...cursor.consumedIDs, task(cursor)] };
}
function advance(cursor, step, options = {}) {
    return { ...cursor, ...options, step, pendingTaskID: null };
}
function wait(session, cursor) {
    return response(withCursor(session, { ...sync(session, cursor), pendingTaskID: task(cursor) }), 'pending', true);
}
function service(services, step) {
    if (step === 'ending-effects')
        return services.endingEffects;
    if (step.endsWith('-designations'))
        return services.requiredCleanup;
    if (step === 'special-expiration')
        return services.simultaneousThisTurnExpiration;
    if (step.endsWith('-remaining'))
        return services.remainingCleanup;
    if (step.endsWith('-fepr'))
        return services.fepr;
    return undefined;
}
function winner(session, cursor) {
    const match = playing(session);
    if (getDuelWinnerAtCleanup(match.scoring, match.board) === null)
        return null;
    const ended = transition(session, 'ended');
    const complete = advance(sync(ended, cursor), 'ended', { cleanupChanged: false });
    return response(withCursor(ended, complete), 'ended', true);
}
function settledHook(session, cursor, raw) {
    if (!hook(raw))
        throw new TypeError('Uncertified required Ending effect');
    const applied = raw.status === 'applied' ? installed(session, raw.match) : session;
    const changed = applied !== session;
    const done = sync(applied, consumed(cursor));
    if (cursor.step === 'ending-effects') {
        const next = transition(applied, 'expiration');
        return { session: next, cursor: advance(sync(next, done), 'special-designations') };
    }
    if (cursor.step.endsWith('-designations'))
        return { session: applied, cursor: advance(done, cursor.step === 'special-designations' ? 'special-lethal' : 'ordinary-lethal', { cleanupChanged: cursor.cleanupChanged || changed }) };
    if (cursor.step === 'special-expiration') {
        // The 317.2d expiration provider runs BEFORE the 317.2e pool clear; neither is a no-op by default.
        const cleared = commit(applied, draft => ({ ...draft,
            resources: clearAllDuelRunePools(draft.resources) }));
        return { session: cleared, cursor: advance(sync(cleared, done), 'special-remaining', { cleanupChanged: cursor.cleanupChanged || changed || cleared !== applied }) };
    }
    if (cursor.step.endsWith('-remaining'))
        return { session: applied, cursor: advance(done, cursor.step === 'special-remaining' ? 'special-fepr' : 'ordinary-fepr', { cleanupChanged: cursor.cleanupChanged || changed }) };
    throw new TypeError('Unexpected Ending effect step');
}
function lethalPlan(session, services) {
    const match = playing(session);
    if (match.board.units.length === 0)
        return null;
    const evaluators = services.lethalEvaluators;
    if (!evaluators)
        return undefined;
    // A trusted evaluator receives a detached validated aggregate's Unit view. It cannot turn
    // printed Might into a guess when temporary buffs/altered lethal thresholds are unknown.
    const candidate = detachedDuelPlaying(match);
    const lethal = queryLethalDuelUnitCandidates(candidate, {
        currentMight: unit => evaluators.currentMight(structuredClone(unit)),
        lethalDamageThreshold: (unit, might) => evaluators.lethalDamageThreshold(structuredClone(unit), might),
    });
    return lethal.length ? planDuelUnitKills(candidate, lethal.map(unit => unit.objectId), 'passive') : null;
}
function finishLethal(session, cursor, plan, raw) {
    let next = session;
    if (plan !== null) {
        if (!plain(raw, ['status', 'approvedUnitUIDs']) || raw.status !== 'approved' || !ids(raw.approvedUnitUIDs) ||
            !raw.approvedUnitUIDs.every(uid => plan.snapshots.some(snapshot => snapshot.objectId === uid)))
            throw new TypeError('Missing trusted Deathknell/Kill approval');
        const approved = [...raw.approvedUnitUIDs];
        next = commit(session, draft => commitApprovedDuelUnitKills(draft, { plan, approvedUnitUIDs: approved }).state);
    }
    const done = sync(next, consumed(cursor));
    if (cursor.step === 'ordinary-lethal')
        return { session: next,
            cursor: advance(done, 'ordinary-remaining', { cleanupChanged: cursor.cleanupChanged || next !== session }) };
    // Heal only surviving Units, after PRE-exit Deathknell snapshots and actual approved Kills.
    const healed = commit(next, draft => {
        const damaged = draft.board.units.filter(unit => draft.unitMeta[unit.objectId].damageMarks.length > 0)
            .map(unit => unit.objectId);
        return damaged.length ? healAllDuelUnitDamage(draft, damaged).state : draft;
    });
    return { session: healed, cursor: advance(sync(healed, done), 'special-expiration', { cleanupChanged: cursor.cleanupChanged || next !== session || healed !== next }) };
}
function finishFEPR(session, cursor, raw) {
    // Repeat an ordinary cleanup BEFORE FEPR if a special/ordinary cleanup caused another cleanup.
    if (cursor.cleanupChanged)
        throw new TypeError('FEPR before repeating required cleanup');
    if (!plain(raw, ['status']) && !plain(raw, ['status', 'match']))
        throw new TypeError('Uncertified FEPR outcome');
    if (raw.status === 'processed') {
        if (!Object.hasOwn(raw, 'match'))
            throw new TypeError('FEPR must supply an actual aggregate');
        const applied = installed(session, raw.match);
        const done = consumed(cursor);
        // 334.2.a: FEPR can create further outstanding cleanups. Resolve those as ordinary
        // cleanups first; only then may 317.2.f replay Expiration. Remember the processed item
        // in scalar metadata so a later `verified-no-effect` does not erase the replay duty.
        return { session: applied, cursor: advance(sync(applied, done), 'ordinary-designations', { cleanupRound: cursor.cleanupRound + 1, cleanupChanged: false, feprProcessed: true }) };
    }
    if (raw.status !== 'verified-no-effect' || Object.hasOwn(raw, 'match'))
        throw new TypeError('Uncertified FEPR outcome');
    const done = consumed(cursor);
    if (cursor.feprProcessed) {
        // The last ordinary cleanup is stable; at least one FEPR item was processed in this
        // Expiration iteration. Return to 317.2's beginning (not 317.1 Ending effects).
        const specialID = `${done.rootTaskID}:expiration-${done.expirationIteration}:cleanup-0:special-fepr`;
        const replay = done.step === 'ordinary-fepr' && !done.consumedIDs.includes(specialID)
            ? { ...done, consumedIDs: [...done.consumedIDs, specialID] } : done;
        return { session, cursor: advance(sync(session, replay), 'special-designations', { expirationIteration: cursor.expirationIteration + 1, cleanupRound: 0,
                cleanupChanged: false, feprProcessed: false }) };
    }
    if (!Number.isSafeInteger(playing(session).frame.turnNumber + 1))
        throw new RangeError('Turn number overflow');
    const next = transition(session, 'awaiting-turn-start');
    const complete = advance(sync(next, done), 'awaiting-turn-start', { cleanupChanged: false });
    return response(withCursor(next, complete), 'awaiting-turn-start', true);
}
function drive(original, session, cursor, services, resolution) {
    let supplied = resolution;
    // Repeat until stable, never accidentally spin with an effect provider that continually changes state.
    for (let steps = 0; steps < 512; steps++) {
        try {
            if (cursor.expirationIteration > 64 || cursor.cleanupRound > 64 || cursor.consumedIDs.length > 510)
                return reject(original, 'step-limit');
            if (cursor.step === 'awaiting-turn-start' || cursor.step === 'ended')
                return response(withCursor(session, cursor), cursor.step, true);
            if (cursor.step.endsWith('-designations')) {
                const won = winner(session, cursor); // CR 323.1, before 323.2/3a/3b/heal.
                if (won)
                    return won;
            }
            if (cursor.step.endsWith('-lethal')) {
                const plan = lethalPlan(session, services);
                if (plan === undefined) {
                    if (supplied && (!plain(supplied.value, ['status']) || supplied.value.status !== 'pending'))
                        throw new TypeError('Trusted Might evaluators still required for lethal resolution');
                    return wait(session, cursor);
                }
                if (plan !== null && !supplied && !services.lethalKillApproval)
                    return wait(session, cursor);
                if (plan === null && supplied) {
                    // An outstanding task may have been issued before trusted Might became available.
                    // A now-proven empty lethal set is an explicit result; do not silently consume an
                    // unrelated resolution, and never treat a supplied approval as proof of a Kill.
                    if (supplied.taskId !== task(cursor) || !hook(supplied.value) ||
                        supplied.value.status !== 'verified-no-effect')
                        throw new TypeError('Unexpected lethal resolution');
                    supplied = undefined;
                }
                let raw;
                if (plan !== null) {
                    if (supplied) {
                        if (supplied.taskId !== task(cursor))
                            throw new TypeError('Unexpected trusted resolution');
                        raw = supplied.value;
                        supplied = undefined;
                    }
                    else
                        raw = services.lethalKillApproval({ ...context(session, cursor), plan: structuredClone(plan) });
                    if (isPending(raw))
                        return wait(session, cursor);
                }
                ({ session, cursor } = finishLethal(session, cursor, plan, raw));
                continue;
            }
            if (cursor.step === 'special-fepr' || cursor.step === 'ordinary-fepr') {
                if (cursor.cleanupChanged) {
                    cursor = advance(cursor, 'ordinary-designations', {
                        cleanupRound: cursor.cleanupRound + 1, cleanupChanged: false
                    });
                    continue;
                }
            }
            const provider = service(services, cursor.step);
            if (!supplied && !provider)
                return wait(session, cursor);
            let raw;
            if (supplied) {
                if (supplied.taskId !== task(cursor))
                    throw new TypeError('Unexpected trusted resolution');
                raw = supplied.value;
                supplied = undefined;
            }
            else
                raw = provider(context(session, cursor));
            if (isPending(raw))
                return wait(session, cursor);
            if (cursor.step.endsWith('-fepr')) {
                const finished = finishFEPR(session, cursor, raw);
                if ('status' in finished)
                    return finished;
                ({ session, cursor } = finished);
            }
            else
                ({ session, cursor } = settledHook(session, cursor, raw));
        }
        catch {
            return reject(original, 'invalid-resolution-or-provider');
        }
    }
    return reject(original, 'step-limit');
}
/** Only the authenticated real Neutral-Open Main turn player may end Main (316.9). */
export function runDuelEndOfTurn(session, authenticatedTurnActor, services) {
    if (!services || typeof services !== 'object')
        return reject(session, 'invalid-services');
    if (Object.hasOwn(session, 'endingProgress') && session.endingProgress !== undefined) {
        const cursor = parsedCursor(session);
        if (!cursor)
            return reject(session, 'invalid-session');
        return reject(session, 'task-conflict');
    }
    if (!id(authenticatedTurnActor))
        return reject(session, 'wrong-actor');
    const gate = validMain(session, authenticatedTurnActor);
    if (gate)
        return reject(session, gate);
    try {
        const match = playing(session);
        const entered = transition(session, 'ending');
        const cursor = { kind: 'ending', turn: match.frame.turnNumber,
            rootTaskID: root(match), step: 'ending-effects', expirationIteration: 0, cleanupRound: 0,
            cleanupChanged: false, feprProcessed: false, pendingTaskID: null, consumedIDs: [],
            stateVersion: playing(entered).stateVersion, eventSeq: playing(entered).eventSeq };
        return drive(session, entered, cursor, services);
    }
    catch {
        return reject(session, 'transaction-rejected');
    }
}
/** Exactly-once private task resolution. Reject wrong/stale tasks; a consumed ID returns latest session. */
export function resumeDuelEndOfTurn(session, taskId, trustedResolution, services) {
    if (!id(taskId))
        return reject(session, 'wrong-task');
    if (!services || typeof services !== 'object')
        return reject(session, 'invalid-services');
    const cursor = parsedCursor(session);
    if (!cursor)
        return reject(session, 'invalid-session');
    if (cursor.consumedIDs.includes(taskId))
        return response(session, 'duplicate', false);
    if (cursor.step === 'awaiting-turn-start' || cursor.step === 'ended' ||
        cursor.pendingTaskID !== taskId || task(cursor) !== taskId)
        return reject(session, 'wrong-task');
    if (session.turnFlow?.step !== 'main' || session.turnFlow.turn !== cursor.turn ||
        session.turnFlow.pendingTaskID !== null)
        return reject(session, 'task-conflict');
    const required = ownData(session, 'requiredTasks');
    if (required !== undefined && (!Array.isArray(required) || required.some(entry => ownData(entry, 'status') === 'active' || ownData(entry, 'status') === 'issued')))
        return reject(session, 'task-conflict');
    return drive(session, session, cursor, services, { taskId, value: trustedResolution });
}

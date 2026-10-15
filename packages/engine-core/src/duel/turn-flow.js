// CR 315–316, 431, 467–472, 485.7. Trusted start-of-turn executor, not a client command.
// Private cursors carry identities/indices only; match remains the sole authority for all game data.
import { beginAwaken, resumeAwakenBeginning } from './turn-start.js';
import { commitDuelPlayingMutation, detachedDuelPlaying } from './canonical-transaction.js';
import { scoreDuelBattlefield, gainDuelPoints, getDuelWinnerAtCleanup } from './scoring.js';
import { channelDuelRunes, clearAllDuelRunePools } from './resources.js';
import { startDuelDraw, resumeDuelDraw } from './draw-burnout.js';
const STEPS = ['hold', 'hold-effects', 'channel-effects', 'draw',
    'burnout-first', 'burnout-intervention', 'draw-effects', 'main-effects', 'main', 'ended'];
const FIELDS = ['kind', 'turn', 'rootTaskID', 'step', 'holdIndex', 'pendingTaskID',
    'consumedIDs', 'firstChannelProcessedPlayerIDs', 'drawCursor'];
function plain(value, keys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
        return false;
    const actual = Reflect.ownKeys(value);
    return actual.length === keys.length && keys.every(key => actual.includes(key)) &&
        actual.every(key => typeof key === 'string' && 'value' in Object.getOwnPropertyDescriptor(value, key));
}
function id(value) { return typeof value === 'string' && value.trim().length > 0; }
function count(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function ids(raw) {
    return Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype &&
        Reflect.ownKeys(raw).length === raw.length + 1 && raw.every((item, index) => 'value' in Object.getOwnPropertyDescriptor(raw, String(index)) && id(item)) &&
        new Set(raw).size === raw.length;
}
function playing(session) {
    return session.match.stage === 'playing' ? session.match : undefined;
}
function root(match) {
    return `duel-turn-start:${match.matchId}:turn-${match.frame.turnNumber}`;
}
function task(cursor) {
    const suffix = cursor.step === 'hold-effects' ? `hold-effects:${cursor.holdIndex}` :
        cursor.step === 'burnout-first' || cursor.step === 'burnout-intervention'
            ? `${cursor.step}:${cursor.drawCursor.burnoutIndex}` : cursor.step;
    return `${cursor.rootTaskID}:flow:${suffix}`;
}
function validTaskHistory(cursor) {
    const ids = cursor.consumedIDs;
    const prefix = `${cursor.rootTaskID}:flow:`;
    const hold = (index) => ids.includes(`${prefix}hold-effects:${index}`);
    const once = (name) => ids.includes(`${prefix}${name}`);
    if (cursor.holdIndex < 1 && hold(1))
        return false;
    if ((cursor.step === 'hold' || cursor.step === 'hold-effects') &&
        (once('channel-effects') || once('draw-effects') || once('main-effects') || once('burnout-first:1')))
        return false;
    if (cursor.step === 'hold-effects' && hold(cursor.holdIndex))
        return false;
    if (cursor.step === 'channel-effects' && once('channel-effects'))
        return false;
    if (cursor.step === 'draw-effects' && once('draw-effects'))
        return false;
    if (cursor.step === 'main-effects' && once('main-effects'))
        return false;
    if (cursor.step === 'burnout-first' && once('burnout-first:1'))
        return false;
    if (cursor.step === 'burnout-intervention' && cursor.drawCursor?.burnoutIndex === 1 &&
        once('burnout-intervention:1'))
        return false;
    if (cursor.step === 'burnout-intervention' && cursor.drawCursor?.burnoutIndex &&
        cursor.drawCursor.burnoutIndex > 1 &&
        ids.includes(`${prefix}burnout-intervention:${cursor.drawCursor.burnoutIndex}`))
        return false;
    if (['draw-effects', 'main-effects', 'main'].includes(cursor.step) && !once('channel-effects'))
        return false;
    if (cursor.step === 'main' && !once('draw-effects'))
        return false;
    if (cursor.step === 'main' && !once('main-effects'))
        return false;
    if (cursor.step === 'ended' && cursor.pendingTaskID !== null)
        return false;
    return true;
}
function pending(cursor) {
    return { taskId: cursor.pendingTaskID, kind: cursor.step, turn: cursor.turn };
}
function response(session, status, persistRequired, reason) {
    return { session, status, persistRequired, ...(reason ? { reason } : {}),
        ...(status === 'pending' && session.turnFlow?.pendingTaskID ? { pending: pending(session.turnFlow) } : {}) };
}
function reject(session, reason) {
    return response(session, 'rejected', false, reason);
}
function update(session, cursor) {
    return { ...session, turnFlow: cursor };
}
function commit(session, mutate) {
    const match = playing(session);
    const next = commitDuelPlayingMutation(match, mutate);
    return next === match ? session : { ...session, match: next };
}
function phase(session, name) {
    return commit(session, match => ({ ...match, frame: { ...match.frame, phase: name,
            priorityPlayerId: null, focusPlayerId: null, stateOpen: false, pendingPayment: null } }));
}
function validate(session) {
    const match = playing(session);
    const raw = session.turnFlow;
    if (!match || !plain(raw, FIELDS) || raw.kind !== 'turn-flow' || !count(raw.turn) ||
        !id(raw.rootTaskID) || !STEPS.includes(raw.step) ||
        !count(raw.holdIndex) || raw.holdIndex > 2 ||
        (raw.pendingTaskID !== null && !id(raw.pendingTaskID)) ||
        !ids(raw.consumedIDs) || !ids(raw.firstChannelProcessedPlayerIDs))
        return null;
    const cursor = raw;
    const fields = match.board.battlefields;
    if (cursor.turn !== match.frame.turnNumber || cursor.rootTaskID !== root(match) ||
        !cursor.firstChannelProcessedPlayerIDs.every(seat => seat === match.turnOrder[1]) ||
        !validTaskHistory(cursor) ||
        cursor.consumedIDs.some(value => !/:(hold-effects:[01]|channel-effects|draw-effects|main-effects|burnout-first:1|burnout-intervention:[1-9]\d*)$/.test(value)) ||
        cursor.consumedIDs.some(value => !value.startsWith(`${cursor.rootTaskID}:flow:`)) ||
        (cursor.pendingTaskID !== null && cursor.consumedIDs.includes(cursor.pendingTaskID)))
        return null;
    if (cursor.step === 'hold' || cursor.step === 'hold-effects') {
        if (match.frame.phase !== 'scoring' || cursor.holdIndex > fields.length ||
            (cursor.step === 'hold-effects' && cursor.holdIndex >= fields.length) || cursor.drawCursor !== null)
            return null;
    }
    else if (cursor.step === 'channel-effects') {
        if (match.frame.phase !== 'channel' || cursor.drawCursor !== null ||
            !cursor.firstChannelProcessedPlayerIDs.includes(match.turnOrder[1]) &&
                match.frame.turnPlayerId === match.turnOrder[1])
            return null;
    }
    else if (cursor.step === 'draw' || cursor.step === 'burnout-first' ||
        cursor.step === 'burnout-intervention' || cursor.step === 'draw-effects') {
        if (match.frame.phase !== 'draw' || ((cursor.step === 'burnout-first' ||
            cursor.step === 'burnout-intervention') !== (cursor.drawCursor !== null)))
            return null;
        if (cursor.drawCursor !== null) {
            if (!plain(cursor.drawCursor, ['actor', 'remainingCount', 'burnoutIndex', 'step']) ||
                cursor.drawCursor.actor !== match.frame.turnPlayerId || !count(cursor.drawCursor.remainingCount) ||
                cursor.drawCursor.remainingCount === 0 || !count(cursor.drawCursor.burnoutIndex) ||
                cursor.drawCursor.burnoutIndex === 0 ||
                cursor.drawCursor.step !== (cursor.step === 'burnout-first' ? 'awaiting-first-resolution' : 'awaiting-intervention') ||
                (cursor.step === 'burnout-first' && cursor.drawCursor.burnoutIndex !== 1))
                return null;
        }
    }
    else if (match.frame.phase !== (cursor.step === 'main-effects' ? 'main' : cursor.step) ||
        cursor.drawCursor !== null)
        return null;
    if ((cursor.step === 'main' || cursor.step === 'ended') && cursor.pendingTaskID !== null)
        return null;
    if (cursor.step !== 'hold' && cursor.step !== 'draw' &&
        cursor.step !== 'main' && cursor.step !== 'ended' && cursor.pendingTaskID !== task(cursor))
        return null;
    if ((cursor.step === 'channel-effects' || cursor.step === 'draw' || cursor.step === 'draw-effects' ||
        cursor.step === 'burnout-first' || cursor.step === 'burnout-intervention' ||
        cursor.step === 'main-effects' || cursor.step === 'main') &&
        match.frame.turnPlayerId === match.turnOrder[1] &&
        !cursor.firstChannelProcessedPlayerIDs.includes(match.turnOrder[1]))
        return null;
    if (cursor.step === 'main' && (match.frame.priorityPlayerId !== match.frame.turnPlayerId ||
        !match.frame.stateOpen || match.frame.pendingPayment !== null))
        return null;
    if (cursor.step !== 'main' && (match.frame.priorityPlayerId !== null || match.frame.pendingPayment !== null))
        return null;
    if (cursor.step !== 'main' && match.frame.stateOpen &&
        cursor.step !== 'hold' && cursor.step !== 'hold-effects')
        return null;
    if (cursor.step !== 'ended' && cursor.step !== 'main' &&
        match.scoring.turnNumber !== match.frame.turnNumber)
        return null;
    if (cursor.step === 'hold-effects' && !match.scoring.players.some(player => player.playerId === match.frame.turnPlayerId &&
        player.scoredBattlefieldLocationIds.includes(match.board.battlefields[cursor.holdIndex].locationId)))
        return null;
    return cursor;
}
function hook(raw) {
    return (plain(raw, ['status']) && raw.status === 'verified-no-effect') ||
        (plain(raw, ['status', 'match']) && raw.status === 'applied');
}
function isPending(raw) { return plain(raw, ['status']) && raw.status === 'pending'; }
function installed(session, proposal) {
    const before = playing(session);
    const candidate = detachedDuelPlaying(proposal);
    if (candidate.frame.phase !== before.frame.phase || candidate.frame.turnNumber !== before.frame.turnNumber ||
        candidate.frame.turnPlayerId !== before.frame.turnPlayerId ||
        candidate.frame.priorityPlayerId !== before.frame.priorityPlayerId ||
        candidate.frame.focusPlayerId !== before.frame.focusPlayerId ||
        candidate.frame.stateOpen !== before.frame.stateOpen || candidate.frame.pendingPayment !== null ||
        candidate.scoring.turnNumber !== before.scoring.turnNumber ||
        candidate.stateVersion !== before.stateVersion || candidate.eventSeq !== before.eventSeq)
        throw new TypeError('applied hook changed turn/priority/clocks');
    const next = commit(session, () => candidate);
    if (next === session)
        throw new TypeError('applied hook was a no-op');
    return next;
}
function resolved(session, raw) {
    return raw.status === 'applied' ? installed(session, raw.match) : session;
}
function nextCursor(cursor, step, options = {}) {
    return { ...cursor, ...options, step, pendingTaskID: null };
}
function awaiting(session, cursor) {
    const next = update(session, { ...cursor, pendingTaskID: task(cursor) });
    return response(next, 'pending', next !== session);
}
function consumeCurrent(cursor) {
    const currentTask = task(cursor);
    if (cursor.pendingTaskID !== null && cursor.pendingTaskID !== currentTask)
        throw new TypeError('invalid task consumption');
    if (cursor.consumedIDs.includes(currentTask))
        throw new TypeError('task already consumed');
    return { ...cursor, consumedIDs: [...cursor.consumedIDs, currentTask], pendingTaskID: null };
}
function effectContext(session, cursor) {
    const match = playing(session);
    return { match: detachedDuelPlaying(match), taskId: task(cursor), kind: cursor.step,
        turnPlayerId: match.frame.turnPlayerId, turnNumber: match.frame.turnNumber,
        ...(cursor.step === 'hold-effects' ? { locationId: match.board.battlefields[cursor.holdIndex].locationId } : {}),
        ...(cursor.drawCursor ? { burnoutIndex: cursor.drawCursor.burnoutIndex } : {}) };
}
function provider(services, step) {
    switch (step) {
        case 'hold-effects': return services.holdEffects;
        case 'channel-effects': return services.channelEffects;
        case 'draw-effects': return services.drawEffects;
        case 'main-effects': return services.mainEffects;
        case 'burnout-first': return services.firstBurnout;
        case 'burnout-intervention': return services.burnoutIntervention;
        default: return undefined;
    }
}
function drawZones(match) {
    const player = match.players.find(seat => seat.playerId === match.frame.turnPlayerId);
    return { hand: player.hand, mainDeck: player.remainingMainDeck, trash: player.trash };
}
function installDraw(session, result) {
    return commit(session, match => ({ ...match, scoring: result.scoring,
        players: match.players.map(player => player.playerId === match.frame.turnPlayerId
            ? { ...player, hand: result.zones.hand, remainingMainDeck: result.zones.mainDeck, trash: result.zones.trash }
            : player) }));
}
function afterDraw(session, cursor, result) {
    const updated = installDraw(session, result);
    if (result.status === 'winner') {
        const ended = phase(updated, 'ended');
        return { session: update(ended, nextCursor(cursor, 'ended', { drawCursor: null })), status: 'ended', persistRequired: true };
    }
    if (result.status === 'awaiting-first-resolution' || result.status === 'awaiting-intervention') {
        return { session: updated, cursor: nextCursor(cursor, result.status === 'awaiting-first-resolution' ? 'burnout-first' : 'burnout-intervention', { drawCursor: result.cursor }) };
    }
    return { session: updated, cursor: nextCursor(cursor, 'draw-effects', { drawCursor: null }) };
}
function cleanup(session, cursor) {
    const match = playing(session);
    if (getDuelWinnerAtCleanup(match.scoring, match.board) === null)
        return undefined;
    const ended = phase(session, 'ended');
    return response(update(ended, nextCursor(cursor, 'ended', { drawCursor: null })), 'ended', true);
}
function drive(original, initial, services) {
    let session = original, cursor = initial;
    // Every pass either advances a bounded step or stops at a required trusted boundary.
    for (let steps = 0; steps < 16; steps++) {
        if (cursor.pendingTaskID !== null)
            return response(update(session, cursor), 'pending', session !== original);
        try {
            const match = playing(session);
            if (cursor.step === 'hold') {
                if (cursor.holdIndex === match.board.battlefields.length) {
                    session = phase(session, 'channel');
                    const current = playing(session);
                    const second = current.turnOrder[1];
                    const first = current.frame.turnPlayerId === second && !cursor.firstChannelProcessedPlayerIDs.includes(second);
                    session = commit(session, draft => ({ ...draft, resources: channelDuelRunes(draft.resources, draft.frame.turnPlayerId, first ? 3 : 2) }));
                    cursor = nextCursor(cursor, 'channel-effects', { firstChannelProcessedPlayerIDs: first
                            ? [...cursor.firstChannelProcessedPlayerIDs, second] : cursor.firstChannelProcessedPlayerIDs });
                    continue;
                }
                const field = match.board.battlefields[cursor.holdIndex];
                const already = match.scoring.players.find(seat => seat.playerId === match.frame.turnPlayerId)
                    .scoredBattlefieldLocationIds.includes(field.locationId);
                if (field.controllerPlayerId !== match.frame.turnPlayerId || already) {
                    cursor = nextCursor(cursor, 'hold', { holdIndex: cursor.holdIndex + 1 });
                    continue;
                }
                session = commit(session, draft => ({ ...draft, scoring: scoreDuelBattlefield(draft.scoring, draft.board, draft.frame.turnPlayerId, field.locationId, 'hold', {
                        phase: 'beginning-scoring', turnPlayerId: draft.frame.turnPlayerId,
                        controlEstablishedForPlayerId: null, controlEstablishedLocationId: null,
                    }).state }));
                cursor = nextCursor(cursor, 'hold-effects');
                continue;
            }
            if (cursor.step === 'draw') {
                const result = startDuelDraw(drawZones(match), match.board, match.scoring, match.frame.turnPlayerId, 1, services.randomIndex);
                const progressed = afterDraw(session, cursor, result);
                if ('status' in progressed)
                    return progressed;
                ({ session, cursor } = progressed);
                continue;
            }
            if (cursor.step === 'main' || cursor.step === 'ended')
                return response(update(session, cursor), cursor.step, session !== original);
            const service = provider(services, cursor.step);
            if (!service)
                return awaiting(session, cursor);
            let raw;
            try {
                raw = service(effectContext(session, cursor));
            }
            catch {
                return reject(original, 'provider-error');
            }
            if (isPending(raw))
                return awaiting(session, cursor);
            const processed = settle(session, cursor, raw, services);
            if ('status' in processed)
                return processed.status === 'rejected' ? reject(original, processed.reason) : processed;
            ({ session, cursor } = processed);
        }
        catch {
            return reject(original, 'transaction-rejected');
        }
    }
    return reject(original, 'step-limit');
}
function settle(session, cursor, raw, services) {
    try {
        if (cursor.step === 'burnout-first') {
            if (!plain(raw, ['status', 'kind']) && !plain(raw, ['status', 'kind', 'match']))
                return reject(session, 'invalid-resolution');
            if (raw.status !== 'first-burnout' ||
                !(['scored', 'prevented'].includes(raw.kind) && !Object.hasOwn(raw, 'match')) &&
                    !(raw.kind === 'replaced' && Object.hasOwn(raw, 'match')))
                return reject(session, 'invalid-resolution');
            const match = playing(session);
            const other = match.turnOrder.find(seat => seat !== match.frame.turnPlayerId);
            if (raw.kind === 'scored') {
                session = commit(session, draft => ({ ...draft, scoring: gainDuelPoints(draft.scoring, draft.board, other, 1).state }));
            }
            else if (raw.kind === 'replaced')
                session = installed(session, raw.match);
            const latest = playing(session);
            const resumed = resumeDuelDraw(drawZones(latest), latest.board, latest.scoring, cursor.drawCursor, { firstBurnoutResolution: { kind: raw.kind, scoring: latest.scoring } });
            const progressed = afterDraw(session, cursor, resumed);
            if ('status' in progressed)
                return progressed;
            return { session: progressed.session, cursor: { ...progressed.cursor,
                    consumedIDs: [...cursor.consumedIDs, task(cursor)], pendingTaskID: null } };
        }
        if (!hook(raw))
            return reject(session, 'invalid-resolution');
        session = resolved(session, raw);
        let next = consumeCurrent(cursor);
        if (cursor.step === 'hold-effects') {
            const winner = cleanup(session, next);
            if (winner)
                return winner;
            next = nextCursor(next, 'hold', { holdIndex: cursor.holdIndex + 1 });
        }
        else if (cursor.step === 'channel-effects') {
            const winner = cleanup(session, next);
            if (winner)
                return winner;
            session = phase(session, 'draw');
            next = nextCursor(next, 'draw');
        }
        else if (cursor.step === 'burnout-intervention') {
            const winner = cleanup(session, next);
            if (winner)
                return winner;
            const match = playing(session);
            const result = resumeDuelDraw(drawZones(match), match.board, match.scoring, cursor.drawCursor, { interventionComplete: true }, services.randomIndex);
            const progressed = afterDraw(session, next, result);
            if ('status' in progressed)
                return progressed;
            return progressed;
        }
        else if (cursor.step === 'draw-effects') {
            const winner = cleanup(session, next);
            if (winner)
                return winner;
            session = phase(session, 'main');
            session = commit(session, match => ({ ...match, resources: clearAllDuelRunePools(match.resources) }));
            next = nextCursor(next, 'main-effects');
        }
        else if (cursor.step === 'main-effects') {
            const winner = cleanup(session, next);
            if (winner)
                return winner;
            session = commit(session, match => ({ ...match, frame: { ...match.frame, phase: 'main',
                    stateOpen: true, priorityPlayerId: match.frame.turnPlayerId, focusPlayerId: null, pendingPayment: null } }));
            next = nextCursor(next, 'main');
        }
        return { session, cursor: next };
    }
    catch {
        return reject(session, 'invalid-resolution');
    }
}
function startFlow(session, services) {
    const match = playing(session);
    if (!match || match.frame.phase !== 'scoring' || match.scoring.turnNumber !== match.frame.turnNumber)
        return reject(session, 'invalid-phase');
    const prior = session.turnFlow;
    if (prior && !validateOldTurn(session))
        return reject(session, 'invalid-session');
    const cursor = { kind: 'turn-flow', turn: match.frame.turnNumber,
        rootTaskID: root(match), step: 'hold', holdIndex: 0, pendingTaskID: null,
        consumedIDs: [], firstChannelProcessedPlayerIDs: prior?.firstChannelProcessedPlayerIDs ?? [], drawCursor: null };
    return drive(session, cursor, services);
}
function fromPrefix(before, result, services) {
    if (result.status === 'rejected')
        return reject(before, result.reason ?? 'prefix-rejected');
    if (result.status === 'duplicate')
        return response(result.session, 'duplicate', false);
    if (result.status === 'pending')
        return { session: result.session, status: 'pending',
            pending: { taskId: result.pending.taskId, kind: result.pending.kind, turn: result.pending.turn },
            persistRequired: result.persistRequired };
    const resumed = startFlow(result.session, services);
    if (resumed.status === 'rejected')
        return reject(before, resumed.reason ?? 'flow-rejected');
    return { ...resumed, persistRequired: true };
}
/** Begin at the actual post-mulligan constructor frame; never grant Main before required services settle. */
export function runDuelStartOfTurn(session, services) {
    const match = playing(session);
    if (!match || !services || typeof services !== 'object')
        return reject(session, 'invalid-session');
    if (match.frame.phase !== 'awaiting-turn-start' && session.turnProgress &&
        session.turnProgress.turn === match.frame.turnNumber &&
        session.turnProgress.step !== 'scoring' &&
        session.turnProgress.pendingTaskID !== null)
        return reject(session, 'pending-prefix-task');
    if (session.turnFlow && validate(session) === null && match.frame.phase !== 'awaiting-turn-start' &&
        !(session.turnProgress?.turn === match.frame.turnNumber && validateOldTurn(session)))
        return reject(session, 'invalid-session');
    if (match.frame.phase === 'awaiting-turn-start') {
        if (session.turnFlow && (validateOldTurn(session) === false))
            return reject(session, 'invalid-session');
        // The previous turn's completed cursor must remain visible until the new prefix actually starts.
        const prepared = { ...session, turnProgress: undefined };
        return fromPrefix(session, beginAwaken(prepared, services), services);
    }
    if (match.frame.phase === 'scoring' && session.turnProgress?.step === 'scoring' &&
        (session.turnFlow === undefined || validateOldTurn(session)))
        return startFlow(session, services);
    const cursor = validate(session);
    if (!cursor)
        return reject(session, 'invalid-phase');
    if (cursor.step === 'main' || cursor.step === 'ended')
        return response(session, cursor.step, false);
    return drive(session, cursor, services);
}
function validateOldTurn(session) {
    const match = playing(session);
    const cursor = session.turnFlow;
    return plain(cursor, FIELDS) && cursor.kind === 'turn-flow' && cursor.step === 'main' &&
        count(cursor.turn) && cursor.turn + 1 === match.frame.turnNumber &&
        cursor.rootTaskID === `duel-turn-start:${match.matchId}:turn-${cursor.turn}` &&
        cursor.pendingTaskID === null && cursor.drawCursor === null && ids(cursor.consumedIDs) &&
        ids(cursor.firstChannelProcessedPlayerIDs) &&
        cursor.firstChannelProcessedPlayerIDs.every(seat => seat === match.turnOrder[1]);
}
/** Only the exact outstanding private task is consumable; duplicate IDs return the latest session. */
export function resumeDuelStartOfTurn(session, taskId, trustedResolution, services) {
    if (!id(taskId) || !services || typeof services !== 'object')
        return reject(session, 'wrong-task');
    const match = playing(session);
    if (!match)
        return reject(session, 'invalid-stage');
    if (session.turnProgress && session.turnProgress.turn === match.frame.turnNumber &&
        (session.turnProgress.pendingTaskID === taskId || session.turnProgress.consumedIDs.includes(taskId))) {
        const result = resumeAwakenBeginning(session, taskId, trustedResolution, services);
        if (result.status === 'duplicate')
            return response(session, 'duplicate', false);
        return fromPrefix(session, result, services);
    }
    const cursor = validate(session);
    if (!cursor)
        return reject(session, 'invalid-session');
    if (cursor.consumedIDs.includes(taskId))
        return response(session, 'duplicate', false);
    if (cursor.pendingTaskID !== taskId && task(cursor) !== taskId)
        return reject(session, 'wrong-task');
    if (cursor.step === 'burnout-first' || cursor.step === 'burnout-intervention' ||
        cursor.step === 'hold-effects' || cursor.step === 'channel-effects' ||
        cursor.step === 'draw-effects' || cursor.step === 'main-effects') {
        const result = settle(session, cursor, trustedResolution, services);
        if ('status' in result)
            return result.status === 'rejected' ? reject(session, result.reason) : result;
        const progressed = drive(result.session, result.cursor, services);
        return progressed.status === 'rejected' ? reject(session, progressed.reason) :
            { ...progressed, persistRequired: true };
    }
    return reject(session, 'invalid-session');
}

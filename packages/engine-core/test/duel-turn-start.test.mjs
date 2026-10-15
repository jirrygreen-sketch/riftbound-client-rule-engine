import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatch, resolveDuelMulligan } from '../dist/duel/match-state.js';
import { channelDuelRunes, createDuelGoldToken } from '../dist/duel/resources.js';
import { materializeDuelUnitFromSettledSource } from '../dist/duel/unit-lifecycle.js';
import { commitDuelPlayingMutation } from '../dist/duel/canonical-transaction.js';
import { beginAwaken, resumeAwakenBeginning } from '../dist/duel/turn-start.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 8 }, (_, index) => ({
    uid: `${playerId}:main:${index}`, cardId: `unit-print:${playerId}:${index}`,
  })),
  champion: { uid: `${playerId}:champion`, cardId: `champion-print:${playerId}` },
  legend: { uid: `${playerId}:legend`, cardId: `legend-print:${playerId}` },
  runeDeck: Array.from({ length: 5 }, (_, index) => ({
    uid: `${playerId}:rune:${index}`, cardId: `rune-print:${playerId}:${index}`,
    domain: index % 2 === 0 ? 'Fury' : 'Calm',
  })),
  battlefields: Array.from({ length: 3 }, (_, index) => ({
    instanceId: `${playerId}:field:${index}`, cardId: `field-print:${playerId}:${index}`,
  })),
}));

const metadata = {
  matchId: 'turn-start-test', dataVersion: 'v1', catalogDigest: 'fixture-digest',
  roster: [{ playerId: 'alice', displayName: 'Alice' }, { playerId: 'bob', displayName: 'Bob' }],
};

function playing() {
  let match = createDuelMatch(seats, metadata, () => 0);
  match = resolveDuelMulligan(match, match.turnOrder[0], []);
  match = resolveDuelMulligan(match, match.turnOrder[1], []);
  assert.equal(match.stage, 'playing');
  return match;
}

function session(match = playing()) {
  return { match, receipts: [] };
}

function commit(match, mutate) {
  return commitDuelPlayingMutation(match, mutate);
}

function base(match, playerId) {
  return match.board.bases.find(value => value.ownerPlayerId === playerId).locationId;
}

function noEffectServices(overrides = {}) {
  return {
    readiness: () => ({ status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }),
    otherPermanents: () => ({ status: 'verified-no-effect' }),
    beginningEffects: () => ({ status: 'verified-no-effect' }),
    ...overrides,
  };
}

function addTurnPlayerResources(match, turnPlayerId) {
  return commit(match, draft => {
    const first = channelDuelRunes(draft.resources, turnPlayerId, 1, false);
    const locationId = first.bases.find(value => value.playerId === turnPlayerId).locationId;
    const resources = createDuelGoldToken(first, {
      uid: `${turnPlayerId}:gold:awaken`, playerId: turnPlayerId, locationId, readied: false,
    });
    return { ...draft, resources };
  });
}

function addControlledStolenUnit(match, ownerPlayerId, controllerPlayerId) {
  return commit(match, draft => {
    const owner = draft.players.find(player => player.playerId === ownerPlayerId);
    const card = owner.hand[0];
    const players = draft.players.map(player => player.playerId === ownerPlayerId
      ? { ...player, hand: player.hand.slice(1) } : player);
    return materializeDuelUnitFromSettledSource({ ...draft, players }, {
      kind: 'card', uid: card.uid, cardType: 'Unit', cardId: card.cardId,
      ownerPlayerId, controllerPlayerId, locationId: base(draft, controllerPlayerId),
    }, () => true);
  });
}

test('missing or pending required providers stop at resumable task and never become implicit no-op', () => {
  const original = session();
  const missing = beginAwaken(original, {});
  assert.equal(missing.status, 'pending');
  assert.equal(missing.pending.kind, 'readiness');
  assert.equal(missing.match.frame.phase, 'awaken');
  assert.equal(missing.match.scoring.turnNumber, missing.match.frame.turnNumber,
    'the per-turn Score ledger resets at Awaken, before Beginning effects');
  assert.equal(missing.match.priorityPlayerId, undefined);
  assert.equal(missing.match.frame.priorityPlayerId, null);
  assert.equal(missing.session.turnProgress.pendingTaskID, missing.pending.taskId);
  assert.notEqual(missing.match.stateVersion, original.match.stateVersion);

  const pendingOther = beginAwaken(session(), noEffectServices({
    readiness: () => ({ status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }),
    otherPermanents: () => ({ status: 'pending', detail: 'awaiting permanent scan' }),
    beginningEffects: () => {
      throw new Error('beginning hook must not run before other-permanent hook');
    },
  }));
  assert.equal(pendingOther.status, 'pending');
  assert.equal(pendingOther.pending.kind, 'other-permanents');
  assert.equal(pendingOther.match.frame.phase, 'awaken');
  assert.equal(pendingOther.session.turnProgress.consumedIDs.length, 1);
});

test('actual readiness readies only controlled Unit/Rune/Gold sources, including a controlled stolen Unit', () => {
  let match = playing();
  const turnPlayerId = match.frame.turnPlayerId;
  const otherPlayerId = match.roster.find(seat => seat.playerId !== turnPlayerId).playerId;
  match = addTurnPlayerResources(match, turnPlayerId);
  match = addControlledStolenUnit(match, otherPlayerId, turnPlayerId);
  const stolen = match.board.units[0];
  const rune = match.resources.bases.find(baseEntry => baseEntry.playerId === turnPlayerId).baseRunes[0];
  const gold = match.resources.bases.find(baseEntry => baseEntry.playerId === turnPlayerId).goldTokens[0];
  assert.equal(match.unitMeta[stolen.objectId].readied, false);
  assert.equal(rune.readied, false);
  assert.equal(gold.readied, false);

  const result = beginAwaken(session(match), noEffectServices({
    readiness: context => {
      assert.equal(context.step, 'awaken');
      assert.equal(context.turnPlayerId, turnPlayerId);
      return { status: 'ready', unitUIDs: [stolen.objectId], runeUIDs: [rune.uid], goldUIDs: [gold.uid] };
    },
  }));
  assert.equal(result.status, 'scoring');
  assert.equal(result.match.frame.phase, 'scoring');
  assert.equal(result.match.frame.priorityPlayerId, null);
  assert.equal(result.match.unitMeta[stolen.objectId].readied, true);
  assert.equal(result.match.resources.bases.find(baseEntry => baseEntry.playerId === turnPlayerId)
    .baseRunes.find(entry => entry.uid === rune.uid).readied, true);
  assert.equal(result.match.resources.bases.find(baseEntry => baseEntry.playerId === turnPlayerId)
    .goldTokens.find(entry => entry.uid === gold.uid).readied, true);
  assert.equal(result.match.players[0].hand.some(card => card.uid === stolen.objectId), false);
});

test('wrong readiness target is rejected atomically before Awaken commits', () => {
  const original = session();
  const before = JSON.stringify(original);
  const result = beginAwaken(original, noEffectServices({
    readiness: () => ({ status: 'ready', unitUIDs: ['not-a-controlled-unit'], runeUIDs: [], goldUIDs: [] }),
  }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid-readiness-target');
  assert.strictEqual(result.session, original);
  assert.strictEqual(result.match, original.match);
  assert.equal(result.persistRequired, false);
  assert.equal(JSON.stringify(original), before);
});

test('both required hooks can genuinely pend; resume consumes each task once and stops at scoring, not Main', () => {
  let otherCalls = 0;
  let beginningCalls = 0;
  let result = beginAwaken(session(), {
    readiness: () => ({ status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }),
    otherPermanents: () => {
      otherCalls++;
      return otherCalls === 1 ? { status: 'pending' } : { status: 'verified-no-effect' };
    },
    beginningEffects: () => {
      beginningCalls++;
      return beginningCalls === 1 ? { status: 'pending' } : { status: 'verified-no-effect' };
    },
  });
  assert.equal(result.status, 'pending');
  const otherTask = result.pending.taskId;
  assert.equal(result.pending.kind, 'other-permanents');
  assert.equal(beginningCalls, 0);

  result = resumeAwakenBeginning(result.session, otherTask, { status: 'verified-no-effect' }, {
    beginningEffects: () => {
      beginningCalls++;
      return { status: 'pending' };
    },
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.pending.kind, 'beginning-effects');
  assert.equal(result.match.frame.phase, 'beginning');
  assert.equal(beginningCalls, 1);
  const beginningTask = result.pending.taskId;

  result = resumeAwakenBeginning(result.session, beginningTask, { status: 'verified-no-effect' }, {});
  assert.equal(result.status, 'scoring');
  assert.equal(result.match.frame.phase, 'scoring');
  assert.equal(result.match.frame.priorityPlayerId, null);
  assert.equal(result.match.frame.pendingPayment, null);
  assert.equal(result.match.frame.phase === 'main', false);
  assert.equal(result.session.turnProgress.pendingTaskID, null);
  assert.deepEqual(result.session.turnProgress.consumedIDs, [
    `duel-turn-start:${result.match.matchId}:turn-${result.match.frame.turnNumber}:awaken:readiness`,
    otherTask,
    beginningTask,
  ]);
});

test('task ID matching is exact: wrong or stale resolution leaves latest session unchanged', () => {
  const initial = beginAwaken(session(), {});
  const before = JSON.stringify(initial.session);
  const wrong = resumeAwakenBeginning(initial.session, `${initial.pending.taskId}:wrong`,
    { status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }, {});
  assert.equal(wrong.status, 'rejected');
  assert.equal(wrong.reason, 'wrong-task');
  assert.strictEqual(wrong.session, initial.session);
  assert.equal(JSON.stringify(initial.session), before);

  const stale = resumeAwakenBeginning(initial.session, 'old-turn-task',
    { status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }, {});
  assert.equal(stale.status, 'rejected');
  assert.equal(stale.reason, 'wrong-task');
  assert.strictEqual(stale.match, initial.match);
});

test('duplicate resume returns current latest match/ledger without re-ready or re-running hooks', () => {
  let readinessCalls = 0;
  let otherCalls = 0;
  let beginningCalls = 0;
  const first = beginAwaken(session(), {
    readiness: () => {
      readinessCalls++;
      return { status: 'pending' };
    },
    otherPermanents: () => {
      otherCalls++;
      return { status: 'verified-no-effect' };
    },
    beginningEffects: () => {
      beginningCalls++;
      return { status: 'verified-no-effect' };
    },
  });
  const task = first.pending.taskId;
  const completed = resumeAwakenBeginning(first.session, task,
    { status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }, {
      otherPermanents: () => {
        otherCalls++;
        return { status: 'verified-no-effect' };
      },
      beginningEffects: () => {
        beginningCalls++;
        return { status: 'verified-no-effect' };
      },
    });
  assert.equal(completed.status, 'scoring');
  assert.equal(completed.match.frame.phase, 'scoring');
  const latestJSON = JSON.stringify(completed.session);
  const duplicate = resumeAwakenBeginning(completed.session, task,
    { status: 'ready', unitUIDs: ['would-be-repeated'], runeUIDs: [], goldUIDs: [] }, {});
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.persistRequired, false);
  assert.strictEqual(duplicate.session, completed.session);
  assert.strictEqual(duplicate.match, completed.match);
  assert.equal(JSON.stringify(duplicate.session), latestJSON);
  assert.equal(readinessCalls, 1);
  assert.equal(otherCalls, 1);
  assert.equal(beginningCalls, 1);
});

test('private cursor is JSON-safe/no card payload; match schema stays seven-field frame and clocks advance once per real mutation', () => {
  const original = session();
  const result = beginAwaken(original, noEffectServices());
  assert.equal(result.status, 'scoring');
  assert.equal(result.match.frame.phase, 'scoring');
  assert.equal(result.match.frame.priorityPlayerId, null);
  assert.equal(result.match.frame.focusPlayerId, null);
  assert.equal(result.match.frame.pendingPayment, null);
  // Constructor is at version 2. Awaken, Beginning and Scoring are three real frame/score commits;
  // the explicit empty readiness result is a no-op and does not allocate a fourth clock.
  assert.equal(result.match.stateVersion, original.match.stateVersion + 3);
  assert.equal(result.match.eventSeq, original.match.eventSeq + 3);
  assert.deepEqual(Object.keys(result.match.frame).sort(), [
    'focusPlayerId', 'pendingPayment', 'phase', 'priorityPlayerId', 'stateOpen',
    'turnNumber', 'turnPlayerId',
  ]);
  assert.deepEqual(Object.keys(result.session.turnProgress).sort(), [
    'consumedIDs', 'kind', 'pendingTaskID', 'rootTaskID', 'step', 'turn',
  ]);
  const sidecarJSON = JSON.stringify(result.session.turnProgress);
  for (const forbidden of ['champion-print', 'legend-print', ':main:', ':rune:'])
    assert.equal(sidecarJSON.includes(forbidden), false);
  const restored = JSON.parse(JSON.stringify(result.session));
  const duplicate = resumeAwakenBeginning(restored, result.session.turnProgress.consumedIDs[0],
    { status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }, {});
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.match.stateVersion, result.match.stateVersion);
  assert.equal(duplicate.match.eventSeq, result.match.eventSeq);
});

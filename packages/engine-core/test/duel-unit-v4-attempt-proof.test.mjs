import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelCommandSessionV2, applyDuelResourceCommandV2,
  advanceDuelCommandSessionNativeV2, commitDuelCommandFrameV2,
} from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2,
  moveDuelPhysicalCardToChainV2, referenceDuelPhysicalCardV2 } from '../dist/duel/core-v2.js';
import {
  hasDuelPrintedUnitAttemptCapabilityV4,
  issueDuelPrintedUnitAttemptCapabilityV4,
} from '../dist/duel/command-executor-v2.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: 'fixture-accelerate' })),
  champion: { uid: `${playerId}-champion`, cardId: 'fixture-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
  runeDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'fixture-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `fixture-field-${playerId}-${i}` })),
}));
const metadata = { matchId: 'v4-attempt-proof', dataVersion: 'fixture-v1', catalogDigest: 'fixture-digest',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const types = cardId => cardId === 'fixture-champion' ? 'Champion' : cardId === 'fixture-legend'
  ? 'Legend' : cardId === 'fixture-rune' ? 'Rune' : cardId.startsWith('fixture-field-') ? 'Battlefield' : 'Unit';

function openScene() {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, types);
  for (const actor of ['alice', 'bob']) {
    session = applyDuelResourceCommandV2(session, actor, {
      commandId: `mulligan-${actor}`, expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] },
    }).session;
  }
  const established = commitDuelPlayingMutationV2(session.match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates)
      .map(([uid, state]) => [uid, { ...state, readiness: 'ready' }])),
  }, transitions: [] }));
  session = advanceDuelCommandSessionNativeV2(session, established).session;
  session = advanceDuelCommandSessionNativeV2(session, channelDuelRunesV2(session.match, 'alice', 1, true)).session;
  session = commitDuelCommandFrameV2(session, { ...session.match.frame, phase: 'main', stateOpen: true,
    priorityPlayerId: 'alice', turnPlayerId: 'alice' }, () => undefined).session;
  const uid = session.match.players.find(player => player.playerId === 'alice').hand[0].uid;
  return { session, uid };
}

function closedAttemptScene() {
  const { session: initialSession, uid } = openScene();
  const card = initialSession.match.players.find(player => player.playerId === 'alice').hand.find(item => item.uid === uid);
  const handEpoch = initialSession.match.physicalCardsByUID[uid].zoneEpoch;
  const moved = moveDuelPhysicalCardToChainV2(initialSession.match,
    referenceDuelPhysicalCardV2(initialSession.match, uid), 'alice');
  const movedSession = advanceDuelCommandSessionNativeV2(initialSession, moved).session;
  const closedSession = commitDuelCommandFrameV2(movedSession, { ...moved.frame, stateOpen: false }, () => undefined).session;
  const chainEpoch = closedSession.match.physicalCardsByUID[uid].zoneEpoch;
  return { initialSession, movedSession, closedSession, actor: 'alice', uid, cardId: card.cardId, handEpoch, chainEpoch };
}

test('V4 attempt proof rejects clone, foreign, and same-origin sibling heads', () => {
  const scene = closedAttemptScene();
  assert.throws(() => issueDuelPrintedUnitAttemptCapabilityV4(scene), /issued only by the V4 lifecycle/);
  assert.equal(hasDuelPrintedUnitAttemptCapabilityV4(Object.freeze({})), false);
  const sibling = commitDuelCommandFrameV2(scene.movedSession,
    { ...scene.movedSession.match.frame, stateOpen: false }, () => undefined).session;
  assert.equal(sibling.match.stateVersion, scene.closedSession.match.stateVersion);
  assert.notStrictEqual(sibling.match, scene.closedSession.match);
});

test('public V4 attempt mint cannot authorize issue or prepare', () => {
  const scene = closedAttemptScene();
  assert.throws(() => issueDuelPrintedUnitAttemptCapabilityV4(scene), /issued only by the V4 lifecycle/);
});

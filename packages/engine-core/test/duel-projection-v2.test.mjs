import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUEL_PROJECTION_SCHEMA_V2,
  isDuelProjection,
  isDuelProjectionAny,
  isDuelProjectionV1,
  isDuelProjectionV2,
} from '@riftbound/protocol';
import {
  projectCanonicalDuelMatchV2,
} from '../dist/duel/projection-v2.js';
import {
  createDuelCommandSessionV2, applyDuelResourceCommandV2 as apply,
  commitDuelPriorityPaymentV2, adoptAdmittedDuelPlayingSessionV2,
} from '../dist/duel/canonical-session-v2.js';
import { commitDuelPlayingMutationV2 } from '../dist/duel/core-v2.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: `print-main-${i}` })),
  champion: { uid: `${playerId}-champion`, cardId: 'print-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'print-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: `print-rune-${i}`,
    domain: i % 2 === 0 ? 'Fury' : 'Calm' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `print-field-${i}` })),
}));
const metadata = { matchId: 'projection-v2-match', dataVersion: 'catalog-v2', catalogDigest: 'sha256:test',
  roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
const types = cardId => cardId === 'print-champion' ? 'Champion'
  : cardId === 'print-legend' ? 'Legend'
    : cardId.startsWith('print-rune-') ? 'Rune'
      : cardId.startsWith('print-field-') ? 'Battlefield' : 'Unit';
const create = () => createDuelCommandSessionV2(seats, metadata, () => 0, types);
const submit = (s, actor, commandId, command) =>
  apply(s, actor, { commandId, expectedVersion: s.match.stateVersion, command });
function mulligan(s, actor, commandId) {
  const r = submit(s, actor, commandId, { type: 'mulligan', selectedUIDs: [] });
  assert.equal(r.outcome.status, 'applied');
  assert.equal(r.match.schemaVersion, 2);
  return r.session;
}
const FULL = () => mulligan(mulligan(create(), 'alice', 'mulligan-a'), 'bob', 'mulligan-b');
const wrap = (match, viewer) => ({ projectionSchema: DUEL_PROJECTION_SCHEMA_V2,
  viewerPlayerId: viewer, match, actions: [] });
const forbidden = ['provenance', 'originalPhysicalCards', 'initialZonesByUID', 'zoneEpoch', 'receipts',
  'requiredTasks', 'priorityPayments', 'sourceReference', 'retiredPhysicalUIDs',
  'physicalCardsByUID', 'legendStates', 'gears'];

test('setup projection keeps schemaVersion 2 and hides the opponent hand for seats and spectators', () => {
  const session = create();
  assert.equal(session.match.stage, 'setup');
  for (const viewer of ['alice', 'bob', null]) {
    const match = projectCanonicalDuelMatchV2(session.match, viewer);
    assert.equal(match.schemaVersion, 2);
    assert.equal(match.stage, 'setup');
    const wrapped = wrap(match, viewer);
    assert.equal(isDuelProjectionV2(wrapped), true);
    assert.equal(isDuelProjectionAny(wrapped), true);
    assert.equal(isDuelProjection(wrapped), false);
    assert.equal(isDuelProjectionV1(wrapped), false);
    const own = match.setup.players.find(p => p.playerId === viewer);
    for (const player of match.setup.players) {
      if (player.playerId === viewer) {
        assert.equal(player.hand.length, player.handCount);
        assert.ok(player.hand.every(card => card.uid.startsWith(`${viewer}-`)));
      } else {
        assert.equal(Object.hasOwn(player, 'hand'), false);
      }
    }
    if (viewer === null) assert.equal(own, undefined);
  }
});

test('playing projection surfaces public kernels and hides every other hand', () => {
  const session = FULL();
  assert.equal(session.match.stage, 'playing');
  for (const viewer of ['alice', 'bob', null]) {
    const match = projectCanonicalDuelMatchV2(session.match, viewer);
    assert.equal(match.schemaVersion, 2);
    assert.equal(match.stage, 'playing');
    assert.equal(isDuelProjectionV2(wrap(match, viewer)), true);
    assert.equal(match.board.units.length, 0);
    assert.equal(match.board.bases.length, 2);
    assert.equal(match.board.battlefields.length, 2);
    assert.equal(match.resources.bases.length, 2);
    assert.equal(match.scoring.turnNumber, match.frame.turnNumber - 1);
    for (const player of match.players) {
      assert.equal(player.handCount + player.mainDeckCount, 10);
      assert.equal(player.handCount, 4);
      assert.equal(player.trash.length, 0);
      if (player.playerId === viewer) assert.equal(player.hand.length, player.handCount);
      else assert.equal(Object.hasOwn(player, 'hand'), false);
    }
  }
});

test('V2 projection never emits private provenance, ledgers or physical history', () => {
  const session = FULL();
  // The authority genuinely carries the private V2 graph ...
  const raw = JSON.stringify(session.match);
  for (const key of ['provenance', 'originalPhysicalCards', 'initialZonesByUID', 'physicalCardsByUID', 'legendStates'])
    assert.ok(raw.includes(key), `authority should carry ${key}`);
  assert.ok(JSON.stringify(session).includes('"receipts"'));
  // ... but no public projection may leak any forbidden field.
  for (const viewer of ['alice', 'bob', null])
    for (const stage of [create().match, session.match]) {
      const json = JSON.stringify(projectCanonicalDuelMatchV2(stage, viewer));
      for (const key of forbidden) assert.equal(json.includes(key), false, `${key} leaked to ${viewer}`);
      assert.equal(json.includes('schemaVersion":1'), false);
    }
});

test('pending payment cost and id are visible only to the payment actor', () => {
  const session = FULL();
  const match = commitDuelPlayingMutationV2(session.match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates)
      .map(([uid, old]) => [uid, { ...old, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', priorityPlayerId: 'alice', stateOpen: true } }, transitions: [] }));
  const admitted = adoptAdmittedDuelPlayingSessionV2(match);
  const hand = match.players.find(p => p.playerId === 'alice').hand[0];
  const source = { kind: 'effect', referenceId: 'fixture-effect', sourceUID: hand.uid };
  const epoch = match.physicalCardsByUID[hand.uid].zoneEpoch;
  const paid = commitDuelPriorityPaymentV2(admitted, 'alice', 'pay-1', { energy: 0, power: [] }, source,
    request => ({ matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: request.sourceReference, sourceProofId: 'fixture-proof', mode: 'current',
      sourceZoneEpoch: epoch }));
  const pendingSource = paid.session.match;
  const alice = projectCanonicalDuelMatchV2(pendingSource, 'alice');
  assert.equal(alice.frame.pendingPayment.active, true);
  assert.equal(alice.frame.pendingPayment.paymentId, 'pay-1');
  assert.deepEqual(alice.frame.pendingPayment.resolvedCost, { energy: 0, power: [] });
  assert.equal(isDuelProjectionV2(wrap(alice, 'alice')), true);
  for (const viewer of ['bob', null]) {
    const other = projectCanonicalDuelMatchV2(pendingSource, viewer);
    assert.deepEqual(other.frame.pendingPayment, { active: true });
    assert.equal(Object.hasOwn(other.frame.pendingPayment, 'paymentId'), false);
    assert.equal(JSON.stringify(other).includes('pay-1'), false);
    assert.equal(JSON.stringify(other).includes('sourceReference'), false);
    assert.equal(isDuelProjectionV2(wrap(other, viewer)), true);
  }
});

test('projected output is detached from the V2 authority and rejects an unknown viewer', () => {
  const session = FULL();
  const match = session.match;
  const before = projectCanonicalDuelMatchV2(match, 'alice');
  const mutable = projectCanonicalDuelMatchV2(match, 'alice');
  assert.notStrictEqual(mutable, before);
  mutable.players[0].hand.push({ uid: 'injected', cardId: 'injected' });
  mutable.board.units.push({ objectId: 'injected' });
  const after = projectCanonicalDuelMatchV2(match, 'alice');
  assert.deepEqual(after, before);
  assert.equal(JSON.stringify(match).includes('injected'), false);
  assert.throws(() => projectCanonicalDuelMatchV2(match, 'carol'), TypeError);
});

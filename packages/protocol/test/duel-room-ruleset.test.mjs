import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUEL_RULESET_ID, FOUNDATION_RULESET_ID, RULESET_ID, RULESET_IDS,
  isClientMessage, isRoomView, isServerMessage
} from '../dist/index.js';

const room = rulesetId => ({ roomId: 'room-1', rulesetId, status: 'waiting',
  version: 0, roomVersion: 2, roomEventSeq: 1, players: [{ id: 'player-1',
    name: 'Alice', connected: true, ready: false, deckSubmitted: false }] });

test('opt-in duel ruleset is distinct and included without changing the legacy IDs', () => {
  assert.deepEqual(RULESET_IDS, [RULESET_ID, FOUNDATION_RULESET_ID, DUEL_RULESET_ID]);
  assert.equal(RULESET_ID, 'synthetic-demo');
  assert.equal(FOUNDATION_RULESET_ID, 'riftbound-foundation');
  for (const id of RULESET_IDS) {
    assert.equal(isRoomView(room(id)), true);
    assert.equal(isServerMessage({ type: 'room', room: room(id) }), true);
    assert.equal(isClientMessage({ type: 'create-room', requestId: 'create', playerName: 'Alice', rulesetId: id }), true);
  }
  assert.equal(isRoomView(room('unknown-ruleset')), false);
  assert.equal(isServerMessage({ type: 'room', room: room('unknown-ruleset') }), false);
});

test('duel command must retain entire exact envelope and exact command shape', () => {
  const message = { type: 'duel-command', requestId: 'request', commandId: 'move',
    expectedVersion: 0, command: { type: 'mulligan', selectedUIDs: [] } };
  assert.equal(isClientMessage(message), true);
  assert.equal(isClientMessage({ ...message, playerId: 'player-2' }), false);
  assert.equal(isClientMessage({ ...message, command: { ...message.command, actor: 'player-2' } }), false);
  assert.equal(isClientMessage({ ...message, command: { ...message.command, cost: 0 } }), false);
  assert.equal(isClientMessage({ ...message, expectedVersion: -1 }), false);
  assert.equal(isClientMessage({ ...message, command: { type: 'mulligan', selectedUIDs: ['x', 'x'] } }), false);
});

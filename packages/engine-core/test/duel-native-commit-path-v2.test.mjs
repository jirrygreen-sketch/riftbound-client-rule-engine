import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatchV2, resolveDuelMulliganV2, channelDuelRunesV2,
  commitDuelPlayingMutationV2, inspectDuelNativeCommitPathV2,
  inspectDuelNativeTokenHistoryV2, inspectDuelNativeOriginV2 } from '../dist/duel/core-v2.js';

const seats = ['a', 'b'].map(playerId => ({ playerId,
  mainDeck: Array.from({ length: 9 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: 'unit' })),
  champion: { uid: `${playerId}-champ`, cardId: 'champ' },
  legend: { uid: `${playerId}-legend`, cardId: 'legend' },
  runeDeck: Array.from({ length: 4 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `field-${i}` })),
}));
const metadata = { matchId: 'native-path', dataVersion: 'fixture', catalogDigest: 'sha256:fixture',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const create = () => createDuelMatchV2(seats, metadata, () => 0,
  id => ({ unit: 'Unit', champ: 'Champion', legend: 'Legend', rune: 'Rune' })[id] ?? 'Battlefield');
function playing(root) {
  const first = resolveDuelMulliganV2(root, root.turnOrder[0], []);
  return resolveDuelMulliganV2(first, root.turnOrder[1], []);
}

test('executor reservations bind an actual factory origin rather than a reusable match ID', () => {
  const root = create(), current = playing(root), sibling = playing(root), fresh = create();
  const origin = inspectDuelNativeOriginV2(root);
  assert.equal(Object.isFrozen(origin), true);
  assert.equal(Reflect.ownKeys(origin).length, 0);
  assert.equal(inspectDuelNativeOriginV2(current), origin);
  assert.equal(inspectDuelNativeOriginV2(sibling), origin);
  assert.notEqual(inspectDuelNativeOriginV2(fresh), origin);
  assert.throws(() => inspectDuelNativeOriginV2(structuredClone(current)), /untrusted V2 state/);
});

test('native path spans real setup and playing commits with their exact clocks and transfers', () => {
  const root = create(), main = playing(root), after = channelDuelRunesV2(main, 'a', 2);
  const path = inspectDuelNativeCommitPathV2(root, after);
  assert.equal(path.length, 3);
  assert.strictEqual(path[0].before, root);
  assert.strictEqual(path.at(-1).after, after);
  assert.strictEqual(path[1].after, path[2].before);
  assert.deepEqual(path.map(entry => [entry.before.stateVersion, entry.after.stateVersion]), [[0, 1], [1, 2], [2, 3]]);
  assert.deepEqual(path.at(-1).transitions.map(entry => entry.from.kind), ['rune-deck', 'rune-deck']);
  assert.deepEqual(path.at(-1).transitions.map(entry => entry.to.kind), ['board-base', 'board-base']);
  assert.ok(Object.isFrozen(path) && Object.isFrozen(path[0]) && Object.isFrozen(path[2].transitions));
  assert.deepEqual(inspectDuelNativeTokenHistoryV2(after), { births: [], retirements: [] });
});

test('native ancestry refuses equivalent factories, siblings, reverse traversal and DTO clones', () => {
  const root = create(), main = playing(root);
  const left = channelDuelRunesV2(main, 'a', 1), right = channelDuelRunesV2(main, 'b', 1);
  assert.throws(() => inspectDuelNativeCommitPathV2(create(), main), /foreign native commit origin/);
  assert.throws(() => inspectDuelNativeCommitPathV2(left, right), /not a native descendant/);
  assert.throws(() => inspectDuelNativeCommitPathV2(left, main), /not a native descendant/);
  assert.throws(() => inspectDuelNativeCommitPathV2(root, structuredClone(left)), /untrusted V2 state/);
  assert.throws(() => inspectDuelNativeTokenHistoryV2(structuredClone(left)), /untrusted V2 state/);
});

test('a true no-op has no fabricated commit or transferable ancestry record', () => {
  const root = create(), main = playing(root);
  const same = commitDuelPlayingMutationV2(main, draft => ({ match: draft, transitions: [] }));
  assert.strictEqual(same, main);
  assert.deepEqual(inspectDuelNativeCommitPathV2(main, same), []);
  const path = inspectDuelNativeCommitPathV2(root, main);
  assert.throws(() => inspectDuelNativeCommitPathV2(path[0], main), /untrusted V2 state/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatchV2, resolveDuelMulliganV2, referenceDuelPhysicalCardV2,
  moveDuelPhysicalCardToChainV2, moveDuelChainCardToOwnerTrashV2,
  projectDuelChainCardsV2, enumerateDuelObjectsV2, inspectDuelNativeCommitPathV2,
  commitDuelPlayingMutationV2 } from '../dist/duel/core-v2.js';

let serial = 0;
function scene() {
  const seats = ['alice', 'bob'].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-card-${i}`,
      cardId: i === 0 ? 'spell-draw' : 'unit' })),
    champion: { uid: `${playerId}-champion`, cardId: 'champion' },
    legend: { uid: `${playerId}-legend`, cardId: 'legend' },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'rune', domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `field-${i}` })),
  }));
  const types = id => id.startsWith('field-') ? 'Battlefield' :
    ({ champion: 'Champion', legend: 'Legend', rune: 'Rune', unit: 'Unit', 'spell-draw': 'Other' })[id];
  let match = createDuelMatchV2(seats, { matchId: `chain-storage-${++serial}`, dataVersion: 'fixture-v1',
    catalogDigest: 'sha256:fixture-v1', roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) },
    bound => bound - 1, types);
  for (const actor of match.turnOrder) match = resolveDuelMulliganV2(match, actor, []);
  return match;
}

test('a physical Spell leaves the hand, occupies the shared Chain and then enters owner Trash with both epoch changes', () => {
  const before = scene(), uid = before.players[0].hand.find(card => card.cardId === 'spell-draw').uid;
  const original = referenceDuelPhysicalCardV2(before, uid);
  const onChain = moveDuelPhysicalCardToChainV2(before, original, 'alice');
  assert.equal(onChain.stateVersion, before.stateVersion + 1);
  assert.equal(onChain.players[0].hand.some(card => card.uid === uid), false);
  assert.deepEqual(onChain.chainCards, [{ uid, cardId: 'spell-draw', ownerPlayerId: 'alice', controllerPlayerId: 'alice' }]);
  const view = enumerateDuelObjectsV2(onChain).find(card => card.uid === uid);
  assert.deepEqual(view.zone, { kind: 'chain', zonePlayerId: 'alice' });
  assert.equal(view.zoneEpoch, original.zoneEpoch + 1);
  assert.equal(view.controllerPlayerId, 'alice');
  const publicCards = projectDuelChainCardsV2(onChain);
  assert.deepEqual(publicCards, onChain.chainCards);
  assert.equal(Object.isFrozen(publicCards), true);
  assert.equal(Object.isFrozen(publicCards[0]), true);
  assert.deepEqual(Object.keys(publicCards[0]).sort(), ['cardId', 'controllerPlayerId', 'ownerPlayerId', 'uid']);
  assert.throws(() => moveDuelChainCardToOwnerTrashV2(onChain, original), /stale/);
  const finished = moveDuelChainCardToOwnerTrashV2(onChain, referenceDuelPhysicalCardV2(onChain, uid));
  assert.equal(finished.stateVersion, onChain.stateVersion + 1);
  assert.equal(finished.physicalCardsByUID[uid].zoneEpoch, original.zoneEpoch + 2);
  assert.deepEqual(projectDuelChainCardsV2(finished), []);
  assert.equal(finished.players[0].trash.some(card => card.uid === uid), true);
  assert.deepEqual(inspectDuelNativeCommitPathV2(before, finished).flatMap(c => c.transitions), [
    { uid, from: { kind: 'hand', zonePlayerId: 'alice' }, to: { kind: 'chain', zonePlayerId: 'alice' } },
    { uid, from: { kind: 'chain', zonePlayerId: 'alice' }, to: { kind: 'trash', zonePlayerId: 'alice' } },
  ]);
  assert.throws(() => moveDuelChainCardToOwnerTrashV2(finished, referenceDuelPhysicalCardV2(finished, uid)), /not on/);
});

test('cached object views remain immutable, authority checked and scoped to the exact admitted head', () => {
  const before = scene(), uid = before.players[0].hand[0].uid;
  const initial = enumerateDuelObjectsV2(before);
  assert.strictEqual(enumerateDuelObjectsV2(before), initial);
  assert.equal(Object.isFrozen(initial), true);
  const original = initial.find(card => card.uid === uid);
  assert.equal(Object.isFrozen(original), true);
  assert.equal(Object.isFrozen(original.zone), true);
  assert.throws(() => { original.zone.kind = 'trash'; }, TypeError);
  assert.throws(() => enumerateDuelObjectsV2(structuredClone(before)), /untrusted V2/);
  const next = moveDuelPhysicalCardToChainV2(before, referenceDuelPhysicalCardV2(before, uid), 'alice');
  const nextViews = enumerateDuelObjectsV2(next);
  assert.notStrictEqual(nextViews, initial);
  assert.equal(nextViews.find(card => card.uid === uid).zone.kind, 'chain');
  assert.equal(nextViews.find(card => card.uid === uid).zoneEpoch, original.zoneEpoch + 1);
  const sibling = moveDuelPhysicalCardToChainV2(before, referenceDuelPhysicalCardV2(before, uid), 'bob');
  assert.equal(enumerateDuelObjectsV2(sibling).find(card => card.uid === uid).controllerPlayerId, 'bob');
  assert.strictEqual(enumerateDuelObjectsV2(before), initial);
  assert.equal(original.zone.kind, 'hand');
});

test('physical provenance survives a different Chain controller and malformed/duplicate carriers fail closed', () => {
  const before = scene(), uid = before.players[0].hand[0].uid;
  const onChain = moveDuelPhysicalCardToChainV2(before, referenceDuelPhysicalCardV2(before, uid), 'bob');
  assert.equal(projectDuelChainCardsV2(onChain)[0].controllerPlayerId, 'bob');
  const done = moveDuelChainCardToOwnerTrashV2(onChain, referenceDuelPhysicalCardV2(onChain, uid));
  assert.equal(done.players[0].trash.some(card => card.uid === uid), true);
  assert.equal(done.players[1].trash.some(card => card.uid === uid), false);
  for (const change of [
    card => ({ ...card, ownerPlayerId: 'bob' }),
    card => ({ ...card, cardId: 'forged-printing' }),
    card => ({ ...card, controllerPlayerId: 'intruder' }),
  ]) assert.throws(() => commitDuelPlayingMutationV2(onChain, d => ({ match: { ...d,
    chainCards: d.chainCards.map(change) }, transitions: [] })));
  assert.throws(() => commitDuelPlayingMutationV2(before, d => ({ match: { ...d,
    chainCards: [{ uid, cardId: before.physicalCardsByUID[uid].cardId,
      ownerPlayerId: 'alice', controllerPlayerId: 'alice' }] }, transitions: [] })), /duplicate/);
  assert.throws(() => projectDuelChainCardsV2(structuredClone(onChain)), /untrusted V2/);
});

test('an immediate physical card may traverse the Chain in one atomic commit with the full ordered trace', () => {
  const before = scene(), uid = before.players[0].hand[0].uid;
  const card = before.players[0].hand[0];
  const after = commitDuelPlayingMutationV2(before, d => ({ match: { ...d,
    players: [{ ...d.players[0], hand: d.players[0].hand.filter(c => c.uid !== uid), trash: [card] }, d.players[1]] },
    transitions: [
      { uid, from: { kind: 'hand', zonePlayerId: 'alice' }, to: { kind: 'chain', zonePlayerId: 'alice' } },
      { uid, from: { kind: 'chain', zonePlayerId: 'alice' }, to: { kind: 'trash', zonePlayerId: 'alice' } },
    ] }));
  assert.equal(after.stateVersion, before.stateVersion + 1);
  assert.equal(after.physicalCardsByUID[uid].zoneEpoch, before.physicalCardsByUID[uid].zoneEpoch + 2);
  assert.equal(inspectDuelNativeCommitPathV2(before, after)[0].transitions.length, 2);
});

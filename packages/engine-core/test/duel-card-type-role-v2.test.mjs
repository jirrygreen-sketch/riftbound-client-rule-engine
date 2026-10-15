import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatchV2, resolveDuelMulliganV2 } from '../dist/duel/core-v2.js';

const printedTypes = new Map([
  ['chosen-champion', 'Champion'], ['extra-champion', 'Champion'],
  ['ordinary-unit', 'Unit'], ['spell', 'Other'], ['gear', 'Gear'],
  ['rune', 'Rune'], ['legend', 'Legend'], ['battlefield', 'Battlefield'],
]);
const resolver = cardId => cardId.startsWith('battlefield-') ? 'Battlefield' : printedTypes.get(cardId);
const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  champion: { uid: `${playerId}-chosen`, cardId: 'chosen-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'legend' },
  mainDeck: Array.from({ length: 9 }, (_, i) => ({ uid: `${playerId}-main-${i}`,
    cardId: i === 0 ? 'extra-champion' : i === 1 ? 'spell' : i === 2 ? 'gear' : 'ordinary-unit' })),
  runeDeck: Array.from({ length: 4 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`, cardId: `battlefield-${i}` })),
}));
const metadata = { matchId: 'card-type-role-v2', dataVersion: 'unit-catalog', catalogDigest: 'sha256:unit-catalog',
  roster: seats.map(({ playerId }) => ({ playerId, displayName: playerId })) };
const create = (entries = seats, trustedCardType = resolver) => createDuelMatchV2(entries, metadata, () => 0, trustedCardType);

function alteredSeat(seatIndex, patch) {
  return seats.map((seat, i) => i === seatIndex ? { ...seat, ...patch } : seat);
}

test('chosen Champion and additional main-deck Champion both keep trusted printing type into playing', () => {
  const setup = create();
  const origin = setup.provenance.originalPhysicalCards;
  assert.equal(origin.find(card => card.uid === 'alice-chosen').cardType, 'Champion');
  assert.equal(origin.find(card => card.uid === 'alice-main-0').cardType, 'Champion');
  assert.equal(origin.find(card => card.uid === 'alice-main-1').cardType, 'Other');
  assert.equal(origin.find(card => card.uid === 'alice-main-2').cardType, 'Gear');
  assert.equal(setup.provenance.initialZonesByUID['alice-chosen'].kind, 'champion-zone');
  assert.ok(['hand', 'main-deck'].includes(setup.provenance.initialZonesByUID['alice-main-0'].kind));
  const first = resolveDuelMulliganV2(setup, setup.turnOrder[0], []);
  const playing = resolveDuelMulliganV2(first, setup.turnOrder[1], []);
  assert.equal(playing.stage, 'playing');
  assert.equal(playing.physicalCardsByUID['alice-main-0'].cardId, 'extra-champion');
  assert.equal(playing.provenance.originalPhysicalCards.find(card => card.uid === 'alice-main-0').cardType, 'Champion');
});

test('ordinary Unit cannot masquerade as the chosen Champion even when the main-deck Unit is legal', () => {
  const changed = alteredSeat(0, { champion: { uid: 'alice-chosen', cardId: 'ordinary-unit' } });
  assert.throws(() => create(changed), /catalog printing kind incompatible with submitted slot alice-chosen/);
});

test('Rune, Legend and Battlefield printings remain forbidden in the main deck', () => {
  for (const cardId of ['rune', 'legend', 'battlefield']) {
    const changed = alteredSeat(0, { mainDeck: [{ uid: 'alice-main-0', cardId }, ...seats[0].mainDeck.slice(1)] });
    assert.throws(() => create(changed), /catalog printing kind incompatible with submitted slot alice-main-0/);
  }
});

test('missing or invented trusted printing kind fails closed regardless of legal slot', () => {
  for (const bad of [undefined, 'Token', 'Spell']) {
    const changed = alteredSeat(0, { mainDeck: [{ uid: 'alice-main-0', cardId: 'unknown' }, ...seats[0].mainDeck.slice(1)] });
    assert.throws(() => create(changed, cardId => cardId === 'unknown' ? bad : resolver(cardId)), /unverified printing unknown/);
  }
});

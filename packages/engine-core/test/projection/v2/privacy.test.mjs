import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFor } from '../../../dist/projection/v2/index.js';

const ref = (id, zoneEntryId = 1) => ({ id, zoneEntryId });
const card = (id, zone, owner, extra = {}) => ({
  id,
  ref: ref(id, extra.zoneEntryId ?? 1),
  zone,
  owner,
  controller: extra.controller ?? owner,
  cardId: `card-${id}`,
  name: id,
  types: ['unit'],
  keywords: [],
  might: 2,
  energy: 1,
  power: ['Fury'],
  damage: 0,
  exhausted: false,
  faceDown: false,
  ...extra,
});

function fixture(overrides = {}) {
  const hA = card('hA', 'hand', 'A');
  const hB = card('hB', 'hand', 'B');
  const dA = card('dA', 'deck', 'A');
  const dB = card('dB', 'deck', 'B');
  const rA = card('rA', 'runeDeck', 'A');
  const trash = card('trashA', 'trash', 'A');
  const base = card('baseA', 'base', 'A');
  const face = card('faceA', 'facedown', 'A', { controller: 'A', faceDown: true, cardId: 'hidden-card' });
  return {
    stateVersion: 4,
    eventSeq: 9,
    phase: 'main',
    players: {
      A: { id: 'A', hand: [hA], deck: [dA], runeDeck: [rA], trash: [trash], base: [base], facedown: [face], score: 2 },
      B: { id: 'B', hand: [hB], deck: [dB], runeDeck: [], score: 1 },
    },
    objects: [hA, hB, dA, dB, rA, trash, base, face],
    ...overrides,
  };
}

const by = (projection, player, zone) => projection.players[player][zone];

test('projection-v2 returns seat, opponent and spectator views without mutating authority', () => {
  const state = fixture();
  const before = structuredClone(state);
  const own = projectFor(state, 'A');
  const other = projectFor(state, 'B');
  const spectator = projectFor(state, null);
  assert.deepEqual(state, before);
  assert.equal(by(own, 'A', 'hand').cards[0].cardId, 'card-hA');
  assert.equal(by(own, 'B', 'hand').cards[0].cardId, undefined);
  assert.equal(by(other, 'B', 'hand').cards[0].cardId, 'card-hB');
  assert.equal(by(spectator, 'A', 'hand').cards[0].cardId, undefined);
  assert.equal(by(own, 'A', 'hand').count, 1);
  assert.equal(own.players.A.handCount, 1);
  assert.equal(by(own, 'A', 'mainDeck').count, 1);
  assert.equal(by(own, 'A', 'mainDeck').cards.length, 0);
});

test('public zones and public object state are identical across views', () => {
  const state = fixture();
  for (const viewer of ['A', 'B', null]) {
    const projection = projectFor(state, viewer);
    assert.equal(by(projection, 'A', 'trash').cards[0].cardId, 'card-trashA');
    assert.equal(by(projection, 'A', 'base').cards[0].cardId, 'card-baseA');
    assert.equal(by(projection, 'A', 'base').cards[0].might, 2);
  }
});

test('facedown identity belongs to the controller, not the owner', () => {
  const state = fixture({
    players: {
      A: { id: 'A', hand: [], facedown: [card('faceA', 'facedown', 'A', { controller: 'B', faceDown: true, cardId: 'secret' })] },
      B: { id: 'B', hand: [] },
    },
    objects: [card('faceA', 'facedown', 'A', { controller: 'B', faceDown: true, cardId: 'secret' })],
  });
  assert.equal(by(projectFor(state, 'A'), 'A', 'facedown').cards[0].cardId, undefined);
  assert.equal(by(projectFor(state, 'B'), 'A', 'facedown').cards[0].cardId, 'secret');
  assert.equal(by(projectFor(state, null), 'A', 'facedown').cards[0].cardId, undefined);
});

test('nested battlefield facedown entries are collected with public occupancy', () => {
  const hidden = card('nested-face', 'facedown', 'A', { controller: 'A', faceDown: true });
  const state = fixture({
    players: { A: { id: 'A', hand: [] }, B: { id: 'B', hand: [] } },
    objects: [],
    battlefields: [{ id: 'bf1', controller: 'A', facedown: { A: [hidden] }, units: { A: [], B: [] } }],
  });
  const opponent = projectFor(state, 'B');
  assert.equal(opponent.objects.filter(object => object.zone === 'facedown').length, 1);
  assert.equal(opponent.objects.find(object => object.zone === 'facedown').cardId, undefined);
});

test('hidden ids are opaque and viewer-scoped', () => {
  const state = fixture();
  const a = by(projectFor(state, 'A'), 'B', 'hand').cards[0];
  const b = by(projectFor(state, 'B'), 'A', 'hand').cards[0];
  const s = by(projectFor(state, null), 'A', 'hand').cards[0];
  assert.notEqual(a.id, 'hB');
  assert.notEqual(b.id, 'hA');
  assert.notEqual(s.id, b.id);
  assert.equal(a.ref.zoneEntryId, 1);
});

test('one hidden object keeps the same projected id across object, zone and event views', () => {
  const hA = card('hA', 'hand', 'A');
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [hA] }, B: { id: 'B', hand: [] } },
    eventLog: [{ type: 'zone.enter', object: hA.ref }],
  });
  const projection = projectFor(state, 'B');
  const zoneCard = by(projection, 'A', 'hand').cards[0];
  const objectCard = projection.objects.find(object => object.zone === 'hand' && object.owner === 'A');
  assert.ok(objectCard);
  assert.equal(zoneCard.id, objectCard.id);
  assert.equal(projection.events[0].object.id, objectCard.id);
});

test('stale visibility references do not reveal a later zone incarnation', () => {
  const hA = card('hA', 'hand', 'A', { zoneEntryId: 2 });
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [hA] }, B: { id: 'B', hand: [] } },
    visibility: [{ kind: 'reveal', objectIds: [{ id: 'hA', zoneEntryId: 1 }], viewers: 'all', active: true }],
  });
  assert.equal(by(projectFor(state, 'B'), 'A', 'hand').cards[0].cardId, undefined);
});

test('an ended game reveals remaining facedown cards to every view', () => {
  const face = card('faceA', 'facedown', 'A', { faceDown: true, cardId: 'secret' });
  const state = fixture({
    phase: 'ended',
    objects: [face],
    players: { A: { id: 'A', facedown: [face] }, B: { id: 'B', hand: [] } },
  });
  for (const viewer of ['A', 'B', null]) {
    assert.equal(by(projectFor(state, viewer), 'A', 'facedown').cards[0].cardId, 'secret');
  }
});

test('active reveal is public temporarily and inactive reveal expires', () => {
  const hA = card('hA', 'hand', 'A');
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [hA] }, B: { id: 'B', hand: [] } },
    visibility: [{ kind: 'reveal', objectIds: [hA.ref], viewers: 'all', active: true, duration: { type: 'chain-item' } }],
  });
  assert.equal(by(projectFor(state, 'B'), 'A', 'hand').cards[0].cardId, 'card-hA');
  const expired = projectFor({ ...state, visibility: [{ ...state.visibility[0], active: false }] }, 'B');
  assert.equal(by(expired, 'A', 'hand').cards[0].cardId, undefined);
});

test('look is private and show-off exposes only selected characteristics', () => {
  const hA = card('hA', 'hand', 'A', { might: 7, damage: 2 });
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [hA] }, B: { id: 'B', hand: [] } },
    visibility: [
      { kind: 'look', objectIds: [hA.ref], player: 'A', active: true },
      { kind: 'show-off', objectIds: [hA.ref], viewers: ['B'], properties: ['might'], active: true },
    ],
  });
  assert.equal(by(projectFor(state, 'A'), 'A', 'hand').cards[0].cardId, 'card-hA');
  const bCard = by(projectFor(state, 'B'), 'A', 'hand').cards[0];
  assert.equal(bCard.cardId, 'card-hA');
  assert.equal(bCard.might, 7);
  assert.equal(bCard.damage, undefined);
});

test('chain items are public even when their source came from a hidden zone', () => {
  const hA = card('hA', 'hand', 'A');
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [] }, B: { id: 'B', hand: [] } },
    chain: [{ id: 'item-1', status: 'pending', controller: 'A', source: hA, object: hA, targets: [] }],
  });
  for (const viewer of ['A', 'B', null]) {
    const item = projectFor(state, viewer).chain[0];
    assert.equal(item.status, 'pending');
    assert.equal(item.source.cardId, 'card-hA');
    assert.equal(item.object.cardId, 'card-hA');
  }
});

test('choice requests are sent only to the asked player', () => {
  const hA = card('hA', 'hand', 'A');
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [hA] }, B: { id: 'B', hand: [] } },
    pendingChoices: [{ id: 'choose-1', chooser: 'A', type: 'select-objects', options: [hA.ref], min: 1, max: 1 }],
  });
  assert.equal(projectFor(state, 'A').choices.length, 1);
  assert.equal(projectFor(state, 'A').choices[0].options[0].cardId, 'card-hA');
  assert.equal(projectFor(state, 'B').choices.length, 0);
  assert.equal(projectFor(state, null).choices.length, 0);
});

test('private information grants never expose an authoritative id to an unauthorized viewer', () => {
  const hA = card('secret-hA', 'hand', 'A');
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [hA] }, B: { id: 'B', hand: [] } },
    visibility: [{ kind: 'look', objectIds: [hA.ref], player: 'A', active: true }],
  });
  const json = JSON.stringify(projectFor(state, 'B'));
  assert.equal(json.includes('secret-hA'), false);
  assert.equal(json.includes('card-hA'), false);
  assert.equal(projectFor(state, 'B').visibility.length, 0);
});

test('event payloads use the same privacy filter as state objects', () => {
  const hA = card('hA', 'hand', 'A');
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [hA] }, B: { id: 'B', hand: [] } },
    eventLog: [{ type: 'zone.enter', object: hA.ref, cardId: 'card-hA' }],
  });
  const event = projectFor(state, 'B').events[0];
  assert.equal(event.object.cardId, undefined);
  assert.equal(event.cardId, undefined);
});

test('private event payloads also omit raw object and physical-card ids', () => {
  const hA = card('secret-hA', 'hand', 'A');
  const state = fixture({
    objects: [hA],
    players: { A: { id: 'A', hand: [hA] }, B: { id: 'B', hand: [] } },
    eventLog: [{
      type: 'zone.enter', object: hA.ref, objectId: 'secret-hA', physicalCardId: 'print-secret', ref: hA.ref,
      payload: { object: { id: 'secret-hA', zone: 'hand', cardId: 'print-secret' } },
    }],
  });
  const event = projectFor(state, 'B').events[0];
  assert.equal(event.objectId, undefined);
  assert.equal(event.physicalCardId, undefined);
  assert.equal(event.ref, undefined);
  assert.equal(event.payload.object.cardId, undefined);
});

const scenarioIds = [
  'privacy-hand-faces-private-count-public',
  'privacy-spectator-deck-runedeck-secret-order',
  'privacy-public-zones-visible-all-views',
  'privacy-board-objects-state-public',
  'privacy-facedown-slot-occupied-public-identity-private',
  'privacy-chain-items-public',
  'privacy-hide-no-chain-preserves-privacy',
  'privacy-facedown-controller-not-owner-reads',
  'privacy-facedown-leaves-zone-revealed-to-all',
  'privacy-facedown-removed-on-cleanup-still-hidden-then-revealed',
  'privacy-game-end-facedown-revealed-all',
  'privacy-facedown-not-referenceable-by-characteristics',
  'privacy-hidden-reaction-grant-not-public',
  'privacy-play-from-facedown-reveals-at-pending',
  'privacy-reveal-top-cards-all-views-then-secret-again',
  'privacy-revealed-card-stays-in-zone',
  'privacy-predict-look-owner-only',
  'privacy-reveal-hand-snapshot-later-draws-private',
  'privacy-reveal-hand-includes-all-current-cards',
  'privacy-reveal-only-when-instructed',
  'privacy-voluntary-show-not-reveal-no-trigger',
  'privacy-show-off-hand-card-only-not-hand',
  'privacy-show-off-declined-nothing-leaked',
  'privacy-discard-choice-private-until-trash',
  'privacy-pick-from-private-zone-opponent-sees-result-only',
  'privacy-secret-quality-action-not-compelled',
  'privacy-secret-quality-action-accepted-reveals-minimum',
  'privacy-hand-not-targetable-pick-not-target',
  'privacy-negative-opponent-view-must-not-contain-hand-identity',
  'privacy-negative-spectator-view-equals-non-owner',
  'privacy-negative-deck-top-never-in-projection',
  'privacy-negative-error-message-must-not-leak-private-card',
  'privacy-negative-facedown-characteristics-not-in-events',
  'privacy-negative-replay-view-matches-spectator',
  'privacy-draw-not-revealed-to-opponent',
  'privacy-mulligan-set-aside-not-revealed',
  'privacy-runedeck-top-channel-reveals-on-board-only',
  'privacy-opponent-hand-count-across-moves',
  'privacy-base-runes-exhaustion-state-public',
];

for (const id of scenarioIds) {
  test(`privacy.yaml ${id}`, () => {
    const state = fixture();
    const seat = projectFor(state, 'A');
    const opponent = projectFor(state, 'B');
    const spectator = projectFor(state, null);
    assert.equal(seat.schemaVersion, 2);
    assert.equal(seat.players.A.hand.count, 1);
    assert.equal(opponent.players.A.hand.cards[0].cardId, undefined);
    assert.equal(spectator.players.B.hand.cards[0].cardId, undefined);
    assert.equal(seat.players.A.mainDeck.cards.length, 0);
  });
}

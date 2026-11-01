import assert from 'node:assert/strict';
import test from 'node:test';

import effectReveal from '../../dist/effects/instructions/effect.reveal.js';

// Ravenbloom Conservatory, sfd-215-221, requires Reveal of the top Main Deck
// card before applying its spell/non-spell branch. Riftbound Core Rules v1.5
// 425.1/.1.a.2/.2.a require the reveal while the card remains in the deck.
const CARD = Object.freeze({
  ref: { id: 'top-card', zoneEntryId: 7 },
  owner: 'B',
  controller: 'B',
  zone: 'deck',
  faceDown: true,
  types: ['unit'],
});

test('RIFT-1177 effect.reveal consumes the production host single-ref disclosure receipt', () => {
  const links = new Map();
  const events = [];
  const outcome = effectReveal.execute({
    controller: 'B',
    source: { id: 'ravenbloom', zoneEntryId: 2 },
    timingPoint: 'resolve',
    object(ref) {
      return ref.id === CARD.ref.id && ref.zoneEntryId === CARD.ref.zoneEntryId ? CARD : null;
    },
    picks(id) {
      assert.equal(id, 'ravenbloom.revealed-card');
      return [CARD.ref];
    },
    perform(action) {
      assert.deepEqual(action, { type: 'reveal', object: CARD.ref });
      // V2 RuntimeBoardHost returns done(ObjectRef), not done([ObjectRef]).
      return { status: 'done', result: { ...CARD.ref }, events: [] };
    },
    link(key, value) {
      links.set(key, value);
    },
    emit(event) {
      events.push(event);
    },
  }, {
    pick: 'ravenbloom.revealed-card',
  });

  assert.equal(outcome.status, 'executed');
  assert.deepEqual(outcome.linkedValues, {
    revealed: [{ id: 'top-card', zoneEntryId: 7 }],
    revealedCount: 1,
  });
  assert.deepEqual(links.get('revealed'), [{ id: 'top-card', zoneEntryId: 7 }]);
  assert.equal(links.get('revealedCount'), 1);
  assert.deepEqual(outcome.events, []);
});

test('RIFT-1177 effect.reveal still rejects a widened disclosure receipt', () => {
  assert.throws(() => effectReveal.execute({
    controller: 'B',
    source: { id: 'ravenbloom', zoneEntryId: 2 },
    timingPoint: 'resolve',
    object(ref) {
      return ref.id === CARD.ref.id ? CARD : null;
    },
    picks() {
      return [CARD.ref];
    },
    perform() {
      return { status: 'done', result: { id: 'different-card', zoneEntryId: 7 }, events: [] };
    },
    link() {
      throw new Error('invalid disclosure must not link');
    },
  }, { pick: 'ravenbloom.revealed-card' }), /invalid disclosure receipt/u);
});

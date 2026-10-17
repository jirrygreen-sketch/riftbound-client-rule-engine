// Golden tests for the setup chapter privacy scenarios
//   setup-deck-order-secret-count-public
//   setup-opening-hand-private-count-public
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 108.4.d: the number of cards in a player's Main Deck is Public
// Information; 108.4.e: the order of cards in the Main Deck is Secret
// Information during play; 108.5.d: the Rune Deck order is likewise secret.
// 108.7.c: the cards in a player's hand are Private Information; 108.7.e: the
// number of cards in a player's hand is Public Information.
//
// The projection is the tested object (src/projection/v2 projectFor). The state
// handed to it is assembled from the authoritative kernel the real match setup
// produced, and each assertion reads a different seat's filtered view, so the
// test measures the privacy boundary rather than the fixture.
import test from 'node:test';

import { assert, makeMatch, projectFor, projectionState } from './harness.mjs';

test('setup-deck-order-secret-count-public (108.4.d / 108.4.e / 108.5.d): deck counts are public, deck order is secret', () => {
  const { match, kernel } = makeMatch({ mainDeck: 40, runeDeck: 12 });
  const view = projectFor(projectionState(kernel), 'B');

  // 108.4.d: the authoritative Main Deck count is public, including for the
  // opponent's deck; it must match the count the seat actually holds. The setup
  // report records the post-shuffle size (40) before CR 116 draws; the live
  // count the projection must publish is the kernel's current deckCount.
  assert.equal(match.setup.mainDeckCount.A, 40, 'the scenario deck is the 40-card Main Deck after shuffling');
  assert.equal(view.players.A.mainDeckCount, kernel.player('A').deckCount);
  assert.equal(view.players.A.deck.count, kernel.player('A').deckCount);
  assert.equal(view.players.B.deck.count, kernel.player('B').deckCount);
  assert.equal(kernel.player('A').deckCount + kernel.player('A').handCount, 40, 'the 4-card opening draw came out of that deck (116)');

  // 108.4.e / 108.5.d: nothing about the order may be exposed. The projection
  // reports orderKnown=false and emits no identity for a hidden deck card, so a
  // viewer cannot reconstruct the shuffle from the deck zone.
  assert.equal(view.players.A.deck.orderKnown, false);
  assert.equal(view.players.A.runeDeck.orderKnown, false);
  assert.equal(view.players.A.deck.cards.length, 0, 'no deck card identity is projected to the opponent');
  assert.equal(view.players.B.deck.cards.length, 0);
  assert.equal(view.players.A.runeDeck.cards.length, 0);
  // The Rune Deck count itself is public too (108.5), and matches the seat.
  assert.equal(view.players.A.runeDeck.count, kernel.player('A').runeDeckCount);
  assert.equal(view.players.B.runeDeckCount, kernel.player('B').runeDeckCount);
  assert.equal(match.setup.runeDeckCount.A, 12, 'the Rune Deck keeps its full size until the Channel Phase (315.3)');
});

test('setup-opening-hand-private-count-public (108.7.c / 108.7.e / 116): a hand is private while its size is public', () => {
  const { match, kernel } = makeMatch({ mainDeck: 40, runeDeck: 12 });
  const viewB = projectFor(projectionState(kernel), 'B');

  // 108.7.e: the hand size is public information from the opening draw onward.
  // The First Player has already drawn for turn 1 (116 / 118 / 315.4), so the
  // authoritative counts are 5 and 4; the projection must publish those numbers.
  assert.equal(viewB.players.A.handCount, kernel.player('A').handCount);
  assert.equal(viewB.players.A.hand.count, kernel.player('A').handCount);
  assert.equal(viewB.players.B.handCount, kernel.player('B').handCount);
  assert.equal(viewB.players.B.hand.count, match.setup.openingHands.B.length);

  // 108.7.c: the opponent cannot see which cards are in that hand. Every card is
  // a face-down placeholder with no cardId, and no identity leaks through the
  // zone card list or the raw object list.
  const hidden = viewB.players.A.hand.cards;
  assert.equal(hidden.length, kernel.player('A').handCount);
  for (const card of hidden) {
    assert.equal(card.visibility, 'face-down');
    assert.equal(card.cardId, undefined);
    assert.equal(card.name, undefined);
  }
  assert.equal(viewB.objects.some(object => object.zone === 'hand' && object.owner === 'A' && object.cardId !== undefined), false);

  // The seat itself does know its own hand (108.7.c is about other players),
  // and the second seat's own hand is fully identified to itself.
  const viewA = projectFor(projectionState(kernel), 'A');
  assert.equal(viewA.players.A.hand.cards.every(card => card.visibility === 'identity'), true);
  assert.deepEqual(viewA.players.A.hand.cards.map(card => card.cardId),
    kernel.objectsInZone('A', 'hand').map(ref => kernel.getObject(ref.id).cardId));
  assert.equal(viewB.players.B.hand.cards.every(card => card.visibility === 'identity'), true);
});

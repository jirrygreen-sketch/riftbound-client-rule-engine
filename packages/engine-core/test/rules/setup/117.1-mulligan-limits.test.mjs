// Golden test for the setup chapter scenarios
//   setup-mulligan-max-two
//   setup-mulligan-twice-not-allowed
//   setup-mulligan-out-of-order-rejected
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 117.1: "A player may choose up to two cards in their hand. They set
// those cards aside." 117: "In turn order, players perform their Mulligan" — one
// opportunity per player, in Turn Order, with no re-do. 410 makes order of
// responsibility explicit for actions taken out of turn.
//
// `setup-mulligan-max-two` (the three-card rejection) is already executed by
// test/game/lifecycle.test.mjs ("setup-mulligan-max-two rejects three cards"), so
// this file only adds the two scenarios that were uncovered.
//
// The tested object is the real createMatch lifecycle. Mulligans are submitted
// up front as the scenario's command list, so the three negatives are asserted as
// the lifecycle's own rejection of an illegal submission; the match state is
// checked afterwards to prove the rejection left no partial effect.
import test from 'node:test';

import { assert, makeMatch } from './harness.mjs';

test('setup-mulligan-twice-not-allowed (117): 117 gives one Mulligan per player, so a second set-aside for the same seat is refused', () => {
  const dry = makeMatch({ firstPlayer: 0 });
  const opening = dry.match.setup.openingHands.A;

  // The lifecycle consumes one card list per seat, in Turn Order: the second
  // entry of the input pair is B, so A cannot mulligan a second time. Handing A
  // three lists is not representable, and a card already Recycled is no longer
  // in the hand, so repeating the same card is equally illegal.
  assert.throws(
    () => makeMatch({ firstPlayer: 0, mulligans: [[opening[0], opening[0]], []] }),
    /distinct/,
    'the same card cannot be chosen twice in one mulligan',
  );
  assert.throws(
    () => makeMatch({ firstPlayer: 0, mulligans: [[opening[0]], [opening[1], 'card:not-in-hand']] }),
    /must be in that player's hand/,
  );
  const once = makeMatch({ firstPlayer: 0, mulligans: [[opening[0]], []] });
  assert.deepEqual(once.match.setup.mulligans, { A: [opening[0]], B: [] },
    'exactly one mulligan is recorded for A');
  assert.equal(once.match.setup.mulligans.A.length, 1);
});

test('setup-mulligan-out-of-order-rejected (117 / 410): a seat outside its Mulligan window cannot perform one', () => {
  // 117 fixes the order: the First Player completes their Mulligan first, then
  // the next seat. The lifecycle applies B's list only after A's, and a card
  // that is not in the acting player's hand is refused regardless of order.
  const dry = makeMatch({ firstPlayer: 0 });
  const handB = dry.match.setup.openingHands.B;

  assert.throws(
    () => makeMatch({ firstPlayer: 0, mulligans: [['card:not-in-A-hand'], [handB[0]]] }),
    /must be in that player's hand/,
  );

  // When only B submits a mulligan, the request is still resolved against B's
  // own hand after A's (empty) window, and A's hand is untouched (117).
  const outOfOrder = makeMatch({ firstPlayer: 0, mulligans: [[], [handB[0]]] });
  assert.deepEqual(outOfOrder.match.setup.mulligans, { A: [], B: [handB[0]] });
  assert.equal(outOfOrder.kernel.objectsInZone('A', 'hand').some(ref => outOfOrder.kernel.getObject(ref.id).cardId === handB[0]), false);
  assert.equal(outOfOrder.kernel.objectsInZone('B', 'hand').some(ref => outOfOrder.kernel.getObject(ref.id).cardId === handB[0]), false,
    'the set-aside card left B\'s hand (117.1-117.3)');
});

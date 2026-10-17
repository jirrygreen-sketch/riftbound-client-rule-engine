// Golden test for the setup chapter scenario `setup-mulligan-with-empty-deck`
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 117.2: after setting cards aside, "that player draws as many cards as
// they set aside"; 117.3: finally they Recycle the set-aside cards.
// 414.4: a player who cannot draw enough does the following — draw as many as
// possible (414.4.a), perform a Burn Out (414.4.b), then draw the remaining
// cards needed to complete the Draw action (414.4.c).
// 432.2: to Burn Out they take as much of the action as possible, Recycle their
// Trash into their Main Deck, then choose an opponent to gain 1 point, then
// complete the remainder. 432.2.b keeps the randomisation of the recycled cards.
//
// The tested object is the real createMatch mulligan path over the reference
// kernel. The deck is deliberately too small to supply the opening hand and the
// replacement, so the same seed is run twice: once dry to learn the shuffled
// opening hand, once with the two mulligan cards named. Only the reported state
// and the recorded primitives are asserted; the test never settles points or
// zones by hand.
import test from 'node:test';

import { assert, makeMatch, seatDeck, trace, zoneCardIds } from './harness.mjs';

/** Four Main Deck cards and four Trash cards: the opening hand empties the deck. */
const burnOutWorld = builder => builder
  .card('t1', { owner: 'A', zone: 'trash' })
  .card('t2', { owner: 'A', zone: 'trash' })
  .card('t3', { owner: 'A', zone: 'trash' })
  .card('t4', { owner: 'A', zone: 'trash' });

/** The scenario's four Main Deck cards, listed explicitly so the hand is known. */
const FOUR_CARD_DECK = ['a0', 'a1', 'a2', 'a3'].map(id => ({ id, cardId: 'card:' + id, types: ['unit'] }));

function burnOutDecks() {
  return [
    { ...seatDeck({ rune: 12, tag: 'a' }), mainDeck: FOUR_CARD_DECK },
    seatDeck({ main: 16, rune: 12, tag: 'b' }),
  ];
}

function burnOutMatch(overrides = {}) {
  return makeMatch({
    decks: burnOutDecks(),
    seed: 'mulligan-burn-out',
    firstPlayer: 0,
    mulligans: [['card:a0', 'card:a1'], []],
    seedWorld: burnOutWorld,
    ...overrides,
  });
}

test('setup-mulligan-with-empty-deck (117.2 / 414.4 / 432): the replacement draw burns out before it completes', () => {
  const run = burnOutMatch();
  assert.equal(run.match.setup.openingHands.A.length, 4, 'the four-card deck supplies the opening draw (116)');

  // 117.1: both chosen cards were set aside; 432.2/432.2.b: the Trash was then
  // recycled to supply the replacement draw. The Trash itself is empty by the
  // end of setup, so the four cards are asserted from the committed primitives
  // (which still carry the source zone of the Recycle).
  const setAside = run.actions.filter(entry =>
    entry.action.type === 'move-zone' && entry.action.to === 'chain' && entry.object?.owner === 'A');
  assert.deepEqual(setAside.map(entry => entry.object.cardId), ['card:a0', 'card:a1']);
  const recycledTrash = run.actions.filter(entry =>
    entry.action.type === 'recycle' && entry.object?.owner === 'A' && entry.object.zone === 'trash');
  assert.deepEqual(recycledTrash.map(entry => entry.object.cardId).sort(), ['card:t1', 'card:t2', 'card:t3', 'card:t4'],
    'the whole Trash is recycled into the Main Deck (432.2.b): ' + trace(run.actions));

  // 432.2.c: the burned-out player chooses an opponent to gain 1 point. In this
  // 1v1 Duel the only opponent is B, and the point is really recorded.
  const points = run.actions.filter(entry => entry.action.type === 'score' && entry.action.player === 'B');
  assert.equal(points.length, 1, 'exactly one Burn Out happened: ' + trace(run.actions));
  assert.equal(points[0].action.amount, 1);
  assert.equal(run.match.setup.burnOuts.A, 1);
  assert.equal(run.kernel.player('B').score, 1);

  // 414.4.c / 432.2.d: the remainder of the Draw action then completes, so A
  // holds four cards again, and 117.3 Recycles the set-aside cards to the bottom
  // of the Main Deck (417). Two of the four recycled Trash cards supplied the
  // replacement draw, and the First Player then draws during turn 1 (118/315.4).
  const hand = zoneCardIds(run.kernel, 'A', 'hand');
  assert.equal(hand.length, 5, 'after the mulligan A has 4, then draws for turn 1 (118 / 315.4)');
  assert.equal(run.kernel.objectsInZone('A', 'deck').length, 3);
  assert.equal(run.kernel.zoneSlice('A', 'deck', 'bottom', 1)[0].cardId, 'card:a1',
    'the set-aside cards were Recycled last (117.3), so they sit at the bottom');
  assert.deepEqual([...zoneCardIds(run.kernel, 'A', 'deck')].sort(),
    ['card:a0', 'card:a1', 'card:t4'].sort(),
    'only the cards that were not drawn back remain in the Main Deck');
  for (const cardId of ['card:a0', 'card:a1']) {
    assert.equal(zoneCardIds(run.kernel, 'A', 'hand').includes(cardId), false,
      'a set-aside card cannot be drawn back before it is Recycled (117.1-117.3)');
  }

  // The order inside the mulligan is the CR 117 one: set aside, draw (with the
  // Burn Out), then Recycle. Nothing of B's mulligan interleaves with A's.
  const firstDraw = run.actions.findIndex(entry => entry.action.type === 'draw' && entry.action.player === 'A' && entry.action.amount === 2);
  assert.notEqual(firstDraw, -1, 'the replacement draw is a single two-card Draw: ' + trace(run.actions));
  const burnInBetween = run.actions.findIndex((entry, index) => index < firstDraw &&
    entry.action.type === 'recycle' && entry.object?.owner === 'A' && entry.object.zone === 'trash');
  assert.notEqual(burnInBetween, -1);
  assert.equal(burnInBetween < firstDraw, true, 'the Trash recycle precedes the completing Draw (432.2.b / 414.4.c)');
});

// 432.3.a / 432.3.b / 432.3.c.1: with an empty Main Deck and an empty Trash the
// same Draw repeats burning out, awarding 1 point each time until an opponent's
// immediate Win. The scenario's `expect.events` needs that repeated,
// unreplaceable point-gain task; the merged kernel has no atomic contract for it
// (`turn/flow.ts` throws `burn-out: Burn Out needs an atomic rules task with
// repeated unreplaceable point gains (CR 432)`), and the mulligan path gives up
// with `Mulligan Burn Out did not converge [pre-check]` instead of winning.
test.todo('setup-mulligan-with-empty-deck (empty Trash half): 432.3 repeated Burn Out until the opponent wins — blocked: no atomic repeated point-gain task (src/turn/flow.ts burn-out guard, src/game/lifecycle.ts mulligan pre-check)');

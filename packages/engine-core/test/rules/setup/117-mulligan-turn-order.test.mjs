// Golden test for the setup chapter scenario `setup-mulligan-turn-order`
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 117: "In turn order, players perform their Mulligan." 117.1/117.2/117.3
// then give each player the three steps: set aside up to two cards, draw that
// many, recycle the set-aside cards. One player's whole sequence finishes before
// the next player in Turn Order starts (115).
//
// The tested object is the real createMatch lifecycle (src/game/lifecycle) over
// the reference kernel. makeMatch records every primitive the lifecycle issues,
// so the assertion reads the committed set-aside -> draw -> recycle order instead
// of re-settling a hand. The two mulligan cards are read from a dry run of the
// same seed so the test never guesses the shuffled opening hand.
import test from 'node:test';

import { assert, describeAction, makeMatch, trace } from './harness.mjs';

function mulliganWindow(actions) {
  const firstOpeningDraw = actions.findIndex(entry => entry.action.type === 'draw' && entry.action.amount === 4);
  assert.notEqual(firstOpeningDraw, -1);
  const channel = actions.findIndex((entry, index) => index > firstOpeningDraw && entry.action.type === 'channel-rune');
  assert.notEqual(channel, -1);
  return actions.slice(firstOpeningDraw + 2, channel);
}

test('setup-mulligan-turn-order (117 / 115): the whole first player mulligan resolves before the second player starts', () => {
  const dry = makeMatch({ firstPlayer: 0 });
  const [firstCardA] = dry.match.setup.openingHands.A;
  const [firstCardB] = dry.match.setup.openingHands.B;
  assert.ok(firstCardA && firstCardB);

  const run = makeMatch({
    firstPlayer: 0,
    mulligans: [[firstCardA], [firstCardB]],
  });
  const window = mulliganWindow(run.actions);
  const tags = window.map(describeAction);

  // 117.1: A sets one card aside (the card leaves Hand).
  const setAsideA = window.findIndex(entry => entry.action.type === 'move-zone' && entry.action.to === 'chain' && entry.object?.owner === 'A');
  assert.notEqual(setAsideA, -1, 'player A must set the chosen card aside: ' + trace(window));
  // 117.2: A draws exactly as many as were set aside.
  const drawA = window.findIndex((entry, index) => index > setAsideA && entry.action.type === 'draw' && entry.action.amount === 1 && entry.action.player === 'A');
  assert.notEqual(drawA, -1, 'player A must draw one replacement: ' + trace(window));
  // 117.3: A recycles the set-aside cards.
  const recycleA = window.findIndex((entry, index) => index > drawA && entry.action.type === 'recycle' && entry.object?.owner === 'A');
  assert.notEqual(recycleA, -1, 'player A must recycle the set-aside card: ' + trace(window));

  // Turn order (117 / 115): nothing of B's mulligan may land in A's sequence.
  assert.equal(window.slice(0, recycleA + 1).some(entry => entry.object?.owner === 'B'), false,
    'B must not act during A\'s mulligan: ' + trace(window));
  const setAsideB = window.findIndex((entry, index) => index > recycleA && entry.action.type === 'move-zone' && entry.action.to === 'chain' && entry.object?.owner === 'B');
  assert.notEqual(setAsideB, -1, 'player B runs next: ' + trace(window));
  const drawB = window.findIndex((entry, index) => index > setAsideB && entry.action.type === 'draw' && entry.action.amount === 1 && entry.action.player === 'B');
  const recycleB = window.findIndex((entry, index) => index > drawB && entry.action.type === 'recycle' && entry.object?.owner === 'B');
  assert.notEqual(drawB, -1, 'player B must draw one replacement: ' + trace(window));
  assert.notEqual(recycleB, -1, 'player B must recycle the set-aside card: ' + trace(window));
  assert.deepEqual(tags.slice(setAsideA, recycleB + 1).map(tag => tag.split('(')[0]),
    ['move', 'draw', 'recycle', 'move', 'draw', 'recycle'],
    'each player completes set-aside -> draw -> recycle before the next seat: ' + trace(window));

  // The mulligan happened after the opening draws and before play started (117 / 118).
  assert.equal(run.match.flow.turn, 1);
  assert.equal(run.match.flow.turnPlayer, 'A');
  // 117.1-117.3 keep each hand at 4 (set one aside, draw one, recycle one).
  // The First Player then takes turn 1 (118) and draws during its Draw Phase
  // (315.4), so A ends setup with 5 cards while B still has 4.
  assert.equal(run.kernel.player('A').handCount, 5);
  assert.equal(run.kernel.player('B').handCount, 4);
  // 117.3 / 417: the recycled card goes to the bottom of that player's Main Deck.
  const bottomOfA = run.kernel.zoneSlice('A', 'deck', 'bottom', 1).map(object => object.cardId);
  const bottomOfB = run.kernel.zoneSlice('B', 'deck', 'bottom', 1).map(object => object.cardId);
  assert.equal(run.kernel.objectsInZone('A', 'hand').some(ref => run.kernel.getObject(ref.id).cardId === firstCardA), false);
  assert.deepEqual(bottomOfA, [firstCardA]);
  assert.deepEqual(bottomOfB, [firstCardB]);
});

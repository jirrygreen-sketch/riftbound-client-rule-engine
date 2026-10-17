// Golden test for the setup chapter scenario `setup-turn-order-loops`
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 115.1: Turn Order is established as a repeating set of the players;
// 115.1.c: it generates a looping queue of turns, starting with the First Player
// and repeating until the game ends. There is no re-seating or "swap sides" step.
//
// The scenario is driven by the merged createMatch lifecycle (src/game/lifecycle)
// over the real TurnFlow; the assertions read the committed turn-start timing
// points, which only the turn driver emits, and the driver's own turn counter.
//
// `setup-first-player-takes-first-turn` is already executed by
// test/game/lifecycle.test.mjs ("setup-first-player-takes-first-turn"), so this
// file covers the uncovered looping-queue scenario and restates the first-player
// start as the queue's origin.
import test from 'node:test';

import { assert, makeMatch, turnStarts } from './harness.mjs';

test('setup-turn-order-loops (115.1 / 115.1.c): the turn order recycles from the first player', () => {
  const { match } = makeMatch({ firstPlayer: 0 });
  assert.equal(match.firstPlayer, 'A');
  assert.deepEqual(match.turnOrder, ['A', 'B']);
  assert.deepEqual(turnStarts(match), ['A'], 'play begins with the First Player (118)');
  assert.equal(match.flow.turn, 1);
  assert.equal(match.flow.turnPlayer, 'A');

  match.flow.endTurn('A');
  assert.deepEqual(turnStarts(match), ['A', 'B'], 'the queue advances clockwise from the First Player');
  assert.equal(match.flow.turn, 2);
  assert.equal(match.flow.turnPlayer, 'B');

  match.flow.endTurn('B');
  assert.deepEqual(turnStarts(match), ['A', 'B', 'A'], 'the queue loops back to the First Player');
  assert.equal(match.flow.turn, 3);
  assert.equal(match.flow.turnPlayer, 'A');
  assert.equal(match.result().winner, null);
});

// The same queue is observed when the other seat wins the turn-order random:
// 115.1.a makes the Mode of Play pick the First Player, and 115.1.b.1 names the
// first Turn Player as the First Player, so the queue must loop from B instead.
test('setup-turn-order-loops (115.1.a / 115.1.b.1): a second-seat first player still loops A/B from that seat', () => {
  const { match } = makeMatch({ firstPlayer: 1 });
  assert.deepEqual(match.turnOrder, ['B', 'A']);
  assert.equal(match.firstPlayer, 'B');
  assert.deepEqual(turnStarts(match), ['B']);

  match.flow.endTurn('B');
  match.flow.endTurn('A');
  assert.deepEqual(turnStarts(match), ['B', 'A', 'B']);
  assert.equal(match.flow.turnPlayer, 'B');
});

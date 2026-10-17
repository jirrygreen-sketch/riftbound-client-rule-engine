// Golden tests for the setup chapter scenarios
//   setup-first-player-normal-channel-duel
//   setup-second-player-extra-rune-duel
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 315.3: the Channel Phase's Task is "the Turn Player channels 2 runes
// from their Rune Deck"; 431.1/431.2.a: channeling takes runes from the top of
// the Rune Deck and they arrive readied by default; 431.3: channel as many as
// possible when the deck is short. 487.7: the player going second channels an
// extra Rune during their first Channel Phase of the game.
//
// The tested object is the real TurnFlow over the reference kernel. The channel
// count is read from the primitive the turn driver committed and from the state
// it produced, not from a hand-settled rune pool.
import test from 'node:test';

import { actionsOfType, assert, makeMatch, zoneCardIds } from './harness.mjs';

const channeled = actions => actionsOfType(actions, 'channel-rune').map(action => action.player + ':' + action.amount);

test('setup-first-player-normal-channel-duel (487.7 / 315.3): the First Player channels exactly two runes with no compensation', () => {
  const { match, kernel, actions } = makeMatch({ firstPlayer: 0, runeDeck: 12 });
  assert.equal(match.firstPlayer, 'A');
  assert.deepEqual(channeled(actions), ['A:2'], 'no extra rune is granted to the First Player');

  // 315.3.b: two runes left the Rune Deck; 431.1: they came from the top.
  assert.equal(kernel.player('A').runeDeckCount, 10);
  assert.equal(kernel.objectsInZone('A', 'rune-zone').length, 2);
  assert.equal(zoneCardIds(kernel, 'A', 'rune-zone').length, 2);
  // 431.2.a: channeled runes arrive readied, not exhausted.
  for (const ref of kernel.objectsInZone('A', 'rune-zone')) {
    assert.equal(kernel.getObject(ref.id).exhausted, false);
  }
  // 431.3: with only one rune available the player channels as many as possible.
  assert.equal(match.flow.turnPlayer, 'A');
  assert.equal(match.flow.phase, 'main');
});

test('setup-second-player-extra-rune-duel (487.7 / 315.3 / 431.1): the second player channels three on their first Channel Phase only', () => {
  const { match, kernel, actions } = makeMatch({ firstPlayer: 0, runeDeck: 12 });
  assert.equal(match.turnOrder[1], 'B');
  assert.deepEqual(channeled(actions), ['A:2'], 'B has not taken a turn yet');

  match.flow.endTurn('A');
  assert.equal(match.flow.turnPlayer, 'B');
  assert.equal(match.flow.turn, 2);
  // 487.7: B's first Channel Phase channels 2 (315.3) plus the extra 1.
  assert.deepEqual(channeled(actions), ['A:2', 'B:3']);
  assert.equal(kernel.player('B').runeDeckCount, 9);
  assert.equal(kernel.objectsInZone('B', 'rune-zone').length, 3);
  for (const ref of kernel.objectsInZone('B', 'rune-zone')) {
    assert.equal(kernel.getObject(ref.id).exhausted, false);
  }

  // The compensation is a First Turn Process: B's later Channel Phases are the
  // normal two runes again (315.3 / 487.7).
  match.flow.endTurn('B');
  assert.deepEqual(channeled(actions), ['A:2', 'B:3', 'A:2']);
  assert.equal(match.flow.turnPlayer, 'A');
  assert.equal(match.flow.turn, 3);

  // B's second Channel Phase (turn 4) is the normal two runes again (315.3).
  match.flow.endTurn('A');
  assert.deepEqual(channeled(actions), ['A:2', 'B:3', 'A:2', 'B:2'],
    'the extra rune is not repeated on B\'s second turn');
  assert.equal(match.flow.turnPlayer, 'B');
  assert.equal(match.flow.turn, 4);
  assert.equal(kernel.player('B').runeDeckCount, 7);
  assert.equal(kernel.objectsInZone('B', 'rune-zone').length, 5);
});

test('setup-second-player-extra-rune-duel: the compensation follows the seat order, not the seat letter', () => {
  // 487.7 is keyed to "the player going second"; when B wins the turn-order
  // random (115.1.a), the extra rune belongs to A instead.
  const { match, actions } = makeMatch({ firstPlayer: 1, runeDeck: 12 });
  assert.equal(match.firstPlayer, 'B');
  assert.deepEqual(channeled(actions), ['B:2']);
  match.flow.endTurn('B');
  assert.deepEqual(channeled(actions), ['B:2', 'A:3']);
});

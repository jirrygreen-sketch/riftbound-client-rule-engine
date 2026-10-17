// Golden test for the setup chapter scenario `setup-full-sequence-order`
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 110 fixes the Setup Process order:
//   111 place the Champion Legend in the Legend Zone
//   112 place the Chosen Champion in the Champion Zone
//   113 set aside the Battlefields (113.1 the Mode of Play places them)
//   114 shuffle the Main and Rune Decks, separately, into their zones
//   115 determine Turn Order (fair random)
//   116 players each draw 4
//   117 in turn order, players perform their Mulligan
//   118 begin play with the First Player taking their turn
//
// The scenario's event names are placeholders awaiting the RIFT-21 timing-point
// freeze, and the new pipeline only starts logging when TurnFlow starts. The
// committed primitive order the real createMatch issues is observable though, and
// that ordering is what the CR 110 steps require, so the test asserts it directly
// plus the resulting play state. One boundary note: by the time createMatch
// returns, it has already begun turn 1 (118), so the First Player also completed
// their Draw Phase (315.4) — the scenario's "hand.count equals 4" describes the
// instant after CR 116/117, one card earlier than the returned match state.
import test from 'node:test';

import { assert, makeMatch, pipelineTimings, seatDeck, turnStarts } from './harness.mjs';

test('setup-full-sequence-order (110-118): the setup steps run in CR order and play begins with the First Player', () => {
  const { match, kernel, actions } = makeMatch({
    decks: [seatDeck({ main: 40, rune: 12, tag: 'a' }), seatDeck({ main: 40, rune: 12, tag: 'b' })],
    battlefieldChoice: [0, 0],
    firstPlayer: 0,
  });
  const actionAt = predicate => actions.findIndex(entry => predicate(entry.action, entry));

  // 111 / 112: both seats' Champion Legend and Chosen Champion are established
  // before anything else. The lifecycle creates them as Legends/Champions, so the
  // reported legend/champion zones are populated for both seats.
  const firstLegend = actionAt(action => action.type === 'create-token' && action.token.types.includes('legend'));
  const firstChampion = actionAt(action => action.type === 'create-token' && action.token.types.includes('champion'));
  const firstBattlefield = actionAt(action => action.type === 'create-token' && action.token.types.includes('battlefield'));
  const legendCount = actions.filter(entry => entry.action.type === 'create-token' && entry.action.token.types.includes('legend')).length;
  const championCount = actions.filter(entry => entry.action.type === 'create-token' && entry.action.token.types.includes('champion')).length;
  assert.equal(firstLegend, 0, 'CR 111 is the first Setup step');
  assert.equal(firstChampion, 1, 'CR 112 follows immediately for the same seat');
  assert.equal(legendCount, 2, 'each seat separates its own Champion Legend (111)');
  assert.equal(championCount, 2);
  assert.deepEqual(match.setup.legendZone.A, ['card:legend-a']);
  assert.deepEqual(match.setup.legendZone.B, ['card:legend-b']);
  assert.deepEqual(match.setup.championZone.A, ['card:champion-a']);
  assert.deepEqual(match.setup.championZone.B, ['card:champion-b']);

  // 113 / 487.5: the Battlefields are set aside and one per seat is placed into
  // the Battlefield Zone after the legends/champions, before the decks.
  assert.ok(firstChampion < firstBattlefield, 'CR 113 comes after 111/112');
  assert.equal(match.setup.battlefields.length, 2);
  const firstDeckMove = actionAt(action => action.type === 'move-zone' && action.to === 'deck-bottom');
  const battlefieldCreates = actions.filter(entry => entry.action.type === 'create-token' && entry.action.token.types.includes('battlefield')).length;
  assert.equal(battlefieldCreates, 6, 'all three of each seat\'s Battlefields are set aside (487.4.a)');
  assert.ok(firstBattlefield < firstDeckMove, 'CR 114 shuffles the decks after the Battlefields are set aside');

  // 114: the Main Deck and Rune Deck of each seat are assembled into their own
  // zones and then shuffled as two separate operations.
  const shuffles = actions.filter(entry => entry.action.type === 'order-top');
  assert.deepEqual(shuffles.slice(0, 4).map(entry => entry.action.zone), ['deck', 'rune-deck', 'deck', 'rune-deck'],
    'each seat shuffles Main then Rune separately (114 / 114.1 / 114.2)');
  const firstShuffle = actionAt(action => action.type === 'order-top');
  assert.ok(firstDeckMove < firstShuffle);

  // 115: Turn Order is determined after the shuffles, and 116: both seats then
  // draw 4. The First Player is A per the scenario's given random result.
  const firstDraw = actionAt(action => action.type === 'draw' && action.amount === 4);
  assert.ok(firstShuffle < firstDraw, 'CR 115/116 come after CR 114');
  assert.deepEqual(match.turnOrder, ['A', 'B']);
  assert.equal(match.firstPlayer, 'A');
  const openingDraws = actions.filter(entry => entry.action.type === 'draw' && entry.action.amount === 4);
  assert.deepEqual(openingDraws.map(entry => entry.action.player), ['A', 'B'], 'each player draws 4 (116)');
  assert.equal(match.setup.openingHands.A.length, 4);
  assert.equal(match.setup.openingHands.B.length, 4);

  // 117: the Mulligan windows run in Turn Order after the opening draws. Neither
  // seat opted to set a card aside here, so the observable order fact is that no
  // set-aside lands before the opening draws and both seats were offered in order.
  assert.equal(match.setup.mulligans.A.length, 0);
  assert.equal(match.setup.mulligans.B.length, 0);
  const mulliganMove = actionAt(action => action.type === 'move-zone' && action.to === 'chain' &&
    action.object.id.startsWith('token-'));
  assert.equal(mulliganMove, -1, 'an empty mulligan sets nothing aside (117.1)');

  // 118: play begins with the First Player. TurnFlow starts only after setup, so
  // the pipeline's first committed event is the turn start for A, and the turn 1
  // Channel Phase is the next thing the driver does after the setup window.
  const timings = pipelineTimings(match);
  assert.equal(timings[0], 'turn-start');
  assert.deepEqual(turnStarts(match), ['A']);
  assert.equal(match.flow.turn, 1);
  assert.equal(match.flow.turnPlayer, 'A');
  const channel = actions.findIndex(entry => entry.action.type === 'channel-rune');
  assert.ok(firstDraw < channel, 'turn 1 begins after setup (118) with the Channel Phase (315.3)');
  assert.equal(actions[channel].action.player, 'A');
  assert.equal(actions[channel].action.amount, 2);

  // Resulting state: both seats hold their opening hand (plus A's turn-1 draw),
  // both decks kept their identity, and the two Battlefields are in play.
  assert.equal(kernel.player('A').handCount, 5);
  assert.equal(kernel.player('B').handCount, 4);
  assert.equal(match.setup.mainDeckCount.A, 40);
  assert.equal(match.setup.mainDeckCount.B, 40);
  assert.equal(match.flow.battlefields.length, 2);
  assert.equal(match.result().winner, null);
});

// Golden tests for the setup chapter scenarios
//   setup-battlefield-selection-duel-random
//   setup-battlefields-enter-simultaneously
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 113 / 113.1: each player sets aside their three Battlefields and the
// Mode of Play decides how they are placed into the Battlefield Zone.
// 487.4.b: the Duel Battlefield Count is two. 487.5: each player randomly
// selects one of their three Battlefields, the other two are removed and will
// not be used for the game, and the selected Battlefields are placed
// simultaneously in the Battlefield Zone.
//
// The tested object is the real createMatch lifecycle: it issues the
// create-token calls for the three Battlefields of each seat, keeps the chosen
// one as the Battlefield Zone entry and records the other two as removed. The
// random pick is the match seed's own draw, so two matches with the same seed
// must select the same fields.
import test from 'node:test';

import { assert, makeMatch, seatDeck } from './harness.mjs';

const chosen = match => match.setup.battlefields.map(field => field.cardId);

test('setup-battlefield-selection-duel-random (113 / 487.5): one of three is used per seat, the other two are removed', () => {
  // The scenario fixes the random results; createMatch takes the same fact as an
  // explicit `battlefieldChoice` (the Mode of Play's selection), so the picked
  // indices are deterministic here and the seed stays the source of randomness
  // for everything else.
  const { match } = makeMatch({ battlefieldChoice: [1, 2] });
  assert.deepEqual(chosen(match), ['card:bf-a2', 'card:bf-b3'], 'index 1 and 2 of each seat\'s three are selected');

  // 487.5: the two not selected are removed and will not be used.
  assert.deepEqual(match.setup.removedBattlefields.A, ['card:bf-a1', 'card:bf-a3']);
  assert.deepEqual(match.setup.removedBattlefields.B, ['card:bf-b1', 'card:bf-b2']);

  // 487.4.b: the Duel Battlefield Zone holds exactly two Battlefields, and they
  // are the two selected ones. They start uncontrolled and uncontested (190).
  assert.equal(match.flow.battlefields.length, 2);
  assert.deepEqual(match.flow.battlefields.map(field => field.cardId), chosen(match));
  for (const field of match.setup.battlefields) {
    assert.equal(field.controller, null);
    assert.equal(field.contestedBy, null);
    assert.equal(field.staged, 'none');
  }

  // Each seat contributed exactly one used Battlefield and two removed ones
  // (487.4.a / 487.5), and the used ones are distinct physical objects.
  for (const seat of ['A', 'B']) {
    const used = match.setup.battlefields.filter(field => field.cardId?.endsWith(seat.toLowerCase() + '2') || field.cardId?.endsWith(seat.toLowerCase() + '3'));
    assert.equal(used.length + match.setup.removedBattlefields[seat].length, 3);
  }
  assert.notEqual(match.setup.battlefields[0].id, match.setup.battlefields[1].id);
});

test('setup-battlefield-selection-duel-random: the random selection is drawn from the match seed', () => {
  const first = makeMatch({ seed: 'battlefield-seed' });
  const second = makeMatch({ seed: 'battlefield-seed' });
  const other = makeMatch({ seed: 'another-battlefield-seed' });

  // Same seed, same random selection; the selected fields are two distinct
  // Battlefields, one per seat, and every set-aside is accounted for.
  assert.deepEqual(chosen(first.match), chosen(second.match));
  assert.deepEqual(first.match.setup.removedBattlefields, second.match.setup.removedBattlefields);
  assert.equal(new Set(chosen(first.match)).size, 2);
  for (const field of chosen(first.match)) {
    assert.equal(first.match.setup.removedBattlefields.A.includes(field) ||
      first.match.setup.removedBattlefields.B.includes(field), false,
    'a seat never both uses and removes the same Battlefield');
  }

  // A different seed explores the same protocol: one used + two removed per seat.
  const usedOrRemoved = candidate => [...chosen(candidate.match),
    ...candidate.match.setup.removedBattlefields.A, ...candidate.match.setup.removedBattlefields.B];
  assert.equal(new Set(usedOrRemoved(other).filter(cardId => cardId.startsWith('card:bf-a'))).size, 3);
  assert.equal(new Set(usedOrRemoved(first).filter(cardId => cardId.startsWith('card:bf-a'))).size, 3,
  'all three of a seat\'s Battlefields are either used or removed (487.4.a / 487.5)');
});

test('setup-battlefields-enter-simultaneously (487.5 / 107.2): both selected Battlefields occupy the zone together after setup', () => {
  // 107.2.a: the Battlefield Zone houses multiple Battlefields. 487.5 places the
  // selected Battlefields simultaneously. The kernel has no observable ordering
  // between the two entries (each seat's selection is one placement), so this
  // executes the joint result the scenario itself allows degrading to.
  const { match } = makeMatch({ battlefieldChoice: [0, 0] });
  assert.equal(match.flow.battlefields.length, 2, 'two distinct Battlefields share the zone');
  assert.deepEqual(match.flow.battlefields.map(field => field.cardId), ['card:bf-a1', 'card:bf-b1']);
  assert.notEqual(match.flow.battlefields[0].id, match.flow.battlefields[1].id);
  assert.equal(new Set(match.flow.battlefields.map(field => field.cardId)).size, 2);
  // Play has already begun (118) and the two placements were part of setup (110).
  assert.equal(match.flow.turn, 1);
  assert.equal(match.flow.turnPlayer, 'A');
});

test('setup-battlefields-enter-simultaneously: both seats keep their own three Battlefields at selection time', () => {
  // 487.4.a / 487.5: each player provides three Battlefields, and only that
  // seat's three can supply its selection. The lifecycle validates this shape
  // and rejects a seat with the wrong Battlefield count.
  const seats = [seatDeck({ tag: 'a' }), seatDeck({ tag: 'b' })];
  assert.equal(seats[0].battlefields.length, 3);
  assert.equal(seats[1].battlefields.length, 3);
  assert.throws(
    () => makeMatch({
      decks: [
        { ...seats[0], battlefields: [seats[0].battlefields[0]] },
        seats[1],
      ],
    }),
    /exactly three battlefields/,
  );
  const { match } = makeMatch({ battlefieldChoice: [2, 1] });
  assert.deepEqual(chosen(match), ['card:bf-a3', 'card:bf-b2']);
});

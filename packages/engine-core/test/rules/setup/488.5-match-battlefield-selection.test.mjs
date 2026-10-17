// Golden tests for the setup chapter Match (best-of series) scenarios
//   setup-battlefield-selection-match-choice  — executed (choice half)
//   setup-battlefield-reuse-match-winner      — todo (series ledger)
//   setup-battlefield-reuse-after-draw        — todo (series ledger)
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 488.5: in the 1v1 (Match) mode each player chooses one of their three
// Battlefields (the Duel mode's random pick is replaced by a player choice); the
// other two are set aside. 488.5.a / 488.6: after a game the winner removes the
// Battlefields they used, so the next game of the series selects from the
// set-aside ones, while a drawn game leaves them available again.
//
// The choice half is executable: createMatch takes `battlefieldChoice` as the
// per-seat selection (defaulting to the seed's random draw for Duel), reports the
// two set-aside Battlefields per seat and places exactly one per seat. The series
// half is not: createMatch builds one game and holds no game number, win ledger
// or match-scoped removed set, so a "cannot reuse" rejection has nothing to test.
import test from 'node:test';

import { assert, makeMatch } from './harness.mjs';

test('setup-battlefield-selection-match-choice (488.5): each seat chooses one Battlefield and the other two are set aside', () => {
  // The scenario's `setup-choose-battlefield` commands name bfA2 and bfB3, the
  // second and third of each seat's three. Passing those indices as the
  // per-seat selection is the same decision the command list expresses; the
  // lifecycle's pick is `chosen ?? random`, so this is the "chosen" branch.
  const { match } = makeMatch({ battlefieldChoice: [1, 2] });

  // 487.4.b / 488.5: one Battlefield per seat enters the Battlefield Zone.
  assert.deepEqual(match.flow.battlefields.map(field => field.cardId), ['card:bf-a2', 'card:bf-b3']);
  assert.deepEqual(match.setup.battlefields.map(field => field.cardId), ['card:bf-a2', 'card:bf-b3']);
  assert.equal(match.flow.battlefields.length, 2);

  // 488.5: the two unchosen Battlefields of A are set aside (not in play).
  assert.deepEqual(match.setup.removedBattlefields.A, ['card:bf-a1', 'card:bf-a3']);
  assert.deepEqual(match.setup.removedBattlefields.B, ['card:bf-b1', 'card:bf-b2']);
  for (const field of match.flow.battlefields) {
    assert.equal(match.setup.removedBattlefields.A.includes(field.cardId), false);
    assert.equal(match.setup.removedBattlefields.B.includes(field.cardId), false);
  }

  // A seat's three Battlefields are accounted for exactly once each (487.4.a).
  const usedOrSetAside = seat => new Set([
    ...match.setup.battlefields.filter(field => field.cardId.endsWith('-' + seat.toLowerCase() + '1') ||
      field.cardId.endsWith('-' + seat.toLowerCase() + '2') || field.cardId.endsWith('-' + seat.toLowerCase() + '3'))
      .map(field => field.cardId),
    ...match.setup.removedBattlefields[seat],
  ]);
  assert.equal(usedOrSetAside('A').size, 3);
  assert.equal(usedOrSetAside('B').size, 3);
});

test('setup-battlefield-selection-match-choice: a seat that does not choose falls back to that seat\'s own draw', () => {
  // 488.5 gives the choice to the player; leaving it open must not borrow the
  // other seat's Battlefields. The seat that does choose keeps its pick.
  const { match } = makeMatch({ battlefieldChoice: [1, undefined] });
  assert.equal(match.setup.battlefields[0].cardId, 'card:bf-a2');
  assert.ok(['card:bf-b1', 'card:bf-b2', 'card:bf-b3'].includes(match.setup.battlefields[1].cardId));
  assert.equal(match.setup.removedBattlefields.B.includes(match.setup.battlefields[1].cardId), false);
  assert.equal(match.setup.removedBattlefields.B.length, 2);
});

// 488.5 / 488.6: a Match is a series of games. The winner removes the
// Battlefields they used, and the following game selects from what is left, so
// re-selecting a used Battlefield is illegal. createMatch builds exactly one game
// and exposes no game number, win ledger or match-scoped removed set, so there is
// no state for the negative assertion to observe yet.
test.todo('setup-battlefield-reuse-match-winner (488.5): game 2 must reject the winner selecting a Battlefield they used in game 1 — blocked: createMatch is single-game (no game number / wins ledger / match-scoped removedBattlefields in src/game/lifecycle.ts)');

// 488.5.a: after a drawn game the Battlefields shown in it are available again.
// That needs the same series ledger plus a recorded draw result; the single-game
// report only records this game's two removed Battlefields.
test.todo('setup-battlefield-reuse-after-draw (488.5.a): after a drawn game the previously shown Battlefields are selectable again — blocked: no series ledger or drawn-game record in src/game/lifecycle.ts');

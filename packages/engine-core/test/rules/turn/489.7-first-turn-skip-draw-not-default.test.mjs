// Rules golden test — scenario `turn-first-turn-skip-draw-not-default`.
//
// CR v1.5 489.7 / 115.2 / 315.4: the “the first player does not draw during their
// first Draw Phase” adjustment is written only for FFA3/FFA4/2v2. 1v1 (487/488) has
// no such adjustment, so in a Duel the first player draws 1 in their first Draw
// Phase like any other turn. This is the guard against shipping the skip as a
// global default.
//
// Subject: src/turn/flow.ts `scheduleTurn` draw task. The draw is a real committed
// kernel action; the assertion reads the Deck and Hand positions and the committed
// Draw timing.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, markEvents, eventsAfter, assertSubsequence } from './harness.mjs';

test('turn-first-turn-skip-draw-not-default (489.7 / 315.4): the 1v1 first player still draws in their first Draw Phase', () => {
  const f = turnFixture({ deck: 4 });
  assert.equal(f.flow.turnPlayer, 'A');
  assert.equal(f.kernel.player('A').handCount, 0);
  assert.equal(f.kernel.player('A').deckCount, 4);

  const mark = markEvents(f);
  f.flow.start();

  // The Draw Phase ran and committed a real draw: 4 → 3 in the Deck, +1 in Hand.
  assertSubsequence(eventsAfter(f, mark).map(event => event.timingPoint), ['draw-start', 'card-drawn', 'draw-end']);
  assert.equal(f.kernel.player('A').handCount, 1);
  assert.equal(f.kernel.player('A').deckCount, 3);
  assert.equal(f.flow.phase, 'main');

  // The same adjustment must not leak into the opponent's turn either: 1v1 has no
  // skip, so B draws in their first Draw Phase as well (487.7 only adds a rune).
  f.flow.endTurn('A');
  assert.equal(f.kernel.player('B').handCount, 1);
  assert.equal(f.kernel.player('B').deckCount, 3);
});

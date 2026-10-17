// Rules golden test — scenario `turn-end-main-on-no-discretionary`.
//
// CR v1.5 305 / 316.9 / 335: the Turn Player ends their turn by announcing they
// are done. Every step of the turn driver completes in order, and the turn ends.
// Subjects: src/turn/flow.ts (TurnFlow) over the merged src/chain + src/events
// layers. No state is written by hand: the ending is a real committed task queue,
// the next turn is a real turn-start, and the assertion reads the committed
// timing sequence.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, timings, timingsAfter, markEvents, assertSubsequence } from './harness.mjs';

test('turn-end-main-on-no-discretionary (316.9 / 305): the Turn Player ends a Main Phase they are done with', () => {
  const f = turnFixture();
  f.flow.start();
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.flow.turnPlayer, 'A');
  assert.equal(f.flow.chain.priority, 'A');

  const mark = markEvents(f);
  f.flow.endTurn('A');

  // 316.9.a/: the Main Phase ends, the Ending Phase follows, and the next turn
  // starts only after the whole Ending Phase (including Expiration) has run.
  assertSubsequence(timingsAfter(f, mark), ['main-end', 'turn-end', 'turn-start']);
  assert.equal(timingsAfter(f, mark).indexOf('main-end') < timingsAfter(f, mark).indexOf('turn-end'), true);
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.flow.turnPlayer, 'B');
  assert.equal(f.flow.turn, 2);

  // “Choosing not to act” is a legal advance even with a playable Hand and
  // enough resources (305): nothing about the position forced the ending.
  assert.equal(timings(f).filter(id => id === 'main-end').length, 1);
  assert.equal(timings(f).filter(id => id === 'turn-end').length, 1);
  assert.equal(timings(f).filter(id => id === 'main-start').length, 2);
});

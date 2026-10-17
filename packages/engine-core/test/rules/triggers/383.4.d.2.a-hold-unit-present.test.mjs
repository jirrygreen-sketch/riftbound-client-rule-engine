// CR v1.5 383.4.d.2 / 383.4.d.2.a golden test — scenario `triggers-hold-unit-present`
// (docs/rules/scenarios/triggers.yaml).
//
// "The Hold Abilities of Units are put on the Chain as Pending Items after the Unit
// these effects correspond to are present at a Battlefield when a player maintains
// control of it and Gains 1 Victory Point during their Beginning Phase from Holding."
//
// The YAML writes the command as `pass` during the Beginning phase. CR v1.5 315.2.b
// puts the Hold inside the turn driver's Beginning-Phase Scoring Step, so the test
// starts the real Beginning phase instead of synthesizing a Hold event: the point,
// the `hold`/`score` wave and the Pending item all come from TurnFlow.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  turnFixture, settle, draw, eventsAt, markEvents, timingsAfter, assertSubsequence,
} from './harness.mjs';

test('triggers-hold-unit-present (383.4.d.2.a): the present Unit\'s Hold ability becomes a Pending item in the Beginning Scoring Step', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 0, B: 0 },
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 }),
  });
  // 383.4.d.1/383.4.d.2: "When I hold" is the presence-scoped Hold Effect of u1.
  f.trigger('u1:hold-trigger', 'hold', [draw('hold-drawn')], {
    sourceId: 'u1', filter: { event: 'held', player: 'self' },
  });
  const mark = markEvents(f);

  f.flow.start();

  // The Hold happened in the real Beginning Phase and the point landed (471.2).
  assert.equal(eventsAt(f, 'hold').length, 1);
  assert.equal(f.kernel.player('A').score, 1);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.deepEqual(f.flow.chain.items.map(item => item.id), ['trigger:1']);
  assert.equal(f.kernel.player('A').handCount, 0, 'the trigger body has not resolved yet');

  // 383.4.d.2.a: the Hold ability entered the Chain inside the same committed
  // score wave, after the Hold and the point gain.
  assertSubsequence(timingsAfter(f, mark).filter(id => !id.startsWith('cleanup')),
    ['points-gained', 'hold', 'score', 'chain-item-pending', 'chain-item-finalize']);

  settle(f);
  // The trigger body resolved through the Chain (draw 1) and the turn continued
  // through the real Draw Step (draw 1).
  assert.equal(f.kernel.player('A').handCount, 2);
  assert.equal(eventsAt(f, 'card-drawn').length, 2);
});

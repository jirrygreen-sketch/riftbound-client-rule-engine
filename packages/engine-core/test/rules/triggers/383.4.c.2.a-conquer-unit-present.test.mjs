// CR v1.5 383.4.c.2 / 383.4.c.2.a golden test — scenario `triggers-conquer-unit-present`
// (docs/rules/scenarios/triggers.yaml).
//
// "The Conquer Abilities of Units are put on the Chain as Pending Items after the
// Unit(s) these effects correspond to are present at a Battlefield when a player
// gains control of it and gains 1 Victory Point from Conquering."
//
// The scenario drives the merged turn driver: TurnFlow owns the real
// Beginning/Scoring wave, CombatFlow establishes control through the real Open
// cleanup + non-combat Showdown, and the trigger is registered on the real event
// pipeline. Nothing resolves the trigger body or awards a point by hand.
//
// Scenario/CR divergence (reported in the task reply): the YAML `given` opens with
// bf1 already uncontrolled but occupied by A's unit, then asks for a Conquer
// without a Move. CR 471.1 / 468.5.d require an actual control-establishment, so
// this test starts the unit at base and Moves it in — the same 348.2 path the
// scoring chapter uses — instead of faking the immediate Conquer.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  turnFixture, settle, draw, move, eventsAt, markEvents, timingsAfter, assertSubsequence, passUntil,
} from './harness.mjs';

const CONQUER_DRAW = 'u1:conquer-trigger';

test('triggers-conquer-unit-present (383.4.c.2.a): the present Unit\'s Conquer ability becomes a Pending item when the player Conquers', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    score: { A: 0, B: 0 },
    setup: w => w.base('u1', { might: 3 }),
  });
  // 383.4.c.1/383.4.c.2: "When I conquer" is the presence-scoped Conquer Effect of u1.
  f.trigger(CONQUER_DRAW, 'conquer', [draw('conquer-drawn')], {
    sourceId: 'u1', filter: { event: 'conquered', player: 'self' },
  });
  f.flow.start();
  const mark = markEvents(f);

  // The real non-combat Showdown close establishes control and Conquers (471.1).
  f.flow.execute(f.activated('enter', [move('m1', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  assert.equal(eventsAt(f, 'conquer').length, 0, 'the Move only opens the Showdown');
  assert.equal(f.kernel.player('A').handCount, 1, 'only the Draw Step card so far');

  // Opposing passes resolve the Move and close the Showdown, which establishes
  // control and Conquers (348.2 / 471.1). Nothing is skipped by hand.
  passUntil(f, () => eventsAt(f, 'conquer').length === 1);
  assert.equal(eventsAt(f, 'conquer').length, 1);
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.kernel.player('A').score, 1);

  // 383.4.c.2.a: the Conquer ability entered the Chain as a Pending item in the
  // same committed wave as the point gain, before anything resolved.
  assert.deepEqual(f.flow.chain.items.map(item => item.id), ['trigger:1']);
  assert.equal(f.kernel.player('A').handCount, 1, 'the trigger body has not resolved yet');
  assertSubsequence(timingsAfter(f, mark).filter(id => !id.startsWith('cleanup')),
    ['control-established', 'points-gained', 'conquer', 'score', 'chain-item-pending', 'chain-item-finalize']);

  settle(f);
  // The trigger body resolved through the Chain: draw 1.
  assert.equal(f.kernel.player('A').handCount, 2);
  assert.equal(eventsAt(f, 'card-drawn').length, 2);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
});

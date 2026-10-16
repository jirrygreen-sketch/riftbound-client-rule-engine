// Golden tests for Score triggers — CR v1.5 473.2 (Score / Conquer / Hold timing points).
//
// Scenario ids covered here (docs/rules/scenarios/scoring.yaml):
//   scoring-triggers-fire-on-score-conquer-hold  executed
//   scoring-trigger-fires-on-final-point-draw    executed
//
// Triggers are registered on the real event pipeline of the merged ChainEngine, so the
// path timing point → trigger → Pending item → Finalize → Resolve is the one under test.
// Nothing resolves a trigger body by hand.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  turnFixture, settle, move, draw, gainPoints, eventsAt, eventsOf, timings, markEvents,
} from './harness.mjs';

test('scoring-triggers-fire-on-score-conquer-hold (473.2): a Hold creates a chain item before its effect resolves', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 2, B: 2 },
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 }),
  });
  f.trigger('when-you-score', 'score', [draw('score-drawn')], { sourceId: 'u1' });

  f.flow.start();
  // The Hold was Scored and the trigger became a chain item instead of resolving inline
  // (契约 3.5: every triggered ability enters the chain). The point landed immediately.
  assert.equal(f.kernel.player('A').score, 3);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.deepEqual(f.flow.chain.items.map(item => [item.id, item.status]), [['trigger:1', 'finalized']]);
  // The trigger body has not resolved yet: the chain is still holding the item.
  assert.equal(f.kernel.player('A').handCount, 0);

  settle(f);
  assert.equal(eventsAt(f, 'hold').length, 1);
  assert.equal(eventsAt(f, 'points-gained').length, 1);
  assert.ok(eventsAt(f, 'card-drawn').length >= 1);
});

test('scoring-triggers-fire-on-score-conquer-hold (473.2): Conquer and Hold triggers each fire only for their own Score method', () => {
  // Both triggers sit on the same source. The Hold fires only the Hold trigger; the
  // later Conquer in the same turn fires only the Conquer trigger.
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 0, B: 0 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u2', { location: { type: 'base', player: 'A' }, might: 4 });
    },
  });
  f.trigger('when-you-conquer', 'conquer', [draw('conquer-drawn')], { sourceId: 'u1' });
  f.trigger('when-you-hold', 'hold', [draw('hold-drawn')], { sourceId: 'u1' });

  f.flow.start();
  // A Hold happened: the chain item is the Hold trigger, not the Conquer trigger.
  assert.equal(eventsAt(f, 'hold').length, 1);
  assert.equal(eventsAt(f, 'conquer').length, 0);
  assert.equal(f.flow.chain.items.length, 1);
  assert.equal(f.flow.chain.items[0].body[0].id, 'hold-drawn');
  assert.equal(f.kernel.player('A').score, 1);
  settle(f);

  // Now Conquer bf2 with a second unit; only the Conquer trigger may enter the chain.
  f.flow.execute(f.activated('to-bf2', [move('m1', { type: 'battlefield', id: 'bf2' })], 'A', 'u2'));
  const drawnBefore = eventsAt(f, 'card-drawn').length;
  settle(f);
  assert.equal(eventsAt(f, 'conquer').length, 1);
  assert.equal(eventsAt(f, 'hold').length, 1);
  // Exactly one trigger body resolved for this Score: the Conquer draw, not a Hold draw.
  assert.equal(eventsAt(f, 'card-drawn').length - drawnBefore, 1);
  assert.equal(f.kernel.player('A').score, 2);
  assert.deepEqual(f.flow.scored('A').slice().sort(), ['bf1', 'bf2']);
});

test('scoring-trigger-fires-on-final-point-draw (473.1.b.1 / 473.2): a replaced Final Point draw still triggers Conquer abilities', () => {
  const f = turnFixture({
    score: { A: 7, B: 3 },
    setup: w => w.unit('u1', { location: { type: 'base', player: 'A' }, might: 4 }),
  });
  f.trigger('when-you-conquer', 'conquer', [draw('conquer-drawn')], { sourceId: 'u1' });
  f.flow.start();
  const handBefore = f.kernel.player('A').handCount;

  f.flow.execute(f.activated('enter', [move('m1', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  settle(f);

  // The replacement draw from 473.1.b.1 plus the trigger draw from 473.2 both happened,
  // and the score stays at 7 because the point itself was replaced (473.1.b).
  assert.equal(f.kernel.player('A').handCount, handBefore + 2);
  assert.equal(f.kernel.player('A').score, 7);
  assert.equal(eventsAt(f, 'final-point').length, 1);
  assert.equal(eventsAt(f, 'conquer').length, 1);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(f.flow.winner, null);
});

test('scoring-triggers-fire-on-score-conquer-hold (473.2): the Score timing point fires once per Scored Battlefield', () => {
  // Same source, same turn: the Hold on bf1 and the later Conquer on bf2 each produce
  // exactly one Score event, and the trigger resolves once per Score event.
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 0, B: 0 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u2', { location: { type: 'base', player: 'A' }, might: 4 });
    },
  });
  f.trigger('score-watch', 'score', [draw('score-drawn')], { sourceId: 'u1' });
  f.flow.start();
  assert.equal(eventsAt(f, 'hold').length, 1);
  assert.equal(eventsAt(f, 'score').length, 1);
  settle(f);

  f.flow.execute(f.activated('to-bf2', [move('m1', { type: 'battlefield', id: 'bf2' })], 'A', 'u2'));
  settle(f);
  assert.equal(eventsAt(f, 'score').length, 2);
  assert.equal(eventsAt(f, 'conquer').length, 1);
  assert.equal(f.kernel.player('A').score, 2);
  assert.deepEqual(f.flow.scored('A').slice().sort(), ['bf1', 'bf2']);
});

test('scoring-triggers-fire-on-score-conquer-hold (470.1): Gaining Points from an ability does not trigger Hold or Conquer abilities', () => {
  const f = turnFixture({
    score: { A: 5, B: 5 },
    setup: w => w.hand('s1', { types: ['spell'], energy: 0, power: [] }),
  });
  f.trigger('hold-watch', 'hold', [draw('hold-drawn')]);
  f.trigger('conquer-watch', 'conquer', [draw('conquer-drawn')]);
  f.flow.start();
  settle(f);
  const mark = markEvents(f);

  f.flow.execute(f.spell('point-spell', [gainPoints('p1', 1)], 'A', 's1', 'action'));
  settle(f);
  assert.equal(f.kernel.player('A').score, 6);
  // Scoring and Gaining Points are distinct (470.1/470.2): neither trigger may fire.
  assert.equal(eventsOf(f).slice(mark).some(event => event.timingPoint === 'hold'), false);
  assert.equal(eventsOf(f).slice(mark).some(event => event.timingPoint === 'conquer'), false);
  assert.deepEqual(f.flow.scored('A'), []);
});

test.todo('scoring-triggers-fire-on-score-conquer-hold (473.2c): Conquer and Score trigger frequency per chain clock — partially covered: the merged pipeline exposes the trigger frequency scopes and the two per-method triggers are asserted above; a same-turn second Score from the *same* player is impossible because 472 forbids it, so the remaining “cannot trigger more than once per turn” case is the blocked same-turn path in 472-once-per-battlefield-per-turn.test.mjs');

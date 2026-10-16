// Golden tests for Conquer — CR v1.5 471.1 (Conquer), 348.2, 468.5.d and 473.1.
//
// Scenario ids covered here (docs/rules/scenarios/scoring.yaml):
//   scoring-conquer-basic-on-control              executed (real non-combat Showdown close)
//   scoring-conquer-via-noncombat-showdown        executed
//   scoring-no-conquer-without-control-event      executed
//   scoring-no-result-combat-no-conquer           todo (needs the Combat transaction)
//   scoring-no-conquer-when-already-controller    executed
//   scoring-conquer-not-turn-player               executed
//   scoring-control-lost-at-open-cleanup-no-score executed
//   scoring-reconquer-after-losing-battlefield    executed
//   scoring-final-point-second-conquer-after-hold-scores executed
//   scoring-ability-point-no-final-point-restriction executed
//
// Positions come from real effect Moves on the merged TurnFlow/ChainEngine; control
// is established by the real Open cleanup + Showdown close and every point is awarded
// by the driver's committed Score wave, never by a fixture or a hand-settled ledger.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  turnFixture, settle, move, gainPoints, c, eventsAt, scoreEvents, timings, markEvents, timingsAfter,
} from './harness.mjs';

test('scoring-conquer-via-noncombat-showdown (348.2 / 471.1): a non-combat Showdown close establishes control and Conquers', () => {
  const f = turnFixture({
    score: { A: 1, B: 2 },
    setup: w => w.unit('u3', { location: { type: 'base', player: 'A' }, might: 2 }),
  });
  f.flow.start();
  const mark = markEvents(f);

  f.flow.execute(f.activated('enter', [move('m1', { type: 'battlefield', id: 'bf1' })], 'A', 'u3'));
  assert.deepEqual(timingsAfter(f, mark).filter(id => !id.startsWith('cleanup-')),
    ['chain-item-pending', 'chain-item-finalize']);
  assert.equal(f.kernel.player('A').score, 1);
  assert.equal(f.flow.battlefields[0].controller, null);

  // Two passes resolve the Move; the Move itself only applies Contested and a Showdown opens.
  f.flow.pass('A');
  f.flow.pass('B');
  assert.deepEqual(timingsAfter(f, mark).filter(id => !id.startsWith('cleanup-')),
    ['chain-item-pending', 'chain-item-finalize', 'object-moved', 'object-leaves-base', 'object-enters-battlefield',
      'contested-applied', 'chain-item-resolve', 'showdown-open']);
  assert.equal(f.kernel.player('A').score, 1);
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.chain.focus, 'A');

  settle(f);
  assert.deepEqual(scoreEvents(f), ['control-established:A:bf1', 'points-gained:A', 'conquer:A:bf1', 'score:A:bf1']);
  assert.equal(f.kernel.player('A').score, 2);
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(f.flow.chain.turnState, 'neutral-open');
});

test('scoring-no-conquer-without-control-event (471.1): entering an empty Battlefield does not Conquer until control is established', () => {
  const f = turnFixture({ score: { A: 2, B: 1 }, setup: w => w.unit('u1', { location: { type: 'base', player: 'A' }, might: 2 }) });
  f.flow.start();
  f.flow.execute(f.activated('enter', [move('m1', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  f.flow.pass('A');
  f.flow.pass('B');

  // Showdown is open and the Unit is present, but 471.1 requires the established-control
  // event; the Score wave must not run early.
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.equal(eventsAt(f, 'control-established').length, 0);
  assert.equal(eventsAt(f, 'conquer').length, 0);
  assert.equal(f.kernel.player('A').score, 2);
  assert.equal(f.flow.chain.turnState, 'showdown-open');

  settle(f);
  assert.deepEqual(eventsAt(f, 'conquer').map(event => [event.player, event.details.battlefieldId]), [['A', 'bf1']]);
  assert.equal(f.kernel.player('A').score, 3);
  assert.equal(f.flow.battlefields[0].controller, 'A');
});

test('scoring-no-conquer-when-already-controller (348.2 / 471.1): a Showdown close without a control change does not re-Conquer', () => {
  // A already controls bf1. A's effect drags B's Unit in and immediately back out inside
  // one Chain, so by the time the Showdown closes there is no challenger left and 348.2.a
  // finds A already controlling the Battlefield: no new control event, no new score.
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 4, B: 2 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u3', { owner: 'B', location: { type: 'base', player: 'B' }, might: 2 });
    },
  });
  f.flow.start();
  assert.deepEqual(eventsAt(f, 'hold').map(event => event.player), ['A']);
  assert.equal(f.kernel.player('A').score, 5);

  f.flow.execute(f.activated('round-trip', [
    { id: 'in', op: 'effect.move', args: {
      objects: c({ kind: 'choose', id: 'pick-in', filter: { type: 'unit', zone: 'board', controller: 'B' } }),
      to: c({ type: 'battlefield', id: 'bf1' }) } },
    { id: 'out', op: 'effect.move', args: {
      objects: c({ kind: 'choose', id: 'pick-out', filter: { type: 'unit', zone: 'board', controller: 'B' } }),
      to: c({ type: 'base', player: 'B' }) } },
  ], 'A', 'source'));
  settle(f);

  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.kernel.getObject('u3').location.type, 'base');
  assert.equal(eventsAt(f, 'conquer').length, 0);
  assert.equal(eventsAt(f, 'control-established').length, 0);
  assert.equal(f.kernel.player('A').score, 5);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
});

test('scoring-conquer-not-turn-player (471.1): the non-turn player Conquers when their controller established control', () => {
  // B's Unit is already alone at bf1 when A's turn begins, so A's first Open cleanup
  // stages a non-combat Showdown and B establishes control and scores on A's turn.
  const f = turnFixture({
    score: { A: 3, B: 5 },
    setup: w => w.unit('u3', { owner: 'B', location: { type: 'battlefield', id: 'bf1' }, might: 5 }),
  });
  f.flow.start();
  settle(f);

  assert.deepEqual(eventsAt(f, 'conquer').map(event => event.player), ['B']);
  assert.equal(f.kernel.player('B').score, 6);
  assert.equal(f.flow.battlefields[0].controller, 'B');
  assert.deepEqual(f.flow.scored('B'), ['bf1']);
  // Conquest does not require being the turn player (471.2 only restricts Hold).
  assert.equal(f.flow.turnPlayer, 'A');
});

test('scoring-control-lost-at-open-cleanup-no-score (323.5 / 471.2): losing control never awards or removes points', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 3, B: 3 },
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 }),
  });
  f.flow.start();
  assert.deepEqual(eventsAt(f, 'hold').map(event => event.player), ['A']);
  assert.equal(f.kernel.player('A').score, 4);

  f.flow.execute(f.activated('leave', [move('m1', { type: 'base', player: 'A' })], 'A', 'u1'));
  settle(f);
  assert.equal(eventsAt(f, 'control-lost').length, 1);
  assert.equal(f.flow.battlefields[0].controller, null);
  // CR 323.5: an Open cleanup removes control of an unmanned Battlefield. Losing control
  // is not a reverse score, so the points already gained stay put and none are removed.
  assert.equal(f.kernel.player('A').score, 4);
  assert.equal(f.kernel.player('B').score, 3);
  assert.equal(eventsAt(f, 'points-gained').length, 1);
});

test('scoring-reconquer-after-losing-battlefield (471.1 / 472): a Battlefield lost earlier can be conquered again in a later turn', () => {
  const f = turnFixture({ setup: w => w.unit('u1', { location: { type: 'base', player: 'A' }, might: 1 }) });
  f.flow.start();

  // Turn 1: conquer bf1.
  f.flow.execute(f.activated('enter-1', [move('m1', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  settle(f);
  assert.deepEqual(scoreEvents(f), ['control-established:A:bf1', 'points-gained:A', 'conquer:A:bf1', 'score:A:bf1']);
  assert.equal(f.kernel.player('A').score, 1);

  // Leaving removes control in the Open cleanup but keeps the current-turn ledger (472).
  f.flow.execute(f.activated('leave', [move('m2', { type: 'base', player: 'A' })], 'A', 'u1'));
  settle(f);
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);

  // Next A turn: the ledger has been reset, so the same Battlefield can be scored again.
  f.flow.endTurn('A');
  assert.equal(f.flow.turnPlayer, 'B');
  f.flow.endTurn('B');
  assert.equal(f.flow.turnPlayer, 'A');
  assert.deepEqual(f.flow.scored('A'), []);

  f.flow.execute(f.activated('enter-2', [move('m3', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  settle(f);
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.kernel.player('A').score, 2);
  assert.equal(eventsAt(f, 'conquer').length, 2);
  assert.equal(eventsAt(f, 'score').length, 2);
});

test('scoring-final-point-second-conquer-after-hold-scores (473.1.b.1): the second Conquer grants the Final Point once every Battlefield is Scored', () => {
  // A holds bf1 for the 7th point, then conquers bf2 in the same turn. The ledger already
  // covers bf1, so 473.1.b.1 grants the Final Point instead of the replacement draw, and
  // the ledger write happens before the “all Battlefields Scored” check.
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 6, B: 6 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u2', { location: { type: 'base', player: 'A' }, might: 4 });
    },
  });
  f.flow.start();
  assert.equal(f.kernel.player('A').score, 7);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);

  f.flow.execute(f.activated('enter-bf2', [move('m1', { type: 'battlefield', id: 'bf2' })], 'A', 'u2'));
  settle(f);
  assert.equal(f.kernel.player('A').score, 8);
  assert.deepEqual(f.flow.scored('A').slice().sort(), ['bf1', 'bf2']);
  // 473.1.b.1 granted the point rather than the draw replacement, and the Cleanup then wins.
  assert.equal(eventsAt(f, 'final-point').length, 0);
  assert.equal(eventsAt(f, 'points-gained').length, 2);
  assert.equal(f.flow.winner, 'A');
});

test('scoring-ability-point-no-final-point-restriction (473.1.a.1 / 194.1.c): ability points are not restricted and do not write the ledger', () => {
  const f = turnFixture({
    score: { A: 7, B: 4 },
    setup: w => w.hand('s1', { types: ['spell'], energy: 0, power: [] }),
  });
  f.flow.start();
  f.flow.execute(f.spell('point-spell', [gainPoints('p1', 1)], 'A', 's1', 'action'));
  settle(f);

  assert.equal(f.kernel.player('A').score, 8);
  assert.equal(eventsAt(f, 'final-point').length, 0);
  // Scoring a Battlefield and Gaining Points are distinct (470.1): no ledger write.
  assert.equal(f.flow.scored('A').length, 0);
  assert.equal(f.flow.winner, 'A');
});

test.todo('scoring-no-result-combat-no-conquer (466.3.d.1 / 466.5): a No Result Combat re-stages without establishing control — blocked: src/combat/flow.ts has no atomic Combat start/n simultaneous-damage transaction yet (needs CR 466.2 + 467.2.c.1.a batch-4 contract), so a two-sided Combat cannot be driven to its resolution step');

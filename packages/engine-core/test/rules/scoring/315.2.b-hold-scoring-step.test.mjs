// Golden tests for the Beginning-phase Scoring Step — CR v1.5 315.2.b and 471.2 (Hold).
//
// Scenario ids covered here (docs/rules/scenarios/scoring.yaml):
//   scoring-hold-basic-one-point              executed
//   scoring-hold-multiple-battlefields-same-step  executed
//   scoring-hold-not-turn-player              executed
//   scoring-hold-only-in-scoring-step         executed
//   scoring-hold-requires-current-control     executed
//   scoring-hold-no-units-but-controller      executed (CR-corrected expectation)
//   scoring-hold-while-contested              todo (subsection below)
//   scoring-hold-at-final-point-still-scores  executed
//   scoring-hold-at-or-above-victory-still-scores executed
//
// Every executed case drives the merged TurnFlow turn driver: the turn player's
// Beginning Phase runs the real Scoring Step over each Battlefield they control.
// There is deliberately no “hold” command to call — CR v1.5 315.2.b places the
// Hold inside the Starting Phase steps.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, settle, draw, eventsAt, scoreEvents, assertSubsequence } from './harness.mjs';

test('scoring-hold-basic-one-point (315.2.b / 471.2): the turn player Holds a controlled Battlefield for 1 point', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: 'B' }],
    score: { A: 2, B: 4 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u2', { owner: 'B', location: { type: 'battlefield', id: 'bf2' }, might: 3 });
    },
  });
  f.flow.start();

  // Holding and Gaining the Point are separate events (CR 470.1).
  assert.deepEqual(eventsAt(f, 'hold').map(event => [event.player, event.details.battlefieldId]), [['A', 'bf1']]);
  assert.deepEqual(eventsAt(f, 'points-gained').map(event => [event.player, event.amount]), [['A', 1]]);
  assert.equal(f.kernel.player('A').score, 3);
  assert.equal(f.kernel.player('B').score, 4);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.deepEqual(f.flow.scored('B'), []);
  assert.equal(f.flow.winner, null);

  // CR 470.1: the point gain and the Scoring act are distinct events; the point event
  // carries no Battlefield because the point comes from the Score action (473.1).
  assertSubsequence(scoreEvents(f), ['points-gained:A', 'hold:A:bf1', 'score:A:bf1']);
});

test('scoring-hold-multiple-battlefields-same-step (315.2.b / 471.2): every controlled Battlefield Holds in the same Scoring Step', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: 'A' }],
    score: { A: 1, B: 0 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u2', { location: { type: 'battlefield', id: 'bf2' }, might: 4 });
    },
  });
  f.flow.start();

  assert.deepEqual(eventsAt(f, 'hold').map(event => event.details.battlefieldId), ['bf1', 'bf2']);
  assert.deepEqual(eventsAt(f, 'points-gained').map(event => event.amount), [1, 1]);
  assert.equal(f.kernel.player('A').score, 3);
  assert.deepEqual(f.flow.scored('A').slice().sort(), ['bf1', 'bf2']);
});

test('scoring-hold-not-turn-player (315.2.b): only the turn player Holds; the opponent Holds on their own turn', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: 'B' }],
    score: { A: 0, B: 0 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' } });
      w.unit('u2', { owner: 'B', location: { type: 'battlefield', id: 'bf2' }, might: 3 });
    },
  });
  f.flow.start();

  // A's Beginning Phase Holds only A's Battlefield; B is not the turn player.
  assert.deepEqual(eventsAt(f, 'hold').map(event => event.player), ['A']);
  assert.equal(f.kernel.player('A').score, 1);
  assert.equal(f.kernel.player('B').score, 0);

  // B still controls bf2 and scores as soon as B's own Beginning Phase runs.
  f.flow.endTurn('A');
  assert.equal(f.flow.turnPlayer, 'B');
  assert.deepEqual(eventsAt(f, 'hold').map(event => event.player), ['A', 'B']);
  assert.equal(f.kernel.player('B').score, 1);
  assert.deepEqual(f.flow.scored('B'), ['bf2']);
});

test('scoring-hold-only-in-scoring-step (315.2.b): a Hold cannot be repeated during the Main Phase', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 2, B: 0 },
    setup: w => { w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 }); },
  });
  f.flow.start();
  const holdsAfterBeginning = eventsAt(f, 'hold').length;
  assert.equal(holdsAfterBeginning, 1);
  assert.equal(f.flow.phase, 'main');

  // A discretionary Main-Phase action cannot trigger another Hold: 315.2.b owns the step.
  f.flow.execute(f.activated('main-noop', [draw('main-noop')]));
  settle(f);
  assert.equal(eventsAt(f, 'hold').length, holdsAfterBeginning);
  assert.equal(f.kernel.player('A').score, 3);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
});

test('scoring-hold-requires-current-control (315.2.b / 471.2): the turn player cannot Hold an opponent-controlled Battlefield', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    score: { A: 3, B: 3 },
    setup: w => w.unit('u2', { owner: 'B', location: { type: 'battlefield', id: 'bf1' }, might: 3 }),
  });
  f.flow.start();

  assert.equal(eventsAt(f, 'hold').length, 0);
  assert.equal(f.kernel.player('A').score, 3);
  assert.deepEqual(f.flow.scored('A'), []);
  assert.equal(f.flow.battlefields[0].controller, 'B');

  // B Holds bf1 only on B's turn — current control, not history, decides.
  f.flow.endTurn('A');
  assert.equal(f.kernel.player('B').score, 4);
  assert.deepEqual(f.flow.scored('B'), ['bf1']);
});

test('scoring-hold-no-units-but-controller (323.5 / 471.2): control is lost in Cleanup before the Scoring Step, so no Hold happens', () => {
  // Divergence from the scenario file: the YAML cites v1.4 323.6/469.2 (v1.5 323.5/471.2) and leaves the
  // cleanup order open. CR v1.5 323.5 (the renumbered v1.4 323.6) removes control of a
  // controlled Battlefield with no Unit present in an Open State, and a Cleanup runs
  // after state changes (319.7) before the next Beginning Phase. The scenario's own
  // fallback note (“若实际规则顺序使清理先发生，此场景应改为拒绝”) therefore applies.
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    score: { A: 1, B: 0 },
  });
  f.flow.start();

  assert.equal(eventsAt(f, 'control-lost').length, 1);
  assert.equal(eventsAt(f, 'hold').length, 0);
  assert.equal(f.kernel.player('A').score, 1);
  assert.deepEqual(f.flow.scored('A'), []);
  assert.equal(f.flow.battlefields[0].controller, null);
});

test('scoring-hold-at-final-point-still-scores (315.2.b / 471.2): the 8th point is still gained by Holding', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: 'B' }],
    score: { A: 7, B: 6 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u2', { owner: 'B', location: { type: 'battlefield', id: 'bf2' }, might: 3 });
    },
  });
  f.flow.start();

  // The Final Point restriction only targets Conquer (473.1.a.1); Hold is not restricted.
  assert.deepEqual(eventsAt(f, 'hold').map(event => event.player), ['A']);
  assert.equal(f.kernel.player('A').score, 8);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  // The victory itself is decided by the Cleanup that follows the point change (319.7 / 323.1).
  assert.equal(f.flow.winner, 'A');
});

test('scoring-hold-at-or-above-victory-still-scores (471.2 / 474): Holding above the Victory Score is allowed until a Cleanup decides', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: 'B' }],
    score: { A: 8, B: 8 },
    setup: w => {
      w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 2 });
      w.unit('u2', { owner: 'B', location: { type: 'battlefield', id: 'bf2' }, might: 3 });
    },
  });
  f.flow.start();

  assert.deepEqual(eventsAt(f, 'hold').map(event => event.player), ['A']);
  assert.equal(f.kernel.player('A').score, 9);
  // 8/8 was a tie, so the game continued; A's Hold opportunistically takes the lead
  // and the following Cleanup then finds the unique leader.
  assert.equal(f.flow.winner, 'A');
});

test.todo('scoring-hold-while-contested (315.2.b / 471.2): Hold with an opponent Unit present — blocked by combat-start-transaction: CombatFlow.advance needs CR 466.2 (atomic simultaneous Combat start + Attacker/Defender designation) before a contested Battlefield with units from two players can reach the Scoring Step; the merged driver throws status=blocked when staging Combat at Cleanup');

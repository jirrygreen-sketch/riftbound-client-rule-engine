// Scenario: priority-noncombat-showdown-conquer (CR v1.5 348.2.a, 348.2.a.1, 471.1)
//
// Subject: the merged TurnFlow/ChainEngine over the reference test kernel. The
// position is built through the kernel's world builder and the Contested status
// is applied by the driver's real Cleanup (190.3.a / 344.2) instead of being
// pre-set, so the Showdown, its Focus grant (345) and the closing sequence are
// all produced by the rules path. Nothing here edits control, the score or the
// ledger by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSubsequence, eventsAfter, markEvents, timingsAfter, turnFixture } from './harness.mjs';

test('priority-noncombat-showdown-conquer: the side left at the Battlefield establishes Control and Conquers when the Non-Combat Showdown closes', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    // given: bf1 has no controller and only A's unit is there.
    setup: w => w.unit('u1', { owner: 'A', might: 2, location: { type: 'battlefield', id: 'bf1' } }),
  });

  // Entry into bf1 applies Contested (190.3.a); Cleanup stages the Showdown for the
  // next Open state and the Contested player gains Focus (344.2 / 345).
  f.flow.start();
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.chain.focus, 'A');
  assert.equal(f.flow.chain.priority, 'A');

  const mark = markEvents(f);
  // commands: A passes, then B passes (347.2.a / 348).
  f.flow.pass('A');
  f.flow.pass('B');

  // 348: all players passed Focus, so the Showdown Closes. 348.2.a: only one
  // player's Units remain and that player does not already Control, so A
  // establishes Control; 348.2.a.1: A had not yet scored bf1 this turn, so this
  // results in a Conquer.
  assertSubsequence(timingsAfter(f, mark), ['showdown-close', 'control-established', 'conquer', 'score']);
  const established = eventsAfter(f, mark).find(event => event.timingPoint === 'control-established');
  assert.equal(established.player, 'A');
  assert.deepEqual(established.details, { battlefieldId: 'bf1' });
  assert.equal(f.flow.battlefields[0].controller, 'A');
  assert.equal(f.flow.battlefields[0].contestedBy, null);
  assert.equal(f.flow.chain.focus, null);
  assert.equal(f.kernel.player('A').score, 1);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
});

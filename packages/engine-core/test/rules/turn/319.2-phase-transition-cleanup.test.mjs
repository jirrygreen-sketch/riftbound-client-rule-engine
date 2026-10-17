// Rules golden test — scenario `turn-cleanup-between-phase-transitions`.
//
// CR v1.5 319.2 / 323.4: a Cleanup is made an Outstanding Task after the game
// transitions between Phases. Lethal damage is handled in Cleanup step 3a, so a
// Unit that becomes lethally damaged inside a Phase dies before the next Phase
// begins — it never reaches the Ending Phase's heal (317.2.b).
//
// Subject: src/turn/flow.ts (phase queue) + src/chain/engine.ts (Cleanup at every
// phase boundary). The damage is created by a real committed Chain item whose
// Finalize/Resolve runs through the interpreter; the kill is committed by the
// engine's real Cleanup, never by the test.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, timingsAfter, markEvents, assertSubsequence, settle } from './harness.mjs';

test('turn-cleanup-between-phase-transitions (319.2 / 323.4): lethal damage is cleaned up at the phase boundary', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' }, might: 3, damage: 2 }),
  });
  // “At the start of your Beginning Phase” deals the lethal point through a real
  // trigger item; the driver must resolve it before leaving the Beginning Phase.
  f.trigger('bite', 'beginning-start', [{
    id: 'bite', op: 'effect.damage', args: { amount: { kind: 'constant', value: 1 }, target: 'target' },
    targets: [{ id: 'target', filter: { objectId: 'u1', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
  }]);

  const mark = markEvents(f);
  f.flow.start();
  // The Beginning-Step trigger becomes a real Chain item; the driver waits for FEPR.
  settle(f);

  const committed = timingsAfter(f, mark);
  // The kill happens after the Beginning-Step damage and before the Channel Phase
  // even starts: a 319.2 Cleanup sits at the phase boundary.
  assertSubsequence(committed, ['beginning-start', 'damage-dealt', 'object-killed', 'channel-start']);
  assert.equal(committed.indexOf('damage-dealt') < committed.indexOf('object-killed'), true);
  assert.equal(committed.indexOf('object-killed') < committed.indexOf('channel-start'), true);

  // The Unit is in its owner's Trash and no longer occupies the Battlefield.
  assert.equal(f.kernel.getObject('u1').zone, 'trash');
  assert.deepEqual(f.kernel.query({ zone: 'board', location: { type: 'battlefield', id: 'bf1' } }), []);
  // It died before the Ending Phase, so the Ending heal had nothing to restore.
  assert.equal(f.flow.phase, 'main');
});

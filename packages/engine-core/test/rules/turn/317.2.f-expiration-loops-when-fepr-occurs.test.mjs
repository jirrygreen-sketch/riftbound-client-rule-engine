// Rules golden test — scenario `turn-expiration-loops-when-fepr-occurs`.
//
// CR v1.5 317.2.f / 334: if any item underwent FEPR during the Expiration Step,
// play returns to the start of the Expiration Step and the Ending Special Cleanup
// is invoked again. A Unit healed by the first pass must be healed again after a
// trigger resolved inside that same Expiration Step.
//
// Subject: src/turn/flow.ts `scheduleExpiration` (the FEPR counter decides between
// restarting the step and passing the turn) over src/chain/engine.ts. The trigger
// items come from the real pipeline; the Restart is observed through state that
// only the re-invoked Ending Special Cleanup can produce.
import test from 'node:test';
import assert from 'node:assert/strict';

import { turnFixture, timingsAfter, markEvents, assertSubsequence, settle } from './harness.mjs';

test('turn-expiration-loops-when-fepr-occurs (317.2.f): the Expiration Step restarts after an item undergoes FEPR', () => {
  const f = turnFixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('doomed', { location: { type: 'battlefield', id: 'bf1' }, might: 3, damage: 2 })
      .unit('bystander', { location: { type: 'battlefield', id: 'bf1' }, might: 6, damage: 0 }),
  });
  // The Ending Step trigger makes `doomed` lethal; `bystander` takes 2 from the
  // death trigger that the following Cleanup creates.
  f.trigger('doom', 'turn-end', [{
    id: 'doom', op: 'effect.damage', args: { amount: { kind: 'constant', value: 1 }, target: 'target' },
    targets: [{ id: 'target', filter: { objectId: 'doomed', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
  }]);
  f.trigger('vengeance', 'object-killed', [{
    id: 'vengeance', op: 'effect.damage', args: { amount: { kind: 'constant', value: 2 }, target: 'target' },
    targets: [{ id: 'target', filter: { objectId: 'bystander', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
  }]);
  f.flow.start();

  const mark = markEvents(f);
  const kernelMark = f.kernel.events.length;
  f.flow.endTurn('A');
  settle(f);

  // The death trigger resolved inside the Ending Phase (turn-end → damage → kill →
  // the death trigger's own Finalize/Resolve).
  assertSubsequence(timingsAfter(f, mark), ['turn-end', 'damage-dealt', 'object-killed', 'chain-item-resolve']);
  assert.equal(f.kernel.getObject('doomed').zone, 'trash');

  // 317.2.f: because that item underwent FEPR, the Expiration Step restarted and
  // the Ending Special Cleanup ran again. The restart is what heals the 2 damage
  // the death trigger dealt: the first Ending Special Cleanup ran before that
  // damage existed, so the observed heal can only come from the re-invocation.
  const actions = f.kernel.events.slice(kernelMark).map(event => event.action).filter(Boolean);
  const damageIndex = actions.lastIndexOf('damage');
  assert.ok(damageIndex >= 0, 'the death trigger dealt damage');
  assert.equal(actions.slice(damageIndex + 1).includes('heal'), true,
    'the second Expiration-Step special cleanup heals the damage dealt inside the step');
  assert.equal(f.kernel.getObject('bystander').damage, 0);
  assert.equal(f.kernel.getObject('bystander').zone, 'board');

  // The step converged, so the next player in Turn order became the Turn Player
  // and the game continued into their turn (317.3).
  assert.equal(f.flow.turnPlayer, 'B');
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.flow.winner, null);
});

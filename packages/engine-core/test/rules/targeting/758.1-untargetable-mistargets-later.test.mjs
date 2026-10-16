// Scenario: targeting-untargetable-mistargets-later (CR v1.5 758.1, 359.3.e.9, 359.3.e.6)
//
// A target that only becomes untargetable after the lock does not retroactively
// make the play illegal: at resolution it is mistargeted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeTargetPlan, resolveTargetPlan } from '../../../dist/target/target-plan.js';
import { world } from '../../../dist/effects/testing/index.js';
import { atBattlefield } from './harness.mjs';

test('targeting-untargetable-mistargets-later: a target that becomes untargetable resolves as mistargeted', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .unit('t1', { owner: 'B', might: 3, location: atBattlefield('bf1') })
    .build();
  const requirement = { id: 't1', filter: { type: 'unit', zone: 'board', controller: 'B' } };

  // Finalize succeeds: 758.1 only applies after the object became a target.
  const plan = finalizeTargetPlan(kernel, requirement, { selected: [kernel.ref('t1')] });
  assert.deepEqual(plan.selected, [kernel.ref('t1')]);
  assert.equal(plan.lockedAt, 'finalize');

  // The object gains "can't be chosen by enemy spells" while the spell is on the chain.
  let protection = false;
  const resolution = resolveTargetPlan(kernel, plan, { isLegal: snapshot => !protection || snapshot.ref.id !== 't1' });
  assert.equal(resolution.status, 'resolved');
  protection = true;
  const mistargeted = resolveTargetPlan(kernel, plan, { isLegal: snapshot => !protection || snapshot.ref.id !== 't1' });

  assert.equal(mistargeted.status, 'ignored');
  assert.equal(mistargeted.reason, 'mistargeted', '359.3.e.9: losing targetability is a mistarget');
  assert.deepEqual(mistargeted.invalid, [kernel.ref('t1')]);
  assert.equal(kernel.getObject('t1').damage, 0, '359.3.e.6: the related instruction is ignored');
});

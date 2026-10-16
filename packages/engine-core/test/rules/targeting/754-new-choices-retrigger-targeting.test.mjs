// Scenario: targeting-new-choices-retrigger-targeting (CR v1.5 754, 753)
//
// Even when the new choice picks the same object, the chain item targets it
// again, so its targeting effect triggers once more (5+1+1=7).
import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeTargetPlan, reselectTargetPlan } from '../../../dist/target/target-plan.js';
import { world } from '../../../dist/effects/testing/index.js';
import { atBattlefield } from './harness.mjs';

test('targeting-new-choices-retrigger-targeting: reselection notifies becoming a target again', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .unit('t1', { owner: 'B', might: 5, location: atBattlefield('bf1') })
    .build();
  const requirement = { id: 'unit', filter: { type: 'unit', zone: 'board', controller: 'B' } };
  const becomingTarget = [];
  const onTargeted = event => becomingTarget.push([event.target.id, event.reselected]);

  const plan = finalizeTargetPlan(kernel, requirement, { selected: [kernel.ref('t1')], onTargeted });
  assert.deepEqual(becomingTarget, [['t1', false]]);

  // 754: making new choices retargets the object even if it is the same object.
  const reselected = reselectTargetPlan(kernel, plan, { selected: [kernel.ref('t1')], onTargeted });
  assert.deepEqual(becomingTarget, [['t1', false], ['t1', true]]);
  assert.deepEqual(reselected.selected, plan.selected);
});

test.todo('targeting-new-choices-retrigger-targeting (chain half): blocked on the merged "new choices" chain instruction (752/754) — the target layer re-fires, but no op re-finalizes a live chain item');

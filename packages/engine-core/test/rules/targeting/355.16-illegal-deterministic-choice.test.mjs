// Scenario: targeting-illegal-deterministic-choice (CR v1.5 355.16)
//
// A choice that will deterministically make a later step illegal is not allowed
// while a legal alternative exists.
import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeTargetPlan, TargetSelectionError } from '../../../dist/target/target-plan.js';
import { world } from '../../../dist/effects/testing/index.js';
import { atBase } from './harness.mjs';

test('targeting-illegal-deterministic-choice: a target that the cost kills cannot be chosen', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .unit('u1', { owner: 'A', might: 1, location: atBase('A') })
    .unit('u2', { owner: 'A', might: 3, location: atBase('A') })
    .build();
  // The additional cost kills the highest-Might friendly unit (#u2) before the effect locks its target.
  kernel.perform({ type: 'kill', object: kernel.ref('u2') });
  assert.equal(kernel.getObject('u2').zone, 'trash');

  const requirement = { id: 'boost', filter: { type: 'unit', zone: 'board', controller: 'A' } };
  // 355.16: choosing the just-killed #u2 would deterministically be illegal - it is no longer a candidate.
  assert.throws(
    () => finalizeTargetPlan(kernel, requirement, { chosen: [kernel.ref('u2')] }),
    error => error instanceof TargetSelectionError && error.code === 'invalid-target-choice'
  );
  const legal = finalizeTargetPlan(kernel, requirement, { chosen: [kernel.ref('u1')] });
  assert.deepEqual(legal.selected, [kernel.ref('u1')], 'the legal alternative is accepted');
});

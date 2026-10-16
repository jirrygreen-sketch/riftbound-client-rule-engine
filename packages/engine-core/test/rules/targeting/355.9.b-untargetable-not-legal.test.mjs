// Scenario: targeting-untargetable-not-legal (CR v1.5 355.9.b, 756, 757, 758)
//
// A unit that "can't be chosen by enemy spells and abilities" is not a legal
// target. The target layer's legality option is that 758 filter, so a lone
// untargetable unit yields no legal targets and Finalize must fail.
import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeTargetPlan, queryTargetCandidates, TargetSelectionError } from '../../../dist/target/target-plan.js';
import { world } from '../../../dist/effects/testing/index.js';
import { atBattlefield } from './harness.mjs';

test('targeting-untargetable-not-legal: an untargetable unit is not a legal target', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .unit('t1', { owner: 'B', might: 3, location: atBattlefield('bf1') })
    .build();
  const requirement = { id: 't1', filter: { type: 'unit', zone: 'board', controller: 'B' } };
  // 757/758: "I can't be chosen by enemy spells and abilities" - legality is category based.
  const options = { isLegal: snapshot => snapshot.ref.id !== 't1' };

  assert.deepEqual(queryTargetCandidates(kernel, requirement, options), [], '758: not a legal target');
  assert.throws(
    () => finalizeTargetPlan(kernel, requirement, options),
    error => error instanceof TargetSelectionError && error.code === 'no-legal-targets'
  );
});

// Scenario: targeting-new-choices-none-legal-negated (CR v1.5 753.2)
//
// When no legal new choice exists, a player may not remake the choices. The
// merged target layer exposes exactly that refusal; the chain-level "make new
// choices" instruction that would be negated is not merged.
import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeTargetPlan, reselectTargetPlan, TargetSelectionError } from '../../../dist/target/target-plan.js';
import { world } from '../../../dist/effects/testing/index.js';
import { atBattlefield } from './harness.mjs';

test('targeting-new-choices-none-legal-negated: reselection refuses when no legal choice exists', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .unit('t1', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .build();
  const requirement = { id: 'unit', filter: { type: 'unit', zone: 'board', controller: 'B' } };
  const plan = finalizeTargetPlan(kernel, requirement, { selected: [kernel.ref('t1')] });

  // "I can't be chosen by enemy spells and abilities" (758) leaves no legal new choice.
  const untargetable = { isLegal: snapshot => snapshot.ref.id !== 't1' };
  assert.throws(
    () => reselectTargetPlan(kernel, plan, untargetable),
    error => error instanceof TargetSelectionError && error.code === 'no-legal-targets'
  );
  // 753.2: the original selection is untouched because the remake is refused.
  assert.deepEqual(plan.selected, [kernel.ref('t1')]);
});

test.todo('targeting-new-choices-none-legal-negated (chain half): blocked on the merged "make new choices" chain instruction (751-755) — the target layer refuses, but no op negates the remaking instruction on a live chain item');

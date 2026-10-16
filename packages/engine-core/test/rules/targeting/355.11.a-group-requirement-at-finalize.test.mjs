// Scenario: targeting-group-requirement-at-finalize (CR v1.5 355.11.a)
//
// A group targeting requirement is locked as one group at Finalize
// ("as they're finalized on the chain, such cards can choose any group of valid
// targets"). This file verifies the merged group-locking shape; the collective
// constraint itself is covered by the todo below.
import assert from 'node:assert/strict';
import test from 'node:test';
import { atBattlefield, constant, scene, spend } from './harness.mjs';

test('targeting-group-requirement-at-finalize: the chosen group is locked as one plan', () => {
  const s = scene(builder => builder
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('spell', { owner: 'A', types: ['spell'] })
    .unit('r1', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .unit('r2', { owner: 'B', might: 2, location: atBattlefield('bf1') })
    .unit('r3', { owner: 'B', might: 3, location: atBattlefield('bf1') }));
  const spell = s.draft('spell', {
    body: [{ id: 'kill', op: 'effect.kill', args: { target: 'units' } }],
    targets: [{
      requirement: { id: 'units', filter: { type: 'unit', zone: 'board', controller: 'B', location: 'battlefield' }, selection: 'up-to', max: 4, group: true }
    }],
    cost: { id: 'cost:spell', cost: { energy: constant(3), power: constant([]) } }
  });
  s.answers.set('target:units', ['r1', 'r2'].map(id => s.kernel.ref(id)));
  s.engine.execute(spell);

  const plan = s.engine.items[0].targetPlans[0];
  assert.equal(plan.requirement.group, true, 'the requirement keeps its group marker');
  assert.deepEqual(plan.selected.map(ref => ref.id), ['r1', 'r2'], '355.11.a: one chosen group is locked at Finalize');
  assert.equal(plan.lockedAt, 'finalize');

  spend(s.engine);
  assert.equal(s.kernel.getObject('r1').zone, 'trash');
  assert.equal(s.kernel.getObject('r2').zone, 'trash');
  assert.equal(s.kernel.getObject('r3').zone, 'board', 'the unselected unit is untouched');
});

test.todo('targeting-group-requirement-at-finalize (collective-constraint half): blocked on the group requirement evaluator — TargetRequirement.group is a marker only; no merged code validates an aggregate constraint (Fox-Fire total Might <= 4) at Finalize');

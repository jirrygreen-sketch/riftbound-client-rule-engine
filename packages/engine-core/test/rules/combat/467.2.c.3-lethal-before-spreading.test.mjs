// Scenarios: combat-assign-full-lethal-before-spreading, combat-negative-cannot-spread-below-lethal
// CR v1.5 467.2.c.3, 467.2.c.1, 467.2.c.1.a, 142.4.b, 143.3.
//
// Executed against the merged combat-damage assignment kernel
// (src/combat/base-combat-allocation.ts) with an actually-active Combat built by
// the canonical board factory. Only current Might comes from the trusted facts
// seam; every UID, amount and ordering decision below is validated by the kernel.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  amount, bindScene, blockedCode, combatScene, planDuelBaseCombatDamage, validateDuelBaseCombatAllocation,
} from './harness.mjs';

test('combat-assign-full-lethal-before-spreading (467.2.c.3): 5 damage against two 3-Might defenders must be 3 then 2', () => {
  const scene = combatScene({ attackers: [{ uid: 'u1', might: 5 }], defenders: [{ uid: 'd1', might: 3 }, { uid: 'd2', might: 3 }] });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bindScene(scene));
  assert.equal(plan.attacker.side, 'attacker');
  assert.equal(plan.defender.side, 'defender');
  assert.deepEqual(plan.sideIDs, ['A', 'B']);
  assert.equal(plan.attacker.budget, 5, '467.2.a: the Attacker sums the Might of all Attacking Units');
  assert.equal(plan.defender.budget, 6, '467.2.b: the Defender sums the Might of all Defending Units');
  assert.deepEqual(plan.attacker.targets.map(target => target.lethalNeed), [3, 3], '142.4.b: lethal is non-zero damage at least equal to Might');

  const attack = validateDuelBaseCombatAllocation(plan, 'A', [amount('d1', 3), amount('d2', 2)], scene.state.stateVersion);
  assert.deepEqual(attack.assignments, [amount('d1', 3), amount('d2', 2)]);
  assert.equal(attack.assignedTotal, 5);
  assert.equal(attack.readyForSimultaneousDeal, false, '467.2.c.1: assigning damage is not dealing damage');

  // A lone opposing Unit may take everything once no other Unit remains to assign to.
  const defense = validateDuelBaseCombatAllocation(plan, 'B', [amount('u1', 6)], scene.state.stateVersion);
  assert.deepEqual(defense.assignments, [amount('u1', 6)], 'a lone remaining Unit may take overflow (467.2.c.4)');
});

test('combat-negative-cannot-spread-below-lethal (467.2.c.3): 2+1+1+1 against four 3-Might defenders is rejected', () => {
  const scene = combatScene({
    attackers: [{ uid: 'u1', might: 5 }],
    defenders: [1, 2, 3, 4].map(index => ({ uid: `d${index}`, might: 3 })),
  });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bindScene(scene));
  assert.equal(plan.attacker.budget, 5);
  assert.deepEqual(plan.attacker.targets.map(target => target.lethalNeed), [3, 3, 3, 3]);

  const code = blockedCode(() => validateDuelBaseCombatAllocation(plan, 'A', [
    amount('d1', 2), amount('d2', 1), amount('d3', 1), amount('d4', 1),
  ]));
  assert.equal(code, 'invalid-allocation', 'the whole plan is illegal, nothing partial is executed');
  // The legal shape for the same 5 points: fill one 3-Might Unit first, then the next.
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'A',
    [amount('d1', 3), amount('d2', 2)], scene.state.stateVersion).assignments, [amount('d1', 3), amount('d2', 2)]);
});

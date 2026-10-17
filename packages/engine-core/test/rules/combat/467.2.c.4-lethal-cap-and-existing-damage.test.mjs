// Scenarios: combat-assign-capped-at-lethal-with-existing-damage,
//            combat-negative-assign-more-than-lethal,
//            combat-attacker-sums-might-defender-assigns-back
// CR v1.5 467.2.c.4, 467.2.c.3, 467.2.c.1.a, 467.2.d, 143.3.
//
// Executed against the merged assignment kernel: the marked-damage total is read
// from unitMeta.damageMarks, the lethal need is recomputed from it, and overkill
// is refused while another opposing Unit still has no damage assigned. The two
// sides are then paired into the one-shot simultaneous-deal receipt (467.2.c.1.a).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  amount, bindScene, blockedCode, combatScene, completeDuelBaseCombatAllocation,
  planDuelBaseCombatDamage, validateDuelBaseCombatAllocation,
} from './harness.mjs';

test('combat-assign-capped-at-lethal-with-existing-damage (467.2.c.4): marked damage lowers the per-Unit cap to 2', () => {
  const scene = combatScene({
    attackers: [{ uid: 'u1', might: 5 }],
    defenders: [1, 2, 3, 4].map(index => ({ uid: `d${index}`, might: 3, marks: [1] })),
  });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bindScene(scene));
  assert.deepEqual(plan.attacker.targets.map(target => [target.existingDamage, target.lethalNeed]),
    [[1, 2], [1, 2], [1, 2], [1, 2]], '143.3: damage already marked counts toward lethal');
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'A', [
    amount('d1', 2), amount('d2', 2), amount('d3', 1),
  ], scene.state.stateVersion).assignments, [amount('d1', 2), amount('d2', 2), amount('d3', 1)]);
  // Assigning 3 to any of them exceeds the cap while further Units remain (467.2.c.4).
  assert.equal(blockedCode(() => validateDuelBaseCombatAllocation(plan, 'A',
    [amount('d1', 3), amount('d2', 2)])), 'invalid-allocation');
});

test('combat-negative-assign-more-than-lethal (467.2.c.4): 4+1 against two 3-Might defenders is rejected', () => {
  const scene = combatScene({ attackers: [{ uid: 'u1', might: 5 }], defenders: [{ uid: 'd1', might: 3 }, { uid: 'd2', might: 3 }] });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bindScene(scene));
  assert.equal(blockedCode(() => validateDuelBaseCombatAllocation(plan, 'A',
    [amount('d1', 4), amount('d2', 1)])), 'invalid-allocation');
  assert.equal(blockedCode(() => validateDuelBaseCombatAllocation(plan, 'A',
    [amount('d1', 3), amount('d2', 3)])), 'invalid-allocation',
  'the total must equal the summed Might budget (467.2.c)');
});

test('combat-attacker-sums-might-defender-assigns-back (467.2.c / 467.2.d): both sides assign, then the pair becomes one simultaneous-deal receipt', () => {
  const scene = combatScene({
    attackers: [{ uid: 'u1', might: 3 }, { uid: 'u2', might: 2 }],
    defenders: [{ uid: 'd1', might: 4 }],
  });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bindScene(scene));
  assert.equal(plan.attacker.budget, 5, '3 + 2 summed Might');
  assert.equal(plan.defender.budget, 4);
  assert.deepEqual(plan.attacker.targets.map(target => target.uid), ['d1']);
  assert.deepEqual(plan.defender.targets.map(target => target.uid), ['u1', 'u2']);

  // 467.2.c: the Attacker assigns first, the Defender answers with its own sum.
  const attack = validateDuelBaseCombatAllocation(plan, 'A', [amount('d1', 5)], scene.state.stateVersion);
  const defense = validateDuelBaseCombatAllocation(plan, 'B', [amount('u1', 3), amount('u2', 1)], scene.state.stateVersion);
  assert.deepEqual(defense.assignments, [amount('u1', 3), amount('u2', 1)],
    '467.2.c.3: u1 must take its full 3 lethal before the remaining 1 goes to u2');

  const complete = completeDuelBaseCombatAllocation(attack, defense, scene.state.stateVersion);
  assert.equal(complete.readyForSimultaneousDeal, true, '467.2.c.1.a: both sides are now dealt simultaneously');
  assert.deepEqual(complete.attacker.assignments, [amount('d1', 5)]);
  assert.deepEqual(complete.defender.assignments, [amount('u1', 3), amount('u2', 1)]);
  assert.equal(blockedCode(() => completeDuelBaseCombatAllocation(defense, attack, scene.state.stateVersion)),
    'invalid-allocation', 'the pairing is always Attacker then Defender');
});

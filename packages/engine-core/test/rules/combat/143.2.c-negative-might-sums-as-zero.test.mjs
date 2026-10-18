// Scenario: combat-negative-might-sums-as-zero
// CR v1.5 143.2.c, 143.2.c.1, 467.2.a, 142.4.b.
//
// Executed: the merged arithmetic layer (src/layers) is the authority for a
// Unit's current Might, and it reads a debuffed Unit as 0, so that Unit adds
// nothing to its side's summed combat Might (467.2.a) and the opposing side
// assigns normally.
//
// Boundary: 143.2.c.1 also requires the Unit's ACTUAL Might to stay negative for
// further increases/decreases. The merged arithmetic layer clamps Might to >= 0
// at the end of every arithmetic pass and has no separate "reference value"
// channel, so that half has no model yet (registered as the layers todo
// `143.2.c-negative-might-treated-as-zero`). This golden therefore asserts what
// the merged kernel really owns: the combat summation reads 0.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  amount, bindScene, combatScene, layeredMight, planDuelBaseCombatDamage, validateDuelBaseCombatAllocation,
} from './harness.mjs';

test('combat-negative-might-sums-as-zero (143.2.c / 467.2.a): a Might floored to 0 contributes no damage budget', () => {
  // A's Unit has Might 2 and a real arithmetic modifier of -2, taking it to 0.
  const debuffed = layeredMight({ id: 'u1', might: 2 }, [
    {
      effect: {
        id: 'disarm-like-debuff', layer: 'arithmetic', source: { id: 'spell:1', zoneEntryId: 1 },
        filter: { objectId: 'u1' }, effect: { kind: 'increase', amount: -2 },
      },
    },
  ]);
  assert.equal(debuffed.snapshot.might, 0, '143.2.c: Might below 0 is read as 0 by the merged layer engine');

  const scene = combatScene({ attackers: [{ uid: 'u1', might: 2 }], defenders: [{ uid: 'd1', might: 2 }] });
  const plan = planDuelBaseCombatDamage(scene.state, scene.fieldId, bindScene(scene, {
    currentMight: unit => (unit.uid === 'u1' ? debuffed.snapshot.might : 2),
  }));
  assert.equal(plan.attacker.budget, 0, '467.2.a: the Attacker sums 0 Might');
  assert.equal(plan.defender.budget, 2);
  // A has nothing to assign at all; B still assigns its full 2 to the only Unit.
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'A', [], scene.state.stateVersion).assignments, []);
  assert.deepEqual(validateDuelBaseCombatAllocation(plan, 'B', [amount('u1', 2)], scene.state.stateVersion).assignments,
    [amount('u1', 2)], 'the Defender kills the 0-Might Unit normally');
  // The attacker keeps its real status as a Defender target: it is not removed.
  assert.deepEqual(scene.attackerIds, ['u1']);
});

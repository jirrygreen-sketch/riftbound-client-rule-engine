// docs/rules/scenarios/keywords.yaml — Shield (CR v1.5 814.1.b.3, 814.1.c, 814.1.d.1, 814.2).
//
// Same split as Assault: the merged Shield expansion is a designation-gated
// arithmetic-layer ability, so the scenarios’ Might/damage halves are todos while
// the numeric stacking half (814.2) executes through the merged
// `continuous.grant-keyword` primitive and the real layer engine.
import assert from 'node:assert/strict';
import test from 'node:test';
import shield, { SHIELD_DEFAULT_VALUE, SELF_OBJECT_REF } from '../../../dist/effects/keywords/Shield.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';
import { LayerEngine } from '../../../dist/layers/engine.js';
import { c } from './support.mjs';

const SHIELD_CARD = 'test:shield-unit';

const expansionOf = value => (value === undefined
  ? shield.expand({ host: { canonicalCardId: SHIELD_CARD } })[0]
  : shield.expand({ value, host: { canonicalCardId: SHIELD_CARD } })[0]);

/** Grant Shield `value` to one printed-Shield unit through the merged primitive. */
const grantShield = (printed, value) => {
  const kernel = world().player('A').unit('u1', { might: 2, keywords: [printed] })
    .hand('spell', { types: ['spell'] }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A' });
  context.setTargets('grantee', [kernel.ref('u1')]);
  const run = runInstruction(instructionDefinitionsById.get('continuous.grant-keyword'), {
    keywords: c([{ id: 'Shield', value }]),
    objects: c({ kind: 'target', id: 'grantee' })
  }, { world: context });
  assert.equal(run.result.status, 'executed');
  const layer = new LayerEngine(context.objects);
  for (const registration of context.snapshot().continuous) layer.addContinuous(registration.effect, registration.duration);
  return layer.evaluate(kernel.ref('u1'));
};

test('keywords-shield-bonus-while-defending: an omitted Shield Value is presumed to be 1 and the bonus is gated on the Defender designation (CR 814.1.b.3, 814.1.c)', () => {
  assert.equal(SHIELD_DEFAULT_VALUE, 1);
  assert.equal(expansionOf(undefined).effect.amount.value, 1);
  assert.equal(expansionOf(2).effect.amount.value, 2);

  for (const value of [undefined, 1, 2, 3]) {
    const ability = expansionOf(value);
    assert.equal(ability.effect.kind, 'continuous.might');
    assert.equal(ability.effect.mode, 'add');
    assert.equal(ability.effect.layer, 'arithmetic');
    assert.equal(ability.effect.appliesTo, 'self');
    assert.equal(ability.condition.operator, 'eq');
    assert.equal(ability.condition.right.value, 'defender');
    assert.notEqual(ability.condition.right.value, 'attacker');
    assert.equal(ability.condition.left.object, SELF_OBJECT_REF);
    assert.equal(ability.condition.left.property, 'designation');
  }
  assert.ok(shield.ruleRefs.includes('814.1.d.1'), 'the attacker-inactive rule is cited');
});

test('keywords-shield-stacks-from-multiple-sources: printed Shield 1 plus a granted Shield 3 read as one Shield 4 (CR 814.2)', () => {
  // The official 814.2 example is Stalwart Poro plus Block.
  assert.deepEqual(grantShield({ id: 'Shield' }, 3).keywords, [{ id: 'Shield', value: 4 }]);
  assert.equal(shield.stacking, 'sum');
  assert.deepEqual(grantShield({ id: 'Shield', value: 2 }, 3).keywords, [{ id: 'Shield', value: 5 }]);

  for (const granted of [0, 1, 7]) {
    assert.deepEqual(grantShield({ id: 'Shield', value: 2 }, granted).keywords, [{ id: 'Shield', value: 2 + granted }]);
  }
});

test('keywords-shield-inactive-while-attacking: the authored gate names the Defender designation, never the Attacker one (CR 814.1.d)', () => {
  const ability = expansionOf(2);
  assert.equal(ability.condition.right.value, 'defender');
  assert.notEqual(ability.condition.right.value, 'attacker');
  assert.equal(ability.condition.left.property, 'designation');
});

test.todo('keywords-shield-bonus-while-defending / keywords-shield-inactive-while-attacking / keywords-shield-stacks-from-multiple-sources (executed Might and combat damage): CR 814.1.c’s “+X Might while I am a defender” needs the Defender designation at layer-evaluation time, but the merged expansion reads object-property(self, "designation") while ObjectSnapshot only carries combatRole and src/layers/engine.ts has no designation accessor, so src/programs/statics.ts evaluates the condition to false for every host; the combat half also needs the atomic simultaneous-damage rules task (src/combat/flow.ts dealDamage() throws the batch-4 blocked marker)');

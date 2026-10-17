// docs/rules/scenarios/keywords.yaml — Assault (CR v1.5 807.1.b.3, 807.1.c, 807.1.d.1, 807.2).
//
// The merged Assault expansion (src/effects/keywords/Assault.ts) is a static
// arithmetic-layer ability whose condition compares the host characteristic
// `designation` with "attacker". The merged ObjectSnapshot exposes `combatRole`
// instead (src/effects/contract.ts) and src/layers/engine.ts has no
// `designation` accessor, so the designation-gated Might bonus cannot be
// evaluated: the scenarios' Might/damage halves are registered as todos with
// that reason.
//
// The numeric side of 807.2 — several Assault sources summing into one Assault
// Value — is merged and executed below through the production layer-ops helpers
// (src/layers/ops/index.ts) and the real layer engine.
import assert from 'node:assert/strict';
import test from 'node:test';
import assault, { ASSAULT_DEFAULT_VALUE, SELF_OBJECT_REF } from '../../../dist/effects/keywords/Assault.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import { runInstruction, world } from '../../../dist/effects/testing/index.js';
import { LayerEngine } from '../../../dist/layers/engine.js';
import { c } from './support.mjs';

const ASSAULT_CARD = 'test:assault-unit';

const expansionOf = value => (value === undefined
  ? assault.expand({ host: { canonicalCardId: ASSAULT_CARD } })[0]
  : assault.expand({ value, host: { canonicalCardId: ASSAULT_CARD } })[0]);

/**
 * One printed-Assault unit plus a spell that grants “Assault `value`”, executed
 * through the merged `continuous.grant-keyword` primitive. Returns the layered
 * keyword list of the unit after the grant resolved.
 */
const grantAssault = (printed, value) => {
  const kernel = world().player('A').unit('u1', { might: 5, keywords: [printed] })
    .hand('spell', { types: ['spell'] }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject('spell'), controller: 'A' });
  context.setTargets('grantee', [kernel.ref('u1')]);
  const run = runInstruction(instructionDefinitionsById.get('continuous.grant-keyword'), {
    keywords: c([{ id: 'Assault', value }]),
    objects: c({ kind: 'target', id: 'grantee' })
  }, { world: context });
  assert.equal(run.result.status, 'executed', 'the granted Assault resolves');
  const layer = new LayerEngine(context.objects);
  for (const registration of context.snapshot().continuous) layer.addContinuous(registration.effect, registration.duration);
  return layer.evaluate(kernel.ref('u1'));
};

test('keywords-assault-default-value-1: an omitted Assault Value is presumed to be 1 (CR 807.1.b.3)', () => {
  assert.equal(ASSAULT_DEFAULT_VALUE, 1);
  assert.equal(expansionOf(undefined).effect.amount.value, 1);
  assert.equal(expansionOf(2).effect.amount.value, 2);
});

test('keywords-assault-stacks-from-multiple-sources: printed Assault 1 plus a granted Assault 3 read as one Assault 4 (CR 807.2)', () => {
  // The official 807.2 example (Petty Officer plus Cleave) is exactly this sum.
  assert.deepEqual(grantAssault({ id: 'Assault' }, 3).keywords, [{ id: 'Assault', value: 4 }]);
  assert.equal(assault.stacking, 'sum', '807.2 sums rather than duplicating the keyword');

  // An already-valued printing takes the same path.
  assert.deepEqual(grantAssault({ id: 'Assault', value: 1 }, 3).keywords, [{ id: 'Assault', value: 4 }]);
});

test('keywords-assault-inactive-while-defending / keywords-assault-ends-when-combat-ends: the expansion is gated on the Attacker designation alone (CR 807.1.c, 807.1.d)', () => {
  for (const value of [undefined, 1, 2, 4]) {
    const ability = expansionOf(value);
    assert.equal(ability.effect.kind, 'continuous.might');
    assert.equal(ability.effect.mode, 'add');
    assert.equal(ability.effect.layer, 'arithmetic');
    assert.equal(ability.effect.appliesTo, 'self');
    assert.equal(ability.condition.operator, 'eq');
    assert.equal(ability.condition.right.value, 'attacker');
    assert.notEqual(ability.condition.right.value, 'defender');
    assert.equal(ability.condition.left.object, SELF_OBJECT_REF);
    assert.equal(ability.condition.left.property, 'designation');
  }
  assert.ok(assault.ruleRefs.includes('807.1.d.1'), 'the combat-end lifetime is cited');
});

test('keywords-assault-stacks-from-multiple-sources: grants of 0, 1 and 9 add verbatim without clamping (CR 807.2)', () => {
  for (const granted of [0, 1, 9]) {
    const layered = grantAssault({ id: 'Assault', value: 2 }, granted);
    assert.deepEqual(layered.keywords, [{ id: 'Assault', value: 2 + granted }]);
  }
});

test.todo('keywords-assault-default-value-1 / keywords-assault-inactive-while-defending / keywords-assault-stacks-from-multiple-sources (executed Might and combat damage): CR 807.1.c’s “+X Might while I am an attacker” needs the Attacker designation at layer-evaluation time, but the merged expansion reads object-property(self, "designation") while ObjectSnapshot only carries combatRole and src/layers/engine.ts has no designation accessor, so src/programs/statics.ts evaluates the condition to false for every host; the combat half also needs the atomic simultaneous-damage rules task (src/combat/flow.ts dealDamage() throws the batch-4 blocked marker) to produce combat.damage-assigned');

test.todo('keywords-assault-ends-when-combat-ends (CR 468.7.a): removing the Attacker designation at Combat end needs the designation producer and remover (CR 466.2 / 468.7) — not merged; the post-combat state is asserted above through the authored gate instead');

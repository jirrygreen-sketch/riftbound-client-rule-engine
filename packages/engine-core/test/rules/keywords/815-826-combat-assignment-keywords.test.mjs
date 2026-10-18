// docs/rules/scenarios/keywords.yaml — Tank (CR v1.5 815.1.b, 815.1.c.2, 815.2) and
// Backline (826.3, 826.4.b, 826.5).
//
// Both keywords expand to a declarative `continuous.combat` static ability. The merged
// static binder maps that kind onto the `ability` layer (src/programs/statics.ts
// `layerFor()` includes `combat`), and src/layers/ops/index.ts records it verbatim
// because no layer branch consumes it yet. The authored declarations are asserted
// below; the assignment-order scenarios need the combat damage task, which is a todo.
import assert from 'node:assert/strict';
import test from 'node:test';
import tank from '../../../dist/effects/keywords/Tank.js';
import backline from '../../../dist/effects/keywords/Backline.js';
import { createEngineStaticBinder } from '../../../dist/programs/statics.js';
import { fixture } from './support.mjs';

const TANK_CARD = 'test:tank-unit';
const BACKLINE_CARD = 'test:backline-unit';

const program = canonicalCardId => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
});

const expectation = (keyword, expansion, priority, excludes, refs) => {
  assert.equal(expansion.keyword, keyword);
  assert.equal(expansion.valued, false);
  // Multiple instances are redundant.
  assert.equal(expansion.stacking, 'single');
  assert.ok(expansion.ruleRefs.includes('467.2.c.6'), `${keyword} cites the assignment rule`);
  for (const ref of refs) assert.ok(expansion.ruleRefs.includes(ref), `${keyword} cites ${ref}`);
  return { priority, excludes };
};

test('keywords-tank-must-be-assigned-lethal-first: Tank expands to a lethal-first, same-controller assignment requirement (CR 815.1.b, 815.1.c.2)', () => {
  const abilities = tank.expand({ host: { canonicalCardId: TANK_CARD } });
  assert.equal(abilities.length, 1);
  assert.equal(abilities[0].kind, 'static');
  const { priority, excludes } = expectation('Tank', tank, 'first', 'Tank', ['815.1.b', '815.1.c.2', '815.2']);
  assert.equal(abilities[0].effect.kind, 'continuous.combat');
  assert.equal(abilities[0].effect.mode, 'damage-assignment');
  assert.equal(abilities[0].effect.priority, priority);
  assert.equal(abilities[0].effect.damage, 'lethal');
  assert.equal(abilities[0].effect.controllerScope, 'same-controller');
  assert.equal(abilities[0].effect.excludesKeyword, excludes);
  assert.equal(abilities[0].effect.appliesTo, 'self');
});

test('keywords-backline-assigned-last: Backline expands to the opposite lethal-last assignment requirement (CR 826.3, 826.4.b)', () => {
  const abilities = backline.expand({ host: { canonicalCardId: BACKLINE_CARD } });
  assert.equal(abilities.length, 1);
  const { priority, excludes } = expectation('Backline', backline, 'last', 'Backline', ['826.3', '826.4.b', '826.5']);
  assert.equal(abilities[0].effect.kind, 'continuous.combat');
  assert.equal(abilities[0].effect.priority, priority);
  assert.equal(abilities[0].effect.damage, 'lethal');
  assert.equal(abilities[0].effect.controllerScope, 'same-controller');
  assert.equal(abilities[0].effect.excludesKeyword, excludes);
});

test('keywords-tank-must-be-assigned-lethal-first / keywords-backline-assigned-last: both declarations bind into the ability layer but have no consumer', () => {
  const f = fixture({
    programs: [program(TANK_CARD), program(BACKLINE_CARD)],
    setup: w => w.player('B')
      .unit('tank', { cardId: TANK_CARD, might: 2, keywords: [{ id: 'Tank' }], location: { type: 'battlefield', id: 'bf1' } })
      .unit('backline', { cardId: BACKLINE_CARD, might: 3, keywords: [{ id: 'Backline' }], location: { type: 'battlefield', id: 'bf1' } })
  });
  const binder = createEngineStaticBinder(f.engine);

  for (const id of ['tank', 'backline']) {
    const ability = f.binding.inspect(f.get(id)).abilities.find(candidate => candidate.kind === 'static');
    // `layerFor()` maps `continuous.combat` onto the ability layer, so binding
    // succeeds and the declaration is recorded verbatim for a future consumer.
    const handle = binder.bindStatic(ability, f.get(id));
    assert.equal(typeof handle.unbind, 'function');
  }
  const registered = f.engine.layers.registry.list();
  assert.equal(registered.length, 2);
  assert.deepEqual(registered.map(entry => entry.effect.effect.kind), ['continuous.combat', 'continuous.combat']);
  assert.deepEqual(registered.map(entry => entry.effect.effect.priority), ['first', 'last']);
  // No arithmetic-layer consumer exists, so combat does not change Might yet.
  assert.equal(f.snapshot('tank').might, 2);
  assert.equal(f.snapshot('backline').might, 3);
});

test.todo('keywords-tank-must-be-assigned-lethal-first / keywords-tank-multiple-tanks-any-order / keywords-backline-assigned-last / keywords-backline-multiple-any-order (CR 815.1.c.2, 826.4.b): the assignment-order scenarios need a live Combat damage step — src/combat/flow.ts `dealDamage()` throws the batch-4 blocked marker (“simultaneous-damage-transaction”), and no merged consumer reads `continuous.combat` (src/layers/ops/index.ts records it “for the combat workflow to consume”), so neither the must-assign-lethal-first rejection nor the free order among several Tank/Backline units can be executed');

test.todo('keywords-tank-multiple-tanks-any-order (CR 815.1.c.2): choosing freely among several Tank units needs the same live Combat damage step and a reader for the recorded `continuous.combat` priority — neither is merged');

test.todo('keywords-backline-multiple-any-order (CR 826.4.b): choosing freely among several Backline units needs the same live Combat damage step and a `continuous.combat` reader');

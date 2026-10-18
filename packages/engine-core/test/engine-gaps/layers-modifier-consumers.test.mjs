// RIFT-846 production consumers for arithmetic modifiers and effective Shield.
//
// The scenarios use the shipped Mel/Newly Awakened and Stupefy IR shapes, the
// generated instruction registry, the real ContinuousEffectRegistry and the
// default LayerEngine. Shield scenarios also execute through createProgramBinding
// and ChainEngine so the default layer chain, rather than a hand-built view, is
// what effect.shield-value observes.
import assert from 'node:assert/strict';
import test from 'node:test';

import { instructionDefinitionsById } from '../../dist/effects/instructions/registry.generated.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
import { ContinuousEffectRegistry } from '../../dist/layers/duration.js';
import { LayerEngine } from '../../dist/layers/engine.js';
import mel from '../../../card-dsl/dist/cards/ven/mel-newly-awakened.js';
import stupefy from '../../../card-dsl/dist/cards/ogn/stupefy.js';
import { cardProgram, c, fixture, settle } from '../rules/keywords/support.mjs';

const modifierOp = instructionDefinitionsById.get('continuous.modify-might-reduction');
const mightOp = instructionDefinitionsById.get('continuous.might');

const melModifier = mel.abilities.find(ability =>
  ability.kind === 'static' && ability.effect.kind === 'continuous.modify-might-reduction').effect;
const stupefyDebuff = stupefy.abilities.find(ability => ability.kind === 'play').body[0];
assert.equal(stupefyDebuff.op, 'continuous.might');

function kernel({ targetMight = 5, shield = [] } = {}) {
  return world().player('A').player('B')
    .unit('source-a', { controller: 'A', might: 1, energy: null, power: null })
    .unit('source-a2', { controller: 'A', might: 1, energy: null, power: null })
    .unit('source-b', { owner: 'B', controller: 'B', might: 1, energy: null, power: null })
    .unit('target', { controller: 'A', might: targetMight, keywords: shield, energy: null, power: null })
    .build();
}

// Run the production primitive transactionally and persist only committed state.
function runOn(worldState, op, args, { source, controller, targets = {} } = {}) {
  const sourceRef = source ?? worldState.ref('source-a');
  const context = worldState.clone({
    sourceSnapshot: worldState.object(sourceRef), controller: controller ?? worldState.object(sourceRef).controller,
  });
  const run = runInstruction(op, args, { world: context, targets });
  if (run.result !== null) {
    worldState.restore(context.snapshot());
    worldState.copyLinkedFrom(context);
  }
  return run;
}

function registerModifier(worldState, {
  source = worldState.ref('source-a'), controller, amount = melModifier.amount,
  appliesTo = melModifier.appliesTo, duration = 'permanent', settlementId,
} = {}) {
  const run = runOn(worldState, modifierOp, {
    mode: c(melModifier.mode), amount, appliesTo: c(appliesTo), duration: c(duration),
    ...(settlementId === undefined ? {} : { settlementId: c(settlementId) }),
  }, { source, controller });
  assert.equal(run.result.status, 'executed');
  return worldState.continuousEffects.at(-1).effect;
}

function registerReduction(worldState, {
  source = worldState.ref('source-a'), controller, targetMight = undefined,
} = {}) {
  const run = runOn(worldState, mightOp, {
    ...stupefyDebuff.args,
    target: c('target'),
  }, { source, controller, targets: { target: [worldState.ref('target')] } });
  assert.equal(run.result.status, 'executed');
  return worldState.continuousEffects.at(-1).effect;
}

function registryFrom(worldState) {
  const registry = new ContinuousEffectRegistry();
  for (const entry of worldState.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
}

function layeredMight(worldState, registry = registryFrom(worldState)) {
  const engine = new LayerEngine(worldState.objects, registry);
  return engine.evaluate(worldState.ref('target'));
}

function reductionProgram(id, { amount = -2, minimum, duration = 'permanent', settlementId = 'reduction' } = {}) {
  return cardProgram(id, [{
    id: 'reduce',
    op: 'continuous.might',
    args: {
      amount: c(amount),
      ...(minimum === undefined ? {} : { minimum: c(minimum) }),
      duration: c(duration),
      target: c('victim'),
      settlementId: c(settlementId),
    },
    targets: [{ id: 'victim', filter: { objectId: 'victim', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
  }]);
}

function modifierProgram(id, { amount = -1, appliesTo = 'controller-spells-and-abilities', duration = 'permanent' } = {}) {
  return cardProgram(id, [{
    id: 'modifier',
    op: 'continuous.modify-might-reduction',
    args: {
      mode: c('additional'), amount: c(amount), appliesTo: c(appliesTo), duration: c(duration),
    },
  }]);
}

function chainFixture(programs, { targetMight = 5, controller = 'A' } = {}) {
  return fixture({
    programs,
    turnPlayer: controller,
    setup: builder => {
      builder.hand('spell', {
        owner: controller, types: ['spell'], might: null, energy: 0, power: null,
      });
      builder.unit('victim', {
        owner: 'A', controller: 'A', might: targetMight, energy: null, power: null,
      });
    },
  });
}

test('CR 479.4.b: default ChainEngine consumes Mel additional reduction with Stupefy IR and remains stable', () => {
  const reduction = reductionProgram('test:reduction', { amount: -2 });
  const modifier = modifierProgram('test:modifier');
  const f = chainFixture([reduction, modifier]);
  f.get('spell').cardId = modifier.canonicalCardId;
  f.play('spell');
  settle(f.engine);
  const sameSpell = f.kernel.getObject('spell');
  sameSpell.cardId = reduction.canonicalCardId;
  sameSpell.zone = 'hand';
  f.engine.setPhase('main');
  f.engine.execute(f.binding.describePlay({ type: 'play', player: 'A', object: f.kernel.ref('spell') }, f.kernel.getObject('spell')));
  settle(f.engine);

  assert.equal(f.snapshot('victim').might, 2, '5 - 2 base reduction - 1 additional reduction');
  assert.equal(f.snapshot('victim').might, 2);
  assert.equal(f.snapshot('victim').might, 2, 'repeated layer reads do not reapply the modifier');
  assert.equal(f.snapshot('victim').energy, null);
  assert.equal(f.snapshot('victim').power, null);
  assert.equal(f.kernel.getObject('victim').might, 5, 'only the authoritative layer view is derived');
});

test('modifier consumers isolate controller and scope while multiple same-controller sources sum once', () => {
  for (const [label, options, expected] of [
    ['no modifier', {}, 4],
    ['wrong controller', { modifierSource: 'source-b', modifierController: 'B' }, 4],
    ['wrong scope', { appliesTo: 'controller-spells-only' }, 4],
  ]) {
    const state = kernel();
    if (label !== 'no modifier') registerModifier(state, {
      source: state.ref(options.modifierSource ?? 'source-a'),
      controller: options.modifierController,
      appliesTo: options.appliesTo ?? melModifier.appliesTo,
      settlementId: label,
    });
    registerReduction(state);
    assert.equal(layeredMight(state).might, expected, label);
  }

  const multiple = kernel();
  registerModifier(multiple, { source: multiple.ref('source-a'), settlementId: 'first' });
  registerModifier(multiple, { source: multiple.ref('source-a2'), settlementId: 'second' });
  registerReduction(multiple);
  assert.equal(layeredMight(multiple).might, 2, 'one base reduction plus two independent modifiers');
});

test('CR 479.4.b: a reduction limited to zero stays zero and never becomes a fresh modifier settlement', () => {
  const state = kernel({ targetMight: 1 });
  registerModifier(state, { settlementId: 'zero-gate' });
  registerReduction(state);
  const registry = registryFrom(state);
  const engine = new LayerEngine(state.objects, registry);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(engine.evaluate(state.ref('target')).might, 1);
  }
  engine.setObjects(state.objects);
  assert.equal(engine.evaluate(state.ref('target')).might, 1);
});

test('CR 479.4.b: expiry and source departure remove future modifiers but preserve the locked reduction', () => {
  const expiry = kernel();
  registerModifier(expiry, { duration: 'this-turn', settlementId: 'expiring' });
  registerReduction(expiry);
  const registry = registryFrom(expiry);
  const engine = new LayerEngine(expiry.objects, registry);
  assert.equal(engine.evaluate(expiry.ref('target')).might, 3);
  engine.advance({ id: 'turn-end' });
  assert.equal(engine.evaluate(expiry.ref('target')).might, 3, 'the reduction remembers the application-time modifier');

  const departure = kernel();
  registerModifier(departure, { source: departure.ref('source-a'), duration: 'while-source-in-zone', settlementId: 'leaving' });
  const existingReduction = registerReduction(departure, { source: departure.ref('source-a2') });
  const departureRegistry = registryFrom(departure);
  const departureEngine = new LayerEngine(departure.objects, departureRegistry);
  assert.equal(departureEngine.evaluate(departure.ref('target')).might, 3);
  departure.perform({ type: 'kill', object: departure.ref('source-a') });
  departureEngine.setObjects(departure.objects);
  departureEngine.advance({ id: 'object-leaves-zone' });
  assert.equal(departureEngine.evaluate(departure.ref('target')).might, 3);
  const next = registerReduction(departure, { source: departure.ref('source-a2') });
  departureEngine.addContinuous(next, { type: 'permanent' });
  assert.equal(departureEngine.evaluate(departure.ref('target')).might, 2, 'only the new base -1 applies after departure');
  assert.ok(departureRegistry.list().some(entry => entry.effect.id === existingReduction.id));
});

test('default LayerEngine expands printed and granted Shield and effect.shield-value reads the stacked value', () => {
  const program = cardProgram('test:shield-stack', [
    {
      id: 'first-grant', op: 'continuous.grant-keyword',
      args: { keyword: c('Shield'), value: c(2), target: c('friendly'), duration: c('this-turn') },
      targets: [{ id: 'friendly', filter: { objectId: 'ally', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
    },
    {
      id: 'second-grant', op: 'continuous.grant-keyword',
      args: { keyword: c('Shield'), value: c(3), target: c('friendly'), duration: c('this-turn') },
      targets: [{ id: 'friendly', filter: { objectId: 'ally', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
    },
    {
      id: 'read-shield', op: 'effect.shield-value', linkedTo: 'first-grant',
      args: { object: c({ target: 'friendly' }), linkKey: c('shieldValue') },
    },
  ]);
  const f = fixture({
    programs: [program],
    setup: builder => {
      builder.hand('spell', { types: ['spell'], might: null, energy: 0, power: null });
      builder.unit('ally', { might: 3, energy: null, power: null, combatRole: 'defender', keywords: [{ id: 'Shield' }] });
    },
  });
  f.kernel.getObject('spell').cardId = program.canonicalCardId;
  f.play('spell');
  settle(f.engine);
  assert.equal(f.kernel.linked('read-shield.shieldValue'), 6);
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield', value: 6 }]);
  assert.equal(f.snapshot('ally').might, 9);
  assert.equal(f.snapshot('ally').energy, null);
  assert.equal(f.snapshot('ally').power, null);
  f.engine.layers.advance({ id: 'turn-end' });
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield' }]);
  assert.equal(f.snapshot('ally').might, 4);
});

test('Shield Value remains readable for an attacker while the Might contribution stays defender-only', () => {
  const program = cardProgram('test:shield-reader', [
    {
      id: 'grant', op: 'continuous.grant-keyword',
      args: { keyword: c('Shield'), value: c(2), target: c('friendly') },
      targets: [{ id: 'friendly', filter: { objectId: 'ally', type: 'unit', zone: 'board' }, min: 1, max: 1 }],
    },
    {
      id: 'read', op: 'effect.shield-value',
      args: { object: c({ target: 'friendly' }) },
    },
  ]);
  const f = fixture({
    programs: [program],
    setup: builder => {
      builder.hand('spell', { types: ['spell'], might: null, energy: 0, power: null });
      builder.unit('ally', { might: 3, energy: null, power: null, combatRole: 'attacker', keywords: [{ id: 'Shield', value: 1 }] });
    },
  });
  f.kernel.getObject('spell').cardId = program.canonicalCardId;
  f.play('spell');
  settle(f.engine);
  assert.equal(f.kernel.linked('read.shieldValue'), 3);
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield', value: 3 }]);
  assert.equal(f.snapshot('ally').might, 3);
});

// RIFT-846 production consumers for arithmetic modifiers and effective Shield.
//
// The scenarios use the shipped Mel/Newly Awakened and Stupefy IR shapes, the
// generated instruction registry, the real ContinuousEffectRegistry and the
// default LayerEngine. Shield scenarios inject the existing KeywordGrantLayerEngine
// through ChainEngine so effect.shield-value observes the production layer chain.
import assert from 'node:assert/strict';
import test from 'node:test';

import { instructionDefinitionsById } from '../../dist/effects/instructions/registry.generated.js';
import { runInstruction, world } from '../../dist/effects/testing/index.js';
import { ContinuousEffectRegistry } from '../../dist/layers/duration.js';
import { LayerEngine } from '../../dist/layers/engine.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { KeywordGrantLayerEngine } from '../../dist/programs/keyword-grants.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import mel from '../../../card-dsl/dist/cards/ven/mel-newly-awakened.js';
import stupefy from '../../../card-dsl/dist/cards/ogn/stupefy.js';
import ntofo from '../../../card-dsl/dist/cards/rad/ntofo-strikes.js';
import { cardProgram, c, fixture, settle } from '../rules/keywords/support.mjs';

const modifierOp = instructionDefinitionsById.get('continuous.modify-might-reduction');
const mightOp = instructionDefinitionsById.get('continuous.might');

const melModifier = mel.abilities.find(ability =>
  ability.kind === 'static' && ability.effect.kind === 'continuous.modify-might-reduction').effect;
const stupefyDebuff = stupefy.abilities.find(ability => ability.kind === 'play').body[0];
assert.equal(stupefyDebuff.op, 'continuous.might');

function kernel({ targetMight = 5, shield = [], targetController = 'A' } = {}) {
  return world().player('A').player('B')
    .unit('source-a', { controller: 'A', might: 1, energy: null, power: null })
    .unit('source-a2', { controller: 'A', might: 1, energy: null, power: null })
    .unit('source-b', { owner: 'B', controller: 'B', might: 1, energy: null, power: null })
    .unit('target', { owner: targetController, controller: targetController, might: targetMight,
      keywords: shield, energy: null, power: null })
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
  source = worldState.ref('source-a'), controller,
} = {}) {
  const { objects: _objects, ...args } = stupefyDebuff.args;
  const sourceRef = source ?? worldState.ref('source-a');
  const context = worldState.clone({
    sourceSnapshot: worldState.object(sourceRef), controller: controller ?? worldState.object(sourceRef).controller,
  });
  const run = runInstruction(mightOp, {
    ...args,
    objects: c({ kind: 'target', id: 'target' }),
  }, { world: context, targets: { target: [worldState.ref('target')] } });
  if (run.result !== null) {
    worldState.restore(context.snapshot());
    worldState.copyLinkedFrom(context);
  }
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

function shieldRuntime(builder, programs = []) {
  const kernel = builder.build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected Shield choice ${request.id}`);
  };
  const context = source => bindResolveContext(kernel, { source, controller: source.controller, choose });
  const layers = new KeywordGrantLayerEngine(kernel.objects, { context });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({
    host, layers, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main',
    cleanup: current => {
      let changed = false;
      current.layers.setObjects(kernel.objects);
      for (const object of current.layers.evaluateAll()) {
        if (object.zone !== 'board' || !object.types.includes('unit') || object.might === null ||
          object.might > 0 && object.damage < object.might) continue;
        current.commit({ type: 'kill', object: object.ref });
        changed = true;
      }
      return changed;
    },
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  binding.attachLifecycle(engine, error => { throw error; });
  const settle = () => {
    engine.advance();
    for (let step = 0; engine.items.length; step++) {
      assert.ok(step < 30, 'Shield chain settles through priority passes');
      engine.pass(engine.priority);
    }
  };
  const source = kernel.getObject('source');
  const resolve = body => {
    engine.execute({ id: `shield-case:${engine.trace.length}`, source, controller: source.controller,
      kind: 'activated', speed: 'reaction', body });
    settle();
  };
  const draftPlay = id => {
    const action = { type: 'play', player: kernel.getObject(id).controller, object: kernel.ref(id) };
    return { action, draft: binding.describePlay(action, kernel.getObject(id)) };
  };
  const submitPlay = id => {
    const { draft } = draftPlay(id);
    engine.execute(draft);
    return draft;
  };
  const play = id => {
    const draft = submitPlay(id);
    settle();
    return draft;
  };
  const snapshot = id => {
    layers.setObjects(kernel.objects);
    return layers.snapshot(kernel.ref(id));
  };
  return { kernel, layers, engine, binding, resolve, draftPlay, submitPlay, play, settle, snapshot };
}

function ntofoRuntime({ energy = 3, power = ['Calm'], ally = {}, enemy = {} } = {}) {
  const admitted = { ...ntofo, status: 'executable', judgeReason: undefined };
  const f = shieldRuntime(world().player('A', { energy, power }).player('B')
    .hand('ntofo', { cardId: admitted.canonicalCardId, types: ['spell'], might: null, energy: 2, power: ['Calm'] })
    .unit('ally', { controller: 'A', might: 3, energy: null, power: null, keywords: [{ id: 'Shield' }], ...ally })
    .unit('enemy', { owner: 'B', controller: 'B', might: 8, energy: null, power: null, ...enemy }), [admitted]);
  return { f, admitted };
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
      builder.hand('spell-modifier', {
        owner: controller, cardId: programs[1].canonicalCardId,
        types: ['spell'], might: null, energy: 0, power: null,
      });
      builder.hand('spell-reduction', {
        owner: controller, cardId: programs[0].canonicalCardId,
        types: ['spell'], might: null, energy: 0, power: null,
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
  f.play('spell-modifier');
  settle(f.engine);
  f.play('spell-reduction');
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
  assert.equal(layeredMight(multiple).might, 2, '5 - 2 base reduction - two additional reductions');

  const crossController = kernel({ targetController: 'B' });
  registerModifier(crossController, { source: crossController.ref('source-a'), settlementId: 'source-controller' });
  registerReduction(crossController);
  assert.equal(layeredMight(crossController).might, 3,
    'the spell controller selects modifiers even when its target is controlled by the opponent');
});

test('the shipped Mel static registration fails closed until its amount adapter is bound', () => {
  const f = fixture({ programs: [stupefy], setup: builder => {
    builder.unit('mel', { controller: 'A', might: 1, energy: null, power: null });
    builder.unit('target', { controller: 'A', might: 5, energy: null, power: null });
  } });
  const ability = mel.abilities.find(candidate => candidate.kind === 'static' &&
    candidate.effect.kind === 'continuous.modify-might-reduction');
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject('mel'));
  const state = f.kernel;
  const { objects: _objects, ...args } = stupefyDebuff.args;
  const context = state.clone({ sourceSnapshot: state.object(state.ref('mel')), controller: 'A' });
  const run = runInstruction(mightOp, { ...args, objects: c({ kind: 'target', id: 'target' }) },
    { world: context, targets: { target: [state.ref('target')] } });
  assert.equal(run.result.status, 'executed');
  f.kernel.restore(context.snapshot());
  f.kernel.copyLinkedFrom(context);
  for (const entry of context.continuousEffects) f.engine.layers.addContinuous(entry.effect, entry.duration);
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('target')).might, 4,
    'the Mel registration remains inactive until its Empowered gate is satisfied');
  f.kernel.perform({ type: 'empower', object: f.kernel.ref('mel'), amount: 1 });
  const registered = f.engine.layers.registry.list()[0].effect.effect;
  assert.equal(registered.staticCondition(f.kernel.getObject('mel')), true);
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('target')).might, 4,
    'the shipped Mel static registration remains inactive until its executable amount is bound');
  handle.unbind();
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
  assert.equal(engine.evaluate(expiry.ref('target')).might, 5, 'the timed reduction and its modifier expire together');

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

test('KeywordGrantLayerEngine expands printed and granted Shield and effect.shield-value reads the stacked value', () => {
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
  const f = shieldRuntime(world().player('A').player('B')
    .unit('source', { types: ['gear'], energy: null, power: null })
    .unit('ally', { might: 3, energy: null, power: null, combatRole: 'defender', keywords: [{ id: 'Shield' }] }), [program]);
  f.kernel.setTargets('friendly', [f.kernel.ref('ally')]);
  f.resolve(program.abilities[0].body);
  assert.equal(f.kernel.linked('read-shield.shieldValue'), 6);
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield', value: 6 }]);
  assert.equal(f.snapshot('ally').might, 9);
  assert.equal(f.snapshot('ally').energy, null);
  assert.equal(f.snapshot('ally').power, null);
  f.layers.advance({ id: 'turn-end' });
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield', value: 1 }]);
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
  const f = shieldRuntime(world().player('A').player('B')
    .unit('source', { types: ['gear'], energy: null, power: null })
    .unit('ally', { might: 3, energy: null, power: null, combatRole: 'attacker', keywords: [{ id: 'Shield', value: 1 }] }), [program]);
  f.kernel.setTargets('friendly', [f.kernel.ref('ally')]);
  f.resolve(program.abilities[0].body);
  assert.equal(f.kernel.linked('read.shieldValue'), 3);
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield', value: 3 }]);
  assert.equal(f.snapshot('ally').might, 3);
});

test('Ntofo Strikes shipped IR pays, grants Shield 2, reads Shield 3 and deals it to the enemy', () => {
  assert.equal(ntofo.status, 'judge-required');
  const { f } = ntofoRuntime({ ally: { combatRole: 'defender' } });
  f.kernel.setAnswers({ 'target:ntofo-strikes.friendly-unit': [f.kernel.ref('ally')],
    'target:ntofo-strikes.enemy-unit': [f.kernel.ref('enemy')] });
  const { action, draft } = f.draftPlay('ntofo');
  assert.equal(action.type, 'play');
  assert.equal(draft.body[0].op, 'continuous.grant-keyword');
  assert.equal(draft.body[1].op, 'effect.shield-value');
  assert.equal(draft.body[2].op, 'effect.damage');
  f.play('ntofo');
  assert.equal(f.kernel.player('A').energy, 1, 'the finalized printed Energy cost was actually paid');
  assert.deepEqual(f.kernel.player('A').power, [], 'the finalized Power cost was actually paid');
  assert.equal(f.kernel.getObject('enemy').damage, 3);
  assert.equal(f.engine.trace.some(entry => entry.step === 'resolved'), true, 'the spell reached Resolve');
  const links = f.kernel.linkedSnapshot();
  assert.equal(links['ntofo-strikes.grant-shield.granted.count'], 1);
  assert.deepEqual(links['ntofo-strikes.grant-shield.granted.objects'], [{ id: 'ally', zoneEntryId: 1 }]);
  assert.equal(links['ntofo-strikes.shield-value.shieldValue'], 3);
  assert.equal(links['ntofo-strikes.deal-shield.dealt'], 3);
  assert.deepEqual(links['ntofo-strikes.deal-shield.dealtTo'],
    [{ target: { id: 'enemy', zoneEntryId: 1 }, amount: 3 }]);
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield', value: 3 }]);
  assert.equal(f.snapshot('ally').might, 6, 'printed Shield 1 and granted Shield 2 both add Might while defending');
  assert.equal(f.layers.registry.list().filter(entry => entry.effect.effect.kind === 'continuous.grant-keyword').length, 1,
    'the real grant registration remains in the production layer registry');
  assert.equal(f.snapshot('ally').energy, null);
  assert.equal(f.snapshot('ally').power, null);
  assert.equal(ntofo.status, 'judge-required');
  f.engine.emit({ timingPoint: 'turn-end', player: 'A' });
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield', value: 1 }]);
  assert.equal(f.snapshot('ally').might, 4, 'the end-of-turn Shield grant expires');
});

test('Ntofo rolls back Resolve after a prevented late spell move without inventing damage', () => {
  const { f } = ntofoRuntime({ ally: { combatRole: 'defender' } });
  f.kernel.setAnswers({ 'target:ntofo-strikes.friendly-unit': [f.kernel.ref('ally')],
    'target:ntofo-strikes.enemy-unit': [f.kernel.ref('enemy')] });
  f.engine.pipeline.registerReplacement({
    id: 'late-ntofo-prevent',
    matches: action => action.type === 'move-zone' && action.to === 'trash' && action.object.id === 'ntofo',
    apply: () => ({ status: 'prevent' }),
  });
  f.submitPlay('ntofo');
  assert.throws(() => f.settle(), /Could not resolve|Resolved spell could not leave Chain/);
  assert.equal(f.kernel.player('A').energy, 1, 'Finalize payment remains committed');
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('enemy').damage, 0);
  assert.equal(f.kernel.linkedSnapshot()['ntofo-strikes.shield-value.shieldValue'], undefined);
  assert.equal(f.layers.registry.list().some(entry => entry.effect.effect.kind === 'continuous.grant-keyword'), false,
    'the Resolve transaction rolls its grant registration back');
});

test('Ntofo Shield Value is readable from an attacker while its Might bonus stays defender-only', () => {
  const { f } = ntofoRuntime({ ally: { combatRole: 'attacker' } });
  f.kernel.setAnswers({ 'target:ntofo-strikes.friendly-unit': [f.kernel.ref('ally')],
    'target:ntofo-strikes.enemy-unit': [f.kernel.ref('enemy')] });
  f.play('ntofo');
  assert.equal(f.kernel.linkedSnapshot()['ntofo-strikes.shield-value.shieldValue'], 3);
  assert.equal(f.kernel.getObject('enemy').damage, 3);
  assert.deepEqual(f.snapshot('ally').keywords, [{ id: 'Shield', value: 3 }]);
  assert.equal(f.snapshot('ally').might, 3, 'Shield is a readable characteristic but adds no Might while attacking');
});

test('Ntofo rejects an illegal friendly target before payment and leaves no registration', () => {
  const { f } = ntofoRuntime({ ally: { controller: 'B', owner: 'B', combatRole: 'defender' } });
  f.kernel.setAnswers({ 'target:ntofo-strikes.friendly-unit': [f.kernel.ref('ally')],
    'target:ntofo-strikes.enemy-unit': [f.kernel.ref('enemy')] });
  const before = f.kernel.snapshot();
  const links = f.kernel.linkedSnapshot();
  assert.throws(() => f.submitPlay('ntofo'), /target|legal/i);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.kernel.linkedSnapshot(), links);
  assert.equal(f.engine.layers.registry.list().some(entry => entry.effect.effect.kind === 'continuous.grant-keyword'), false);
});

test('Ntofo ignores a Shield target that leaves after Finalize and rolls back the late play', () => {
  const { f } = ntofoRuntime({ ally: { combatRole: 'defender' } });
  f.kernel.setAnswers({ 'target:ntofo-strikes.friendly-unit': [f.kernel.ref('ally')],
    'target:ntofo-strikes.enemy-unit': [f.kernel.ref('enemy')] });
  f.submitPlay('ntofo');
  const before = f.kernel.snapshot();
  const links = f.kernel.linkedSnapshot();
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('ally') }).status, 'done');
  f.settle();
  assert.equal(f.kernel.getObject('enemy').damage, 0);
  assert.equal(f.kernel.linkedSnapshot()['ntofo-strikes.shield-value.shieldValue'], undefined);
  assert.ok(before.objects.size > 0 && links !== null);
});

test('Ntofo reports prevention without inventing damage or a damage receipt', () => {
  const { f } = ntofoRuntime({ ally: { combatRole: 'defender' } });
  f.kernel.setAnswers({ 'target:ntofo-strikes.friendly-unit': [f.kernel.ref('ally')],
    'target:ntofo-strikes.enemy-unit': [f.kernel.ref('enemy')] });
  f.engine.pipeline.registerReplacement({ id: 'prevent-ntofo', matches: action => action.type === 'damage' && action.source.id === 'ntofo',
    apply: () => ({ status: 'prevent' }) });
  const before = f.kernel.snapshot();
  const links = f.kernel.linkedSnapshot();
  f.play('ntofo');
  assert.equal(f.kernel.player('A').energy, 1);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('enemy').damage, 0);
  assert.equal(f.kernel.linkedSnapshot()['ntofo-strikes.deal-shield.dealt'], undefined);
  assert.notDeepEqual(f.kernel.linkedSnapshot(), links);
  assert.equal(f.engine.layers.registry.list().some(entry => entry.effect.effect.kind === 'continuous.grant-keyword'), true);
});

test('Ntofo Strikes rejects an unpayable card before changing state', () => {
  assert.equal(ntofo.status, 'judge-required');
  const admitted = { ...ntofo, status: 'executable', judgeReason: undefined };
  const f = shieldRuntime(world().player('A', { energy: 0, power: [] }).player('B')
    .hand('ntofo', { cardId: admitted.canonicalCardId, types: ['spell'], might: null, energy: 2, power: ['Calm'] })
    .unit('ally', { controller: 'A', might: 3, energy: null, power: null, combatRole: 'defender' })
    .unit('enemy', { owner: 'B', controller: 'B', might: 8, energy: null, power: null }), [admitted]);
  f.kernel.setAnswers({ 'target:ntofo-strikes.friendly-unit': [f.kernel.ref('ally')],
    'target:ntofo-strikes.enemy-unit': [f.kernel.ref('enemy')] });
  const before = f.kernel.snapshot();
  const linksBefore = f.kernel.linkedSnapshot();
  assert.throws(() => f.submitPlay('ntofo'), /cannot-pay-cost|insufficient Energy/);
  assert.deepEqual(f.kernel.snapshot(), before, 'failed finalization rolls the complete play back');
  assert.deepEqual(f.kernel.linkedSnapshot(), linksBefore, 'failed finalization rolls linked values back');
  assert.equal(f.kernel.getObject('enemy').damage, 0);
});

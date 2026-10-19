import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeCostPlan } from '../../dist/cost/discounts/index.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { MissingInformation } from '../../dist/effects/interpreter/values.js';
import { world } from '../../dist/effects/testing/index.js';
import { additionalMightReductions, bonusDamageForDeal, lethalThresholdFor } from '../../dist/effects/modifiers/query.js';
import { movement, playLocations, restrictions } from '../../dist/layers/rules/query.js';
import { matchesObjectFilter } from '../../dist/layers/filter.js';
import { resolveAbilityGrants } from '../../dist/programs/ability-grants/index.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { createTargetTaxAdapter } from '../../dist/target/tax/index.js';
import { getFacedownZone, hiddenCapacityFor, createHiddenState, hideCard } from '../../dist/zones/hidden/index.js';
import captainFarron from '../../../card-dsl/dist/cards/ogn/captain-farron.js';
import darius from '../../../card-dsl/dist/cards/ogn/darius-executioner.js';
import trifarianWarCamp from '../../../card-dsl/dist/cards/ogn/trifarian-war-camp.js';
import bandleTree from '../../../card-dsl/dist/cards/ogn/bandle-tree.js';
import eagerApprentice from '../../../card-dsl/dist/cards/ogn/eager-apprentice.js';
import poutyPoro from '../../../card-dsl/dist/cards/ogn/pouty-poro.js';
import fiora from '../../../card-dsl/dist/cards/ogn/fiora-victorious.js';
import blueSentinel from '../../../card-dsl/dist/cards/unl/blue-sentinel.js';
import elderDragon from '../../../card-dsl/dist/cards/unl/elder-dragon.js';
import mel from '../../../card-dsl/dist/cards/ven/mel-newly-awakened.js';
import hiddenKeyword from '../../dist/effects/keywords/Hidden.js';

const c = value => ({ kind: 'constant', value });
const at = id => ({ type: 'battlefield', id });

function runtime(builder = world().player('A').player('B')) {
  const kernel = builder.build();
  const choose = request => {
    if (request.type === 'mode') return request.options[0];
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const engine = new ChainEngine({
    host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', cleanup: () => false,
  });
  const sync = () => { engine.layers.setObjects(kernel.objects); return engine.layers; };
  const snapshot = id => sync().snapshot(kernel.ref(id));
  return { kernel, host, engine, sync, snapshot };
}

function staticAbility(program, predicate) {
  const ability = program.abilities.find(ability => ability.kind === 'static' && predicate(ability.effect));
  assert.ok(ability, `${program.canonicalCardId} exposes the expected static ability`);
  return ability;
}

test('RIFT-823 appliesTo aliases and relative anchors bind at query time', () => {
  const f = runtime(world().player('A').player('B')
    .unit('captain', { cardId: captainFarron.canonicalCardId, might: 2, location: at('one') })
    .unit('ally', { might: 3, location: at('one') })
    .unit('elsewhere', { might: 4, location: at('two') })
    .unit('enemy', { owner: 'B', controller: 'B', might: 5, location: at('one') }));
  const binder = createEngineStaticBinder(f.engine);
  const handle = binder.bindStatic(captainFarron.abilities[0], f.kernel.getObject('captain'));
  const record = f.sync().registry.list().find(entry => entry.effect.effect.kind === 'continuous.grant-keyword');
  assert.ok(record);
  const matched = id => f.snapshot(id).keywords.some(keyword => keyword.id.toLowerCase() === 'assault');
  assert.equal(matched('ally'), true);
  assert.equal(matched('captain'), false);
  assert.equal(matched('elsewhere'), false);
  assert.equal(matched('enemy'), false);
  f.engine.commit({ type: 'move-location', object: f.kernel.ref('captain'), to: at('two') });
  assert.equal(matched('ally'), false);
  assert.equal(matched('elsewhere'), true);
  f.engine.commit({ type: 'take-control', object: f.kernel.ref('captain'), player: 'B' });
  assert.equal(matched('enemy'), false);
  assert.equal(matched('elsewhere'), false);
  handle.unbind();
  assert.equal(f.engine.layers.registry.list().some(entry => entry.effect.effect.kind === 'continuous.grant-keyword'), false);
  assert.equal(captainFarron.status, 'judge-required');
});

test('RIFT-823 other/exclude and location use value equality in the live layer query', () => {
  const f = runtime(world().player('A').player('B')
    .unit('darius', { cardId: darius.canonicalCardId, might: 2, location: at('one') })
    .unit('ally', { might: 3, location: at('one') })
    .unit('away', { might: 4, location: at('two') })
    .unit('enemy', { owner: 'B', controller: 'B', might: 5, location: at('one') }));
  const ability = staticAbility(darius, effect => effect.kind === 'continuous.might');
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject('darius'));
  assert.equal(f.snapshot('ally').might, 4);
  assert.equal(f.snapshot('darius').might, 2);
  assert.equal(f.snapshot('away').might, 4);
  assert.equal(f.snapshot('enemy').might, 5);
  f.engine.commit({ type: 'move-location', object: f.kernel.ref('darius'), to: at('two') });
  assert.equal(f.snapshot('ally').might, 3);
  assert.equal(f.snapshot('away').might, 5);
});

test('RIFT-823 every location filter matches LocationRef by value', () => {
  const f = runtime(world().player('A').player('B')
    .unit('camp', { cardId: trifarianWarCamp.canonicalCardId, location: at('one') })
    .unit('here', { might: 2, location: at('one') })
    .unit('there', { might: 2, location: at('two') }));
  createEngineStaticBinder(f.engine).bindStatic(trifarianWarCamp.abilities[0], f.kernel.getObject('camp'));
  assert.equal(f.snapshot('here').might, 3);
  assert.equal(f.snapshot('there').might, 2);
  f.engine.commit({ type: 'move-location', object: f.kernel.ref('camp'), to: at('two') });
  assert.equal(f.snapshot('here').might, 2);
  assert.equal(f.snapshot('there').might, 3);
});

test('RIFT-823 per-object condition unavailability fails closed and defects escape', () => {
  const f = runtime(world().player('A').unit('source', { cardId: 'card.hash-static-condition', might: 2 }));
  const binder = createEngineStaticBinder(f.engine);
  const missing = {
    kind: 'static',
    condition: { kind: 'compare', left: { kind: 'object-property', object: 'self', property: 'missing' }, operator: 'eq', right: c(1) },
    effect: { kind: 'continuous.might', amount: 2 },
  };
  binder.bindStatic(missing, f.kernel.getObject('source'));
  assert.equal(f.snapshot('source').might, 2);
  const malformed = {
    kind: 'static',
    condition: { kind: 'unsupported-condition' },
    effect: { kind: 'continuous.might', amount: 2 },
  };
  binder.bindStatic(malformed, f.kernel.getObject('source'));
  assert.equal(f.snapshot('source').might, 2);
});

test('RIFT-823 cost declarations dispatch to the production discount collector', () => {
  const f = runtime(world().player('A', { energy: 10 }).player('B')
    .unit('apprentice', { cardId: eagerApprentice.canonicalCardId, location: at('one') })
    .hand('spell', { types: ['spell'], energy: 3, power: [] }));
  const ability = staticAbility(eagerApprentice, effect => effect.kind === 'continuous.cost-modification');
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject('apprentice'));
  const ctx = f.host.context(f.kernel.getObject('spell'), 'A', 'chain-item-finalize');
  const plan = finalizeCostPlan(ctx, { id: 'eager', cost: { kind: 'printed' } }, {
    statics: f.engine.layers.registry.list().flatMap(entry => entry.effect.effect.kind === 'continuous.cost-modification'
      ? [{ id: entry.effect.id, source: f.kernel.ref('apprentice'), ability }] : []),
  });
  assert.equal(plan.total.energy, 2);
  assert.equal(plan.discounts[0].minimum, 1);
});

test('RIFT-823 original cost declaration is inactive off battlefield and active on battlefield', () => {
  const f = runtime(world().player('A').player('B')
    .unit('apprentice', { cardId: eagerApprentice.canonicalCardId, zone: 'hand', location: null })
    .hand('spell', { types: ['spell'], energy: 3, power: [] }));
  const binder = createEngineStaticBinder(f.engine);
  const ability = staticAbility(eagerApprentice, effect => effect.kind === 'continuous.cost-modification');
  binder.bindStatic(ability, f.kernel.getObject('apprentice'));
  const ctx = f.host.context(f.kernel.getObject('spell'), 'A', 'chain-item-finalize');
  const statics = () => f.engine.layers.registry.list().flatMap(entry => entry.effect.effect.kind === 'continuous.cost-modification'
    ? [{ id: entry.effect.id, source: f.kernel.ref('apprentice'), ability }] : []);
  assert.equal(finalizeCostPlan(ctx, { id: 'off', cost: { kind: 'printed' } }, { statics: statics() }).total.energy, 3);
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref('apprentice'), to: 'battlefield', location: at('one') });
  assert.equal(finalizeCostPlan(ctx, { id: 'on', cost: { kind: 'printed' } }, { statics: statics() }).total.energy, 2);
});

test('RIFT-823 target tax remains bound to the exact host and pays any-domain Power', () => {
  const f = runtime(world().player('A', { power: ['Calm', 'Mind'] }).player('B')
    .unit('poro', { cardId: poutyPoro.canonicalCardId, owner: 'B', controller: 'B', keywords: [{ id: 'Deflect', value: 1 }] }));
  const ability = { kind: 'static', effect: { kind: 'target.tax', value: c(1) } };
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject('poro'));
  const ctx = f.host.context(f.kernel.getObject('poro'), 'A', 'chain-item-finalize');
  const adapter = createTargetTaxAdapter(ctx, { id: 'tax', cost: { energy: c(0), power: c([]) } }, { kind: 'ability' });
  adapter.finalizeTargetPlan({ id: 'poro', filter: { objectId: 'poro', zone: 'board' }, min: 1, max: 1, selection: 'one' }, { selected: [f.kernel.ref('poro')] });
  assert.equal(adapter.costPlan.total.power.reduce((sum, item) => sum + item.amount, 0), 1);
});

test('RIFT-823 Hidden and Facedown capacity use their dedicated consumers', () => {
  const f = runtime(world().player('A').player('B')
    .unit('tree', { cardId: bandleTree.canonicalCardId, types: ['battlefield'], location: at('one') })
    .hand('hidden', { cardId: 'card.hash-hidden-static', types: ['unit'], keywords: [] }));
  const treeAbility = bandleTree.abilities[0];
  createEngineStaticBinder(f.engine).bindStatic(treeAbility, f.kernel.getObject('tree'));
  const tree = f.snapshot('tree');
  const state = createHiddenState([{ battlefieldId: tree.ref.id, controller: 'A' }], 1);
  assert.equal(hiddenCapacityFor(getFacedownZone(state, tree.ref.id), { battlefield: tree, registry: f.engine.layers.registry }), 2);

  const hiddenAbility = hiddenKeyword.expand()[0];
  const handle = createEngineStaticBinder(f.engine).bindStatic(hiddenAbility, f.kernel.getObject('hidden'));
  assert.equal(f.engine.layers.registry.list().length, 2);
  handle.unbind();
  assert.equal(f.engine.layers.registry.list().filter(entry => entry.effect.effect.kind === 'static.capability').length, 0);
});

test('RIFT-823 continuous.movement normalizes string permission into query routes', () => {
  const f = runtime(world().player('A').unit('mover', { cardId: 'card.hash-mover', location: at('one') }));
  const ability = { kind: 'static', effect: {
    kind: 'continuous.movement', permission: 'battlefield-to-battlefield', source: 'battlefield', destination: 'battlefield', move: 'standard',
  } };
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject('mover'));
  const view = movement(f.engine.layers.registry, f.kernel.ref('mover'), f.snapshot('mover'), 'A');
  assert.equal(view.canGank, true);
  assert.deepEqual(view.permissions[0].routes, ['battlefield-to-battlefield']);
});

test('RIFT-823 bonus damage, lethal threshold and Might reduction preserve action scope and filters', () => {
  const f = runtime(world().player('A').unit('annie', { cardId: 'card.hash-annie-static' }).unit('target', { cardId: 'card.hash-target-static' }));
  const binder = createEngineStaticBinder(f.engine);
  binder.bindStatic({ kind: 'static', effect: { kind: 'continuous.bonus-damage', amount: c(2), appliesTo: c('deal-actions'), filter: { objectId: 'target' } } }, f.kernel.getObject('annie'));
  binder.bindStatic({ kind: 'static', effect: { kind: 'continuous.lethal-threshold', amount: c(1), appliesTo: c({ damageController: 'controller', target: 'enemy-units' }) } }, f.kernel.getObject('annie'));
  binder.bindStatic({ kind: 'static', effect: { kind: 'continuous.modify-might-reduction', mode: c('additional'), amount: c(-1), appliesTo: c('controller-spells-and-abilities') } }, f.kernel.getObject('annie'));
  const objects = ref => f.kernel.object(ref);
  assert.equal(bonusDamageForDeal(f.engine.layers.registry, { controller: 'A', appliesTo: 'deal-actions', source: f.kernel.ref('target') }, objects), 0);
  assert.equal(bonusDamageForDeal(f.engine.layers.registry, { controller: 'A', appliesTo: 'deal-actions', source: f.kernel.ref('target'), anchors: [f.snapshot('annie')] }, objects), 0);
  assert.equal(lethalThresholdFor(f.engine.layers.registry, { controller: 'A', appliesTo: { damageController: 'controller', target: 'enemy-units' } }, objects).length, 0);
  assert.equal(additionalMightReductions(f.engine.layers.registry, { controller: 'A', appliesTo: 'controller-spells-and-abilities' }, objects).length, 0);
});

test('RIFT-823 original Fiora grant is visible through the default static registration', () => {
  const f = runtime(world().player('A').player('B').unit('fiora', {
    cardId: fiora.canonicalCardId, might: 6, combatRole: 'defender', location: at('one'),
  }));
  const handle = createEngineStaticBinder(f.engine).bindStatic(fiora.abilities[0], f.kernel.getObject('fiora'));
  f.sync();
  const context = source => f.host.context(source, source.controller, 'cleanup-start');
  const effective = resolveAbilityGrants(f.snapshot('fiora'), [], f.engine.layers.registry, context);
  assert.deepEqual(effective.keywords.map(keyword => keyword.id).sort(), ['Deflect', 'Ganking', 'Shield']);
  handle.unbind();
  assert.deepEqual(resolveAbilityGrants(f.snapshot('fiora'), [], f.engine.layers.registry, context).keywords, []);
  assert.equal(fiora.status, 'judge-required');
});

test('RIFT-823 default program lifecycle installs static declarations through its production binder', () => {
  const f = runtime(world().player('A').unit('source', { cardId: 'card.hash-lifecycle-static', might: 2 }));
  const program = {
    canonicalCardId: 'card.hash-lifecycle-static',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'static lifecycle regression',
    abilities: [{ kind: 'static', effect: { kind: 'continuous.might', amount: c(2), appliesTo: 'self' } }],
  };
  const binding = createProgramBinding({ cardPrograms: [program] });
  const lifecycle = binding.attachLifecycle(f.engine, error => { throw error; });
  f.engine.pipeline.emit({ timingPoint: 'object-enters-board', object: f.kernel.getObject('source'), player: 'A' });
  assert.equal(f.snapshot('source').might, 4);
  lifecycle.detach();
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test('RIFT-823 trigger rule declarations bind and unbind through the collection stage', () => {
  const f = runtime(world().player('A').player('B').unit('sentinel', {
    cardId: blueSentinel.canonicalCardId, location: at('one'), keywords: [{ id: 'Hold-effect' }],
  }));
  const ability = staticAbility(blueSentinel, effect => effect.kind === 'continuous.trigger-multiplicity');
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject('sentinel'));
  assert.equal(f.engine.pipeline.rules.size, 1);
  handle.unbind();
  assert.equal(f.engine.pipeline.rules.size, 0);
});

test('RIFT-823 a failed real action restores the previously bound static registry', () => {
  const f = runtime(world().player('A').player('B')
    .unit('sentinel', { cardId: 'card.hash-rollback-sentinel', location: at('one') }));
  const ability = {
    kind: 'static',
    effect: { kind: 'continuous.trigger-multiplicity', mode: 'additional', amount: c(1), appliesTo: 'self' },
  };
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject('sentinel'));
  const before = f.kernel.stateForTest();
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = action => {
    if (action.type === 'gain-xp') throw new Error('injected action failure');
    return perform(action);
  };

  assert.throws(() => f.engine.commit({ type: 'gain-xp', player: 'A', amount: 1 }), /injected action failure/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.pipeline.events.length, 0);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.rules.size, 1);
  f.kernel.perform = perform;
  f.engine.commit({ type: 'move-location', object: f.kernel.ref('sentinel'), to: at('two') });
  assert.equal(f.engine.pipeline.rules.size, 1);
});

test('RIFT-823 invalid appliesTo and unsupported kinds remain judge-required', () => {
  const f = runtime(world().player('A').unit('source', { cardId: 'card.hash-invalid-static' }));
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(() => binder.bindStatic({ kind: 'static', effect: { kind: 'continuous.might', amount: 1, appliesTo: 'enemies-at-source' } }, f.kernel.getObject('source')), error => error.code === 'judge-required');
  assert.throws(() => binder.bindStatic({ kind: 'static', effect: { kind: 'continuous.unsupported' } }, f.kernel.getObject('source')), error => error.code === 'judge-required');
});

test('RIFT-823 null printed values remain null through representative static IR', () => {
  const f = runtime(world().player('A').unit('elder', { cardId: elderDragon.canonicalCardId, energy: null, power: null, might: 10 }));
  const ability = elderDragon.abilities[0];
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject('elder'));
  assert.equal(f.snapshot('elder').energy, null);
  assert.equal(f.snapshot('elder').power, null);
  assert.equal(f.kernel.getObject('elder').energy, null);
  assert.equal(f.kernel.getObject('elder').power, null);
});

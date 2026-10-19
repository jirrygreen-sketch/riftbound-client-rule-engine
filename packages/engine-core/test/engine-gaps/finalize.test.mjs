import assert from 'node:assert/strict';
import test from 'node:test';

import udyrWildman from '../../../card-dsl/dist/cards/ogn/udyr-wildman.js';
import vayneHunter from '../../../card-dsl/dist/cards/ogn/vayne-hunter.js';
import ironRevenant from '../../../card-dsl/dist/cards/rad/iron-revenant.js';
import sealOfRage from '../../../card-dsl/dist/cards/ogn/seal-of-rage.js';
import theHarrowing from '../../../card-dsl/dist/cards/ogn/the-harrowing.js';
import supernova from '../../../card-dsl/dist/cards/rad/supernova.js';
import smokeAndMirrors from '../../../card-dsl/dist/cards/unl/smoke-and-mirrors.js';
import bedevilingStranger from '../../../card-dsl/dist/cards/rad/bedeviling-stranger.js';
import overtOperation from '../../../card-dsl/dist/cards/ogn/overt-operation.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { activateReactionAddDuringPayment } from '../../dist/chain/finalize/add-window.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { triggerRegistrations } from '../../dist/programs/triggers.js';

const constant = value => ({ kind: 'constant', value });
const field = id => ({ type: 'battlefield', id });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function scene(builder, programs = [], answers = {}, hooks = {}) {
  const kernel = builder.build();
  const answerMap = new Map(Object.entries(answers));
  const asked = [];
  let engine;
  let binding;
  const choose = request => {
    asked.push(request);
    const injected = hooks.onChoose?.({ request, kernel, engine, binding });
    if (injected !== undefined) return structuredClone(injected.value);
    if (answerMap.has(request.id)) return structuredClone(answerMap.get(request.id));
    if (request.type === 'mode' && request.id.includes(':order:')) return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  return { kernel, host, binding, engine, answers: answerMap, asked };
}

function settle(engine) {
  engine.advance();
  let guard = 0;
  while (engine.items.length) {
    assert.ok(++guard < 20, 'chain must settle');
    engine.pass(engine.priority);
  }
}

test('original Udyr mode IR finalizes its mode and branch target once, then resolves through the default Chain', () => {
  const program = admitted(udyrWildman);
  const f = scene(
    world().player('A', { energy: 1 }).player('B')
      .unit('udyr', { cardId: program.canonicalCardId, buffs: 1, location: field('one') })
      .unit('enemy', { owner: 'B', might: 6, location: field('one') })
      .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' })
      .deck(['B:deck:1', 'B:deck:2'], { owner: 'B' }),
    [program],
    {
      'udyr.choose-mode/mode%3A0': 'udyr.damage-mode',
      'target:udyr.damage-target': [{ id: 'enemy', zoneEntryId: 1 }],
    },
  );

  f.engine.execute(f.binding.describeActivate(f.kernel.getObject('udyr'), 'A', 0));
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.deepEqual(f.asked.map(request => request.id), ['udyr.choose-mode/mode%3A0', 'target:udyr.damage-target']);
  assert.deepEqual(item.choicePlan.selectedModes.map(choice => choice.selected), [['udyr.damage-mode']]);
  assert.deepEqual(item.targetPlans.map(plan => plan.requirement.id), ['udyr.damage-target']);
  assert.deepEqual(item.targetPlans[0].selected, [f.kernel.ref('enemy')]);
  assert.equal(f.kernel.getObject('udyr').buffs, 0, 'the authored spend-buff cost was paid once');
  assert.equal(f.kernel.player('A').energy, 1);

  settle(f.engine);
  assert.equal(f.kernel.getObject('enemy').damage, 2);
  assert.equal(f.asked.length, 2, 'Resolve replays the frozen mode and target instead of asking again');
  assert.equal(udyrWildman.status, 'judge-required', 'the card program itself remains untouched');
});

test('mode choice rollback keeps earlier answers only across AwaitChoice, and a new item cannot reuse them', () => {
  const program = admitted(udyrWildman);
  const f = scene(
    world().player('A').player('B')
      .unit('udyr', { cardId: program.canonicalCardId, buffs: 1, location: field('one') })
      .unit('enemy', { owner: 'B', location: field('one') })
      .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }),
    [program],
    { 'udyr.choose-mode/mode%3A0': 'udyr.damage-mode' },
  );
  const draft = f.binding.describeActivate(f.kernel.getObject('udyr'), 'A', 0);
  assert.throws(
    () => f.engine.execute(draft),
    error => error instanceof AwaitChoice && error.request.id === 'target:udyr.damage-target',
  );
  assert.equal(f.engine.items.length, 0, 'an incomplete Finalize commits no item');
  assert.equal(f.kernel.getObject('udyr').buffs, 1, 'the cost is not paid before all choices/targets are frozen');

  f.answers.set('target:udyr.damage-target', [f.kernel.ref('enemy')]);
  f.engine.execute(draft);
  const ids = f.asked.map(request => request.id);
  assert.equal(ids.filter(id => id === 'udyr.choose-mode/mode%3A0').length, 1, 'the retry of the same Finalize reuses its mode answer');
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.kernel.getObject('udyr').buffs, 0);

  settle(f.engine);
  const beforeNewItem = f.asked.filter(request => request.id === 'udyr.choose-mode/mode%3A0').length;
  const source = f.kernel.getObject('udyr');
  f.kernel.addObject({ ...source, buffs: 1 }, 'board');
  f.answers.set('target:udyr.damage-target', [f.kernel.ref('enemy')]);
  f.engine.execute(f.binding.describeActivate(f.kernel.getObject('udyr'), 'A', 0));
  assert.equal(
    f.asked.filter(request => request.id === 'udyr.choose-mode/mode%3A0').length,
    beforeNewItem + 1,
    'a new chain item does not borrow the prior item\'s Finalize answers',
  );
});

test('original Vayne optional trigger and target finalize atomically and preserve its unresolved trigger facts', () => {
  const program = admitted(vayneHunter);
  const f = scene(
    world().player('A', { energy: 2 }).player('B')
      .unit('vayne', { cardId: program.canonicalCardId, location: field('one') }),
    [program],
    { 'finalize:trigger:1:optional': true },
  );
  const [registration] = triggerRegistrations(f.binding.registry, f.kernel.getObject('vayne'));
  assert.ok(registration);
  f.engine.pipeline.registerTrigger(registration);
  f.engine.emit({ timingPoint: 'conquer', object: f.kernel.getObject('vayne'), player: 'A' });
  assert.equal(f.engine.items.length, 1);
  const triggerEvent = f.engine.items[0].trigger.event;
  f.engine.advance();
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.equal(item.trigger.event.eventId, triggerEvent.eventId);
  assert.equal(item.trigger.event.timingPoint, 'conquer');
  assert.deepEqual(f.asked.map(request => request.id), ['finalize:trigger:1:optional', 'target:vayne-hunter.self']);
  assert.equal(f.kernel.player('A').energy, 1, 'the leading optional cost is settled during Finalize');
  assert.deepEqual(item.targetPlans[0].selected, [f.kernel.getObject('vayne').ref]);
});

test('original Iron Revenant cost choice locks once, pays through the default Chain, and cannot replay its receipt', () => {
  const program = {
    ...admitted(ironRevenant),
    // The card's resource-use restriction is a separate known blocker. This
    // scenario exercises the authored cost fragment without weakening it.
    abilities: ironRevenant.abilities.map(ability => ability.kind === 'activated'
      ? (({ restriction: _restriction, ...rest }) => rest)(ability)
      : ability),
  };
  const f = scene(
    world().player('A').player('B')
      .unit('source', { cardId: program.canonicalCardId, types: ['gear'], energy: null, power: null })
      .card('victim', { zone: 'trash', types: ['gear'] }),
    [program],
  );
  // RIFT-855 correctly keeps this incomplete Universal-Add program
  // judge-required at the default activation adapter. Preserve that admission
  // gate while exercising the authored non-target cost fragment through the
  // Chain by drafting from the same source and frozen cost declaration.
  const source = f.kernel.getObject('source');
  const ability = ironRevenant.abilities[0];
  const draft = {
    id: 'iron-revenant-cost-probe', controller: 'A', source, kind: 'activated', speed: 'normal',
    body: ability.body,
    cost: { id: 'cost:iron-revenant-cost-probe', cost: ability.cost },
  };
  f.engine.execute(draft);
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.deepEqual(f.asked.map(request => request.id), [`${item.costInput.id}:pick:iron-revenant.banished-card`]);
  assert.deepEqual(item.costInput.costChoices.locks.map(lock => lock.choiceId), ['iron-revenant.banished-card']);
  assert.deepEqual(item.payment.choices.map(choice => choice.id), ['iron-revenant.banished-card']);
  assert.equal(f.kernel.getObject('victim').zone, 'banishment');
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(f.kernel.player('A').energy, 0, 'null printed Energy was not coerced to a charge');

  const asksBefore = f.asked.length;
  settle(f.engine);
  assert.equal(f.asked.length, asksBefore, 'Resolve does not reopen the Finalize cost choice');
  assert.equal(f.kernel.getObject('victim').zone, 'banishment', 'the paid object is not consumed a second time');
  assert.equal(ironRevenant.status, 'judge-required');
});

test('a multi-choice cost keeps earlier Finalize answers across AwaitChoice and pays only after all locks', () => {
  const f = scene(
    world().player('A', { energy: 1 }).player('B')
      .hand('source', { types: ['spell'], energy: 0, power: [] })
      .hand('first', { types: ['gear'] })
      .hand('other-gear', { types: ['gear'] })
      .hand('second', { types: ['unit'] })
      .hand('other-unit', { types: ['unit'] }),
    [],
    { 'cost:multi-cost:pick:first-choice': [{ id: 'first', zoneEntryId: 1 }] },
  );
  const firstChoice = {
    id: 'first-choice', options: ['placeholder'],
    filter: { zone: 'hand', type: 'gear', owner: 'controller' }, min: 1, max: 1,
  };
  const secondChoice = {
    id: 'second-choice', options: ['placeholder'],
    filter: { zone: 'hand', type: 'unit', owner: 'controller' }, min: 1, max: 1,
  };
  const draft = {
    id: 'multi-cost', controller: 'A', source: f.kernel.getObject('source'), kind: 'spell', speed: 'normal', body: [],
    cost: { id: 'cost:multi-cost', cost: { energy: constant(1), payments: [
      { kind: 'discard', choice: firstChoice },
      { kind: 'discard', choice: secondChoice },
    ] } },
  };

  assert.throws(
    () => f.engine.execute(draft),
    error => error instanceof AwaitChoice && error.request.id === 'cost:multi-cost:pick:second-choice',
  );
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.player('A').energy, 1, 'no part of a multi-action cost is paid before all choices lock');
  assert.equal(f.kernel.getObject('first').zone, 'hand');
  assert.equal(f.asked.filter(request => request.id === 'cost:multi-cost:pick:first-choice').length, 1);

  f.answers.set('cost:multi-cost:pick:second-choice', [f.kernel.ref('second')]);
  f.engine.execute(draft);
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.equal(f.asked.filter(request => request.id === 'cost:multi-cost:pick:first-choice').length, 1,
    'retry reuses the first locked answer instead of asking again');
  assert.deepEqual(item.costInput.costChoices.locks.map(lock => lock.choiceId), ['first-choice', 'second-choice']);
  assert.deepEqual(item.payment.choices.map(choice => choice.id), ['first-choice', 'second-choice']);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.getObject('first').zone, 'trash');
  assert.equal(f.kernel.getObject('second').zone, 'trash');
});

test('trigger event:it consumes the immutable event.it snapshot with no target/source fallback', () => {
  const f = scene(
    world().player('A').player('B')
      .unit('source', { location: field('one') })
      .unit('event-unit', { exhausted: true, location: field('one') }),
  );
  f.engine.pipeline.registerTrigger({
    id: 'event-it', source: f.kernel.getObject('source'), controller: 'A',
    spec: { at: 'buff-added', filter: { event: 'buff-added' } },
    body: [{ id: 'xp', op: 'effect.xp', args: { amount: constant(1) }, condition: { kind: 'event-it', object: 'it' } }],
  });
  f.engine.pipeline.emit({ timingPoint: 'buff-added', object: f.kernel.getObject('source'), source: f.kernel.getObject('source'), it: f.kernel.getObject('event-unit'), player: 'A' });
  const trigger = f.engine.items[0].trigger;
  assert.deepEqual(trigger.event.it.ref, f.kernel.ref('event-unit'));
  f.engine.advance(); f.engine.pass('A'); f.engine.pass('B');
  assert.equal(f.kernel.player('A').xp, 1);

  const missing = scene(world().player('A').player('B').unit('source', { location: field('one') }));
  missing.engine.pipeline.registerTrigger({
    id: 'missing-it', source: missing.kernel.getObject('source'), controller: 'A',
    spec: { at: 'buff-added', filter: { event: 'buff-added' } },
    body: [{ id: 'xp', op: 'effect.xp', args: { amount: constant(1) }, condition: { kind: 'event-it', object: 'it' } }],
  });
  missing.engine.pipeline.emit({ timingPoint: 'buff-added', object: missing.kernel.getObject('source'), source: missing.kernel.getObject('source'), player: 'A' });
  missing.engine.advance(); missing.engine.pass('A'); missing.engine.pass('B');
  assert.equal(missing.kernel.player('A').xp, 0);
});

test('contractActions.perform routes a batch through commitContract and emits both kills in one scan', () => {
  const f = scene(world().player('A').player('B')
    .unit('source', { types: ['spell'], energy: 0, power: [] })
    .unit('observer', { location: field('one') })
    .unit('first', { owner: 'B' }).unit('second', { owner: 'B' }));
  const observed = [];
  const killedObjects = [];
  f.engine.pipeline.registerTrigger({
    id: 'death', source: f.kernel.getObject('observer'), controller: 'A',
    spec: { at: 'object-killed', filter: { event: 'object-killed' }, once: 'per-batch' }, body: [],
  });
  f.engine.pipeline.onEvent = event => { if (event.timingPoint === 'object-killed' && event.object) killedObjects.push(event.object.ref.id); };
  f.engine.pipeline.onTrigger = snapshot => { observed.push(snapshot); };
  const draft = {
    id: 'contract-batch', controller: 'A', source: f.kernel.getObject('source'), kind: 'spell', speed: 'normal',
    cost: { id: 'free', cost: { energy: constant(0) } },
    body: [{
      id: 'perform-batch', op: 'effect.xp', args: { amount: constant(1) },
    }],
  };
  f.engine.execute(draft);
  f.engine.pass('A');
  settle(f.engine);
  // The resolved context is rebuilt with the same capability; exercise the
  // production route directly at the pipeline boundary used by the context.
  const outcome = f.engine.pipeline.commitContract({ type: 'batch', transactionId: 'contract-wave', actions: [
    { type: 'kill', object: f.kernel.ref('first') }, { type: 'kill', object: f.kernel.ref('second') },
  ] });
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.receipt.status, 'committed');
  assert.deepEqual(killedObjects.sort(), ['first', 'second']);
  assert.ok(observed.length >= 1, 'commitContract publishes the batch through the trigger scan');
  assert.ok(observed.every(snapshot => snapshot.batchId === 'contract-wave'), 'the scans retain the one batch identity');
  assert.equal(f.kernel.getObject('first').zone, 'trash');
  assert.equal(f.kernel.getObject('second').zone, 'trash');
});

test('original Smoke and Mirrors relation consumes the first finalized target in the default Chain', () => {
  const play = smokeAndMirrors.abilities.find(ability => ability.kind === 'play');
  const program = { ...admitted(smokeAndMirrors), abilities: [play] };
  const f = scene(
    world().player('A').player('B')
      .hand('spell', { cardId: program.canonicalCardId, types: ['spell'], energy: 0, power: [] })
      .unit('one', { cardId: program.canonicalCardId, location: field('one') })
      .unit('two', { cardId: program.canonicalCardId, location: field('two') }),
    [program],
    { 'target:smoke-and-mirrors.unit-a': [{ id: 'one', zoneEntryId: 1 }] },
  );

  f.engine.execute(f.binding.describePlay(
    { type: 'play', player: 'A', object: f.kernel.ref('spell') },
    f.kernel.getObject('spell'),
  ));
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.targetPlans.map(plan => plan.selected), [
    [f.kernel.ref('one')],
    [f.kernel.ref('two')],
  ]);
  assert.deepEqual(f.asked.map(request => request.id), [
    'target:smoke-and-mirrors.unit-a',
    'target:smoke-and-mirrors.unit-b',
  ]);
  assert.equal(smokeAndMirrors.status, 'judge-required');
});

test('original Seal of Rage Add resolves inside the parent payment through the default Chain', () => {
  let receipt;
  const f = scene(
    world().player('A', { power: ['Fury'] }).player('B')
      .base('source', { cardId: sealOfRage.canonicalCardId, types: ['gear'], energy: null, power: null })
      .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }),
    [sealOfRage],
    {},
    { onChoose: ({ request, kernel, engine, binding }) => {
      if (request.id !== 'cost:parent:base') return undefined;
      receipt = activateReactionAddDuringPayment({
        engine,
        registry: binding.registry,
        source: kernel.getObject('source'),
        controller: 'A',
      });
      return { value: 'normal' };
    } },
  );
  const source = f.kernel.getObject('source');
  f.engine.execute({
    id: 'parent', controller: 'A', source, kind: 'activated', speed: 'normal', body: [],
    cost: {
      id: 'cost:parent',
      cost: { power: constant(['Fury']) },
      baseChoices: [{ id: 'normal', cost: { power: constant(['Fury']) } }],
    },
  });

  assert.equal(receipt.status, 'resolved');
  assert.deepEqual(receipt.resources, { energy: 0, power: ['Fury'] });
  assert.equal(f.kernel.getObject('source').exhausted, true);
  settle(f.engine);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.equal(f.engine.trace.some(event => event.item === receipt.itemId && event.step === 'priority-granted'), false);
});

test('original Harrowing IR creates and settles a nested Play chain item through the default Chain', () => {
  const harrowingPlay = theHarrowing.abilities.find(ability => ability.kind === 'play');
  const harrowing = { ...admitted(theHarrowing), abilities: [harrowingPlay] };
  const unit = admitted(supernova);
  const f = scene(
    world().player('A', { energy: 30, power: ['Chaos', 'Chaos', 'Order'] }).player('B')
      .hand('spell', { cardId: harrowing.canonicalCardId, types: ['spell'], energy: 6, power: ['Chaos'] })
      .card('unit', { cardId: unit.canonicalCardId, types: ['unit'], zone: 'trash', energy: 9, power: ['Order'] })
      .unit('victim', { owner: 'B', might: 20 })
      .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }),
    [harrowing, unit],
    {
      'target:the-harrowing.unit': [{ id: 'unit', zoneEntryId: 1 }],
      'target:supernova.target-unit': [{ id: 'victim', zoneEntryId: 1 }],
    },
  );

  f.engine.execute(f.binding.describePlay(
    { type: 'play', player: 'A', object: f.kernel.ref('spell') },
    f.kernel.getObject('spell'),
  ));
  settle(f.engine);

  assert.equal(f.kernel.getObject('unit').zone, 'board');
  assert.equal(f.kernel.getObject('spell').zone, 'trash');
  assert.equal(f.kernel.player('A').energy, 24);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.engine.trace.filter(entry => entry.step === 'pending').length, 2);
  assert.equal(theHarrowing.status, 'judge-required');
});

test('original optional-body target finalizes once, resolves through the default Chain, and revalidates its incarnation', () => {
  const program = admitted(bedevilingStranger);
  const f = scene(
    world().player('A').player('B')
      .unit('source', { cardId: program.canonicalCardId, location: field('one') })
      .unit('enemy', { owner: 'B', location: field('one') })
      .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }),
    [program],
    {
      'bedeviling-stranger.may-return/optional': true,
      'target:bedeviling-stranger.enemy-unit-there': [{ id: 'enemy', zoneEntryId: 1 }],
      'bedeviling-stranger.choose-battlefield/location%3Abedeviling-stranger.chosen-battlefield': field('one'),
    },
  );
  const [registration] = triggerRegistrations(f.binding.registry, f.kernel.getObject('source'));
  f.engine.pipeline.registerTrigger(registration);
  f.engine.emit({ timingPoint: 'card-played', object: f.kernel.getObject('source'), source: f.kernel.getObject('source'), player: 'A' });
  f.engine.advance();
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.choicePlan.optionalChoices.map(choice => choice.accepted), [true]);
  assert.deepEqual(item.targetPlans.map(plan => plan.selected), [[f.kernel.ref('enemy')]]);
  assert.deepEqual(f.asked.map(request => request.id), [
    'bedeviling-stranger.may-return/optional',
    'target:bedeviling-stranger.enemy-unit-there',
  ]);

  f.engine.pass('A'); f.engine.pass('B');
  assert.equal(f.kernel.getObject('enemy').zone, 'hand');
  assert.equal(f.asked.length, 3, 'Resolve replays the optional decision and frozen target instead of selecting again');
  assert.equal(bedevilingStranger.status, 'judge-required', 'the source program and its Hidden gap remain untouched');
});

test('declined original optional body locks no nested target and never performs its effect', () => {
  const program = admitted(bedevilingStranger);
  const f = scene(
    world().player('A').player('B')
      .unit('source', { cardId: program.canonicalCardId, location: field('one') })
      .unit('enemy', { owner: 'B', location: field('one') }),
    [program],
    {
      'bedeviling-stranger.may-return/optional': false,
      'bedeviling-stranger.choose-battlefield/location%3Abedeviling-stranger.chosen-battlefield': field('one'),
    },
  );
  const [registration] = triggerRegistrations(f.binding.registry, f.kernel.getObject('source'));
  f.engine.pipeline.registerTrigger(registration);
  f.engine.emit({ timingPoint: 'card-played', object: f.kernel.getObject('source'), source: f.kernel.getObject('source'), player: 'A' });
  f.engine.advance();
  const [item] = f.engine.items;
  assert.equal(item.choicePlan.status, 'finalized');
  assert.deepEqual(item.choicePlan.optionalChoices.map(choice => choice.accepted), [false]);
  assert.deepEqual(item.targetPlans, []);
  assert.deepEqual(f.asked.map(request => request.id), ['bedeviling-stranger.may-return/optional']);
  f.engine.pass('A'); f.engine.pass('B');
  assert.equal(f.kernel.getObject('enemy').zone, 'board');
  assert.deepEqual(f.asked.map(request => request.id), [
    'bedeviling-stranger.may-return/optional',
    'bedeviling-stranger.choose-battlefield/location%3Abedeviling-stranger.chosen-battlefield',
  ]);
});

test('a selected optional target that changes incarnation is ignored and the finalized body rolls back', () => {
  const program = admitted(bedevilingStranger);
  const f = scene(
    world().player('A').player('B')
      .unit('source', { cardId: program.canonicalCardId, location: field('one') })
      .unit('enemy', { owner: 'B', location: field('one') }),
    [program],
    {
      'bedeviling-stranger.may-return/optional': true,
      'target:bedeviling-stranger.enemy-unit-there': [{ id: 'enemy', zoneEntryId: 1 }],
      'bedeviling-stranger.choose-battlefield/location%3Abedeviling-stranger.chosen-battlefield': field('one'),
    },
  );
  const [registration] = triggerRegistrations(f.binding.registry, f.kernel.getObject('source'));
  f.engine.pipeline.registerTrigger(registration);
  f.engine.emit({ timingPoint: 'card-played', object: f.kernel.getObject('source'), source: f.kernel.getObject('source'), player: 'A' });
  f.engine.advance();
  const before = f.kernel.getObject('enemy');
  f.kernel.addObject({ ...before, ref: { id: 'enemy', zoneEntryId: 2 } }, 'board');
  f.engine.pass('A'); f.engine.pass('B');
  assert.equal(f.kernel.getObject('enemy').zone, 'board');
  assert.equal(f.kernel.getObject('enemy').ref.zoneEntryId, 2);
});

test('an illegal optional-body target answer rolls back Finalize before any item or cost is committed', () => {
  const program = admitted(bedevilingStranger);
  const f = scene(
    world().player('A').player('B')
      .unit('source', { cardId: program.canonicalCardId, location: field('one') })
      .unit('enemy', { owner: 'B', location: field('one') }),
    [program],
    {
      'bedeviling-stranger.may-return/optional': true,
      'target:bedeviling-stranger.enemy-unit-there': [{ id: 'enemy', zoneEntryId: 999 }],
    },
  );
  const [registration] = triggerRegistrations(f.binding.registry, f.kernel.getObject('source'));
  f.engine.pipeline.registerTrigger(registration);
  f.engine.emit({ timingPoint: 'card-played', object: f.kernel.getObject('source'), source: f.kernel.getObject('source'), player: 'A' });
  assert.throws(() => f.engine.advance(), /illegal target/i);
  assert.equal(f.engine.items[0].status, 'pending');
  assert.equal(f.engine.items[0].targetPlans.length, 0);
  assert.equal(f.kernel.getObject('enemy').zone, 'board');
  assert.equal(f.kernel.getObject('enemy').ref.zoneEntryId, 1);
});

test('original repeat-with-target IR remains precisely blocked without an instruction-and-iteration scope', () => {
  const play = overtOperation.abilities.find(ability => ability.kind === 'play');
  const f = scene(
    world().player('A').player('B')
      .hand('source', { types: ['spell'], energy: 0, power: [] }),
    [],
  );
  assert.throws(
    () => f.engine.execute({
      id: 'repeat-target-probe', controller: 'A', source: f.kernel.getObject('source'), kind: 'spell', speed: 'normal',
      cost: { id: 'free', cost: { energy: constant(0) } }, body: play.body,
    }),
    error => error.status === 'blocked' && /instruction-and-iteration target lifecycle adapter/.test(error.message),
  );
  assert.equal(f.engine.items.length, 0);
  assert.equal(overtOperation.status, 'judge-required');
});

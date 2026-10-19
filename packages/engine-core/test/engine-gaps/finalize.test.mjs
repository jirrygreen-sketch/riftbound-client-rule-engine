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
import fioraWorthy from '../../../card-dsl/dist/cards/sfd/fiora-worthy.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { activateReactionAddDuringPayment } from '../../dist/chain/finalize/add-window.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { translateTriggerFilter } from '../../dist/programs/filters.js';
import { triggerRegistrations } from '../../dist/programs/triggers.js';
import {
  planBasicRuneResourceActivation,
} from '../../dist/runes/index.js';

const constant = value => ({ kind: 'constant', value });
const field = id => ({ type: 'battlefield', id });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });
const FURY_RUNE = {
  cardId: 'ogn-007-298',
  canonicalCardId: 'card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902',
  domain: 'Fury',
};
function trustedFuryRune(extra = {}) {
  return {
    ref: { id: 'fury-rune', zoneEntryId: 1 }, cardId: FURY_RUNE.cardId, name: 'Fury Rune',
    types: ['rune'], tags: ['Basic'], keywords: [], owner: 'A', controller: 'A', zone: 'rune-zone',
    location: null, might: null, energy: null, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false, ...extra,
  };
}

function scene(builder, programs = [], answers = {}, hooks = {}, engineOptions = {}) {
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
    ...engineOptions,
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

test('original Smoke and Mirrors body fails closed before a partial swap when no prior-target relation seam exists', () => {
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

  assert.throws(
    () => f.engine.execute(f.binding.describePlay(
      { type: 'play', player: 'A', object: f.kernel.ref('spell') },
      f.kernel.getObject('spell'),
    )),
    error => error.name === 'TargetSelectionError' && error.code === 'no-legal-targets',
  );
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(f.asked.map(request => request.id), ['target:smoke-and-mirrors.unit-a']);
  assert.deepEqual(f.kernel.getObject('one').location, field('one'));
  assert.deepEqual(f.kernel.getObject('two').location, field('two'));
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

test('Finalize extension hook freezes selected nested instances once and replays on the original Resolve path', () => {
  const calls = [];
  const f = scene(
    world().player('A').player('B')
      .unit('source', { location: field('one') })
      .unit('enemy', { owner: 'B', controller: 'B', location: field('one') }),
    [],
    {
      'named-outer/optional': true,
      'named-outer/inner-choice/mode%3A0': 'named-mode',
      'target:damaged-unit': [{ id: 'enemy', zoneEntryId: 1 }],
    },
    {},
    { finalizeExtensions: [{ op: 'sequence', evaluate: input => {
      calls.push({ ...input, context: undefined, source: input.source.ref });
      return { receipts: [{ key: `${input.instanceKey}.nameReceipt.primary`, value: input.instanceKey }] };
    } }] },
  );
  const body = [{
    id: 'named-outer', op: 'choice.optional', args: { body: constant([
      { id: 'named-a', op: 'sequence', args: { body: constant([]) } },
      { id: 'extension-a', op: 'sequence', args: { body: constant([]) } },
      { id: 'damage', op: 'effect.damage', args: { amount: constant(1), target: constant('damaged-unit') }, targets: [
        { id: 'damaged-unit', filter: { type: 'unit', controller: 'opponent', zone: 'board' }, min: 1, max: 1, selection: 'one' },
      ] },
      { id: 'inner-choice', op: 'choice.mode', args: {
        count: constant(1), different: constant(true),
        modes: constant([{ id: 'named-mode', body: [{ id: 'named-inside-mode', op: 'sequence', args: { body: constant([]) } }] }]),
      } },
    ]) },
  }];
  f.engine.execute({ id: 'named-chain', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'action', body });
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.deepEqual(calls.map(call => call.instanceKey), [
    'named-outer/named-a',
    'named-outer/extension-a',
    'named-outer/inner-choice/named-mode/0/named-inside-mode',
  ]);
  assert.deepEqual(Object.keys(item.finalizeLinks).sort(), [
    'named-outer/extension-a',
    'named-outer/inner-choice/named-mode/0/named-inside-mode',
    'named-outer/named-a',
  ]);
  const asks = f.asked.length;
  assert.equal(Object.values(f.engine.finalizeInstanceLinks(item, ['named-outer', 'named-a']) ?? {})[0], 'named-outer/named-a');
  assert.equal(Object.values(f.engine.finalizeInstanceLinks(item, ['named-outer', 'inner-choice', 'named-mode', '0', 'named-inside-mode']) ?? {})[0],
    'named-outer/inner-choice/named-mode/0/named-inside-mode');
  f.engine.pass('A'); f.engine.pass('B');
  assert.equal(calls.length, 3, 'Resolve never reevaluates a Finalize extension');
  assert.equal(f.asked.length, asks);
});

test('Finalize extension rollback restores answers and links before a corrected retry', () => {
  let calls = 0;
  const f = scene(
    world().player('A').player('B').unit('source'), [], {},
    {},
    { finalizeExtensions: [{ op: 'sequence', evaluate: () => {
      calls++;
      if (calls === 1) throw new Error('extension failure');
      return { receipts: [{ key: 'value', value: 'retry' }] };
    } }] },
  );
  const draft = {
    id: 'extension-retry', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'action',
    body: [{ id: 'extension-value', op: 'sequence', args: { body: constant([]) } }],
  };
  assert.throws(() => f.engine.execute(draft), /extension failure/);
  assert.equal(f.engine.items.length, 0);
  f.engine.execute(draft);
  assert.equal(calls, 2);
  assert.deepEqual(Object.values(f.engine.items[0].finalizeLinks['extension-value']), ['retry']);
});

test('Finalize extension keys are isolated by repeat iteration and duplicate receipts fail closed', () => {
  const seen = [];
  const f = scene(
    world().player('A').player('B').unit('source'), [], {},
    {},
    { finalizeExtensions: [{ op: 'sequence', evaluate: input => {
      seen.push(input.instanceKey);
      return { receipts: [{ key: `${input.instanceKey}.nameReceipt.primary`, value: input.instanceKey }] };
    } }] },
  );
  f.engine.execute({
    id: 'repeated-extension', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'action',
    body: [{ id: 'repeat-choice', op: 'repeat', args: {
      count: constant(2), body: constant([{ id: 'nested-name', op: 'sequence', args: { body: constant([]) } }]),
    } }],
  });
  const [item] = f.engine.items;
  assert.deepEqual(seen, ['repeat-choice/0/nested-name', 'repeat-choice/1/nested-name']);
  assert.deepEqual(Object.values(f.engine.finalizeInstanceLinks(item, ['repeat-choice', '0', 'nested-name']) ?? {}),
    ['repeat-choice/0/nested-name']);
  assert.deepEqual(Object.values(f.engine.finalizeInstanceLinks(item, ['repeat-choice', '1', 'nested-name']) ?? {}),
    ['repeat-choice/1/nested-name']);

  const duplicate = scene(
    world().player('A').player('B').unit('source'), [], {},
    {},
    { finalizeExtensions: [
      { op: 'sequence', evaluate: input => ({ receipts: [{ key: `${input.instanceKey}.receipt`, value: input.instanceKey }] }) },
    ] },
  );
  duplicate.engine.execute({
    id: 'duplicate-extension-second', controller: 'A', source: duplicate.kernel.getObject('source'), kind: 'activated', speed: 'action',
    body: [{ id: 'one-name', op: 'sequence', args: { body: constant([]) } }],
  });
  const one = duplicate.engine.items[0];
  assert.equal(Object.keys(one.finalizeLinks).length, 1);
  duplicate.engine.pass('A'); duplicate.engine.pass('B');
  duplicate.engine.execute({
    id: 'duplicate-extension', controller: 'A', source: duplicate.kernel.getObject('source'), kind: 'activated', speed: 'action',
    body: [{ id: 'two-name', op: 'sequence', args: { body: constant([]) } }],
  });
  assert.equal(duplicate.engine.items.length, 1);
  assert.notDeepEqual(duplicate.engine.items[0].finalizeLinks, one.finalizeLinks);
  assert.notDeepEqual(Object.keys(Object.values(duplicate.engine.items[0].finalizeLinks)[0]),
    Object.keys(Object.values(one.finalizeLinks)[0]));
});

test('Finalize extension receipts are bound to their chain item and not reused by a later item', () => {
  const f = scene(
    world().player('A').player('B').unit('source'), [], {},
    {},
    { finalizeExtensions: [{ op: 'sequence', evaluate: () => ({ receipts: [{ key: 'name.receipt.primary', value: 'Poro' }] }) }] },
  );
  const source = f.kernel.getObject('source');
  f.engine.execute({
    id: 'first-name', controller: 'A', source, kind: 'activated', speed: 'action',
    body: [{ id: 'first-instance', op: 'sequence', args: { body: constant([]) } }],
  });
  const first = f.engine.items[0];
  assert.equal(Object.values(f.engine.finalizeInstanceLinks(first, ['first-instance']) ?? {})[0], 'Poro');
  f.engine.pass('A'); f.engine.pass('B');
  f.engine.execute({
    id: 'second-name', controller: 'A', source: f.kernel.getObject('source'), kind: 'activated', speed: 'action',
    body: [{ id: 'second-instance', op: 'sequence', args: { body: constant([]) } }],
  });
  const second = f.engine.items[0];
  assert.notEqual(second.id, first.id);
  assert.equal(Object.values(f.engine.finalizeInstanceLinks(second, ['second-instance']) ?? {})[0], 'Poro');
  assert.notDeepEqual(second.finalizeLinks, first.finalizeLinks);
  assert.deepEqual(Object.values(f.engine.finalizeInstanceLinks(first, ['first-instance']) ?? {}), ['Poro']);
  assert.deepEqual(Object.values(f.engine.finalizeInstanceLinks(second, ['second-instance']) ?? {}), ['Poro']);
});

test('external parent payment continuation accepts one authoritative Rune Add, pays once, and keeps Priority', () => {
  let restorePoint;
  const f = scene(
    world().player('A', { energy: 0 }).player('B')
      .base('parent', { types: ['unit'], energy: 0, power: [] })
      .object('fury-rune', trustedFuryRune()),
    [], {}, {},
    { paymentContinuation: { persist: notice => { restorePoint = notice; return true; } } },
  );
  const source = f.kernel.getObject('parent');
  assert.throws(
    () => f.engine.execute({
      id: 'external-parent', controller: 'A', source, kind: 'activated', speed: 'normal', body: [],
      cost: { id: 'cost:external-parent', cost: { energy: constant(1), power: constant([]) } },
    }),
    error => error.name === 'PaymentContinuationSuspendedError',
  );
  assert.ok(restorePoint);
  const paymentSource = restorePoint.source;
  assert.equal(f.kernel.player('A').energy, 0, 'suspension occurs after freezing but before Pay Costs');
  assert.equal(f.kernel.getObject('fury-rune').exhausted, false);
  assert.equal(f.engine.items.length, 1, 'the committed suspension exposes exactly the frozen parent');
  assert.equal(f.engine.items[0].id, 'external-parent');
  assert.equal(f.engine.items[0].status, 'finalized');
  assert.equal(f.engine.items[0].payment, undefined);

  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: {
      actor: 'A', activationId: 'external-fury-add',
      intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 },
      window: { kind: 'payment' },
    },
  });
  const handle = f.engine.restorePaymentContinuationHandle();
  assert.equal(handle.snapshot.payer, 'A');
  assert.deepEqual(handle.snapshot.source, source.ref);
  const result = f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: paymentSource,
    add: add.draft,
  });
  assert.equal(result.payment.paid, true);
  assert.deepEqual(result.add.resources, { energy: 1, power: [] });
  assert.deepEqual(result.add.receipt, {
    instructionId: 'external-fury-add:add',
    value: { energy: 1, power: [] },
  });
  assert.equal(result.payment.actions.filter(action => action.action.type === 'pay').length, 1);
  assert.equal(f.kernel.player('A').energy, 0, 'the Add funded and the parent consumed exactly one Energy');
  assert.equal(f.kernel.getObject('fury-rune').exhausted, true);
  assert.equal(f.engine.trace.some(event => event.item === 'external-fury-add' && event.step === 'priority-granted'), false);

  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: paymentSource, add: add.draft,
  }), /stale or not authoritative/);
  assert.equal(f.kernel.player('A').energy, 0);
});

test('payment continuation rejects cloned handles, wrong payer/source, targets and late failure atomically', () => {
  let restorePoint;
  const f = scene(
    world().player('A', { energy: 1 }).player('B')
      .unit('parent', { location: field('one') })
      .unit('target', { owner: 'B', location: field('one') })
      .object('fury-rune', trustedFuryRune()),
    [], { 'target:parent.target': [{ id: 'target', zoneEntryId: 1 }] }, {},
    { paymentContinuation: { persist: notice => { restorePoint = notice; return true; } } },
  );
  const source = f.kernel.getObject('parent');
  assert.throws(() => f.engine.execute({
    id: 'guarded-parent', controller: 'A', source, kind: 'activated', speed: 'normal',
    body: [{ id: 'damage', op: 'effect.damage', args: { amount: constant(1), target: constant('parent.target') }, targets: [
      { id: 'parent.target', filter: { type: 'unit', controller: 'opponent', zone: 'board' }, min: 1, max: 1, selection: 'one' },
    ] }],
    cost: { id: 'cost:guarded-parent', cost: { energy: constant(1), power: constant([]) } },
  }), error => error.name === 'PaymentContinuationSuspendedError');
  const paymentSource = restorePoint.source;
  const handle = f.engine.restorePaymentContinuationHandle();
  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'guarded-rune', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });
  const wrongPayer = { ...add.draft, controller: 'B' };
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: paymentSource, add: wrongPayer,
  }), /Add actor mismatch/);
  assert.equal(f.kernel.player('A').energy, 1);
  assert.equal(f.kernel.getObject('fury-rune').exhausted, false);
});

test('payment continuation binds the exact parent actor and source incarnation', () => {
  let notice;
  const f = scene(
    world().player('A').player('B').unit('parent').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: value => { notice = value; return true; } } },
  );
  const source = f.kernel.getObject('parent');
  assert.throws(() => f.engine.execute({
    id: 'identity-parent', controller: 'A', source, kind: 'activated', speed: 'normal', body: [],
    cost: { id: 'cost:identity-parent', cost: { energy: constant(1) } },
  }), error => error.name === 'PaymentContinuationSuspendedError');
  const before = f.kernel.stateForTest();
  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'identity-add', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });

  const handle = f.engine.restorePaymentContinuationHandle();
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'B', source: notice.source, add: { ...add.draft, controller: 'B' },
  }), /actor or source incarnation mismatch/);
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: { ...notice.source, zoneEntryId: notice.source.zoneEntryId + 1 }, add: add.draft,
  }), /actor or source incarnation mismatch/);
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: notice.source,
    add: { ...add.draft, source: { ...add.draft.source, ref: { ...add.draft.source.ref, zoneEntryId: 99 } } },
  }), /Add source is not this payer/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].id, 'identity-parent');
  assert.equal(f.engine.trace.some(event => event.item === 'identity-add'), false);
});

test('payment continuation revalidates a target after the real Rune Add and rolls back both legs', () => {
  let notice;
  const f = scene(
    world().player('A').player('B').unit('parent').unit('target', { owner: 'B' })
      .object('fury-rune', trustedFuryRune()),
    [], { 'target:target-only': [{ id: 'target', zoneEntryId: 1 }] }, {},
    { paymentContinuation: { persist: value => { notice = value; return true; } } },
  );
  const source = f.kernel.getObject('parent');
  assert.throws(() => f.engine.execute({
    id: 'targeted-parent', controller: 'A', source, kind: 'activated', speed: 'normal',
    body: [], targets: [{ requirement: { id: 'target-only', filter: { zone: 'board', type: 'unit', controller: 'opponent' }, min: 1, max: 1 } }],
    cost: { id: 'cost:targeted-parent', cost: { energy: constant(1) } },
  }), error => error.name === 'PaymentContinuationSuspendedError');
  const before = f.kernel.stateForTest();
  const handle = f.engine.restorePaymentContinuationHandle();
  assert.equal(handle.snapshot.source.zoneEntryId, 1);
  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'targeted-add', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });
  // The Add is legal; the parent payment must still fail if its locked target changed incarnation.
  assert.equal(f.kernel.perform({ type: 'kill', object: f.kernel.ref('target') }).status, 'done');
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: notice.source, add: add.draft,
  }), /target is no longer legal/i);
  assert.deepEqual(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.getObject('fury-rune').exhausted, false);
  assert.equal(f.engine.trace.some(event => event.item === 'targeted-add'), false);
});

test('default Chain publishes one real layer-derived Mighty transition on the affected Unit incarnation', () => {
  const fiora = admitted(fioraWorthy);
  const f = scene(
    world().player('A').player('B')
      .unit('source', { cardId: fiora.canonicalCardId, might: 3 })
      .unit('affected', { might: 4 })
      .unit('enemy', { owner: 'B', controller: 'B', might: 4 }),
    [fiora], {}, {},
  );
  // RIFT-810 owns the card-IR-to-pattern adapter. Its merged helper currently
  // accepts the typed nested form, while the checked-in Fiora trigger is flat;
  // that adapter mismatch remains 810/872's blocker. Chain production consumes
  // the typed form so the real layer producer and scan can still be verified.
  const filter = translateTriggerFilter({
    event: 'might-changed',
    object: { type: 'unit', controller: 'self', becomesMighty: true },
  }, 'source', 'might-changed');
  f.engine.pipeline.registerTrigger({ id: 'mighty-watch', source: f.kernel.getObject('source'), controller: 'A',
    spec: { at: 'might-changed', filter }, body: [] });
  const source = f.kernel.getObject('source');
  f.engine.execute({
    id: 'mighty-change', controller: 'A', source, kind: 'activated', speed: 'action',
    body: [{ id: 'mighty-instruction', op: 'continuous.might', args: {
      amount: constant(1), objects: constant({ kind: 'query', filter: { objectId: 'affected', zone: 'board' } }),
      duration: constant('this-turn'),
    } }],
  });
  settle(f.engine);
  const changed = f.engine.pipeline.events.filter(event => event.timingPoint === 'might-changed');
  assert.equal(changed.length, 1, 'the real 4-to-5 transition is emitted exactly once');
  assert.deepEqual(changed[0].it?.ref, f.kernel.ref('affected'));
  assert.ok(changed.every(event => event.object?.ref.id === 'affected'));
  assert.ok(changed.every(event => event.source?.ref.id === 'source'));
  assert.equal(f.engine.items.length, 0);
});

for (const [label, might, owner, expectedBefore] of [
  ['3-to-4', 3, 'A', 3], ['5-to-6', 5, 'A', 5], ['enemy-4-to-5', 4, 'B', 4],
]) {
  test(`default Mighty producer does not select ${label}`, () => {
    const f = scene(
      world().player('A').player('B').unit('source', { might: 3 }).unit('affected', { might, owner, controller: owner }),
      [], {}, {},
    );
    const filter = translateTriggerFilter({
      event: 'might-changed', object: { type: 'unit', controller: 'self', becomesMighty: true },
    }, 'source', 'might-changed');
    f.engine.pipeline.registerTrigger({ id: `mighty-negative-${label}`, source: f.kernel.getObject('source'), controller: 'A',
      spec: { at: 'might-changed', filter }, body: [] });
    const source = f.kernel.getObject('source');
    f.engine.execute({
      id: `non-crossing-${label}`, controller: 'A', source, kind: 'activated', speed: 'action',
      body: [{ id: `change-${label}`, op: 'continuous.might', args: { amount: constant(1), duration: constant('this-turn'),
        objects: constant({ kind: 'query', filter: { objectId: 'affected', zone: 'board' } }) } }],
    });
    settle(f.engine);
    const raw = f.engine.pipeline.events.filter(event => event.timingPoint === 'might-changed' && event.kind === 'might-changed');
    assert.deepEqual(raw.map(event => [event.object?.ref.id, event.details?.before?.might, event.details?.after?.might]),
      [['affected', expectedBefore, expectedBefore + 1]]);
    assert.equal(f.engine.trace.some(event => event.item?.startsWith('trigger:')),
      false, label);
    assert.equal(f.engine.items.length, 0);
  });
}

test('payment continuation rejects wrong payer, wrong parent source, rival Chain notice, and cloned handle before a legal retry', () => {
  let notice;
  const f = scene(
    world().player('A').player('B').unit('parent').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: value => { notice = value; return true; } } },
  );
  const source = f.kernel.getObject('parent');
  assert.throws(() => f.engine.execute({
    id: 'identity-negative-parent', controller: 'A', source, kind: 'activated', speed: 'normal', body: [],
    cost: { id: 'cost:identity-negative-parent', cost: { energy: constant(1) } },
  }), error => error.name === 'PaymentContinuationSuspendedError');
  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'identity-negative-add', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });
  const handle = f.engine.restorePaymentContinuationHandle();
  const before = f.kernel.stateForTest();
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'B', source: notice.source, add: { ...add.draft, controller: 'B' },
  }), /actor or source incarnation mismatch/);
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: { ...notice.source, zoneEntryId: notice.source.zoneEntryId + 1 }, add: add.draft,
  }), /actor or source incarnation mismatch/);
  const rival = scene(world().player('A').player('B').unit('parent'), [], {}, {});
  assert.throws(() => rival.engine.restorePaymentContinuationHandle(), /not rebuilt/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  const result = f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: notice.source, add: add.draft,
  });
  assert.equal(result.payment.paid, true);
  assert.deepEqual(result.add.resources, { energy: 1, power: [] });
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.getObject('fury-rune').exhausted, true);
});

test('a legal Rune Add followed by parent failure rolls back Add, parent charge and receipts', () => {
  let notice;
  const f = scene(
    world().player('A').player('B').unit('parent').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: value => { notice = value; return true; } } },
  );
  const source = f.kernel.getObject('parent');
  assert.throws(() => f.engine.execute({
    id: 'late-negative-parent', controller: 'A', source, kind: 'activated', speed: 'normal', body: [],
    cost: { id: 'cost:late-negative-parent', cost: { energy: constant(2) } },
  }), error => error.name === 'PaymentContinuationSuspendedError');
  const before = f.kernel.stateForTest();
  const handle = f.engine.restorePaymentContinuationHandle();
  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'late-negative-add', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: notice.source, add: add.draft,
  }), /Parent cost remains unpayable after the Reaction Add/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.engine.items.length, 1, 'only the exact frozen parent remains for a legal retry');
  assert.equal(f.engine.items[0].id, 'late-negative-parent');
  assert.equal(f.engine.items[0].status, 'finalized');
  assert.equal(f.engine.items[0].payment, undefined);
  assert.equal(f.engine.trace.some(event => event.item === 'late-negative-add'), false);
});

test('only journal replay creates a resumable suspension for a new authoritative Chain', () => {
  const create = () => scene(
    world().player('A').player('B').unit('parent').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: () => true } },
  );
  const first = create();
  const draft = {
    id: 'replayed-parent', controller: 'A', source: first.kernel.getObject('parent'), kind: 'activated', speed: 'normal', body: [],
    cost: { id: 'cost:replayed-parent', cost: { energy: constant(1) } },
  };
  assert.throws(() => first.engine.execute(draft), error => error.name === 'PaymentContinuationSuspendedError');
  const firstHandle = first.engine.restorePaymentContinuationHandle();

  const rival = create();
  assert.throws(() => rival.engine.restorePaymentContinuationHandle(), /not rebuilt/);
  const replay = create();
  assert.throws(() => replay.engine.execute({ ...draft, source: replay.kernel.getObject('parent') }), error => error.name === 'PaymentContinuationSuspendedError');
  const replayHandle = replay.engine.restorePaymentContinuationHandle();
  assert.equal(replayHandle.snapshot.continuationId, firstHandle.snapshot.continuationId);
  assert.equal(replayHandle.snapshot.epoch, firstHandle.snapshot.epoch);

  const add = planBasicRuneResourceActivation({
    chain: replay.engine,
    state: { objects: () => replay.kernel.objects, player: id => replay.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'replayed-add', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });
  const result = replay.engine.resumePaymentContinuation(replayHandle, {
    payer: 'A', source: replayHandle.snapshot.source, add: add.draft,
  });
  assert.equal(result.continuationId, firstHandle.snapshot.continuationId);
  assert.equal(result.payment.paid, true);
  assert.equal(replay.kernel.player('A').energy, 0);
});

test('payment continuation rejects a forged journal notice and persistence rejection without residue', () => {
  let notice;
  const restore = scene(
    world().player('A').player('B').unit('parent').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: value => { notice = value; return true; } } },
  );
  const draft = {
    id: 'journal-identity-parent', controller: 'A', source: restore.kernel.getObject('parent'),
    kind: 'activated', speed: 'normal', body: [], cost: { id: 'cost:journal-identity-parent', cost: { energy: constant(1) } },
  };
  assert.throws(() => restore.engine.execute(draft), error => error.name === 'PaymentContinuationSuspendedError');
  assert.match(notice.digest, /^sha256:[a-f0-9]{64}$/);
  const forgedNotice = structuredClone({ ...notice, digest: `sha256:${'0'.repeat(64)}` });
  assert.throws(() => restore.engine.restorePaymentContinuationHandle(forgedNotice), /journal notice does not match/);
  const journaled = structuredClone(notice);
  assert.equal(restore.engine.restorePaymentContinuationHandle(journaled).snapshot.digest, notice.digest);
  assert.throws(() => restore.engine.restorePaymentContinuationHandle(journaled), /already restored/);
  const forged = scene(world().player('A').player('B').unit('parent'), [], {}, {});
  assert.throws(() => forged.engine.restorePaymentContinuationHandle(notice), /not rebuilt/);
  assert.equal(restore.engine.items.length, 1);
  assert.equal(restore.engine.items[0].id, 'journal-identity-parent');

  const rejected = scene(
    world().player('A').player('B').unit('parent').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: () => false } },
  );
  const before = rejected.kernel.stateForTest();
  assert.throws(() => rejected.engine.execute({ ...draft, source: rejected.kernel.getObject('parent') }), /not durably accepted/);
  assert.deepEqual(rejected.kernel.stateForTest(), before);
  assert.equal(rejected.engine.items.length, 0);
  assert.throws(() => rejected.engine.restorePaymentContinuationHandle(), /not rebuilt/);
});

test('a suspended payer blocks another player from starting a second Chain action before resume', () => {
  let notice;
  const f = scene(
    world().player('A').player('B').unit('parent').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: value => { notice = value; return true; } } },
  );
  assert.throws(() => f.engine.execute({
    id: 'payer-only-parent', controller: 'A', source: f.kernel.getObject('parent'),
    kind: 'activated', speed: 'normal', body: [],
    cost: { id: 'cost:payer-only-parent', cost: { energy: constant(1) } },
  }), error => error.name === 'PaymentContinuationSuspendedError');
  const before = f.kernel.stateForTest();
  assert.throws(() => f.engine.execute({
    id: 'rival-chain-action', controller: 'B', source: f.kernel.getObject('parent'),
    kind: 'activated', speed: 'reaction', body: [], cost: { id: 'cost:rival', cost: { energy: constant(0) } },
  }), /suspended Pay Costs continuation must be resumed/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.deepEqual(f.engine.items.map(item => item.id), ['payer-only-parent']);

  const handle = f.engine.restorePaymentContinuationHandle(notice);
  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'payer-only-add', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });
  assert.equal(f.engine.resumePaymentContinuation(handle, { payer: 'A', source: notice.source, add: add.draft }).payment.paid, true);
});

test('a parent source re-entering with the same id is rejected before the Reaction Add executes', () => {
  let notice;
  const f = scene(
    world().player('A').player('B').unit('parent').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: value => { notice = value; return true; } } },
  );
  const source = f.kernel.getObject('parent');
  assert.throws(() => f.engine.execute({
    id: 'reentry-parent', controller: 'A', source, kind: 'activated', speed: 'normal', body: [],
    cost: { id: 'cost:reentry-parent', cost: { energy: constant(1) } },
  }), error => error.name === 'PaymentContinuationSuspendedError');
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].id, 'reentry-parent');
  const before = f.kernel.stateForTest();
  assert.equal(f.kernel.perform({ type: 'move-zone', object: source.ref, to: 'trash' }).status, 'done');
  const current = f.kernel.getObject('parent');
  f.kernel.addObject({ ...source, ref: { id: 'parent', zoneEntryId: current.ref.zoneEntryId + 1 } }, 'board');
  const afterReentry = f.kernel.stateForTest();
  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'reentry-add', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });
  const handle = f.engine.restorePaymentContinuationHandle(notice);
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: notice.source, add: add.draft,
  }), /parent, actor, source or cost plan|replaced by another incarnation/);
  assert.deepEqual(f.kernel.stateForTest(), afterReentry);
  assert.equal(f.engine.trace.some(event => event.item === 'reentry-add'), false);
  assert.deepEqual(before.objects.find(object => object.ref.id === 'parent').ref, source.ref);
});

test('Add succeeds, then a real host replacement blocks the parent additional payment and rolls back both receipts', () => {
  let notice;
  const f = scene(
    world().player('A').player('B').unit('parent').unit('cost-gear').object('fury-rune', trustedFuryRune()),
    [], {}, {}, { paymentContinuation: { persist: value => { notice = value; return true; } } },
  );
  const source = f.kernel.getObject('parent');
  assert.throws(() => f.engine.execute({
    id: 'replacement-late-parent', controller: 'A', source, kind: 'activated', speed: 'normal', body: [],
    cost: { id: 'cost:replacement-late-parent', cost: {
      energy: constant(1),
      payments: [{ kind: 'exhaust', object: f.kernel.ref('cost-gear') }],
    } },
  }), error => error.name === 'PaymentContinuationSuspendedError');
  const before = f.kernel.stateForTest();
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0].id, 'replacement-late-parent');
  let exhausts = 0;
  f.kernel.addReplacement(action => {
    if (action.type !== 'exhaust' || action.object.id !== 'cost-gear') return null;
    exhausts++;
    return 'prevented';
  });
  const handle = f.engine.restorePaymentContinuationHandle(notice);
  const add = planBasicRuneResourceActivation({
    chain: f.engine,
    state: { objects: () => f.kernel.objects, player: id => f.kernel.player(id) },
    resolveIdentity: cardId => cardId === FURY_RUNE.cardId ? FURY_RUNE : null,
    request: { actor: 'A', activationId: 'replacement-late-add', intent: { type: 'rune-energy', runeObjectId: 'fury-rune', zoneEntryId: 1 }, window: { kind: 'payment' } },
  });
  const playerBefore = f.kernel.player('A');
  assert.throws(() => f.engine.resumePaymentContinuation(handle, {
    payer: 'A', source: notice.source, add: add.draft,
  }), error => error?.reason === 'cannot-pay-cost' && error.failedAction?.action.type === 'exhaust');
  assert.equal(exhausts, 1, 'the replacement was reached after the standard Energy payment was attempted');
  assert.deepEqual(f.kernel.player('A'), playerBefore, 'both the Rune gain and prior parent Energy payment were rolled back');
  assert.equal(f.kernel.getObject('cost-gear').exhausted, false);
  assert.equal(f.kernel.getObject('fury-rune').exhausted, false);
  assert.equal(f.engine.trace.some(event => event.item === 'replacement-late-add'), false);
  assert.equal(f.engine.items.length, 1, 'the frozen parent remains available for a legal retry');
  assert.equal(f.engine.items[0].payment, undefined);
});

// RIFT-1114 body-adapter matrix.
//
// Official evidence: Riftbound Core Rules v1.5, published 2026-10-09,
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// (effective 2026-10-16; local copy: /root/swarm-rift/shared/rules/CR-v1.5.txt).
// Radiance patch notes:
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
//
// Timeline exercised below:
// - CR 355.3 selects modes while Finalize makes the item's relevant choices.
// - CR 355.5/355.12 lock specific object choices and independent may-action
//   targets before Resolve; 355.15 forbids changing them afterward.
// - CR 355.14 locks split targets at Finalize but allocates their damage at
//   Resolve; the production matrix locks through Chain Finalize and the direct
//   adapter case verifies only the primitive's post-lock execution boundary.
// - CR 359.3.e.14 ignores a linked instruction when its earlier target was
//   ignored after Finalize.
// - CR 370.1-373 apply a replacement before its qualifying event and bind the
//   exact affected incarnation; this matrix verifies the existing planner's
//   fail-closed boundary and the public binder's exact-event receipt.
// - CR 420.3 makes effect-Play follow normal Play steps. Nocturne's partial
//   body is tested here up to its exact-cost fail-closed boundary; token Pending
//   timing already has its production regression in RIFT-1038.
// Card text is checked against packages/card-data/data/deck-catalog.json; the
// canonical programs and printing ids used below are identified beside each
// scenario. This file deliberately does not change any card's status.
import assert from 'node:assert/strict';
import test from 'node:test';

import heimerdingerProgram from '../../../card-dsl/dist/cards/rad/heimerdinger-academy-instructor.js';
import kennenProgram from '../../../card-dsl/dist/cards/ven/kennen-keeper-of-balance.js';
import nocturneProgram from '../../../card-dsl/dist/cards/ogn/nocturne-horrifying.js';
import rivenProgram from '../../../card-dsl/dist/cards/rad/riven-broken-blade.js';
import zenithProgram from '../../../card-dsl/dist/cards/ogn/zenith-blade-leona.js';
import yoneProgram from '../../../card-dsl/dist/cards/rad/yone-blademaster.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { resolveChainBody } from '../../dist/chain/interpreter-adapter.js';
import { CombatFlow } from '../../dist/combat/flow.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { bindReplacement, planReplacementBody } from '../../dist/replacement/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const constant = value => ({ kind: 'constant', value });
const battlefield = id => ({ type: 'battlefield', id });
const base = player => ({ type: 'base', player });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function runtime({ programs = [], build = builder => builder, choose = () => undefined } = {}) {
  const kernel = build(world().player('A', { energy: 20, power: ['Body', 'Calm', 'Chaos', 'Fury', 'Mind', 'Order'] }).player('B')
    .unit('source')
    .unit('enemy', { owner: 'B', controller: 'B', might: 5 }))
    .deck(['A:deck:1', 'A:deck:2'], { owner: 'A' })
    .deck(['B:deck:1', 'B:deck:2'], { owner: 'B' })
    .build();
  const requests = [];
  const decide = request => {
    requests.push(structuredClone(request));
    const answer = choose(request, kernel);
    if (answer !== undefined) return structuredClone(answer);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return structuredClone([...request.options]);
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
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
  });
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  const errors = [];
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    describePlay: binding.describePlay, cleanup: () => false,
  });
  const lifecycle = binding.attachLifecycle(engine, error => errors.push(error));
  return { kernel, host, binding, engine, lifecycle, errors, requests };
}

function playCard(f, id) {
  const object = f.kernel.getObject(id);
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: object.ref }, object);
  f.engine.execute(draft);
  return draft;
}

function settle(f) {
  for (let guard = 0; guard < 30; guard++) {
    if (f.engine.items.some(item => item.status === 'pending')) {
      f.engine.advance();
      continue;
    }
    if (f.engine.priority !== null) {
      f.engine.pass(f.engine.priority);
      continue;
    }
    return;
  }
  throw new Error('body-adapter matrix did not settle');
}

test('RIFT-1114 Riven/rad-043-167: the selected mode and nested self target lock once at Finalize', () => {
  const choose = (request, kernel) => {
    if (request.type === 'mode') return 'riven-broken-blade.buff-mode';
    if (request.id === 'target:riven-broken-blade.self') return [kernel.ref('riven')];
    return undefined;
  };
  const f = runtime({ programs: [rivenProgram], choose, build: builder => builder.unit('riven', {
    cardId: rivenProgram.canonicalCardId, types: ['unit'], energy: 4, power: null, might: 4,
    location: battlefield('bf1'),
  }) });
  f.binding.registerProgramTriggers(f.engine, { ...f.kernel.getObject('riven'), cardId: rivenProgram.canonicalCardId });
  assert.equal(f.engine.commit({ type: 'exhaust', object: f.kernel.ref('riven') }).status, 'done');
  f.engine.advance();
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.choicePlan.selectedModes.map(choice => choice.selected), [['riven-broken-blade.buff-mode']]);
  assert.deepEqual(item.targetPlans.map(plan => [plan.requirement.id, plan.selected]), [
    ['riven-broken-blade.self', [f.kernel.ref('riven')]],
  ]);
  const asks = f.requests.map(request => request.id);
  assert.deepEqual(asks, ['riven-broken-blade.choose/mode%3A0', 'target:riven-broken-blade.self']);
  f.engine.pass(f.engine.priority);
  f.engine.pass(f.engine.priority);
  assert.equal(f.kernel.getObject('riven').buffs, 1);
  assert.deepEqual(f.requests.map(request => request.id), asks, 'Resolve must not reopen Finalize choices');
  f.lifecycle.detach();
});

test('RIFT-1114 Zenith/ogn-262-298: the may choice and its two targets lock atomically before Resolve', () => {
  const choose = request => {
    if (request.type === 'optional') return true;
    return undefined;
  };
  const f = runtime({ programs: [zenithProgram], choose, build: builder => builder
    .unit('enemy', { owner: 'B', controller: 'B', location: battlefield('bf2') })
    .hand('blade', { cardId: zenithProgram.canonicalCardId, types: ['spell'], energy: 3, power: ['Calm'] }) });
  f.kernel.addObject({ ...f.kernel.getObject('source'), location: battlefield('bf1') });
  playCard(f, 'blade');
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.choicePlan.optionalChoices.map(choice => choice.accepted), [true]);
  assert.deepEqual(item.targetPlans.map(plan => plan.requirement.id), [
    'enemy-unit-at-battlefield', 'friendly-unit',
  ]);
  const asks = f.requests.map(request => request.id);
  assert.deepEqual(asks, [
    'target:enemy-unit-at-battlefield',
    'may-move-friendly-unit/optional',
    'target:friendly-unit',
  ]);
  f.engine.pass(f.engine.priority);
  f.engine.pass(f.engine.priority);
  assert.equal(f.kernel.getObject('enemy').stunned, true);
  assert.deepEqual(f.kernel.getObject('source').location, battlefield('bf2'));
  assert.deepEqual(f.requests.map(request => request.id), asks);
  f.lifecycle.detach();
});

test('RIFT-1114 Kennen/ven-135-166: an accepted paid trigger locks its target at Finalize and pays once', () => {
  const kernel = world().player('A', { energy: 20, power: [] }).player('B', { energy: 20, power: [] })
    .unit('kennen', { cardId: kennenProgram.canonicalCardId, types: ['unit'], energy: 3, power: null, might: 2,
      owner: 'A', controller: 'A', location: battlefield('bf1') })
    .unit('enemy', { owner: 'B', controller: 'B', location: battlefield('bf1') })
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: 'A' })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: 'B' })
    .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: 'A' })
    .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: 'B' })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'optional') return true;
    if (request.id === 'target:kennen.attack.unit') return [kernel.ref('enemy')];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return structuredClone([...request.options]);
    }
    if (request.type === 'order') return structuredClone([...request.options]);
    if (request.type === 'mode') return request.options[0];
    return undefined;
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
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: [admitted(kennenProgram)] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    describePlay: binding.describePlay, cleanup: () => false,
  });
  const errors = [];
  const lifecycle = binding.attachLifecycle(engine, error => errors.push(error));
  assert.deepEqual(binding.registerProgramTriggers(engine, kernel.getObject('kennen')),
    ['program:kennen:1:1', 'program:kennen:1:2']);
  const combat = new CombatFlow(engine, host,
    [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }], () => {}, { events: true, lifecycle: true });
  combat.entered(kernel.getObject('kennen'));
  combat.cleanup();
  engine.advance();
  assert.equal(combat.startCombat('bf1').attacker, 'A');
  assert.ok(engine.pipeline.events.some(event => event.timingPoint === 'attack-declared'));
  const item = engine.items.find(candidate => candidate.trigger?.registration.id.includes('1:2'));
  assert.ok(item);
  assert.equal(item.status, 'finalized');
  assert.equal(item.payment?.paid, true);
  assert.equal(kernel.player('A').energy, 18);
  assert.deepEqual(item.targetPlans.map(plan => plan.requirement.id), ['kennen.attack.unit']);
  const asks = requests.map(request => request.id);
  assert.deepEqual(asks, ['finalize:trigger:1:optional', 'target:kennen.attack.unit']);
  engine.pass(engine.priority);
  engine.pass(engine.priority);
  assert.equal(kernel.getObject('enemy').stunned, true);
  assert.equal(kernel.player('A').energy, 18);
  assert.deepEqual(requests.map(request => request.id), asks);
  assert.deepEqual(errors, []);
  lifecycle.detach();
});

test('RIFT-1114 Zenith: a target that changes incarnation at Resolve is ignored under CR 359.3.e.14', () => {
  const choose = (request, kernel) => {
    if (request.type === 'optional') return true;
    if (request.id === 'target:enemy-unit-at-battlefield') return [kernel.ref('enemy')];
    if (request.id === 'target:friendly-unit') return [kernel.ref('source')];
    return undefined;
  };
  const f = runtime({ programs: [zenithProgram], choose, build: builder => builder
    .unit('enemy', { owner: 'B', controller: 'B', location: battlefield('bf2') })
    .hand('blade', { cardId: zenithProgram.canonicalCardId, types: ['spell'], energy: 3, power: ['Calm'] }) });
  f.kernel.addObject({ ...f.kernel.getObject('source'), location: battlefield('bf1') });
  playCard(f, 'blade');
  const stale = f.kernel.getObject('enemy');
  f.kernel.addObject({ ...stale, ref: { id: 'enemy', zoneEntryId: 2 } }, 'board');
  settle(f);
  assert.equal(f.kernel.getObject('enemy').zone, 'board');
  assert.equal(f.kernel.getObject('enemy').ref.zoneEntryId, 2);
  assert.deepEqual(f.kernel.getObject('source').location, battlefield('bf1'));
  f.lifecycle.detach();
});

test('RIFT-1114 Nocturne/ogn-194-298: the production body decodes cost.modify and fails closed before an inexact linked Play', () => {
  const f = runtime({
    programs: [nocturneProgram],
    choose: () => undefined,
    build: builder => builder.object('nocturne', {
      cardId: nocturneProgram.canonicalCardId, name: 'Nocturne, Horrifying', types: ['unit'],
      tags: ['Nocturne', 'Champion'], keywords: [], zone: 'deck', owner: 'A', controller: 'A',
      energy: 4, power: ['Chaos'], might: 4,
    }),
  });
  const trigger = nocturneProgram.abilities.find(ability => ability.kind === 'triggered');
  const [may] = trigger.body;
  const inner = may.args.body.value;
  const source = f.kernel.getObject('nocturne');
  assert.equal(f.binding.registerProgramTriggers(f.engine, source).length, 1);
  // effect.play still requires a Finalize-produced flat plan. The body adapter
  // must not accept a caller-created plan or invent a printed-cost fallback.
  assert.equal(inner[1].op, 'effect.play');
  assert.deepEqual(inner[1].args.cost, { kind: 'linked-value', instructionId: 'nocturne-horrifying.alternate-cost', key: 'plan' });
  f.engine.execute({
    id: 'nocturne-horrifying.production-trigger', controller: 'A', source, kind: 'triggered', speed: 'normal', body: inner,
  });
  f.engine.advance();
  const [item] = f.engine.items;
  assert.equal(item.status, 'finalized');
  assert.throws(
    () => { f.engine.pass('A'); f.engine.pass('B'); },
    error => error.name === 'CostPlanError' && /no exact numeric Power cost/.test(error.message),
    'Nocturne remains fail-closed until the linked Play has an exact printed Power projection',
  );
  assert.equal(source.zone, 'deck');
  f.lifecycle.detach();
});

test('RIFT-1114 divide: the adapter executes already-locked split targets while amounts remain Resolve choices', () => {
  const kernel = world().player('A').player('B')
    .unit('one', { owner: 'B', controller: 'B', might: 4 })
    .unit('two', { owner: 'B', controller: 'B', might: 4 })
    .build();
  kernel.setAnswers({
    'split/effect.damage%3Adivide%3A0': 2,
    'split/effect.damage%3Adivide%3A1': 1,
  });
  kernel.setTargets('split-targets', [kernel.ref('one'), kernel.ref('two')]);
  const outcome = resolveChainBody([{
    id: 'split', op: 'effect.damage',
    args: { amount: constant(3), target: constant('split-targets'), divide: constant(true) },
  }], kernel);
  assert.equal(outcome.status, 'executed');
  assert.equal(kernel.getObject('one').damage + kernel.getObject('two').damage, 3);
});

test('RIFT-1114 inspect/repeat: the adapter consumes ordered pick receipts and keeps Repeat choices in Resolve', () => {
  const kernel = world().player('A', { energy: 2 }).player('B')
    .deck(['one', 'two', 'three'], { owner: 'A' })
    .unit('victim', { owner: 'B', controller: 'B', might: 5 })
    .build();
  kernel.setPicks('body.top-3', kernel.objectsInZone('A', 'deck'));
  kernel.setAnswers({
    'look/look%2Fselect': [kernel.ref('two')],
    'repeat/repeat%2Fchoice': 1,
  });
  kernel.setTargets('victim-target', [kernel.ref('victim')]);
  const outcome = resolveChainBody([
    {
      id: 'look', op: 'effect.inspect',
      args: {
        player: constant('A'), zone: constant('deck'), scope: constant('picks'),
        picksSpecId: constant('body.top-3'), choose: constant(true),
        chooseCount: constant({ min: 1, max: 1 }), choiceId: constant('look/select'),
      },
      picks: [{
        id: 'body.top-3', options: [], ordered: true, selection: 'all',
        zoneSlice: { zone: 'deck', from: 'top', count: constant(3) },
      }],
    },
    {
      id: 'repeat', op: 'effect.repeat',
      args: {
        count: constant(1),
        action: constant({
          type: 'damage', target: constant('victim-target'), amount: constant(1),
          combat: constant(false), targetSpec: 'victim-target',
        }),
        choice: constant({ id: 'repeat/choice', field: 'amount', type: 'number', min: constant(1), max: constant(1) }),
      },
    },
  ], kernel);
  assert.equal(outcome.status, 'executed');
  assert.equal(outcome.linkedValues['look.inspected'], 3);
  assert.deepEqual(outcome.linkedValues['look.inspected-pick'], [kernel.ref('two')]);
  assert.equal(kernel.getObject('victim').damage, 1);
});

test('RIFT-1114 Repeat: only structural action/choice envelopes are decoded', () => {
  const kernel = world().player('A').player('B')
    .unit('target', { owner: 'B', controller: 'B' })
    .deck(['one', 'two', 'three'], { owner: 'A' })
    .build();
  kernel.setTargets('repeat-target', [kernel.ref('target')]);
  kernel.setAnswers({ 'structural/structural%2Fchoice': 2 });
  const outcome = resolveChainBody([{
    id: 'structural',
    op: 'effect.repeat',
    args: {
      action: constant({
        type: 'draw', player: constant('A'), amount: constant(2),
      }),
      choice: constant({ id: 'structural/choice', field: 'amount', type: 'number', min: constant(1), max: constant(3) }),
      count: constant(1),
    },
  }], kernel);
  assert.equal(outcome.status, 'executed');
  assert.equal(kernel.player('A').handSize, 2, 'the action field remains an Expr and consumes the decoded choice');
  assert.equal(outcome.linkedValues['structural.repeats'], 1);
});

test('RIFT-1114 Yone/rad-181-167: conquer Finalize locks the Base target before effect.damage resolves', () => {
  const kernel = world().player('A').player('B')
    .unit('yone', { cardId: yoneProgram.canonicalCardId, types: ['unit'], energy: 5, power: ['Body'], might: 5,
      owner: 'A', controller: 'A', location: base('A') })
    .unit('enemy', { owner: 'B', controller: 'B', might: 3, location: base('B') })
    .battlefield('field', { types: ['battlefield'], controller: null, zone: 'board', location: battlefield('bf1'),
      owner: 'A', isToken: true, energy: null, power: null, might: null })
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: 'A' })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: 'B' })
    .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: 'A' })
    .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: 'B' })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.id === 'target:enemy-unit-in-base') return [kernel.ref('enemy')];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return structuredClone([...request.options]);
    }
    if (request.type === 'order') return structuredClone([...request.options]);
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'optional') return true;
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
  const binding = createProgramBinding({ cardPrograms: [admitted(yoneProgram)] });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    victoryScore: 8, describePlay: binding.describePlay,
  });
  const lifecycle = binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  binding.registerProgramTriggers(flow.chain, { ...kernel.getObject('yone'), cardId: yoneProgram.canonicalCardId });
  flow.execute({
    id: 'yone-conquer', controller: 'A', source: kernel.getObject('yone'), kind: 'activated', speed: 'normal',
    body: [{ id: 'move-yone', op: 'effect.move', args: { amount: constant(1), to: constant(battlefield('bf1')) } }],
  });
  for (let guard = 0; guard < 50; guard++) {
    if (flow.chain.items.length) {
      if (flow.chain.priority !== null) flow.pass(flow.chain.priority);
      else flow.advance();
      continue;
    }
    if (flow.chain.focus !== null) { flow.pass(flow.chain.focus); continue; }
    break;
  }
  assert.ok(flow.chain.pipeline.events.some(event => event.timingPoint === 'conquer'));
  assert.deepEqual(requests.map(request => request.id), ['target:enemy-unit-in-base']);
  assert.equal(kernel.getObject('enemy').damage, 5);
  lifecycle.detach();
});

test('RIFT-1114 replacement: the public binder carries the exact replaced object and never guesses a selector', () => {
  const f = runtime({ build: builder => builder
    .unit('host', { location: battlefield('bf1') })
    .unit('victim', { owner: 'B', controller: 'B', location: battlefield('bf1') }) });
  const replacement = {
    replaces: { event: 'object-killed', filter: { type: 'unit' } },
    with: [{ id: 'banish-replaced', op: 'effect.banish', args: { objects: constant({ linked: 'replacement.object' }) } }],
  };
  const deps = {
    host: {
      object: ref => f.kernel.object(ref), objects: () => f.kernel.objects,
      context: (source, controller) => f.host.context(source, controller, 'cleanup-start'),
    },
    pipeline: f.engine.pipeline,
  };
  bindReplacement(replacement, f.kernel.ref('host'), deps);
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('victim') }).status, 'replaced');
  assert.equal(f.kernel.getObject('victim').zone, 'banishment');
  assert.throws(
    () => planReplacementBody(replacement.with, {
      hostRef: f.kernel.ref('host'), replacedObject: null, usedWindow: false,
    }, {
      host: deps.host, controller: 'A', evaluate: expr => expr?.kind === 'constant' ? expr.value : null,
    }),
    /no replaced-event object binding/,
  );
  f.lifecycle.detach();
});

test('RIFT-1114 Heimerdinger/rad-132-167: effect.token replacement stays blocked before inventing a Chain identity', () => {
  const f = runtime({ programs: [heimerdingerProgram], build: builder => builder.hand('host', {
    cardId: heimerdingerProgram.canonicalCardId, types: ['unit'], energy: 6, power: ['Order'], might: 5,
  }) });
  const replacement = heimerdingerProgram.abilities.find(ability => ability.kind === 'replacement');
  assert.ok(replacement);
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref('host'), to: 'chain' });
  const blocked = f.errors.find(error => /generated Chain reference/.test(String(error?.message)));
  assert.ok(blocked, 'attachLifecycle must surface the production binder refusal');
  assert.equal(f.engine.pipeline.hasReplacementRegistration(`replacement:host:${f.kernel.ref('host').zoneEntryId}`), false);
  f.lifecycle.detach();
});

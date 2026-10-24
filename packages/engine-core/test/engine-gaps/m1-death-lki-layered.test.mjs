// RIFT-1033 production regression: a confirmed death keeps the last layered
// characteristics, including intrinsic Buff Might, for Deathknell conditions.
//
// Official evidence: Core Rules v1.5 (published 2026-10-09), effective under
// the Radiance policy on 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// Local source: /root/swarm-rift/shared/rules/CR-v1.5.txt.
//
// CR 383.2.c.3.b requires noting the source and game state when a leave trigger
// is processed; 429.1.a.1.b requires noting attributes before a Kill completes;
// 808.1.d.2-.3 require pending Deathknell before Trash with location,
// attributes, and other details; 703 + 708 + 710 make a Board Unit's current
// layered Might decide Mighty (5 or more).
// Canonical card: sfd-167-221 Unsung Hero
// (card.hash-afc40c373a9fb4e48492323d7af26d3a58b824c385707dd3c269e97fee236103).
//
// Timeline: real Board Unit + real Buff layer -> confirmed Kill boundary ->
// object-killed LKI and Pending -> Finalize -> Resolve draw 2.
import assert from 'node:assert/strict';
import test from 'node:test';

import unsungHero from '../../../card-dsl/dist/cards/sfd/unsung-hero.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost, killBatch } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const battlefield = { type: 'battlefield', id: 'RIFT-1033-field' };

function runtime({ might = 4, buffs = 1, drawCards = ['d1', 'd2', 'd3'], objects = 1 } = {}) {
  const builder = world().player('A').player('B')
    .deck(drawCards, { owner: 'A' });
  for (let index = 0; index < objects; index++) builder.unit(index === 0 ? 'hero' : `hero-${index}`, {
    cardId: unsungHero.canonicalCardId,
    owner: 'A', controller: 'A', types: ['unit'], might, buffs, location: battlefield,
  });
  const kernel = builder.build();
  const choose = request => {
    if (request.type === 'mode' || request.type === 'order') return request.options[0];
    if (request.type === 'optional') return true;
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
    ...kernel.deathBoundaryPort(),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: [unsungHero] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const layeredMight = () => {
    engine.layers.setObjects(kernel.objects);
    return engine.layers.evaluate(kernel.ref('hero')).might;
  };
  const settle = () => {
    engine.advance();
    for (let guard = 0; engine.items.length; guard++) {
      assert.ok(guard < 20, 'the real Chain must settle');
      engine.pass(engine.priority);
    }
  };
  return { kernel, engine, settle, layeredMight };
}

function deathEvent(runtime, id = 'hero') {
  return runtime.engine.pipeline.events.find(event =>
    event.timingPoint === 'object-killed' && event.object?.ref.id === id);
}

test('RIFT-1033 Unsung Hero at printed 4 with a Buff dies as Mighty and draws 2', () => {
  const f = runtime();
  assert.equal(f.layeredMight(), 5);
  const ref = f.kernel.ref('hero');
  assert.equal(f.engine.commit({ type: 'kill', object: ref }).status, 'done');

  const death = deathEvent(f);
  assert.ok(death);
  assert.deepEqual(death.object.ref, ref);
  assert.equal(death.object.zone, 'board', 'LKI remains the final pre-transition Board state');
  assert.equal(death.object.might, 5, 'death LKI contains the effective layered Might');
  assert.equal(death.object.buffs, 1, 'the final Board counter remains available to the trigger');
  assert.equal(f.engine.items.length, 1, 'the conditional Deathknell crossed the production pending boundary');
  assert.equal(f.engine.items[0].trigger.source.might, 5);
  assert.equal(f.engine.items[0].trigger.event.object.might, 5);

  f.settle();
  assert.equal(f.kernel.player('A').handCount, 2);
  assert.equal(f.kernel.getObject('hero').zone, 'trash');
});

test('RIFT-1033 printed Mighty 5 without a Buff keeps the existing death path', () => {
  const f = runtime({ might: 5, buffs: 0 });
  assert.equal(f.layeredMight(), 5);
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('hero') }).status, 'done');
  assert.equal(deathEvent(f).object.might, 5);
  assert.equal(f.engine.items.length, 1);
  f.settle();
  assert.equal(f.kernel.player('A').handCount, 2);
});

test('RIFT-1033 printed 4 without a Buff is not Mighty and does not trigger', () => {
  const f = runtime({ might: 4, buffs: 0 });
  assert.equal(f.layeredMight(), 4);
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('hero') }).status, 'done');
  assert.equal(deathEvent(f).object.might, 4);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.player('A').handCount, 0);
});

test('RIFT-1033 production typed batch seam preserves layered Deathknell LKI before Trash', () => {
  const f = runtime({ objects: 2, drawCards: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] });
  const refs = [f.kernel.ref('hero'), f.kernel.ref('hero-1')];
  const outcome = f.engine.pipeline.commitContract(killBatch(refs, 'RIFT-1033:wave'));
  assert.equal(outcome.status, 'done');

  const deaths = f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed');
  assert.deepEqual(deaths.map(event => event.object.ref), refs);
  assert.ok(deaths.every(event => event.object.zone === 'board' && event.object.might === 5));
  assert.ok(deaths.every(event => event.it?.might === 5));
  assert.ok(deaths.every(event => event.batchId === 'RIFT-1033:wave'));
  assert.equal(f.engine.items.length, 2);
  assert.ok(f.engine.items.every(item => item.trigger.source.might === 5));
  assert.ok(f.engine.items.every(item => item.trigger.event.object.might === 5));
  f.settle();
  assert.equal(f.kernel.player('A').handCount, 4);
  assert.deepEqual(f.kernel.objects.filter(object => refs.some(ref =>
    ref.id === object.ref.id)).map(object => object.zone), ['trash', 'trash']);
});

test('RIFT-1033 damage lethal to a Buffed Unsung Hero enters the same TurnFlow Cleanup LKI path', () => {
  const kernel = world().player('A').player('B')
    .deck(['d1', 'd2', 'd3'], { owner: 'A' })
    .unit('source', { might: 1, location: { type: 'base', player: 'A' } })
    .unit('hero', {
      cardId: unsungHero.canonicalCardId, owner: 'A', controller: 'A', types: ['unit'],
      might: 4, buffs: 1, location: battlefield,
    }).build();
  const choose = request => {
    if (request.type === 'mode' || request.type === 'order') return request.options[0];
    if (request.type === 'optional') return true;
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
    ...kernel.deathBoundaryPort(), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({
    host: { ...host, player: id => kernel.player(id) },
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: battlefield.id, controller: 'A' }, { id: 'RIFT-1033-other', controller: null }],
    victoryScore: 20,
  });
  const binding = createProgramBinding({ cardPrograms: [unsungHero] });
  binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  for (let count = 0; flow.phase !== 'main'; count++) {
    assert.ok(count < 100, 'setup reaches Main');
    flow.advance();
  }
  const ref = kernel.ref('hero');
  const source = kernel.ref('source');

  // The Buff is part of the same production layer pass used by Cleanup.
  flow.chain.layers.setObjects(kernel.objects);
  assert.equal(flow.chain.layers.evaluate(kernel.ref('hero')).might, 5);
  assert.equal(flow.chain.layers.evaluate(kernel.ref('hero')).might, 5);

  assert.equal(flow.chain.commit({ type: 'damage', source, target: ref, amount: 5, combat: false }).status, 'done');
  assert.equal(kernel.getObject('hero').damage, 5);
  for (let count = 0; !flow.chain.pipeline.events.some(event => event.timingPoint === 'object-killed') && count < 20; count++) {
    if (flow.chain.items.length && flow.chain.priority !== null) flow.pass(flow.chain.priority);
    else flow.advance();
  }
  const death = flow.chain.pipeline.events.find(event =>
    event.timingPoint === 'object-killed' && event.object?.ref.id === 'hero');
  assert.ok(death);
  assert.equal(death.object.zone, 'board');
  assert.equal(death.object.might, 5);
  assert.equal(death.object.damage, 5);
  assert.equal(flow.chain.items.length, 1);
  assert.equal(flow.chain.items[0].trigger.source.might, 5);
  assert.equal(kernel.getObject('hero').zone, 'trash');
});


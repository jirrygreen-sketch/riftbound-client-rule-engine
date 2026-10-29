// RIFT-1139 S8: death/leave LKI and authoritative event history.
//
// Official evidence: Riftbound Core Rules v1.5, published 2026-10-09,
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Local copy: /root/swarm-rift/shared/rules/CR-v1.5.txt.
//
// - 383.2.c.3 and .a-.b: a self-leave trigger is processed after replacements
//   and before the zone change; its source/LKI is noted for Finalize.
// - 401-405: the trigger becomes Pending, Finalizes, pays/checks, then Resolves.
// - 420.4.b: a *played this turn* condition is checked at Finalize.
// - 429.1.a.1.b and 808.1.d.2-.3: a confirmed self-death enters the Chain as
//   Pending before Trash and retains the pre-Trash location/characteristics.
// - 431.2: channeled runes enter exhausted.
// - 812.1.c: another card must have been Finalized by that player this turn.
//
// Card text/printings come from packages/card-data/data/deck-catalog.json:
// - ogn-186-298 Treasure Trove
// - ogn-012-298 Noxus Hopeful
// - unl-156-219 Loyal Poro
import assert from 'node:assert/strict';
import test from 'node:test';

import noxusHopeful from '../../../card-dsl/dist/cards/ogn/noxus-hopeful.js';
import treasureTrove from '../../../card-dsl/dist/cards/ogn/treasure-trove.js';
import loyalPoro from '../../../card-dsl/dist/cards/unl/loyal-poro.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost, killBatch } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const constant = value => ({ kind: 'constant', value });
const battlefield = Object.freeze({ type: 'battlefield', id: 'RIFT-1139-field' });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

const syntheticHost = {
  canonicalCardId: 'synthetic:rift-1139:history-host',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Synthetic history host.',
  abilities: [],
};

function choose(request) {
  if (request.type === 'mode' || request.type === 'order') return request.options[0];
  if (request.type === 'optional') return true;
  if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
    return [...request.options];
  }
  throw new AwaitChoice(request);
}

function runtime(builder, programs = [], options = {}) {
  const kernel = builder.build();
  const requests = [];
  const decide = request => {
    requests.push(structuredClone(request));
    return (options.choose ?? choose)(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    ...kernel.deathBoundaryPort(),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose: decide,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const errors = [];
  const lifecycle = binding.attachLifecycle(engine, error => { errors.push(error); });
  const enter = (id, location = battlefield) => {
    assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'chain' }).status, 'done');
    assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'battlefield', location }).status, 'done');
  };
  return { kernel, host, binding, engine, lifecycle, errors, requests, enter };
}

test('RIFT-1139 Treasure Trove leave trigger queues before Trash and resolves from pre-transition LKI', () => {
  const program = admitted(treasureTrove);
  const f = runtime(world().player('A').player('B')
    .hand('trove', {
      cardId: program.canonicalCardId, types: ['gear'], energy: null, power: null, might: null,
    })
    .deck(['draw-a', 'draw-b'], { owner: 'A' })
    .rune(['rune-a', 'rune-b'], { owner: 'A' }), [program]);
  f.enter('trove');
  const source = f.kernel.getObject('trove');
  assert.equal(source.zone, 'board');

  assert.equal(f.engine.commit({ type: 'kill', object: source.ref }).status, 'done');
  const deathIndex = f.engine.pipeline.events.findIndex(event =>
    event.timingPoint === 'object-killed' && event.object?.ref.id === 'trove');
  const leaveIndex = f.engine.pipeline.events.findIndex(event =>
    (event.timingPoint === 'object-leaves-board' || event.timingPoint === 'object-leaves-battlefield') &&
    event.object?.ref.id === 'trove');
  const pendingIndex = f.engine.pipeline.events.findIndex(event => event.timingPoint === 'chain-item-pending');
  const trashIndex = f.engine.pipeline.events.findIndex(event =>
    event.timingPoint === 'object-enters-zone' && event.object?.ref.id === 'trove' && event.object.zone === 'trash');
  assert.ok(deathIndex >= 0 && pendingIndex > deathIndex && trashIndex > pendingIndex && leaveIndex < trashIndex,
    'CR 383.2.c.3 / 429.1.a.1.b / 808.1.d.2: Pending is installed before Trash');
  assert.equal(f.engine.pipeline.events.filter(event =>
    (event.timingPoint === 'object-leaves-board' || event.timingPoint === 'object-leaves-battlefield') &&
    event.object?.ref.id === 'trove').length, 2,
  'a confirmed death publishes each Board leave timing alias once');
  assert.equal(f.engine.items.length, 1);
  assert.deepEqual(f.engine.items[0].trigger.source.ref, source.ref);
  assert.equal(f.engine.items[0].trigger.source.zone, 'board');
  assert.deepEqual(f.engine.items[0].trigger.source.location, battlefield);

  f.engine.advance();
  for (let guard = 0; f.engine.items.length; guard++) {
    assert.ok(guard < 20, 'the real Chain settles');
    f.engine.pass(f.engine.priority);
  }
  assert.equal(f.kernel.player('A').handCount, 1, 'the leave body drew one card');
  assert.ok(f.engine.pipeline.events.some(event => event.timingPoint === 'chain-item-resolve'),
    'the leave body reached Resolve');
  assert.equal(f.kernel.objectsInZone('A', 'rune-zone').length, 1, 'the leave body channeled one rune');
  assert.equal(f.kernel.getObject('trove').zone, 'trash', 'the body resolved after the source reached Trash');
  assert.deepEqual(f.errors, []);
});

test('RIFT-1139 simultaneous deaths share one batch and keep distinct exact LKIs in card order', () => {
  const program = admitted(loyalPoro);
  const f = runtime(world().player('A').player('B')
    .unit('left', { cardId: program.canonicalCardId, owner: 'A', controller: 'A', location: battlefield, might: 3 })
    .unit('right', { cardId: program.canonicalCardId, owner: 'A', controller: 'A', location: battlefield, might: 3 })
    .deck(['draw-a', 'draw-b'], { owner: 'A' }), [program]);
  const refs = [f.kernel.ref('left'), f.kernel.ref('right')];
  assert.equal(f.engine.pipeline.commitContract(killBatch(refs, 'RIFT-1139:same-wave')).status, 'done');
  const deaths = f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed');
  assert.deepEqual(deaths.map(event => event.object.ref), refs);
  assert.ok(deaths.every(event => event.batchId === 'RIFT-1139:same-wave'));
  assert.ok(deaths.every(event => event.object.zone === 'board' && event.object.location.id === battlefield.id));
  assert.equal(f.engine.items.length, 2);
  assert.ok(f.engine.items.every((item, index) => item.trigger.source.ref.id === refs[index].id &&
    item.trigger.event.batchId === 'RIFT-1139:same-wave'));
});

test('RIFT-1139 a replaced death publishes no object-killed event or queued ability', () => {
  const program = admitted(loyalPoro);
  const f = runtime(world().player('A').player('B')
    .unit('saved', { cardId: program.canonicalCardId, owner: 'A', controller: 'A', location: battlefield }),
  [program]);
  f.engine.pipeline.registerReplacement({
    id: 'RIFT-1139:recall-instead',
    matches: action => action.type === 'kill' && action.object.id === 'saved',
    apply: action => ({ status: 'replace', actions: [{
      type: 'move-location', object: action.object, to: { type: 'base', player: 'A' },
    }] }),
  });
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('saved') }).status, 'replaced');
  assert.equal(f.kernel.getObject('saved').zone, 'board');
  assert.deepEqual(f.kernel.getObject('saved').location, { type: 'base', player: 'A' });
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-killed'), false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'chain-item-pending'), false);
});

test('RIFT-1139 Finalize history filters by event player and never falls back to live objects', () => {
  const source = noxusHopeful.abilities[1].condition.left;
  const other = {
    ...syntheticHost, canonicalCardId: 'synthetic:rift-1139:other-card',
    abilities: [{
      kind: 'play',
      cost: { kind: 'cost.printed', energy: { kind: 'constant', value: 1 }, power: { kind: 'constant', value: ['Fury'] } },
      body: [],
    }],
  };
  const f = runtime(world().player('A').player('B')
    .hand('host-card', { cardId: syntheticHost.canonicalCardId, types: ['unit'], zone: 'hand' })
    .hand('live-object', { cardId: other.canonicalCardId, types: ['unit'], energy: 1, power: ['Fury'], zone: 'hand' }), [other, syntheticHost]);
  const context = f.engine.pipeline.host.context(f.kernel.getObject('host-card'), 'A', 'chain-item-finalize');
  assert.equal(context.evaluate(source), 0,
    'live Hand objects are not Finalize history');

  f.engine.pipeline.emit({ timingPoint: 'turn-start', player: 'A' });
  assert.equal(f.engine.commit({ type: 'gain-energy', player: 'A', amount: 1 }).status, 'done');
  assert.equal(f.engine.commit({ type: 'gain-power', player: 'A', power: ['Fury'] }).status, 'done');
  f.engine.advance();
  const firstRef = f.kernel.ref('live-object');
  const sourceSnapshot = f.kernel.getObject('live-object');
  f.engine.execute(f.binding.describePlay({
    type: 'play', player: 'A', object: firstRef, location: { type: 'base', player: 'A' },
  }, sourceSnapshot));
  f.engine.advance();
  assert.equal(f.engine.finalizedCardPlaysThisTurn().length, 1);
  assert.equal(context.evaluate(source), 1, 'A Finalized one different card this turn');
  const freshContext = f.engine.pipeline.host.context(f.kernel.getObject('host-card'), 'A', 'chain-item-finalize');
  assert.equal(freshContext.evaluate(source), 1, 'a context created after Finalize reads the committed history');
  assert.equal(context.history({
    scope: 'turn', timingPoint: 'chain-item-finalize', player: 'B', objectFilter: { type: 'unit' },
  }), 0, 'one player cannot satisfy another player\'s history');
});

test('RIFT-1139 current-turn Finalize history resets at turn-start', () => {
  const other = {
    ...syntheticHost, canonicalCardId: 'synthetic:rift-1139:previous-turn-card',
    abilities: [{
      kind: 'play',
      cost: { kind: 'cost.printed', energy: { kind: 'constant', value: 0 }, power: { kind: 'constant', value: [] } },
      body: [],
    }],
  };
  const f = runtime(world().player('A').player('B')
    .hand('host', { cardId: syntheticHost.canonicalCardId, types: ['unit'] })
    .hand('played', { cardId: other.canonicalCardId, types: ['unit'] }), [syntheticHost, other]);
  f.engine.pipeline.emit({ timingPoint: 'turn-start', player: 'A' });
  f.engine.advance();
  const sourceSnapshot = f.kernel.getObject('played');
  f.engine.execute(f.binding.describePlay({
    type: 'play', player: 'A', object: sourceSnapshot.ref, location: { type: 'base', player: 'A' },
  }, sourceSnapshot));
  f.engine.advance();
  assert.equal(f.engine.finalizedCardPlaysThisTurn().length, 1);
  f.engine.pipeline.emit({ timingPoint: 'turn-start', player: 'B' });
  assert.equal(f.engine.finalizedCardPlaysThisTurn().length, 0,
    'CR 420.4.b: the previous turn\'s Finalize records do not satisfy this turn');
});

test('RIFT-1139 a departed incarnation cannot satisfy a live source identity', () => {
  const program = admitted(loyalPoro);
  const f = runtime(world().player('A').player('B')
    .unit('relocated', { cardId: program.canonicalCardId, owner: 'A', controller: 'A', location: battlefield }),
  [program]);
  const before = f.kernel.ref('relocated');
  assert.equal(f.engine.commit({
    type: 'move-zone', object: before, to: 'base', location: { type: 'base', player: 'A' },
  }).status, 'done');
  const after = f.kernel.ref('relocated');
  assert.notEqual(after.zoneEntryId, before.zoneEntryId,
    'leaving/re-entering creates a fresh incarnation');
  const current = f.kernel.getObject('relocated');
  const deadRegistration = {
    id: 'RIFT-1139:old-incarnation', source: { ...current, ref: before, zone: 'board' },
    controller: 'A', spec: { at: 'object-killed', filter: { objectId: 'relocated' } },
    body: [], activeZones: ['board'], boundToIncarnation: true,
  };
  f.engine.pipeline.registerTrigger(deadRegistration);
  assert.equal(f.engine.commit({ type: 'kill', object: after }).status, 'done');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-killed' &&
    event.object?.ref.zoneEntryId === after.zoneEntryId), true);
  assert.equal(f.engine.items.some(item => item.trigger?.registration.id === deadRegistration.id), false,
    'the old incarnation registration never follows the fresh Board object');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import satchelCharge from '../../../card-dsl/dist/cards/rad/satchel-charge.js';
import { EventPipeline } from '../../dist/events/pipeline.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { cardProgram, fixture, settle } from '../rules/keywords/support.mjs';

const field = id => ({ type: 'battlefield', id });
const base = player => ({ type: 'base', player });

function makeHost(builder, options = {}) {
  const kernel = builder.build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: saved => kernel.restore(saved),
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: options.choose ?? (() => { throw new Error('unexpected choice'); }),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    ...(options.actionId ? { actionId: options.actionId } : {}),
    ...(options.batchId ? { batchId: options.batchId } : {}),
    ...(options.effectController ? { effectController: options.effectController } : {}),
    ...(options.cause ? { cause: options.cause } : {}),
  });
  return { kernel, host };
}

test('EG-PAYLOAD move emits authoritative before/after locations and separate roles', () => {
  const { kernel, host } = makeHost(
    world().player('A').player('B').unit('enemy', {
      owner: 'B', controller: 'B', zone: 'board', location: base('B')
    }),
  );
  const source = kernel.getObject('enemy');
  host.context(source, 'A', 'main-start');
  const pipeline = new EventPipeline(host, ['A', 'B'], 'A');
  const result = pipeline.commit({ type: 'move-location', object: source.ref, to: field('bf-1') });
  assert.equal(result.status, 'done');
  const event = pipeline.events.find(item => item.timingPoint === 'object-moved');
  assert.ok(event);
  assert.deepEqual({
    fromKind: event.details.fromKind,
    fromLocationId: event.details.fromLocationId,
    toKind: event.details.toKind,
    toLocationId: event.details.toLocationId,
    cause: event.details.cause,
  }, { fromKind: 'base', fromLocationId: 'B', toKind: 'battlefield', toLocationId: 'bf-1', cause: 'move' });
  assert.equal(event.details.effectControllerPlayerId, 'A');
  assert.equal(event.details.responsiblePlayerId, 'A');
  assert.equal(event.details.affectedPlayerId, 'B');
  assert.equal(event.before.location.player, 'B');
  assert.equal(event.after.location.id, 'bf-1');
  assert.equal(event.batchId, event.actionId);
  assert.equal(kernel.getObject('enemy').location.id, 'bf-1');
});

test('EG-PAYLOAD keeps effect controller separate from the affected player and suppresses zero damage', () => {
  const { kernel, host } = makeHost(
    world().player('A').player('B').deck(['d1'], { owner: 'A' }),
    { effectController: () => 'B' },
  );
  const pipeline = new EventPipeline(host, ['A', 'B'], 'A');
  const drawn = pipeline.commit({ type: 'draw', player: 'A', amount: 1 });
  assert.equal(drawn.status, 'done');
  const event = pipeline.events.find(item => item.timingPoint === 'card-drawn');
  assert.equal(event.details.effectControllerPlayerId, 'B');
  assert.equal(event.details.responsiblePlayerId, 'B');
  assert.equal(event.details.affectedPlayerId, 'A');
  const target = kernel.getObject('d1');
  const zero = pipeline.commit({ type: 'damage', source: target.ref, target: target.ref, amount: 0, combat: false });
  assert.equal(zero.status, 'done');
  assert.equal(pipeline.events.some(item => item.timingPoint === 'damage-dealt'), false);
});

test('EG-PAYLOAD draw batches every card and look/reveal carry the committed object set', () => {
  const { kernel, host } = makeHost(
    world().player('A').player('B')
      .unit('effect', { owner: 'A', controller: 'A', zone: 'board', location: base('A') })
      .deck(['d1', 'd2'], { owner: 'A' })
      .hand('h1', { owner: 'A' }),
  );
  const source = kernel.getObject('effect');
  host.context(source, 'A', 'main-start');
  const pipeline = new EventPipeline(host, ['A', 'B'], 'A');
  pipeline.commit({ type: 'draw', player: 'A', amount: 2 });
  const drawn = pipeline.events.filter(item => item.timingPoint === 'card-drawn');
  assert.equal(drawn.length, 2);
  assert.equal(new Set(drawn.map(item => item.batchId)).size, 1);
  assert.deepEqual(drawn.map(item => item.details.fromZone), ['deck', 'deck']);
  assert.ok(drawn.every(item => item.before.zone === 'deck' && item.after.zone === 'hand'));
  assert.ok(drawn.every(item => item.details.effectControllerPlayerId === 'A'));

  const looked = pipeline.commit({ type: 'look', objects: [kernel.ref('h1'), kernel.ref('d1')], player: 'A' });
  assert.equal(looked.status, 'done');
  const lookEvent = pipeline.events.find(item => item.timingPoint === 'cards-looked-at');
  assert.deepEqual(lookEvent.details.objectIds, ['h1', 'd1']);
  assert.deepEqual(lookEvent.objects.map(item => item.ref.id), ['h1', 'd1']);
  const revealed = pipeline.commit({ type: 'reveal', object: kernel.ref('h1'), viewers: ['A', 'B'] });
  assert.equal(revealed.status, 'done');
  const revealEvent = pipeline.events.find(item => item.timingPoint === 'card-revealed');
  assert.deepEqual(revealEvent.details.objectIds, ['h1']);
  assert.deepEqual(revealEvent.details.visibility, ['A', 'B']);
});

test('EG-PAYLOAD rejected and replaced actions emit no successful payload', () => {
  let choose = () => { throw new Error('unexpected choice'); };
  const { kernel, host } = makeHost(
    world().player('A').player('B').unit('victim', { owner: 'B', controller: 'B', zone: 'board', location: field('bf') }),
    { choose: request => choose(request) },
  );
  const source = kernel.getObject('victim');
  host.context(source, 'A', 'main-start');
  const pipeline = new EventPipeline(host, ['A', 'B'], 'A');
  pipeline.registerReplacement({
    id: 'prevent-kill',
    matches: action => action.type === 'kill',
    apply: () => ({ status: 'prevent' }),
  });
  const before = kernel.snapshot();
  const prevented = pipeline.commit({ type: 'kill', object: source.ref });
  assert.equal(prevented.status, 'prevented');
  assert.equal(pipeline.events.filter(item => item.timingPoint === 'object-killed').length, 0);
  assert.deepEqual(kernel.snapshot(), before);

  pipeline.unregisterTrigger('missing');
  choose = () => { throw new Error('rollback'); };
  pipeline.registerReplacement({
    id: 'throw-after-choice',
    matches: action => action.type === 'damage',
    optional: true,
    apply: () => ({ status: 'rewrite', action: { type: 'damage', source: source.ref, target: source.ref, amount: 1, combat: false } }),
  });
  const checkpoint = kernel.snapshot();
  assert.throws(() => pipeline.commit({ type: 'damage', source: source.ref, target: source.ref, amount: 1, combat: false }), /rollback|unexpected choice/);
  assert.deepEqual(kernel.snapshot(), checkpoint);
  assert.equal(pipeline.events.some(item => item.timingPoint === 'damage-dealt'), false);
});

test('EG-PAYLOAD raw Satchel Charge Move IR reaches the production assembler and publishes Move payload', () => {
  const move = satchelCharge.abilities.find(ability => ability.kind === 'play').body[0];
  const program = cardProgram('test:raw-satchel-charge', [move]);
  const f = fixture({
    programs: [program],
    energy: { A: 3 },
    power: { A: ['Chaos'] },
    setup(builder) {
      builder.hand('spell', { cardId: program.canonicalCardId, types: ['spell'], energy: 3, power: ['Chaos'] });
      builder.unit('moving', { controller: 'A', owner: 'A', location: base('A') });
      builder.object('destination', { types: ['battlefield'], zone: 'board', cardId: null, location: field('destination') });
    },
  });
  f.answers.set('target:satchel-charge.friendly-unit', ['moving']);
  f.answers.set('satchel-charge.move-unit/satchel-charge.battlefield-destination', field('destination'));
  f.play('spell');
  f.engine.pass('A');
  f.engine.pass('B');
  settle(f.engine);
  const moved = f.engine.pipeline.events.find(item => item.timingPoint === 'object-moved');
  assert.ok(moved);
  assert.equal(moved.object.ref.id, 'moving');
  assert.equal(moved.details.toLocationId, 'destination');
  assert.equal(f.get('moving').location.id, 'destination');
});


// RIFT-952: paid Repeat executes the original resolution body once per paid
// instance, with a distinct Finalize target lock for every execution. Official
// evidence: Core Rules v1.5 (published 2026-10-09, effective 2026-10-16), CR
// 820.2 and 820.2.a. The official PDF is:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
//   5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Frigid Touch canonicalCardId:
//   card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9
// Timeline: Hand Play -> Finalize selects one target for the original and one
// for each paid Repeat -> Cost payment -> Resolve revalidates each locked target
// at its instance -> the two Might effects apply in chosen order.
import assert from 'node:assert/strict';
import test from 'node:test';

import frigidTouch from '../../../card-dsl/dist/cards/sfd/frigid-touch.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const TARGET = 'affected-unit';
const executableFrigidTouch = {
  ...frigidTouch,
  status: 'executable',
  judgeReason: undefined,
};

function scene({ paid, selections, invalidateSecond = false } = {}) {
  const kernel = world()
    .player('A', { energy: 4 })
    .player('B')
    .hand('spell', {
      owner: 'A',
      controller: 'A',
      cardId: executableFrigidTouch.canonicalCardId,
      types: ['spell'],
      energy: 2,
      power: null,
    })
    .unit('first', {
      owner: 'B', controller: 'B', might: 6,
      location: { type: 'base', player: 'B' },
    })
    .unit('second', {
      owner: 'B', controller: 'B', might: 6,
      location: { type: 'base', player: 'B' },
    })
    .build();

  const asked = [];
  const choose = request => {
    asked.push(structuredClone(request));
    if (request.type === 'optional') return paid;
    if (request.type === 'select-objects') {
      const selected = selections[request.id];
      if (selected === undefined) {
        throw new Error(`Unexpected target question ${request.id}`);
      }
      return selected.map(id => kernel.ref(id));
    }
    throw new Error(`Unexpected choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const binding = createProgramBinding({ cardPrograms: [executableFrigidTouch] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'],
    turnPlayer: 'A',
    phase: 'main',
    host,
    cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const lifecycleErrors = [];
  binding.attachLifecycle(engine, error => lifecycleErrors.push(error));

  const source = kernel.getObject('spell');
  const draft = binding.describePlay(
    { type: 'play', player: 'A', object: source.ref },
    source,
  );
  engine.execute(draft);
  const item = engine.items[0];
  assert.ok(item, 'the production Chain finalized the spell');

  if (invalidateSecond) {
    // The second execution has its own frozen target incarnation. Moving that
    // exact unit off the Board after Finalize makes only the second plan stale.
    kernel.perform({ type: 'move-zone', object: kernel.ref('second'), to: 'trash' });
  }
  return { kernel, engine, binding, item, asked, lifecycleErrors };
}

function settle(f) {
  for (let count = 0; f.engine.items.length; count++) {
    assert.ok(count < 20, 'the production Chain must settle');
    f.engine.pass(f.engine.priority);
  }
}

function mightEffects(f) {
  return f.engine.layers.registry.list()
    .filter(entry => entry.effect.effect.kind === 'continuous.might');
}

test('RIFT-952 paid Repeat reselects and applies Frigid Touch to two different units', () => {
  const f = scene({
    paid: true,
    selections: {
      [`target:${TARGET}`]: ['first'],
      [`target:${TARGET}:repeat:1`]: ['second'],
    },
  });

  assert.equal(f.item.payment.paid, true);
  assert.equal(f.kernel.player('A').energy, 0, 'base 2 plus Repeat 2 was paid');
  assert.deepEqual(
    f.item.targetPlans.map(plan => [plan.repeatIndex, plan.selected.map(ref => ref.id)]),
    [[0, ['first']], [1, ['second']]],
    'each execution owns one different Finalize-locked target',
  );
  assert.deepEqual(
    f.asked.filter(request => request.type === 'select-objects').map(request => request.id),
    [`target:${TARGET}`, `target:${TARGET}:repeat:1`],
    'the additional execution asks its target at the usual Finalize time',
  );

  settle(f);
  assert.equal(mightEffects(f).length, 2);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('first')).might, 4);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('second')).might, 4);
  assert.equal(
    f.engine.pipeline.events.filter(event => event.timingPoint === 'card-played').length,
    1,
    'CR 820.3.a: Repeat does not Play the card again',
  );
  assert.deepEqual(f.lifecycleErrors, []);
});

test('RIFT-952 a second target that becomes stale at Resolve is ignored while the first applies', () => {
  const f = scene({
    paid: true,
    selections: {
      [`target:${TARGET}`]: ['first'],
      [`target:${TARGET}:repeat:1`]: ['second'],
    },
    invalidateSecond: true,
  });

  assert.deepEqual(
    f.item.targetPlans.map(plan => [plan.repeatIndex, plan.selected.map(ref => ref.id)]),
    [[0, ['first']], [1, ['second']]],
  );
  settle(f);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('first')).might, 4);
  assert.equal(f.kernel.getObject('second').zone, 'trash');
  assert.equal(mightEffects(f).length, 1, 'the stale second lock produced no effect');
  assert.deepEqual(f.lifecycleErrors, []);
});

test('RIFT-952 Repeat permits choosing the same target for both executions', () => {
  const f = scene({
    paid: true,
    selections: {
      [`target:${TARGET}`]: ['first'],
      [`target:${TARGET}:repeat:1`]: ['first'],
    },
  });

  assert.equal(new Set(f.item.targetPlans[0].selected.map(ref => ref.id)).size, 1,
    'one TargetSpec cannot contain the same object twice');
  assert.deepEqual(
    f.item.targetPlans.map(plan => [plan.repeatIndex, plan.selected.map(ref => ref.id)]),
    [[0, ['first']], [1, ['first']]],
  );
  settle(f);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('first')).might, 2);
  assert.equal(mightEffects(f).length, 2);
  assert.deepEqual(f.lifecycleErrors, []);
});

test('RIFT-952 declining Repeat asks for and resolves one target', () => {
  const f = scene({
    paid: false,
    selections: { [`target:${TARGET}`]: ['first'] },
  });

  assert.equal(f.kernel.player('A').energy, 2);
  assert.deepEqual(f.item.targetPlans.map(plan => plan.repeatIndex), [undefined]);
  assert.deepEqual(
    f.asked.filter(request => request.type === 'select-objects').map(request => request.id),
    [`target:${TARGET}`],
  );
  settle(f);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('first')).might, 4);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('second')).might, 6);
  assert.equal(mightEffects(f).length, 1);
  assert.deepEqual(f.lifecycleErrors, []);
});

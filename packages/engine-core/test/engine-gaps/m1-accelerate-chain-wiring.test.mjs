// RIFT-950: the default ChainEngine supplies one play's frozen Accelerate
// plan/receipt to the Board-entry action handled by the production pipeline.
//
// Official evidence: Core Rules v1.5 (published 2026-10-09, effective
// 2026-10-16), CR 805.2.b and 805.6/805.6.a:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
//   5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Jaull-Fish source and Accelerate keyword:
//   packages/card-dsl/src/cards/sfd/jaull-fish.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import jaullFish from '../../../card-dsl/dist/cards/sfd/jaull-fish.js';
import vanguardAttendant from '../../../card-dsl/dist/cards/ogs/vanguard-attendant.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const accelerateAbility = jaullFish.abilities.find(ability =>
  ability.kind === 'keyword' && ability.keyword === 'accelerate');
assert.ok(accelerateAbility, 'Jaull-Fish declares the real Accelerate keyword');

// Isolate the card's printed Accelerate ability. The card's separate Might
// discount remains judge-required and is outside this RIFT-950 wiring test.
const program = {
  ...jaullFish,
  status: 'executable',
  judgeReason: undefined,
  abilities: [accelerateAbility],
};

function scene({ energy = 9, power = ['Body', 'Body', 'Body'] } = {}) {
  const kernel = world()
    .player('A', { energy, power })
    .player('B')
    .hand('jaull', {
      cardId: program.canonicalCardId,
      types: ['unit'],
      energy: 7,
      power: 2,
      might: 6,
      keywords: [{ id: 'Accelerate' }],
    })
    .hand('other-entry', {
      cardId: vanguardAttendant.canonicalCardId, types: ['unit'], energy: 2, power: ['Body'],
      might: 2, keywords: [],
    })
    .build();
  const choose = request => {
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
  const binding = createProgramBinding({ cardPrograms: [program, vanguardAttendant] });
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
  const receipts = [];
  engine.pipeline.onEvent = event => {
    if (event.timingPoint !== 'chain-item-finalize' || event.object?.ref.id !== 'jaull') return;
    const item = engine.items.find(candidate => candidate.source.ref.id === 'jaull');
    if (item?.costPlan !== undefined && item.payment !== undefined) {
      receipts.push({
        plan: structuredClone(item.costPlan),
        receipt: structuredClone(item.payment),
      });
    }
  };
  return { kernel, binding, engine, lifecycleErrors, receipts };
}

function draftFor(f, selected) {
  const source = f.kernel.getObject('jaull');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
  const accelerate = draft.cost.optionalAdditional?.find(cost => cost.kind === 'accelerate');
  assert.ok(accelerate, 'the production binding expands the real KeywordDef into an optional cost');
  return {
    ...draft,
    cost: {
      ...draft.cost,
      printed: { id: 'sfd-103-221', cardType: 'Unit', domains: ['Body'], energy: 7, power: 2 },
      optionalAdditional: [{ ...accelerate, selected }],
    },
  };
}

function play(f, selected) {
  f.engine.execute(draftFor(f, selected));
  for (let count = 0; f.engine.items.length; count++) {
    assert.ok(count < 20, 'the production Chain must settle');
    f.engine.pass(f.engine.priority);
  }
}

test('RIFT-950 default ChainEngine pays Accelerate and enters ready without object-readied', () => {
  const f = scene();
  play(f, true);

  assert.equal(f.kernel.getObject('jaull').zone, 'board');
  assert.equal(f.kernel.getObject('jaull').exhausted, false);
  assert.equal(f.kernel.player('A').energy, 1, 'base 7 plus Accelerate 1 Energy was paid');
  assert.deepEqual(f.kernel.player('A').power, [], 'base 2 plus Accelerate 1 Power was paid');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-readied'), false);
  assert.equal(f.receipts.length, 1);
  assert.ok(f.receipts[0].plan.selectedAdditional.some(cost => cost.kind === 'accelerate'));
  assert.equal(f.receipts[0].receipt.paid, true);
  assert.ok(f.receipts[0].receipt.additional.some(cost => cost.kind === 'accelerate' && cost.paid));
  assert.deepEqual(f.lifecycleErrors, []);
});

test('RIFT-950 a declined Accelerate enters exhausted with the base costs paid', () => {
  const f = scene();
  play(f, false);

  assert.equal(f.kernel.getObject('jaull').zone, 'board');
  assert.equal(f.kernel.getObject('jaull').exhausted, true);
  assert.equal(f.kernel.player('A').energy, 2, 'only the base 7 Energy was paid');
  assert.deepEqual(f.kernel.player('A').power, ['Body'], 'only the base 2 Power was paid');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-readied'), false);
  assert.equal(f.receipts.length, 1);
  assert.deepEqual(f.receipts[0].plan.selectedAdditional, []);
  assert.equal(f.receipts[0].plan.declinedAdditional.length, 1);
  assert.equal(f.receipts[0].receipt.additional.length, 0);
  assert.deepEqual(f.lifecycleErrors, []);
});

test('RIFT-950 a non-Accelerate optional cost cannot turn Board entry ready', () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world().player('A', { energy: 9, power: ['Body', 'Body', 'Body'] }).player('B')
    .hand('jaull', {
      cardId: program.canonicalCardId, types: ['unit'], energy: 7, power: 2, might: 6,
      keywords: [{ id: 'Accelerate' }],
    })
    .build();
  const choose = request => {
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
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine);
  const item = kernel.getObject('jaull');
  const draft = binding.describePlay({ type: 'play', player: 'A', object: item.ref }, item);
  engine.execute({
    ...draft,
    cost: {
      ...draft.cost,
      printed: { id: 'sfd-103-221', cardType: 'Unit', domains: ['Body'], energy: 7, power: 2 },
      optionalAdditional: [{
        id: 'other-optional', kind: 'additional', selected: true,
        cost: { kind: 'explicit', energy: { kind: 'constant', value: 1 } },
      }],
    },
  });
  for (let count = 0; engine.items.length; count++) {
    assert.ok(count < 20, 'the production Chain must settle');
    engine.pass(engine.priority);
  }
  assert.equal(kernel.getObject('jaull').zone, 'board');
  assert.equal(kernel.getObject('jaull').exhausted, true);
  assert.equal(engine.pipeline.events.some(event => event.timingPoint === 'object-readied'), false);
});

test('RIFT-950 another unit\'s unconditional entry-ready replacement is unchanged', () => {
  const f = scene();
  const result = f.engine.commit({
    type: 'play', object: f.kernel.ref('other-entry'), player: 'A',
    location: { type: 'base', player: 'A' },
  });
  assert.equal(result.status, 'done');
  f.engine.advance();
  for (let count = 0; f.engine.items.length; count++) {
    assert.ok(count < 20, 'the production Chain must settle');
    assert.ok(f.engine.priority !== null, 'the production Chain must grant Priority');
    f.engine.pass(f.engine.priority);
  }
  assert.equal(f.kernel.getObject('other-entry').zone, 'board');
  assert.equal(f.kernel.getObject('other-entry').exhausted, false);
  assert.deepEqual(f.lifecycleErrors, []);
});

test('RIFT-950 failed Accelerate payment rolls back before any Board-entry action', () => {
  const f = scene({ energy: 8, power: ['Body', 'Body'] });
  const before = f.kernel.snapshot();
  assert.throws(() => play(f, true), /insufficient matching Power/);

  assert.deepEqual(f.kernel.snapshot(), before);
  assert.equal(f.kernel.getObject('jaull').zone, 'hand');
  assert.equal(f.kernel.getObject('jaull').exhausted, false);
  assert.equal(f.receipts.length, 0, 'the failed payment never produced a receipt');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-enters-board'), false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-readied'), false);
  assert.deepEqual(f.lifecycleErrors, []);
});

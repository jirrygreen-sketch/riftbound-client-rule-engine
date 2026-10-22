// RIFT-946 - current layered Might in variable cost counts.
//
// Official source: Core Rules v1.5, published 2026-10-09 (effective
// 2026-10-16), CR 356.4.a/b/g, 356.6, and 706-710:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
//   5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Jaull-Fish canonicalCardId:
//   card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732.
// The real card remains judge-required for its separate Accelerate entry-state
// gap. These tests use an executable view containing only its printed Mighty
// discount, with the existing explicit `stage: "discount"` spelling, then drive
// Play -> chain-item-pending -> Finalize -> current layer query -> payment ->
// Resolve through the default program lifecycle.

import assert from 'node:assert/strict';
import test from 'node:test';

import jaullFish from '../../../card-dsl/dist/cards/sfd/jaull-fish.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const constant = value => ({ kind: 'constant', value });
const discountAbility = jaullFish.abilities.find(ability =>
  ability.kind === 'static' && ability.effect.kind === 'continuous.cost-modification');
assert.ok(discountAbility, 'Jaull-Fish exposes its printed variable discount');

const jaullDiscount = {
  ...jaullFish,
  status: 'executable',
  judgeReason: undefined,
  abilities: [{
    ...discountAbility,
    effect: {
      ...discountAbility.effect,
      stage: 'discount',
    },
  }],
};

const mightAura = {
  canonicalCardId: 'synthetic:rift-946:might-aura',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Friendly MightProbe units have +1 Might.',
  abilities: [{
    kind: 'static',
    effect: {
      kind: 'continuous.might',
      amount: constant(1),
      filter: { type: 'unit', controller: 'self', zone: 'board', tags: 'MightProbe' },
    },
  }],
};

const printedJaull = Object.freeze({
  id: 'sfd-103-221',
  cardType: 'Unit',
  domains: ['Body'],
  energy: 7,
  power: 2,
});

function withUnknownCostFilter(program) {
  const ability = program.abilities[0];
  return {
    ...program,
    abilities: [{
      ...ability,
      effect: {
        ...ability.effect,
        amount: {
          ...ability.effect.amount,
          operands: ability.effect.amount.operands.map(operand => operand.kind === 'count'
            ? { ...operand, filter: { ...operand.filter, unsupportedCostFilter: 5 } }
            : operand),
        },
      },
    }],
  };
}

function playMightyDiscount({ setup, programs = [jaullDiscount], energy = 20, power = ['Body', 'Body', 'Body'] } = {}) {
  const builder = world()
    .player('A', { energy, power })
    .player('B', { energy: 10, power: ['Body', 'Body'] })
    .hand('jaull', {
      cardId: jaullFish.canonicalCardId,
      name: 'Jaull-Fish',
      types: ['unit'],
      energy: 7,
      power: ['Body'],
      might: 6,
    });
  setup?.(builder);
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' && request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
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
  let finalized = null;
  const observeEvent = engine.pipeline.onEvent;
  engine.pipeline.onEvent = event => {
    observeEvent?.(event);
    if (event.timingPoint === 'chain-item-finalize' && event.object?.ref.id === 'jaull' && event.player === 'A') {
      const item = engine.items.find(candidate => candidate.source.ref.id === 'jaull');
      if (item?.costPlan !== undefined) finalized = structuredClone(item.costPlan);
    }
  };

  // Install the aura by actually playing it from Hand. Its unit Resolve owns
  // the Board entry and lifecycle registration; no synthetic entry event is
  // injected and no raw Might value is mutated.
  if (programs.some(program => program.canonicalCardId === mightAura.canonicalCardId)) {
    const aura = kernel.getObject('aura');
    engine.execute(binding.describePlay({ type: 'play', object: aura.ref, player: 'A' }, aura));
    assert.equal(kernel.getObject('aura').zone, 'board');
  }

  const source = kernel.getObject('jaull');
  const described = binding.describePlay({ type: 'play', object: source.ref, player: 'A' }, source);
  const draft = { ...described, cost: { ...described.cost, printed: printedJaull } };
  engine.execute(draft);
  assert.ok(finalized, 'the chain-item-finalize event observes the produced cost plan');
  const plan = finalized;
  assert.deepEqual(lifecycleErrors, []);
  engine.layers.setObjects(kernel.objects);
  return {
    kernel, engine, requests, plan, lifecycleErrors,
    might: id => engine.layers.evaluate(kernel.ref(id)).might,
  };
}

test('RIFT-946: zero current Mighty units leaves Jaull-Fish at its printed Energy cost', () => {
  const result = playMightyDiscount({
    setup: w => w
      .unit('one-short-a', { might: 4 })
      .unit('one-short-b', { might: 4, buffs: 0 })
      .unit('enemy-mighty', { owner: 'B', controller: 'B', might: 8 }),
  });
  assert.equal(result.plan.total.energy, 7);
  assert.deepEqual(result.plan.discounts, []);
  assert.equal(result.kernel.player('A').energy, 13, 'the real payment still charges 7 Energy');
});

test('RIFT-946: one current Mighty unit produces one 2-Energy discount', () => {
  const result = playMightyDiscount({
    setup: w => w.unit('mighty', { might: 5 }),
  });
  assert.equal(result.plan.total.energy, 5);
  assert.equal(result.plan.discounts.length, 1);
  assert.equal(result.plan.discounts[0].amount, 2);
  assert.equal(result.kernel.player('A').energy, 15);
});

test('RIFT-946: each friendly Mighty unit counts and an enemy Mighty unit does not', () => {
  const result = playMightyDiscount({
    setup: w => w
      .unit('mighty-a', { might: 5 })
      .unit('mighty-b', { might: 6 })
      .unit('enemy-mighty', { owner: 'B', controller: 'B', might: 9 }),
  });
  assert.equal(result.plan.total.energy, 3);
  assert.equal(result.plan.discounts[0].amount, 4);
  assert.equal(result.kernel.player('A').energy, 17);
});

test('RIFT-946 CR 703/710: printed Might 4 plus a Buff is current Might 5 and counts', () => {
  const result = playMightyDiscount({
    setup: w => w.unit('buffed', { might: 4, buffs: 1 }),
  });
  assert.equal(result.might('buffed'), 5);
  assert.equal(result.plan.total.energy, 5);
  assert.equal(result.plan.discounts[0].amount, 2);
});

test('RIFT-946 CR 478/710: a production static Might bonus raises a printed 4 into the count', () => {
  const result = playMightyDiscount({
    programs: [jaullDiscount, mightAura],
    setup: w => w
      .hand('aura', { cardId: mightAura.canonicalCardId, types: ['unit'], might: 1, energy: 0, power: [] })
      .unit('buffed-by-static', { might: 4, tags: ['MightProbe'] }),
  });
  assert.equal(result.might('buffed-by-static'), 5);
  assert.equal(result.plan.total.energy, 5);
  assert.equal(result.plan.discounts[0].amount, 2);
});

test('RIFT-946 CR 356.6: repeated 2-Energy discounts stop the Energy total at zero', () => {
  const result = playMightyDiscount({
    setup: w => w
      .unit('mighty-a', { might: 5 })
      .unit('mighty-b', { might: 5 })
      .unit('mighty-c', { might: 5 })
      .unit('mighty-d', { might: 5 }),
  });
  assert.equal(result.plan.discounts[0].amount, 8);
  assert.equal(result.plan.discounts[0].before, 7);
  assert.equal(result.plan.discounts[0].after, 0);
  assert.equal(result.plan.total.energy, 0);
  assert.equal(result.kernel.player('A').energy, 20, 'the Energy component pays zero');
});

test('RIFT-946: an unknown cost-filter field still blocks at Finalize', () => {
  const unsupported = withUnknownCostFilter(jaullDiscount);
  assert.throws(
    () => playMightyDiscount({ programs: [unsupported], setup: w => w.unit('mighty', { might: 5 }) }),
    error => /Unsupported cost filter field unsupportedCostFilter/.test(String(error?.message)),
  );
});

test('RIFT-946: a malformed mightGte threshold blocks instead of matching', () => {
  const unsupported = structuredClone(jaullDiscount);
  const count = unsupported.abilities[0].effect.amount.operands[1];
  count.filter.mightGte = 'five';
  assert.throws(
    () => playMightyDiscount({ programs: [unsupported], setup: w => w.unit('mighty', { might: 5 }) }),
    error => /mightGte requires a safe integer threshold/.test(String(error?.message)),
  );
});

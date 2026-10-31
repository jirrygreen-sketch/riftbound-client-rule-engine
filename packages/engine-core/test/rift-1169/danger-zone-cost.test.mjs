import assert from 'node:assert/strict';
import test from 'node:test';

import dangerZone from '../../../card-dsl/dist/cards/sfd/danger-zone.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const RULES_URL = 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf';
const CARD_ID = 'sfd-182-221';
const CANONICAL_ID = 'card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e';
const domains = ['Fury', 'Mind'];
const evidence = Object.freeze({
  ruleset: { version: '1.5', published: '2026-10-09', effective: '2026-10-16', url: RULES_URL },
  rules: ['135.2.e.5.a', '135.2.e.6.c', '430.3', '813.1.c.1', '820.1.c.1'],
  canonicalCardId: CANONICAL_ID,
  processing: ['Play', 'Reaction timing', 'Finalize', 'Pay Costs', 'Resolve'],
  sfdErrata: { checked: true, applicable: false },
});

function runtime({ power = [], energy = 2, repeat = false } = {}) {
  assert.equal(dangerZone.canonicalCardId, CANONICAL_ID);
  const kernel = world()
    .player('A', { energy, power: [...power] })
    .player('B')
    .hand(CARD_ID, {
      cardId: CANONICAL_ID,
      types: ['spell'],
      energy: 1,
      power: [...domains],
    })
    .unit('mech', { owner: 'A', controller: 'A', tags: ['Mech'], might: 2 })
    .build();
  const choices = [];
  const choose = request => {
    choices.push(structuredClone(request));
    if (request.type === 'optional') return repeat;
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
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
  const binding = createProgramBinding({ cardPrograms: [dangerZone] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  return { kernel, binding, engine, choices };
}

function draft(runtime) {
  const source = runtime.kernel.getObject(CARD_ID);
  return runtime.binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source);
}

function settle(engine) {
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 40, 'the production Chain must settle');
    engine.pass(engine.priority);
  }
}

for (const domain of domains) {
  test(`Danger Zone base [C] is payable with only ${domain} Power (CR 135.2.e.6.c)`, () => {
    assert.deepEqual(evidence.rules, ['135.2.e.5.a', '135.2.e.6.c', '430.3', '813.1.c.1', '820.1.c.1']);
    const game = runtime({ power: [domain], energy: 1, repeat: false });
    const play = draft(game);
    assert.equal(play.speed, 'reaction');
    game.engine.execute(play);
    assert.deepEqual(game.engine.items[0].costPlan.total, {
      energy: 1,
      power: [{ amount: 1, allowedDomains: domains }],
      xp: 0,
      actions: [],
    });
    assert.deepEqual(game.engine.items[0].payment.power.power, [
      { requirementIndex: 0, from: domain, amount: 1 },
    ]);
    assert.deepEqual(game.engine.items[0].costPlan.printed, { energy: 1, power: domains });
    assert.deepEqual(game.kernel.player('A').power, []);
    assert.equal(game.kernel.player('A').energy, 0);
    settle(game.engine);
    assert.equal(game.kernel.getObject(CARD_ID).zone, 'trash');
    assert.equal(game.engine.layers.evaluate(game.kernel.ref('mech')).might, 3);
  });
}

test('Danger Zone cannot pay its base [C] with neither Fury nor Mind Power', () => {
  for (const power of [[], ['Order']]) {
    const game = runtime({ power, energy: 1, repeat: false });
    const before = game.kernel.stateForTest();
    assert.throws(() => game.engine.execute(draft(game)), error =>
      error instanceof CostPlanError && error.reason === 'cannot-pay-cost');
    assert.deepEqual(game.kernel.stateForTest(), before);
    assert.equal(game.engine.items.length, 0);
  }
});

for (const repeatDomain of ['Fury', 'Mind']) {
  test(`Danger Zone Repeat rainbow Power can be paid by ${repeatDomain}`,
    () => {
      const game = runtime({ power: ['Fury', repeatDomain], energy: 2, repeat: true });
      game.engine.execute(draft(game));
      const item = game.engine.items[0];
      assert.equal(item.costPlan.total.energy, 2);
      assert.deepEqual(item.costPlan.total.power, [
        { amount: 1, allowedDomains: domains },
        { amount: 1, allowedDomains: ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] },
      ]);
      assert.deepEqual(item.payment.power.power, [
        { requirementIndex: 0, from: 'Fury', amount: 1 },
        { requirementIndex: 1, from: repeatDomain, amount: 1 },
      ]);
      assert.deepEqual(game.kernel.player('A').power, []);
      settle(game.engine);
      assert.equal(game.engine.layers.registry.list().filter(entry =>
        entry.effect.effect.kind === 'continuous.might').length, 2,
      'CR 820.1.d.1 executes the whole effect once more');
    });
}

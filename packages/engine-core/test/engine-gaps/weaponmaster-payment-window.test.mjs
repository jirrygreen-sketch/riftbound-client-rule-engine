import assert from 'node:assert/strict';
import test from 'node:test';

import bfSword from '../../../card-dsl/dist/cards/sfd/bf-sword.js';
import lucian from '../../../card-dsl/dist/cards/sfd/lucian-merciless.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { executeBasicRuneResourcePlan, planBasicRuneResourceActivation } from '../../dist/runes/index.js';

// Official evidence: Riftbound Core Rules v1.5, published 2026-10-09 and
// effective 2026-10-16,
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 430.2-.3 makes a Reaction Add finalize and resolve immediately during a
// resource payment without passing Priority or Focus. CR 164.2.a-.b defines
// Rune exhaust/recycle Add abilities. CR 821.1.c.2-.5 determines and pays the
// selected Equipment's Equip cost and leaves it unattached if that cost cannot
// be paid. Catalog text is from packages/card-data/data/deck-catalog.json:
// Lucian, Merciless sfd-113-221 canonicalCardId
// card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef;
// B.F. Sword sfd-161-221 hash-959c19d6...fe0bfe.
// Timeline: Play Lucian -> card-played Pending trigger -> Finalize locks B.F.
// Sword -> Resolve cannot pay one Order Power -> chooser can recycle an Order
// Rune during the prompt (430.3) -> retry pay -> attach and Might +3, or decline
// and preserve the Equipment and resources (821.1.c.5).

const ORDER_RUNE = Object.freeze({
  cardId: 'card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67',
  canonicalCardId: 'card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67',
  domain: 'Order',
});
const BASE = Object.freeze({ type: 'base', player: 'A' });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function scene({ power = [] } = {}) {
  const kernel = world()
    .player('A', { energy: 3, power })
    .player('B')
    .object('lucian', {
      owner: 'A', controller: 'A', cardId: lucian.canonicalCardId, name: '卢锡安·冷面枪手',
      types: ['unit'], tags: ['Lucian', 'Demacia', 'Sentinel', 'Champion'], zone: 'hand',
      location: null, energy: 3, power: null, might: 3,
    })
    .object('bf-sword', {
      owner: 'A', controller: 'A', cardId: bfSword.canonicalCardId, name: '暴风大剑',
      types: ['gear'], tags: ['Equipment'], zone: 'board', location: BASE,
      energy: 4, power: null, might: 3, exhausted: false,
      keywords: bfSword.abilities.map(ability => ({
        id: ability.keyword,
        ...(ability.value === undefined ? {} : { value: ability.value }),
        ...(ability.params === undefined ? {} : { params: structuredClone(ability.params) }),
      })),
    })
    .object('order-rune', {
      owner: 'A', controller: 'A', cardId: ORDER_RUNE.cardId, name: '序理符文',
      types: ['rune'], tags: ['Basic'], zone: 'rune-zone', location: null,
      energy: null, power: null, might: null, exhausted: false, keywords: [],
    })
    .build();
  const requests = [];
  const answers = new Map();
  const choose = request => {
    requests.push(request);
    if (answers.has(request.id)) return structuredClone(answers.get(request.id));
    if (request.type === 'select-objects' && request.id === 'target:weaponmaster-equipment') {
      return request.options.filter(ref => ref.id === 'bf-sword');
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [admitted(lucian), admitted(bfSword)] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const startPlay = () => {
    const source = kernel.getObject('lucian');
    engine.execute(binding.describePlay({ type: 'play', object: source.ref, player: 'A' }, source));
    engine.pass('A');
  };
  const firstPrompt = () => assert.throws(
    () => engine.pass('B'),
    error => error instanceof AwaitChoice && error.request.type === 'mode',
  );
  const addOrderPower = () => {
    const rune = kernel.getObject('order-rune');
    const plan = planBasicRuneResourceActivation({
      chain: engine,
      state: { objects: () => kernel.objects, player: id => kernel.player(id) },
      resolveIdentity: cardId => cardId === ORDER_RUNE.cardId ? ORDER_RUNE : null,
      request: {
        actor: 'A', activationId: 'RIFT-1150:recycle-order-rune',
        intent: { type: 'rune-power', runeObjectId: rune.ref.id, zoneEntryId: rune.ref.zoneEntryId },
        window: { kind: 'payment' },
      },
    });
    executeBasicRuneResourcePlan(plan);
  };
  const might = id => {
    engine.layers.setObjects(kernel.objects);
    return engine.layers.evaluate(kernel.ref(id)).might;
  };
  return { kernel, engine, requests, answers, startPlay, firstPrompt, addOrderPower, might };
}

test('RIFT-1150: unpayable Weaponmaster asks before preserving the unpaid Equipment', () => {
  const f = scene();
  f.startPlay();
  let request;
  assert.throws(() => f.engine.pass('B'), error => {
    assert.ok(error instanceof AwaitChoice);
    request = error.request;
    return true;
  });
  assert.equal(request.type, 'mode');
  assert.deepEqual(request.options, ['支付', '放弃装配']);
  assert.equal(request.chooser, 'A');
  assert.match(request.prompt, /^暴风大剑的装配费用：1 点序理符能，当前不足。可先横置或回收符文补足，再选择支付；或放弃装配。$/u);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('bf-sword').attachedTo, null);
  assert.equal(f.engine.items.length, 1, 'the finalized trigger remains while the choice is pending');
  assert.equal(f.engine.items[0].status, 'finalized');
});

test('RIFT-1150: Order Rune Add during the prompt funds payment and the attachment grants Might +3', () => {
  const f = scene();
  f.startPlay();
  assert.throws(() => f.engine.pass('B'), AwaitChoice);
  const request = f.requests.at(-1);
  assert.equal(request.options.length, 2);

  f.addOrderPower();
  assert.deepEqual(f.kernel.player('A').power, ['Order'], 'the exact recycled Order Rune supplies the missing Power');
  assert.equal(f.kernel.getObject('order-rune').zone, 'rune-deck');
  assert.equal(f.kernel.getObject('bf-sword').attachedTo, null, 'the Add alone does not resume or attach');
  assert.equal(f.engine.items.length, 1, 'the Add must leave the finalized parent awaiting its answer');
  assert.equal(f.engine.items[0].status, 'finalized');
  assert.equal(f.engine.priority, 'B');

  f.answers.set(request.id, '支付');
  assert.equal(f.engine.priority, 'B');
  f.engine.pass('B');
  assert.equal(f.engine.priority, 'A');
  f.engine.pass('A');
  assert.deepEqual(f.kernel.player('A').power, [], 'retry pays exactly the locked Order Power');
  assert.deepEqual(f.kernel.getObject('bf-sword').attachedTo, f.kernel.getObject('lucian').ref);
  assert.equal(f.might('lucian'), 6, 'printed Lucian Might 3 plus B.F. Sword Might Bonus 3');
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-attached').length, 1);
});

test('RIFT-1150: pay while still short asks again with a distinct deterministic choice id', () => {
  const f = scene();
  f.startPlay();
  assert.throws(() => f.engine.pass('B'), AwaitChoice);
  const first = f.requests.at(-1);
  f.answers.set(first.id, '支付');
  let second;
  assert.throws(() => f.engine.pass('B'), error => {
    assert.ok(error instanceof AwaitChoice);
    second = error.request;
    return true;
  });
  assert.notEqual(second.id, first.id);
  assert.match(first.id, /%3A1$/u);
  assert.match(second.id, /%3A2$/u);
  assert.deepEqual(second.options, first.options);
  assert.equal(second.prompt, first.prompt);
  assert.equal(f.kernel.getObject('bf-sword').attachedTo, null);
  assert.equal(f.engine.items.length, 1);

  f.answers.set(second.id, '放弃装配');
  f.engine.pass('B');
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('bf-sword').attachedTo, null);
  assert.deepEqual(f.engine.items, []);
});

test('RIFT-1150: declining the prompt leaves resources and attachment unchanged', () => {
  const f = scene();
  f.startPlay();
  assert.throws(() => f.engine.pass('B'), AwaitChoice);
  const request = f.requests.at(-1);
  f.answers.set(request.id, '放弃装配');
  f.engine.pass('B');

  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('order-rune').zone, 'rune-zone');
  assert.equal(f.kernel.getObject('bf-sword').attachedTo, null);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), false);
  assert.equal(f.kernel.linked('weaponmaster-choice/weaponmaster-pay.payment'), undefined);
  assert.deepEqual(f.engine.items, []);
});

test('RIFT-1150: an already payable Equip cost keeps the ordinary path and asks no payment question', () => {
  const f = scene({ power: ['Order'] });
  f.startPlay();
  f.engine.pass('B');

  assert.equal(f.requests.some(request => request.type === 'mode'), false);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.deepEqual(f.kernel.getObject('bf-sword').attachedTo, f.kernel.getObject('lucian').ref);
  assert.equal(f.might('lucian'), 6);
  assert.deepEqual(f.engine.items, []);
});

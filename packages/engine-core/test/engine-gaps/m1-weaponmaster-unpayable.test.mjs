import assert from 'node:assert/strict';
import test from 'node:test';

import lucian from '../../../card-dsl/dist/cards/sfd/lucian-merciless.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

// Official evidence: Core Rules v1.5 (2026-10-09, effective 2026-10-16)
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Radiance patch notes (effective 2026-10-16)
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// CR 821.1.c.1/.4: no Equip cost is a legal selection and cannot be paid.
// CR 821.1.c.5/.6: an unavailable or unpayable cost leaves the Equipment in
// its current location and attachment, does not activate Equip, and does not
// terminate the rest of the Chain. CR 359.3.e.6 distinguishes Ignored from a
// generic failed action.
// canonicalCardId: Lucian, Merciless
// card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef.
// The controlled fixtures use the same authoritative CostSpec shape as
// canonical Long Sword and Serrated Dirk; each fixture isolates a specific
// present/unpayable/absent keyword branch. The Lucian program itself is the
// real production card from card-dsl.
// Pending -> Finalize: the real card-played trigger locks the controlled
// Equipment TargetSpec. Priority passes A, then B. Resolve computes the cost;
// a missing or genuinely unpayable Equip cost discards its attempted payment
// and attachment while Resolve still completes. The payable control proves
// the ordinary Resolve -> payment -> Attach timeline remains intact.

const constant = value => ({ kind: 'constant', value });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });
const BASE = { type: 'base', player: 'A' };

function runtime({ energy = 3, power = [], equipmentKeywords = [], attachedTo = null } = {}) {
  const card = lucian.canonicalCardId;
  const builder = world()
    .player('A', { energy, power })
    .player('B')
    .unit('old-host', { cardId: 'test:old-host', types: ['unit'], tags: [], location: BASE, energy: null, power: null, might: 2 })
    .object('lucian', {
      cardId: card, ref: { id: 'lucian', zoneEntryId: 1 },
      types: ['unit'], tags: ['Lucian', 'Demacia', 'Sentinel', 'Champion'],
      zone: 'hand', location: null, energy: 3, power: null, might: 3,
    })
    .object('equipment', {
      cardId: 'test:equipment', types: ['gear'], tags: ['Equipment'], zone: 'board', location: BASE,
      energy: null, power: null, might: null, keywords: equipmentKeywords, attachedTo
    });
  const kernel = builder.build();
  const requests = [];
  const answers = new Map();
  const choose = request => {
    requests.push(request);
    if (request.type === 'mode' && request.id.includes(':order:')) return request.options[0];
    if (request.type === 'mode' && request.options.length === 2 &&
        request.options.includes('支付') && request.options.includes('放弃装配')) {
      if (!answers.has(request.id)) throw new AwaitChoice(request);
      return answers.get(request.id);
    }
    if (request.type === 'select-objects' && request.id.includes('target:weaponmaster-equipment')) {
      return request.options.filter(ref => ref.id === 'equipment');
    }
    if (request.type === 'select-objects' && request.options.length === request.min) return [...request.options];
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
  });
  const binding = createProgramBinding({ cardPrograms: [admitted(lucian)] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const play = () => {
    const source = kernel.getObject('lucian');
    engine.execute(binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source));
    for (let guard = 0; engine.items.length; guard++) {
      if (guard > 50) throw new Error('Chain did not settle');
      engine.pass(engine.priority);
    }
  };
  return { kernel, engine, requests, answers, play };
}

const equip = ({ power = 1, domains = ['Fury'] } = {}) => ({
  id: 'Equip', value: power, params: { cost: {
    kind: 'activated',
    payments: [{ kind: 'power', amount: constant(power), allowedDomains: domains }]
  } }
});

test('core-1.5 / CR 821.1.c.4: no Equip keyword leaves the selected Equipment in place and Resolve completes', () => {
  const f = runtime({ equipmentKeywords: [] });
  const before = { ref: f.kernel.getObject('equipment').ref, zone: 'board', location: BASE };
  f.play();
  assert.equal(f.requests.filter(request => request.id.includes('target:weaponmaster-equipment')).length, 1,
    'the target is locked once during Finalize');
  assert.deepEqual(f.kernel.getObject('equipment').ref, before.ref);
  assert.equal(f.kernel.getObject('equipment').zone, before.zone);
  assert.deepEqual(f.kernel.getObject('equipment').location, before.location);
  assert.equal(f.kernel.getObject('equipment').attachedTo, null);
  assert.equal(f.kernel.player('A').energy, 0, 'only the Unit play cost was paid');
  assert.deepEqual(f.kernel.player('A').power, [], 'the no-cost branch paid no invented Power');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), false);
  assert.deepEqual(f.engine.items, []);
  const trace = f.engine.trace.filter(entry => entry.item === 'trigger:1').map(entry => entry.step);
  assert.deepEqual(trace.slice(-4), ['finalized', 'resolve-start', 'resolved', 'removed'],
    'the ignored no-cost branch does not stop the trigger Resolve');
  assert.equal(f.engine.trace.filter(entry => entry.step === 'resolved' && entry.item === 'trigger:1').length, 1);
});

test('core-1.5 / CR 821.1.c.5: an unpayable Equip cost preserves resources and the old attachment, then Resolve completes', () => {
  const f = runtime({ power: ['Fury'], equipmentKeywords: [equip({ domains: ['Body'] })], attachedTo: null });
  const oldHost = f.kernel.getObject('old-host').ref;
  assert.equal(f.kernel.perform({ type: 'attach', object: f.kernel.getObject('equipment').ref, host: oldHost }).status, 'done');
  const before = structuredClone(f.kernel.stateForTest());
  let paymentChoice;
  try {
    f.play();
    assert.fail('unpayable Weaponmaster must request a payment choice');
  } catch (error) {
    assert.ok(error instanceof AwaitChoice, String(error));
    paymentChoice = error.request;
  }
  assert.equal(f.requests.filter(request => request.id.includes('target:weaponmaster-equipment')).length, 1,
    'the target is locked once during Finalize');
  assert.equal(paymentChoice.type, 'mode');
  assert.equal(paymentChoice.chooser, 'A');
  assert.deepEqual(paymentChoice.options, ['支付', '放弃装配']);
  assert.match(paymentChoice.prompt,
    /^equipment的装配费用：1 点摧破符能，当前不足。可先横置或回收符文补足，再选择支付；或放弃装配。$/u);
  assert.equal(f.kernel.player('A').energy, 0, 'the pending choice leaves only the Unit play cost paid');
  assert.deepEqual(f.kernel.player('A').power, ['Fury'], 'the pending choice has not paid the Equip cost');
  assert.deepEqual(f.kernel.getObject('equipment').attachedTo, oldHost,
    'the pending choice leaves the existing attachment unchanged');
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), false,
    'the pending choice emits no attachment event');
  assert.equal(f.engine.items.length, 1, 'the finalized trigger remains while payment is pending');
  assert.equal(f.engine.items[0].id, 'trigger:1');
  assert.equal(f.engine.items[0].controller, 'A');
  assert.equal(f.engine.items[0].status, 'finalized');

  f.answers.set(paymentChoice.id, '放弃装配');
  // The response resumes the suspended Resolve; the following pass hands
  // Priority back so the completed Chain item can be removed.
  f.engine.pass(f.engine.priority);
  assert.equal(f.kernel.player('A').energy, 0, 'only the Unit play cost was paid');
  assert.deepEqual(f.kernel.player('A').power, ['Fury'], 'the selected Equip cost remains unpaid');
  assert.deepEqual(f.kernel.getObject('equipment').attachedTo, oldHost);
  assert.notDeepEqual(f.kernel.getObject('equipment').attachedTo, f.kernel.getObject('lucian').ref);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), false);
  const paymentTrace = f.engine.trace.filter(entry => entry.item === 'trigger:1').map(entry => entry.step);
  assert.deepEqual(paymentTrace.slice(-4), ['finalized', 'resolve-start', 'resolved', 'removed'],
    'the unpayable branch reaches Resolve completion without an attachment event');
  assert.equal(f.kernel.linked('weaponmaster-choice/weaponmaster-pay.payment'), undefined,
    'the failed payment and attach branch leaves no successful zero-plan receipt');
  assert.notDeepEqual(f.kernel.stateForTest(), before, 'the Unit and its play cost are the only committed changes');
  assert.deepEqual(f.engine.items, []);
  assert.equal(f.engine.trace.filter(entry => entry.step === 'resolved' && entry.item === 'trigger:1').length, 1);
});

test('core-1.5 / CR 821.1.c.2 / CR 821.1.c.6: successful control still pays and attaches', () => {
  const f = runtime({ power: ['Fury'], equipmentKeywords: [equip({ domains: ['Fury'] })] });
  f.play();
  assert.equal(f.requests.filter(request => request.id.includes('target:weaponmaster-equipment')).length, 1,
    'the target is locked once during Finalize');
  assert.deepEqual(f.kernel.getObject('equipment').attachedTo, f.kernel.getObject('lucian').ref);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-attached').length, 1);
  assert.deepEqual(f.engine.items, []);
});

test('core-1.5 fail-closed / CR 821.1.c.2: malformed authoritative Equip data does not pay or attach', () => {
  const f = runtime({ equipmentKeywords: [{ id: 'Equip', value: 1 }] });
  assert.throws(f.play, error =>
    error?.reason === 'judge-required' && /821\.1\.c\.2: missing authoritative Equip-cost binding/.test(String(error.message)));
  assert.equal(f.kernel.getObject('equipment').attachedTo, null);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), false);
});

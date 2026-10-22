import assert from 'node:assert/strict';
import test from 'node:test';

import veteranPoro from '../../../card-dsl/dist/cards/sfd/veteran-poro.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { world } from '../../dist/effects/testing/index.js';

const constant = value => ({ kind: 'constant', value });
const CARD_ID = veteranPoro.canonicalCardId;
const BASE = { type: 'base', player: 'A' };

const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function runtime({ energy = 10, power = ['Fury'], equipPower = 'any', equipAmount = 2, equipment = true, build } = {}) {
  const builder = world()
    .player('A', { energy, power })
    .player('B', { energy: 10, power: ['Fury'] })
    .base('poro', { cardId: CARD_ID, types: ['unit'], tags: ['Poro'], zone: 'hand', location: null, energy: 2, power: [], might: 2 });
  if (equipment) builder.object('equipment', {
    cardId: 'test:equipment', types: ['gear'], tags: ['Equipment'], zone: 'board', location: BASE,
    energy: null, power: null, might: null,
    keywords: [{
      id: 'Equip', value: 1,
      params: { cost: { kind: 'activated', payments: [{ kind: 'power', amount: constant(equipAmount), allowedDomains: [equipPower] }] } }
    }],
  });
  build?.(builder);
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === 'select-objects' && request.id === 'target:weaponmaster-equipment') {
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
  const binding = createProgramBinding({ cardPrograms: [admitted(veteranPoro)] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const settle = () => {
    for (let guard = 0; engine.items.length; guard++) {
      if (guard > 50) throw new Error('Chain did not settle');
      engine.pass(engine.priority);
    }
  };
  const play = () => {
    const source = kernel.getObject('poro');
    engine.execute(binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source));
    settle();
  };
  return { kernel, engine, requests, play };
}

test('Weaponmaster pays the selected Equipment printed [A] Equip cost and attaches it', () => {
  const f = runtime();
  f.play();
  assert.deepEqual(f.kernel.player('A').energy, 8, 'only the unit play cost remains paid');
  assert.deepEqual(f.kernel.player('A').power, [], 'the one Universal Equip Power is paid');
  assert.deepEqual(f.kernel.getObject('equipment').attachedTo, f.kernel.getObject('poro').ref);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-attached').length, 1);
  assert.equal(f.requests.filter(request => request.id === 'target:weaponmaster-equipment').length, 1);
});

test('Weaponmaster reduces a one-[A] Equip cost to zero without charging Energy', () => {
  const f = runtime({ energy: 2, power: [], equipAmount: 1 });
  f.play();
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.deepEqual(f.kernel.getObject('equipment').attachedTo, f.kernel.getObject('poro').ref);
});

test('Weaponmaster with no selectable Equipment declines without extra payment or attachment', () => {
  const f = runtime({ equipment: false });
  f.play();
  assert.equal(f.kernel.player('A').energy, 8);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.equal(f.kernel.getObject('poro').attachedTo, null);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), false);
});

test('Weaponmaster aborts atomically when the discounted Equip cost is unpayable', () => {
  const f = runtime({ energy: 2, power: [] });
  const beforeUnit = f.kernel.getObject('poro');
  const beforeEquipment = f.kernel.getObject('equipment');
  const beforeLinks = f.kernel.linkedSnapshot();
  assert.throws(f.play, /insufficient matching Power/i);
  assert.deepEqual(f.kernel.linkedSnapshot(), beforeLinks, 'the failed trigger leaves no finalized cost or payment link');
  assert.equal(f.kernel.player('A').energy, 0, 'the successful unit play remains paid');
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.getObject('equipment').zone, beforeEquipment.zone);
  assert.deepEqual(f.kernel.getObject('equipment').ref, beforeEquipment.ref);
  assert.equal(f.kernel.getObject('equipment').attachedTo, null);
  assert.notDeepEqual(f.kernel.getObject('poro').ref, beforeUnit.ref);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), false);
});

test('Weaponmaster accepts [A] provenance across all six domains instead of hard-coding one Domain', () => {
  const f = runtime({ energy: 2, power: ['Order'], equipAmount: 1 });
  f.play();
  assert.deepEqual(f.kernel.player('A').power, ['Order'], 'the one-[A] cost is fully reduced');
  assert.deepEqual(f.kernel.getObject('equipment').attachedTo, f.kernel.getObject('poro').ref);
});

test('Weaponmaster never turns a named-domain Equip cost into an [A] discount', () => {
  const f = runtime({ energy: 2, power: ['Fury'], equipPower: 'Fury', equipAmount: 1 });
  assert.throws(f.play, /821\.1\.c\.3.*no \[A\] to reduce/);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.equal(f.kernel.getObject('equipment').attachedTo, null);
});

test('Weaponmaster reduces only the original [A] component of a mixed Equip cost', () => {
  const f = runtime({ energy: 2, power: ['Body'], equipment: false, build: builder => builder.object('equipment', {
    cardId: 'test:equipment', types: ['gear'], tags: ['Equipment'], zone: 'board', location: BASE,
    energy: null, power: null, might: null,
    keywords: [{
      id: 'Equip', value: 2,
      params: { cost: { kind: 'activated', payments: [
        { kind: 'power', amount: constant(1), allowedDomains: ['any'] },
        { kind: 'power', amount: constant(1), allowedDomains: ['Body'] }
      ] } }
    }]
  }) });
  f.play();
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, [], 'the mixed cost was paid');
  const payment = f.kernel.events.filter(event => event.action === 'pay').at(-1);
  assert.ok(payment);
  assert.deepEqual(payment.power, ['Body'], 'only the named-domain component remains after reducing [A]');
  assert.deepEqual(f.kernel.getObject('equipment').attachedTo, f.kernel.getObject('poro').ref);
});

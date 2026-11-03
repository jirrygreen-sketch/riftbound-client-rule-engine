// RIFT-1187 (player report 5434b6d1, room 0ef60468): after Yone, Blademaster
// was played with an Equipment selected for [Weaponmaster] and no Power left,
// every Pass was rejected with "Duel resources: insufficient matching Power"
// and the game could not continue.
//
// Official evidence: Core Rules v1.5 (2026-10-09, effective 2026-10-16)
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 821.1.c.5/.6: an unpayable Equip cost leaves the Equipment where it is,
// does not activate Equip, and does not end the rest of the Chain.
// Yone (sfd-233-star-221, zh_CN gallery 2026-10-28) and Veteran Poro carry the
// same [Weaponmaster] keyword as Lucian, Merciless; the keyword expansion is
// identical, but the payment window and the no-attachment completion
// recognised only Lucian's card id.
// canonicalCardIds:
// Yone, Blademaster card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56
import assert from 'node:assert/strict';
import test from 'node:test';

import yone from '../../../card-dsl/dist/cards/rad/yone-blademaster.js';
import veteranPoro from '../../../card-dsl/dist/cards/sfd/veteran-poro.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const constant = value => ({ kind: 'constant', value });
const BASE = { type: 'base', player: 'A' };
const equip = domains => ({
  id: 'Equip', value: 1, params: { cost: {
    kind: 'activated', payments: [{ kind: 'power', amount: constant(1), allowedDomains: domains }],
  } },
});

function runtime(program, { power = [], equipmentDomains = ['Body'] } = {}) {
  const kernel = world()
    .player('A', { energy: 9, power })
    .player('B')
    .object('master', {
      cardId: program.canonicalCardId, ref: { id: 'master', zoneEntryId: 1 },
      types: ['unit'], tags: [], zone: 'hand', location: null, energy: 0, power: null, might: 3,
    })
    .object('equipment', {
      cardId: 'test:equipment', name: "Doran's Blade", types: ['gear'], tags: ['Equipment'], zone: 'board',
      location: BASE, energy: null, power: null, might: null, keywords: [equip(equipmentDomains)], attachedTo: null,
    })
    .build();
  const requests = [];
  const answers = new Map();
  const choose = request => {
    requests.push(request);
    if (request.type === 'mode' && request.id.includes(':order:')) return request.options[0];
    if (request.type === 'mode' && request.options.includes('支付') && request.options.includes('放弃装配')) {
      if (!answers.has(request.id)) throw new AwaitChoice(request);
      return answers.get(request.id);
    }
    if (request.type === 'select-objects' && request.id.includes('target:weaponmaster-equipment')) {
      return request.options.filter(ref => ref.id === 'equipment');
    }
    if (request.type === 'select-objects' && request.options.length === request.min) return [...request.options];
    if (request.type === 'select-objects' && request.min === 0) return [];
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
  const binding = createProgramBinding({ cardPrograms: [program] });
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
    const source = kernel.getObject('master');
    engine.execute(binding.describePlay({ type: 'play', player: 'A', object: source.ref }, source));
    settle();
  };
  return { kernel, engine, requests, answers, play, settle };
}

for (const [name, program] of [['Yone, Blademaster', yone], ['Veteran Poro', veteranPoro]]) {
  test(`RIFT-1187 / CR 821.1.c.5: ${name} offers the Weaponmaster payment window instead of stopping the Chain`, () => {
    assert.equal(program.status, 'executable');
    const f = runtime(program, { power: [], equipmentDomains: ['Body'] });
    let request;
    try {
      f.play();
      assert.fail('an unpayable Equip cost must ask to pay or decline');
    } catch (error) {
      assert.ok(error instanceof AwaitChoice, String(error));
      request = error.request;
    }
    assert.deepEqual(request.options, ['支付', '放弃装配']);
    assert.equal(request.chooser, 'A');
    // Card names are shown only in official Chinese; the engine has only the
    // English printed name, so the prompt does not name the Equipment.
    assert.equal(request.prompt, '所选装备的装配费用：1 点摧破符能，当前不足。可先横置或回收符文补足，再选择支付；或放弃装配。');
    assert.doesNotMatch(request.prompt, /Doran/u);
    f.answers.set(request.id, '放弃装配');
    f.settle();
    assert.equal(f.kernel.getObject('equipment').attachedTo, null);
    assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === 'object-attached'), false);
    assert.deepEqual(f.engine.items, [], 'the trigger resolves and the Chain empties');
  });

  test(`RIFT-1187 / CR 821.1.c.2: ${name} still pays and attaches when the Equip cost is payable`, () => {
    const f = runtime(program, { power: ['Body'], equipmentDomains: ['Body'] });
    f.play();
    assert.deepEqual(f.kernel.getObject('equipment').attachedTo, f.kernel.getObject('master').ref);
    assert.deepEqual(f.kernel.player('A').power, []);
    assert.equal(f.requests.some(request => request.options?.includes?.('放弃装配')), false,
      'a payable cost asks nothing extra');
  });
}

import assert from 'node:assert/strict';
import test from 'node:test';

import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const CANONICAL = rumbleHotheaded.canonicalCardId;
const RULES_URL = 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf';
const TRASH_MECH_CANONICAL = 'synthetic:RIFT-953-trash-mech';
const TRASH_MECH_PRINTED = Object.freeze({
  id: 'synthetic:rift-953-trash-mech-printing',
  canonicalCardId: TRASH_MECH_CANONICAL,
  cardType: 'Unit',
  domains: Object.freeze(['Mind']),
  energy: 5,
  power: null,
});
const RULES = Object.freeze({
  version: '1.5',
  dated: '2026-10-09',
  effective: '2026-10-16',
  url: RULES_URL,
  clauses: ['204.1.c', '204.3.a', '355.10.c.1', '356.4.g', '383.3.a', '383.3.b.1', '404.1.b.1', '417.1.c'],
});

function runtime({ accept = true, energy = 10, fodderMight = 3, mechEnergy = 5, onFinalize = () => {} } = {}) {
  const program = { ...rumbleHotheaded, status: 'executable', judgeReason: undefined };
  const trashMechProgram = {
    canonicalCardId: TRASH_MECH_CANONICAL,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'Synthetic RIFT-953 Trash Mech.',
    abilities: [],
  };
  const builder = world().player('A').player('B', { energy: 10 })
    .base('rumble', { cardId: CANONICAL, tags: ['Mech'], might: 4, owner: 'A', controller: 'A', location: { type: 'base', player: 'A' } })
    .base('fodder', { tags: [], types: ['unit'], might: fodderMight, owner: 'A', controller: 'A', location: { type: 'base', player: 'A' } })
    .card('trash-mech', { cardId: trashMechProgram.canonicalCardId, zone: 'trash', types: ['unit'], tags: ['Mech'], energy: mechEnergy, power: null, might: 3 });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  let finalizedOnce = false;
  let flow;
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'optional') {
      if (accept && request.id.startsWith('finalize:') && !finalizedOnce) {
        finalizedOnce = true;
        onFinalize(kernel, flow);
      }
      return accept;
    }
    if (request.type === 'mode' && request.id.includes(':order:')) return request.options[0];
    if (request.type === 'select-objects') {
      if (request.id === 'target:rumble.mech-in-trash') return request.options.filter(ref => ref.id === 'trash-mech');
      if (request.id.endsWith(':pick:rumble.fodder')) return request.options.filter(ref => ref.id === 'fodder');
      if (request.min === 0) return [];
    }
    throw new AwaitChoice(request);
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
  const binding = createProgramBinding({
    cardPrograms: [program, trashMechProgram],
    printedCatalog: [TRASH_MECH_PRINTED],
  });
  flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  assert.equal(flow.chain.commit({ type: 'gain-energy', player: 'A', amount: energy }).status, 'done');
  const energyBeforePayment = kernel.player('A').energy;
  assert.deepEqual(binding.registerProgramTriggers(flow.chain, kernel.getObject('rumble')), ['program:rumble:1:1']);
  assert.equal(flow.chain.commit({
    type: 'move-location', object: kernel.ref('rumble'), to: { type: 'battlefield', id: 'bf1' }
  }).status, 'done');
  flow.advance();
  const initial = {
    energy: energyBeforePayment,
    fodder: kernel.getObject('fodder').zone,
    fodderRef: kernel.ref('fodder'),
    mech: kernel.getObject('trash-mech').zone,
    mechRef: kernel.ref('trash-mech'),
    items: 0,
  };
  return { kernel, flow, requests, energyBeforePayment, initial };
}

function settleProduction(f) {
  for (let guard = 0; guard < 200; guard++) {
    if (f.flow.chain.items.length) {
      if (f.flow.chain.items.some(item => item.status === 'pending')) f.flow.advance();
      else f.flow.pass(f.flow.chain.priority);
      continue;
    }
    if (f.flow.chain.focus !== null) {
      f.flow.pass(f.flow.chain.focus);
      continue;
    }
    if (f.flow.chain.priority !== null) {
      f.flow.pass(f.flow.chain.priority);
      continue;
    }
    if (f.flow.combat.active) {
      f.flow.advance();
      continue;
    }
    return;
  }
  throw new Error('production Conquer flow did not settle');
}

function captureState(f) {
  return {
    energy: f.energyBeforePayment,
    fodder: f.kernel.getObject('fodder').zone,
    fodderRef: f.kernel.ref('fodder'),
    mech: f.kernel.getObject('trash-mech').zone,
    mechRef: f.kernel.ref('trash-mech'),
    items: 0,
  };
}

test('RIFT-953: Finalize receipt carries recycled Might into Resolve and plays the Trash Mech', () => {
  assert.deepEqual(RULES, {
    version: '1.5', dated: '2026-10-09', effective: '2026-10-16', url: RULES_URL,
    clauses: ['204.1.c', '204.3.a', '355.10.c.1', '356.4.g', '383.3.a', '383.3.b.1', '404.1.b.1', '417.1.c'],
  });
  const f = runtime();
  const conquer = () => f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer');
  settleProduction(f);
  assert.equal(conquer().length, 1);
  assert.deepEqual(conquer()[0].object.ref, f.kernel.ref('rumble'));
  const requested = id => f.requests.filter(request => request.id === id);
  assert.equal(requested('finalize:trigger:1:optional').length, 1);
  assert.equal(requested('target:rumble.mech-in-trash').length, 1);
  const fodderChoices = f.requests.filter(request => request.id.endsWith(':pick:rumble.fodder'));
  assert.equal(fodderChoices.length, 1);
  assert.deepEqual(requested('target:rumble.mech-in-trash')[0].options.map(ref => ref.id), ['trash-mech']);
  assert.deepEqual(fodderChoices[0].options.map(ref => ref.id), ['fodder']);
  assert.equal(f.kernel.getObject('fodder').zone, 'deck');
  assert.deepEqual(f.kernel.zone('A', 'deck').at(-1), f.kernel.ref('fodder'));
  assert.equal(f.kernel.getObject('trash-mech').zone, 'board');
  assert.equal(f.kernel.getObject('trash-mech').controller, 'A');
  assert.equal(f.energyBeforePayment, 10);
  assert.equal(f.kernel.player('A').energy, 0, 'TurnFlow empties the Rune Pool after Resolve');
  const playedPlans = Object.entries(f.kernel.linkedSnapshot())
    .filter(([key]) => key.endsWith("rumble.play-mech.playedCostPlans"))
    .flatMap(([, value]) => Array.isArray(value) ? value : []);
  assert.equal(playedPlans.length, 1);
  assert.equal(playedPlans[0].energy, 2, 'the frozen nested Play cost is 5 - recycled Might 3');
  assert.equal(playedPlans[0].parameters.costPlan.discounts[0].amount, 3);
  assert.ok(f.flow.chain.trace.some(entry => entry.step === 'resolved' && entry.item === 'trigger:1'));
});

test('RIFT-953: declining the leading may neither choose, recycle nor play', () => {
  const f = runtime({ accept: false });
  settleProduction(f);
  assert.deepEqual(f.requests.map(request => request.id), ['finalize:trigger:1:optional']);
  assert.deepEqual(captureState(f), f.initial);
});

test('RIFT-953: an unpayable nested Play leaves the Finalize recycle paid and admits no Mech', () => {
  const f = runtime({ energy: 1 });
  assert.throws(() => settleProduction(f), error => /cannot-pay-cost|insufficient Energy|cost/i.test(error.message));
  assert.equal(f.kernel.getObject('trash-mech').zone === 'board', false, 'the reduced cost never becomes a free Play');
  assert.equal(f.kernel.getObject('fodder').zone, 'deck', 'the Finalize recycle cost remains paid');
  assert.equal(f.kernel.player('A').energy, 1, 'the failed nested Play pays no additional Energy');
});

test('RIFT-953: a play target that left Trash before Resolve is never rebound or played', () => {
  let moved = false;
  const f = runtime({ onFinalize(kernel) {
    if (moved) return;
    moved = true;
    assert.equal(kernel.perform({ type: 'move-zone', object: kernel.ref('trash-mech'), to: 'banishment' }).status, 'done');
  } });
  settleProduction(f);
  assert.deepEqual(captureState(f), f.initial, 'Finalize rolls back when its play target disappears');
});

export { RULES };

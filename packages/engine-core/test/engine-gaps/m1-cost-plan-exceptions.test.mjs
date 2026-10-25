// RIFT-1051: Rumble's Conquer trigger plays a selected Trash Mech. This
// regression exercises the trusted printed-cost path through the real
// ProgramBinding -> ChainEngine/TurnFlow -> lifecycle assembly.
//
// Official evidence: Core Rules v1.5, published 2026-10-09 and effective
// 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 131.2/131.3: Energy and Power are separate printed cost components.
// - 355.17.b: a mandatory cost choice that cannot satisfy its restriction
//   causes the card to fail to finalize.
// - 356.1.c: a Base Cost reference uses the Printed Base Cost.
// - 356.4.c/.c.1/.c.2: Rumble changes only Energy; Power and the zero floor
//   remain intact.
// - 357.1/357.2: pay the combined resource and non-standard costs together.
// - 420.3/420.3.b: effect Play follows the normal Play procedure.
// Radiance patch notes effective 2026-10-16 contain no Rumble-specific ruling.
// Catalog source: packages/card-data/data/deck-catalog.json. Forecaster is
// SFD-065/221 (2 Energy, no Power); Ferrous Forerunner is SFD-021/221
// (6 Energy, 1 Fury Power).
import assert from 'node:assert/strict';
import test from 'node:test';

import ferrousForerunner from '../../../card-dsl/dist/cards/sfd/ferrous-forerunner.js';
import forecaster from '../../../card-dsl/dist/cards/sfd/forecaster.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const RULES_URL = 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf';
const RUMBLE = rumbleHotheaded.canonicalCardId;
const FORECASTER_PRINTED = Object.freeze({
  id: 'sfd-065-221',
  canonicalCardId: forecaster.canonicalCardId,
  cardType: 'Unit',
  domains: Object.freeze(['Mind']),
  energy: 2,
  power: null,
});
const FERROUS_PRINTED = Object.freeze({
  id: 'sfd-021-221',
  canonicalCardId: ferrousForerunner.canonicalCardId,
  cardType: 'Unit',
  domains: Object.freeze(['Fury']),
  energy: 6,
  power: 1,
});

function runtime({
  targetProgram,
  targetEnergy,
  targetPower,
  targetMight = 3,
  energy = 0,
  power = [],
  printedCatalog,
  fodder = true,
}) {
  const builder = world().player('A', { energy, power }).player('B', { energy: 10 })
    .base('rumble', {
      cardId: RUMBLE, owner: 'A', controller: 'A', types: ['unit'], tags: ['Mech'], might: 4,
      location: { type: 'base', player: 'A' },
    })
    .card('trash-mech', {
      cardId: targetProgram.canonicalCardId, owner: 'A', zone: 'trash', types: ['unit'], tags: ['Mech'],
      energy: targetEnergy, power: targetPower, might: targetMight,
    });
  if (fodder) {
    builder.base('fodder', {
      owner: 'A', controller: 'A', types: ['unit'], tags: [], might: 3,
      location: { type: 'base', player: 'A' },
    });
  }
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const finalized = [];
  let flow;
  const choose = request => {
    if (request.type === 'optional') return request.id.startsWith('finalize:');
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
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({
    cardPrograms: [rumbleHotheaded, targetProgram],
    ...(printedCatalog === undefined ? {} : { printedCatalog }),
  });
  flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    describePlay: binding.describePlay,
  });
  const lifecycle = binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  if (energy > 0) assert.equal(flow.chain.commit({ type: 'gain-energy', player: 'A', amount: energy }).status, 'done');
  if (power.length > 0) assert.equal(flow.chain.commit({ type: 'gain-power', player: 'A', power }).status, 'done');
  assert.deepEqual(binding.registerProgramTriggers(flow.chain, kernel.getObject('rumble')), ['program:rumble:1:1']);

  const observe = flow.chain.pipeline.onEvent;
  flow.chain.pipeline.onEvent = event => {
    observe?.(event);
    if (event.timingPoint !== 'chain-item-finalize' || event.object?.ref.id !== 'trash-mech') return;
    const item = flow.chain.items.find(candidate =>
      candidate.source.ref.id === 'trash-mech' && candidate.kind === 'unit');
    if (item?.costPlan !== undefined) finalized.push(structuredClone(item.costPlan));
  };
  assert.equal(flow.chain.commit({
    type: 'move-location', object: kernel.ref('rumble'), to: { type: 'battlefield', id: 'bf1' },
  }).status, 'done');
  flow.advance();
  return { kernel, flow, binding, lifecycle, finalized };
}

function settle(f) {
  for (let guard = 0; guard < 200; guard++) {
    if (f.flow.chain.items.some(item => item.status === 'pending')) { f.flow.advance(); continue; }
    if (f.flow.chain.items.length) { f.flow.pass(f.flow.chain.priority); continue; }
    if (f.flow.chain.focus !== null) { f.flow.pass(f.flow.chain.focus); continue; }
    if (f.flow.chain.priority !== null) { f.flow.pass(f.flow.chain.priority); continue; }
    if (f.flow.combat.active) { f.flow.advance(); continue; }
    return;
  }
  throw new Error('production Conquer flow did not settle');
}

function nestedPlans(f) {
  return Object.entries(f.kernel.linkedSnapshot())
    .filter(([key]) => key.endsWith('rumble.play-mech.playedCostPlans'))
    .flatMap(([, value]) => Array.isArray(value) ? value : []);
}

test('RIFT-1051 Rumble plays Forecaster with no printed Power without inventing a numeric Power cost', () => {
  const f = runtime({
    targetProgram: forecaster,
    targetEnergy: 2,
    targetPower: null,
    targetMight: 2,
    printedCatalog: [FORECASTER_PRINTED],
  });
  settle(f);

  assert.equal(f.kernel.getObject('trash-mech').zone, 'board');
  assert.equal(f.kernel.getObject('fodder').zone, 'deck');
  assert.equal(f.finalized.length, 1);
  assert.equal(f.finalized[0].printed.energy, 2);
  assert.equal(f.finalized[0].printed.power, null);
  assert.equal(f.finalized[0].total.energy, 0, 'CR 356.4.c.2 floors Energy at zero');
  assert.deepEqual(f.finalized[0].total.power, [], 'null printed Power is no Power, never inferred from Mind');
  const plans = nestedPlans(f);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].energy, 0);
  assert.deepEqual(plans[0].power, []);
  f.lifecycle.detach();
});

test('RIFT-1051 Rumble preserves numeric Ferrous Forerunner Power from the trusted catalog', () => {
  const f = runtime({
    targetProgram: ferrousForerunner,
    targetEnergy: 6,
    targetPower: ['Fury'],
    targetMight: 6,
    energy: 3,
    power: ['Fury'],
    printedCatalog: [FORECASTER_PRINTED, FERROUS_PRINTED],
  });
  settle(f);

  assert.equal(f.kernel.getObject('trash-mech').zone, 'board');
  assert.equal(f.finalized.length, 1);
  assert.equal(f.finalized[0].printed.energy, 6);
  assert.deepEqual(f.finalized[0].printed.power, ['Fury'],
    'the receipt preserves Domain identity separately from its trusted numeric amount');
  assert.equal(f.finalized[0].total.energy, 3);
  assert.deepEqual(f.finalized[0].total.power, [{ amount: 1, allowedDomains: ['Fury'] }]);
  const plans = nestedPlans(f);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].energy, 3);
  assert.deepEqual(plans[0].power, ['Fury']);
  assert.deepEqual(f.kernel.player('A').power, []);
  f.lifecycle.detach();
});

export { RULES_URL };

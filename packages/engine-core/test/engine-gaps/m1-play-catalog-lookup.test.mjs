// RIFT-985: effect Play resolves base:"printed" through the trusted catalog
// source on the ProgramBinding. This is the same canonical id and 8 Energy +
// 2 Mind Power projection used by ordinary Breakneck Mech Play.
//
// Official evidence: Core Rules v1.5, published 2026-10-09 and effective
// 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 356.1.c: effects referring to Base Cost use the Printed Base Cost.
// - 356.4.c/.c.1/.c.2: a component discount changes only that component and
//   cannot reduce it below zero.
// - 357.1: payment combines the resulting Energy and Power costs.
// - 420.3/420.3.b: a game-effect Play follows the normal Play steps.
// Breakneck Mech's live catalog row is SFD-071/221: Unit, Mind, 8 Energy,
// 2 Power, 7 Might.
import assert from 'node:assert/strict';
import test from 'node:test';

import breakneckMech from '../../../card-dsl/dist/cards/sfd/breakneck-mech.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const RULES_URL = 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf';
const RUMBLE_CANONICAL = rumbleHotheaded.canonicalCardId;
const constant = value => ({ kind: 'constant', value });

// Production card-data row: packages/card-data/data/deck-catalog.json,
// SFD-071/221 Breakneck Mech. canonicalCardId is the generated card program id.
const BREAKNECK_PRINTED = Object.freeze({
  id: 'sfd-071-221',
  canonicalCardId: breakneckMech.canonicalCardId,
  cardType: 'Unit',
  domains: Object.freeze(['Mind']),
  energy: 8,
  power: 2,
});

function rumbleWithCatalogPrintedBase() {
  const revised = structuredClone(rumbleHotheaded);
  const optional = revised.abilities
    .find(ability => ability.kind === 'triggered' && ability.trigger?.at === 'conquer')
    ?.body.find(instruction => instruction.op === 'choice.optional');
  assert.ok(optional, 'Rumble keeps its leading Finalize may');
  const nested = optional.args.body.value;
  const originalPlay = nested.find(instruction => instruction.id === 'rumble.play-mech');
  assert.ok(originalPlay, 'Rumble retains its Trash-Mech Play');
  if (originalPlay.args.cost?.value?.base === 'printed') return { ...revised, status: 'executable', judgeReason: undefined };
  const pay = nested.find(instruction => instruction.id === 'rumble.recycle-cost');
  assert.ok(pay && originalPlay, 'Rumble retains its recycle cost and Trash-Mech Play');
  const play = {
    ...originalPlay,
    linkedTo: pay.id,
    args: {
      ...originalPlay.args,
      cost: constant({
        kind: 'cost.modify',
        id: 'rumble.mech-cost',
        base: 'printed',
        cost: {
          kind: 'explicit',
          energy: {
            kind: 'object-property',
            object: { target: 'rumble.mech-in-trash' },
            property: 'energy',
          },
        },
        modifier: {
          kind: 'reduce',
          resource: 'energy',
          amount: {
            kind: 'object-property',
            object: { linked: 'rumble.recycle-cost' },
            property: 'might',
          },
        },
      }),
    },
  };
  optional.args.body = constant([pay, play]);
  return { ...revised, status: 'executable', judgeReason: undefined };
}

function runtime({ withCatalog = true } = {}) {
  const builder = world().player('A').player('B', { energy: 10 })
    .base('rumble', {
      cardId: RUMBLE_CANONICAL, types: ['unit'], tags: ['Mech'], might: 4,
      owner: 'A', controller: 'A', location: { type: 'base', player: 'A' },
    })
    .base('fodder', {
      types: ['unit'], tags: [], might: 3, owner: 'A', controller: 'A',
      location: { type: 'base', player: 'A' },
    })
    .card('trash-mech', {
      cardId: breakneckMech.canonicalCardId, zone: 'trash', types: ['unit'], tags: ['Mech'],
      energy: 8, power: null, might: 7,
    });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const costs = [];
  let flow;
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'optional') return true;
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
    cardPrograms: [rumbleWithCatalogPrintedBase(), breakneckMech],
    ...(withCatalog ? { printedCatalog: [BREAKNECK_PRINTED] } : {}),
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
  assert.equal(flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 10 }).status, 'done');
  assert.equal(flow.chain.commit({ type: 'gain-power', player: 'A', power: ['Mind', 'Mind'] }).status, 'done');
  assert.deepEqual(binding.registerProgramTriggers(flow.chain, kernel.getObject('rumble')), ['program:rumble:1:1']);
  const observe = flow.chain.pipeline.onEvent;
  flow.chain.pipeline.onEvent = event => {
    observe?.(event);
    if (event.timingPoint === 'chain-item-finalize' && event.object?.ref.id === 'trash-mech') {
      const item = flow.chain.items.find(candidate => candidate.source.ref.id === 'trash-mech' && candidate.kind === 'unit');
      if (item?.costPlan !== undefined) costs.push(structuredClone(item.costPlan));
    }
  };
  assert.equal(flow.chain.commit({
    type: 'move-location', object: kernel.ref('rumble'), to: { type: 'battlefield', id: 'bf1' },
  }).status, 'done');
  flow.advance();
  return { kernel, flow, costs, lifecycle };
}

function settle(f) {
  for (let guard = 0; guard < 200; guard++) {
    if (f.flow.chain.items.length) {
      if (f.flow.chain.items.some(item => item.status === 'pending')) f.flow.advance();
      else f.flow.pass(f.flow.chain.priority);
      continue;
    }
    if (f.flow.chain.focus === null && !f.flow.combat.active) return;
    if (f.flow.chain.focus !== null) { f.flow.pass(f.flow.chain.focus); continue; }
    if (f.flow.combat.active) { f.flow.advance(); continue; }
    return;
  }
  throw new Error('production Conquer flow did not settle');
}

function assertBreakneckPaid(f) {
  assert.equal(f.kernel.getObject('trash-mech').zone, 'board');
  assert.equal(f.kernel.getObject('fodder').zone, 'deck');
  assert.equal(f.costs.length, 1, 'the nested Play finalized exactly once');
  const [plan] = f.costs;
  assert.equal(plan.printed.energy, 8, 'catalog printed Energy was frozen before Resolve');
  const basePower = plan.components.find(component => component.stage === 'base')?.cost.power;
  assert.deepEqual(basePower, [
    { amount: 1, allowedDomains: ['Mind'] },
    { amount: 1, allowedDomains: ['Mind'] },
  ], 'catalog printed Power 2 is frozen before Resolve');
  assert.equal(plan.total.energy, 5, '8 Energy minus recycled Might 3');
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: ['Mind'] },
    { amount: 1, allowedDomains: ['Mind'] },
  ]);
  const playedPlans = Object.entries(f.kernel.linkedSnapshot())
    .filter(([key]) => key.endsWith('rumble.play-mech.playedCostPlans'))
    .flatMap(([, value]) => Array.isArray(value) ? value : []);
  assert.equal(playedPlans.length, 1);
  assert.equal(playedPlans[0].energy, 5);
  assert.deepEqual(playedPlans[0].power, ['Mind', 'Mind']);
  assert.equal(playedPlans[0].parameters.costPlan.printed.power, 2, 'the frozen receipt preserves printed Power');
  assert.equal(f.kernel.player('A').power.length, 0);
}

test('RIFT-985 Rumble plays real Breakneck Mech from Trash using binding catalog printed cost', () => {
  const f = runtime();
  settle(f);
  assertBreakneckPaid(f);
});

test('RIFT-985 missing catalog entry for a no-play-cost program stays judge-required', () => {
  assert.equal(breakneckMech.abilities.some(ability => ability.kind === 'play'), false);
  const f = runtime({ withCatalog: false });
  assert.throws(
    () => settle(f),
    error => /judge-required|printed catalog|exact numeric Power provenance/i.test(error.message),
  );
  assert.equal(f.kernel.getObject('trash-mech').zone, 'trash');
  assert.deepEqual(f.kernel.player('A').power, ['Mind', 'Mind']);
  assert.equal(f.costs.length, 0);
});

test('RIFT-985 detaching the binding removes its catalog lookup and stays fail-closed', () => {
  const f = runtime();
  f.lifecycle.detach();
  assert.throws(
    () => settle(f),
    error => /judge-required|printed catalog|exact numeric Power provenance/i.test(error.message),
  );
  assert.equal(f.kernel.getObject('trash-mech').zone, 'trash');
  assert.equal(f.costs.length, 0);
});

test('RIFT-985 malformed catalog rows are rejected before play', () => {
  assert.throws(
    () => createProgramBinding({ cardPrograms: [breakneckMech], printedCatalog: [null] }),
    error => /invalid-program|must be an object/i.test(error.message),
  );
});

test('RIFT-985 two live bindings keep independent catalog lookups', () => {
  const program = rumbleWithCatalogPrintedBase();
  const first = createProgramBinding({ cardPrograms: [program, breakneckMech], printedCatalog: [BREAKNECK_PRINTED] });
  const other = createProgramBinding({
    cardPrograms: [program, breakneckMech],
    printedCatalog: [{ ...BREAKNECK_PRINTED, energy: 9 }],
  });
  assert.equal(first.printedCatalog(breakneckMech.canonicalCardId).energy, 8);
  assert.equal(other.printedCatalog(breakneckMech.canonicalCardId).energy, 9);
});

export { RULES_URL };

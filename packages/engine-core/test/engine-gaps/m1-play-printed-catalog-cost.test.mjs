// RIFT-983: an effect Play whose descriptor says base:"printed" uses the same
// complete catalog projection as ordinary card Play. The target CardProgram
// may have executable static/replacement abilities without carrying a Play
// ability cost; that absence must not discard a numeric catalog Power cost.
//
// Official evidence: Core Rules v1.5, published 2026-10-09 and effective
// 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 131.2/131.3: Energy and Power are separate printed cost components.
// - 206: cost checks use the printed cost.
// - 356.1.c: an effect's Base Cost reference uses the Printed Base Cost.
// - 356.4.c/.c.1/.c.2: a component discount changes only that component and
//   cannot reduce it below zero.
// - 357.1: Pay combines the resulting Energy and Power components.
// - 420.3/420.3.b: a game-effect Play follows normal Play procedure.
import assert from 'node:assert/strict';
import test from 'node:test';

import breakneckMech from '../../../card-dsl/dist/cards/sfd/breakneck-mech.js';
import patchedPorobot from '../../../card-dsl/dist/cards/ven/patched-porobot.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const RULES_URL = 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf';
const RUMBLE_CANONICAL = rumbleHotheaded.canonicalCardId;
const constant = value => ({ kind: 'constant', value });

const breakneckPrinted = Object.freeze({
  id: 'sfd-071-221',
  cardType: 'Unit',
  domains: Object.freeze(['Mind']),
  energy: 8,
  power: 2,
});

const patchedPorobotPrinted = Object.freeze({
  id: 'ven-058-166',
  cardType: 'Unit',
  domains: Object.freeze(['Mind']),
  energy: 2,
  power: null,
});

function rumbleWithPrintedEnergyReduction(printed) {
  const revised = structuredClone(rumbleHotheaded);
  const triggered = revised.abilities.find(ability =>
    ability.kind === 'triggered' && ability.trigger?.at === 'conquer');
  assert.ok(triggered, 'Rumble keeps its real Conquer trigger');
  const optional = triggered.body.find(instruction => instruction.op === 'choice.optional');
  assert.ok(optional, 'Rumble keeps its leading Finalize may');
  const nested = optional.args.body.value;
  const pay = nested.find(instruction => instruction.id === 'rumble.recycle-cost');
  const originalPlay = nested.find(instruction => instruction.id === 'rumble.play-mech');
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
        ...(printed === undefined ? {} : { printed: structuredClone(printed) }),
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

const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });

function runtime({
  targetProgram,
  printed,
  energy = 10,
  power = [],
  targetEnergy,
  targetPower,
  targetMight = 7,
  targetTags = ['Mech'],
  fodderMight = 3,
} = {}) {
  const builder = world().player('A').player('B', { energy: 10 })
    .base('rumble', {
      cardId: RUMBLE_CANONICAL, types: ['unit'], tags: ['Mech'], might: 4,
      owner: 'A', controller: 'A', location: { type: 'base', player: 'A' },
    })
    .base('fodder', {
      types: ['unit'], tags: [], might: fodderMight, owner: 'A', controller: 'A',
      location: { type: 'base', player: 'A' },
    })
    .card('trash-mech', {
      cardId: targetProgram.canonicalCardId, zone: 'trash', types: ['unit'], tags: targetTags,
      energy: targetEnergy, power: targetPower, might: targetMight,
    });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  let finalized = null;
  let flow;
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'optional') return true;
    if (request.type === 'mode' && request.id.includes(':order:')) return request.options[0];
    if (request.type === 'select-objects') {
      if (request.id === 'target:rumble.mech-in-trash') {
        return request.options.filter(ref => ref.id === 'trash-mech');
      }
      if (request.id.endsWith(':pick:rumble.fodder')) {
        return request.options.filter(ref => ref.id === 'fodder');
      }
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
  const programs = [rumbleWithPrintedEnergyReduction(printed)];
  if (targetProgram.canonicalCardId !== RUMBLE_CANONICAL) programs.push(admitted(targetProgram));
  const binding = createProgramBinding({ cardPrograms: programs });
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
  if (power.length > 0) {
    assert.equal(flow.chain.commit({ type: 'gain-power', player: 'A', power }).status, 'done');
  }
  assert.deepEqual(binding.registerProgramTriggers(flow.chain, kernel.getObject('rumble')), ['program:rumble:1:1']);
  const observe = flow.chain.pipeline.onEvent;
  flow.chain.pipeline.onEvent = event => {
    observe?.(event);
    if (event.timingPoint === 'chain-item-finalize' && event.object?.ref.id === 'trash-mech') {
      const item = flow.chain.items.find(candidate => candidate.source.ref.id === 'trash-mech' && candidate.kind === 'unit');
      if (item?.costPlan !== undefined) {
        finalized = { plan: structuredClone(item.costPlan), payment: item.payment === undefined ? null : structuredClone(item.payment) };
      }
    }
  };
  assert.equal(flow.chain.commit({
    type: 'move-location', object: kernel.ref('rumble'), to: { type: 'battlefield', id: 'bf1' },
  }).status, 'done');
  flow.advance();
  return { kernel, flow, requests, get finalized() { return finalized; } };
}

function settle(f) {
  for (let guard = 0; guard < 200; guard++) {
    if (f.flow.chain.items.length) {
      if (f.flow.chain.items.some(item => item.status === 'pending')) f.flow.advance();
      else f.flow.pass(f.flow.chain.priority);
      continue;
    }
    if (f.flow.chain.focus !== null) { f.flow.pass(f.flow.chain.focus); continue; }
    if (f.flow.chain.priority !== null) { f.flow.pass(f.flow.chain.priority); continue; }
    if (f.flow.combat.active) { f.flow.advance(); continue; }
    return;
  }
  throw new Error('production Conquer flow did not settle');
}

test('RIFT-983 RIFT-953 leading-cost receipt plays real Breakneck Mech from the catalog printed base without a Play cost', () => {
  assert.equal(breakneckMech.abilities.some(ability => ability.kind === 'play'), false);
  const f = runtime({
    targetProgram: breakneckMech,
    printed: breakneckPrinted,
    energy: 10,
    power: ['Mind', 'Mind'],
    targetEnergy: 8,
    targetPower: ['Mind'],
    targetMight: 7,
  });
  settle(f);

  assert.equal(f.kernel.getObject('trash-mech').zone, 'board');
  assert.equal(f.kernel.getObject('fodder').zone, 'deck');
  assert.ok(f.finalized, 'the nested Play reached real Finalize');
  assert.equal(f.finalized.plan.printed.energy, 8);
  assert.deepEqual(f.finalized.plan.printed.power, ['Mind']);
  assert.equal(f.finalized.plan.total.energy, 5);
  assert.deepEqual(f.finalized.plan.total.power, [
    { amount: 1, allowedDomains: ['Mind'] },
    { amount: 1, allowedDomains: ['Mind'] },
  ]);
  const playedPlans = Object.entries(f.kernel.linkedSnapshot())
    .filter(([key]) => key.endsWith('rumble.play-mech.playedCostPlans'))
    .flatMap(([, value]) => Array.isArray(value) ? value : []);
  assert.equal(playedPlans.length, 1);
  assert.equal(playedPlans[0].energy, 5);
  assert.deepEqual(playedPlans[0].power, ['Mind', 'Mind']);
  assert.deepEqual(f.kernel.player('A').power, []);
});

test('RIFT-983 a catalog Powerless Mech still pays only the reduced Energy component', () => {
  assert.equal(patchedPorobot.abilities.some(ability => ability.kind === 'play'), false);
  const f = runtime({
    targetProgram: patchedPorobot,
    printed: patchedPorobotPrinted,
    targetEnergy: 2,
    targetPower: null,
    targetMight: 2,
    fodderMight: 1,
  });
  settle(f);

  assert.equal(f.kernel.getObject('trash-mech').zone, 'board');
  assert.ok(f.finalized);
  assert.equal(f.finalized.plan.printed.energy, 2);
  assert.equal(f.finalized.plan.printed.power, null);
  assert.equal(f.finalized.plan.total.energy, 1);
  assert.deepEqual(f.finalized.plan.total.power, []);
  const playedPlan = Object.entries(f.kernel.linkedSnapshot())
    .filter(([key]) => key.endsWith('rumble.play-mech.playedCostPlans'))
    .flatMap(([, value]) => Array.isArray(value) ? value : [])[0];
  assert.equal(playedPlan.energy, 1);
  assert.deepEqual(playedPlan.power, []);
});

test('RIFT-983 a missing trusted catalog projection stays judge-required without inferring Power from Domains', () => {
  const f = runtime({
    targetProgram: breakneckMech,
    energy: 10,
    power: ['Mind', 'Mind'],
    targetEnergy: 8,
    targetPower: ['Mind'],
    targetMight: 7,
  });
  assert.throws(
    () => settle(f),
    error => /judge-required|complete numeric Energy and Power/i.test(error.message),
  );
  assert.equal(f.kernel.getObject('trash-mech').zone, 'trash');
  assert.deepEqual(f.kernel.player('A').power, ['Mind', 'Mind']);
  assert.equal(f.finalized, null);
});

test('RIFT-983 malformed catalog projection is ignored and cannot create a payable base cost', () => {
  const f = runtime({
    targetProgram: breakneckMech,
    printed: { ...breakneckPrinted, domains: ['NotADomain'] },
    energy: 10,
    power: ['Mind', 'Mind'],
    targetEnergy: 8,
    targetPower: ['Mind'],
    targetMight: 7,
  });
  assert.throws(
    () => settle(f),
    error => /judge-required|complete numeric Energy and Power/i.test(error.message),
  );
  assert.equal(f.kernel.getObject('trash-mech').zone, 'trash');
  assert.deepEqual(f.kernel.player('A').power, ['Mind', 'Mind']);
  assert.equal(f.finalized, null);
});

export { RULES_URL };

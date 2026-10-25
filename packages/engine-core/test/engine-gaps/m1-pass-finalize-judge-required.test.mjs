// RIFT-1076: classify the failures that RIFT-1072 observed only after a Pass.
//
// The historical 7264ea68 journals contain 8 empty-name `judge-required`
// failures and one empty-name `invalid-cost-plan`. `parsePersistedHeadlessJournal`
// locates every recorded failure at the end of a Rumble Conquer resolution:
//
// - 001/Ferrous Forerunner: "complete numeric Energy and Power"
// - 027/Gem Jammer, 037/Gem Jammer, 059/Forecaster, 084/Dangerous Duo,
//   093/Dangerous Duo, 100/Forecaster: exact numeric Power provenance
// - 047: no legal object for Rumble's Finalize recycle cost
// - 067/Rumble Scrapper: "complete numeric Energy and Power"
// A Conquer wave may also contain Minefield's trigger. The recorded failure is
// associated with the last Rumble trigger item in that wave, not necessarily
// with the last Pending item (which can be Minefield).
//
// The empty name comes from the headless summary joining a failed `pass` to a
// play candidate; a Pass has no candidate. The first eight are not cards whose
// programs were judge-required. They are the pre-RIFT-1066 effect-Play adapter
// running without the trusted printed catalog, and must still fail closed if a
// production binding lacks that evidence. The 047 case was an engine defect at
// the 7264ea68 commit. RIFT-1067 now classifies an unperformable leading-may
// trigger at Finalize under CR 403.4 instead of leaking `invalid-cost-plan`
// from the later Pass.
//
// Official evidence: Core Rules v1.5, published 2026-10-09 and effective
// 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 356.1.c: Base Cost references use the card's Printed Base Cost.
// - 383.3.a/.b.1: leading may and its following cost are decided and paid while
//   finalizing the Triggered Ability.
// - 403.4/.a: a Pending trigger with too few legal choices is removed and that
//   removal is not a counter.
// - 420.3/.b: an effect Play uses the normal Play steps.
//
// Rumble, Hotheaded: card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870,
// packages/card-dsl/src/cards/sfd/rumble-hotheaded.ts (status executable).
// Ferrous Forerunner: card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3,
// packages/card-dsl/src/cards/sfd/ferrous-forerunner.ts (status executable).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import ferrousForerunner from '../../../card-dsl/dist/cards/sfd/ferrous-forerunner.js';
import rumbleHotheaded from '../../../card-dsl/dist/cards/sfd/rumble-hotheaded.js';
import { parsePersistedHeadlessJournal } from '../../../integration-tests/src/headless/stats.ts';
import { CostPlanError } from '../../dist/cost/plan-types.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const RULES_URL = 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf';
const RUMBLE = rumbleHotheaded.canonicalCardId;
const FERROUS = ferrousForerunner.canonicalCardId;
const FERROUS_PRINTED = Object.freeze({
  id: 'sfd-021-221',
  canonicalCardId: FERROUS,
  cardType: 'Unit',
  domains: Object.freeze(['Fury']),
  energy: 6,
  power: 1,
});
const FAIL_CLOSED_MESSAGES = Object.freeze([
  "A printed-base CostSpec requires the selected card's complete numeric Energy and Power programme",
  'A target Energy expression cannot replace a card Base Cost without exact numeric Power provenance',
]);
const HISTORICAL_SAMPLES = Object.freeze([
  ['001', 100, 13, 'trigger:8', FERROUS],
  ['027', 131, 11, 'trigger:13', 'card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9'],
  ['037', 85, 9, 'trigger:10', 'card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9'],
  ['047', 65, 7, 'trigger:5', null],
  ['059', 83, 10, 'trigger:11', 'card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40'],
  ['067', 65, 8, 'trigger:5', 'card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c'],
  ['084', 94, 10, 'trigger:10', 'card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91'],
  ['093', 125, 14, 'trigger:8', 'card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91'],
  ['100', 73, 8, 'trigger:6', 'card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40'],
]);

function persistedJournal(dataset, sample) {
  const [number] = sample;
  const path = `/root/swarm-rift/shared/${dataset}/journals/${number}-RIFT-990-m1-seed-${number}.journal.json`;
  return { path, journal: parsePersistedHeadlessJournal(readFileSync(path, 'utf8')) };
}

function last(array, predicate) {
  for (let index = array.length - 1; index >= 0; index -= 1) {
    if (predicate(array[index])) return array[index];
  }
  return undefined;
}

function rumbleEvidence(journal, sample) {
  const [, commandIndex, turn, item, targetCardId] = sample;
  const failure = journal.commands[commandIndex];
  assert.ok(failure?.failure, `${journal.seed} journals the expected failure`);
  const trigger = last(journal.events, event =>
    event.timingPoint === 'chain-item-pending' && event.details?.item === item);
  assert.ok(trigger, `${journal.seed} journals ${item}`);
  assert.equal(trigger.sourceCardId, RUMBLE);
  assert.equal(trigger.object?.cardId, RUMBLE);
  const targeted = last(journal.events, event =>
    event.timingPoint === 'became-target' && event.seq > trigger.seq);
  assert.equal(targeted?.object?.cardId ?? null, targetCardId);
  return { failure, trigger, targeted };
}

function rumbleConquer({ fodder = true, printedCatalog } = {}) {
  const builder = world().player('A').player('B', { energy: 10 })
    .base('rumble', {
      cardId: RUMBLE,
      types: ['unit'],
      tags: ['Mech'],
      might: 4,
      owner: 'A',
      controller: 'A',
      location: { type: 'base', player: 'A' },
    })
    .card('trash-mech', {
      cardId: FERROUS,
      zone: 'trash',
      types: ['unit'],
      tags: ['Mech'],
      energy: 6,
      power: ['Fury'],
      might: 6,
    });
  if (fodder) {
    builder.base('fodder', {
      types: ['unit'],
      tags: [],
      might: 3,
      owner: 'A',
      controller: 'A',
      location: { type: 'base', player: 'A' },
    });
  }
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === 'optional') return request.id.startsWith('finalize:');
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
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
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
    cardPrograms: [rumbleHotheaded, ferrousForerunner],
    ...(printedCatalog === undefined ? {} : { printedCatalog }),
  });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    describePlay: binding.describePlay,
  });
  const lifecycle = binding.attachLifecycle(flow.chain, error => { throw error; });
  flow.start();
  assert.equal(flow.chain.commit({ type: 'gain-energy', player: 'A', amount: 10 }).status, 'done');
  assert.equal(flow.chain.commit({ type: 'gain-power', player: 'A', power: ['Fury'] }).status, 'done');
  assert.deepEqual(binding.registerProgramTriggers(flow.chain, kernel.getObject('rumble')), ['program:rumble:1:1']);
  assert.equal(flow.chain.commit({
    type: 'move-location',
    object: kernel.ref('rumble'),
    to: { type: 'battlefield', id: 'bf1' },
  }).status, 'done');
  return { binding, flow, kernel, lifecycle, requests };
}

function advanceProduction(f) {
  let passes = 0;
  for (let guard = 0; guard < 200; guard++) {
    if (f.flow.chain.items.some(item => item.status === 'pending')) {
      f.flow.advance();
      continue;
    }
    if (f.flow.chain.items.length) {
      assert.ok(f.flow.chain.priority, 'a Finalized Chain item grants Priority');
      passes += 1;
      f.flow.pass(f.flow.chain.priority);
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
    return { passes, failure: null };
  }
  throw new Error('production Rumble Conquer did not settle');
}

function advanceUntilFailure(f) {
  let passes = 0;
  for (let guard = 0; guard < 200; guard++) {
    try {
      if (f.flow.chain.items.some(item => item.status === 'pending')) {
        f.flow.advance();
        continue;
      }
      if (f.flow.chain.items.length) {
        assert.ok(f.flow.chain.priority, 'a Finalized Chain item grants Priority');
        passes += 1;
        f.flow.pass(f.flow.chain.priority);
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
      assert.fail('the Rumble Conquer resolved without the expected failure');
    } catch (failure) {
      return { passes, failure };
    }
  }
  throw new Error('production Rumble Conquer did not reach a result');
}

function triggerFor(f) {
  const id = f.flow.chain.trace.find(entry => entry.item?.startsWith('trigger:'))?.item;
  assert.ok(id, 'Rumble put its Conquer trigger on the Chain');
  return id;
}

test('RIFT-1076 parsed journals pin all eight judge-required and seed 047 invalid-cost-plan events', () => {
  let judgeRequired = 0;
  let invalidCostPlan = 0;
  for (const sample of HISTORICAL_SAMPLES) {
    const [, commandIndex, turn, item, targetCardId] = sample;
    const { journal } = persistedJournal('rift-h100-7264ea68', sample);
    const { failure, trigger, targeted } = rumbleEvidence(journal, sample);
    assert.equal(failure.trace?.turn, turn);
    assert.equal(failure.trace?.turnState, item === 'trigger:5' && sample[0] === '047' ? 'showdown-open' : 'neutral-closed');
    assert.ok(['pass', 'advance'].includes(failure.command.type));
    if (targetCardId === null) {
      assert.equal(failure.failure?.code, 'invalid-cost-plan');
      invalidCostPlan += 1;
      assert.equal(failure.failure?.message, 'Cost choice cannot be completed from the current zone');
      assert.equal(targeted, undefined);
      continue;
    }
    assert.equal(failure.failure?.code, 'judge-required');
    judgeRequired += 1;
    assert.ok(FAIL_CLOSED_MESSAGES.includes(failure.failure?.message));
    assert.equal(trigger.object?.cardId, RUMBLE);
    assert.equal(targeted?.object?.cardId, targetCardId);
    assert.notEqual(targetCardId, RUMBLE);
  }
  assert.equal(judgeRequired, 8);
  assert.equal(invalidCostPlan, 1);
});

test('RIFT-1076 current e05bc0ba dataset has seed 047 and 094 Finalize cost failures, not judge-required', () => {
  const cases = [
    ['047', 65, 7],
    ['094', 74, 8],
  ];
  for (const [number, commandIndex, turn] of cases) {
    const sample = [number, commandIndex, turn, 'trigger:5', null];
    const { journal } = persistedJournal('rift-h100-e05bc0ba', sample);
    const { failure, trigger } = rumbleEvidence(journal, sample);
    assert.equal(failure.failure?.code, 'invalid-cost-plan');
    assert.equal(failure.failure?.message, 'Cost choice cannot be completed from the current zone');
    assert.equal(failure.trace?.turn, turn);
    assert.equal(trigger.object?.cardId, RUMBLE);
  }
});

test('RIFT-1076 real Rumble plays a Trash Mech when the trusted catalog proves its printed cost', () => {
  assert.equal(rumbleHotheaded.status, 'executable');
  assert.equal(ferrousForerunner.status, 'executable');
  assert.equal(RULES_URL, 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf');
  const f = rumbleConquer({ printedCatalog: [FERROUS_PRINTED] });
  try {
    f.flow.advance();
    const outcome = advanceProduction(f);
    assert.equal(outcome.failure, null);
    assert.ok(outcome.passes > 0, 'the trigger reaches Resolve only after a Pass');
    assert.equal(f.kernel.getObject('trash-mech').zone, 'board');
    assert.equal(f.kernel.getObject('fodder').zone, 'deck');
    assert.deepEqual(f.kernel.getObject('rumble').location, { type: 'battlefield', id: 'bf1' });
    assert.ok(f.flow.chain.trace.some(entry => entry.item === triggerFor(f) && entry.step === 'resolved'));
  } finally {
    f.lifecycle.detach();
  }
});

test('RIFT-1076 missing trusted printed cost fails closed at the nested Play, not on a card-program status', () => {
  const f = rumbleConquer();
  try {
    let failure;
    let passes = 0;
    try {
      f.flow.advance();
    } catch (error) {
      failure = error;
    }
    if (failure === undefined) {
      ({ passes, failure } = advanceUntilFailure(f));
    }
    const trigger = triggerFor(f);
    assert.ok(passes > 0 || failure !== undefined,
      'the historical failure is produced by the public Closed-State progression');
    assert.ok(failure instanceof CostPlanError);
    assert.equal(failure.name, 'CostPlanError');
    assert.equal(failure.reason, 'judge-required');
    assert.ok(FAIL_CLOSED_MESSAGES.includes(failure.message), 'the failure names the missing trusted printed-cost evidence');

    // The headless summary has no card candidate when a Pass/advance reaches
    // this engine failure. The error itself and the Conquer evidence identify
    // the responsible source and selected card.
    const conquer = f.flow.chain.pipeline.events.findLast(event => event.timingPoint === 'conquer');
    assert.equal(conquer?.source?.ref.id, 'rumble');
    assert.equal(conquer?.source?.cardId, RUMBLE);
    assert.ok(f.requests.some(request => request.id === 'target:rumble.mech-in-trash'));
    assert.ok(f.requests.some(request => request.id.endsWith(':pick:rumble.fodder')));
    assert.ok(f.flow.chain.pipeline.events.some(event =>
      event.timingPoint === 'became-target' && event.object?.cardId === FERROUS));
    assert.ok(f.flow.chain.pipeline.events.some(event =>
      event.timingPoint === 'card-recycled' && event.object?.ref.id === 'fodder'));
    assert.deepEqual(
      f.flow.chain.trace.filter(entry => entry.item === trigger &&
        ['pending', 'finalize-start', 'targets-finalized', 'finalized'].includes(entry.step)).map(entry => entry.step),
      ['pending', 'finalize-start', 'targets-finalized', 'finalized'],
      'Resolve rolled back atomically after Finalize had locked and paid the recycle',
    );
    assert.equal(f.kernel.getObject('trash-mech').zone, 'trash', 'the selected Mech was never played');
    assert.equal(f.kernel.getObject('fodder').zone, 'deck', 'the CR 383.3.b.1 recycle stays paid');
    assert.deepEqual(f.kernel.player('A').power, ['Fury'], 'the failed nested Play consumed no Power');
  } finally {
    f.lifecycle.detach();
  }
});

test('RIFT-1076 empty Finalize cost candidates remove the Pending may instead of leaking invalid-cost-plan', () => {
  const f = rumbleConquer({ fodder: false });
  try {
    const wasRemoved = () => f.flow.chain.trace.some(entry =>
      entry.step === 'removed' && entry.reason === 'unperformable-trigger');
    for (let guard = 0; guard < 200 && !wasRemoved(); guard++) {
      if (f.flow.chain.items.some(item => item.status === 'pending')) f.flow.advance();
      else if (f.flow.chain.items.length) {
        assert.ok(f.flow.chain.priority, 'a Finalized Chain item grants Priority');
        f.flow.pass(f.flow.chain.priority);
      }
      else if (f.flow.chain.focus !== null) f.flow.pass(f.flow.chain.focus);
      else if (f.flow.combat.active) f.flow.advance();
      else f.flow.advance();
    }
    assert.equal(wasRemoved(), true, 'the accepted may is removed when Finalize has no recycle choice');
    const trigger = triggerFor(f);
    assert.ok(f.requests.some(request => request.id === 'finalize:trigger:1:optional'));
    assert.ok(f.requests.some(request => request.id === 'target:rumble.mech-in-trash'));
    assert.equal(f.requests.some(request => request.id.endsWith(':pick:rumble.fodder')), false,
      'an empty recycle candidate source is rejected before asking an impossible question');
    assert.deepEqual(
      f.flow.chain.trace.filter(entry => entry.item === trigger).map(entry => `${entry.step}${entry.reason ? `(${entry.reason})` : ''}`),
      ['pending', 'removed(unperformable-trigger)'],
      'CR 403.4 removes the Pending trigger without Finalizing or Resolving it',
    );
    assert.equal(f.flow.chain.trace.some(entry => entry.item === trigger && entry.reason === 'countered'), false,
      'CR 403.4.a says removal is not a counter');
    assert.equal(f.kernel.getObject('trash-mech').zone, 'trash');
    assert.equal(f.kernel.player('A').energy, 10, 'no recycle or nested Play cost was paid');
    assert.deepEqual(f.kernel.objectsInZone('A', 'deck').map(ref => ref.id).filter(id => id === 'fodder'), []);
    assert.deepEqual(f.flow.chain.items, []);
  } finally {
    f.lifecycle.detach();
  }
});

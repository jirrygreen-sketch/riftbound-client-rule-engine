// RIFT-959: Battlefields established before lifecycle attachment keep their
// Triggered Abilities. The production MatchCommandAdapter attaches the normal
// program lifecycle after createMatch has completed setup, so the lifecycle's
// initial scan is the only binding edge for these objects (CR v1.5 170.2.a-b,
// 170.8-170.10, 190.6, 383.4.c, 471.1, 473.2.a/c).
//
// Official source (effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
import assert from 'node:assert/strict';
import test from 'node:test';

import minefield from '../../../card-dsl/dist/cards/sfd/minefield.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createMatchCommandAdapter } from '../../dist/game/command-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const field = id => ({ type: 'battlefield', id });
const executableMinefield = { ...minefield, status: 'executable', judgeReason: undefined };

function card(id, types, extra = {}) {
  return {
    id,
    cardId: extra.cardId ?? id,
    canonicalCardId: extra.canonicalCardId ?? id,
    types,
    energy: null,
    power: null,
    might: null,
    ...extra,
  };
}

function deck({ prefix, withMinefield = false }) {
  const battlefieldId = `battlefield:${prefix}`;
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`${prefix}:main:${index}`, ['unit'], {
      cardType: 'Unit', energy: 1, power: [], might: 2,
    })),
    runeDeck: Array.from({ length: 8 }, (_, index) => card(`${prefix}:rune:${index}`, ['rune'], {
      cardType: 'Rune',
    })),
    championLegend: card(`${prefix}:legend-card`, ['legend'], {
      canonicalCardId: `${prefix}:legend-card`, cardType: 'Legend',
    }),
    chosenChampion: card(`${prefix}:champion-card`, ['champion'], {
      canonicalCardId: `${prefix}:champion-card`, cardType: 'Champion',
    }),
    battlefields: Array.from({ length: 3 }, (_, index) => card(`${prefix}:battlefield:${index}`, ['battlefield'], {
      cardId: withMinefield && index === 0 ? battlefieldId : `${battlefieldId}:${index}`,
      canonicalCardId: withMinefield && index === 0 ? minefield.canonicalCardId : `${prefix}:battlefield-program:${index}`,
      cardType: 'Battlefield', name: withMinefield && index === 0 ? 'Minefield' : `${prefix} field ${index}`,
    })),
  };
}

function makeHost(builder) {
  const kernel = builder.build();
  let pipeline;
  let adapterDefaultChoose;
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (pipeline !== undefined && pipeline.choose !== adapterDefaultChoose) return pipeline.choose(request);
    if (request.type === 'optional') return true;
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'order') return [...request.options];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  pipeline = createActionPipelineHost({
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
  adapterDefaultChoose = pipeline.choose;
  pipeline.player = id => kernel.player(id);
  return { kernel, host: pipeline, requests };
}

// RIFT-954 requested setup-time Battlefield binding. The shared createMatch
// lifecycle currently records the selected token but leaves it Pending on the
// Chain; this explicit public transition is the only fixture-only placement
// needed below. It does not install a program registration or alter control.
function establishSelectedBattlefields(match, kernel) {
  for (const selected of match.setup.battlefields) {
    const object = kernel.getObject(selected.id);
    assert.equal(object.zone, 'chain');
    assert.equal(object.types.includes('battlefield'), true);
    assert.equal(match.flow.chain.commit({
      type: 'move-zone', object: object.ref, to: 'board', location: field(selected.id),
    }).status, 'done');
  }
}

function setup() {
  const made = makeHost(world().player('A').player('B'));
  const programs = new Map([
    [minefield.canonicalCardId, executableMinefield],
    ['A:legend-card', { canonicalCardId: 'A:legend-card', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'A legend witness', abilities: [] }],
    ['B:legend-card', { canonicalCardId: 'B:legend-card', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'B legend witness', abilities: [] }],
    ['A:champion-card', { canonicalCardId: 'A:champion-card', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'A champion witness', abilities: [] }],
    ['B:champion-card', { canonicalCardId: 'B:champion-card', rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'B champion witness', abilities: [] }],
    ...Array.from({ length: 3 }, (_, index) => [
      `A:battlefield-program:${index}`,
      { canonicalCardId: `A:battlefield-program:${index}`, rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'A field witness', abilities: [] },
    ]),
    ...Array.from({ length: 3 }, (_, index) => [
      `B:battlefield-program:${index}`,
      { canonicalCardId: `B:battlefield-program:${index}`, rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'B field witness', abilities: [] },
    ]),
  ]);
  const binding = createProgramBinding({ cardPrograms: programs });
  const match = createMatch({
    host: made.host,
    decks: [deck({ prefix: 'A', withMinefield: true }), deck({ prefix: 'B' })],
    programs: binding,
    seed: 'RIFT-959',
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
    victoryScore: 20,
  });
  establishSelectedBattlefields(match, made.kernel);
  return { ...made, match, binding };
}

function registrations(match, id) {
  return match.flow.chain.pipeline.registeredTriggers().filter(registration => registration.source.ref.id === id);
}

function settle(adapter, budget = 120) {
  for (let index = 0; index < budget; index++) {
    if (!adapter.match.flow.chain.items.length) return;
    const player = adapter.match.flow.chain.priority;
    assert.ok(player);
    adapter.execute(player, {
      type: 'pass', commandId: `RIFT-959:settle:${index}`, stateVersion: adapter.stateVersion,
    });
  }
  throw new Error('Score wave did not settle');
}

function answerChoices(adapter, budget = 40) {
  for (let index = 0; index < budget; index++) {
    if (adapter.pendingChoice === null) return;
    const request = adapter.pendingChoice.request;
    const answer = request.type === 'optional' ? true
      : request.type === 'mode' ? request.options[0]
        : request.type === 'order' ? [...request.options]
          : request.options.slice(0, request.min);
    adapter.execute(request.chooser, {
      type: 'choose', commandId: `RIFT-959:choice:${index}`, stateVersion: adapter.stateVersion,
      choiceId: request.id, answer,
    });
  }
  throw new Error('Battlefield trigger choices did not settle');
}

function passUnitIfNeeded(adapter) {
  settle(adapter);
  const flow = adapter.match.flow;
  if (flow.chain.items.length || flow.combat.active) {
    assert.ok(flow.chain.priority);
    adapter.execute(flow.chain.priority, {
      type: 'pass', commandId: `RIFT-959:unit:${adapter.stateVersion}`, stateVersion: adapter.stateVersion,
    });
  }
  settle(adapter);
}

function finishShowdown(adapter) {
  const flow = adapter.match.flow;
  let passes = 0;
  while (flow.combat.current?.step === 'showdown') {
    assert.ok(++passes <= 4, 'Showdown must close after its Focus passes');
    const focus = flow.chain.focus;
    assert.ok(focus);
    flow.pass(focus);
    settle(adapter);
  }
}

function removeDefender(adapter, id) {
  const defender = adapter.match.flow.options.host.objects().find(object =>
    object.ref.id === id && object.zone === 'board');
  assert.ok(defender);
  const outcome = adapter.match.flow.chain.commit({ type: 'kill', object: defender.ref });
  assert.equal(outcome.status, 'done');
  settle(adapter);
}

test('RIFT-959 createMatch plus adapter binds a pre-existing Board Minefield and real TurnFlow conquer triggers it once under the current controller', () => {
  const f = setup();
  const mine = f.kernel.objects.find(object => object.cardId === minefield.canonicalCardId && object.zone === 'board');
  assert.ok(mine, 'the selected Minefield object exists in the Battlefield Zone');
  const minefieldId = mine.location.type === 'battlefield' ? mine.location.id : mine.ref.id;
  f.kernel.addObject({
    ref: { id: 'defender', zoneEntryId: 1 }, cardId: 'A:main:0', name: 'defender',
    types: ['unit'], tags: [], keywords: [], owner: 'A', controller: 'A', zone: 'board',
    location: field(minefieldId), might: 4, energy: 0, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  }, 'board');
  f.kernel.addObject({
    ref: { id: 'attacker', zoneEntryId: 1 }, cardId: 'B:main:0', name: 'attacker',
    types: ['unit'], tags: [], keywords: [], owner: 'B', controller: 'B', zone: 'board',
    location: { type: 'base', player: 'B' }, might: 4, energy: 0, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  }, 'board');
  assert.deepEqual(registrations(f.match, mine.ref.id), [], 'lifecycle is not attached yet');

  const adapter = createMatchCommandAdapter({ match: f.match, stateVersion: 0 });
  try {
    const triggerId = `program:${mine.ref.id}:${mine.ref.zoneEntryId}:0`;
    const registration = registrations(f.match, mine.ref.id).find(value => value.id === triggerId);
    assert.ok(registration, 'initial lifecycle scan bound the setup-time Battlefield');
    assert.deepEqual(registration.source.ref, mine.ref);
    assert.equal(registration.source.zone, 'board');
    assert.equal(registration.spec.at, 'conquer');

    const flow = f.match.flow;
    assert.equal(flow.turnPlayer, 'A');
    passUnitIfNeeded(adapter);
    removeDefender(adapter, 'defender');

    // The Battlefield must remain established until the reviewing controller
    // actually contests it. End A's turn through the public TurnFlow path.
    adapter.execute(flow.turnPlayer, {
      type: 'pass', commandId: 'RIFT-959:end-a', stateVersion: adapter.stateVersion,
    });
    passUnitIfNeeded(adapter);
    assert.equal(flow.turnPlayer, 'B');

    const trashBefore = f.kernel.objectsInZone('B', 'trash').length;
    flow.move('B', f.kernel.ref('attacker'), minefieldId);
    passUnitIfNeeded(adapter);
    finishShowdown(adapter);
    if (flow.combat.current?.step === 'damage') {
      flow.combat.prepareDamage();
      flow.combat.submitAttackerDamage('B', []);
      flow.combat.submitDefenderDamage('A', [{ uid: 'defender', amount: 0 }]);
      flow.advance();
      passUnitIfNeeded(adapter);
    }
    settle(adapter);
    answerChoices(adapter);
    settle(adapter);
    assert.equal(flow.battlefields.find(value => value.id === minefieldId).controller, 'B');
    const battlefieldRef = f.kernel.getObject(mine.ref.id).ref;
    assert.equal(f.kernel.getObject(mine.ref.id).controller, 'B');

    const conquerWave = f.match.events().find(event => event.timingPoint === 'conquer');
    assert.ok(conquerWave, 'the real Score action published Conquer');
    const pending = f.match.events().filter(event => event.timingPoint === 'chain-item-pending' &&
      event.details?.item && String(event.details.item).startsWith('trigger:'));
    assert.equal(pending.length, 1, 'the pre-existing Battlefield registered exactly one qualifying trigger');
    assert.equal(f.kernel.objectsInZone('B', 'trash').length, trashBefore + 2,
      'the current controller B milled exactly two cards through the Minefield body');
    const tracePending = flow.chain.trace.filter(event => event.step === 'pending' &&
      String(event.item).startsWith('trigger:'));
    assert.equal(tracePending.length, 1);
    assert.equal(f.requests.some(request => request.id.startsWith('finalize:trigger:')), false);
    assert.equal(flow.chain.commit({ type: 'move-zone', object: battlefieldRef, to: 'banishment' }).status, 'done');
    assert.equal(flow.chain.pipeline.hasTriggerRegistration(triggerId), false,
      'the Battlefield trigger detaches with its exact Board incarnation');
  } finally {
    adapter.detach();
  }
});

test('RIFT-959 repeated lifecycle attachment keeps the existing Battlefield registration intact', () => {
  const f = setup();
  const mine = f.kernel.objects.find(object => object.cardId === minefield.canonicalCardId && object.zone === 'board');
  assert.ok(mine);
  const first = f.match.programBinding.attachLifecycle(f.match.flow.chain, error => { throw error; });
  const firstIds = registrations(f.match, mine.ref.id).map(registration => registration.id);
  assert.deepEqual(firstIds, [`program:${mine.ref.id}:${mine.ref.zoneEntryId}:0`]);
  const second = f.match.programBinding.attachLifecycle(f.match.flow.chain, error => { throw error; });
  assert.deepEqual(registrations(f.match, mine.ref.id).map(registration => registration.id), firstIds);
  assert.equal(f.match.flow.chain.pipeline.hasTriggerRegistration(firstIds[0]), true);
  second.detach();
  assert.equal(f.match.flow.chain.pipeline.hasTriggerRegistration(firstIds[0]), true);
  first.detach();
});

test('RIFT-959 initial scan does not bind a pre-existing non-Battlefield Board object', () => {
  const f = setup();
  const nonBattlefieldProgram = {
    canonicalCardId: 'non-battlefield', rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: 'Synthetic non-Battlefield witness',
    abilities: [{ kind: 'triggered', trigger: { at: 'conquer', filter: { event: 'conquered' } }, optional: false, body: [] }],
  };
  const binding = createProgramBinding({ cardPrograms: [nonBattlefieldProgram] });
  f.kernel.addObject({
    ref: { id: 'not-a-field', zoneEntryId: 1 }, cardId: nonBattlefieldProgram.canonicalCardId,
    name: 'not a field', types: ['unit'], tags: [], keywords: [], owner: 'A', controller: 'A',
    zone: 'board', location: { type: 'base', player: 'A' }, might: 1, energy: 1, power: [],
    exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  }, 'board');
  const lifecycle = binding.attachLifecycle(f.match.flow.chain, error => { throw error; });
  try {
    assert.deepEqual(registrations(f.match, 'not-a-field'), []);
  } finally {
    lifecycle.detach();
  }
});

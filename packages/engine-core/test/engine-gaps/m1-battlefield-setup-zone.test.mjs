// RIFT-971: selected Battlefields begin on the Board (CR v1.5 113.1,
// 133.6.a.1, 440.2.b.5, 487.5), are Game Objects at their own Location
// (199.1), and expose their triggered abilities through the normal lifecycle.
// The scenario drives the real createMatch, MatchCommandAdapter, ChainEngine,
// TurnFlow, Finalize, Resolve and event pipeline used by the game server's V2
// EngineRuntime. No trigger or score event is synthesized in this file.
import assert from 'node:assert/strict';
import test from 'node:test';

import minefield from '../../../card-dsl/dist/cards/sfd/minefield.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { matchesTriggerEvent, matchesTriggerObject } from '../../dist/events/pipeline-match.js';
import { createMatchCommandAdapter } from '../../dist/game/command-adapter.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { translateTriggerFilter } from '../../dist/programs/filters.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const MINE_FIELD = minefield.canonicalCardId;
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

function deck({ mine = false } = {}) {
  const prefix = mine ? 'A' : 'B';
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`${prefix}:main:${index}`, ['unit'], {
      cardType: 'Unit', energy: 1, power: [], might: 2,
    })),
    runeDeck: Array.from({ length: 8 }, (_, index) => card(`${prefix}:rune:${index}`, ['rune'], {
      cardType: 'Rune',
    })),
    championLegend: card(`${prefix}:legend-card`, ['legend'], {
      cardType: 'Legend',
    }),
    chosenChampion: card(`${prefix}:champion-card`, ['champion'], {
      cardType: 'Champion',
    }),
    battlefields: Array.from({ length: 3 }, (_, index) => card(`${prefix}:battlefield:${index}`, ['battlefield'], {
      cardId: mine && index === 0 ? 'sfd-212-221' : `${prefix}:battlefield-printing:${index}`,
      canonicalCardId: mine && index === 0 ? MINE_FIELD : `${prefix}:battlefield-program:${index}`,
      cardType: 'Battlefield',
      name: mine && index === 0 ? 'Minefield' : `${prefix} field ${index}`,
    })),
  };
}

function makeHost() {
  const kernel = world().player('A').player('B').build();
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

function setup() {
  const made = makeHost();
  const binding = createProgramBinding({ cardPrograms: [executableMinefield] });
  const match = createMatch({
    host: made.host,
    decks: [deck({ mine: true }), deck()],
    programs: binding,
    seed: 'RIFT-971',
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
    victoryScore: 20,
  });
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
      type: 'pass', commandId: `RIFT-971:settle:${index}`, stateVersion: adapter.stateVersion,
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
      type: 'choose', commandId: `RIFT-971:choice:${index}`, stateVersion: adapter.stateVersion,
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
      type: 'pass', commandId: `RIFT-971:unit:${adapter.stateVersion}`, stateVersion: adapter.stateVersion,
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
  assert.equal(adapter.match.flow.chain.commit({ type: 'kill', object: defender.ref }).status, 'done');
  settle(adapter);
}

function conquerThroughTurnFlow({ target = 'mine' } = {}) {
  const f = setup();
  const mine = f.kernel.objects.find(object => object.cardId === MINE_FIELD && object.zone === 'board');
  assert.ok(mine, 'the selected Minefield is already on the Board after setup');
  assert.equal(mine.location.type, 'battlefield');
  assert.equal(mine.location.id, mine.ref.id);
  const minefieldId = mine.location.id;
  const otherFieldId = f.match.setup.battlefields.find(field => field.cardId !== 'sfd-212-221').id;
  const targetFieldId = target === 'mine' ? minefieldId : otherFieldId;

  f.kernel.addObject({
    ref: { id: 'defender', zoneEntryId: 1 }, cardId: 'A:main:0', name: 'defender',
    types: ['unit'], tags: [], keywords: [], owner: 'A', controller: 'A', zone: 'board',
    location: field(targetFieldId), might: 4, energy: 0, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  }, 'board');
  f.kernel.addObject({
    ref: { id: 'attacker', zoneEntryId: 1 }, cardId: 'B:main:0', name: 'attacker',
    types: ['unit'], tags: [], keywords: [], owner: 'B', controller: 'B', zone: 'board',
    location: { type: 'base', player: 'B' }, might: 4, energy: 0, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  }, 'board');

  const adapter = createMatchCommandAdapter({ match: f.match, stateVersion: 0 });
  try {
    const exact = registrations(f.match, mine.ref.id);
    assert.deepEqual(exact.map(registration => registration.id), [`program:${mine.ref.id}:${mine.ref.zoneEntryId}:0`]);
    assert.equal(registrations(f.match, mine.ref.id).length, 1, 'initial scan registers the setup Battlefield once');

    const flow = f.match.flow;
    assert.equal(flow.turnPlayer, 'A');
    passUnitIfNeeded(adapter);
    removeDefender(adapter, 'defender');
    adapter.execute(flow.turnPlayer, {
      type: 'pass', commandId: 'RIFT-971:end-a', stateVersion: adapter.stateVersion,
    });
    passUnitIfNeeded(adapter);
    assert.equal(flow.turnPlayer, 'B');

    const trashBefore = f.kernel.objectsInZone('B', 'trash').length;
    flow.move('B', f.kernel.ref('attacker'), targetFieldId);
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
    assert.equal(flow.battlefields.find(value => value.id === targetFieldId).controller, 'B');
    return {
      ...f,
      adapter,
      minefieldId,
      otherFieldId,
      trashDelta: f.kernel.objectsInZone('B', 'trash').length - trashBefore,
      triggerPending: () => f.match.events().filter(event => event.timingPoint === 'chain-item-pending' &&
        event.details?.item && String(event.details.item).startsWith('trigger:')).length,
    };
  } catch (error) {
    adapter.detach();
    throw error;
  }
}

test('RIFT-971 default setup places only the selected Battlefield at its own Board Location and lifecycle binds it once', () => {
  const f = setup();
  const selected = f.match.setup.battlefields.map(entry => f.kernel.getObject(entry.id));
  assert.equal(selected.length, 2);
  assert.ok(selected.every(object => object.zone === 'board'));
  assert.ok(selected.every(object => object.location?.type === 'battlefield' && object.location.id === object.ref.id));
  const mine = selected.find(object => object.cardId === MINE_FIELD);
  assert.ok(mine);
  assert.equal(f.kernel.objects.filter(object => object.zone === 'board' && object.types.includes('battlefield')).length, 2);
  assert.deepEqual(f.match.setup.removedBattlefields, {
    A: ['A:battlefield-printing:1', 'A:battlefield-printing:2'],
    B: ['B:battlefield-printing:1', 'B:battlefield-printing:2'],
  });

  assert.deepEqual(registrations(f.match, mine.ref.id), [], 'createMatch leaves lifecycle attachment to its owner');
  const adapter = createMatchCommandAdapter({ match: f.match, stateVersion: 0 });
  try {
    const exact = registrations(f.match, mine.ref.id);
    assert.deepEqual(exact.map(registration => registration.id), [`program:${mine.ref.id}:${mine.ref.zoneEntryId}:0`]);
    assert.equal(exact[0].source.zone, 'board');
    assert.deepEqual(exact[0].source.ref, mine.ref);
  } finally {
    adapter.detach();
  }
});

test('RIFT-971 here matching self-anchors a Board Battlefield whose location is null', () => {
  const source = world().player('A').object('board-field', {
    cardId: MINE_FIELD,
    types: ['battlefield'],
    zone: 'board',
    location: null,
  }).build().getObject('board-field');
  const other = { ...source, ref: { ...source.ref, id: 'other-field' }, types: ['battlefield'] };
  const translated = translateTriggerFilter(minefield.abilities[0].trigger.filter, source.ref.id, 'conquer');
  const event = battlefieldId => ({
    type: 'task-resolved', seq: 1, eventId: 1, turnNumber: 1, activePlayerId: 'A',
    taskId: 'conquer', sourceCardId: '', reason: 'conquer', autoResolved: true,
    timingPoint: 'conquer', kind: 'conquer', player: 'A', object: source,
    details: { battlefieldId, participatingUnits: [] },
  });
  assert.equal(matchesTriggerEvent(translated, event(source.ref.id), 'A', source), true);
  assert.equal(matchesTriggerEvent(translated, event(other.ref.id), 'A', source), false);
  assert.equal(matchesTriggerEvent(translated, event(source.ref.id), 'A', other), false);

  const unitHere = { ...other, ref: { ...other.ref, id: 'unit-here' }, types: ['unit'], location: field(source.ref.id) };
  const unitElsewhere = { ...unitHere, ref: { ...unitHere.ref, id: 'unit-elsewhere' }, location: field(other.ref.id) };
  assert.equal(matchesTriggerObject({ type: 'battlefield', here: true }, source, 'A', source, source.ref.id), true);
  assert.equal(matchesTriggerObject({ type: 'unit', here: true }, unitHere, 'A', source, source.ref.id), true);
  assert.equal(matchesTriggerObject({ type: 'unit', here: true }, unitElsewhere, 'A', source, source.ref.id), false);
});

test('RIFT-971 real TurnFlow fires a setup Minefield only when this Battlefield is conquered', () => {
  const own = conquerThroughTurnFlow({ target: 'mine' });
  try {
    assert.equal(own.triggerPending(), 1);
    assert.equal(own.trashDelta, 2, 'the Minefield ability resolved through the real Chain');
  } finally {
    own.adapter.detach();
  }

  const other = conquerThroughTurnFlow({ target: 'other' });
  try {
    assert.notEqual(other.minefieldId, other.otherFieldId);
    assert.equal(other.triggerPending(), 0, 'conquering another Battlefield does not satisfy here');
    assert.equal(other.trashDelta, 0);
  } finally {
    other.adapter.detach();
  }
});

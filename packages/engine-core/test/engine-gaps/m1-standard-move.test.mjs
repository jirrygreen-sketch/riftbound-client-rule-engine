import assert from 'node:assert/strict';
import test from 'node:test';

import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { world } from '../../dist/effects/testing/test-kernel.js';
import { executeGameCommand, moveUnits } from '../../dist/game/commands/index.js';
import { createMatch } from '../../dist/game/lifecycle.js';
import { StandardMoveBatchError } from '../../dist/turn/movement.js';
import { createProgramBinding } from '../../dist/programs/index.js';

const field = id => ({ type: 'battlefield', id });

function deck(player) {
  const card = (id, types) => ({ id, cardId: id, types });
  return {
    mainDeck: Array.from({ length: 40 }, (_, index) => ({
      id: `${player}:unit:${index}`, cardId: 'synthetic:m1-move-unit', types: ['unit'],
      energy: 0, power: [], might: 3,
    })),
    runeDeck: Array.from({ length: 12 }, (_, index) => card(`${player}:rune:${index}`, ['rune'])),
    championLegend: card(`${player}:legend`, ['legend']),
    chosenChampion: card(`${player}:champion`, ['champion']),
    battlefields: Array.from({ length: 3 }, (_, index) => card(`${player}:field:${index}`, ['battlefield'])),
  };
}

function setup({ firstPlayer = 0 } = {}) {
  const kernel = world().player('A').player('B').build();
  const choose = request => { throw new Error(`Unexpected real choice: ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) },
    decks: [deck('A'), deck('B')], seed: 'RIFT-886', battlefieldChoice: [0, 1],
    mulligans: [[], []], firstPlayer,
  });
  const fields = match.flow.battlefields.map(value => value.id);
  const binding = createProgramBinding({ cardPrograms: [{
    canonicalCardId: 'synthetic:m1-move-unit', rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: 'Synthetic test Unit for the production Standard Move path.', abilities: [],
  }] });
  binding.attachLifecycle(match.flow.chain);
  let stateVersion = 0;
  let commandId = 0;
  const context = () => ({ match, binding, stateVersion });
  const send = (player, type, values = {}) => {
    const result = executeGameCommand(context(), player, {
      commandId: `RIFT-886:${++commandId}`, stateVersion, type, ...values,
    });
    stateVersion++;
    return result;
  };
  const playUnit = (player = match.flow.turnPlayer) => {
    const object = kernel.objects.find(candidate => candidate.controller === player &&
      candidate.zone === 'hand' && candidate.types.includes('unit'));
    assert.ok(object);
    send(player, 'play', { cardObjectId: object.ref.id });
    assert.equal(kernel.getObject(object.ref.id).zone, 'board');
    return object.ref.id;
  };
  const readyUnits = (count, player = match.flow.turnPlayer) => {
    const ids = Array.from({ length: count }, () => playUnit(player));
    send(match.flow.turnPlayer, 'pass');
    send(match.flow.turnPlayer, 'pass');
    assert.equal(match.flow.turnPlayer, player);
    for (const id of ids) assert.equal(kernel.getObject(id).exhausted, false);
    return ids;
  };
  return { kernel, host, match, fields, context, send, playUnit, readyUnits };
}

const settledChain = f => ({
  events: f.match.events(), trace: f.match.flow.chain.trace,
});

test('RIFT-886 formation failure rolls back every Exhaust, Move, event, trace and journal entry', () => {
  const f = setup();
  const ids = f.readyUnits(2);
  f.kernel.addReplacement(action => action.type === 'move-location' &&
    action.object.id === ids[1] ? 'prevented' : null);
  const beforeKernel = f.kernel.snapshot();
  const before = settledChain(f);
  const beforeEventCount = f.match.events().length;
  const beforeHistory = ids.map(id => f.kernel.history({ action: 'move-location', object: f.kernel.ref(id) }));
  assert.throws(() => moveUnits(f.context(), 'A', ids, {
    zone: 'battlefield', locationId: f.fields[0],
  }), error => error instanceof StandardMoveBatchError &&
    error.receipt?.status === 'rolled-back');
  assert.deepEqual(f.kernel.snapshot(), beforeKernel);
  assert.deepEqual(f.match.flow.chain.trace, before.trace);
  assert.equal(f.match.events().length, beforeEventCount);
  assert.deepEqual(ids.map(id => f.kernel.history({ action: 'move-location', object: f.kernel.ref(id) })), beforeHistory);
  assert.ok(ids.every(id => f.kernel.getObject(id).exhausted === false));
  assert.ok(ids.every(id => f.kernel.getObject(id).location?.type === 'base'));
});

test('RIFT-886 legal Base to Battlefield commits all paired leaves atomically and requests Cleanup', () => {
  const f = setup();
  const ids = f.readyUnits(2);
  const before = f.match.events().length;
  const result = moveUnits(f.context(), 'A', ids, { zone: 'battlefield', locationId: f.fields[0] });
  assert.deepEqual(result.receipt.actions, [
    { type: 'exhaust', status: 'done' }, { type: 'move-location', status: 'done' },
    { type: 'exhaust', status: 'done' }, { type: 'move-location', status: 'done' },
  ]);
  const moved = f.match.events().slice(before).filter(event => event.timingPoint === 'object-moved');
  assert.deepEqual(moved.map(event => event.object.ref.id), ids);
  assert.equal(new Set(moved.map(event => event.batchId)).size, 1);
  assert.ok(moved.every(event => event.details.cause === 'standard-move'));
  const exhausted = f.match.events().slice(before).filter(event => event.timingPoint === 'object-exhausted');
  assert.deepEqual(exhausted.map(event => event.object.ref.id), ids);
  assert.equal(new Set(exhausted.map(event => event.batchId)).size, 1);
  assert.equal(exhausted[0].batchId, moved[0].batchId);
  assert.ok(ids.every(id => f.kernel.getObject(id).exhausted &&
    f.kernel.getObject(id).location?.type === 'battlefield' &&
    f.kernel.getObject(id).location.id === f.fields[0]));
  assert.equal(f.match.flow.chain.trace.some(event => event.step === 'cleanup-requested' &&
    event.reason === 'standard-move'), true);
});

test('RIFT-886 public move enters the existing Showdown and stages a real Combat for two controllers', () => {
  const f = setup({ firstPlayer: 0 });
  const attacker = f.playUnit('A');
  f.send('A', 'pass');
  const defender = f.playUnit('B');
  f.send('B', 'pass');
  assert.equal(f.match.flow.turnPlayer, 'A');
  assert.equal(f.kernel.getObject(attacker).exhausted, false);
  f.send('A', 'move', { objectId: attacker, to: { zone: 'battlefield', locationId: f.fields[0] } });
  assert.deepEqual(f.kernel.getObject(attacker).location, { type: 'battlefield', id: f.fields[0] });
  assert.deepEqual(f.kernel.getObject(defender).location, { type: 'base', player: 'B' });
  assert.deepEqual(f.match.flow.combat.current, {
    field: f.fields[0], step: 'showdown',
  });
  assert.equal(f.match.flow.chain.focus, 'A');
  assert.ok(f.match.events().some(event => event.timingPoint === 'showdown-open'));
});

test('RIFT-886 opponent unit already at the Battlefield causes a staged Combat without client designation', () => {
  const f = setup({ firstPlayer: 0 });
  const attacker = f.playUnit('A');
  f.send('A', 'pass');
  const defender = f.playUnit('B');
  f.send('B', 'pass');
  f.send('A', 'pass');
  f.send('B', 'pass');
  const defenderField = f.fields[0];
  assert.equal(f.match.flow.turnPlayer, 'A');
  assert.equal(f.kernel.getObject(defender).exhausted, false);
  f.send('A', 'pass');
  assert.equal(f.match.flow.turnPlayer, 'B');
  f.send('B', 'move', { objectId: defender, to: { zone: 'battlefield', locationId: defenderField } });
  assert.deepEqual(f.kernel.getObject(defender).location, { type: 'battlefield', id: defenderField });
  f.send('B', 'pass');
  f.send('A', 'pass');
  f.send('B', 'pass');
  assert.equal(f.match.flow.turnPlayer, 'A');
  assert.equal(f.kernel.getObject(attacker).location?.type, 'base');
  f.send('A', 'move', { objectId: attacker, to: { zone: 'battlefield', locationId: defenderField } });
  assert.deepEqual(f.kernel.getObject(attacker).location, { type: 'battlefield', id: defenderField });
  const combat = f.match.flow.combat.current;
  assert.equal(combat?.field, defenderField);
  assert.equal(combat?.attacker, 'A');
  assert.equal(combat?.defender, 'B');
  assert.equal(f.match.events().some(event => event.timingPoint === 'combat-start' &&
    event.details.battlefieldId === defenderField), true);
});

test('RIFT-886 Rune Pool is empty through createMatch before the first actionable Main Phase', () => {
  const kernel = world().player('A', { energy: 3, power: ['Fury'] })
    .player('B', { energy: 2, power: ['Calm'] }).build();
  const choose = request => { throw new Error(`Unexpected real choice: ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) }, decks: [deck('A'), deck('B')],
    seed: 'RIFT-886-pool', battlefieldChoice: [0, 1], mulligans: [[], []], firstPlayer: 0,
  });
  assert.equal(match.flow.phase, 'main');
  assert.equal(match.flow.chain.priority, 'A');
  assert.deepEqual({ energy: kernel.player('A').energy, power: kernel.player('A').power },
    { energy: 0, power: [] });
  assert.deepEqual({ energy: kernel.player('B').energy, power: kernel.player('B').power },
    { energy: 0, power: [] });
});

test('RIFT-886 public move rejects an exhausted Unit without mutation', () => {
  const f = setup();
  const id = f.playUnit('A');
  const beforeKernel = f.kernel.snapshot();
  const beforeEvents = f.match.events();
  const beforeTrace = f.match.flow.chain.trace;
  assert.throws(() => f.send('A', 'move', {
    objectId: id, to: { zone: 'battlefield', locationId: f.fields[0] },
  }), error => error.code === 'illegal-move');
  assert.deepEqual(f.kernel.snapshot(), beforeKernel);
  assert.deepEqual(f.match.events(), beforeEvents);
  assert.deepEqual(f.match.flow.chain.trace, beforeTrace);
});

test('RIFT-886 public move rejects non-Unit objects without mutation', () => {
  const f = setup();
  const rune = f.kernel.objects.find(object => object.owner === 'A' &&
    object.zone === 'rune-zone' && object.types.includes('rune'));
  assert.ok(rune);
  const beforeKernel = f.kernel.snapshot();
  const beforeEvents = f.match.events();
  assert.throws(() => f.send('A', 'move', {
    objectId: rune.ref.id, to: { zone: 'battlefield', locationId: f.fields[0] },
  }), error => error.code === 'illegal-unit');
  assert.deepEqual(f.kernel.snapshot(), beforeKernel);
  assert.deepEqual(f.match.events(), beforeEvents);
});

test('RIFT-886 Battlefield to own Base commits through the public v2 move', () => {
  const f = setup();
  const [id] = f.readyUnits(1);
  f.send('A', 'move', { objectId: id, to: { zone: 'battlefield', locationId: f.fields[0] } });
  f.send('A', 'pass');
  f.send('B', 'pass');
  assert.equal(f.kernel.getObject(id).exhausted, true);
  assert.equal(f.kernel.perform({ type: 'ready', object: f.kernel.ref(id) }).status, 'done');
  assert.equal(f.kernel.getObject(id).exhausted, false);
  const result = f.send('A', 'move', { objectId: id, to: { zone: 'base', playerId: 'A' } });
  assert.equal(result.type, 'move');
  assert.deepEqual(f.kernel.getObject(id).location, { type: 'base', player: 'A' });
  assert.equal(f.kernel.getObject(id).exhausted, true);
  assert.ok(f.match.events().some(event => event.timingPoint === 'object-enters-base' &&
    event.object?.ref.id === id));
});

test('RIFT-886 Battlefield to Battlefield requires a live Ganking route', () => {
  const f = setup();
  const [id] = f.readyUnits(1);
  f.send('A', 'move', { objectId: id, to: { zone: 'battlefield', locationId: f.fields[0] } });
  f.send('A', 'pass');
  f.send('B', 'pass');
  f.kernel.perform({ type: 'ready', object: f.kernel.ref(id) });
  const beforeKernel = f.kernel.snapshot();
  const beforeEvents = f.match.events();
  assert.throws(() => f.send('A', 'move', {
    objectId: id, to: { zone: 'battlefield', locationId: f.fields[1] },
  }), error => error.code === 'illegal-move');
  assert.deepEqual(f.kernel.snapshot(), beforeKernel);
  assert.deepEqual(f.match.events(), beforeEvents);
  const source = f.kernel.getObject(id);
  f.match.flow.layers.registry.register({
    id: 'RIFT-886:ganking', layer: 'ability', source: source.ref, filter: { objectId: id },
    effect: { kind: 'movement', permission: { routes: ['battlefield-to-battlefield'] } },
  }, { type: 'permanent' });
  const result = f.send('A', 'move', {
    objectId: id, to: { zone: 'battlefield', locationId: f.fields[1] },
  });
  assert.equal(result.type, 'move');
  assert.deepEqual(f.kernel.getObject(id).location, { type: 'battlefield', id: f.fields[1] });
  assert.equal(f.kernel.getObject(id).exhausted, true);
});

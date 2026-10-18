import assert from 'node:assert/strict';
import test from 'node:test';

import bountyHunter from '../../../card-dsl/dist/cards/ogn/bounty-hunter.js';
import laurentBladekeeper from '../../../card-dsl/dist/cards/sfd/laurent-bladekeeper.js';
import megatusk from '../../../card-dsl/dist/cards/unl/megatusk.js';
import { EventPipeline } from '../../dist/events/pipeline.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding, expandProgram } from '../../dist/programs/index.js';
import { KeywordGrantLayerEngine } from '../../dist/programs/keyword-grants.js';
import { matchesObjectFilter } from '../../dist/layers/filter.js';
import { movement } from '../../dist/layers/rules/query.js';
import { AwaitChoice, world } from '../../dist/effects/testing/index.js';
import { applyOpenDuelCleanup, beginDuelShowdown, createDuelBoard, placeDuelUnit,
  selectDuelBattlefields } from '../../dist/duel/battlefields.js';
import { createDuelResources } from '../../dist/duel/resources.js';
import { materializeDuelUnitFromSettledSource } from '../../dist/duel/unit-lifecycle.js';
import {
  assertDuelStandardMoveUnitStillLegal,
  inspectDuelStandardMove,
  moveDuelUnitsStandard,
} from '../../dist/zones/movement.js';
import {
  StandardMoveBatchError,
  assertStandardMoveBatchAction,
  commitStandardMoveBatch,
  commitStandardMoveThroughPipeline,
} from '../../dist/turn/movement.js';

const c = value => ({ kind: 'constant', value });
const base = player => ({ type: 'base', player });
const field = id => ({ type: 'battlefield', id });
const idOf = location => location.type === 'base'
  ? JSON.stringify(['duel-base', location.player])
  : JSON.stringify(['duel-battlefield', location.id]);

function lifecycleFixture() {
  const board = createDuelBoard(selectDuelBattlefields([
    { playerId: 'A', battlefields: [
      { instanceId: 'a1', cardId: 'print-a1' }, { instanceId: 'a2', cardId: 'print-a2' },
      { instanceId: 'a3', cardId: 'print-a3' }] },
    { playerId: 'B', battlefields: [
      { instanceId: 'b1', cardId: 'print-b1' }, { instanceId: 'b2', cardId: 'print-b2' },
      { instanceId: 'b3', cardId: 'print-b3' }] },
  ], () => 0));
  const resources = createDuelResources({
    playerIds: ['A', 'B'],
    baseLocations: board.bases.map(entry => ({ playerId: entry.ownerPlayerId, locationId: entry.locationId })),
    runeDecks: [[], []],
  });
  const state = {
    stateVersion: 0,
    board,
    resources,
    players: [
      { playerId: 'A', champion: null, legend: { uid: 'legend-a', cardId: 'legend-a' },
        hand: [], remainingMainDeck: [], trash: [] },
      { playerId: 'B', champion: null, legend: { uid: 'legend-b', cardId: 'legend-b' },
        hand: [], remainingMainDeck: [], trash: [] },
    ],
    unitMeta: {}, retiredUnitTokenUIDs: [],
  };
  const baseA = board.bases.find(entry => entry.ownerPlayerId === 'A').locationId;
  const battlefieldA = board.battlefields[0].locationId;
  const battlefieldB = board.battlefields[1].locationId;
  const place = (stateValue, uid, locationId = baseA, controller = 'A') =>
    materializeDuelUnitFromSettledSource(stateValue, {
      kind: 'token', uid, unitType: 'Unit', name: uid, baseMight: 1, tags: [],
      ownerPlayerId: controller, controllerPlayerId: controller, locationId,
      entryReplacement: 'enter-ready',
    }, () => false);
  let current = place(state, 'u1');
  current = place(current, 'u2');
  current = place(current, 'g1', battlefieldA);
  current = place(current, 'enemy', battlefieldB, 'B');
  return { state: current, baseA, battlefieldA, battlefieldB, place };
}

function readinessFor(board) {
  return board.units.map(unit => ({ objectId: unit.objectId, readied: true, hasGanking: false }));
}

const timing = { phase: 'main', stateOpen: true, turnPlayerId: 'A', priorityPlayerId: 'A' };

function runtime(options = {}) {
  const kernel = world()
    .player('A').player('B')
    .unit('source', { types: ['legend'], might: null, energy: null, power: null,
      location: base('A') })
    .unit('u1', { cardId: laurentBladekeeper.canonicalCardId, keywords: [{ id: 'Ganking' }],
      location: field('bf1'), might: 2, energy: null, power: null })
    .unit('u2', { location: base('A'), might: 2, energy: null, power: null })
    .unit('enemy', { owner: 'B', controller: 'B', location: field('bf2'), might: 2,
      energy: null, power: null })
    .build();
  const answers = new Map(Object.entries(options.answers ?? {}));
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const checkpoint = () => ({ state: kernel.snapshot(), links: kernel.clone() });
  const restore = saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); };
  const pipeline = new EventPipeline(createActionPipelineHost({
    checkpoint, restore, objects: () => kernel.objects, perform: action => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    ...(options.cause ? { cause: options.cause } : {}),
  }), ['A', 'B'], 'A');
  return { kernel, pipeline, checkpoint, restore, choose, answers };
}

function boardRuntime() {
  const fixture = lifecycleFixture();
  const objects = fixture.state.board.units.map(unit => ({
    ref: { id: unit.objectId, zoneEntryId: 1 }, cardId: null, name: unit.objectId,
    types: ['unit'], tags: [], keywords: unit.objectId === 'g1' ? [{ id: 'Ganking' }] : [],
    owner: unit.controllerPlayerId, controller: unit.controllerPlayerId, zone: 'board',
    location: unit.locationId === fixture.baseA ? base('A') :
      unit.locationId === fixture.battlefieldA ? field('a1') : field('b1'),
    might: 2, energy: null, power: null, exhausted: !fixture.state.unitMeta[unit.objectId].readied,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  }));
  const mutable = new Map(objects.map(object => [object.ref.id, structuredClone(object)]));
  const checkpoint = () => structuredClone([...mutable.entries()]);
  const restore = snapshot => {
    mutable.clear();
    for (const [id, object] of snapshot) mutable.set(id, object);
  };
  const port = {
    checkpoint, restore,
    perform: action => {
      const object = 'object' in action ? mutable.get(action.object.id) : undefined;
      if (!object) return { status: 'impossible', events: [] };
      if (action.type === 'exhaust') object.exhausted = true;
      else if (action.type === 'move-location') object.location = action.to;
      else return { status: 'impossible', events: [] };
      return { status: 'done', events: [] };
    },
    objects: () => [...mutable.values()],
    choose: () => { throw new Error('unexpected choice'); },
    context: (source, controller, timingPoint) => bindResolveContext(world().build(), {
      source, controller, timingPoint, choose: () => { throw new Error('unexpected choice'); },
    }),
    turnOrder: ['A', 'B'], turnPlayer: 'A',
  };
  return { fixture, mutable, port };
}

test('EG-MOVE original Bounty Hunter Ganking grant and Laurent printed Ganking both feed movement', () => {
  const bounty = world().unit('target', { cardId: bountyHunter.canonicalCardId,
    keywords: [{ id: 'Ganking' }], location: field('bf1'), energy: null, power: null }).build();
  const target = bounty.ref('target');
  const context = source => bindResolveContext(bounty, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(bounty.objects, { context });
  const grant = expandProgram(bountyHunter, bounty.getObject('target')).abilities.find(ability =>
    ability.kind === 'activated').body[0];
  assert.equal(grant.op, 'continuous.grant-keyword');
  assert.equal(bountyHunter.status, 'judge-required');
  assert.equal(laurentBladekeeper.status, 'judge-required');
  assert.equal(laurentBladekeeper.abilities[0].kind, 'keyword');
  assert.equal(movement(layers.registry, target, layers.snapshot(target), 'A').canGank, true);
});

test('EG-MOVE original Bounty Hunter IR is still judge-required and its Ganking expansion is production-shaped', () => {
  const source = world().unit('bounty', { cardId: bountyHunter.canonicalCardId, types: ['legend'],
    might: null, energy: null, power: null, location: base('A') }).build();
  const expanded = expandProgram(bountyHunter, source.getObject('bounty'));
  assert.equal(expanded.declared[0].kind, 'activated');
  assert.equal(expanded.declared[0].body[0].op, 'continuous.grant-keyword');
  assert.equal(expanded.declared[0].body[0].args.keyword.value, 'Ganking');
  assert.equal(bountyHunter.status, 'judge-required');
  assert.match(bountyHunter.judgeReason, /Ganking/);
});

test('EG-MOVE base-to-battlefield and Battlefield-to-Battlefield Ganking use the same group action', () => {
  const f = lifecycleFixture();
  const readiness = readinessFor(f.state.board).map(entry =>
    entry.objectId === 'g1' ? { ...entry, hasGanking: true } : entry);
  // Use the actual second selected Battlefield rather than the first unit's origin.
  const destination = f.state.board.battlefields[1].locationId;
  const result = moveDuelUnitsStandard(f.state.board, readiness, {
    actor: 'A', unitUIDs: ['u1', 'g1'], destinationLocationId: destination, timing,
  });
  assert.deepEqual(result.group.events.map(event => [event.objectId, event.fromLocationId, event.toLocationId]), [
    ['u1', f.baseA, destination], ['g1', f.battlefieldA, destination],
  ]);
  assert.equal(result.group.exhaustedCount, 2);
  assert.ok(result.readiness.filter(entry => ['u1', 'g1'].includes(entry.objectId)).every(entry => entry.readied === false));
});

test('EG-MOVE one stale unit rejects the entire group and leaves every unit readied', () => {
  const f = lifecycleFixture();
  const readiness = readinessFor(f.state.board).map(entry =>
    entry.objectId === 'u2' ? { ...entry, readied: false } : entry);
  assert.throws(() => moveDuelUnitsStandard(f.state.board, readiness, {
    actor: 'A', unitUIDs: ['u1', 'u2'], destinationLocationId: f.battlefieldA, timing,
  }), /not readied/);
  assert.ok(f.state.unitMeta.u1.readied && f.state.unitMeta.u2.readied);
  assert.equal(f.state.board.units.find(unit => unit.objectId === 'u1').locationId, f.baseA);
});

test('EG-MOVE pipeline batch commits Exhaust and move-location with one batch id and one Move event per unit', () => {
  const f = boardRuntime();
  const board = f.fixture.state.board;
  const result = commitStandardMoveThroughPipeline(f.port, {
    board, unitIds: ['u2', 'g1'], actor: 'A', destination: field('a1'), timing,
    readiness: readinessFor(board), ref: id => ({ id, zoneEntryId: 1 }), transactionId: 'move-1',
  });
  assert.equal(result.receipt.status, 'committed');
  assert.deepEqual(result.receipt.actions.map(action => action.type), ['exhaust', 'move-location', 'exhaust', 'move-location']);
  assert.equal(result.requiresOpenCleanup, true);
  const moved = f.port.objects().filter(object => ['u2', 'g1'].includes(object.ref.id));
  assert.deepEqual(moved.map(object => object.ref.id).sort(), ['g1', 'u2']);
  assert.ok(moved.every(object => object.exhausted && object.location?.id === 'a1'));
});

test('EG-MOVE a rejected second move rolls back the first Exhaust + Move and its event log', () => {
  const f = boardRuntime();
  let count = 0;
  const original = f.port.perform;
  f.port.perform = action => {
    if (action.type === 'move-location' && ++count === 2) return { status: 'prevented', events: [] };
    return original(action);
  };
  const pipeline = new EventPipeline(createActionPipelineHost({
    checkpoint: f.port.checkpoint, restore: f.port.restore, objects: f.port.objects,
    perform: f.port.perform, choose: f.port.choose, context: f.port.context,
  }), ['A', 'B'], 'A');
  const before = structuredClone(f.port.objects());
  assert.throws(() => commitStandardMoveBatch({
    pipeline, checkpoint: f.port.checkpoint, restore: f.port.restore, board: f.fixture.state.board,
    unitIds: ['u1', 'u2'], actor: 'A', destination: field('a1'), timing,
    readiness: readinessFor(f.fixture.state.board), ref: id => ({ id, zoneEntryId: 1 }),
    object: id => f.port.objects().find(object => object.ref.id === id) ?? null,
  }), error => error instanceof StandardMoveBatchError && error.code === 'move-rejected' &&
    error.receipt?.status === 'rolled-back');
  assert.deepEqual(structuredClone(f.port.objects()), before);
  assert.equal(pipeline.events.filter(event => event.timingPoint === 'object-moved').length, 0);
});

test('EG-MOVE live recheck rejects a later unit moved by a replacement and rolls back the prior pair', () => {
  const f = boardRuntime();
  const before = structuredClone(f.port.objects());
  const original = f.port.perform;
  f.port.perform = action => {
    const outcome = original(action);
    if (action.type === 'exhaust' && action.object.id === 'u1') {
      const later = f.mutable.get('u2');
      later.location = field('b1');
    }
    return outcome;
  };
  const pipeline = new EventPipeline(createActionPipelineHost({
    checkpoint: f.port.checkpoint, restore: f.port.restore, objects: f.port.objects,
    perform: f.port.perform, choose: f.port.choose, context: f.port.context,
  }), ['A', 'B'], 'A');
  assert.throws(() => commitStandardMoveBatch({
    pipeline, checkpoint: f.port.checkpoint, restore: f.port.restore, board: f.fixture.state.board,
    unitIds: ['u1', 'u2'], actor: 'A', destination: field('a1'), timing,
    readiness: readinessFor(f.fixture.state.board), ref: id => ({ id, zoneEntryId: 1 }),
    object: id => f.port.objects().find(object => object.ref.id === id) ?? null,
  }), /left its planned origin|moved/);
  assert.deepEqual(structuredClone(f.port.objects()), before);
});

test('EG-MOVE Recall cannot enter the Standard Move batch', () => {
  assert.throws(() => assertStandardMoveBatchAction({ type: 'recall' }), error =>
    error instanceof StandardMoveBatchError && error.code === 'recall-is-not-a-move');
});

test('EG-MOVE production preflight rejects an active Showdown before any Exhaust', () => {
  const board = createDuelBoard(selectDuelBattlefields([
    { playerId: 'A', battlefields: [
      { instanceId: 'a1', cardId: 'print-a1' }, { instanceId: 'a2', cardId: 'print-a2' },
      { instanceId: 'a3', cardId: 'print-a3' }] },
    { playerId: 'B', battlefields: [
      { instanceId: 'b1', cardId: 'print-b1' }, { instanceId: 'b2', cardId: 'print-b2' },
      { instanceId: 'b3', cardId: 'print-b3' }] },
  ], () => 0));
  const location = board.battlefields[0].locationId;
  let current = placeDuelUnit(board, { objectId: 'holder', controllerPlayerId: 'A', locationId: location });
  current = applyOpenDuelCleanup(current);
  current = beginDuelShowdown(current, location);
  const readiness = current.units.map(unit => ({ objectId: unit.objectId, readied: true, hasGanking: false }));
  assert.throws(() => inspectDuelStandardMove(current, readiness, {
    actor: 'A', unitUIDs: ['holder'], destinationLocationId: current.battlefields[1].locationId, timing,
  }), /active Showdown or Combat/);
});

test('EG-MOVE move-location pipeline payload distinguishes Standard Move from Recall', () => {
  const f = runtime({ cause: action => action.type === 'move-location' ? 'standard-move' : 'exhaust' });
  const result = f.pipeline.commit({ type: 'move-location', object: f.kernel.ref('u1'), to: field('bf2') });
  assert.equal(result.status, 'done');
  const event = f.pipeline.events.find(item => item.timingPoint === 'object-moved');
  assert.equal(event.details.cause, 'standard-move');
  assert.equal(event.details.fromKind, 'battlefield');
  assert.equal(event.details.toLocationId, 'bf2');
});

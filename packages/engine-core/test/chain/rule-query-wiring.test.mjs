import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './helpers.mjs';
import { ContinuousEffectRegistry } from '../../dist/layers/duration.js';
import { moveDuelUnitsStandard } from '../../dist/zones/movement.js';
import { createDuelBoard, placeDuelUnit, selectDuelBattlefields } from '../../dist/duel/battlefields.js';

const c = value => ({ kind: 'constant', value });

function restriction(registry, id, filter, actions = ['target']) {
  registry.register({
    id, layer: 'ability', source: { id: 'ward', zoneEntryId: 1 }, filter,
    effect: { kind: 'restriction', actions, restriction: 'cannot-target' },
  }, { type: 'permanent' });
}

test('chain target Finalize and Resolve consume registered target restrictions', () => {
  const f = fixture();
  restriction(f.engine.layers.registry, 'ward-target', { objectId: 'enemy' });
  const draft = f.draft('spell', {
    kind: 'activated', speed: 'reaction', body: [],
    targets: [{ requirement: { id: 'victim', filter: { objectId: 'enemy' } } }],
  });
  assert.throws(() => f.engine.execute(draft), /required target count/);
});

test('chain Resolve retests a target after a restriction appears', () => {
  const f = fixture();
  const draft = f.draft('spell', {
    kind: 'activated', speed: 'reaction', body: [{
      id: 'hit', op: 'effect.damage', args: { amount: c(1), target: 'victim' },
      targets: [{ id: 'victim', filter: { objectId: 'enemy' }, max: 1 }],
    }],
    targets: [{ requirement: { id: 'victim', filter: { objectId: 'enemy' } }, options: { selected: [f.kernel.ref('enemy')] } }],
  });
  f.engine.execute(draft);
  assert.equal(f.engine.items.length, 1);
  restriction(f.engine.layers.registry, 'ward-late', { objectId: 'enemy' });
  while (f.engine.items.length) f.engine.pass(f.engine.priority);
  assert.equal(f.kernel.getObject('enemy').damage, 0);
});

test('Reaction timing grants are consumed by ChainEngine.canAct for the selected object', () => {
  const f = fixture();
  const source = f.kernel.getObject('source');
  f.engine.layers.registry.register({
    id: 'reaction-grant', layer: 'ability', source: source.ref, filter: { objectId: source.ref.id },
    effect: { kind: 'continuous.timing', grants: ['reaction', 'closed-state'] },
  }, { type: 'permanent' });
  f.engine.openShowdown('A');
  assert.equal(f.engine.canAct('A', 'reaction', source.ref, source), true);
  assert.equal(f.engine.canAct('A', 'normal', source.ref, source), false);
});

test('a Reaction card can be played by the non-turn player during an open Showdown', () => {
  const f = fixture({ turnPlayer: 'B', cards: [{ id: 'reaction-card', energy: 1, power: [] }] });
  f.engine.openShowdown('A');
  const reaction = f.card('reaction-card', {
    controller: 'A',
    speed: 'reaction',
    body: [],
  });
  f.engine.execute(reaction);
  assert.equal(f.engine.items[0].source.ref.id, 'reaction-card');
  assert.equal(f.engine.turnState, 'showdown-closed');
});

test('Chain Execute consumes action restrictions before a draft is admitted', () => {
  const f = fixture();
  f.engine.layers.registry.register({
    id: 'deny-activate', layer: 'ability', source: { id: 'ward', zoneEntryId: 1 },
    filter: { objectId: 'source' },
    effect: { kind: 'restriction', actions: ['activate'], restriction: 'cannot-activate' },
  }, { type: 'permanent' });
  assert.throws(() => f.engine.execute(f.draft('blocked-ability')), /restricted/);
  assert.equal(f.engine.items.length, 0);
});

test('Chain Finalize consumes play-location restrictions before paying a Unit', () => {
  const f = fixture({ cards: [{ id: 'unit-card', types: ['unit'], energy: 1, power: [] }] });
  f.engine.layers.registry.register({
    id: 'deny-base', layer: 'ability', source: { id: 'ward', zoneEntryId: 1 },
    filter: { objectId: 'unit-card' },
    effect: { kind: 'location', restriction: 'no-base' },
  }, { type: 'permanent' });
  const unit = f.card('unit-card', {
    kind: 'unit',
    body: [],
    location: { type: 'base', player: 'A' },
  });
  assert.throws(() => f.engine.execute(unit), /Play destination/);
  assert.equal(f.kernel.getObject('unit-card').zone, 'hand');
});

function duelBoard() {
  const board = createDuelBoard(selectDuelBattlefields([
    { playerId: 'A', battlefields: [{ instanceId: 'a-1', cardId: 'f1' }, { instanceId: 'a-2', cardId: 'f2' }, { instanceId: 'a-3', cardId: 'f3' }] },
    { playerId: 'B', battlefields: [{ instanceId: 'b-1', cardId: 'f1' }, { instanceId: 'b-2', cardId: 'f2' }, { instanceId: 'b-3', cardId: 'f3' }] },
  ], () => 0));
  const base = board.bases.find(value => value.ownerPlayerId === 'A').locationId;
  const battlefield = board.battlefields[0].locationId;
  return { board: placeDuelUnit(board, { objectId: 'u1', controllerPlayerId: 'A', locationId: base }), base, battlefield };
}

test('Standard Move rejects a unit covered by a cannot-move rule query and recovers after expiry', () => {
  const scene = duelBoard();
  const readiness = [{ objectId: 'u1', readied: true, hasGanking: false }];
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: 'stop', layer: 'ability', source: { id: 'ward', zoneEntryId: 1 }, filter: { objectId: 'u1' },
    effect: { kind: 'movement', restrictions: ['cannot-move'] },
  }, { type: 'end-of-turn' });
  const request = { actor: 'A', unitUIDs: ['u1'], destinationLocationId: scene.battlefield,
    timing: { phase: 'main', stateOpen: true, turnPlayerId: 'A', priorityPlayerId: 'A' } };
  assert.throws(() => moveDuelUnitsStandard(scene.board, readiness, request, { registry }), /prohibited from moving/);
  registry.expireAt({ id: 'turn-end' }, () => null);
  const moved = moveDuelUnitsStandard(scene.board, readiness, request, { registry });
  assert.equal(moved.board.units[0].locationId, scene.battlefield);
});

test('Standard Move also consumes continuous.restrict action=move prohibitions', () => {
  const scene = duelBoard();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: 'stop-action', layer: 'ability', source: { id: 'ward', zoneEntryId: 1 }, filter: { objectId: 'u1' },
    effect: { kind: 'restriction', actions: ['move'], restriction: 'cannot-move' },
  }, { type: 'permanent' });
  const request = { actor: 'A', unitUIDs: ['u1'], destinationLocationId: scene.battlefield,
    timing: { phase: 'main', stateOpen: true, turnPlayerId: 'A', priorityPlayerId: 'A' } };
  assert.throws(() => moveDuelUnitsStandard(scene.board, [{ objectId: 'u1', readied: true, hasGanking: false }], request, { registry }), /prohibited from moving/);
});

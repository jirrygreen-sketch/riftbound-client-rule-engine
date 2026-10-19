import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFacedownZone, facedownProjectionObjects, planHide, planHiddenPlay, projectFacedownZone,
} from '../../../dist/zones/facedown/index.js';
import { projectFor } from '../../../dist/projection/v2/index.js';
import { world } from '../../../dist/effects/testing/index.js';

function hiddenZone() {
  const ctx = world().hand('secret-instance', {
    cardId: 'secret-printing', name: 'Secret Front', types: ['spell'], tags: ['Secret Tag'],
    keywords: [{ id: 'hidden' }], energy: null, power: null,
  }).card('field', { zone: 'board', types: ['battlefield'], location: { type: 'battlefield', id: 'field' } }).build();
  const battlefield = ctx.object(ctx.ref('field'));
  const timing = { turn: 7, actor: 'A', turnPlayer: 'A', priorityHolder: 'A', stateOpen: true, showdown: false };
  const hide = planHide(createFacedownZone('field'), ctx.object(ctx.ref('secret-instance')), battlefield, timing);
  return { hide, battlefield, timing };
}

test('zone projection reveals the front only to its controller and exposes only count to opponents', () => {
  const { hide } = hiddenZone();
  const before = structuredClone(hide.zone);
  const own = projectFacedownZone(hide.zone, 'A', 7);
  assert.equal(own.count, 1);
  assert.equal(own.cards[0].cardId, 'secret-printing');
  assert.equal(own.cards[0].name, 'Secret Front');
  assert.equal(own.cards[0].energy, null);
  assert.equal(own.cards[0].power, null);
  assert.equal(own.cards[0].reaction, false);
  assert.equal(own.cards[0].hiddenOnTurn, 7);
  for (const viewer of ['B', 'spectator', 'replay', null]) {
    const other = projectFacedownZone(hide.zone, viewer, 8);
    assert.deepEqual(other, { battlefieldId: 'field', count: 1, cards: [] });
    const serialized = JSON.stringify(other);
    for (const privateValue of ['secret-instance', 'secret-printing', 'Secret Front', 'Secret Tag', 'hiddenOnTurn', 'reaction']) {
      assert.ok(!serialized.includes(privateValue), `${viewer} must not learn ${privateValue}`);
    }
  }
  assert.deepEqual(hide.zone, before);
});

test('projection v2 bridge hides characteristics, turn and Reaction while retaining public occupancy', () => {
  const { hide } = hiddenZone();
  const objects = facedownProjectionObjects(hide.zone, 8);
  const state = { players: [{ id: 'A', facedown: objects }, { id: 'B', facedown: [] }], objects };
  const own = projectFor(state, 'A');
  assert.equal(own.players.A.facedown.count, 1);
  assert.equal(own.players.A.facedown.cards[0].cardId, 'secret-printing');
  assert.equal(own.players.A.facedown.cards[0].reaction, true);
  for (const viewer of ['B', null, 'replay']) {
    const other = projectFor(state, viewer);
    assert.equal(other.players.A.facedown.count, 1);
    const card = other.players.A.facedown.cards[0];
    assert.equal(card.visibility, 'face-down');
    assert.ok(card.ref.id.startsWith('hidden:'));
    for (const key of ['cardId', 'name', 'types', 'tags', 'keywords', 'energy', 'power', 'reaction', 'hiddenOnTurn']) {
      assert.equal(card[key], undefined, `${key} must be omitted`);
    }
    assert.ok(!JSON.stringify(other).includes('secret-instance'));
    assert.ok(!JSON.stringify(other).includes('secret-printing'));
  }
});

test('CR 128.4 gives a controlled facedown front to the controller, even with a different owner', () => {
  const { hide } = hiddenZone();
  // Trusted initial ownership variation; it does not simulate a control-change action.
  const zone = { battlefieldId: 'field', cards: [{ ...hide.entry, owner: 'B' }] };
  assert.equal(projectFacedownZone(zone, 'A', 8).cards[0].cardId, 'secret-printing');
  assert.deepEqual(projectFacedownZone(zone, 'B', 8), { battlefieldId: 'field', count: 1, cards: [] });
});

test('a Hidden play plan is public on the chain with a new zone-entry identity', () => {
  const { hide, battlefield, timing } = hiddenZone();
  const play = planHiddenPlay(hide.zone, hide.entry.ref, battlefield, { ...timing, turn: 8, stateOpen: false, turnPlayer: 'B' });
  const state = { players: [{ id: 'A' }, { id: 'B' }], objects: [play.card],
    chain: [{ id: 'hidden-play', status: 'pending', controller: 'A', object: play.card, source: play.card }] };
  for (const viewer of ['A', 'B', null, 'replay']) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.chain[0].source.cardId, 'secret-printing');
    assert.equal(projection.chain[0].object.ref.zoneEntryId, 3);
    assert.equal(projection.chain[0].object.faceDown, false);
    assert.equal(projection.players.A.facedown.count, 0);
  }
});

test('empty zone projection stays count-only and projection input is detached', () => {
  const { hide } = hiddenZone();
  assert.deepEqual(projectFacedownZone(createFacedownZone('field'), 'A', 1), { battlefieldId: 'field', count: 0, cards: [] });
  const objects = facedownProjectionObjects(hide.zone, 8);
  objects[0].keywords.push({ id: 'tampered' });
  objects[0].ref.zoneEntryId = 999;
  assert.deepEqual(hide.entry.front.keywords, [{ id: 'hidden' }]);
  assert.equal(hide.entry.ref.zoneEntryId, 2);
});

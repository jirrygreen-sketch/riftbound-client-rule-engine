// Pure DTO boundary tests: the V2 snapshot is a wire-shape fixture, not an engine projector.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DUEL_PROJECTION_SCHEMA, DUEL_PROJECTION_SCHEMA_V2,
  isDuelProjection, isDuelProjectionV1, isDuelProjectionV2, isDuelProjectionAny,
  isDuelProjectionMessage, isDuelProjectionMessageV2, isDuelProjectionMessageAny,
  isDuelCommandMessage,
} from '../dist/duel-contract.js';
import { isServerMessage, isClientMessage } from '../dist/index.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/duel-v2-projection.json', import.meta.url), 'utf8'));
const v1 = JSON.parse(readFileSync(new URL('./fixtures/duel-projections.json', import.meta.url), 'utf8'));
const clone = structuredClone;
const message = projection => ({ type: 'duel-projection', roomId: 'room-1', projection });
function reject(base, mutate) {
  const projection = clone(base);
  mutate(projection);
  assert.equal(isDuelProjectionV2(projection), false);
  assert.equal(isDuelProjection(projection), false);
  assert.equal(isDuelProjectionAny(projection), false);
  assert.equal(isDuelProjectionMessage(message(projection)), false);
  assert.equal(isDuelProjectionMessageV2(message(projection)), false);
  assert.equal(isDuelProjectionMessageAny(message(projection)), false);
  assert.equal(isServerMessage(message(projection)), false);
}

test('V2 is a distinct schema; V1 guard and fixture remain V1-only', () => {
  assert.equal(DUEL_PROJECTION_SCHEMA, 'riftbound-duel-v1');
  assert.equal(DUEL_PROJECTION_SCHEMA_V2, 'riftbound-duel-v2');
  for (const scenario of ['setup', 'playing', 'pending', 'changed']) {
    for (const viewer of ['p1', 'p2', 'null']) {
      const oldProjection = v1[scenario][viewer];
      const projection = fixture[scenario][viewer];
      assert.equal(isDuelProjectionV1(oldProjection), true, `${scenario}/${viewer} V1 guard`);
      assert.equal(isDuelProjection(oldProjection), true, `${scenario}/${viewer} legacy guard`);
      assert.equal(isDuelProjectionV2(oldProjection), false, `${scenario}/${viewer} V2 guard`);
      assert.equal(isDuelProjectionAny(oldProjection), true, `${scenario}/${viewer} union guard`);
      assert.equal(isDuelProjectionMessage(message(oldProjection)), true);
      assert.equal(isDuelProjectionMessageV2(message(oldProjection)), false);
      assert.equal(isDuelProjectionMessageAny(message(oldProjection)), true);
      assert.equal(isServerMessage(message(oldProjection)), true);
      assert.equal(isDuelProjectionV1(projection), false, `${scenario}/${viewer} V1 guard`);
      assert.equal(isDuelProjection(projection), false, `${scenario}/${viewer} legacy guard`);
      assert.equal(isDuelProjectionV2(projection), true, `${scenario}/${viewer} V2 guard`);
      assert.equal(isDuelProjectionAny(projection), true, `${scenario}/${viewer} union guard`);
      assert.equal(isDuelProjectionMessage(message(projection)), false);
      assert.equal(isDuelProjectionMessageV2(message(projection)), true);
      assert.equal(isDuelProjectionMessageAny(message(projection)), true);
      assert.equal(isServerMessage(message(projection)), true);
      assert.equal(projection.projectionSchema, DUEL_PROJECTION_SCHEMA_V2);
      assert.equal(projection.match.schemaVersion, 2);
      assert.equal(Object.hasOwn(projection.match, 'provenance'), false);
    }
  }
});

test('projectionSchema and match.schemaVersion must form an exact pair', () => {
  const p2 = fixture.playing.p1;
  const p1 = v1.playing.p1;
  reject(p2, p => { p.projectionSchema = DUEL_PROJECTION_SCHEMA; });
  reject(p2, p => { p.match.schemaVersion = 1; });
  for (const version of [0, 3, '2', 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])
    reject(p2, p => { p.match.schemaVersion = version; });
  for (const schema of ['riftbound-duel-v3', '', null, 'riftbound-foundation-v2'])
    reject(p2, p => { p.projectionSchema = schema; });
  const cross = clone(p1); cross.match.schemaVersion = 2;
  assert.equal(isDuelProjectionV1(cross), false);
  assert.equal(isDuelProjectionV2(cross), false);
  assert.equal(isDuelProjection(cross), false);
  assert.equal(isDuelProjectionAny(cross), false);
  assert.equal(isDuelProjectionMessageAny(message(cross)), false);
  assert.equal(isServerMessage(message(cross)), false);
  const inverse = clone(p1); inverse.projectionSchema = DUEL_PROJECTION_SCHEMA_V2;
  assert.equal(isDuelProjectionV1(inverse), false);
  assert.equal(isDuelProjectionV2(inverse), false);
  assert.equal(isDuelProjection(inverse), false);
  assert.equal(isDuelProjectionAny(inverse), false);
  assert.equal(isDuelProjectionMessageAny(message(inverse)), false);
  assert.equal(isServerMessage(message(inverse)), false);
});

test('the DTO guard cannot authenticate the private pending-payment actor', () => {
  // This is a deliberately UNSAFE packet, not a legitimate projector output:
  // p2 can receive p1's cost and ID without any public field revealing actor=p1.
  // The trusted projector must filter by private actor for the authenticated
  // viewer; the server must validate the outbound packet before sending it.
  const forged = clone(fixture.pending.p2);
  forged.match.frame.pendingPayment = clone(fixture.pending.p1.match.frame.pendingPayment);
  assert.equal(forged.viewerPlayerId, 'p2');
  assert.equal(forged.match.frame.priorityPlayerId, 'p1');
  assert.equal(isDuelProjectionV2(forged), true);
});

test('V2 setup and playing visibility: only authenticated viewer hand can appear', () => {
  for (const stage of ['setup', 'playing']) {
    for (const viewer of ['p1', 'p2', 'null']) {
      const projection = fixture[stage][viewer];
      const players = stage === 'setup' ? projection.match.setup.players : projection.match.players;
      assert.deepEqual(players.map(p => Object.hasOwn(p, 'hand')),
        viewer === 'null' ? [false, false] : viewer === 'p1' ? [true, false] : [false, true]);
      reject(projection, p => {
        const ps = stage === 'setup' ? p.match.setup.players : p.match.players;
        ps[viewer === 'p1' ? 1 : 0].hand = [];
      });
      if (viewer !== 'null') reject(projection, p => {
        const ps = stage === 'setup' ? p.match.setup.players : p.match.players;
        delete ps[viewer === 'p1' ? 0 : 1].hand;
      });
      reject(projection, p => { p.viewerPlayerId = 'stranger'; });
    }
  }
});

test('V2 refuses all private authority/zone sidecars at every public boundary', () => {
  for (const field of ['provenance', 'originalPhysicalCards', 'initialZonesByUID',
    'zoneEpoch', 'receipts', 'requiredTasks', 'priorityPayments']) {
    reject(fixture.playing.p1, p => { p.match[field] = { leaked: true }; });
    reject(fixture.playing.p1, p => { p[field] = { leaked: true }; });
  }
  reject(fixture.setup.p1, p => { p.match.setup.players[0].initialZonesByUID = {}; });
  reject(fixture.setup.p1, p => { p.match.setup.players[0].mainDeck = []; });
  reject(fixture.setup.p1, p => { p.match.setup.selectedBattlefields[0].zoneEpoch = 1; });
  reject(fixture.playing.p1, p => { p.match.players[0].originalPhysicalCards = []; });
  reject(fixture.playing.p1, p => { p.match.players[1].runeDeck = []; });
  reject(fixture.playing.p1, p => { p.match.resources.players[0].priorityPayments = []; });
  reject(fixture.changed.p1, p => { p.match.resources.bases[0].baseRunes[0].zoneEpoch = 1; });
  reject(fixture.playing.p1, p => { p.match.board.units.push({ provenance: {} }); });
  reject(fixture.playing.p1, p => { p.match.frame.requiredTasks = []; });
  reject(fixture.pending.p1, p => { p.match.frame.pendingPayment.sourceReference = { uid: 'secret' }; });
  reject(fixture.pending.p2, p => { p.match.frame.pendingPayment.paymentId = 'payment-1'; });
  reject(fixture.pending.null, p => { p.match.frame.pendingPayment.resolvedCost = { energy: 0, power: [] }; });
  reject(fixture.pending.p1, p => { delete p.match.frame.pendingPayment.resolvedCost; });
});

test('V2 still validates arrays, numbers, enums, cross-zone links and hostile objects', () => {
  const playing = fixture.changed.p1;
  reject(playing, p => { p.match.stateVersion = NaN; });
  reject(playing, p => { p.match.eventSeq = Number.MAX_SAFE_INTEGER + 1; });
  reject(playing, p => { p.match.resources.players[0].runePool.power.Fury = -1; });
  reject(playing, p => { p.match.frame.phase = 'secret-phase'; });
  reject(playing, p => { p.match.board.battlefields[0].combat = 'secret-combat'; });
  reject(playing, p => { p.match.board.battlefields[0].locationId = 'forged'; });
  reject(playing, p => { p.match.resources.bases[0].baseRunes[0].domain = 'unbounded'; });
  reject(playing, p => { p.match.roster[1].playerId = 'p1'; });
  reject(playing, p => { p.match.players[0].hand.push(p.match.players[0].hand[0]); p.match.players[0].handCount++; });
  reject(playing, p => { p.match.players[0].hand = new Array(p.match.players[0].handCount); });
  reject(playing, p => { p.actions = new Array(1); });
  reject(playing, p => { p.match.board.units.foo = 'private'; });
  reject(playing, p => { p.match[Symbol('sidecar')] = 'private'; });
  reject(playing, p => { Object.defineProperty(p.match, 'stateVersion', { get: () => 0 }); });
  reject(playing, p => { Object.setPrototypeOf(p.match.frame, { receipts: [] }); });
});

test('V2 actions bind to viewer/state while the five existing commands remain unchanged', () => {
  const setup = clone(fixture.setup.p1);
  setup.actions = [{ id: 'mulligan-1', kind: 'mulligan', label: 'Choose cards',
    enabled: true, maxSelections: 2, selectableUIDs: [setup.match.setup.players[0].hand[0].uid] }];
  assert.equal(isDuelProjectionV2(setup), true);
  reject(setup, p => { p.actions[0].selectableUIDs = ['p2-main-1']; });
  reject(setup, p => { p.actions[0].sourceReference = { uid: 'secret' }; });
  reject(fixture.setup.null, p => { p.actions = setup.actions; });
  const pending = clone(fixture.pending.p1);
  pending.actions = [{ id: 'pay', kind: 'pay-pending', label: 'Pay', enabled: true,
    paymentId: pending.match.frame.pendingPayment.paymentId,
    resolvedCost: clone(pending.match.frame.pendingPayment.resolvedCost) }];
  assert.equal(isDuelProjectionV2(pending), true);
  reject(pending, p => { p.actions[0].resolvedCost.power[0].allowedDomains = ['any']; });
  reject(fixture.pending.p2, p => { p.actions = clone(pending.actions); });
  const changed = clone(fixture.changed.p1);
  changed.actions = [{ id: 'rune', kind: 'rune-energy', label: 'Channel', enabled: true, uid: 'p1-rune' }];
  assert.equal(isDuelProjectionV2(changed), true);
  reject(changed, p => { p.actions[0].uid = 'p2-rune'; });
  reject(changed, p => { p.actions.push({ ...p.actions[0] }); });
  const command = cmd => ({ type: 'duel-command', requestId: 'req-1', commandId: 'cmd-1', expectedVersion: 2, command: cmd });
  for (const cmd of [{ type: 'mulligan', selectedUIDs: [] },
    ...['rune-energy', 'rune-power', 'gold-power'].map(type => ({ type, uid: 'rune-1' })),
    { type: 'pay-pending', paymentId: 'pay-1' }]) {
    assert.equal(isDuelCommandMessage(command(cmd)), true);
    assert.equal(isClientMessage(command(cmd)), true);
  }
  for (const cmd of [{ type: 'end-turn' }, { type: 'play-card', cardUID: 'card-1' },
    { type: 'move', objectId: 'unit-1' }, { type: 'combat', objectId: 'unit-1' }]) {
    assert.equal(isDuelCommandMessage(command(cmd)), false);
    assert.equal(isClientMessage(command(cmd)), false);
  }
});

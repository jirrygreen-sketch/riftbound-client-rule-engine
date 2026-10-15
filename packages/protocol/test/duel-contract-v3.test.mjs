// Pure V3 DTO tests: permanent-enhanced playing fields are versioned and strictly allowlisted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DUEL_PROJECTION_SCHEMA, DUEL_PROJECTION_SCHEMA_V2, DUEL_PROJECTION_SCHEMA_V3,
  isDuelProjection, isDuelProjectionV1, isDuelProjectionV2, isDuelProjectionV3,
  isDuelProjectionAny, isDuelProjectionMessage, isDuelProjectionMessageV2,
  isDuelProjectionMessageV3, isDuelProjectionMessageAny,
} from '../dist/duel-contract.js';
import { isServerMessage } from '../dist/index.js';

const v1Fixtures = JSON.parse(readFileSync(new URL('./fixtures/duel-projections.json', import.meta.url), 'utf8'));
const v2Fixtures = JSON.parse(readFileSync(new URL('./fixtures/duel-v2-projection.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const packet = projection => ({ type: 'duel-projection', roomId: 'room-1', projection });

function v3(base, viewer = 'p1') {
  const projection = clone(base);
  projection.projectionSchema = DUEL_PROJECTION_SCHEMA_V3;
  projection.match.schemaVersion = 3;
  return projection;
}

function v3Playing(scenario = 'playing', viewer = 'p1') {
  const projection = v3(v2Fixtures[scenario][viewer], viewer);
  const players = projection.match.players;
  for (const player of players) {
    player.legend = {
      cardId: player.legend.cardId,
      controllerPlayerId: player.playerId,
      readiness: 'ready',
    };
  }
  projection.match.board.gears = [];
  return projection;
}

function reject(base, mutate) {
  const candidate = clone(base);
  mutate(candidate);
  assert.equal(isDuelProjectionV3(candidate), false);
  assert.equal(isDuelProjection(candidate), false);
  assert.equal(isDuelProjectionV2(candidate), false);
  assert.equal(isDuelProjectionAny(candidate), false);
  assert.equal(isDuelProjectionMessage(packet(candidate)), false);
  assert.equal(isDuelProjectionMessageV2(packet(candidate)), false);
  assert.equal(isDuelProjectionMessageV3(packet(candidate)), false);
  assert.equal(isDuelProjectionMessageAny(packet(candidate)), false);
  assert.equal(isServerMessage(packet(candidate)), false);
}

test('V3 has an independent schema and setup only changes the version pair', () => {
  assert.equal(DUEL_PROJECTION_SCHEMA, 'riftbound-duel-v1');
  assert.equal(DUEL_PROJECTION_SCHEMA_V2, 'riftbound-duel-v2');
  assert.equal(DUEL_PROJECTION_SCHEMA_V3, 'riftbound-duel-v3');
  for (const viewer of ['p1', 'p2', null]) {
    const setup = v3(v2Fixtures.setup[viewer === null ? 'null' : viewer], viewer);
    assert.equal(isDuelProjectionV3(setup), true, `V3 setup ${viewer}`);
    assert.equal(isDuelProjection(setup), false);
    assert.equal(isDuelProjectionV2(setup), false);
    assert.equal(isDuelProjectionAny(setup), true);
    assert.equal(isDuelProjectionMessageV3(packet(setup)), true);
    assert.equal(isDuelProjectionMessageAny(packet(setup)), true);
    assert.equal(isServerMessage(packet(setup)), true);
    assert.equal(Object.hasOwn(setup.match.setup, 'gears'), false);
    assert.equal(Object.hasOwn(setup.match.setup.players[0].legend, 'readiness'), false);
  }
  reject(v3(v2Fixtures.setup.p1), projection => { projection.match.setup.gears = []; });
  reject(v3(v2Fixtures.setup.p1), projection => { projection.match.setup.players[0].legend.readiness = 'ready'; });
  const switched = v3(v2Fixtures.setup.p1);
  switched.match.schemaVersion = 2;
  reject(switched, () => {});
  switched.match.schemaVersion = 3;
  switched.projectionSchema = DUEL_PROJECTION_SCHEMA_V2;
  reject(switched, () => {});
});

test('V3 playing requires permanent legend and board shapes while preserving viewer hands', () => {
  for (const viewer of ['p1', 'p2', null]) {
    const projection = v3Playing('playing', viewer);
    assert.equal(isDuelProjectionV3(projection), true, `V3 playing ${viewer}`);
    assert.equal(isDuelProjection(projection), false);
    assert.equal(isDuelProjectionV2(projection), false);
    assert.equal(isDuelProjectionAny(projection), true);
    assert.equal(isDuelProjectionMessageV3(packet(projection)), true);
    assert.equal(isServerMessage(packet(projection)), true);
    assert.deepEqual(projection.match.board.gears, []);
    assert.deepEqual(projection.match.players.map(player => player.legend.readiness), ['ready', 'ready']);
    assert.deepEqual(projection.match.players.map(player => Object.hasOwn(player, 'hand')),
      viewer === null ? [false, false] : viewer === 'p1' ? [true, false] : [false, true]);
  }
  const awaiting = v3Playing('playing', 'p1');
  awaiting.match.frame.phase = 'awaiting-turn-start';
  awaiting.match.frame.priorityPlayerId = null;
  awaiting.match.frame.pendingPayment = null;
  awaiting.match.players[0].legend.readiness = 'not-established';
  awaiting.match.players[1].legend.readiness = 'not-established';
  assert.equal(isDuelProjectionV3(awaiting), true);
  awaiting.actions = [];
  awaiting.match.players[0].legend.readiness = 'not-established';
  awaiting.match.frame.turnNumber = 2;
  reject(awaiting, () => {});
  const main = v3Playing('changed', 'p1');
  main.match.players[0].legend.readiness = 'not-established';
  reject(main, () => {});
  const valid = v3Playing('changed', 'p1');
  valid.match.players[0].legend.controllerPlayerId = 'p2';
  assert.equal(isDuelProjectionV3(valid), true, 'Legend controller may change seats');
  reject(valid, p => { p.match.players[0].legend.controllerPlayerId = 'stranger'; });
  reject(valid, p => { p.match.players[0].legend.uid = 'private-legend-uid'; });
  reject(valid, p => { p.match.players[0].legend.ownerPlayerId = 'p1'; });
  reject(valid, p => { p.match.players[0].legend.readiness = 'unknown'; });
  reject(valid, p => { delete p.match.players[0].legend.readiness; });
  reject(valid, p => { delete p.match.players[0].legend.controllerPlayerId; });
  reject(valid, p => { delete p.match.board.gears; });
  reject(valid, p => { p.match.players[1].hand = []; });
  reject(valid, p => { delete p.match.players[0].hand; });
  for (const readiness of ['ready', 'exhausted']) {
    const valid = v3Playing('changed', 'p1');
    valid.match.players[0].legend.readiness = readiness;
    assert.equal(isDuelProjectionV3(valid), true, readiness);
  }
});

test('V3 accepts unoccupied and attached Gear chains without adding them to Unit occupancy', () => {
  const projection = v3Playing('changed', 'p1');
  const baseLocation = projection.match.board.bases[0].locationId;
  const unitId = 'unit-card-1';
  projection.match.board.bases[0].occupancy = [unitId];
  projection.match.board.units = [{
    objectId: unitId,
    controllerPlayerId: 'p1',
    locationId: baseLocation,
    ownerPlayerId: 'p1',
    readied: true,
    trait: { kind: 'card', cardId: 'unit.1' },
    totalDamage: 0,
    damageMarks: [],
  }];
  projection.match.board.gears = [
    { uid: 'gear-1', cardId: 'gear.1', controllerPlayerId: 'p1', locationId: baseLocation,
      readied: true, attachedToUID: unitId },
    { uid: 'gear-2', cardId: 'gear.2', controllerPlayerId: 'p1', locationId: baseLocation,
      readied: false, attachedToUID: 'gear-1' },
    { uid: 'gear-3', cardId: 'gear.3', controllerPlayerId: 'p1', locationId: baseLocation,
      readied: true, attachedToUID: null },
  ];
  assert.equal(isDuelProjectionV3(projection), true);
  assert.equal(projection.match.board.bases[0].occupancy.includes('gear-1'), false);
  assert.equal(isServerMessage(packet(projection)), true);
  const foreignController = clone(projection);
  foreignController.match.board.gears[0].controllerPlayerId = 'p2';
  assert.equal(isDuelProjectionV3(foreignController), true, 'foreign controller may attach to base-owner host');
  reject(projection, p => {
    p.match.board.gears[2].controllerPlayerId = 'p2';
  });
  const foreignHost = clone(projection);
  foreignHost.match.board.gears[1].controllerPlayerId = 'p2';
  assert.equal(isDuelProjectionV3(foreignHost), true, 'attached Gear may differ in controller from host');
});

test('V3 rejects invalid Gear aliases, hosts, locations, controls and attachment graphs', () => {
  const base = v3Playing('changed', 'p1');
  const location = base.match.board.bases[0].locationId;
  const field = base.match.board.battlefields[0].locationId;
  const unit = {
    objectId: 'card-unit', controllerPlayerId: 'p1', locationId: field, ownerPlayerId: 'p1',
    readied: true, trait: { kind: 'card', cardId: 'unit.1' }, totalDamage: 0, damageMarks: [],
  };
  base.match.board.battlefields[0].occupancy = ['card-unit'];
  base.match.board.battlefields[0].contested = true;
  base.match.board.battlefields[0].contestingPlayerId = 'p1';
  base.match.board.units = [unit];
  base.match.board.gears = [{ uid: 'gear-1', cardId: 'gear.1', controllerPlayerId: 'p1',
    locationId: field, readied: true, attachedToUID: null }];
  assert.equal(isDuelProjectionV3(base), true);
  reject(base, p => { p.match.board.gears[0].attachedToUID = 'missing'; });
  reject(base, p => { p.match.board.gears[0].attachedToUID = 'card-unit'; p.match.board.gears[0].locationId = location; });
  reject(base, p => { p.match.board.gears[0].attachedToUID = 'gear-1'; });
  reject(base, p => { p.match.board.gears[0].locationId = 'unknown-location'; });
  reject(base, p => { p.match.board.gears[0].controllerPlayerId = 'stranger'; });
  reject(base, p => { p.match.board.gears[0].cardId = ''; });
  reject(base, p => { p.match.board.gears[0].uid = 'card-unit'; });
  reject(base, p => { p.match.board.gears[0].attachedToUID = base.match.players[0].hand[0].uid; });
  reject(base, p => { p.match.board.gears[0].attachedToUID = base.match.resources.bases[0].baseRunes[0].uid; });
  reject(base, p => { p.match.board.gears[0].attachedToUID = base.match.board.battlefields[0].instanceId; });
  for (const alias of [base.match.board.battlefields[0].instanceId, location,
    base.match.players[0].hand[0].uid, base.match.resources.bases[0].baseRunes[0].uid,
    base.match.resources.bases[0].goldTokens[0].uid, 'p1']) {
    reject(base, p => { p.match.board.gears[0].uid = alias; });
  }
  reject(base, p => { p.match.board.gears.push(clone(p.match.board.gears[0])); });
  reject(base, p => { p.match.board.battlefields[0].occupancy = ['card-unit', 'gear-1']; });
  const trashAlias = clone(base);
  trashAlias.match.players[0].trash.push({ uid: 'gear-1', cardId: 'gear.1' });
  reject(trashAlias, () => {});
  const tokenHost = clone(base);
  tokenHost.match.board.units[0].trait = { kind: 'token', name: 'Guard', baseMight: 2, tags: ['Guard'] };
  tokenHost.match.board.gears[0].attachedToUID = 'card-unit';
  reject(tokenHost, () => {});
  const crossGear = clone(base);
  crossGear.match.board.gears.push({ uid: 'gear-2', cardId: 'gear.2', controllerPlayerId: 'p2',
    locationId: crossGear.match.board.bases[1].locationId, readied: true, attachedToUID: 'gear-1' });
  reject(crossGear, () => {});
  const ring = clone(base);
  ring.match.board.gears = [
    { uid: 'gear-1', cardId: 'gear.1', controllerPlayerId: 'p1', locationId: field,
      readied: true, attachedToUID: 'gear-2' },
    { uid: 'gear-2', cardId: 'gear.2', controllerPlayerId: 'p1', locationId: field,
      readied: true, attachedToUID: 'gear-1' },
  ];
  reject(ring, () => {});
});

test('V3 refuses private extras and hostile object shapes at every permanent boundary', () => {
  const base = v3Playing('changed', 'p1');
  const location = base.match.board.bases[0].locationId;
  base.match.board.gears = [{ uid: 'gear-1', cardId: 'gear.1', controllerPlayerId: 'p1',
    locationId: location, readied: true, attachedToUID: null }];
  for (const field of ['zoneEpoch', 'ownerPlayerId', 'provenance', 'physicalCardsByUID', 'sourceReference']) {
    reject(base, p => { p.match.board.gears[0][field] = 'private'; });
    reject(base, p => { p.match[field] = 'private'; });
  }
  reject(base, p => { p.match.board.gears.push({ uid: 'gear-2', cardId: 'gear.2',
    controllerPlayerId: 'p1', locationId: location, readied: true, attachedToUID: null, secret: true }); });
  reject(base, p => { p.match.board.gears.foo = 'private'; });
  reject(base, p => { p.match.board.gears[Symbol('private')] = true; });
  reject(base, p => { p.match.players[0].legend[Symbol('private')] = true; });
  reject(base, p => { p.match.board[Symbol('private')] = true; });
  reject(base, p => { p.actions = new Array(1); });
  reject(base, p => { p.match.frame.sourceReference = 'private'; });
  reject(base, p => { p.match.scoring.provenance = 'private'; });
  reject(base, p => { p.match.resources.bases[0].baseRunes[0].zoneEpoch = 1; });
  reject(base, p => { Object.defineProperty(p.match.board.gears[0], 'cardId', { get: () => 'gear.1' }); });
  reject(base, p => { Object.setPrototypeOf(p.match.board.gears[0], { private: true }); });
  const sparse = clone(base);
  sparse.match.board.gears = new Array(1);
  assert.equal(isDuelProjectionV3(sparse), false);
  const payment = v3Playing('pending', 'p1');
  assert.equal(isDuelProjectionV3(payment), true);
  reject(payment, p => { p.match.frame.pendingPayment.sourceReference = 'private'; });
  const hidden = v3Playing('pending', 'p2');
  assert.equal(isDuelProjectionV3(hidden), true);
  reject(hidden, p => { p.match.frame.pendingPayment.paymentId = 'payment-1'; });
});

test('V1 and V2 remain exact and cannot be upgraded by adding V3 permanent fields', () => {
  for (const versionFixtures of [v1Fixtures, v2Fixtures]) {
    for (const scenario of ['setup', 'playing']) {
      for (const viewer of ['p1', 'p2', 'null']) {
        const base = versionFixtures[scenario][viewer];
        assert.equal(isDuelProjectionV3(base), false);
        if (scenario === 'setup') {
          reject(base, p => { p.match.setup.permanents = []; });
          reject(base, p => { p.match.setup.players[0].legend.readiness = 'ready'; });
        } else {
          reject(base, p => { p.match.board.gears = []; });
          reject(base, p => { p.match.players[0].legend.controllerPlayerId = 'p1'; });
          reject(base, p => { p.match.players[0].legend.readiness = 'ready'; });
        }
      }
    }
  }
  const v1Playing = clone(v1Fixtures.playing.p1);
  v1Playing.projectionSchema = DUEL_PROJECTION_SCHEMA_V3;
  assert.equal(isDuelProjectionV3(v1Playing), false);
  const v2Playing = clone(v2Fixtures.playing.p1);
  v2Playing.projectionSchema = DUEL_PROJECTION_SCHEMA_V3;
  assert.equal(isDuelProjectionV3(v2Playing), false);
  const v3PlayingProjection = v3Playing('playing', 'p1');
  v3PlayingProjection.projectionSchema = DUEL_PROJECTION_SCHEMA;
  assert.equal(isDuelProjection(v3PlayingProjection), false);
  v3PlayingProjection.projectionSchema = DUEL_PROJECTION_SCHEMA_V2;
  assert.equal(isDuelProjectionV2(v3PlayingProjection), false);
});

test('all accepted versioned DTO fields are enumerable and survive JSON round-trip', () => {
  const hide = (object, key) => {
    const value = object[key];
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value,
    });
  };
  const v3 = v3Playing('changed', 'p1');
  assert.equal(isDuelProjectionV3(v3), true);
  assert.equal(isDuelProjectionV3(JSON.parse(JSON.stringify(v3))), true);
  assert.equal(isDuelProjectionMessageV3(packet(v3)), true);
  assert.equal(isDuelProjectionMessageAny(packet(v3)), true);
  assert.equal(isServerMessage(packet(v3)), true);
  const v1Legal = clone(v1Fixtures.playing.p1);
  assert.equal(isDuelProjection(v1Legal), true);
  assert.equal(isDuelProjection(JSON.parse(JSON.stringify(v1Legal))), true);
  assert.equal(isDuelProjectionMessage(packet(v1Legal)), true);
  assert.equal(isDuelProjectionMessage(packet(JSON.parse(JSON.stringify(v1Legal)))), true);
  assert.equal(isServerMessage(packet(JSON.parse(JSON.stringify(v1Legal)))), true);
  const v2Legal = clone(v2Fixtures.playing.p1);
  assert.equal(isDuelProjectionV2(v2Legal), true);
  assert.equal(isDuelProjectionV2(JSON.parse(JSON.stringify(v2Legal))), true);
  assert.equal(isDuelProjectionMessageV2(packet(v2Legal)), true);
  assert.equal(isDuelProjectionMessageV2(packet(JSON.parse(JSON.stringify(v2Legal)))), true);
  assert.equal(isServerMessage(packet(JSON.parse(JSON.stringify(v2Legal)))), true);

  const v3Cases = [
    ['Gear uid', p => hide(p.match.board.gears[0], 'uid')],
    ['board.gears', p => hide(p.match.board, 'gears')],
    ['Legend readiness', p => hide(p.match.players[0].legend, 'readiness')],
    ['viewer hand', p => hide(p.match.players[0], 'hand')],
    ['schemaVersion', p => hide(p.match, 'schemaVersion')],
  ];
  for (const [label, mutate] of v3Cases) {
    const candidate = clone(v3);
    // Add a Gear so the nested uid case exercises a required Gear field.
    if (label === 'Gear uid') {
      candidate.match.board.gears = [{ uid: 'gear-1', cardId: 'gear.1',
        controllerPlayerId: 'p1', locationId: candidate.match.board.bases[0].locationId,
        readied: true, attachedToUID: null }];
    }
    mutate(candidate);
    assert.equal(isDuelProjectionV3(candidate), false, label);
    assert.equal(isDuelProjectionMessageV3(packet(candidate)), false, `${label} V3 message`);
    assert.equal(isDuelProjectionMessageAny(packet(candidate)), false, `${label} any message`);
    assert.equal(isServerMessage(packet(candidate)), false, `${label} server message`);
    assert.equal(isDuelProjectionV3(JSON.parse(JSON.stringify(candidate))), false, `${label} JSON`);
  }

  const v1 = clone(v1Fixtures.playing.p1);
  hide(v1.match, 'matchId');
  assert.equal(isDuelProjection(v1), false, 'V1 non-enumerable required field');
  assert.equal(isDuelProjectionMessage(packet(v1)), false, 'V1 message');
  assert.equal(isServerMessage(packet(v1)), false, 'V1 server message');
  assert.equal(isDuelProjection(JSON.parse(JSON.stringify(v1))), false, 'V1 JSON');

  const v2 = clone(v2Fixtures.playing.p1);
  hide(v2.match, 'stateVersion');
  assert.equal(isDuelProjectionV2(v2), false, 'V2 non-enumerable required field');
  assert.equal(isDuelProjectionMessageV2(packet(v2)), false, 'V2 message');
  assert.equal(isServerMessage(packet(v2)), false, 'V2 server message');
  assert.equal(isDuelProjectionV2(JSON.parse(JSON.stringify(v2))), false, 'V2 JSON');
});

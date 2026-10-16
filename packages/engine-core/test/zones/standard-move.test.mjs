// Node tests for the staged internal Standard Move kernel (CR v1.4 143.4, 144, 447, 810).
// Real fixtures only: selectDuelBattlefields -> createDuelBoard -> placeDuelUnit (+ the real
// cleanup/showdown/combat helpers where an engagement must be genuinely active).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDuelBattlefields, createDuelBoard, placeDuelUnit, applyOpenDuelCleanup,
  beginDuelShowdown, beginDuelCombat, endDuelNonCombatShowdown,
} from '../../dist/duel/battlefields.js';
import {
  moveDuelUnitsStandard, assertDuelReadiness, restoreDuelReadiness,
} from '../../dist/zones/movement.js';

const serial = value => JSON.parse(JSON.stringify(value));
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
const seats = () => [
  { playerId: 'alice', battlefields: [
    { instanceId: 'a-1', cardId: 'printing-x' }, { instanceId: 'a-2', cardId: 'printing-y' },
    { instanceId: 'a-3', cardId: 'printing-z' },
  ] },
  { playerId: 'bob', battlefields: [
    { instanceId: 'b-1', cardId: 'printing-x' }, { instanceId: 'b-2', cardId: 'printing-y' },
    { instanceId: 'b-3', cardId: 'printing-z' },
  ] },
];
/** Real factory: 485.4–5 battlefield selection plus createDuelBoard. */
function newBoard(index = 0) {
  const board = createDuelBoard(selectDuelBattlefields(seats(), () => index));
  const base = playerId => board.bases.find(entry => entry.ownerPlayerId === playerId).locationId;
  return {
    board, f1: board.battlefields[0].locationId, f2: board.battlefields[1].locationId,
    baseA: base('alice'), baseB: base('bob'),
  };
}
const fieldOf = (board, locationId) => board.battlefields.find(field => field.locationId === locationId);
const unitOf = (board, objectId) => board.units.find(unit => unit.objectId === objectId);
function place(board, objectId, controllerPlayerId, locationId) {
  return placeDuelUnit(board, { objectId, controllerPlayerId, locationId });
}
/** Readiness exactly mirrors board.units; `ganking`/`exhausted` list objectIds. */
function readinessFor(board, { ganking = [], exhausted = [] } = {}) {
  return board.units.map(unit => ({
    objectId: unit.objectId, readied: !exhausted.includes(unit.objectId),
    hasGanking: ganking.includes(unit.objectId),
  }));
}
// Trusted timing (420.3 Discretionary Action + 312 Priority): by default the actor is both the turn
// player and the holder of Priority, as 312.2.a grants it to the turn player in a Neutral Open Main
// Phase. Individual cases override turnPlayerId / priorityPlayerId to probe the gate.
const mainTiming = actor => ({
  phase: 'main', stateOpen: true, turnPlayerId: actor, priorityPlayerId: actor,
});
const request = (actor, unitUIDs, destinationLocationId, timing = mainTiming(actor)) =>
  ({ actor, unitUIDs, destinationLocationId, timing });
const readinessById = readiness => new Map(readiness.map(entry => [entry.objectId, entry]));
/** Real chain that leaves `locationId` controlled by alice with her unit still there. */
function aliceControls(board, locationId, objectId) {
  let current = place(board, objectId, 'alice', locationId);
  current = applyOpenDuelCleanup(current);
  current = beginDuelShowdown(current, locationId);
  current = endDuelNonCombatShowdown(current, locationId);
  assert.equal(fieldOf(current, locationId).controllerPlayerId, 'alice');
  return current;
}

test('144.3: one group action moves units from different origins to one destination', () => {
  const { board, f1, f2, baseA } = newBoard();
  let current = place(board, 'u-1', 'alice', baseA);
  current = place(current, 'u-2', 'alice', f1); // f1 becomes contested by alice on entry
  current = place(current, 'u-3', 'alice', baseA);
  const readiness = readinessFor(current, { ganking: ['u-2'] });
  const before = serial(current);
  const readinessBefore = serial(readiness);
  const result = moveDuelUnitsStandard(current, readiness, request('alice', ['u-1', 'u-2'], f2));
  assert.equal(unitOf(result.board, 'u-1').locationId, f2);
  assert.equal(unitOf(result.board, 'u-2').locationId, f2);
  assert.equal(unitOf(result.board, 'u-3').locationId, baseA, 'unselected unit keeps its location');
  assert.equal(result.group.kind, 'standard-move');
  assert.equal(result.group.actor, 'alice');
  assert.equal(result.group.destinationLocationId, f2);
  assert.deepEqual(result.group.objectIds, ['u-1', 'u-2']);
  assert.equal(result.group.exhaustedCount, 2);
  assert.equal(result.group.requiresMoveTriggers, true);
  assert.equal(result.group.requiresOpenCleanup, true);
  assert.deepEqual(serial(result.group.events), [
    { objectId: 'u-1', actor: 'alice', fromLocationId: baseA, toLocationId: f2 },
    { objectId: 'u-2', actor: 'alice', fromLocationId: f1, toLocationId: f2 },
  ]);
  assert.deepEqual(serial(current), before, 'the input board is never mutated');
  const after = readinessById(result.readiness);
  assert.equal(after.get('u-1').readied, false);
  assert.equal(after.get('u-2').readied, false);
  assert.equal(after.get('u-3').readied, true, 'only the selected units are exhausted');
  assert.deepEqual(result.readiness.map(entry => entry.objectId), readiness.map(entry => entry.objectId));
  assert.deepEqual(serial(readiness), readinessBefore, 'the input readiness is never mutated');
});

test('a selected unit that already stands at the destination is rejected', () => {
  const { board, f1, baseA } = newBoard();
  let current = place(board, 'u-1', 'alice', baseA);
  current = place(current, 'u-2', 'alice', f1);
  assert.throws(() => moveDuelUnitsStandard(current, readinessFor(current), request('alice', ['u-1', 'u-2'], f1)),
    /already at the destination/);
});

test('validation is atomic: one bad unit pays nothing and moves nothing', () => {
  const { board, f1, baseA, baseB } = newBoard();
  let current = place(board, 'u-1', 'alice', baseA);
  current = place(current, 'u-2', 'bob', baseB);
  const readiness = readinessFor(current);
  const boardBefore = serial(current);
  const readinessBefore = serial(readiness);
  assert.throws(() => moveDuelUnitsStandard(current, readiness, request('alice', ['u-1', 'u-2'], f1)),
    /not controlled by the actor/);
  assert.deepEqual(serial(current), boardBefore);
  assert.deepEqual(serial(readiness), readinessBefore);
  assert.equal(unitOf(current, 'u-1').locationId, baseA);
  assert.equal(readiness[0].readied, true);
});

test('every timing and readiness fault is atomic, with no partial payment', () => {
  const { board, f1, baseA, baseB } = newBoard();
  let current = place(board, 'u-1', 'alice', baseA);
  current = place(current, 'u-2', 'alice', baseA);
  const boardBefore = serial(current);
  const cases = [
    ['exhausted second unit', readinessFor(current, { exhausted: ['u-2'] }),
      request('alice', ['u-1', 'u-2'], f1), /not readied/],
    ['Closed State', readinessFor(current),
      request('alice', ['u-1', 'u-2'], f1,
        { phase: 'main', stateOpen: false, turnPlayerId: 'alice', priorityPlayerId: 'alice' }), /Open/],
    ['other phase', readinessFor(current),
      request('alice', ['u-1', 'u-2'], f1,
        { phase: 'other', stateOpen: true, turnPlayerId: 'alice', priorityPlayerId: 'alice' }), /phase must be main/],
    ['nobody holds Priority (312.1.b)', readinessFor(current),
      request('alice', ['u-1', 'u-2'], f1,
        { phase: 'main', stateOpen: true, turnPlayerId: 'alice', priorityPlayerId: null }), /Priority/],
    ['another player holds Priority', readinessFor(current),
      request('alice', ['u-1', 'u-2'], f1,
        { phase: 'main', stateOpen: true, turnPlayerId: 'alice', priorityPlayerId: 'bob' }), /Priority/],
    ['opponent base destination', readinessFor(current),
      request('alice', ['u-1', 'u-2'], baseB), /another player/],
    ['unknown destination', readinessFor(current),
      request('alice', ['u-1', 'u-2'], 'nowhere'), /unknown destination/],
    ['duplicate request UID', readinessFor(current),
      request('alice', ['u-1', 'u-1'], f1), /duplicate/],
    ['unknown request UID', readinessFor(current),
      request('alice', ['u-1', 'ghost'], f1), /unknown unit/],
    ['empty request group', readinessFor(current),
      request('alice', [], f1), /must not be empty/],
  ];
  for (const [label, readiness, req, pattern] of cases) {
    assert.throws(() => moveDuelUnitsStandard(current, readiness, req), pattern, label);
    assert.deepEqual(serial(current), boardBefore, `${label} left the board untouched`);
  }
});

test('420.3/312: holding Priority is not enough when the actor is not the turn player', () => {
  // 312.2.a grants Priority to the turn player in a Neutral Open Main Phase, so a Priority holder
  // who is not the turn player is inconsistent timing and must be refused.
  const { board, f1, baseA } = newBoard();
  let current = place(board, 'u-1', 'alice', baseA);
  current = place(current, 'u-2', 'alice', baseA);
  const boardBefore = serial(current);
  assert.throws(() => moveDuelUnitsStandard(current, readinessFor(current),
    request('alice', ['u-1'], f1,
      { phase: 'main', stateOpen: true, turnPlayerId: 'bob', priorityPlayerId: 'alice' })),
  /not the turn player/);
  assert.deepEqual(serial(current), boardBefore, 'the refused move mutated nothing');
  assert.equal(readinessFor(current)[0].readied, true, 'no exhaustion cost was paid');
});

test('420.3/312: being the turn player is not enough without holding Priority', () => {
  // The Standard Move is a Discretionary Action, so Priority — not the turn — is the permission.
  const { board, f1, baseA } = newBoard();
  let current = place(board, 'u-1', 'alice', baseA);
  current = place(current, 'u-2', 'alice', baseA);
  const boardBefore = serial(current);
  assert.throws(() => moveDuelUnitsStandard(current, readinessFor(current),
    request('alice', ['u-1'], f1,
      { phase: 'main', stateOpen: true, turnPlayerId: 'alice', priorityPlayerId: 'bob' })),
  /Priority/);
  assert.deepEqual(serial(current), boardBefore, 'the refused move mutated nothing');
  assert.equal(readinessFor(current)[0].readied, true, 'no exhaustion cost was paid');
});

test('144.1.c: an active Showdown blocks the Standard Move', () => {
  const { board, f1, f2, baseA } = newBoard();
  let current = place(board, 'u-bob', 'bob', f1);
  current = applyOpenDuelCleanup(current);
  current = beginDuelShowdown(current, f1);
  assert.equal(fieldOf(current, f1).showdown, 'active');
  current = place(current, 'u-1', 'alice', baseA);
  assert.throws(() => moveDuelUnitsStandard(current, readinessFor(current), request('alice', ['u-1'], f2)),
    /active Showdown or Combat/);
});

test('144.1.c: an active Combat blocks the Standard Move', () => {
  const { board, f1, f2, baseA } = newBoard();
  let current = place(board, 'u-alice', 'alice', f1);
  current = applyOpenDuelCleanup(current);
  current = place(current, 'u-bob', 'bob', f1);
  current = applyOpenDuelCleanup(current);
  current = beginDuelCombat(current, f1);
  assert.equal(fieldOf(current, f1).combat, 'active');
  current = place(current, 'u-1', 'alice', baseA);
  assert.throws(() => moveDuelUnitsStandard(current, readinessFor(current), request('alice', ['u-1'], f2)),
    /active Showdown or Combat/);
});

test('flagged open question: a merely staged (non-active) Showdown is allowed by this kernel', () => {
  // The controller-fixed rule refuses only ACTIVE engagements. CR 144.1.c reads "during a Showdown
  // or Combat"; whether "staged" must block too is open and reported upstream.
  const { board, f1, f2, baseA } = newBoard();
  let current = place(board, 'u-bob', 'bob', f1);
  current = applyOpenDuelCleanup(current);
  assert.equal(fieldOf(current, f1).showdown, 'staged');
  current = place(current, 'u-1', 'alice', baseA);
  const result = moveDuelUnitsStandard(current, readinessFor(current), request('alice', ['u-1'], f2));
  assert.equal(unitOf(result.board, 'u-1').locationId, f2);
});

test('144.4.a: base to battlefield is legal with no occupancy cap (seven units in one group)', () => {
  const { board, f1, baseA } = newBoard();
  let current = board;
  const ids = [];
  for (let i = 0; i < 7; i++) {
    ids.push(`u-${i}`);
    current = place(current, `u-${i}`, 'alice', baseA);
  }
  const result = moveDuelUnitsStandard(current, readinessFor(current), request('alice', ids, f1));
  assert.equal(result.group.exhaustedCount, 7);
  assert.equal(result.group.events.length, 7);
  for (const objectId of ids) assert.equal(unitOf(result.board, objectId).locationId, f1);
  assert.deepEqual([...fieldOf(result.board, f1).occupancy].sort(), [...ids].sort());
  assert.equal(fieldOf(result.board, f1).contested, true);
  assert.equal(fieldOf(result.board, f1).contestingPlayerId, 'alice');
});

test('144.4.b: battlefield to the controller’s own base is legal, to the other base is not', () => {
  const { board, f1, baseA, baseB } = newBoard();
  const current = place(board, 'u-1', 'alice', f1);
  const readiness = readinessFor(current);
  const result = moveDuelUnitsStandard(current, readiness, request('alice', ['u-1'], baseA));
  assert.equal(unitOf(result.board, 'u-1').locationId, baseA);
  assert.deepEqual(fieldOf(result.board, f1).occupancy, []);
  assert.throws(() => moveDuelUnitsStandard(current, readiness, request('alice', ['u-1'], baseB)),
    /another player’s base/);
});

test('810 / 144.4.c: battlefield to battlefield needs Ganking on that very unit', () => {
  const { board, f1, f2, baseA } = newBoard();
  let current = place(board, 'u-1', 'alice', f1);
  current = place(current, 'u-2', 'alice', f1);
  const readiness = readinessFor(current, { ganking: ['u-1'] });
  assert.throws(() => moveDuelUnitsStandard(current, readiness, request('alice', ['u-2'], f2)),
    /needs Ganking/);
  const result = moveDuelUnitsStandard(current, readiness, request('alice', ['u-1'], f2));
  assert.equal(unitOf(result.board, 'u-1').locationId, f2);
  assert.equal(unitOf(result.board, 'u-2').locationId, f1, 'the unit without Ganking stays');
  // Ganking only adds an option: the same unit may still use the plain battlefield → base move.
  const back = moveDuelUnitsStandard(current, readiness, request('alice', ['u-1'], baseA));
  assert.equal(unitOf(back.board, 'u-1').locationId, baseA);
});

test('ownership is never consulted: a unit moves with its controller, never with its owner', () => {
  const { board, f1, f2, baseA, baseB } = newBoard();
  // The board stores no unit owner (DuelUnit = objectId/controller/location) and readiness cannot
  // carry one either, so a unit "owned" by the other player is still positioned by its controller.
  const current = place(board, 'u-taken', 'alice', f1);
  const readiness = readinessFor(current);
  assert.deepEqual(Object.keys(readiness[0]), ['objectId', 'readied', 'hasGanking']);
  const result = moveDuelUnitsStandard(current, readiness, request('alice', ['u-taken'], baseA));
  assert.equal(unitOf(result.board, 'u-taken').controllerPlayerId, 'alice');
  assert.equal(unitOf(result.board, 'u-taken').locationId, baseA, 'the controller’s own base');
  assert.throws(() => moveDuelUnitsStandard(current, readiness, request('alice', ['u-taken'], baseB)),
    /another player’s base/, 'the other player’s base is refused whatever the ownership');
  assert.throws(() => moveDuelUnitsStandard(current, readiness, request('bob', ['u-taken'], f2)),
    /not controlled by the actor/, 'the non-controller may not move the unit');
});

test('no cleanup runs: entry applies contested, but control/engagement stay untouched', () => {
  const { board, f1, baseA, baseB } = newBoard();
  const controlled = aliceControls(board, f1, 'u-a1');
  assert.equal(fieldOf(controlled, f1).contested, false);
  // Bob walks in from his base: 190.3.a contested applies immediately; nothing is staged or cleared.
  const current = place(controlled, 'u-bob', 'bob', baseB);
  const result = moveDuelUnitsStandard(current, readinessFor(current), request('bob', ['u-bob'], f1));
  const after = fieldOf(result.board, f1);
  assert.equal(after.controllerPlayerId, 'alice', 'control is not re-evaluated by the move');
  assert.equal(after.contested, true);
  assert.equal(after.contestingPlayerId, 'bob');
  assert.equal(after.showdown, 'none', 'no Showdown is staged by the move');
  assert.equal(after.combat, 'none');
  assert.equal(result.group.requiresOpenCleanup, true);
  // Alice leaves her own controlled field: control/contest survive until the outer cleanup.
  const leave = moveDuelUnitsStandard(controlled, readinessFor(controlled), request('alice', ['u-a1'], baseA));
  assert.equal(fieldOf(leave.board, f1).controllerPlayerId, 'alice');
  assert.equal(fieldOf(leave.board, f1).showdown, 'none');
  assert.equal(leave.group.requiresMoveTriggers, true);
  const cleaned = applyOpenDuelCleanup(leave.board);
  assert.equal(fieldOf(cleaned, f1).controllerPlayerId, null,
    'only the outer cleanup clears an absent controller');
});

test('readiness must match board.units exactly and may not carry location/controller authority', () => {
  const { board, f1, baseA } = newBoard();
  let current = place(board, 'u-1', 'alice', baseA);
  current = place(current, 'u-2', 'alice', baseA);
  const good = readinessFor(current);
  const req = () => request('alice', ['u-1'], f1);
  assert.equal(assertDuelReadiness(current, good), undefined);
  assert.deepEqual(restoreDuelReadiness(current, good), good);
  const bad = [
    ['unknown UID', [...good, { objectId: 'ghost', readied: true, hasGanking: false }]],
    ['missing record', good.slice(1)],
    ['duplicate UID', [good[0], { ...good[0] }]],
    ['non-boolean readied', [{ ...good[0], readied: 'yes' }, good[1]]],
    ['non-boolean hasGanking', [{ ...good[0], hasGanking: 1 }, good[1]]],
    ['extra locationId field', good.map(entry => ({ ...entry, locationId: baseA }))],
    ['extra controllerPlayerId field', good.map(entry => ({ ...entry, controllerPlayerId: 'alice' }))],
  ];
  for (const [label, value] of bad) {
    assert.throws(() => moveDuelUnitsStandard(current, value, req()), TypeError, label);
    assert.throws(() => assertDuelReadiness(current, value), TypeError, label);
  }
  const sparse = [good[0], good[1]];
  delete sparse[1];
  assert.throws(() => moveDuelUnitsStandard(current, sparse, req()), /sparse/);
  assert.throws(() => assertDuelReadiness(current, []), /exactly one record per board unit/);
});

test('request shape and timing are strict, never defaulted', () => {
  const { board, f1, baseA } = newBoard();
  const current = place(board, 'u-1', 'alice', baseA);
  const readiness = readinessFor(current);
  const good = request('alice', ['u-1'], f1);
  assert.throws(() => moveDuelUnitsStandard(current, readiness, { ...good, extra: 1 }), /keys/);
  assert.throws(() => moveDuelUnitsStandard(current, readiness, { ...good, actor: 'carol' }), /unknown player/);
  assert.throws(() => moveDuelUnitsStandard(current, readiness,
    { ...good, timing: { ...good.timing, extra: true } }), /keys/);
  assert.throws(() => moveDuelUnitsStandard(current, readiness,
    { ...good, timing: { ...good.timing, phase: 'combat' } }), /phase/);
  assert.throws(() => moveDuelUnitsStandard(current, readiness,
    { ...good, timing: { ...good.timing, stateOpen: 'open' } }), /boolean/);
  assert.throws(() => moveDuelUnitsStandard(current, readiness,
    { actor: 'alice', unitUIDs: ['u-1'], destinationLocationId: f1 }), /keys/);
});

test('the result is detached: frozen inputs are untouched and never aliased by the output', () => {
  const { board, f1, baseA } = newBoard();
  let current = place(board, 'u-1', 'alice', baseA);
  current = place(current, 'u-2', 'alice', baseA);
  const readiness = deepFreeze(readinessFor(current));
  const req = deepFreeze(request('alice', ['u-1', 'u-2'], f1));
  const frozen = deepFreeze(current);
  const result = moveDuelUnitsStandard(frozen, readiness, req);
  assert.notEqual(result.board, frozen);
  assert.notEqual(result.readiness, readiness);
  assert.equal(unitOf(frozen, 'u-1').locationId, baseA, 'the frozen input board is unchanged');
  assert.equal(readiness.every(entry => entry.readied), true, 'the frozen input readiness is unchanged');
  result.board.units[0].locationId = 'tampered';
  assert.equal(unitOf(frozen, 'u-1').locationId, baseA, 'the output never aliases the input');
});

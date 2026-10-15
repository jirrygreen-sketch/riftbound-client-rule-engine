import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDuelBattlefields, createDuelBoard, restoreDuelBoard, assertDuelBoard,
  placeDuelUnit, relocateDuelUnit, removeDuelUnit, applyOpenDuelCleanup,
  beginDuelShowdown, beginDuelCombat, endDuelNonCombatShowdown, endDuelCombat,
  projectPublicDuelBoard,
} from '../dist/duel/battlefields.js';

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
function setup() {
  const selection = selectDuelBattlefields(seats(), () => 0);
  const board = createDuelBoard(selection);
  const [a, b] = board.battlefields.map(field => field.locationId);
  const [baseA, baseB] = board.bases.map(base => base.locationId);
  return { selection, board, a, b, baseA, baseB };
}
const field = (board, locationId) => board.battlefields.find(value => value.locationId === locationId);
const unit = (objectId, controllerPlayerId, locationId) => ({ objectId, controllerPlayerId, locationId });
const serial = value => JSON.parse(JSON.stringify(value));

// 485.4–5: validate before any RNG; exactly once for each valid seat, no implicit RNG.
test('selection keeps instance identity, seat-order RNG and private removals independent', () => {
  const input = seats();
  const before = serial(input);
  const calls = [];
  const result = selectDuelBattlefields(input, bound => { calls.push(bound); return calls.length === 1 ? 0 : 2; });
  assert.deepEqual(calls, [3, 3]);
  assert.deepEqual(result.selected, [
    { playerId: 'alice', instanceId: 'a-1', cardId: 'printing-x' },
    { playerId: 'bob', instanceId: 'b-3', cardId: 'printing-z' },
  ]);
  assert.deepEqual(result.removedByPlayer.map(value => value.battlefields.map(v => v.instanceId)),
    [['a-2', 'a-3'], ['b-1', 'b-2']]);
  assert.deepEqual(input, before);
  input[0].battlefields[0].cardId = 'changed';
  assert.equal(result.selected[0].cardId, 'printing-x');
  result.removedByPlayer[0].battlefields[0].cardId = 'changed';
  assert.equal(result.removedByPlayer[1].battlefields[0].cardId, 'printing-x');
  const { board, selection } = setup();
  assert.equal(board.battlefields[0].cardId, board.battlefields[1].cardId);
  assert.notEqual(board.battlefields[0].instanceId, board.battlefields[1].instanceId);
  assert.notEqual(board.battlefields[0].locationId, board.battlefields[1].locationId);
  selection.selected[0].cardId = 'altered after board creation';
  assert.equal(board.battlefields[0].cardId, 'printing-x');
});

test('bad seats fail before RNG and bad RNG values never return a selection', () => {
  for (const mutate of [
    value => value.pop(), value => value.push(value[0]),
    value => { value[1].playerId = 'alice'; },
    value => { value[0].battlefields.pop(); },
    value => { value[1].battlefields[0].instanceId = 'a-1'; },
    value => { value[0].battlefields[0].instanceId = ''; },
    value => { value[0].battlefields[0].cardId = null; },
    value => { value[0].battlefields[0].private = 'leak'; },
  ]) {
    const invalid = seats(); mutate(invalid);
    let calls = 0;
    assert.throws(() => selectDuelBattlefields(invalid, () => { calls++; return 1; }), TypeError);
    assert.equal(calls, 0);
  }
  for (const value of [-1, 3, NaN, Infinity, 0.2, '1', null, undefined]) {
    let calls = 0;
    assert.throws(() => selectDuelBattlefields(seats(), () => { calls++; return value; }), TypeError);
    assert.equal(calls, 1);
  }
  assert.throws(() => selectDuelBattlefields(seats(), () => { throw Error('rng down'); }), /rng down/);
  assert.throws(() => selectDuelBattlefields(seats(), null), TypeError);
});

test('restore round-trip and independent deep copies do not reroll random selection', () => {
  const { board, a, baseA } = setup();
  const original = placeDuelUnit(board, unit('u-a', 'alice', a));
  const saved = serial(original);
  const restored = restoreDuelBoard(saved);
  assert.deepEqual(restored, original);
  assert.notStrictEqual(restored, saved);
  assert.notStrictEqual(restored.battlefields[0].occupancy, saved.battlefields[0].occupancy);
  restored.battlefields[0].occupancy.push('altered');
  restored.bases[0].occupancy.push('altered');
  restored.units[0].locationId = baseA;
  assert.deepEqual(saved, original);
  assert.deepEqual(board.units, []);
  assert.doesNotThrow(() => assertDuelBoard(saved));
});

test('two bases, two shared fields, unlimited units, occupancy and controller/base ownership', () => {
  const { board, a, b, baseA, baseB } = setup();
  assert.equal(board.bases.length, 2);
  assert.equal(board.battlefields.length, 2);
  let current = board;
  for (let i = 0; i < 8; i++) current = placeDuelUnit(current, unit(`unit-${i}`, 'alice', a));
  assert.equal(field(current, a).occupancy.length, 8); // no foundation 5-unit cap
  assert.equal(field(current, a).contestingPlayerId, 'alice');
  assert.equal(field(current, a).controllerPlayerId, null);
  const before = serial(current);
  for (const bad of [
    unit('unit-0', 'alice', b), unit('new', 'eve', a), unit('new', 'bob', baseA),
    unit('new', 'alice', 'unknown'), unit(board.battlefields[0].instanceId, 'alice', b),
  ]) assert.throws(() => placeDuelUnit(current, bad), TypeError);
  assert.throws(() => relocateDuelUnit(current, 'unit-0', baseB), TypeError);
  assert.throws(() => relocateDuelUnit(current, 'unknown', baseA), TypeError);
  assert.throws(() => relocateDuelUnit(current, 'unit-0', a), TypeError);
  assert.throws(() => removeDuelUnit(current, 'unknown'), TypeError);
  assert.deepEqual(current, before);
  const moved = relocateDuelUnit(current, 'unit-0', b);
  assert.equal(field(moved, a).occupancy.length, 7);
  assert.equal(field(moved, b).occupancy.length, 1);
  const removed = removeDuelUnit(moved, 'unit-0');
  assert.equal(removed.units.length, 7);
  assert.equal(field(removed, b).occupancy.length, 0);
  assert.equal(field(removed, b).contestingPlayerId, 'alice'); // pending cleanup
  assert.deepEqual(current, before);
});

test('enemy entry keeps existing controller, original contender, and does not trigger early control', () => {
  const { board, a } = setup();
  const occupied = applyOpenDuelCleanup(placeDuelUnit(board, unit('a', 'alice', a)));
  const controlled = endDuelNonCombatShowdown(beginDuelShowdown(occupied, a), a);
  assert.equal(field(controlled, a).controllerPlayerId, 'alice');
  assert.equal(field(controlled, a).contested, false);
  const challenged = placeDuelUnit(controlled, unit('b', 'bob', a));
  assert.equal(field(challenged, a).controllerPlayerId, 'alice');
  assert.equal(field(challenged, a).contestingPlayerId, 'bob');
  const withMore = placeDuelUnit(challenged, unit('a2', 'alice', a));
  assert.equal(field(withMore, a).contestingPlayerId, 'bob');
  assert.equal(field(withMore, a).controllerPlayerId, 'alice');
  assert.equal(field(applyOpenDuelCleanup(withMore), a).combat, 'staged');
  const newlyOpened = beginDuelCombat(applyOpenDuelCleanup(withMore), a);
  const defendingOnly = removeDuelUnit(newlyOpened, 'b');
  const noTransfer = endDuelCombat(defendingOnly, a, { recalledAttackersDuringCleanup: false });
  assert.equal(field(noTransfer.board, a).controllerPlayerId, 'alice');
  assert.equal(field(noTransfer.board, a).contested, false); // 466.5 clears contest unconditionally
  // Combat Showdown retains the controller if the contender leaves in caller's cleanup.
  const active = beginDuelCombat(applyOpenDuelCleanup(withMore), a);
  const noChallenger = removeDuelUnit(active, 'b');
  assert.equal(field(noChallenger, a).contestingPlayerId, 'bob');
  const retained = endDuelCombat(noChallenger, a, { recalledAttackersDuringCleanup: false });
  assert.equal(field(retained.board, a).controllerPlayerId, 'alice');
  assert.equal(field(retained.board, a).contested, false);
});

test('Open cleanup clears departed contender and abandoned controller, but not while engagement ongoing', () => {
  const { board, a } = setup();
  const initial = endDuelNonCombatShowdown(beginDuelShowdown(
    applyOpenDuelCleanup(placeDuelUnit(board, unit('a', 'alice', a))), a), a);
  const stale = removeDuelUnit(placeDuelUnit(initial, unit('b', 'bob', a)), 'b');
  assert.equal(field(stale, a).contested, true);
  assert.equal(field(applyOpenDuelCleanup(stale), a).contested, false);
  const empty = removeDuelUnit(initial, 'a');
  assert.equal(field(empty, a).controllerPlayerId, 'alice');
  assert.equal(field(applyOpenDuelCleanup(empty), a).controllerPlayerId, null);
  const ongoing = beginDuelCombat(applyOpenDuelCleanup(
    placeDuelUnit(initial, unit('b', 'bob', a))), a);
  const deserted = removeDuelUnit(removeDuelUnit(ongoing, 'a'), 'b');
  assert.equal(field(applyOpenDuelCleanup(deserted), a).controllerPlayerId, 'alice');
  assert.equal(field(applyOpenDuelCleanup(deserted), a).contestingPlayerId, 'bob');
  assert.equal(field(applyOpenDuelCleanup(deserted), a).showdown, 'active');
});

test('non-combat showdown transfers control only on close, not if no one remains', () => {
  const { board, a } = setup();
  const staged = applyOpenDuelCleanup(placeDuelUnit(board, unit('b', 'bob', a)));
  const ongoing = beginDuelShowdown(staged, a);
  assert.equal(field(ongoing, a).controllerPlayerId, null);
  const cleared = endDuelNonCombatShowdown(ongoing, a);
  assert.equal(field(cleared, a).controllerPlayerId, 'bob');
  assert.equal(field(cleared, a).contested, false);
  assert.throws(() => endDuelNonCombatShowdown(ongoing, 'unknown'), TypeError);
  const empty = endDuelNonCombatShowdown(removeDuelUnit(ongoing, 'b'), a);
  assert.equal(field(empty, a).controllerPlayerId, null);
  assert.equal(field(empty, a).contested, true); // clear only at following Open cleanup
  assert.equal(field(applyOpenDuelCleanup(empty), a).contested, false);
});

function activeDuel() {
  const { board, a } = setup();
  const two = placeDuelUnit(placeDuelUnit(board, unit('a', 'alice', a)), unit('b', 'bob', a));
  const staged = applyOpenDuelCleanup(two);
  assert.equal(field(staged, a).combat, 'staged');
  return { a, staged, ongoing: beginDuelCombat(staged, a) };
}

test('active non-combat Showdown stages Combat if opponent arrives mid-Showdown', () => {
  const { board, a } = setup();
  const staged = applyOpenDuelCleanup(placeDuelUnit(board, unit('a', 'alice', a)));
  const active = beginDuelShowdown(staged, a);
  const arriving = placeDuelUnit(active, unit('b', 'bob', a));
  assert.equal(field(arriving, a).combat, 'none');
  const open = applyOpenDuelCleanup(arriving);
  assert.equal(field(open, a).combat, 'staged');
  assert.equal(field(open, a).showdown, 'active');
  assert.equal(field(open, a).contestingPlayerId, 'alice');
  assert.throws(() => endDuelNonCombatShowdown(open, a), TypeError);
  assert.equal(field(beginDuelCombat(open, a), a).combat, 'active');
});

test('reject simultaneous active engagements; do not open another field mid-Showdown', () => {
  const { board, a, b } = setup();
  const populated = applyOpenDuelCleanup(placeDuelUnit(
    placeDuelUnit(board, unit('ua', 'alice', a)), unit('ub', 'bob', b)));
  const active = beginDuelShowdown(populated, a);
  assert.throws(() => beginDuelShowdown(active, b), TypeError);
  const bothActive = serial(active);
  bothActive.battlefields[1].showdown = 'active';
  assert.throws(() => restoreDuelBoard(bothActive), TypeError);
});

test('active combat retains controller and contested status through Open cleanup', () => {
  const { ongoing, a } = activeDuel();
  assert.throws(() => endDuelNonCombatShowdown(ongoing, a), TypeError);
  assert.throws(() => beginDuelCombat(ongoing, a), TypeError);
  const after = removeDuelUnit(removeDuelUnit(ongoing, 'a'), 'b');
  const open = applyOpenDuelCleanup(after);
  assert.equal(field(open, a).contested, true);
  assert.equal(field(open, a).showdown, 'active');
  assert.equal(field(open, a).combat, 'active');
});

test('both remaining => No Result, explicit restage, no early control (466.3.d.1/466.5)', () => {
  const { staged, ongoing, a } = activeDuel();
  assert.equal(field(ongoing, a).contestingPlayerId, 'alice');
  assert.deepEqual(endDuelCombat(ongoing, a, { recalledAttackersDuringCleanup: false }).result, 'no-result');
  const resolved = endDuelCombat(ongoing, a, { recalledAttackersDuringCleanup: false });
  assert.equal(resolved.restaged, true);
  assert.equal(field(resolved.board, a).showdown, 'staged');
  assert.equal(field(resolved.board, a).combat, 'staged');
  assert.equal(field(resolved.board, a).controllerPlayerId, null);
  assert.equal(field(resolved.board, a).contestingPlayerId, 'alice');
  assert.deepEqual(staged.units.length, 2);
  assert.equal(beginDuelCombat(resolved.board, a).battlefields[0].combat, 'active');
  const restored = restoreDuelBoard(serial(resolved.board));
  assert.equal(field(restored, a).combat, 'staged');
  assert.equal(endDuelCombat(ongoing, a, { recalledAttackersDuringCleanup: true }).restaged, true);
});

test('single survivor establishes control; no units clear control; recall => No Result with survivor', () => {
  const { ongoing, a } = activeDuel();
  const single = removeDuelUnit(ongoing, 'a');
  assert.equal(field(single, a).contestingPlayerId, 'alice'); // no early clearance
  const { board: won, result, restaged } = endDuelCombat(single, a, { recalledAttackersDuringCleanup: false });
  assert.deepEqual(result, { winnerPlayerId: 'bob' });
  assert.equal(restaged, false);
  assert.equal(field(won, a).controllerPlayerId, 'bob');
  assert.equal(field(won, a).contested, false);
  const recalled = endDuelCombat(single, a, { recalledAttackersDuringCleanup: true });
  assert.equal(recalled.result, 'no-result');
  assert.equal(field(recalled.board, a).controllerPlayerId, 'bob');
  const none = endDuelCombat(removeDuelUnit(single, 'b'), a, { recalledAttackersDuringCleanup: false });
  assert.equal(none.result, 'no-result');
  assert.equal(field(none.board, a).controllerPlayerId, null);
  assert.equal(field(none.board, a).contested, false);
  assert.throws(() => endDuelCombat(ongoing, a, {}), TypeError);
  assert.throws(() => endDuelCombat(ongoing, a, { recalledAttackersDuringCleanup: 0 }), TypeError);
});

test('public projection only whitelists state, deep-clones and never leaks hidden cards', () => {
  const { board, a, selection } = setup();
  const original = placeDuelUnit(board, unit('u', 'alice', a));
  const withPrivate = { ...original, selected: selection.selected, removedByPlayer: selection.removedByPlayer,
    deck: ['private deck'], hand: ['private hand'] };
  assert.throws(() => restoreDuelBoard(withPrivate), TypeError);
  assert.throws(() => projectPublicDuelBoard(withPrivate), TypeError);
  const projected = projectPublicDuelBoard(original);
  assert.deepEqual(Object.keys(projected), ['bases', 'battlefields', 'units']);
  const publicText = JSON.stringify(projected);
  for (const secret of ['a-2', 'a-3', 'b-2', 'b-3', 'private deck', 'private hand']) assert.ok(!publicText.includes(secret));
  assert.notStrictEqual(projected.battlefields[0], original.battlefields[0]);
  projected.battlefields[0].occupancy.push('fake');
  assert.deepEqual(field(original, a).occupancy, ['u']);
});

test('malicious snapshots fail strictly without partially changing provided input', () => {
  const { board, a, b } = setup();
  const snapshot = placeDuelUnit(board, unit('u', 'alice', a));
  const corruptions = [
    v => { v.playerIds.push('eve'); },
    v => { v.playerIds[1] = 'alice'; },
    v => { v.bases[1].ownerPlayerId = 'alice'; },
    v => { v.bases[0].locationId = 'unknown'; },
    v => { v.battlefields[0].instanceId = v.battlefields[1].instanceId; },
    v => { v.battlefields[0].locationId = b; },
    v => { v.battlefields[0].ownerPlayerId = 'eve'; },
    v => { v.battlefields[0].contested = false; },
    v => { v.battlefields[0].contestingPlayerId = 'eve'; },
    v => { v.battlefields[0].controllerPlayerId = 'alice'; },
    v => { v.battlefields[0].showdown = 'broken'; },
    v => { v.battlefields[0].combat = 'active'; },
    v => { v.battlefields[0].privateRemoved = 'secret'; },
    v => { v.battlefields[1].occupancy.push('u'); },
    v => { v.battlefields[0].occupancy.push('ghost'); },
    v => { v.battlefields[0].occupancy.pop(); },
    v => { v.units[0].locationId = b; },
    v => { v.units[0].controllerPlayerId = 'bob'; v.units[0].locationId = v.bases[0].locationId;
      v.battlefields[0].occupancy.pop(); v.bases[0].occupancy.push('u'); },
    v => { v.units.push({ ...v.units[0] }); },
    v => { v.units[0].objectId = v.battlefields[0].instanceId; v.battlefields[0].occupancy[0] = v.units[0].objectId; },
  ];
  for (const breakIt of corruptions) {
    const bad = serial(snapshot); breakIt(bad);
    const unmodified = serial(bad);
    assert.throws(() => restoreDuelBoard(bad), TypeError);
    assert.deepEqual(bad, unmodified);
  }
  const legitimatePending = removeDuelUnit(snapshot, 'u');
  assert.doesNotThrow(() => restoreDuelBoard(serial(legitimatePending)));
  const getter = serial(snapshot);
  Object.defineProperty(getter.units[0], 'objectId', { enumerable: true, get: () => 'u' });
  assert.throws(() => assertDuelBoard(getter), TypeError);
  const arrayGetter = serial(snapshot);
  Object.defineProperty(arrayGetter.units, 0, { enumerable: true, get: () => snapshot.units[0] });
  assert.throws(() => restoreDuelBoard(arrayGetter), TypeError);
  const locationEqualsPrinting = serial(snapshot);
  locationEqualsPrinting.battlefields[1].cardId = locationEqualsPrinting.battlefields[0].locationId;
  assert.throws(() => restoreDuelBoard(locationEqualsPrinting), TypeError);
});

// CR 190.3.a (review P2): a unit that becomes present where it does not already control
// immediately applies contested. So an uncontested battlefield may only hold its controller's
// units; an uncontrolled uncontested battlefield must be empty. The repair must reject the two
// impossible snapshots below without over-constraining the legal pending-cleanup states.
test('uncontested battlefield only holds its controller’s units and never invents stronger rules', () => {
  const { board, a } = setup();
  // Alice enters an empty uncontrolled field: contested applies immediately, controller stays null.
  const placed = placeDuelUnit(board, unit('alice-u', 'alice', a));
  assert.equal(field(placed, a).contested, true);
  assert.equal(field(placed, a).contestingPlayerId, 'alice');
  assert.equal(field(placed, a).controllerPlayerId, null);

  // Corrupt both contest fields at once: uncontrolled field still holds a unit.
  const corrupt = serial(placed);
  corrupt.battlefields[0].contested = false;
  corrupt.battlefields[0].contestingPlayerId = null;
  const rejectBefore = serial(corrupt);
  assert.throws(() => assertDuelBoard(corrupt), TypeError);
  assert.throws(() => restoreDuelBoard(corrupt), TypeError);
  assert.throws(() => projectPublicDuelBoard(corrupt), TypeError);
  assert.deepEqual(corrupt, rejectBefore); // rejected input is never partially rewritten

  // Legal: Alice controls the field and only Alice's units are present, so no contest is needed.
  const controlled = endDuelNonCombatShowdown(beginDuelShowdown(
    applyOpenDuelCleanup(placeDuelUnit(board, unit('owner', 'alice', a))), a), a);
  assert.equal(field(controlled, a).controllerPlayerId, 'alice');
  assert.equal(field(controlled, a).contested, false);
  const withOwnUnit = placeDuelUnit(controlled, unit('owner-2', 'alice', a));
  assert.equal(field(withOwnUnit, a).contested, false);
  assert.equal(field(withOwnUnit, a).occupancy.length, 2);
  assert.doesNotThrow(() => restoreDuelBoard(serial(withOwnUnit)));
  assert.doesNotThrow(() => projectPublicDuelBoard(withOwnUnit));

  // Legal pending cleanup: an empty controlled field is NOT a missing-unit error.
  const emptyControlled = removeDuelUnit(controlled, 'owner');
  assert.equal(field(emptyControlled, a).controllerPlayerId, 'alice');
  assert.equal(field(emptyControlled, a).occupancy.length, 0);
  assert.doesNotThrow(() => restoreDuelBoard(serial(emptyControlled)));

  // Legal pending cleanup: the contender already left, contest clears only at the next Open cleanup.
  const departed = removeDuelUnit(placeDuelUnit(emptyControlled, unit('challenger', 'bob', a)), 'challenger');
  assert.equal(field(departed, a).contested, true);
  assert.equal(field(departed, a).contestingPlayerId, 'bob');
  assert.equal(field(departed, a).controllerPlayerId, 'alice');
  assert.equal(field(departed, a).occupancy.length, 0);
  assert.doesNotThrow(() => restoreDuelBoard(serial(departed)));
});

// 485.4–5 + CR 103.4.c: a single seat may not hold the same printing twice, whether the duplicate
// appears at selection time (rejected before any RNG) or in a serialized selection handed to
// createDuelBoard. The two seats may still share a printing, so identity stays per-seat.
test('rejects duplicate printings within one seat but allows the same printing across seats', () => {
  // same seat, same printing, different instance => rejected before RNG, input untouched
  const duplicateAtSeat = seats();
  duplicateAtSeat[0].battlefields[1].cardId = 'printing-x';
  const inputBefore = serial(duplicateAtSeat);
  let calls = 0;
  assert.throws(() => selectDuelBattlefields(duplicateAtSeat, () => { calls++; return 1; }), TypeError);
  assert.equal(calls, 0);
  assert.deepEqual(duplicateAtSeat, inputBefore);

  // both seats already carry printing-x/y/z: a shared printing across seats is legal
  const selection = selectDuelBattlefields(seats(), () => 0);
  const board = createDuelBoard(selection);
  assert.equal(board.battlefields[0].cardId, board.battlefields[1].cardId);
  assert.notEqual(board.battlefields[0].instanceId, board.battlefields[1].instanceId);

  // serialized selection duplicating a printing inside one seat => createDuelBoard rejects untouched
  const selectedDup = serial(selection);
  selectedDup.removedByPlayer[0].battlefields[0].cardId = selectedDup.selected[0].cardId;
  const selectedDupBefore = serial(selectedDup);
  assert.throws(() => createDuelBoard(selectedDup), TypeError);
  assert.deepEqual(selectedDup, selectedDupBefore);

  const removedDup = serial(selection);
  removedDup.removedByPlayer[1].battlefields[0].cardId = removedDup.removedByPlayer[1].battlefields[1].cardId;
  const removedDupBefore = serial(removedDup);
  assert.throws(() => createDuelBoard(removedDup), TypeError);
  assert.deepEqual(removedDup, removedDupBefore);

  // cross-seat repetition stays valid end to end
  assert.doesNotThrow(() => createDuelBoard(serial(selection)));
});

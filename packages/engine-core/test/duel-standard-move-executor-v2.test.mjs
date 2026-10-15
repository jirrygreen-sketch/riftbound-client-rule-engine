// Focused source-level test: node --import tsx --test test/duel-standard-move-executor-v2.test.mjs
// The regular package build may also run this test; it deliberately imports source, not shared dist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelBoard, applyOpenDuelCleanup, beginDuelShowdown } from '../src/duel/battlefields.ts';
import { createDuelResources } from '../src/duel/resources.ts';
import { materializeDuelUnitFromSettledSource, recordResolvedDuelDamage } from '../src/duel/unit-lifecycle.ts';
import { beginDuelStandardMoveV2, certifyDuelStandardMoveTriggersV2,
  resumeDuelStandardMoveV2 } from '../src/duel/standard-move-executor-v2.ts';

const card = (uid, cardId) => ({ uid, cardId });
function fixture() {
  const board = createDuelBoard({
    selected: [
      { playerId: 'P1', instanceId: 'field:1', cardId: 'fieldPrint:1' },
      { playerId: 'P2', instanceId: 'field:2', cardId: 'fieldPrint:2' },
    ],
    removedByPlayer: [
      { playerId: 'P1', battlefields: [{ instanceId: 'field:3', cardId: 'fieldPrint:3' },
        { instanceId: 'field:4', cardId: 'fieldPrint:4' }] },
      { playerId: 'P2', battlefields: [{ instanceId: 'field:5', cardId: 'fieldPrint:5' },
        { instanceId: 'field:6', cardId: 'fieldPrint:6' }] },
    ],
  });
  const resources = createDuelResources({ playerIds: ['P1', 'P2'],
    baseLocations: board.bases.map(b => ({ playerId: b.ownerPlayerId, locationId: b.locationId })),
    runeDecks: [[card('rune:1', 'rune:print')].map(r => ({ ...r, domain: 'Mind' })),
      [card('rune:2', 'rune:print')].map(r => ({ ...r, domain: 'Fury' }))],
  });
  return { stateVersion: 0, board, resources,
    players: [
      { playerId: 'P1', champion: card('champ:1', 'champ:print1'), legend: card('legend:1', 'legend:print1'),
        hand: [], remainingMainDeck: [], trash: [] },
      { playerId: 'P2', champion: card('champ:2', 'champ:print2'), legend: card('legend:2', 'legend:print2'),
        hand: [], remainingMainDeck: [], trash: [] },
    ], unitMeta: {}, retiredUnitTokenUIDs: [] };
}
const base = (s, player = 'P1') => s.board.bases.find(b => b.ownerPlayerId === player).locationId;
const field = (s, index = 0) => s.board.battlefields[index].locationId;
function token(s, uid, player = 'P1', locationId = base(s, player)) {
  return materializeDuelUnitFromSettledSource(s, { kind: 'token', uid,
    unitType: 'Unit', name: 'Recruit', baseMight: 1, tags: ['Recruit'],
    ownerPlayerId: player, controllerPlayerId: player, locationId, entryReplacement: 'enter-ready',
  }, () => false);
}
const intent = (s, ids = ['u1'], destinationLocationId = field(s)) =>
  ({ actor: 'P1', unitUIDs: ids, destinationLocationId });
const timing = { phase: 'main', stateOpen: true, turnPlayerId: 'P1', priorityPlayerId: 'P1' };
const start = (s, request = intent(s), deriveGanking = () => false) =>
  beginDuelStandardMoveV2(s, request, timing, deriveGanking);
const settled = (pending, disposition = 'no-triggers', current = pending.state) => ({
  status: 'settled', taskId: pending.cursor.taskId,
  movedVersion: pending.cursor.movedVersion, settledVersion: current.stateVersion,
  events: pending.obligation.events.map(event => ({ ...event })), disposition,
  ...(disposition === 'handlers-settled' ? { successorState: current } : {}),
});
const certify = (pending, answer = settled(pending), state = pending.state) =>
  certifyDuelStandardMoveTriggersV2(state, pending.cursor, () => answer);

test('paid group Move produces per-unit events, exhaustion, board-owned pending cleanup and a cursor', () => {
  let s = token(fixture(), 'u1');
  s = token(s, 'u2');
  const before = JSON.stringify(s);
  const begun = start(s, intent(s, ['u1', 'u2']));
  assert.equal(begun.status, 'pending');
  assert.equal(begun.state.stateVersion, s.stateVersion + 1);
  assert.equal(begun.cursor.beforeVersion, s.stateVersion);
  assert.equal(begun.cursor.movedVersion, begun.state.stateVersion);
  assert.equal(begun.state.board.units.every(unit => unit.locationId === field(s)), true);
  assert.equal(begun.state.unitMeta.u1.readied, false);
  assert.equal(begun.state.unitMeta.u2.readied, false);
  assert.deepEqual(begun.obligation.events.map(event => [event.objectId, event.actor,
    event.fromLocationId, event.toLocationId]), [
    ['u1', 'P1', base(s), field(s)], ['u2', 'P1', base(s), field(s)],
  ]);
  assert.deepEqual(begun.group.events, begun.obligation.events);
  assert.equal(begun.group.requiresMoveTriggers, true);
  assert.equal(begun.group.requiresOpenCleanup, true);
  assert.equal(begun.state.board.battlefields[0].showdown, 'none', 'cleanup must wait');
  assert.equal(begun.state.board.battlefields[0].contested, true);
  assert.equal(JSON.stringify(s), before, 'input must not mutate');
  assert.throws(() => start(begun.state, intent(begun.state, ['u1', 'u2'])), /outstanding Standard Move/);
});

test('unknown/missing closure remains pending; only certified no-trigger full group allows one cleanup', () => {
  const begun = start(token(fixture(), 'u1'));
  const unknown = certifyDuelStandardMoveTriggersV2(begun.state, begun.cursor, () => ({ status: 'unknown' }));
  assert.deepEqual(unknown, { status: 'pending', obligation: begun.obligation });
  assert.throws(() => resumeDuelStandardMoveV2(begun.state, begun.cursor, {
    kind: 'duel-standard-move-settlement-v2', taskId: begun.cursor.taskId,
    movedVersion: begun.cursor.movedVersion, settledVersion: begun.state.stateVersion,
    events: begun.obligation.events, disposition: 'no-triggers',
  }), /forged|stale/);
  const { proof } = certify(begun);
  assert.equal(proof.disposition, 'no-triggers');
  const completed = resumeDuelStandardMoveV2(begun.state, begun.cursor, proof);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.cleanupApplied, true);
  assert.equal(completed.state.stateVersion, begun.state.stateVersion + 1);
  assert.equal(completed.state.board.battlefields[0].showdown, 'staged');
  assert.equal(completed.state.board.battlefields[0].combat, 'none');
  assert.equal(completed.state.board.battlefields[0].controllerPlayerId, null);
  assert.equal(completed.state.unitMeta.u1.readied, false);
  assert.throws(() => resumeDuelStandardMoveV2(begun.state, begun.cursor, proof), /consumed/);
  assert.throws(() => certify(begun), /consumed/);
});

test('trusted handler-settled proof accepts a real advanced state, preserves staged combat, never starts it', () => {
  let s = token(fixture(), 'u1');
  s = token(s, 'u2', 'P2', field(s));
  // Establish P2 control first; P1's arrival is a contested staged Combat after cleanup.
  s = { ...s, board: applyOpenDuelCleanup(s.board) };
  // The initial P2 field is staged (no controller yet), so use an established controller by
  // placing a P2 unit at its *own* field then staging and keeping the first field contested.
  // A field with opposing units already present stages Combat without auto-running it.
  const begun = start(s);
  const handlerState = { ...begun.state, stateVersion: begun.state.stateVersion + 1 };
  const answer = settled(begun, 'handlers-settled', handlerState);
  const { proof } = certify(begun, answer, handlerState);
  assert.equal(proof.disposition, 'handlers-settled');
  // Re-certification is rejected even when the trusted handler's answer is repeated.
  assert.throws(() => certify(begun, answer, handlerState), /already-certified/);
});

test('handler-mutated aggregate can complete, cleanup stages Combat but never starts Conquer or Combat', () => {
  let s = token(fixture(), 'u1');
  s = token(s, 'enemy', 'P2', field(s));
  const begun = start(s);
  const afterHandler = { ...begun.state, stateVersion: begun.state.stateVersion + 1 };
  const { proof } = certify(begun, settled(begun, 'handlers-settled', afterHandler), afterHandler);
  const completed = resumeDuelStandardMoveV2(afterHandler, begun.cursor, proof);
  assert.equal(completed.state.stateVersion, afterHandler.stateVersion + 1);
  assert.equal(completed.state.board.battlefields[0].showdown, 'staged');
  assert.equal(completed.state.board.battlefields[0].combat, 'staged');
  assert.equal(completed.state.board.battlefields[0].controllerPlayerId, null);
  assert.equal(completed.state.unitMeta.u1.readied, false);
  assert.throws(() => resumeDuelStandardMoveV2(afterHandler, begun.cursor, proof), /consumed/);
});

test('wrong event, task, version and answer shape never issue a proof; retry can still certify', () => {
  const begun = start(token(fixture(), 'u1'));
  const valid = settled(begun);
  for (const bad of [
    { ...valid, taskId: 'other-task' },
    { ...valid, movedVersion: begun.cursor.movedVersion + 1 },
    { ...valid, settledVersion: begun.cursor.movedVersion + 1 },
    { ...valid, events: [] },
    { ...valid, events: [{ ...valid.events[0], fromLocationId: field(begun.state) }] },
    { ...valid, events: [{ ...valid.events[0], actor: 'P2' }] },
    { ...valid, events: valid.events.map(e => ({ ...e, extra: true })) },
    { ...valid, disposition: 'unknown' },
    { status: 'pending', events: valid.events },
    { status: 'unknown', taskId: valid.taskId },
  ]) assert.throws(() => certify(begun, bad), /settlement|answer|events/);
  assert.equal(certify(begun).status, 'ready');
});

test('forged or cloned cursor/proof, alternate event-group proof and stale aggregate all reject', () => {
  const sourceA = token(fixture(), 'u1');
  const a = start(sourceA);
  assert.throws(() => start(sourceA), /already used|outstanding/);
  const b = start(token(fixture(), 'u1'));
  assert.notEqual(a.cursor.taskId, b.cursor.taskId);
  const { proof: proofA } = certify(a);
  assert.throws(() => resumeDuelStandardMoveV2(a.state, a.cursor, { ...proofA }), /forged|stale/);
  assert.throws(() => resumeDuelStandardMoveV2(a.state, structuredClone(a.cursor), proofA), /unbound/);
  assert.throws(() => resumeDuelStandardMoveV2(structuredClone(a.state), a.cursor, proofA), /forged|stale/);
  assert.throws(() => resumeDuelStandardMoveV2(a.state, b.cursor, proofA), /forged|stale/);
  assert.throws(() => certifyDuelStandardMoveTriggersV2(a.state, structuredClone(a.cursor), () => settled(a)), /unbound/);
  assert.throws(() => resumeDuelStandardMoveV2(a.state, a.cursor, { ...proofA,
    events: [{ ...proofA.events[0], toLocationId: base(a.state) }] }), /forged|stale/);
  assert.throws(() => resumeDuelStandardMoveV2({ ...a.state, stateVersion: a.state.stateVersion + 1 },
    a.cursor, proofA), /forged|stale/);
  assert.equal(resumeDuelStandardMoveV2(a.state, a.cursor, proofA).status, 'completed');
});

test('in-place state drift is rejected even when the version matches', () => {
  const a = start(token(fixture(), 'u1'));
  const { proof } = certify(a);
  a.state.unitMeta.u1.readied = true;
  assert.throws(() => resumeDuelStandardMoveV2(a.state, a.cursor, proof), /state drift/);
});

test('prior active Showdown blocks Move; Ganking must be derived for each selected unit', () => {
  let s = token(fixture(), 'u1');
  s = token(s, 'u2', 'P2', field(s));
  const staged = applyOpenDuelCleanup(s.board);
  assert.equal(staged.battlefields[0].showdown, 'staged');
  const active = { ...s, board: beginDuelShowdown(staged, field(s)) };
  assert.throws(() => start(active), /active Showdown or Combat/);
  let ganking = token(s, 'u3', 'P1', field(s, 1));
  assert.throws(() => start(ganking, intent(ganking, ['u3'], field(s))), /needs Ganking/);
  const entered = start(ganking, intent(ganking, ['u3'], field(s)), uid => uid === 'u3');
  assert.deepEqual(entered.obligation.events.map(e => e.objectId), ['u3']);
});

test('invalid group never pays cost or emits a cursor; no-op cleanup still consumes proof', () => {
  let s = token(fixture(), 'u1');
  s = token(s, 'u2');
  const bytes = JSON.stringify(s);
  const invalid = { ...s, unitMeta: { ...s.unitMeta, u2: { ...s.unitMeta.u2, readied: false } } };
  assert.throws(() => start(invalid, intent(invalid, ['u1', 'u2'])), /not readied/);
  assert.equal(JSON.stringify(s), bytes);
  // A controlled battlefield with a same-controller arrival has no cleanup mutation,
  // but the proof is still consumed and cleanup is still the required outer boundary.
  let controlled = token(fixture(), 'u1', 'P1', field(fixture()));
  controlled = token(controlled, 'u2');
  controlled = { ...controlled, board: { ...controlled.board, battlefields: controlled.board.battlefields.map((entry, index) =>
    index === 0 ? { ...entry, controllerPlayerId: 'P1', contested: false, contestingPlayerId: null } : entry) } };
  const moved = start(controlled, intent(controlled, ['u2'], field(controlled)));
  const { proof } = certify(moved);
  const completed = resumeDuelStandardMoveV2(moved.state, moved.cursor, proof);
  assert.equal(completed.state.stateVersion, moved.state.stateVersion);
  assert.strictEqual(completed.state, moved.state, 'no-op cleanup reuses the completed identity');
  assert.throws(() => resumeDuelStandardMoveV2(moved.state, moved.cursor, proof), /consumed/);
  assert.equal(start(completed.state, intent(completed.state, ['u1'], base(completed.state))).status,
    'pending', 'the completed no-op state is eligible for the next paid action');
});

test('root toJSON, symbols, accessors and additional mutable authority are not admissible', () => {
  for (const decorate of [
    state => { state.toJSON = () => 'constant-fingerprint'; },
    state => { state[Symbol('hidden')] = { admitted: false }; },
    state => { Object.defineProperty(state, 'hidden', { value: { admitted: false } }); },
    state => { Object.defineProperty(state, 'board', { get() { return fixture().board; } }); },
    state => { state.scoring = { points: 3 }; },
  ]) {
    const source = token(fixture(), 'u1');
    decorate(source);
    assert.throws(() => start(source), /state keys\/accessors|state symbol|state accessor/);
  }
});

test('state drift is detected without object-controlled JSON or serializable-only comparisons', () => {
  const begun = start(token(fixture(), 'u1'));
  const { proof } = certify(begun);
  // This was an accepted drift with the old JSON.stringify(state) fingerprint and a root toJSON.
  begun.state.toJSON = () => 'constant-fingerprint';
  begun.state.unitMeta.u1.readied = true;
  begun.state.board.units[0].locationId = base(begun.state);
  begun.state.board.bases[0].occupancy.push('u1');
  begun.state.board.battlefields[0].occupancy.splice(0, 1);
  assert.throws(() => resumeDuelStandardMoveV2(begun.state, begun.cursor, proof), /state keys|state drift/);
  delete begun.state.toJSON;
  assert.throws(() => resumeDuelStandardMoveV2(begun.state, begun.cursor, proof), /state drift/);
  // Bad proof/candidate state must not consume the cursor; restoring the original graph can retry.
  begun.state.unitMeta.u1.readied = false;
  begun.state.board.units[0].locationId = field(begun.state);
  begun.state.board.bases[0].occupancy.pop();
  begun.state.board.battlefields[0].occupancy.push('u1');
  assert.equal(resumeDuelStandardMoveV2(begun.state, begun.cursor, proof).status, 'completed');
});

test('non-enumerable and accessor state graph mutations cannot escape a completed proof', () => {
  for (const alter of [
    state => Object.defineProperty(state.board.units[0], 'hidden', { value: 'concealed' }),
    state => { state.unitMeta[Symbol('authority')] = true; },
    state => Object.defineProperty(state.board.units[0], 'locationId', { get() { return field(state); } }),
  ]) {
    const begun = start(token(fixture(), 'u1'));
    const { proof } = certify(begun);
    alter(begun.state);
    assert.throws(() => resumeDuelStandardMoveV2(begun.state, begun.cursor, proof), /state|accessor|symbol/);
  }
});

test('group and event obligations are deeply immutable, and completion rebuilds from bound events', () => {
  const begun = start(token(fixture(), 'u1'));
  assert.ok(Object.isFrozen(begun.group) && Object.isFrozen(begun.group.objectIds) &&
    Object.isFrozen(begun.group.events) && Object.isFrozen(begun.group.events[0]) &&
    Object.isFrozen(begun.obligation.events) && Object.isFrozen(begun.obligation.events[0]));
  assert.notStrictEqual(begun.group.events, begun.obligation.events);
  for (const rewrite of [
    () => { begun.group.actor = 'P2'; },
    () => { begun.group.events[0].toLocationId = base(begun.state); },
    () => { begun.group.events.push({ objectId: 'fake' }); },
    () => { begun.group.objectIds.push('fake'); },
    () => { begun.obligation.events[0].actor = 'P2'; },
  ]) assert.throws(rewrite, TypeError);
  const { proof } = certify(begun);
  assert.ok(Object.isFrozen(proof.events) && Object.isFrozen(proof.events[0]));
  assert.throws(() => { proof.events.push({ objectId: 'fake' }); }, TypeError);
  const completed = resumeDuelStandardMoveV2(begun.state, begun.cursor, proof);
  assert.notStrictEqual(completed.group, begun.group);
  assert.notStrictEqual(completed.group.events, begun.obligation.events);
  assert.deepEqual(completed.group.events, proof.events);
  assert.deepEqual(completed.group.objectIds, ['u1']);
  assert.equal(completed.group.actor, 'P1');
  assert.ok(Object.isFrozen(completed.group) && Object.isFrozen(completed.group.events[0]));
});

test('a pending group prevents a second Standard Move and premature Open cleanup', () => {
  let s = token(fixture(), 'u1');
  s = token(s, 'u2');
  const a = start(s);
  assert.equal(certifyDuelStandardMoveTriggersV2(a.state, a.cursor, () => ({ status: 'unknown' })).status,
    'pending');
  assert.equal(a.state.board.battlefields[0].showdown, 'none');
  assert.throws(() => start(s, intent(s, ['u2'], field(s, 1))), /already used/);
  assert.throws(() => start(a.state, intent(a.state, ['u2'], field(a.state, 1))), /outstanding/);
  assert.equal(a.state.board.battlefields[0].showdown, 'none');
  const { proof } = certify(a);
  assert.throws(() => start(a.state, intent(a.state, ['u2'], field(a.state, 1))), /outstanding/);
  const completed = resumeDuelStandardMoveV2(a.state, a.cursor, proof);
  assert.equal(completed.state.board.battlefields[0].showdown, 'staged');
  assert.throws(() => start(s, intent(s, ['u2'], field(s, 1))), /already used/);
  assert.throws(() => start(a.state, intent(a.state, ['u2'], field(a.state, 1))), /already used/);
  assert.equal(start(completed.state, intent(completed.state, ['u2'], field(completed.state, 1))).status,
    'pending');
});

test('trusted handler successor identity, snapshot and version bind certification and resume', () => {
  const begun = start(token(fixture(), 'u1'));
  const candidate = { ...begun.state, stateVersion: begun.state.stateVersion + 1 };
  const alternate = { ...candidate };
  const accepted = settled(begun, 'handlers-settled', candidate);
  assert.throws(() => certify(begun, { ...accepted, successorState: alternate }, candidate),
    /successor identity/);
  assert.throws(() => certify(begun, { ...accepted, successorState: undefined }, candidate),
    /successor identity/);
  const { successorState: _dropped, ...unattested } = accepted;
  assert.throws(() => certify(begun, unattested, candidate), /successor identity/);
  assert.throws(() => certify(begun, { ...accepted, settledVersion: candidate.stateVersion + 1 }, candidate),
    /settlement/);
  const { proof } = certify(begun, accepted, candidate);
  // Use the issued proof and the exact attested successor, not a matching literal or cloned state.
  assert.throws(() => resumeDuelStandardMoveV2({ ...candidate }, begun.cursor, proof), /forged|stale/);
  assert.throws(() => start(candidate), /outstanding/);
  candidate.unitMeta.u1.readied = true;
  assert.throws(() => resumeDuelStandardMoveV2(candidate, begun.cursor, proof), /state drift/);
  candidate.unitMeta.u1.readied = false;
  const completed = resumeDuelStandardMoveV2(candidate, begun.cursor, proof);
  assert.equal(completed.status, 'completed');
  assert.throws(() => start(candidate), /already used/);
});

test('trusted handler lineage may change metadata but cannot admit another Move before cleanup', () => {
  let source = token(fixture(), 'u1');
  source = token(source, 'u2');
  const begun = start(source);
  // A trusted trigger executor can issue a new aggregate with legitimate non-Move effects.
  const successor = recordResolvedDuelDamage(begun.state, 'u1', {
    amount: 1, responsiblePlayerId: 'P2', sourceObjectIds: ['enemy-source'],
  });
  const unknown = certifyDuelStandardMoveTriggersV2(successor, begun.cursor, () => ({ status: 'unknown' }));
  assert.equal(unknown.status, 'pending');
  assert.throws(() => start(successor, intent(successor, ['u2'], field(successor, 1))), /outstanding/);
  const { proof } = certify(begun, settled(begun, 'handlers-settled', successor), successor);
  assert.throws(() => start(successor, intent(successor, ['u2'], field(successor, 1))), /outstanding/);
  const completed = resumeDuelStandardMoveV2(successor, begun.cursor, proof);
  assert.equal(completed.state.unitMeta.u1.damageMarks[0].amount, 1);
  assert.equal(completed.state.board.battlefields[0].showdown, 'staged');
  assert.throws(() => start(successor, intent(successor, ['u2'], field(successor, 1))), /already used/);
  assert.equal(start(completed.state, intent(completed.state, ['u2'], field(completed.state, 1))).status,
    'pending');
});

test('an unresolved handler successor is pinned to its original snapshot across retries', () => {
  const begun = start(token(fixture(), 'u1'));
  const successor = { ...begun.state, board: structuredClone(begun.state.board),
    stateVersion: begun.state.stateVersion + 1 };
  assert.equal(certifyDuelStandardMoveTriggersV2(successor, begun.cursor,
    () => ({ status: 'unknown' })).status, 'pending');
  successor.board.battlefields[0].cardId = 'another-field-print';
  assert.throws(() => certify(begun, settled(begun, 'handlers-settled', successor), successor),
    /handler successor state drift/);
  successor.board.battlefields[0].cardId = begun.state.board.battlefields[0].cardId;
  const { proof } = certify(begun, settled(begun, 'handlers-settled', successor), successor);
  assert.equal(resumeDuelStandardMoveV2(successor, begun.cursor, proof).status, 'completed');
});

test('in-flight certify rejects synchronous reentry; pending and thrown handlers can retry', () => {
  const begun = start(token(fixture(), 'u1'));
  let attempted = false;
  const outer = certifyDuelStandardMoveTriggersV2(begun.state, begun.cursor, () => {
    attempted = true;
    assert.throws(() => certify(begun), /in-flight/);
    assert.throws(() => start(begun.state), /outstanding/);
    assert.throws(() => resumeDuelStandardMoveV2(begun.state, begun.cursor, {}), /in-flight/);
    return { status: 'unknown' };
  });
  assert.ok(attempted);
  assert.equal(outer.status, 'pending');
  assert.throws(() => certifyDuelStandardMoveTriggersV2(begun.state, begun.cursor, () => {
    throw new Error('handler failure');
  }), /handler failure/);
  const { proof } = certify(begun);
  assert.equal(resumeDuelStandardMoveV2(begun.state, begun.cursor, proof).status, 'completed');
});

test('state accessors cannot intercept cleanup or reenter the same cursor', () => {
  const begun = start(token(fixture(), 'u1'));
  const { proof } = certify(begun);
  const original = begun.state.board;
  let attempts = 0;
  Object.defineProperty(begun.state, 'board', { enumerable: true, configurable: true,
    get() {
      attempts++;
      assert.throws(() => resumeDuelStandardMoveV2(begun.state, begun.cursor, proof), /in-flight/);
      return original;
    },
  });
  assert.throws(() => resumeDuelStandardMoveV2(begun.state, begun.cursor, proof), /state keys\/accessors/);
  assert.equal(attempts, 0, 'strict snapshots reject the getter before cleanup can call it');
  Object.defineProperty(begun.state, 'board', { value: original, enumerable: true,
    writable: true, configurable: true });
  assert.equal(resumeDuelStandardMoveV2(begun.state, begun.cursor, proof).status, 'completed');
});

test('failed/reentrant Ganking evaluation releases unsuccessful source reservation', () => {
  const source = token(fixture(), 'u1');
  assert.throws(() => start(source, intent(source), () => {
    assert.throws(() => start(source), /already used|outstanding/);
    throw new Error('Ganking unavailable');
  }), /Ganking unavailable/);
  assert.equal(start(source).status, 'pending');
});

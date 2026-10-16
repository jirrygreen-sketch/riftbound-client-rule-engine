import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDuelUnitLifecycleState, materializeDuelUnitFromSettledSource, readyDuelUnits,
  exhaustDuelUnitsAsCost, exhaustDuelUnitsByEffect, recordResolvedDuelDamage,
  healAllDuelUnitDamage, queryLethalDuelUnitCandidates, planDuelUnitKills,
  commitApprovedDuelUnitKills, projectPublicDuelUnitObjects,
  deriveDuelReadinessFromUnitMeta, moveDuelUnitsWithMetadata,
} from '../../dist/zones/unit-lifecycle.js';
import { createDuelBoard, placeDuelUnit } from '../../dist/duel/battlefields.js';
import { createDuelResources } from '../../dist/duel/resources.js';

// Trusted synthetic printing list for these narrow fixture tests only; NOT a real catalog.
const printedUnitCatalog = new Set(['unit:alpha', 'unit:beta']);
const trustedPrintedUnit = id => printedUnitCatalog.has(id);
const C = (uid, cardId = `unit:${uid}`) => ({ uid, cardId });
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
    runeDecks: [[{ uid: 'rune:1', cardId: 'rune:print', domain: 'Mind' }],
      [{ uid: 'rune:2', cardId: 'rune:print', domain: 'Fury' }]],
  });
  return { stateVersion: 0, board, resources,
    players: [
      { playerId: 'P1', champion: C('champ:1', 'champ:print1'), legend: C('legend:1', 'legend:print1'),
        hand: [C('hand:1', 'unit:alpha')], remainingMainDeck: [C('main:1', 'unit:beta')], trash: [] },
      { playerId: 'P2', champion: C('champ:2', 'champ:print2'), legend: C('legend:2', 'legend:print2'),
        hand: [C('hand:2', 'unit:alpha')], remainingMainDeck: [C('main:2', 'unit:beta')], trash: [] },
    ], unitMeta: {}, retiredUnitTokenUIDs: [] };
}
const base = (state, player = 'P1') => state.board.bases.find(b => b.ownerPlayerId === player).locationId;
const field = state => state.board.battlefields[0].locationId;
function cardSource(state, uid = 'alpha', ownerPlayerId = 'P1', controllerPlayerId = ownerPlayerId, locationId = base(state, controllerPlayerId), entryReplacement) {
  return { kind: 'card', uid, cardType: 'Unit', cardId: 'unit:alpha', ownerPlayerId,
    controllerPlayerId, locationId, ...(entryReplacement ? { entryReplacement } : {}) };
}
function tokenSource(state, uid = 'token:1', ownerPlayerId = 'P1', controllerPlayerId = ownerPlayerId, locationId = base(state, controllerPlayerId), entryReplacement) {
  return { kind: 'token', uid, unitType: 'Unit', name: 'Recruit', baseMight: 1, tags: ['Recruit'],
    ownerPlayerId, controllerPlayerId, locationId, ...(entryReplacement ? { entryReplacement } : {}) };
}
const spawnCard = (state, ...args) => materializeDuelUnitFromSettledSource(state, cardSource(state, ...args), trustedPrintedUnit);
const spawnToken = (state, ...args) => materializeDuelUnitFromSettledSource(state, tokenSource(state, ...args), trustedPrintedUnit);
const mark = (amount, responsiblePlayerId = 'P2', sourceObjectIds = ['spell:1']) =>
  ({ amount, responsiblePlayerId, sourceObjectIds });
const frozenJSON = object => JSON.stringify(object);

// Compiled JS executes actual board/resources validators and actual movement, not test doubles.
test('default exhausted; trusted settled replacement ready; card and token characteristics remain distinct', () => {
  const initial = fixture();
  const a = spawnCard(initial);
  assert.equal(a.unitMeta.alpha.readied, false);
  assert.deepEqual(a.unitMeta.alpha.trait, { kind: 'card', cardId: 'unit:alpha' });
  assert.equal(initial.board.units.length, 0);
  const b = spawnToken(a, 'token:1', 'P1', 'P1', base(a), 'enter-ready');
  assert.equal(b.unitMeta['token:1'].readied, true);
  assert.deepEqual(b.unitMeta['token:1'].trait,
    { kind: 'token', name: 'Recruit', baseMight: 1, tags: ['Recruit'] });
  assert.deepEqual(Object.keys(b.unitMeta.alpha), ['ownerPlayerId', 'readied', 'damageMarks', 'trait']);
  assert.equal('controllerPlayerId' in b.unitMeta.alpha, false);
  assert.equal('locationId' in b.unitMeta.alpha, false);
  assert.equal(a.stateVersion, 1);
  assert.equal(b.stateVersion, 2);
  assertDuelUnitLifecycleState(b);
});

test('entry blocks still-zoned UID, retired Gold, non-Unit printing and forged entry-replacement', () => {
  const state = fixture();
  assert.throws(() => spawnCard(state, 'hand:1'), /still in physical zone/);
  assert.throws(() => spawnToken(state, 'rune:1'), /still in physical zone/);
  assert.throws(() => spawnToken(state, 'champ:1'), /still in physical zone/);
  assert.throws(() => materializeDuelUnitFromSettledSource(state,
    { ...cardSource(state), cardId: 'spell:notUnit' }, trustedPrintedUnit), /not a trusted Unit/);
  assert.throws(() => materializeDuelUnitFromSettledSource(state,
    { ...cardSource(state), cardType: 'Spell' }, trustedPrintedUnit), /must be a Unit/);
  assert.throws(() => materializeDuelUnitFromSettledSource(state,
    { ...tokenSource(state), entryReplacement: 'ready' }, trustedPrintedUnit), /entryReplacement/);
  assert.throws(() => spawnToken(state, 'field:1'), /collides/);
  assert.throws(() => spawnCard(state, 'P2'), /collides/);
  const usedGold = { ...state, resources: { ...state.resources, retiredGoldUids: ['retired:gold'] } };
  assert.throws(() => spawnToken(usedGold, 'retired:gold'), /still in physical zone/);
});

test('settled physical card is accepted ONLY after outer has removed it from its zone; Champion can depart', () => {
  const state = fixture();
  const handRemoved = { ...state, players: state.players.map((p, i) =>
    i ? p : { ...p, hand: [] }) };
  const entered = spawnCard(handRemoved, 'hand:1');
  assert.equal(entered.unitMeta['hand:1'].trait.cardId, 'unit:alpha');
  assert.equal(entered.players[0].hand.length, 0);
  assert.equal(state.players[0].hand.length, 1);
  const noChampion = { ...state, players: state.players.map((p, i) => i ? p : { ...p, champion: null }) };
  assertDuelUnitLifecycleState(noChampion);
});

test('validator enforces exact metadata/physical UID seats, resource/board references and disjoint retirements', () => {
  const state = spawnCard(fixture());
  assert.throws(() => assertDuelUnitLifecycleState({ ...state, unitMeta: {} }), /one metadata/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state, unitMeta: { ...state.unitMeta, fake: state.unitMeta.alpha } }), /one metadata/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    players: state.players.map((p, i) => i ? p : { ...p, trash: [C('alpha', 'unit:alpha')] }) }), /duplicate UID/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    players: state.players.map((p, i) => i ? { ...p, playerId: 'P1' } : p) }), /private\/board seats/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    resources: { ...state.resources, retiredGoldUids: ['alpha'] } }), /duplicate UID/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    retiredUnitTokenUIDs: ['alpha'] }), /duplicate UID/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    resources: { ...state.resources, bases: state.resources.bases.map((b, i) =>
      i ? b : { ...b, locationId: 'wrong base' }) } }), /base location differs/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    unitMeta: { alpha: { ...state.unitMeta.alpha, controllerPlayerId: 'P2' } } }), /keys/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    players: state.players.map((p, i) => i ? p : { ...p, hand: [...p.hand, C('rune:1', 'unit:alpha')] }) }), /duplicate UID/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    players: state.players.map((p, i) => i ? p : { ...p, hand: [...p.hand, C('field:1', 'unit:alpha')] }) }), /collides/);
  assert.throws(() => assertDuelUnitLifecycleState({ ...state,
    retiredUnitTokenUIDs: ['token:retired', 'token:retired'] }), /duplicate UID/);
});

test('controller differs from owner: approved Kill targets owner Trash and keeps pre-exit Deathknell snapshot', () => {
  const state = recordResolvedDuelDamage(spawnCard(fixture(), 'alpha', 'P1', 'P2', base(fixture(), 'P2')),
    'alpha', mark(2, 'P2', ['spell:2', 'ability:2']));
  const plan = planDuelUnitKills(state, ['alpha'], 'active');
  const beforeCommit = frozenJSON(state);
  assert.equal(plan.snapshots[0].controllerPlayerId, 'P2');
  assert.equal(plan.snapshots[0].ownerPlayerId, 'P1');
  assert.equal(plan.snapshots[0].locationId, base(state, 'P2'));
  assert.deepEqual(plan.snapshots[0].damageMarks, [mark(2, 'P2', ['spell:2', 'ability:2'])]);
  // Outer may cancel/rewrite an Active Kill replacement; simply DO NOT commit.
  assert.equal(frozenJSON(state), beforeCommit);
  const { state: after, notices } = commitApprovedDuelUnitKills(state,
    { plan, approvedUnitUIDs: ['alpha'] });
  assert.deepEqual(after.players[0].trash, [C('alpha', 'unit:alpha')]);
  assert.deepEqual(after.players[1].trash, []);
  assert.equal(after.board.units.length, 0);
  assert.equal(Object.hasOwn(after.unitMeta, 'alpha'), false);
  assert.deepEqual(notices.map(n => n.kind), ['Killed', 'TrashEntry']);
  assert.deepEqual(notices[0].snapshot, plan.snapshots[0]);
  assert.equal(notices.some(n => n.kind === 'Move'), false);
  assert.equal(frozenJSON(state), beforeCommit);
  assert.throws(() => spawnCard(after, 'alpha'), /still in physical zone/);
});

test('token Kill emits Trash-entry before immediate cease, leaves no token card and permanently retires UID', () => {
  const original = recordResolvedDuelDamage(spawnToken(fixture()), 'token:1', mark(1, 'P2', ['spell:token']));
  const plan = planDuelUnitKills(original, ['token:1'], 'passive');
  assert.deepEqual(plan.snapshots[0].damageMarks, [mark(1, 'P2', ['spell:token'])]);
  const killed = commitApprovedDuelUnitKills(original, { plan, approvedUnitUIDs: ['token:1'] });
  assert.deepEqual(killed.notices.map(n => [n.kind, n.tokenCeasesImmediately]),
    [['Killed', false], ['TrashEntry', true]]);
  assert.equal(killed.notices[1].destinationPlayerId, 'P1');
  assert.equal(killed.state.board.units.length, 0);
  assert.deepEqual(killed.state.players.flatMap(p => p.trash), []);
  assert.deepEqual(killed.state.retiredUnitTokenUIDs, ['token:1']);
  assert.throws(() => spawnToken(killed.state), /still in physical zone/);
  assert.throws(() => spawnCard(killed.state, 'token:1'), /still in physical zone/);
});

test('stale and tampered plan are rejected; replacement canceled subset has no mutations', () => {
  let state = spawnCard(fixture());
  const plan = planDuelUnitKills(state, ['alpha'], 'active');
  const canceled = commitApprovedDuelUnitKills(state, { plan, approvedUnitUIDs: [] });
  assert.equal(canceled.state.stateVersion, state.stateVersion);
  assert.deepEqual(canceled.notices, []);
  assert.deepEqual(canceled.state.board, state.board);
  assert.throws(() => commitApprovedDuelUnitKills(state,
    { plan, approvedUnitUIDs: ['alpha', 'notPlanned'] }), /unplanned UID/);
  const forged = { ...plan, snapshots: [{ ...plan.snapshots[0], readied: true }] };
  assert.throws(() => commitApprovedDuelUnitKills(state, { plan: forged, approvedUnitUIDs: ['alpha'] }), /changed since planning/);
  state = readyDuelUnits(state, ['alpha']).state;
  assert.throws(() => commitApprovedDuelUnitKills(state, { plan, approvedUnitUIDs: ['alpha'] }), /stale Kill plan/);
  assert.equal(state.board.units.length, 1);
});

test('per-unit replacement approval may cancel one Kill while committing another', () => {
  let state = spawnCard(spawnToken(fixture()));
  const plan = planDuelUnitKills(state, ['alpha', 'token:1'], 'active');
  const original = frozenJSON(state);
  const applied = commitApprovedDuelUnitKills(state, { plan, approvedUnitUIDs: ['token:1'] });
  assert.deepEqual(applied.state.board.units.map(unit => unit.objectId), ['alpha']);
  assert.equal(applied.state.players[0].trash.length, 0);
  assert.deepEqual(applied.state.retiredUnitTokenUIDs, ['token:1']);
  assert.equal(applied.notices.length, 2);
  assert.equal(frozenJSON(state), original);
});

test('resolved multi-mark responsibility, nonzero Might 0 lethality, threshold callback and heal-all', () => {
  let state = spawnToken(fixture());
  let evaluationCount = 0;
  const evaluators = { currentMight: unit => { evaluationCount++; return unit.trait.baseMight - 1; },
    lethalDamageThreshold: (_unit, might) => might };
  assert.deepEqual(queryLethalDuelUnitCandidates(state, evaluators), []); // 0 Might, zero damage
  state = recordResolvedDuelDamage(state, 'token:1', mark(1, 'P1', ['unit:damage']));
  assert.deepEqual(queryLethalDuelUnitCandidates(state, evaluators).map(u => u.objectId), ['token:1']);
  state = recordResolvedDuelDamage(state, 'token:1', mark(2, 'P2', ['spell:damage', 'ability:damage']));
  assert.equal(evaluationCount, 2);
  assert.deepEqual(state.unitMeta['token:1'].damageMarks,
    [mark(1, 'P1', ['unit:damage']), mark(2, 'P2', ['spell:damage', 'ability:damage'])]);
  assert.deepEqual(queryLethalDuelUnitCandidates(state, {
    currentMight: () => 1, lethalDamageThreshold: () => 4 }), []);
  assert.throws(() => queryLethalDuelUnitCandidates(state, { currentMight: () => 1 }), /evaluators keys/);
  const healed = healAllDuelUnitDamage(state, ['token:1']);
  assert.deepEqual(healed.healedUnitUIDs, ['token:1']);
  assert.deepEqual(healed.state.unitMeta['token:1'].damageMarks, []);
  assert.equal(state.unitMeta['token:1'].damageMarks.length, 2);
  assert.throws(() => recordResolvedDuelDamage(state, 'token:1', mark(0)), /positive/);
  assert.throws(() => recordResolvedDuelDamage(state, 'token:1', mark(-1)), /amount/);
  assert.throws(() => recordResolvedDuelDamage(state, 'token:1', mark(1, 'unknown')), /unknown player/);
});

test('Ready no-op does not signal transition; exhaustion cost prechecks whole group; effect exhaustion is idempotent', () => {
  const initial = spawnCard(spawnToken(fixture()));
  const onlyOneReady = readyDuelUnits(initial, ['token:1']);
  assert.deepEqual(onlyOneReady.changedUnitUIDs, ['token:1']);
  const noChange = readyDuelUnits(onlyOneReady.state, ['token:1']);
  assert.deepEqual(noChange.changedUnitUIDs, []);
  assert.equal(noChange.state.stateVersion, onlyOneReady.state.stateVersion);
  assert.throws(() => exhaustDuelUnitsAsCost(noChange.state, ['token:1', 'alpha']), /exhausted unit/);
  assert.equal(noChange.state.unitMeta['token:1'].readied, true);
  const bothReady = readyDuelUnits(noChange.state, ['alpha']).state;
  const afterCost = exhaustDuelUnitsAsCost(bothReady, ['token:1', 'alpha']);
  assert.equal(afterCost.unitMeta.alpha.readied, false);
  assert.equal(afterCost.unitMeta['token:1'].readied, false);
  assert.equal(bothReady.unitMeta.alpha.readied, true);
  assert.deepEqual(exhaustDuelUnitsByEffect(afterCost, ['alpha']).changedUnitUIDs, []);
  assert.throws(() => readyDuelUnits(afterCost, ['missing']), /unknown board unit/);
});

test('public allowlist excludes zones and tombstones; tokens and cards can exceed five units', () => {
  let state = fixture();
  for (let n = 0; n < 7; n++) state = spawnToken(state, `token:${n}`);
  assert.equal(state.board.bases[0].occupancy.length, 7);
  state = recordResolvedDuelDamage(state, 'token:0', mark(1, 'P2', ['hidden:chain-card']));
  const publicUnits = projectPublicDuelUnitObjects(state);
  assert.equal(publicUnits.length, 7);
  assert.deepEqual(publicUnits[0].damageMarks, [{ amount: 1, responsiblePlayerId: 'P2' }]);
  const serialized = frozenJSON(publicUnits);
  for (const forbidden of ['hand:1', 'main:1', 'rune:1', 'champ:1', 'legend:1', 'hidden:chain-card',
    'sourceObjectIds', 'retiredUnitTokenUIDs', 'retiredGoldUids'])
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  assert.deepEqual(new Set(Object.keys(publicUnits[0])), new Set(['objectId', 'controllerPlayerId', 'locationId',
    'ownerPlayerId', 'readied', 'trait', 'damageMarks', 'totalDamage']));
});

test('real Standard Move uses metadata readiness, retains owner/damage, exhausts and relocates exactly once', () => {
  let state = spawnCard(fixture(), 'alpha', 'P1', 'P2', base(fixture(), 'P2'), 'enter-ready');
  state = recordResolvedDuelDamage(state, 'alpha', mark(1, 'P1', ['spell:1']));
  const metadataBefore = frozenJSON(state.unitMeta.alpha);
  let gankingCalls = 0;
  assert.deepEqual(deriveDuelReadinessFromUnitMeta(state, uid => {
    gankingCalls++;
    assert.equal(uid, 'alpha');
    return false;
  }), [{ objectId: 'alpha', readied: true, hasGanking: false }]);
  assert.equal(gankingCalls, 1);
  const request = { actor: 'P2', unitUIDs: ['alpha'], destinationLocationId: field(state),
    timing: { phase: 'main', stateOpen: true, turnPlayerId: 'P2', priorityPlayerId: 'P2' } };
  const moved = moveDuelUnitsWithMetadata(state, request, () => false);
  assert.equal(moved.state.stateVersion, state.stateVersion + 1);
  assert.equal(moved.state.board.units[0].locationId, field(state));
  assert.equal(moved.state.board.units[0].controllerPlayerId, 'P2');
  assert.equal(moved.state.unitMeta.alpha.ownerPlayerId, 'P1');
  assert.deepEqual(moved.state.unitMeta.alpha.damageMarks, state.unitMeta.alpha.damageMarks);
  assert.equal(moved.state.unitMeta.alpha.readied, false);
  assert.equal(moved.group.events.length, 1);
  assert.equal(moved.group.requiresOpenCleanup, true);
  assert.equal(moved.group.requiresMoveTriggers, true);
  assert.equal(frozenJSON(state.unitMeta.alpha), metadataBefore);
  assert.throws(() => moveDuelUnitsWithMetadata(moved.state, request, () => false), /not readied/);
  assert.throws(() => deriveDuelReadinessFromUnitMeta(state, () => 'true'), /Boolean/);
});

test('foreign base and pending contested cleanup remain board-owned and unaltered by token kill', () => {
  let state = spawnToken(fixture(), 'token:contest', 'P1', 'P1', field(fixture()));
  const before = state.board.battlefields[0];
  assert.equal(before.contested, true);
  const plan = planDuelUnitKills(state, ['token:contest'], 'active');
  const result = commitApprovedDuelUnitKills(state, { plan, approvedUnitUIDs: ['token:contest'] });
  assert.equal(result.state.board.battlefields[0].contested, true);
  assert.equal(result.state.board.battlefields[0].contestingPlayerId, 'P1');
  assert.deepEqual(result.state.board.battlefields[0].occupancy, []);
  assert.throws(() => spawnToken(state, 'token:foreign', 'P1', 'P1', base(state, 'P2')), /another player/);
});

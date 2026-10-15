// Formal protocol contract tests for riftbound-duel-v1.
//
// These tests are PURE DTO tests: they exercise the real protocol parser functions in
// ../dist/duel-contract.ts (+ ../dist/index.ts) against a frozen snapshot of wire DTOs.
// The snapshot (./fixtures/duel-projections.json) was generated once by the real
// engine-core duel projector/constructors (createDuelMatch -> resolveDuelMulligan ->
// projectCanonicalDuelMatch etc.) with synthetic actors and no session token. Importing
// engine-core here would create a protocol->engine->protocol build-order cycle in a fresh
// checkout, so this file must never import @riftbound/engine-core. The engine-driven
// conformance run (proving the real projector still matches these shapes) is kept as a
// separate opt-in artifact, not as this formal suite.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DUEL_PROJECTION_SCHEMA, DUEL_RULESET_ID, isDuelProjection, isDuelRuneCost,
  isDuelCommandMessage, isDuelProjectionMessage,
} from '../dist/duel-contract.js';
import { isClientMessage, isServerMessage } from '../dist/index.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/duel-projections.json', import.meta.url), 'utf8'));
const cost = fixture.cost;
const clone = value => structuredClone(value);
// Local DTO projection builder: matches the wire wrapper shape without touching the engine.
const wrap = (scenario, viewer = 'p1', actions = []) => ({
  projectionSchema: DUEL_PROJECTION_SCHEMA, viewerPlayerId: viewer,
  match: clone(fixture[scenario][viewer === null ? 'null' : viewer].match), actions,
});
function assertRejected(base, edit) {
  const candidate = clone(base);
  edit(candidate);
  assert.equal(isDuelProjection(candidate), false);
  assert.equal(isServerMessage({ type: 'duel-projection', roomId: 'room-1', projection: candidate }), false);
}

test('dedicated ID and schema are not Foundation aliases', () => {
  assert.equal(DUEL_RULESET_ID, 'riftbound-duel');
  assert.equal(DUEL_PROJECTION_SCHEMA, 'riftbound-duel-v1');
  assert.notEqual(DUEL_RULESET_ID, 'riftbound-foundation');
});
test('canonical setup projects to each seat and spectator with private hands only for owner', () => {
  for (const viewer of ['p1', 'p2', null]) {
    const projection = wrap('setup', viewer);
    assert.equal(isDuelProjection(projection), true);
    assert.equal(projection.match.setup.players.filter(p => Object.hasOwn(p, 'hand')).length, Number(viewer !== null));
    assert.equal(isServerMessage({ type: 'duel-projection', roomId: 'room-1', projection }), true);
  }
});
test('canonical playing has frame turn 1 and scoring turn 0; empty actions do not imply Main', () => {
  for (const viewer of ['p1', 'p2', null]) {
    const projection = wrap('playing', viewer);
    assert.equal(isDuelProjection(projection), true);
    assert.equal(projection.match.frame.phase, 'awaiting-turn-start');
    assert.equal(projection.match.scoring.turnNumber, 0);
    assert.equal(projection.actions.length, 0);
  }
});
test('setup mulligan options bind selection to the viewer own hand and current owner', () => {
  const uid = wrap('setup').match.setup.players[0].hand[0].uid;
  const action = { id: 'mulligan-1', kind: 'mulligan', label: 'Choose cards',
    enabled: true, maxSelections: 2, selectableUIDs: [uid] };
  assert.equal(isDuelProjection(wrap('setup', 'p1', [action])), true);
  assert.equal(isDuelProjection(wrap('setup', 'p2', [action])), false);
  assertRejected(wrap('setup', 'p1', [action]), p => { p.actions[0].selectableUIDs = ['p2-main-1']; });
  assertRejected(wrap('setup', 'p1', [action]), p => { p.actions[0].maxSelections = 3; });
});
test('private setup zone and removed battlefield selection cannot enter wire', () => {
  const original = wrap('setup', null);
  assertRejected(original, p => { p.match.setup.players[0].hand = []; });
  assertRejected(original, p => { p.match.setup.players[0].remainingMainDeck = []; });
  assertRejected(original, p => { p.match.setup.players[0].shuffledRuneDeck = []; });
  assertRejected(original, p => { p.match.setup.selection = { removedByPlayer: [] }; });
  assertRejected(original, p => { p.match.setup.selectedBattlefields[0].removedByPlayer = []; });
});
test('setup and common fields strictly match roster, turn order and selected field seat order', () => {
  const original = wrap('setup');
  assertRejected(original, p => { p.match.turnOrder = ['p1', 'p1']; });
  assertRejected(original, p => { p.match.setup.turnOrder = ['p2', 'p1']; });
  assertRejected(original, p => { p.match.setup.currentMulliganOwner = 'p2'; });
  assertRejected(original, p => { p.match.setup.selectedBattlefields[1].playerId = 'p1'; });
  assertRejected(original, p => { p.match.roster[1].playerId = 'p1'; });
  assertRejected(original, p => { p.viewerPlayerId = 'intruder'; });
});
test('setup second mulligan turn and complete projection remain valid after resolved snapshot', () => {
  assert.equal(isDuelProjection(wrap('afterFirst', 'p2', [{ id: 'm2', kind: 'mulligan', label: 'Keep',
    enabled: true, selectableUIDs: [], maxSelections: 2 }])), true);
  assert.equal(wrap('afterFirst', null).match.setup.currentMulliganOwner, 'p2');
});
test('playing owner hand is required; opponent and spectators cannot receive it', () => {
  assertRejected(wrap('playing', 'p1'), p => { delete p.match.players[0].hand; });
  assertRejected(wrap('playing', null), p => { p.match.players[1].hand = []; });
  assertRejected(wrap('playing', 'p1'), p => { p.match.players[1].hand = []; });
  assertRejected(wrap('playing', 'p1'), p => { p.match.players[0].hand[0].sourceUID = 'private'; });
  assertRejected(wrap('playing', null), p => { p.match.players[0].mainDeck = []; });
});
test('nullable champion follows validated canonical playing state', () => {
  assert.equal(isDuelProjection(wrap('nullableChampion', 'p1')), true);
});
test('rune and Gold source projections preserve public identities and reject private runeDeck', () => {
  const projection = wrap('changed');
  assert.equal(isDuelProjection(projection), true);
  assert.equal(projection.match.resources.players[0].runeDeckCount, 0);
  assert.equal(projection.match.resources.bases[0].baseRunes[0].ownerPlayerId, 'p1');
  assert.equal(projection.match.resources.bases[0].goldTokens[0].readied, true);
  const action = (kind, uid) => ({ id: `${kind}:${uid}`, kind, label: kind, enabled: true, uid });
  assert.equal(isDuelProjection(wrap('changed', 'p1', [action('rune-energy', 'p1-rune'),
    action('rune-power', 'p1-rune'), action('gold-power', 'gold-1')])), true);
  assertRejected(projection, p => { p.match.resources.players[0].runeDeck = []; });
  assertRejected(projection, p => { p.match.resources.retiredGoldUids = ['private']; });
  assertRejected(projection, p => { p.match.resources.bases[0].baseRunes[0].locationId = 'elsewhere'; });
  assertRejected(projection, p => { p.match.resources.bases[0].goldTokens[0].controllerPlayerId = 'p2'; });
  assertRejected(wrap('changed', 'p2'), p => { p.actions.push(action('gold-power', 'gold-1')); });
  assertRejected(projection, p => { p.actions.push(action('rune-energy', 'p2-rune')); });
});
test('token Unit and damage projection includes allowlisted metadata, not damage source IDs', () => {
  const projection = wrap('tokenDamage', null);
  assert.equal(isDuelProjection(projection), true);
  assert.deepEqual(projection.match.board.units[0].trait, { kind: 'token', name: 'Guard', baseMight: 2, tags: ['Guard'] });
  assert.deepEqual(projection.match.board.units[0].damageMarks, [{ amount: 2, responsiblePlayerId: 'p2' }]);
  assertRejected(projection, p => { p.match.board.units[0].damageMarks[0].sourceObjectIds = ['hidden-source-uid']; });
  assertRejected(projection, p => { p.match.board.units[0].sourceUID = 'hidden-source-uid'; });
  assertRejected(projection, p => { p.match.board.units[0].totalDamage = 1; });
  assertRejected(projection, p => { p.match.board.bases[0].occupancy = []; });
  assertRejected(projection, p => { p.match.board.units[0].controllerPlayerId = 'p2'; });
});
test('battlefield contest stays public while inconsistent occupancy or control is rejected', () => {
  const projection = wrap('challenger', null);
  assert.equal(projection.match.board.battlefields[0].contested, true);
  assert.equal(isDuelProjection(projection), true);
  assertRejected(projection, p => { p.match.board.battlefields[0].contested = false;
    p.match.board.battlefields[0].contestingPlayerId = null; });
  assertRejected(projection, p => { p.match.board.units[0].locationId = p.match.board.bases[0].locationId; });
  assertRejected(projection, p => { p.match.board.battlefields[0].occupancy.push('ghost-unit'); });
});
test('card Unit trait uses printing allowlist, without raw source UID', () => {
  const source = fixture.playing.p1.match.players[0].hand[0];
  const projection = wrap('cardUnit', 'p1');
  assert.equal(isDuelProjection(projection), true);
  assert.deepEqual(projection.match.board.units[0].trait, { kind: 'card', cardId: source.cardId });
  assertRejected(projection, p => { p.match.board.units[0].trait.sourceUID = source.uid; });
});
test('board validates two bases, battlefield ownership, occupancy and controller/location relations', () => {
  const original = wrap('playing');
  assertRejected(original, p => { p.match.board.bases.pop(); });
  assertRejected(original, p => { p.match.board.bases[0].ownerPlayerId = 'p2'; });
  assertRejected(original, p => { p.match.board.battlefields[0].locationId = 'invented'; });
  assertRejected(original, p => { p.match.board.battlefields[1].ownerPlayerId = 'p1'; });
  assertRejected(original, p => { p.match.board.bases[0].occupancy = ['ghost']; });
  assertRejected(original, p => { p.match.board.battlefields[0].contested = true; });
});
test('scoring preserves legitimate frame/scoring offset but rejects inconsistent field references', () => {
  const original = wrap('playing');
  assertRejected(original, p => { p.match.scoring.turnNumber = 2; });
  assertRejected(original, p => { p.match.scoring.battlefieldLocationIds.reverse(); });
  assertRejected(original, p => { p.match.scoring.players[0].playerId = 'p2'; });
  assertRejected(original, p => { p.match.scoring.players[0].scoredBattlefieldLocationIds = ['ghost']; });
  assertRejected(original, p => { p.match.scoring.victoryScore = 0; });
});
test('pending cost ID and resolved cost are owner-only; nonowners see active:true', () => {
  for (const viewer of ['p1', 'p2', null]) {
    const projection = wrap('pending', viewer);
    assert.equal(isDuelProjection(projection), true);
    assert.deepEqual(projection.match.frame.pendingPayment, viewer === 'p1'
      ? { active: true, paymentId: 'payment-1', resolvedCost: cost } : { active: true });
    assert.equal(JSON.stringify(projection).includes('secret-reference'), false);
    assert.equal(JSON.stringify(projection).includes('secret-source'), false);
  }
  const owner = wrap('pending', 'p1', [{ id: 'pay', kind: 'pay-pending', label: 'Pay',
    enabled: true, paymentId: 'payment-1', resolvedCost: cost }]);
  assert.equal(isDuelProjection(owner), true);
  assertRejected(owner, p => { p.match.frame.pendingPayment.sourceReference = { sourceUID: 'secret-source' }; });
  assertRejected(owner, p => { p.match.frame.pendingPayment.actor = 'p1'; });
  assertRejected(owner, p => { delete p.match.frame.pendingPayment.resolvedCost; });
  assertRejected(wrap('pending', 'p2'), p => { p.actions.push(owner.actions[0]); });
});
test('cost parser checks domains, amounts and numeric overflow', () => {
  assert.equal(isDuelRuneCost({ energy: 0, power: [] }), true);
  assert.equal(isDuelRuneCost({ energy: 0, power: [{ allowedDomains: ['Fury', 'Fury'], amount: 1 }] }), false);
  assert.equal(isDuelRuneCost({ energy: Number.MAX_SAFE_INTEGER, power: [{ allowedDomains: ['Calm'], amount: 1 }] }), false);
  assert.equal(isDuelRuneCost({ energy: 0, power: [{ allowedDomains: ['any'], amount: 1 }] }), false);
});
test('nested unknown and private fields are always rejected, even under genuine public DTO', () => {
  const original = wrap('playing');
  for (const field of ['unitMeta', 'retiredUnitTokenUIDs', 'playersPrivate', 'requiredTasks', 'receipts', 'outcome']) {
    assertRejected(original, p => { p.match[field] = []; });
  }
  assertRejected(original, p => { p.match.frame.taskAuthority = true; });
  assertRejected(original, p => { p.match.resources.bases[0].goldTokens.push({ uid: 'gold', sourceUID: 'secret' }); });
  assertRejected(original, p => { p.sourceReference = 'secret'; });
});
test('malformed prototypes, sparse arrays, accessors, symbols and unsafe counters fail closed', () => {
  const original = wrap('playing');
  assertRejected(original, p => { p.match.stateVersion = Number.MAX_SAFE_INTEGER + 1; });
  assertRejected(original, p => { p.match.resources.players[0].runePool.power.any = -1; });
  assertRejected(original, p => { p.match.resources.players[0].runePool.power.any = 0.5; });
  const sparse = clone(original); sparse.match.players[0].hand = new Array(4);
  assert.equal(isDuelProjection(sparse), false);
  const extra = clone(original); extra.match.resources.bases[0].goldTokens.foo = 'private';
  assert.equal(isDuelProjection(extra), false);
  const getter = clone(original); Object.defineProperty(getter.match, 'eventSeq', { get: () => 0 });
  assert.equal(isDuelProjection(getter), false);
  const symbol = clone(original); symbol.match.board[Symbol('private')] = 1;
  assert.equal(isDuelProjection(symbol), false);
  const proto = clone(original); Object.setPrototypeOf(proto.match.frame, { private: 'ledger' });
  assert.equal(isDuelProjection(proto), false);
});
const message = command => ({ type: 'duel-command', requestId: 'req-1', commandId: 'cmd-1',
  expectedVersion: 0, command });
test('duel-command accepts each narrow core command without any claimed actor or cost', () => {
  for (const command of [{ type: 'mulligan', selectedUIDs: [] },
    { type: 'mulligan', selectedUIDs: ['own-1', 'own-2'] },
    ...['rune-energy', 'rune-power', 'gold-power'].map(type => ({ type, uid: 'source-1' })),
    { type: 'pay-pending', paymentId: 'payment-1' },
    { type: 'pay-pending', paymentId: 'payment-1', plan: {
      power: [{ requirementIndex: 0, from: 'Fury', amount: 1 },
        { requirementIndex: 0, from: 'any', amount: 1 }],
    } }]) {
    assert.equal(isDuelCommandMessage(message(command)), true);
    assert.equal(isClientMessage(message(command)), true);
  }
});
test('duel-command blocks actor, cost, phase, amount, rawpool and turn authority at every level', () => {
  const base = message({ type: 'rune-energy', uid: 'rune-1' });
  for (const field of ['actor', 'playerId', 'phase', 'taskAuthority', 'cost', 'free']) {
    assert.equal(isClientMessage({ ...base, [field]: 'p1' }), false);
    assert.equal(isClientMessage({ ...base, command: { ...base.command, [field]: 'p1' } }), false);
  }
  for (const command of [{ type: 'rune-energy', uid: 'rune-1', amount: 2 },
    { type: 'rune-power', uid: 'rune-1', rawPool: {} },
    { type: 'gold-power', uid: 'g1', clear: true },
    { type: 'mulligan', selectedUIDs: [], createToken: true },
    { type: 'mulligan', selectedUIDs: ['a', 'a'] },
    { type: 'mulligan', selectedUIDs: ['a', 'b', 'c'] },
    { type: 'play-card', uid: 'x' }, { type: 'turn-advance' }]) {
    assert.equal(isClientMessage(message(command)), false);
  }
});
test('plan corruption and forged payment costs cannot cross duel-command boundary', () => {
  const plan = { power: [{ requirementIndex: 0, from: 'Fury', amount: 1 }] };
  for (const bad of [{ power: [{ requirementIndex: 0, from: 'any', amount: 0 }] },
    { power: [{ requirementIndex: -1, from: 'Fury', amount: 1 }] },
    { power: [{ requirementIndex: 0, from: 'Wildcard', amount: 1 }] },
    { power: [{ requirementIndex: 0, from: 'Fury', amount: 1, sourceUID: 'hidden' }] },
    { power: [plan.power[0], plan.power[0]] },
    { power: [], resolvedCost: { energy: 0, power: [] } }]) {
    assert.equal(isClientMessage(message({ type: 'pay-pending', paymentId: 'payment-1', plan: bad })), false);
  }
  for (const field of ['resolvedCost', 'sourceReference', 'actor', 'amount'])
    assert.equal(isClientMessage(message({ type: 'pay-pending', paymentId: 'payment-1', [field]: plan })), false);
  assert.equal(isClientMessage(message({ type: 'pay-pending', paymentId: 'payment-1', plan: null })), false);
  assert.equal(isClientMessage(message({ type: 'pay-pending', paymentId: 'payment-1', plan: { power: new Array(1) } })), false);
});
test('duel-projection message rejects raw outcomes/ledger and retains safe request-result behavior', () => {
  const safe = { type: 'request-result', requestId: 'req-1', ok: true,
    commandId: 'cmd-1', appliedVersion: 2, eventSeq: 2, duplicate: false };
  assert.equal(isServerMessage(safe), true);
  assert.equal(isServerMessage({ ...safe, paymentCompleted: { sourceReference: 'private' } }), false);
  assert.equal(isServerMessage({ ...safe, requiredTask: { continuationId: 'private' } }), false);
  const projected = { type: 'duel-projection', roomId: 'room-1', projection: wrap('playing') };
  assert.equal(isDuelProjectionMessage(projected), true);
  assert.equal(isServerMessage({ ...projected, outcome: { status: 'applied' } }), false);
  assert.equal(isServerMessage({ ...projected, session: { receipts: [] } }), false);
});
test('legacy message parsing remains intact and does not accept Duel payload as Foundation projection', () => {
  assert.equal(isClientMessage({ type: 'ping' }), true);
  assert.equal(isClientMessage({ type: 'command', requestId: 'r', commandId: 'c',
    expectedVersion: 0, command: { type: 'pass' } }), true);
  assert.equal(isServerMessage({ type: 'pong' }), true);
  assert.equal(isServerMessage({ type: 'projection', roomId: 'room-1', projection: wrap('playing') }), false);
  assert.equal(isClientMessage({ type: 'create-room', requestId: 'r', playerName: 'Alice',
    rulesetId: DUEL_RULESET_ID }), true); // Shape only; existing server ruleset whitelist remains unchanged.
});

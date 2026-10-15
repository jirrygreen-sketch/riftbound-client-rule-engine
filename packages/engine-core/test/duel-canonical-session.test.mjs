import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDuelMatch } from '../dist/duel/match-state.js';
import { channelDuelRunes, createDuelGoldToken } from '../dist/duel/resources.js';
import { bindDuelPrintedCost } from '../dist/duel/printed-costs.js';
import { applyDuelResourceCommand as apply, prepareDuelPayment, projectCanonicalDuelMatch as project,
  issueDuelRequiredCostTask, prepareDuelRequiredCostPayment, commitDuelPriorityPayment,
} from '../dist/duel/canonical-session.js';
import { commitDuelPlayingMutation } from '../dist/duel/canonical-transaction.js';

const seats = ['alice', 'bob'].map(id => ({
  playerId: id,
  mainDeck: Array.from({ length: 8 }, (_, i) => ({ uid: `${id}-main-${i}`, cardId: `${id}-print-main-${i}` })),
  champion: { uid: `${id}-champion`, cardId: `${id}-champion-print` },
  legend: { uid: `${id}-legend`, cardId: `${id}-legend-print` },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${id}-rune-${i}`, cardId: `${id}-print-rune-${i}`,
    domain: i % 2 === 0 ? 'Fury' : 'Calm' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${id}-field-${i}`, cardId: `${id}-field-print-${i}` })),
}));
const metadata = { matchId: 'match-1', dataVersion: 'v1', catalogDigest: 'test-catalog-digest',
  roster: [{ playerId: 'alice', displayName: 'Alice' }, { playerId: 'bob', displayName: 'Bob' }] };
function create() { return { match: createDuelMatch(seats, metadata, () => 0), receipts: [] }; }
function submit(session, actor, commandId, command, expectedVersion = session.match.stateVersion, trusted) {
  return apply(session, actor, { commandId, expectedVersion, command }, trusted);
}
function ok(result, version) {
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.outcome.appliedVersion, version);
  assert.equal(result.outcome.eventSeq, version);
  assert.equal(result.match.stateVersion, version);
  assert.equal(result.match.eventSeq, version);
  assert.equal(result.persistRequired, true);
  assert.equal(result.duplicate, false);
  assert.strictEqual(result.match, result.session.match);
  return result.session;
}
function failed(result, reason, priorSession, recorded = true) {
  assert.deepEqual(result.outcome, { status: 'rejected', reason });
  assert.strictEqual(result.match, priorSession.match);
  assert.equal(result.persistRequired, recorded);
  assert.equal(result.session.receipts.length, priorSession.receipts.length + Number(recorded));
  return result.session;
}
function playing() {
  let s = create();
  s = ok(submit(s, 'alice', 'mulligan-a', { type: 'mulligan', selectedUIDs: [] }), 1);
  s = ok(submit(s, 'bob', 'mulligan-b', { type: 'mulligan', selectedUIDs: [] }), 2);
  assert.equal(s.match.stage, 'playing');
  return s;
}
// Trusted *test fixture*, not a client command or official turn advancement.
function windowed(s, { phase = 'main', priority = 'alice', open = true, payment = null } = {}) {
  assert.equal(s.match.stage, 'playing');
  return { ...s, match: { ...s.match, frame: { ...s.match.frame, phase,
    priorityPlayerId: priority, stateOpen: open, pendingPayment: payment } } };
}
function channel(s, actor, n) {
  return { ...s, match: { ...s.match, resources: channelDuelRunes(s.match.resources, actor, n) } };
}
function gold(s, actor, uid, readied = true) {
  const locationId = s.match.resources.bases.find(b => b.playerId === actor).locationId;
  return { ...s, match: { ...s.match,
    resources: createDuelGoldToken(s.match.resources, { uid, playerId: actor, locationId, readied }) } };
}
function pool(s, player = 'alice') { return s.match.resources.players.find(p => p.playerId === player).runePool; }
function rune(s, player, i) { return s.match.resources.bases.find(b => b.playerId === player).baseRunes[i]; }

 test('actual mulligan transition; same-ID retry, later-command retry and JSON roundtrip never rollback', () => {
  let s = create();
  const first = s.match.setup.players[0].hand[0].uid;
  const original = { type: 'mulligan', selectedUIDs: [first] };
  s = ok(submit(s, 'alice', 'same-ID', original), 1);
  assert.equal(s.match.setup.players[0].mulliganStatus, 'complete');
  assert.equal(s.match.setup.players[0].hand.some(card => card.uid === first), false);
  let retried = submit(s, 'alice', 'same-ID', original, 0);
  assert.equal(retried.duplicate, true);
  assert.equal(retried.persistRequired, false);
  assert.strictEqual(retried.match, s.match);
  assert.equal(retried.outcome.appliedVersion, 1);
  s = ok(submit(s, 'bob', 'same-ID', { type: 'mulligan', selectedUIDs: [] }), 2);
  assert.equal(s.match.stage, 'playing');
  assert.deepEqual(s.match.frame, { phase: 'awaiting-turn-start', turnNumber: 1,
    turnPlayerId: 'alice', priorityPlayerId: null, focusPlayerId: null,
    stateOpen: true, pendingPayment: null });
  const restoredBytes = JSON.parse(JSON.stringify(s)); // transport simulation; NOT archive validation
  retried = submit(restoredBytes, 'alice', 'same-ID', original, 0);
  assert.equal(retried.duplicate, true);
  assert.strictEqual(retried.match, restoredBytes.match);
  assert.equal(retried.match.stage, 'playing');
  assert.equal(retried.match.stateVersion, 2);
  assert.equal(retried.session.receipts.length, 2);
  assert.deepEqual(restoredBytes.receipts.map(r => r.actor), ['alice', 'bob']);
  assert.equal(restoredBytes.receipts[0].payloadFingerprint,
    JSON.stringify({ selectedUIDs: [first], type: 'mulligan' }));
});

test('receipt semantics: recorded failure sticky, version stale, conflict, malformed, actor scope', () => {
  let s = create();
  const denied = { type: 'mulligan', selectedUIDs: [] };
  const f = submit(s, 'bob', 'out-of-turn', denied);
  s = failed(f, 'mulligan-rejected', s);
  s = ok(submit(s, 'alice', 'approved', denied), 1);
  const sticky = submit(s, 'bob', 'out-of-turn', denied, 1);
  assert.deepEqual(sticky.outcome, f.outcome);
  assert.equal(sticky.duplicate, true);
  assert.strictEqual(sticky.match, s.match);
  assert.equal(sticky.persistRequired, false);
  const stale = submit(s, 'bob', 'stale', denied, 0);
  s = failed(stale, 'stale-version', s);
  assert.equal(submit(s, 'bob', 'stale', denied, 1).outcome.reason, 'stale-version');
  assert.equal(submit(s, 'bob', 'stale', denied, 1).duplicate, true);
  const conflict = submit(s, 'alice', 'approved', { type: 'mulligan', selectedUIDs: ['different'] }, 0);
  failed(conflict, 'command-conflict', s, false);
  const bad = apply(s, 'alice', { commandId: 'client-fields', expectedVersion: 1,
    command: { type: 'rune-energy', uid: 'some-rune', quantity: 999 } });
  failed(bad, 'invalid-command', s, false);
  const forged = apply(s, 'alice', { commandId: 'bogus-cost', expectedVersion: 1,
    command: { type: 'pay-pending', paymentId: 'fake', cost: { energy: 0, power: [] } } });
  failed(forged, 'invalid-command', s, false);
  failed(submit(s, 'spectator', 'outsider', denied), 'unknown-actor', s, false);
  failed(apply(s, 'bob', { commandId: 'missing', expectedVersion: 1,
    command: { type: 'mulligan', selectedUIDs: [], phase: 'main' } }), 'invalid-command', s, false);
  const sameIdDifferentSeat = submit(s, 'bob', 'approved', denied);
  s = ok(sameIdDifferentSeat, 2);
  assert.deepEqual(s.receipts.map(x => x.commandId), ['out-of-turn', 'approved', 'stale', 'approved']);
  assert.deepEqual(s.receipts.map(x => x.actor), ['bob', 'alice', 'bob', 'bob']);
  assert.equal(s.match.stage, 'playing');
});

test('mulligan order and fingerprint arrays are semantic, RNG only from trusted executor', () => {
  let s = create();
  const selected = s.match.setup.players[0].hand.slice(0, 2).map(card => card.uid);
  const requested = { type: 'mulligan', selectedUIDs: selected };
  let calls = 0;
  s = ok(submit(s, 'alice', 'two-cards', requested, 0,
    { randomIndex: bound => { assert.equal(bound, 2); calls++; return 0; } }), 1);
  assert.equal(calls, 1);
  const same = submit(s, 'alice', 'two-cards', { selectedUIDs: [...selected], type: 'mulligan' }, 0,
    { randomIndex: () => { throw Error('retry must not shuffle'); } });
  assert.equal(same.duplicate, true);
  assert.equal(same.outcome.appliedVersion, 1);
  const differentArrayOrder = submit(s, 'alice', 'two-cards',
    { type: 'mulligan', selectedUIDs: [...selected].reverse() }, 0);
  failed(differentArrayOrder, 'command-conflict', s, false);
  const withoutRng = submit(create(), 'alice', 'needs-rng', requested);
  assert.equal(withoutRng.outcome.reason, 'mulligan-rejected');
  assert.equal(withoutRng.persistRequired, true);
  assert.equal(withoutRng.match.stateVersion, 0);
});

test('pre-turn/ended/wrong priority/wrong owner reject; priority Closed enables true kernel reactions', () => {
  let s = playing();
  s = channel(s, 'alice', 2);
  s = gold(s, 'alice', 'gold-ready');
  const uid = rune(s, 'alice', 0).uid;
  s = failed(submit(s, 'alice', 'early', { type: 'rune-energy', uid }), 'invalid-phase', s);
  s = windowed(s, { phase: 'main', priority: 'bob' });
  s = failed(submit(s, 'alice', 'wrong-priority', { type: 'rune-energy', uid }), 'no-permission', s);
  s = failed(submit(s, 'bob', 'foreign-rune', { type: 'rune-energy', uid }), 'resource-rejected', s);
  s = windowed(s, { phase: 'main', priority: 'alice', open: false });
  s = ok(submit(s, 'alice', 'e', { type: 'rune-energy', uid }), 3);
  assert.equal(pool(s).energy, 1);
  assert.equal(rune(s, 'alice', 0).readied, false);
  s = failed(submit(s, 'alice', 'again-energy', { type: 'rune-energy', uid }), 'resource-rejected', s);
  s = ok(submit(s, 'alice', 'recycle-exhausted', { type: 'rune-power', uid }), 4);
  assert.equal(pool(s).power[s.match.resources.players[0].runeDeck.at(-1).domain], 1);
  assert.equal(s.match.resources.players[0].runeDeck.at(-1).uid, uid);
  assert.equal(s.match.resources.bases[0].baseRunes.some(r => r.uid === uid), false);
  s = ok(submit(s, 'alice', 'gold', { type: 'gold-power', uid: 'gold-ready' }), 5);
  assert.equal(pool(s).power.any, 1);
  assert.deepEqual(s.match.resources.retiredGoldUids, ['gold-ready']);
  s = failed(submit(s, 'alice', 'second-gold', { type: 'gold-power', uid: 'gold-ready' }), 'resource-rejected', s);
  s = failed(submit(s, 'alice', 'unknown-uid', { type: 'rune-power', uid: 'unknown' }), 'resource-rejected', s);
  const retry = submit(s, 'alice', 'gold', { uid: 'gold-ready', type: 'gold-power' }, 2);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.outcome.appliedVersion, 5);
  assert.strictEqual(retry.match, s.match);
  assert.equal(pool(retry.session).power.any, 1);
  s = windowed(s, { phase: 'ended', priority: 'alice' });
  s = failed(submit(s, 'alice', 'ended', { type: 'rune-energy', uid: rune(s, 'alice', 0).uid }), 'invalid-phase', s);
});

test('trusted final cost in Closed payment window: atomic failure, surplus, ordered plan, repeat after later action', () => {
  let s = windowed(playing(), { phase: 'main', priority: 'alice', open: false });
  s = channel(s, 'alice', 4);
  s = gold(s, 'alice', 'gold-payment');
  const uid = rune(s, 'alice', 0).uid;
  s = ok(submit(s, 'alice', 'energy-1', { type: 'rune-energy', uid }), 3);
  s = ok(submit(s, 'alice', 'energy-2', { type: 'rune-energy', uid: rune(s, 'alice', 2).uid }), 4);
  s = ok(submit(s, 'alice', 'power', { type: 'rune-power', uid: rune(s, 'alice', 1).uid }), 5);
  assert.equal(pool(s).power.Fury, 1);
  const binding = bindDuelPrintedCost({ id: 'printed-trusted-unit', cardType: 'Unit', domains: ['Fury'],
    energy: 1, power: 2 });
  assert.equal(binding.kind, 'numeric');
  const sourceReference = { kind: 'card', referenceId: 'private-source', sourceUID: 'private-card-uid' };
  const before = s.match.stateVersion;
  const prepared = prepareDuelPayment(s.match, 'alice', 'payment-1', binding.cost, sourceReference);
  assert.equal(prepared.stateVersion, before); // trusted outer card transaction owns this version
  s = { ...s, match: { ...prepared, frame: { ...prepared.frame, priorityPlayerId: 'bob' } } };
  sourceReference.sourceUID = 'changed-after-prepare';
  assert.equal(s.match.frame.pendingPayment.sourceReference.sourceUID, 'private-card-uid');
  s = failed(submit(s, 'bob', 'not-owner', { type: 'pay-pending', paymentId: 'payment-1' }), 'no-permission', s);
  s = failed(submit(s, 'alice', 'wrong-payment-id', { type: 'pay-pending', paymentId: 'payment-2' }), 'no-permission', s);
  const withoutPower = submit(s, 'alice', 'insuff', { type: 'pay-pending', paymentId: 'payment-1' });
  s = failed(withoutPower, 'payment-rejected', s);
  assert.equal(pool(s).energy, 2);
  assert.equal(s.match.frame.pendingPayment.paymentId, 'payment-1');
  // Closed without Priority is legal specifically during owner's active Pay Costs transaction.
  s = ok(submit(s, 'alice', 'pay-gold', { type: 'gold-power', uid: 'gold-payment' }), 6);
  assert.equal(pool(s).power.any, 1);
  const wrongDomain = { power: [{ requirementIndex: 0, from: 'Calm', amount: 2 }] };
  s = failed(submit(s, 'alice', 'invalid-plan', { type: 'pay-pending', paymentId: 'payment-1',
    plan: wrongDomain }), 'payment-rejected', s);
  assert.equal(pool(s).energy, 2);
  assert.equal(pool(s).power.Fury, 1);
  assert.equal(pool(s).power.any, 1);
  const plan = { power: [{ requirementIndex: 0, from: 'Fury', amount: 1 },
    { requirementIndex: 0, from: 'any', amount: 1 }] };
  const payment = submit(s, 'alice', 'pay-1', { type: 'pay-pending', paymentId: 'payment-1', plan });
  s = ok(payment, 7);
  assert.equal(pool(s).energy, 1);
  assert.equal(pool(s).power.Fury, 0);
  assert.equal(pool(s).power.any, 0);
  assert.equal(s.match.frame.pendingPayment, null);
  assert.deepEqual(payment.outcome.paymentCompleted, { paymentId: 'payment-1',
    sourceReference: { kind: 'card', referenceId: 'private-source', sourceUID: 'private-card-uid' }, plan });
  payment.outcome.paymentCompleted.plan.power[0].amount = 999;
  assert.equal(s.receipts.at(-1).outcome.paymentCompleted.plan.power[0].amount, 1);
  assert.equal(s.receipts.at(-1).payloadFingerprint,
    '{"paymentId":"payment-1","plan":{"power":[{"amount":1,"from":"Fury","requirementIndex":0},{"amount":1,"from":"any","requirementIndex":0}]},"type":"pay-pending"}');
  s = failed(submit(s, 'alice', 'no-current-payment', { type: 'pay-pending', paymentId: 'payment-1' }), 'no-permission', s);
  // A second resolved transaction spends remaining Energy, not the earlier total or a stale pool.
  s = windowed(s, { phase: 'main', priority: 'alice', open: true });
  const second = prepareDuelPayment(s.match, 'alice', 'payment-2', { energy: 1, power: [] },
    { kind: 'effect', referenceId: 'effect-2' });
  s = { ...s, match: second };
  s = ok(submit(s, 'alice', 'pay-2', { type: 'pay-pending', paymentId: 'payment-2' }), 8);
  assert.equal(pool(s).energy, 0);
  const duplicated = submit(JSON.parse(JSON.stringify(s)), 'alice', 'pay-1',
    { type: 'pay-pending', paymentId: 'payment-1', plan: structuredClone(plan) }, 6);
  assert.equal(duplicated.duplicate, true);
  assert.equal(duplicated.persistRequired, false);
  assert.equal(duplicated.outcome.appliedVersion, 7);
  assert.equal(duplicated.match.stateVersion, 8);
  assert.equal(pool(duplicated.session).energy, 0);
  assert.equal(duplicated.match.frame.pendingPayment, null);
  assert.equal(duplicated.session.receipts.length, s.receipts.length);
  duplicated.outcome.paymentCompleted.plan.power[0].amount = 42;
  assert.equal(duplicated.session.receipts.find(r => r.commandId === 'pay-1')
    .outcome.paymentCompleted.plan.power[0].amount, 1);
});

test('trusted preparation rejects nonwindows and multiple pending; cost copied and invalid cost blocked', () => {
  const s = playing();
  const cost = { energy: 1, power: [{ allowedDomains: ['Fury', 'Calm'], amount: 2 }] };
  const ref = { kind: 'effect', referenceId: 'private-ability-42', sourceUID: 'secret-source-uid' };
  assert.throws(() => prepareDuelPayment(s.match, 'alice', 'p', cost, ref), /active turn phase/);
  const main = windowed(s);
  assert.throws(() => prepareDuelPayment(main.match, 'bob', 'p', cost, ref), /priority actor/);
  assert.throws(() => prepareDuelPayment(main.match, 'alice', 'p', { energy: -1, power: [] }, ref), /safe integer/);
  assert.throws(() => prepareDuelPayment(main.match, 'alice', 'p', { energy: 1,
    power: [{ allowedDomains: ['Fury', 'Fury'], amount: 2 }] }, ref), /domain set/);
  assert.throws(() => prepareDuelPayment(main.match, 'alice', 'p', cost,
    { ...ref, extra: 'not-authorized' }), /unexpected/);
  const prepared = prepareDuelPayment(main.match, 'alice', 'p', cost, ref);
  cost.power[0].allowedDomains[0] = 'Chaos';
  ref.referenceId = 'modified';
  assert.deepEqual(prepared.frame.pendingPayment.resolvedCost.power[0].allowedDomains, ['Fury', 'Calm']);
  assert.equal(prepared.frame.pendingPayment.sourceReference.referenceId, 'private-ability-42');
  assert.throws(() => prepareDuelPayment(prepared, 'alice', 'p2', cost, ref), /already pending/);
  assert.throws(() => prepareDuelPayment(windowed(s, { phase: 'ended' }).match, 'alice', 'p', cost, ref), /active turn/);
});

test('allowlist projection: per-owner hand, count-only decks, public trash, no ledger/source/plan/retired IDs', () => {
  const original = create();
  const setupOpp = project(original.match, 'bob');
  assert.equal(setupOpp.stage, 'setup');
  assert.equal('hand' in setupOpp.setup.players[0], false);
  assert.equal(setupOpp.setup.players[0].handCount, 4);
  assert.equal('removedByPlayer' in setupOpp.setup, false);
  let s = windowed(playing(), { phase: 'main', priority: 'alice', open: false });
  s = channel(s, 'alice', 1);
  s = gold(s, 'alice', 'retired-private');
  s = ok(submit(s, 'alice', 'private-receipt-id', { type: 'gold-power', uid: 'retired-private' }), 3);
  const match = { ...s.match, players: [
    { ...s.match.players[0], trash: [{ uid: 'public-trash', cardId: 'public-print', hidden: 'secret-trash-payload' }] },
    s.match.players[1],
  ] };
  const pending = prepareDuelPayment(match, 'alice', 'owner-private-payment',
    { energy: 3, power: [] }, { kind: 'card', referenceId: 'private-reference', sourceUID: 'private-source-uid' });
  const alice = project(pending, 'alice'), bob = project(pending, 'bob'), spectator = project(pending, null);
  for (const view of [alice, bob, spectator]) {
    assert.equal(view.stage, 'playing');
    assert.equal(view.players.length, 2);
    assert.equal(view.board.battlefields.length, 2);
    assert.equal(view.board.bases.length, 2);
    assert.deepEqual(view.players[0].trash, [{ uid: 'public-trash', cardId: 'public-print' }]);
    assert.equal(view.resources.players[0].runeDeckCount, 5);
    assert.equal(view.resources.players[0].runePool.power.any, 1);
    assert.equal('runeDeck' in view.resources.players[0], false);
    assert.equal('retiredGoldUids' in view.resources, false);
    const bytes = JSON.stringify(view);
    for (const privateValue of ['private-source-uid', 'private-reference', 'secret-trash-payload',
      'private-receipt-id', 'retired-private', 'alice-rune-0', 'alice-field-1']) {
      assert.equal(bytes.includes(privateValue), false, `${privateValue} leaked`);
    }
    assert.equal('sourceReference' in view.frame.pendingPayment, false);
  }
  assert.equal(alice.players[0].hand.length, 4);
  assert.equal(alice.players[1].hand, undefined);
  assert.equal(bob.players[0].hand, undefined);
  assert.equal(bob.players[1].hand.length, 4);
  assert.equal(spectator.players[0].hand, undefined);
  assert.deepEqual(alice.frame.pendingPayment, { active: true, paymentId: 'owner-private-payment',
    resolvedCost: { energy: 3, power: [] } });
  assert.deepEqual(bob.frame.pendingPayment, { active: true });
  assert.deepEqual(spectator.frame.pendingPayment, { active: true });
  alice.players[0].hand[0].cardId = 'mutated';
  alice.frame.pendingPayment.resolvedCost.energy = 999;
  assert.notEqual(pending.players[0].hand[0].cardId, 'mutated');
  assert.equal(pending.frame.pendingPayment.resolvedCost.energy, 3);
  assert.deepEqual(project(playing().match, null).frame.pendingPayment, null);
  assert.throws(() => project(pending, 'unknown-viewer'), /unknown viewer/);
});

test('trusted required-cost capability: Closed no Priority owner pays, surplus remains for a second cost and retries return latest', () => {
  let s = windowed(playing(), { phase: 'main', priority: null, open: false });
  s = channel(s, 'alice', 3);
  s = gold(s, 'alice', 'required-gold');
  const task = { matchId: s.match.matchId, expectedVersion: s.match.stateVersion, taskId: 'task-one',
    paymentId: 'required-one', actor: 'alice', finalResolvedCost: { energy: 1,
      power: [{ allowedDomains: ['Fury'], amount: 1 }] },
    opaqueSource: { kind: 'effect', referenceId: 'PRIVATE-SOURCE', sourceUID: 'PRIVATE-UID' },
    continuationId: 'PRIVATE-CONTINUATION' };
  const issued = issueDuelRequiredCostTask(s, task);
  assert.equal(issued.persistRequired, true);
  assert.equal(issued.session.match.stateVersion, 2);
  assert.equal(issued.session.requiredTasks[0].status, 'issued');
  assert.equal(issueDuelRequiredCostTask(issued.session, task).persistRequired, false);
  assert.throws(() => issueDuelRequiredCostTask(issued.session, { ...task, actor: 'bob' }), /conflict/);
  assert.throws(() => issueDuelRequiredCostTask(issued.session, { ...task, paymentId: 'other' }), /conflict/);
  assert.throws(() => prepareDuelRequiredCostPayment(issued.session, JSON.parse(JSON.stringify(issued.authority))), /unissued/);
  assert.throws(() => prepareDuelRequiredCostPayment(issued.session, { _requiredCostAuthority: Symbol() }), /unissued/);
  assert.throws(() => prepareDuelRequiredCostPayment({ ...issued.session, match: { ...s.match, stateVersion: 3 } }, issued.authority), /stale/);
  assert.throws(() => prepareDuelPayment(s.match, 'alice', task.paymentId, task.finalResolvedCost,
    task.opaqueSource), /priority actor/);
  s = prepareDuelRequiredCostPayment(issued.session, issued.authority).session;
  assert.equal(s.match.stateVersion, 3);
  assert.equal(s.match.eventSeq, 3);
  assert.equal(s.requiredTasks[0].status, 'active');
  assert.throws(() => prepareDuelRequiredCostPayment(issued.session, issued.authority), /unissued/);
  assert.throws(() => issueDuelRequiredCostTask(s, { ...task, expectedVersion: 3 }), /window|pending|active/);
  assert.deepEqual(project(s.match, 'bob').frame.pendingPayment, { active: true });
  assert.deepEqual(project(s.match, 'alice').frame.pendingPayment,
    { active: true, paymentId: 'required-one', resolvedCost: task.finalResolvedCost });
  for (const viewer of [null, 'alice', 'bob']) {
    const bytes = JSON.stringify(project(s.match, viewer));
    assert.equal(bytes.includes('PRIVATE-SOURCE'), false);
    assert.equal(bytes.includes('PRIVATE-UID'), false);
    assert.equal(bytes.includes('task-one'), false);
    assert.equal(bytes.includes('PRIVATE-CONTINUATION'), false);
    assert.equal(bytes.includes('requiredTasks'), false);
  }
  const uid = rune(s, 'alice', 0).uid;
  s = failed(submit(s, 'bob', 'opponent-no-priority', { type: 'rune-energy', uid }), 'no-permission', s);
  s = failed(submit(s, 'bob', 'opponent-pay', { type: 'pay-pending', paymentId: task.paymentId }), 'no-permission', s);
  s = failed(apply(s, 'alice', { commandId: 'client-authority', expectedVersion: 3,
    command: { type: 'pay-pending', paymentId: task.paymentId, authority: { taskId: task.taskId } } }),
  'invalid-command', s, false);
  s = failed(apply(s, 'alice', { commandId: 'client-flag', expectedVersion: 3,
    command: { type: 'rune-energy', uid, ignorePriority: true } }), 'invalid-command', s, false);
  s = ok(submit(s, 'alice', 'acquire-energy', { type: 'rune-energy', uid }), 4);
  s = ok(submit(s, 'alice', 'acquire-gold', { type: 'gold-power', uid: 'required-gold' }), 5);
  assert.deepEqual(s.match.resources.retiredGoldUids, ['required-gold']);
  assert.equal(pool(s).energy, 1);
  assert.equal(pool(s).power.any, 1);
  const pay = submit(s, 'alice', 'required-pay', { type: 'pay-pending', paymentId: task.paymentId });
  s = ok(pay, 6);
  assert.deepEqual(pay.outcome.paymentCompleted.requiredTask,
    { taskId: 'task-one', continuationId: 'PRIVATE-CONTINUATION' });
  assert.equal(pay.outcome.paymentCompleted.sourceReference.referenceId, 'PRIVATE-SOURCE');
  assert.equal(s.requiredTasks[0].status, 'completed');
  assert.equal(s.match.frame.pendingPayment, null);
  assert.equal(pool(s).energy, 0);
  assert.equal(pool(s).power.any, 0);
  assert.throws(() => issueDuelRequiredCostTask(s, { ...task, expectedVersion: 6 }), /conflict|completed/);
  const retry = submit(JSON.parse(JSON.stringify(s)), 'alice', 'required-pay',
    { type: 'pay-pending', paymentId: task.paymentId }, 5);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.persistRequired, false);
  assert.equal(retry.match.stateVersion, 6);
  assert.equal(retry.outcome.paymentCompleted.requiredTask.taskId, 'task-one');
  s = channel(s, 'alice', 1);
  const next = { ...task, expectedVersion: 6, taskId: 'task-two', paymentId: 'required-two',
    finalResolvedCost: { energy: 0, power: [] }, continuationId: 'NEXT-CONTINUATION' };
  const secondIssue = issueDuelRequiredCostTask(s, next);
  s = prepareDuelRequiredCostPayment(secondIssue.session, secondIssue.authority).session;
  assert.equal(s.match.stateVersion, 7);
  s = ok(submit(s, 'alice', 'next-energy', { type: 'rune-energy', uid: rune(s, 'alice', 1).uid }), 8);
  const secondPay = submit(s, 'alice', 'next-pay', { type: 'pay-pending', paymentId: next.paymentId });
  s = ok(secondPay, 9);
  assert.equal(pool(s).energy, 1);
  assert.equal(secondPay.outcome.paymentCompleted.requiredTask.continuationId, 'NEXT-CONTINUATION');
  const old = submit(s, 'alice', 'required-pay', { type: 'pay-pending', paymentId: task.paymentId }, 5);
  assert.equal(old.duplicate, true);
  assert.equal(old.match.stateVersion, 9);
  assert.equal(pool(old.session).energy, 1);
});

test('active required payment actor blocks opponent Priority resource reactions, then restores ordinary Priority', () => {
  let s = windowed(playing(), { phase: 'main', priority: 'bob', open: false });
  s = channel(channel(s, 'alice', 2), 'bob', 2);
  s = gold(gold(s, 'alice', 'gold-alice'), 'bob', 'gold-bob');
  const bobEnergy = rune(s, 'bob', 0).uid;
  const bobPower = rune(s, 'bob', 1).uid;
  const aliceEnergy = rune(s, 'alice', 0).uid;
  const task = { matchId: s.match.matchId, expectedVersion: s.match.stateVersion, taskId: 'alice-task',
    paymentId: 'alice-required-pay', actor: 'alice', finalResolvedCost: { energy: 1, power: [] },
    opaqueSource: { kind: 'effect', referenceId: 'PRIVATE-SOURCE', sourceUID: 'PRIVATE-UID' },
    continuationId: 'PRIVATE-CONTINUATION' };
  const issued = issueDuelRequiredCostTask(s, task);
  s = prepareDuelRequiredCostPayment(issued.session, issued.authority).session;
  assert.equal(s.match.frame.priorityPlayerId, 'bob'); // no fake phase or frame priority reassignment
  assert.equal(s.match.frame.pendingPayment.actor, 'alice');
  assert.equal(s.requiredTasks[0].status, 'active');
  const prepared = s;
  const before = JSON.stringify(s.match);
  for (const [commandId, command] of [
    ['bob-energy', { type: 'rune-energy', uid: bobEnergy }],
    ['bob-power', { type: 'rune-power', uid: bobPower }],
    ['bob-gold', { type: 'gold-power', uid: 'gold-bob' }],
  ]) {
    s = failed(submit(s, 'bob', commandId, command), 'no-permission', s);
    assert.strictEqual(s.match, prepared.match);
    assert.equal(JSON.stringify(s.match), before);
    assert.deepEqual(pool(s, 'bob'), pool(prepared, 'bob'));
    assert.equal(rune(s, 'bob', 0).readied, true);
    assert.equal(rune(s, 'bob', 1).readied, true);
    assert.equal(s.match.resources.bases.find(b => b.playerId === 'bob').goldTokens[0].readied, true);
    assert.equal(s.requiredTasks[0].status, 'active');
    assert.equal(s.receipts.at(-1).outcome.reason, 'no-permission');
  }
  const sticky = submit(s, 'bob', 'bob-energy', { type: 'rune-energy', uid: bobEnergy }, prepared.match.stateVersion);
  assert.equal(sticky.duplicate, true);
  assert.equal(sticky.persistRequired, false);
  assert.strictEqual(sticky.match, s.match);
  assert.equal(sticky.outcome.reason, 'no-permission');
  const foreign = failed(submit(s, 'alice', 'foreign-source', { type: 'rune-energy', uid: bobEnergy }),
    'resource-rejected', s);
  assert.equal(JSON.stringify(foreign.match), before);
  s = foreign;
  assert.throws(() => commitDuelPriorityPayment(s, 'bob', 'attempted-interrupt',
    { energy: 0, power: [] }, { kind: 'effect', referenceId: 'ordinary' }), /required task active/);
  assert.equal(JSON.stringify(s.match), before);
  s = ok(submit(s, 'alice', 'alice-add', { type: 'rune-energy', uid: aliceEnergy }), 4);
  assert.equal(pool(s).energy, 1);
  assert.equal(pool(s, 'bob').energy, 0);
  s = ok(submit(s, 'alice', 'alice-pay', { type: 'pay-pending', paymentId: task.paymentId }), 5);
  assert.deepEqual(s.receipts.at(-1).outcome.paymentCompleted.requiredTask,
    { taskId: task.taskId, continuationId: task.continuationId });
  assert.equal(s.requiredTasks[0].status, 'completed');
  assert.equal(s.match.frame.pendingPayment, null);
  assert.equal(s.match.frame.priorityPlayerId, 'bob');
  assert.equal(pool(s).energy, 0);
  assert.equal(pool(s, 'bob').energy, 0);
  s = ok(submit(s, 'bob', 'bob-after-task', { type: 'rune-energy', uid: bobEnergy }), 6);
  assert.equal(pool(s, 'bob').energy, 1);
  assert.equal(pool(s).energy, 0);
  const after = submit(s, 'bob', 'bob-energy', { type: 'rune-energy', uid: bobEnergy }, prepared.match.stateVersion);
  assert.equal(after.duplicate, true);
  assert.equal(after.outcome.reason, 'no-permission');
  assert.strictEqual(after.match, s.match);
  assert.equal(after.match.stateVersion, 6);
  assert.equal(after.persistRequired, false);
});

test('trusted callback mutation attempt cannot change nested authoritative snapshot', () => {
  const match = playing().match;
  const before = JSON.stringify(match);
  let attempt;
  assert.throws(() => commitDuelPlayingMutation(match, draft => {
    try {
      match.resources.players[0].runePool.power.Fury = 99;
      match.board.bases[0].locationId = 'tampered';
    } catch (error) {
      attempt = error;
      throw error;
    }
    return draft;
  }), /read only|frozen|Cannot assign|playing state keys/);
  assert.equal(attempt?.name, 'TypeError');
  assert.equal(JSON.stringify(match), before);

  const original = JSON.stringify(match);
  assert.throws(() => commitDuelPlayingMutation(match, draft => {
    draft.resources = channelDuelRunes(draft.resources, 'alice', 1);
    throw new Error('callback failed after draft mutation');
  }), /callback failed after draft mutation/);
  assert.equal(JSON.stringify(match), original);

  const invalid = commitDuelPlayingMutation(match, draft => ({ ...draft,
    resources: channelDuelRunes(draft.resources, 'alice', 1) }));
  assert.equal(invalid.stateVersion, match.stateVersion + 1);
  assert.notStrictEqual(invalid.resources, match.resources);
  assert.throws(() => { invalid.resources.players[0].runePool.energy = 99; }, /read only|frozen|Cannot assign/);
  assert.equal(JSON.stringify(match), original);
  const afterResult = JSON.stringify(invalid);
  assert.throws(() => {
    invalid.board.bases[0].occupancy.push('tampered');
  }, /read only|frozen|Cannot add property/);
  assert.equal(JSON.stringify(invalid), afterResult);
});

test('ordinary priority preparation allocates one clock, cannot bypass absent Priority or reuse completed ID', () => {
  let s = windowed(playing());
  const source = { kind: 'effect', referenceId: 'ordinary' };
  assert.throws(() => commitDuelPriorityPayment(windowed(s, { priority: null }), 'alice', 'p',
    { energy: 0, power: [] }, source), /priority actor/);
  s = commitDuelPriorityPayment(s, 'alice', 'p', { energy: 0, power: [] }, source).session;
  assert.equal(s.match.stateVersion, 3);
  assert.equal(s.match.eventSeq, 3);
  s = ok(submit(s, 'alice', 'paid', { type: 'pay-pending', paymentId: 'p' }), 4);
  assert.throws(() => commitDuelPriorityPayment(s, 'alice', 'p', { energy: 0, power: [] }, source), /completed/);
  assert.equal(s.match.frame.pendingPayment, null);
});

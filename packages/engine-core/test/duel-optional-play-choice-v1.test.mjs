import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2 } from '../dist/duel/canonical-session-v2.js';
import { commitDuelPlayingMutationV2, moveDuelPhysicalCardToChainV2,
  referenceDuelPhysicalCardV2 } from '../dist/duel/core-v2.js';
import { createDuelOptionalPlayChoiceAuthorityV1 } from '../dist/duel/optional-play-choice-v1.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: 'fixture-accelerate' })),
  champion: { uid: `${playerId}-champion`, cardId: 'fixture-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'fixture-rune',
    domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `fixture-field-${playerId}-${i}` })),
}));
const metadata = { matchId: 'optional-choice-fixture', dataVersion: 'fixture-v1',
  catalogDigest: 'fixture-digest', roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const types = cardId => cardId === 'fixture-champion' ? 'Champion' : cardId === 'fixture-legend'
  ? 'Legend' : cardId === 'fixture-rune' ? 'Rune' : cardId.startsWith('fixture-field-') ? 'Battlefield' : 'Unit';

// Fixture-only admission and source oracle. No official Accelerate coverage or rule semantics.
function scene() {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, types);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan-${actor}`,
      expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  const match = commitDuelPlayingMutationV2(session.match, draft => ({
    match: { ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates)
        .map(([uid, prior]) => [uid, { ...prior, readiness: 'ready' }])),
      frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' } },
    transitions: [],
  }));
  return { match, uid: match.players.find(player => player.playerId === 'alice').hand[0].uid };
}
function harness() {
  const created = scene();
  let head = created.match;
  let program = 'fixture-whole-accelerate-program-v1';
  let calls = 0;
  let ids = 0;
  let reader = (match, actor, uid) => {
    const card = match.players.find(player => player.playerId === actor)?.hand.find(value => value.uid === uid);
    assert.ok(card, 'fixture source must be a current Hand card');
    return { matchId: match.matchId, actor, uid, cardId: card.cardId,
      sourceEpoch: match.physicalCardsByUID[uid].zoneEpoch, sourceProgramFingerprint: program };
  };
  const services = { readHead: () => head, readSource: (match, actor, uid) => {
    calls++;
    return reader(match, actor, uid);
  }, nextOpaqueId: () => `server-choice-${++ids}` };
  const authority = createDuelOptionalPlayChoiceAuthorityV1(services);
  const issue = (overrides = {}) => authority.issue({ actor: 'alice', commandId: 'play-1',
    expectedVersion: head.stateVersion, uid: created.uid, ...overrides });
  const answer = (prompt, optionId = prompt.payOptionId, overrides = {}) => authority.answer({
    actor: 'alice', commandId: 'play-1', expectedVersion: head.stateVersion,
    choiceId: prompt.choiceId, optionId, ...overrides });
  return { authority, issue, answer, get head() { return head; }, set head(value) { head = value; },
    get program() { return program; }, set program(value) { program = value; },
    get calls() { return calls; }, get ids() { return ids; },
    set reader(value) { reader = value; }, uid: created.uid };
}

test('real V2 admission yields only pending opaque IDs until answered; inspection is read-only', () => {
  const h = harness();
  const prompt = h.issue();
  assert.deepEqual(Object.keys(prompt).sort(), ['choiceId', 'declineOptionId', 'payOptionId']);
  assert.notEqual(prompt.choiceId, h.uid);
  assert.throws(() => h.authority.inspectReceipt(prompt));
  assert.equal(h.head.players[0].hand.some(card => card.uid === h.uid), true);
  assert.equal(h.calls, 1);
  const receipt = h.answer(prompt);
  assert.deepEqual(receipt, { decision: 'pay' });
  const data = h.authority.inspectReceipt(receipt);
  assert.deepEqual(data, { matchId: h.head.matchId, actor: 'alice', uid: h.uid,
    cardId: 'fixture-accelerate', sourceEpoch: h.head.physicalCardsByUID[h.uid].zoneEpoch,
    sourceProgramFingerprint: h.program, commandId: 'play-1',
    stateVersion: h.head.stateVersion, decision: 'pay' });
  assert.deepEqual(h.authority.inspectReceipt(receipt), data);
  assert.equal(h.head.players[0].hand.some(card => card.uid === h.uid), true);
  assert.equal(h.head.frame.pendingPayment, null);
});

test('decline is explicit; pay stays pay even when an outer cost census later finds zero', () => {
  const pay = harness();
  const payPrompt = pay.issue();
  const payReceipt = pay.answer(payPrompt);
  const externalResolvedCost = { energy: 0, power: [] };
  assert.equal(externalResolvedCost.energy, 0);
  assert.equal(pay.authority.inspectReceipt(payReceipt).decision, 'pay');
  const decline = harness();
  const declinePrompt = decline.issue();
  assert.equal(decline.authority.inspectReceipt(decline.answer(declinePrompt, declinePrompt.declineOptionId)).decision,
    'decline');
});

test('duplicate issue and answer return the same identities without source or ID provider replay', () => {
  const h = harness();
  const prompt = h.issue();
  assert.strictEqual(h.issue(), prompt);
  assert.equal(h.calls, 1);
  assert.equal(h.ids, 3);
  const receipt = h.answer(prompt);
  assert.strictEqual(h.answer(prompt), receipt);
  assert.strictEqual(h.issue(), prompt);
  assert.equal(h.calls, 2);
  assert.equal(h.ids, 3);
  assert.throws(() => h.answer(prompt, prompt.declineOptionId), /choice already frozen/);
  assert.throws(() => h.issue({ uid: h.head.players[0].hand[1].uid }), /command conflict/);
  assert.throws(() => h.issue({ commandId: 'play-2' }), /source already has a choice/);
});

test('actor, UID, Main/Open/Priority, version, and current Hand are enforced', () => {
  const h = harness();
  assert.throws(() => h.issue({ actor: 'bob' }), /current Priority/);
  assert.throws(() => h.issue({ uid: h.head.players[1].hand[0].uid }), /current Hand/);
  assert.throws(() => h.issue({ expectedVersion: h.head.stateVersion - 1 }), /stale/);
  const prompt = h.issue();
  assert.throws(() => h.answer(prompt, prompt.payOptionId, { actor: 'bob' }));
  assert.throws(() => h.answer(prompt, prompt.payOptionId, { choiceId: 'client-guessed' }));
  assert.throws(() => h.answer(prompt, 'client-guessed'), /unknown option/);
  h.head = commitDuelPlayingMutationV2(h.head, draft => ({ match: { ...draft,
    frame: { ...draft.frame, stateOpen: false } }, transitions: [] }));
  assert.throws(() => h.answer(prompt), /stale/);
});

test('a native Hand exit and zone epoch change invalidate the pending choice', () => {
  const h = harness();
  const prompt = h.issue();
  h.head = moveDuelPhysicalCardToChainV2(h.head, referenceDuelPhysicalCardV2(h.head, h.uid), 'alice');
  assert.equal(h.head.players[0].hand.some(card => card.uid === h.uid), false);
  assert.throws(() => h.answer(prompt));
  assert.throws(() => h.issue());
});

test('source program changes and forged source identity fail closed without auto-decline', () => {
  const h = harness();
  const prompt = h.issue();
  h.program = 'fixture-program-changed';
  assert.throws(() => h.answer(prompt), /source program changed/);
  assert.throws(() => h.authority.inspectReceipt({ decision: 'decline' }));
  h.program = 'fixture-whole-accelerate-program-v1';
  assert.equal(h.answer(prompt).decision, 'pay');
  const bad = harness();
  bad.reader = (match, actor, uid) => ({ matchId: match.matchId, actor, uid,
    cardId: 'forged-card', sourceEpoch: match.physicalCardsByUID[uid].zoneEpoch,
    sourceProgramFingerprint: 'fixture-program' });
  assert.throws(() => bad.issue(), /source physical identity mismatch/);
});

test('receipt cannot be JSON copied, crossed to another authority, or reused on a newer head', () => {
  const h = harness();
  const receipt = h.answer(h.issue());
  assert.throws(() => h.authority.inspectReceipt(JSON.parse(JSON.stringify(receipt))), /foreign/);
  const other = harness();
  assert.throws(() => other.authority.inspectReceipt(receipt), /foreign/);
  h.head = commitDuelPlayingMutationV2(h.head, draft => ({ match: { ...draft,
    frame: { ...draft.frame, focusPlayerId: 'bob' } }, transitions: [] }));
  assert.throws(() => h.authority.inspectReceipt(receipt), /stale receipt/);
});

test('an independently admitted match with the same public ID is a foreign native lineage', () => {
  const h = harness();
  const prompt = h.issue();
  h.head = scene().match;
  assert.equal(h.head.matchId, metadata.matchId);
  assert.throws(() => h.answer(prompt), /foreign match lineage/);
  assert.throws(() => h.issue({ commandId: 'play-2' }), /foreign match lineage/);
});

test('accessor and thenable provider results, ID collision, and reentry fail closed', () => {
  const accessor = harness();
  accessor.reader = () => Object.defineProperty({}, 'matchId', { get() { throw Error('getter called'); } });
  assert.throws(() => accessor.issue(), /invalid source reader result/);
  const thenable = harness();
  thenable.reader = (match, actor, uid) => ({ matchId: match.matchId, actor, uid,
    cardId: 'fixture-accelerate', sourceEpoch: match.physicalCardsByUID[uid].zoneEpoch,
    sourceProgramFingerprint: 'fixture-program', then() {} });
  assert.throws(() => thenable.issue(), /invalid source reader result/);
  const reentrant = harness();
  reentrant.reader = () => reentrant.issue();
  assert.throws(() => reentrant.issue(), /reentrant operation/);
  const original = scene();
  const collision = createDuelOptionalPlayChoiceAuthorityV1({ readHead: () => original.match,
    readSource: (match, actor, uid) => ({ matchId: match.matchId, actor, uid,
      cardId: match.physicalCardsByUID[uid].cardId,
      sourceEpoch: match.physicalCardsByUID[uid].zoneEpoch, sourceProgramFingerprint: 'fixture-program' }),
    nextOpaqueId: () => 'same-id' });
  assert.throws(() => collision.issue({ actor: 'alice', commandId: 'collision',
    expectedVersion: original.match.stateVersion, uid: original.uid }), /duplicate opaque ID/);
});

test('caught callback reentry poisons the outer operation and prevents retry or claim reuse', () => {
  for (const kind of ['readHead', 'readSource', 'nextOpaqueId']) {
    const created = scene();
    let authority;
    let nested = false;
    let ids = 0;
    const source = (match, actor, uid) => ({ matchId: match.matchId, actor, uid,
      cardId: match.physicalCardsByUID[uid].cardId,
      sourceEpoch: match.physicalCardsByUID[uid].zoneEpoch,
      sourceProgramFingerprint: 'fixture-program' });
    const reenter = () => {
      if (!nested) {
        nested = true;
        try {
          authority.answer({ actor: 'alice', commandId: 'same-command-id',
            expectedVersion: created.match.stateVersion, choiceId: 'nested', optionId: 'nested' });
        } catch { /* The outer authority must observe this caught reentry. */ }
      }
    };
    authority = createDuelOptionalPlayChoiceAuthorityV1({
      readHead: () => {
        if (kind === 'readHead') reenter();
        return created.match;
      },
      readSource: (match, actor, uid) => {
        if (kind === 'readSource') reenter();
        return source(match, actor, uid);
      },
      nextOpaqueId: () => {
        if (kind === 'nextOpaqueId') reenter();
        return `caught-reentry-${++ids}`;
      },
    });
    const request = { actor: 'alice', commandId: 'same-command-id',
      expectedVersion: created.match.stateVersion, uid: created.uid };
    assert.throws(() => authority.issue(request), /reentrant operation/);
    assert.throws(() => authority.issue(request), /poisoned by reentrant operation/);
    assert.equal(ids <= 1, true);
  }
});

test('choice command IDs are scoped by authenticated actor', () => {
  const h = harness();
  const alicePrompt = h.issue();
  const bobUid = h.head.players.find(player => player.playerId === 'bob').hand[0].uid;
  h.head = commitDuelPlayingMutationV2(h.head, draft => ({ match: { ...draft,
    frame: { ...draft.frame, priorityPlayerId: 'bob', turnPlayerId: 'bob', stateOpen: true } },
    transitions: [] }));
  const bobPrompt = h.issue({ actor: 'bob', uid: bobUid, expectedVersion: h.head.stateVersion });
  assert.notEqual(bobPrompt.choiceId, alicePrompt.choiceId);
  const bobReceipt = h.answer(bobPrompt, bobPrompt.declineOptionId,
    { actor: 'bob', expectedVersion: h.head.stateVersion });
  assert.equal(h.authority.inspectReceipt(bobReceipt).actor, 'bob');
});

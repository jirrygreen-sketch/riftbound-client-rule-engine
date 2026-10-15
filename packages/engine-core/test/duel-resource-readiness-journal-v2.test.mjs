import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelMatchV2, resolveDuelMulliganV2, commitDuelPlayingMutationV2,
} from '../dist/duel/core-v2.js';
import {
  channelDuelRunes, activateBasicRuneEnergy, clearAllDuelRunePools, payDuelRuneCost,
} from '../dist/duel/resources.js';
import {
  createDuelResourceSourceAuthorityV2, createDuelResourceOuterCommitAuthorityV2,
  beginDuelResourceReadinessJournalFromSetupV2, beginDuelResourceReadinessJournalV2,
  appendDuelResourceReadinessEventV2, sealDuelResourceReadinessJournalV2,
  replayDuelResourceReadinessJournalV2, assertDuelResourceReadinessProofV2,
  digestDuelResourcePaymentV2,
} from '../dist/duel/resource-readiness-journal-v2.js';

const seats = ['alice', 'bob'].map(playerId => ({
  playerId, mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-main-${i}`, cardId: 'p:unit' })),
  champion: { uid: `${playerId}-champion`, cardId: 'p:champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'p:legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'p:rune',
    domain: i % 2 ? 'Calm' : 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-bf-${i}`, cardId: `p:battlefield-${i}` })),
}));
const metadata = { matchId: 'journal-match', dataVersion: 'catalog-v2', catalogDigest: 'sha256:catalog',
  roster: seats.map(s => ({ playerId: s.playerId, displayName: s.playerId })) };
const cardType = cardId => cardId === 'p:champion' ? 'Champion' : cardId === 'p:legend' ? 'Legend' :
  cardId === 'p:rune' ? 'Rune' : cardId.startsWith('p:battlefield-') ? 'Battlefield' : 'Unit';
const clone = value => structuredClone(value);
const change = (state, update) => commitDuelPlayingMutationV2(state, draft => ({
  match: update(draft), transitions: [],
}));
function fixture({ outerLookup = () => {}, sourceLookup = () => {} } = {}) {
  let match = createDuelMatchV2(seats, metadata, () => 0, cardType);
  match = resolveDuelMulliganV2(match, 'alice', []);
  const setup = match;
  match = resolveDuelMulliganV2(match, 'bob', []);
  assert.equal(match.stage, 'playing');
  const origin = Object.freeze({});
  const commits = new Map(), proofs = new Map();
  const sourceAuthority = createDuelResourceSourceAuthorityV2({ origin,
    lookup: revision => { sourceLookup(revision); return proofs.get(revision) ?? null; } });
  const authority = createDuelResourceOuterCommitAuthorityV2({ origin, setup, genesis: match,
    genesisCommitId: 'genesis', lookup: id => { outerLookup(id); return commits.get(id) ?? null; } },
  sourceAuthority);
  const writer = beginDuelResourceReadinessJournalFromSetupV2(setup, match, authority);
  return { setup, match, origin, commits, proofs, authority, writer, revision: 0, parentId: 'genesis' };
}
function staged(ctx, sourceInput, actions, next, proofPatch = {}) {
  const before = ctx.match, after = next(before), revision = ++ctx.revision;
  const commitId = `commit:${revision}`, eventId = `journal:${revision}`;
  const source = sourceInput.kind === 'effect' || sourceInput.kind === 'payment'
    ? { ...sourceInput, sourceRevision: revision } : sourceInput;
  const event = { eventId, stateVersion: after.stateVersion, eventSeq: after.eventSeq,
    source, sourceRevision: revision, actions };
  const proof = { ...source, revision, before, after,
    ...(source.kind === 'effect' ? { consumptionIds: [] } : {}), ...proofPatch };
  if (source.kind === 'payment' && !Object.hasOwn(proof, 'sourceReference')) {
    proof.sourceReference = before.frame.pendingPayment?.sourceReference;
  }
  const commit = { commitId, before, after, event, origin: ctx.origin,
    parentCommitId: ctx.parentId, parent: before, sourceRevision: revision, sourceProof: proof };
  ctx.commits.set(commitId, commit); ctx.proofs.set(revision, proof);
  return { commit, proof, accept() {
    const head = appendDuelResourceReadinessEventV2(ctx.writer, ctx.authority, commitId);
    ctx.match = after; ctx.parentId = commitId;
    return head;
  } };
}
function effectSource(ctx, name) {
  return { kind: 'effect', eventId: `effect:${name}`, sourceEffectId: 'source:shared',
    sourceProofId: `proof:${name}`, sourceUID: 'alice-main-0',
    sourceZoneEpoch: ctx.match.physicalCardsByUID['alice-main-0'].zoneEpoch, actor: 'alice' };
}
function channel(ctx, stepId = 'turn:channel') {
  const uid = ctx.match.resources.players[0].runeDeck[0].uid;
  return staged(ctx, effectSource(ctx, stepId),
    [{ kind: 'channel', playerId: 'alice', runes: [{ uid, readied: true }] }], before =>
      commitDuelPlayingMutationV2(before, draft => ({
        match: { ...draft, resources: channelDuelRunes(draft.resources, 'alice', 1) },
        transitions: [{ uid, from: { kind: 'rune-deck', zonePlayerId: 'alice' },
          to: { kind: 'board-base', locationId: draft.resources.bases[0].locationId } }],
      }))).accept();
}

test('single admitted genesis writer and canonical commit ID reject duplicate writer and foreign graft', () => {
  const ctx = fixture();
  assert.throws(() => beginDuelResourceReadinessJournalFromSetupV2(ctx.setup, ctx.match, ctx.authority),
    /duplicate writer/);
  assert.throws(() => beginDuelResourceReadinessJournalV2(ctx.match, ctx.authority), /duplicate writer/);
  const foreign = fixture();
  const after = change(foreign.match, draft => ({ ...draft, resources: { ...draft.resources,
    players: draft.resources.players.map((player, i) => i ? player :
      { ...player, runePool: { ...player.runePool, energy: 1 } }) } }));
  const bad = staged(ctx, { kind: 'non-resource', mutationId: 'foreign' }, [], () => after);
  assert.throws(() => bad.accept(), /parent|branch|identity|source/);
  assert.throws(() => appendDuelResourceReadinessEventV2({}, ctx.authority, bad.commit.commitId), /writer/);
  assert.throws(() => appendDuelResourceReadinessEventV2(ctx.writer, foreign.authority, bad.commit.commitId), /foreign/);
  channel(ctx);
  assert.throws(() => appendDuelResourceReadinessEventV2(ctx.writer, ctx.authority, ctx.parentId), /parent|branch/);
});

test('real channel, activation, effect, Awaken, payment and reset replay with independent proofs', () => {
  const ctx = fixture();
  channel(ctx);
  const uid = ctx.match.resources.bases[0].baseRunes[0].uid;
  staged(ctx, { kind: 'command', commandId: 'energy', actor: 'alice' },
    [{ kind: 'rune-energy', playerId: 'alice', uid }],
    before => change(before, draft => ({ ...draft, resources: activateBasicRuneEnergy(
      draft.resources, 'alice', uid,
      { stateOpen: true, priorityPlayerId: 'alice', resourcePaymentPlayerId: null }) }))).accept();
  const source = effectSource(ctx, 'grant');
  staged(ctx, source, [{ kind: 'pool-delta', playerId: 'alice', pool: 'energy', delta: 2,
    consumptionId: 'grant-use' }], before => change(before, draft => ({ ...draft,
      resources: { ...draft.resources, players: draft.resources.players.map((p, i) => i ? p :
        { ...p, runePool: { ...p.runePool, energy: p.runePool.energy + 2 } }) } })),
  { consumptionIds: ['grant-use'] }).accept();
  staged(ctx, effectSource(ctx, 'awaken'),
    [{ kind: 'readiness', playerId: 'alice', tokenKind: 'rune', uid, from: false, to: true }],
    before => change(before, draft => ({ ...draft,
      resources: { ...draft.resources, bases: draft.resources.bases.map((b, i) => i ? b :
        { ...b, baseRunes: b.baseRunes.map(r => r.uid === uid ? { ...r, readied: true } : r) }) } }))).accept();
  const cost = { energy: 2, power: [] }, plan = { power: [] };
  staged(ctx, { kind: 'non-resource', mutationId: 'open-payment' }, [], before => {
    return commitDuelPlayingMutationV2(before, draft => ({
      match: { ...draft, legendStates: Object.fromEntries(Object.entries(draft.legendStates)
        .map(([legendUID, state]) => [legendUID, { ...state, readiness: 'ready' }])),
        frame: { ...draft.frame, phase: 'main', pendingPayment: {
        paymentId: 'payment:one', actor: 'alice', resolvedCost: cost,
        sourceReference: { kind: 'card', referenceId: 'card:one', sourceUID: 'alice-main-0' },
      } } }, transitions: [],
    }));
  }).accept();
  staged(ctx, { kind: 'payment', paymentId: 'payment:one', sourceProofId: 'proof:payment',
    sourceUID: 'alice-main-0', sourceZoneEpoch: ctx.match.physicalCardsByUID['alice-main-0'].zoneEpoch,
    actor: 'alice', costDigest: digestDuelResourcePaymentV2(cost, plan) },
  [{ kind: 'pay', playerId: 'alice', paymentId: 'payment:one', energy: 2, power: [] }],
  before => change(before, draft => ({ ...draft, frame: { ...draft.frame, pendingPayment: null },
    resources: payDuelRuneCost(draft.resources, 'alice', cost,
      { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: 'alice' }, plan).resources })),
  { resolvedCost: cost, plan }).accept();
  const { journal, head } = sealDuelResourceReadinessJournalV2(ctx.writer);
  assert.equal(journal.events.length, 6);
  assert.deepEqual(replayDuelResourceReadinessJournalV2(clone(journal), clone(head)).resources,
    ctx.match.resources);
  const candidate = clone(ctx.match);
  assert.doesNotThrow(() => assertDuelResourceReadinessProofV2(journal, head, candidate));
  const shuffled = clone(journal);
  shuffled.genesis.resources = Object.fromEntries(Object.entries(shuffled.genesis.resources).reverse());
  assert.doesNotThrow(() => replayDuelResourceReadinessJournalV2(shuffled, head));
  candidate.resources.players[0].runePool.energy = 7;
  assert.throws(() => assertDuelResourceReadinessProofV2(journal, head, candidate));
  assert.throws(() => sealDuelResourceReadinessJournalV2(ctx.writer), /sealed/);
});

test('independent source proof, actor, turn boundary, duplicates and uncertain input fail closed', () => {
  const ctx = fixture();
  const source = effectSource(ctx, 'fake');
  const fake = staged(ctx, source, [{ kind: 'pool-delta', playerId: 'alice', pool: 'energy',
    delta: 1, consumptionId: 'use:one' }], before => change(before, draft => ({ ...draft,
      resources: { ...draft.resources, players: draft.resources.players.map((p, i) => i ? p :
        { ...p, runePool: { ...p.runePool, energy: 1 } }) } })),
  { sourceProofId: 'ledger:other', consumptionIds: ['use:one'] });
  assert.throws(() => fake.accept(), /proof/);
  fake.proof.sourceProofId = source.sourceProofId;
  fake.proof.consumptionIds = ['different-use'];
  assert.throws(() => fake.accept(), /consumption/);
  fake.proof.consumptionIds = ['use:one'];
  fake.accept();
  const retry = staged(ctx, effectSource(ctx, 'retry'), [{ kind: 'pool-delta', playerId: 'alice',
    pool: 'energy', delta: 1, consumptionId: 'use:one' }], before => change(before, draft => ({
      ...draft, resources: { ...draft.resources, players: draft.resources.players.map((p, i) => i ? p :
        { ...p, runePool: { ...p.runePool, energy: 2 } }) } })), { consumptionIds: ['use:one'] });
  assert.throws(() => retry.accept(), /duplicate consumption/);
  channel(ctx, 'turn:actor-check');
  const activatedUID = ctx.match.resources.bases[0].baseRunes[0].uid;
  const wrongActor = staged(ctx, { kind: 'command', commandId: 'wrong', actor: 'bob' },
    [{ kind: 'rune-energy', playerId: 'alice', uid: activatedUID }],
    before => change(before, draft => ({ ...draft, resources: activateBasicRuneEnergy(
      draft.resources, 'alice', activatedUID,
      { stateOpen: true, priorityPlayerId: 'alice', resourcePaymentPlayerId: null }) })));
  assert.throws(() => wrongActor.accept(), /actor/);
  const fiction = staged(ctx, { kind: 'turn', stepId: 'fiction', actor: 'alice', boundary: 'main-reset' },
    [{ kind: 'reset-pools' }], before => change(before, draft => ({ ...draft,
      resources: clearAllDuelRunePools(draft.resources) })));
  assert.throws(() => fiction.accept(), /transition|boundary/);
  const { journal, head } = sealDuelResourceReadinessJournalV2(ctx.writer);
  for (const field of ['stepId', 'eventId', 'sourceProofId', 'consumptionId']) {
    const altered = clone(journal);
    const event = altered.events.at(-1);
    if (field === 'consumptionId') event.actions[0].consumptionId = 'use:one';
    else if (field === 'stepId') event.source = { kind: 'turn', stepId: 'fiction',
      actor: 'alice', boundary: 'channel' };
    else event.source[field] = field === 'eventId' ? 'effect:fake' : 'proof:fake';
    if (field !== 'stepId') assert.throws(() => replayDuelResourceReadinessJournalV2(altered, head));
  }
  const candidate = clone(ctx.match);
  let called = false;
  Object.defineProperty(candidate.resources, 'bases', { get() { called = true; throw Error('getter'); } });
  assert.throws(() => assertDuelResourceReadinessProofV2(journal, head, candidate), /descriptor/);
  assert.equal(called, false);
  assert.throws(() => assertDuelResourceReadinessProofV2(journal, head,
    { ...clone(ctx.match), resources: new Proxy(clone(ctx.match.resources), {}) }), /proxy/);
});

function openPayment(ctx, sourceUID, paymentId = 'payment:source') {
  const cost = { energy: 0, power: [] }, plan = { power: [] };
  const sourceReference = { kind: 'card', referenceId: `card:${paymentId}`, sourceUID };
  staged(ctx, { kind: 'non-resource', mutationId: `open:${paymentId}` }, [], before =>
    change(before, draft => ({ ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates)
        .map(([uid, state]) => [uid, { ...state, readiness: 'ready' }])),
      frame: { ...draft.frame, phase: 'main', pendingPayment: {
        paymentId, actor: 'alice', resolvedCost: cost, sourceReference,
      } },
    }))).accept();
  return { cost, plan, sourceReference };
}
function zeroPayment(ctx, paymentId, sourceUID, sourceZoneEpoch, cost, plan, proofPatch = {}) {
  return staged(ctx, { kind: 'payment', paymentId, sourceProofId: `proof:${paymentId}`,
    sourceUID, sourceZoneEpoch, actor: 'alice',
    costDigest: digestDuelResourcePaymentV2(cost, plan) },
  [{ kind: 'pay', playerId: 'alice', paymentId, energy: 0, power: [] }],
  before => change(before, draft => ({ ...draft,
    frame: { ...draft.frame, pendingPayment: null } })),
  { resolvedCost: cost, plan, ...proofPatch });
}

test('payment source proof is bound to the exact canonical pending source reference', () => {
  const ctx = fixture();
  const expectedUID = ctx.match.players[0].hand[0].uid;
  const otherUID = ctx.match.players[0].hand[1].uid;
  assert.notEqual(expectedUID, otherUID);
  assert.equal(ctx.match.physicalCardsByUID[expectedUID].zoneEpoch,
    ctx.match.physicalCardsByUID[otherUID].zoneEpoch);
  const { cost, plan, sourceReference } = openPayment(ctx, expectedUID);
  const wrong = zeroPayment(ctx, 'payment:source', otherUID,
    ctx.match.physicalCardsByUID[otherUID].zoneEpoch, cost, plan);
  assert.throws(() => wrong.accept(), /canonical pending source reference/);
  wrong.commit.event.source.sourceUID = expectedUID;
  wrong.proof.sourceUID = expectedUID;
  wrong.proof.sourceReference = { ...sourceReference, referenceId: 'card:unrelated' };
  assert.throws(() => wrong.accept(), /canonical pending source reference/);
  wrong.proof.sourceReference = sourceReference;
  assert.equal(wrong.accept().eventCount, 2);
});

test('independent source ledger permits a proved pre-exit payment epoch', () => {
  const ctx = fixture();
  const card = ctx.match.players[0].hand[0], uid = card.uid;
  const sourceZoneEpoch = ctx.match.physicalCardsByUID[uid].zoneEpoch;
  staged(ctx, { kind: 'non-resource', mutationId: 'pre-exit:source' }, [], before =>
    commitDuelPlayingMutationV2(before, draft => ({
      match: { ...draft, players: draft.players.map(player => player.playerId !== 'alice'
        ? player : { ...player, hand: player.hand.filter(item => item.uid !== uid),
          remainingMainDeck: [...player.remainingMainDeck, card] }) },
      transitions: [{ uid, from: { kind: 'hand', zonePlayerId: 'alice' },
        to: { kind: 'main-deck', zonePlayerId: 'alice' } }],
    }))).accept();
  assert.equal(ctx.match.physicalCardsByUID[uid].zoneEpoch, sourceZoneEpoch + 1);
  const { cost, plan } = openPayment(ctx, uid, 'payment:pre-exit');
  assert.equal(zeroPayment(ctx, 'payment:pre-exit', uid, sourceZoneEpoch, cost, plan)
    .accept().eventCount, 3);
});

test('unknown source proof fails without advancing; distinct proved effects may share a source UID', () => {
  const ctx = fixture();
  for (let n = 1; n <= 2; n++) {
    const source = effectSource(ctx, `fanout:${n}`);
    const pending = staged(ctx, source, [{ kind: 'pool-delta', playerId: 'alice',
      pool: 'energy', delta: 1, consumptionId: `use:${n}` }], before =>
      change(before, draft => ({ ...draft, resources: { ...draft.resources,
        players: draft.resources.players.map((player, i) => i ? player :
          { ...player, runePool: { ...player.runePool, energy: n } }) } })),
    { consumptionIds: [`use:${n}`] });
    if (n === 1) {
      ctx.proofs.delete(pending.proof.revision);
      assert.throws(() => pending.accept(), /independent source proof/);
      ctx.proofs.set(pending.proof.revision, pending.proof);
    }
    assert.equal(pending.accept().eventCount, n);
  }
});

for (const provider of ['outer', 'source']) {
  test(`${provider} provider reentry, even when swallowed, leaves failed append unchanged`, () => {
    let ctx, reenter = true, nestedError;
    const callback = () => {
      if (!reenter) return;
      reenter = false;
      try { appendDuelResourceReadinessEventV2(ctx.writer, ctx.authority, 'commit:1'); }
      catch (error) { nestedError = error; }
    };
    ctx = fixture(provider === 'outer' ? { outerLookup: callback } : { sourceLookup: callback });
    const pending = staged(ctx, { kind: 'non-resource', mutationId: `reentry:${provider}` }, [],
      before => change(before, draft => ({ ...draft,
        legendStates: Object.fromEntries(Object.entries(draft.legendStates)
          .map(([uid, state]) => [uid, { ...state, readiness: 'ready' }])),
      })));
    assert.throws(() => pending.accept(), /writer reentry attempted/);
    assert.match(String(nestedError), /writer reentry/);
    const { journal, head } = sealDuelResourceReadinessJournalV2(ctx.writer);
    assert.equal(head.eventCount, 0);
    assert.equal(head.stateVersion, ctx.match.stateVersion);
    assert.deepEqual(journal.events, []);
  });
}

test('provider cannot seal and swallow the error to let an append publish', () => {
  let ctx, nestedError, reenter = true;
  ctx = fixture({ sourceLookup: () => {
    if (!reenter) return;
    reenter = false;
    try { sealDuelResourceReadinessJournalV2(ctx.writer); }
    catch (error) { nestedError = error; }
  } });
  const pending = staged(ctx, { kind: 'non-resource', mutationId: 'seal-reentry' }, [],
    before => change(before, draft => ({ ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates)
        .map(([uid, state]) => [uid, { ...state, readiness: 'ready' }])),
    })));
  assert.throws(() => pending.accept(), /writer reentry attempted/);
  assert.match(String(nestedError), /writer reentry during seal/);
  assert.equal(pending.accept().eventCount, 1);
});

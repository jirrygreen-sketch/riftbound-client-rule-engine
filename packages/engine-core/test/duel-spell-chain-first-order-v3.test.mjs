import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelOfficialProgramRegistry, duelAbilitySourceFromCatalog, DUEL_PREMONITION_REACTION_TEXT } from '@riftbound/card-dsl/duel';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2, adoptAdmittedDuelPlayingSessionV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2 } from '../dist/duel/core-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from '../dist/duel/cost-resolver-v2.js';
import {
  createDuelSpellCardPlaySessionV2, playDuelSpellCardV2, applyDuelSpellResourceCommandV2,
  finalizeDuelSpellCardPlayV2, passDuelSpellPriorityV2, resolveDuelSpellCardPlayV2,
  resumeDuelSpellChainFirstV3, resumeDuelSpellPaymentV2, inspectDuelSpellPrivateStateV2,
} from '../dist/duel/cardplay-spell-v2.js';

// Synthetic Core-admitted setup for the Chain-first preparation contract. It
// is intentionally not a public/full-match catalog or server fixture.
const printing = {
  id: 'fixture-chain-first-draw', cardType: 'Spell', ability: 'Draw 4.', energy: 1,
  power: null, might: null, domains: [], tags: [], canonicalCardId: 'fixture-chain-first-draw',
  name: 'Chain First Draw', fullName: 'Chain First Draw', localizedName: 'Chain First Draw',
  setCode: 'TST', cardNumber: 'CF1', variant: 'normal',
};
const reactionPrinting = { ...printing, id: 'fixture-chain-first-reaction', canonicalCardId: 'fixture-chain-first-reaction',
  ability: DUEL_PREMONITION_REACTION_TEXT, name: 'Chain First Reaction', fullName: 'Chain First Reaction',
  localizedName: 'Chain First Reaction', cardNumber: 'CF2' };
const catalog = { dataVersion: 'chain-first-fixture-v3', digest: 'chain-first-digest-v3', cards: [printing, reactionPrinting] };
const registry = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog(catalog));
const card = (uid, cardId = 'unit-card') => ({ uid, cardId });
const seats = ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 11 }, (_, index) => card(`${playerId}:deck:${index}`, playerId === 'alice' ? printing.id : 'unit-card')),
  champion: card(`${playerId}:champion`, `${playerId}:champion`),
  legend: card(`${playerId}:legend`, `${playerId}:legend`),
  runeDeck: Array.from({ length: 6 }, (_, index) => ({ ...card(`${playerId}:rune:${index}`, `${playerId}:rune:${index}`), domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, index) => ({ instanceId: `${playerId}:field:${index}`, cardId: `${playerId}:battlefield:${index}` })),
}));
const metadata = { matchId: 'chain-first-order-v3-fixture', dataVersion: catalog.dataVersion,
  catalogDigest: catalog.digest, roster: ['alice', 'bob'].map(playerId => ({ playerId, displayName: playerId })) };
const typeOf = id => [printing.id, reactionPrinting.id].includes(id) ? 'Other' : id.includes('champion') ? 'Champion' :
  id.includes('legend') ? 'Legend' : id.includes('rune') ? 'Rune' : id.includes('field') ? 'Battlefield' : 'Unit';

function admitted(seatInput = seats, aliceRuneCount = 1, bobRuneCount = 0) {
  let session = createDuelCommandSessionV2(seatInput, metadata, () => 0, typeOf);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan:${actor}`,
      expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  let match = channelDuelRunesV2(session.match, 'alice', aliceRuneCount);
  if (bobRuneCount) match = channelDuelRunesV2(match, 'bob', bobRuneCount);
  match = commitDuelPlayingMutationV2(match, draft => ({ match: {
    ...draft, legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' },
  }, transitions: [] }));
  return { match, session: adoptAdmittedDuelPlayingSessionV2(match) };
}

function services(match, edit = {}) {
  const source = match.players[0].hand[0];
  let resolveCalls = 0, authorityFactoryCalls = 0;
  const commandReceipts = new Map();
  const committed = new Map();
  const service = {
    programs: registry, cardPlayOrder: 'chain-first-v3',
    cost: createDuelCostResolverAuthorityV2(() => { throw Error('legacy cost must not be used'); }, () => {
      throw Error('legacy verifier must not be used');
    }),
    costForChain: request => {
      authorityFactoryCalls++;
      assert.equal(request.match.chainCards.some(value => value.uid === request.cardUID), true);
      assert.equal(request.match.frame.stateOpen, false);
      assert.equal(request.match.physicalCardsByUID[request.cardUID].zoneEpoch, request.sourceEpoch);
      const epoch = request.sourceEpoch;
      const facts = { registryRevision: 'chain-first-r1', catalogRevision: catalog.digest,
        nonResourceCosts: 'none', base: { cost: { energy: 1, power: [] }, sourceUid: request.cardUID, sourceEpoch: epoch },
        candidates: [], orderedModifiers: [] };
      const coverage = fingerprintDuelCostCoverageV2(facts);
      return createDuelCostResolverAuthorityV2(costRequest => {
        resolveCalls++;
        if (edit.unknownCost && edit.unknownCost() === true) throw Error('cost source unavailable');
        return { request: costRequest,
          base: { request: costRequest, cost: facts.base.cost, proofId: `chain-base:${costRequest.transactionId}`,
            status: 'complete', sourceUid: facts.base.sourceUid, sourceEpoch: epoch,
            registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision },
          coverage: { request: costRequest, proofId: `chain-coverage:${costRequest.transactionId}`,
            status: 'complete', allModifierSourcesCovered: true, choicesResolved: true,
            nonResourceCosts: 'none', registryRevision: facts.registryRevision,
            catalogRevision: facts.catalogRevision, ...coverage }, proofs: [], modifiers: [] };
      }, () => facts);
    },
    costBinding: request => {
      if (edit.bindingThrow?.() === true) throw Error('binding unavailable');
      assert.equal(request.sourceEpoch, match.physicalCardsByUID[request.uid].zoneEpoch + 1);
      return { ...request, status: 'complete' };
    },
    sourceAttestor: request => {
      edit.sourceAttestor?.(request);
      assert.equal(request.match.chainCards.some(value => value.uid === request.sourceReference.sourceUID), true);
      assert.equal(request.match.frame.stateOpen, false);
      const sourceCard = request.match.physicalCardsByUID[request.sourceReference.sourceUID];
      return { matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
        sourceReference: request.sourceReference, sourceProofId: `source:${request.paymentId}`,
        mode: 'current', sourceZoneEpoch: sourceCard.zoneEpoch,
        ...(request.taskId ? { taskId: request.taskId } : {}),
        ...(request.continuationId ? { continuationId: request.continuationId } : {}) };
    },
    dispatcher: {
      claim: request => {
        const key = `${request.actor}:${request.commandId}`;
        const prior = commandReceipts.get(key);
        if (prior) return prior.fingerprint === request.payloadFingerprint ? { status: 'duplicate', outcome: prior.outcome } : { status: 'conflict' };
        const claim = { key }; commandReceipts.set(key, { fingerprint: request.payloadFingerprint, claim });
        return { status: 'new', claim };
      },
      finish: request => { for (const row of commandReceipts.values()) if (row.claim === request.claim) row.outcome = request.outcome; },
      readCommitted: ticket => committed.get(ticket.idempotencyKey) ?? null,
      commitEffect: request => { committed.set(request.ticket.idempotencyKey, request.receipt); },
    },
    closure: { draw: { randomIndex: bound => bound - 1 } },
  };
  return { service, get resolveCalls() { return resolveCalls; },
    get authorityFactoryCalls() { return authorityFactoryCalls; } };
}

function playFixture(edit = {}) {
  const { match, session: base } = admitted();
  const fixture = services(match, edit);
  const action = createDuelSpellCardPlaySessionV2(base, fixture.service);
  const uid = match.players[0].hand[0].uid;
  const result = playDuelSpellCardV2(action, 'alice', { commandId: 'chain-first-play',
    expectedVersion: match.stateVersion, command: { cardUID: uid } });
  return { match, fixture, uid, result };
}

function payChainFirst(result, actor, commandId) {
  let current = applyDuelSpellResourceCommandV2(result.session, actor, {
    commandId: `${commandId}:energy`, expectedVersion: result.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: result.session.commandSession.match.resources.bases
      .find(base => base.playerId === actor).baseRunes.find(rune => rune.readied).uid },
  });
  assert.equal(current.outcome.status, 'pending');
  current = applyDuelSpellResourceCommandV2(current.session, actor, {
    commandId: `${commandId}:pay`, expectedVersion: current.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: `spell-payment:${JSON.stringify([actor, commandId])}` },
  });
  assert.equal(current.outcome.status, 'pending');
  return finalizeDuelSpellCardPlayV2(current.session, actor);
}

test('fixture Chain-first order moves the real Spell before target/cost/payment and preserves Core epochs', () => {
  const { match, fixture, uid, result } = playFixture();
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.outcome.step, 'payment');
  assert.equal(result.session.commandSession.match.players[0].hand.some(value => value.uid === uid), false);
  assert.equal(result.session.commandSession.match.chainCards.some(value => value.uid === uid), true);
  assert.equal(result.session.commandSession.match.frame.stateOpen, false);
  assert.equal(result.session.commandSession.match.physicalCardsByUID[uid].zoneEpoch,
    match.physicalCardsByUID[uid].zoneEpoch + 1);
  assert.equal(fixture.resolveCalls, 1);
  assert.equal(result.session.commandSession.requiredTasks.length, 1);
  assert.equal(result.session.commandSession.match.frame.pendingPayment.paymentId,
    `spell-payment:${JSON.stringify(['alice', 'chain-first-play'])}`);
});

test('Chain-first permits a finalized prefix plus two and three real Reaction items and resolves LIFO', () => {
  const reactionSeats = seats.map(seat => ({ ...seat,
    mainDeck: Array.from({ length: 11 }, (_, index) => card(`${seat.playerId}:chain-reaction:${index}`,
      seat.playerId === 'alice' ? (index === 1 ? printing.id : reactionPrinting.id) :
        (index === 2 ? printing.id : reactionPrinting.id))),
  }));
  const { match, session: base } = admitted(reactionSeats, 2, 1);
  const fixture = services(match);
  const action = createDuelSpellCardPlaySessionV2(base, fixture.service);
  const aliceDraw = match.players[0].hand.find(value => value.cardId === printing.id);
  let current = playDuelSpellCardV2(action, 'alice', { commandId: 'chain-head', expectedVersion: match.stateVersion,
    command: { cardUID: aliceDraw.uid } });
  current = payChainFirst(current, 'alice', 'chain-head');
  current = passDuelSpellPriorityV2(current.session, 'alice');
  const bobHand = current.session.commandSession.match.players[1].hand;
  const bobOrdinary = bobHand.find(value => value.cardId === printing.id);
  const denied = playDuelSpellCardV2(current.session, 'bob', { commandId: 'ordinary-response-denied',
    expectedVersion: current.session.commandSession.match.stateVersion, command: { cardUID: bobOrdinary.uid } });
  assert.deepEqual(denied.outcome, { status: 'rejected', reason: 'no-permission' });
  assert.strictEqual(denied.session, current.session);
  assert.equal(current.session.chain.items.length, 1);
  const bobReaction = bobHand.find(value => value.cardId === reactionPrinting.id);
  current = playDuelSpellCardV2(current.session, 'bob', { commandId: 'reaction-one',
    expectedVersion: current.session.commandSession.match.stateVersion, command: { cardUID: bobReaction.uid } });
  current = payChainFirst(current, 'bob', 'reaction-one');
  current = passDuelSpellPriorityV2(current.session, 'bob');
  const aliceReaction = current.session.commandSession.match.players[0].hand.find(value => value.cardId === reactionPrinting.id);
  current = playDuelSpellCardV2(current.session, 'alice', { commandId: 'reaction-two',
    expectedVersion: current.session.commandSession.match.stateVersion, command: { cardUID: aliceReaction.uid } });
  current = payChainFirst(current, 'alice', 'reaction-two');
  assert.equal(current.session.chain.items.length, 3);
  current = passDuelSpellPriorityV2(current.session, 'alice');
  current = passDuelSpellPriorityV2(current.session, 'bob');
  current = resolveDuelSpellCardPlayV2(current.session, 'alice');
  assert.equal(current.outcome.status, 'applied');
  assert.equal(current.session.chain.items.length, 2);
  current = passDuelSpellPriorityV2(current.session, 'bob');
  current = passDuelSpellPriorityV2(current.session, 'alice');
  current = resolveDuelSpellCardPlayV2(current.session, 'bob');
  assert.equal(current.outcome.status, 'applied');
  assert.equal(current.session.chain.items.length, 1);
  current = passDuelSpellPriorityV2(current.session, 'alice');
  current = passDuelSpellPriorityV2(current.session, 'bob');
  current = resolveDuelSpellCardPlayV2(current.session, 'alice');
  assert.equal(current.outcome.status, 'applied');
  assert.equal(current.session.chain.items.length, 0);
});

test('unknown Chain-first cost resumes on the same closed Chain without a fake zero task or second choice', () => {
  let unavailable = true;
  const first = playFixture({ unknownCost: () => { const value = unavailable; unavailable = false; return value; } });
  assert.equal(first.result.outcome.status, 'pending');
  assert.equal(first.result.outcome.taskId, undefined);
  assert.equal(first.result.session.commandSession.requiredTasks.length, 0);
  assert.equal(first.result.session.commandSession.match.frame.pendingPayment, null);
  const before = first.result.session.commandSession.match;
  const resumed = resumeDuelSpellChainFirstV3(first.result.session);
  assert.equal(resumed.outcome.status, 'pending');
  assert.equal(resumed.outcome.taskId, `spell-task:${JSON.stringify(['alice', 'chain-first-play'])}`);
  assert.notEqual(resumed.session.commandSession.match.stateVersion, before.stateVersion);
  assert.equal(resumed.session.commandSession.match.chainCards[0].uid, before.chainCards[0].uid);
  assert.equal(resumed.session.commandSession.match.physicalCardsByUID[first.uid].zoneEpoch,
    before.physicalCardsByUID[first.uid].zoneEpoch);
  assert.equal(first.fixture.resolveCalls, 2);
  assert.equal(first.fixture.authorityFactoryCalls, 2,
    'an immutable unknown authority is not cached before successful resolution');
});

test('legacy Hand-first private observation preserves its original own-key shape', () => {
  const { match, session: base } = admitted();
  const fixture = services(match);
  const action = createDuelSpellCardPlaySessionV2(base, { ...fixture.service, cardPlayOrder: 'hand-first-v2' });
  const snapshot = inspectDuelSpellPrivateStateV2(action);
  assert.equal(Object.hasOwn(snapshot, 'pendingChainFirst'), false);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(snapshot)), 'pendingChainFirst'), false);
});

test('Chain-first binding throw caches the complete resolver proof and retries binding without re-resolving', () => {
  let throws = true;
  const first = playFixture({ bindingThrow: () => { const value = throws; throws = false; return value; } });
  assert.equal(first.result.outcome.status, 'pending');
  assert.equal(first.result.session.commandSession.requiredTasks.length, 0);
  const privateState = inspectDuelSpellPrivateStateV2(first.result.session);
  assert.equal(privateState.pendingChainFirst.resolved.finalResolvedCost.energy, 1);
  const resumed = resumeDuelSpellChainFirstV3(first.result.session);
  assert.equal(resumed.outcome.status, 'pending');
  assert.equal(resumed.session.commandSession.requiredTasks.length, 1);
  assert.equal(first.fixture.resolveCalls, 1);
});

test('fixture payment and existing priority/effect/Trash path remain reusable after Chain-first preparation', () => {
  const { match, result, uid } = playFixture();
  let current = result;
  const rune = current.session.commandSession.match.resources.bases[0].baseRunes.find(value => value.readied).uid;
  current = applyDuelSpellResourceCommandV2(current.session, 'alice', { commandId: 'chain-first-energy',
    expectedVersion: current.session.commandSession.match.stateVersion, command: { type: 'rune-energy', uid: rune } });
  current = applyDuelSpellResourceCommandV2(current.session, 'alice', { commandId: 'chain-first-pay',
    expectedVersion: current.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: `spell-payment:${JSON.stringify(['alice', 'chain-first-play'])}` } });
  current = finalizeDuelSpellCardPlayV2(current.session, 'alice');
  current = passDuelSpellPriorityV2(current.session, 'alice');
  current = passDuelSpellPriorityV2(current.session, 'bob');
  current = resolveDuelSpellCardPlayV2(current.session, 'alice');
  assert.equal(current.outcome.status, 'applied');
  assert.equal(current.session.commandSession.match.chainCards.length, 0);
  assert.equal(current.session.commandSession.match.players[0].trash.some(value => value.uid === uid), true);
  assert.equal(current.session.commandSession.match.physicalCardsByUID[uid].zoneEpoch,
    match.physicalCardsByUID[uid].zoneEpoch + 2);
});

test('Chain-first keeps actor/version and process-local clone boundaries before physical admission', () => {
  const { match, session: base } = admitted();
  const fixture = services(match);
  const action = createDuelSpellCardPlaySessionV2(base, fixture.service);
  const uid = match.players[0].hand[0].uid;
  const wrongActor = playDuelSpellCardV2(action, 'bob', { commandId: 'wrong-actor',
    expectedVersion: match.stateVersion, command: { cardUID: uid } });
  assert.deepEqual(wrongActor.outcome, { status: 'rejected', reason: 'no-permission' });
  const stale = playDuelSpellCardV2(action, 'alice', { commandId: 'stale-chain-first',
    expectedVersion: match.stateVersion - 1, command: { cardUID: uid } });
  assert.deepEqual(stale.outcome, { status: 'rejected', reason: 'stale-version' });
  const ready = playDuelSpellCardV2(action, 'alice', { commandId: 'clone-chain-first',
    expectedVersion: match.stateVersion, command: { cardUID: uid } });
  assert.throws(() => resumeDuelSpellChainFirstV3(structuredClone(ready.session)), /unadmitted Spell session/);
});

test('reentrant Chain-first cost provider is poisoned and cannot install a task or payment', () => {
  const { match, session: base } = admitted();
  const fixture = services(match);
  const action = createDuelSpellCardPlaySessionV2(base, fixture.service);
  const uid = match.players[0].hand[0].uid;
  const envelope = { commandId: 'reentrant-chain-first', expectedVersion: match.stateVersion,
    command: { cardUID: uid } };
  const trusted = fixture.service.costForChain;
  fixture.service.costForChain = request => {
    assert.throws(() => playDuelSpellCardV2(action, 'alice', envelope), /reentrant command/);
    return trusted(request);
  };
  const result = playDuelSpellCardV2(action, 'alice', envelope);
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.session.commandSession.requiredTasks.length, 0);
  assert.equal(result.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(inspectDuelSpellPrivateStateV2(result.session).poisoned, true);
});

test('issue source-attestor reentry is rejected before the required task can commit', () => {
  const { match, session: base } = admitted();
  let action;
  const fixture = services(match, { sourceAttestor: () => {
    assert.throws(() => playDuelSpellCardV2(action, 'alice', {
      commandId: 'issue-reentry', expectedVersion: match.stateVersion,
      command: { cardUID: match.players[0].hand[0].uid },
    }), /reentrant command/);
  } });
  action = createDuelSpellCardPlaySessionV2(base, fixture.service);
  const result = playDuelSpellCardV2(action, 'alice', { commandId: 'issue-reentry', expectedVersion: match.stateVersion,
    command: { cardUID: match.players[0].hand[0].uid } });
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.session.commandSession.requiredTasks.length, 0);
  assert.equal(result.session.commandSession.match.frame.pendingPayment, null);
  assert.equal(result.session.commandSession.match.chainCards.length, 1);
  assert.equal(inspectDuelSpellPrivateStateV2(result.session).poisoned, true);
});

test('prepare source-attestor reentry retains the issued continuation and resumes without ghost payment', () => {
  const { match, session: base } = admitted();
  let action, calls = 0;
  const fixture = services(match, { sourceAttestor: () => {
    calls++;
    if (calls === 2) assert.throws(() => playDuelSpellCardV2(action, 'alice', {
      commandId: 'prepare-reentry', expectedVersion: match.stateVersion,
      command: { cardUID: match.players[0].hand[0].uid },
    }), /reentrant command/);
  } });
  action = createDuelSpellCardPlaySessionV2(base, fixture.service);
  const first = playDuelSpellCardV2(action, 'alice', { commandId: 'prepare-reentry', expectedVersion: match.stateVersion,
    command: { cardUID: match.players[0].hand[0].uid } });
  assert.equal(first.outcome.status, 'pending');
  assert.equal(first.session.commandSession.requiredTasks.length, 1);
  assert.equal(first.session.commandSession.requiredTasks[0].status, 'issued');
  assert.equal(first.session.commandSession.match.frame.pendingPayment, null);
  const resumed = resumeDuelSpellPaymentV2(first.session);
  assert.equal(resumed.outcome.status, 'pending');
  assert.equal(resumed.outcome.step, 'payment');
  assert.equal(resumed.session.commandSession.requiredTasks[0].status, 'active');
  assert.equal(resumed.session.commandSession.match.frame.pendingPayment.paymentId,
    first.session.commandSession.requiredTasks[0].paymentId);
  assert.equal(resumed.session.commandSession.match.chainCards.length, 1);
  assert.equal(resumed.session.chain.items.length, 1);
});


test('Chain-first rejects an illegal submitted target before movement, while legal choices bind after Chain entry', () => {
  const { match, session: base } = admitted();
  const fixture = services(match);
  const action = createDuelSpellCardPlaySessionV2(base, fixture.service);
  const uid = match.players[0].hand[0].uid;
  const rejected = playDuelSpellCardV2(action, 'alice', {
    commandId: 'parent-illegal-target-admission', expectedVersion: match.stateVersion,
    command: { cardUID: uid, targetUIDs: ['not-a-legal-draw-target'] },
  });
  assert.deepEqual(rejected.outcome, { status: 'rejected', reason: 'illegal-target' });
  assert.strictEqual(rejected.session.commandSession.match, match);
  assert.equal(rejected.session.commandSession.requiredTasks.length, 0);
  assert.equal(match.chainCards?.length ?? 0, 0);
  assert.equal(match.players[0].hand.some(card => card.uid === uid), true);
  assert.equal(fixture.resolveCalls, 0);
});

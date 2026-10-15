import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelOfficialProgramRegistry, duelAbilitySourceFromCatalog, DUEL_PREMONITION_REACTION_TEXT } from
  '@riftbound/card-dsl/duel';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2, adoptAdmittedDuelPlayingSessionV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2, referenceDuelPhysicalCardV2, moveDuelPhysicalCardToChainV2 } from
  '../dist/duel/core-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from '../dist/duel/cost-resolver-v2.js';
import { placeDuelUnit } from '../dist/duel/battlefields.js';
import {
  createDuelSpellCardPlaySessionV2, playDuelSpellCardV2, applyDuelSpellResourceCommandV2,
  finalizeDuelSpellCardPlayV2, passDuelSpellPriorityV2, resolveDuelSpellCardPlayV2,
  submitDuelSpellTargetV2,
  resumeDuelSpellEffectV2, resumeDuelSpellPaymentV2,
  inspectDuelSpellResolutionBindingV2,
  inspectDuelSpellPrivateStateV2,
} from '../dist/duel/cardplay-spell-v2.js';
import { inspectDuelChainCommittedProofV2 } from '../dist/duel/chain-v2.js';

const draw = {
  id: 'fixture-draw4', cardType: 'Spell', ability: 'Draw 4.', energy: 1, power: null, might: null,
  domains: [], tags: [], canonicalCardId: 'fixture-draw4', name: 'Draw Four', fullName: 'Draw Four',
  localizedName: 'Draw Four', setCode: 'TST', cardNumber: '001', variant: 'normal',
};
const damage = {
  id: 'fixture-damage6', cardType: 'Spell', ability: 'Deal 6 to each of up to two units.',
  energy: 1, power: null, might: null, domains: [], tags: [], canonicalCardId: 'fixture-damage6',
  name: 'Damage Six', fullName: 'Damage Six', localizedName: 'Damage Six', setCode: 'TST',
  cardNumber: '002', variant: 'normal',
};
const kill = { ...damage, id: 'fixture-kill', canonicalCardId: 'fixture-kill', ability: 'Kill a unit.' };
const each = { ...damage, id: 'fixture-each', canonicalCardId: 'fixture-each', ability: 'Each player kills one of their units.' };
const reaction = { ...draw, id: 'fixture-reaction3', canonicalCardId: 'fixture-reaction3', ability: DUEL_PREMONITION_REACTION_TEXT };
const catalog = { dataVersion: 'fixture-v2', digest: 'fixture-digest', cards: [draw, damage, kill, each, reaction] };
const registry = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog(catalog));
const card = (uid, cardId = `unit-${uid}`) => ({ uid, cardId });
const makeSeats = (aliceSpellId = draw.id, bobSpellId) => ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: playerId === 'alice'
    ? Array.from({ length: 11 }, (_, i) => card(`${playerId}:spell:${i}`, aliceSpellId))
    : Array.from({ length: 11 }, (_, i) => bobSpellId ? card(`${playerId}:spell:${i}`, bobSpellId) : card(`${playerId}:deck:${i}`)),
  champion: card(`${playerId}:champion`), legend: card(`${playerId}:legend`),
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ ...card(`${playerId}:rune:${i}`), domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}:field:${i}`, cardId: `${playerId}:battlefield:${i}` })),
}));
const seats = makeSeats();
const metadata = { matchId: 'spell-cardplay-v2', dataVersion: catalog.dataVersion,
  catalogDigest: catalog.digest, roster: ['alice', 'bob'].map(playerId => ({ playerId, displayName: playerId })) };
const typeOf = id => catalog.cards.some(card => card.id === id) ? 'Other' : id.includes('champion') ? 'Champion' :
  id.includes('legend') ? 'Legend' : id.includes('rune') ? 'Rune' : id.includes('battlefield') ? 'Battlefield' : 'Unit';

function baseSession(seatInput = seats, bobRuneCount = 0) {
  let session = createDuelCommandSessionV2(seatInput, metadata, () => 0, typeOf);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, {
      commandId: `mulligan:${actor}`, expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] },
    });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  let match = channelDuelRunesV2(session.match, 'alice', 1);
  if (bobRuneCount) match = channelDuelRunesV2(match, 'bob', bobRuneCount);
  match = commitDuelPlayingMutationV2(match, draft => ({ match: {
    ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' },
  }, transitions: [] }));
  return { match, session: adoptAdmittedDuelPlayingSessionV2(match) };
}

function services(match, sourceCardId = draw.id, effectClosure = {}) {
  const sourceCard = match.players[0].hand.find(value => value.cardId === sourceCardId);
  const epoch = referenceDuelPhysicalCardV2(match, sourceCard.uid).zoneEpoch;
  const coverageFingerprints = fingerprintDuelCostCoverageV2({
    registryRevision: 'r1', catalogRevision: catalog.digest, nonResourceCosts: 'none',
    base: { cost: { energy: 1, power: [] }, sourceUid: sourceCard.uid, sourceEpoch: epoch },
    candidates: [], orderedModifiers: [],
  });
  const cost = createDuelCostResolverAuthorityV2(request => ({
    request, base: { request, cost: { energy: 1, power: [] }, proofId: 'base-proof', status: 'complete',
      sourceUid: sourceCard.uid, sourceEpoch: epoch, registryRevision: 'r1', catalogRevision: catalog.digest },
    coverage: { request, proofId: 'coverage-proof', status: 'complete', allModifierSourcesCovered: true,
      choicesResolved: true, nonResourceCosts: 'none', registryRevision: 'r1', catalogRevision: catalog.digest,
      ...coverageFingerprints }, proofs: [], modifiers: []
  }), request => ({ registryRevision: 'r1', catalogRevision: catalog.digest, nonResourceCosts: 'none',
    base: { cost: { energy: 1, power: [] }, sourceUid: sourceCard.uid, sourceEpoch: epoch }, candidates: [], orderedModifiers: [] }));
  const committed = new Map();
  const commandReceipts = new Map();
  return {
    programs: registry, cost,
    costBinding: request => ({ ...request, status: 'complete' }),
    sourceAttestor: request => ({
      matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: request.sourceReference, sourceProofId: 'source-proof', mode: 'current',
      sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      ...(request.continuationId ? { continuationId: request.continuationId } : {}),
    }),
    dispatcher: {
      claim: request => {
        const key = `${request.actor}:${request.commandId}`;
        const prior = commandReceipts.get(key);
        if (prior) return prior.fingerprint === request.payloadFingerprint
          ? { status: 'duplicate', outcome: prior.outcome } : { status: 'conflict' };
        const claim = { key }; commandReceipts.set(key, { fingerprint: request.payloadFingerprint, claim });
        return { status: 'new', claim };
      },
      finish: request => { for (const row of commandReceipts.values()) if (row.claim === request.claim) row.outcome = request.outcome; },
      readCommitted: ticket => committed.get(ticket.idempotencyKey) ?? null,
      commitEffect: request => { committed.set(request.ticket.idempotencyKey, request.receipt); },
    },
    closure: { draw: { randomIndex: bound => bound - 1 }, ...effectClosure },
  };
}

function responseServices(match) {
  const svc = services(match);
  const snapshot = request => {
    const [_matchId, _stateVersion, actor, _commandId, uid, sourceEpoch] = JSON.parse(request.transactionId);
    const physical = match.physicalCardsByUID[uid];
    assert.equal(physical.ownerPlayerId, actor);
    assert.equal(physical.zoneEpoch, sourceEpoch);
    const printing = catalog.cards.find(card => card.id === physical.cardId);
    assert.equal(printing.energy, 1); // Synthetic cost, not the official printed cost.
    return { registryRevision: 'r1', catalogRevision: catalog.digest, nonResourceCosts: 'none',
      base: { cost: { energy: 1, power: [] }, sourceUid: uid, sourceEpoch }, candidates: [], orderedModifiers: [] };
  };
  svc.cost = createDuelCostResolverAuthorityV2(request => {
    const facts = snapshot(request);
    return { request, base: { request, cost: facts.base.cost, proofId: `base:${request.transactionId}`,
      status: 'complete', sourceUid: facts.base.sourceUid, sourceEpoch: facts.base.sourceEpoch,
      registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision },
      coverage: { request, proofId: `coverage:${request.transactionId}`, status: 'complete',
        allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none',
        registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision,
        ...fingerprintDuelCostCoverageV2(facts) }, proofs: [], modifiers: [] };
  }, snapshot);
  svc.costBinding = request => {
    const facts = snapshot({ transactionId: request.transactionId });
    return { ...request, status: facts.base.sourceUid === request.uid && facts.base.sourceEpoch === request.sourceEpoch
      && request.baseProofId === `base:${request.transactionId}` && request.coverageProofId === `coverage:${request.transactionId}`
      ? 'complete' : 'unknown' };
  };
  return svc;
}

// Synthetic, Core-admitted board setup for target timing/lifetime tests. This
// does not stand in for an official catalog or public server playthrough.
function boardScene(sourceId = damage.id, includeAlice = false) {
  let { match } = baseSession(makeSeats(sourceId));
  const objects = [...match.players[1].hand.slice(0, 2).map(card => ({ ...card, owner: 'bob', from: 'hand' })),
    ...(includeAlice ? [{ ...match.players[0].champion, owner: 'alice', from: 'champion-zone' }] : [])];
  match = commitDuelPlayingMutationV2(match, draft => {
    let board = draft.board;
    for (const card of objects) board = placeDuelUnit(board, {
      objectId: card.uid, controllerPlayerId: card.owner,
      locationId: board.bases.find(base => base.ownerPlayerId === card.owner).locationId,
    });
    const selected = new Set(objects.map(card => card.uid));
    return { match: { ...draft, board,
      players: draft.players.map(player => ({ ...player,
        hand: player.hand.filter(card => !selected.has(card.uid)),
        champion: selected.has(player.champion?.uid) ? null : player.champion,
      })),
      unitMeta: Object.fromEntries(objects.map(card => [card.uid, {
        ownerPlayerId: card.owner, readied: false, damageMarks: [], trait: { kind: 'card', cardId: card.cardId },
      }])),
    }, transitions: objects.map(card => ({ uid: card.uid,
      from: { kind: card.from, zonePlayerId: card.owner },
      to: { kind: 'board-base', locationId: board.units.find(unit => unit.objectId === card.uid).locationId },
    })) };
  });
  return { match, session: adoptAdmittedDuelPlayingSessionV2(match), units: objects };
}
const killDamageClosure = {
  verifyCost: () => ({ status: 'approved', proofId: 'fixture-cost' }),
  verifyChain: () => ({ status: 'approved', proofId: 'fixture-chain', selectionTiming: 'finalization' }),
  resolveKill: ({ plan }) => ({ status: 'approved', proofId: 'fixture-kill',
    approvedUnitUIDs: plan.snapshots.map(unit => unit.objectId), targetLegality: 'approved',
    deathknell: 'resolved', replacements: 'resolved' }),
  resolveDamage: ({ targetUIDs, source }) => ({ status: 'approved', proofId: 'fixture-damage',
    resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 6, responsiblePlayerId: source.controllerPlayerId,
      sourceObjectIds: [source.sourceUID, source.effectId] })), targetLegality: 'approved',
    preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled' }),
};
const paymentId = (commandId, actor = 'alice') => `spell-payment:${JSON.stringify([actor, commandId])}`;
function payAndFinalize(result, commandId, actor = 'alice') {
  let r = applyDuelSpellResourceCommandV2(result.session, actor, {
    commandId: `${commandId}:energy`, expectedVersion: result.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: result.session.commandSession.match.resources.bases.find(base => base.playerId === actor).baseRunes.find(rune => rune.readied).uid },
  });
  assert.equal(r.outcome.status, 'pending');
  r = applyDuelSpellResourceCommandV2(r.session, actor, {
    commandId: `${commandId}:pay`, expectedVersion: r.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: paymentId(commandId, actor) },
  });
  assert.equal(r.outcome.status, 'pending');
  r = finalizeDuelSpellCardPlayV2(r.session, actor);
  assert.equal(r.outcome.status, 'pending');
  return r;
}
function payAndPass(result, commandId) {
  let r = payAndFinalize(result, commandId);
  r = passDuelSpellPriorityV2(r.session, 'alice');
  r = passDuelSpellPriorityV2(r.session, 'bob');
  assert.equal(r.outcome.step, 'effect');
  return r;
}

test('Draw 4 Spell pays, enters Chain, waits for both passes, then moves Chain to trash', () => {
  const { match, session: base } = baseSession();
  const action = createDuelSpellCardPlaySessionV2(base, services(match));
  const uid = match.players[0].hand.find(value => value.cardId === draw.id).uid;
  const epoch = match.physicalCardsByUID[uid].zoneEpoch;
  let result = playDuelSpellCardV2(action, 'alice', {
    commandId: 'spell-1', expectedVersion: match.stateVersion, command: { cardUID: uid },
  });
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.outcome.step, 'payment');
  assert.equal(result.session.commandSession.match.chainCards.length, 1);
  assert.equal(result.session.commandSession.match.frame.stateOpen, false);
  const energyRuneUID = result.session.commandSession.match.resources.bases[0].baseRunes[0].uid;
  result = applyDuelSpellResourceCommandV2(result.session, 'alice', {
    commandId: 'rune-energy-1', expectedVersion: result.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: energyRuneUID },
  });
  assert.equal(result.outcome.status, 'pending');
  result = applyDuelSpellResourceCommandV2(result.session, 'alice', {
    commandId: 'pay-1', expectedVersion: result.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: paymentId('spell-1') },
  });
  assert.equal(result.outcome.status, 'pending');
  result = finalizeDuelSpellCardPlayV2(result.session, 'alice');
  assert.equal(result.outcome.status, 'pending');
  result = passDuelSpellPriorityV2(result.session, 'alice');
  assert.equal(result.session.commandSession.match.frame.priorityPlayerId, 'bob');
  assert.equal(result.session.commandSession.match.frame.stateOpen, false);
  result = passDuelSpellPriorityV2(result.session, 'bob');
  assert.equal(result.session.commandSession.match.frame.priorityPlayerId, null);
  assert.equal(result.outcome.step, 'effect');
  result = resolveDuelSpellCardPlayV2(result.session, 'alice');
  assert.equal(result.outcome.status, 'applied');
  const after = result.session.commandSession.match;
  // The played Spell leaves the opening hand before Draw 4 resolves, so the
  // net hand delta is four drawn cards minus that Spell.
  assert.equal(after.players[0].hand.length, match.players[0].hand.length + 3);
  assert.equal(after.players[0].remainingMainDeck.length, match.players[0].remainingMainDeck.length - 4);
  assert.equal(after.players[0].trash.some(value => value.uid === uid), true);
  assert.equal(after.chainCards.length, 0);
  assert.equal(after.physicalCardsByUID[uid].zoneEpoch, epoch + 2);
  assert.equal(result.session.chain.items.length, 0);
  assert.equal(after.frame.stateOpen, true);
  assert.equal(after.frame.priorityPlayerId, 'alice');
});

function readySpell(edit = () => {}) {
  const { match, session: base } = baseSession(), svc = services(match);
  edit(svc);
  const action = createDuelSpellCardPlaySessionV2(base, svc);
  const uid = match.players[0].hand[0].uid;
  const envelope = { commandId: 'ready-spell', expectedVersion: match.stateVersion, command: { cardUID: uid } };
  let r = playDuelSpellCardV2(action, 'alice', envelope);
  assert.equal(r.outcome.status, 'pending');
  r = applyDuelSpellResourceCommandV2(r.session, 'alice', { commandId: 'ready-energy', expectedVersion: r.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: r.session.commandSession.match.resources.bases[0].baseRunes[0].uid } });
  r = applyDuelSpellResourceCommandV2(r.session, 'alice', { commandId: 'ready-pay', expectedVersion: r.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: paymentId('ready-spell') } });
  r = finalizeDuelSpellCardPlayV2(r.session, 'alice');
  assert.equal(r.outcome.cardUID, uid);
  r = passDuelSpellPriorityV2(r.session, 'alice'); r = passDuelSpellPriorityV2(r.session, 'bob');
  return { result: r, svc, uid, envelope, match };
}

function assertOnlyChainWindowOpened(actual, candidate) {
  assert.equal(actual.stateVersion, candidate.stateVersion + 1);
  assert.equal(actual.eventSeq, candidate.eventSeq + 1);
  assert.equal(actual.frame.stateOpen, true);
  assert.equal(actual.frame.priorityPlayerId, 'alice');
  // Draw/trash/epochs must not execute again when the external receipt arrives.
  assert.deepEqual({ ...actual, stateVersion: candidate.stateVersion,
    eventSeq: candidate.eventSeq, frame: candidate.frame }, candidate);
}

test('one canonical session has one Spell branch; a pre-existing physical Chain needs its shared owner', () => {
  const { match, session: base } = baseSession(), svc = services(match);
  createDuelSpellCardPlaySessionV2(base, svc);
  assert.throws(() => createDuelSpellCardPlaySessionV2(base, svc), /already has/);
  const second = baseSession();
  const moved = moveDuelPhysicalCardToChainV2(second.match, referenceDuelPhysicalCardV2(second.match, second.match.players[0].hand[0].uid), 'alice');
  const adopted = adoptAdmittedDuelPlayingSessionV2(moved);
  assert.throws(() => createDuelSpellCardPlaySessionV2(adopted, services(moved)), /shared Chain owner/);
});

test('a missing external receipt retains the committed candidate and never repeats Draw on retry', () => {
  const f = readySpell(), commit = f.svc.dispatcher.commitEffect;
  f.svc.dispatcher.commitEffect = () => {};
  let r = resolveDuelSpellCardPlayV2(f.result.session, 'alice');
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.session.chain.phase, 'await-commit');
  const candidate = r.session.commandSession.match;
  assert.equal(candidate.players[0].hand.length, f.match.players[0].hand.length + 3);
  assert.equal(candidate.players[0].trash.filter(card => card.uid === f.uid).length, 1);
  r = resumeDuelSpellEffectV2(r.session);
  assert.equal(r.outcome.status, 'pending');
  assert.strictEqual(r.session.commandSession.match, candidate);
  f.svc.dispatcher.commitEffect = commit;
  r = resumeDuelSpellEffectV2(r.session);
  assert.equal(r.outcome.status, 'applied');
  assertOnlyChainWindowOpened(r.session.commandSession.match, candidate);
  const duplicate = playDuelSpellCardV2(r.session, 'alice', f.envelope);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.outcome.status, 'applied');
});

for (const [field, value] of [['cardUID', 'foreign-card'], ['matchId', 'foreign-match'], ['afterStateVersion', 999], ['effectStatus', 'countered']]) {
  test(`an external receipt with the wrong ${field} cannot close the actual ticket`, () => {
    const f = readySpell(), read = f.svc.dispatcher.readCommitted;
    f.svc.dispatcher.readCommitted = ticket => { const receipt = read(ticket); return receipt ? { ...receipt, [field]: value } : null; };
    let r = resolveDuelSpellCardPlayV2(f.result.session, 'alice');
    assert.equal(r.outcome.status, 'pending');
    assert.equal(r.session.chain.phase, 'await-commit');
    const candidate = r.session.commandSession.match;
    f.svc.dispatcher.readCommitted = read;
    r = resumeDuelSpellEffectV2(r.session);
    assert.equal(r.outcome.status, 'applied');
    assertOnlyChainWindowOpened(r.session.commandSession.match, candidate);
  });
}

test('a throw after external commit retries the same ticket without executing again', () => {
  const f = readySpell(), commit = f.svc.dispatcher.commitEffect;
  let writes = 0;
  f.svc.dispatcher.commitEffect = request => { writes++; commit(request); throw Error('lost acknowledgement'); };
  let r = resolveDuelSpellCardPlayV2(f.result.session, 'alice');
  assert.equal(r.outcome.status, 'pending');
  const candidate = r.session.commandSession.match;
  r = resumeDuelSpellEffectV2(r.session);
  assert.equal(r.outcome.status, 'applied');
  assert.equal(writes, 1);
  assertOnlyChainWindowOpened(r.session.commandSession.match, candidate);
});

test('a source failure after physical admission preserves the real payment issuance continuation', () => {
  const { match, session: base } = baseSession(), svc = services(match), attestor = svc.sourceAttestor;
  svc.sourceAttestor = () => { throw Error('source temporarily unavailable'); };
  const action = createDuelSpellCardPlaySessionV2(base, svc), uid = match.players[0].hand[0].uid;
  let r = playDuelSpellCardV2(action, 'alice', { commandId: 'source-retry', expectedVersion: match.stateVersion, command: { cardUID: uid } });
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.session.commandSession.match.chainCards[0].uid, uid);
  const epoch = r.session.commandSession.match.physicalCardsByUID[uid].zoneEpoch;
  svc.sourceAttestor = attestor;
  r = resumeDuelSpellPaymentV2(r.session);
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.session.commandSession.match.frame.pendingPayment.paymentId, paymentId('source-retry'));
  assert.equal(r.session.commandSession.match.chainCards.length, 1);
  assert.equal(r.session.commandSession.match.physicalCardsByUID[uid].zoneEpoch, epoch);
});

test('a failed pre-admission claim closes with a truthful outcome and resources share its namespace', () => {
  const { match, session: base } = baseSession(), svc = services(match);
  svc.costBinding = request => ({ ...request, status: 'unknown' });
  const action = createDuelSpellCardPlaySessionV2(base, svc), uid = match.players[0].hand[0].uid;
  const envelope = { commandId: 'namespace-id', expectedVersion: match.stateVersion, command: { cardUID: uid } };
  const blocked = playDuelSpellCardV2(action, 'alice', envelope);
  assert.equal(blocked.outcome.status, 'blocked');
  const duplicate = playDuelSpellCardV2(blocked.session, 'alice', envelope);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.outcome.status, 'blocked');
  assert.equal(duplicate.session.chain.items.length, 0);
  assert.equal(duplicate.session.commandSession.match.frame.pendingPayment, null);
  const conflict = applyDuelSpellResourceCommandV2(duplicate.session, 'alice', { commandId: 'namespace-id', expectedVersion: match.stateVersion,
    command: { type: 'rune-energy', uid: match.resources.bases[0].baseRunes[0].uid } });
  assert.equal(conflict.outcome.status, 'rejected');
  assert.equal(conflict.outcome.reason, 'command-conflict');
  assert.strictEqual(conflict.session.commandSession.match, match);
});

function failOneCommandReceipt(svc, commandId, mode) {
  const finish = svc.dispatcher.finish;
  let attempts = 0;
  svc.dispatcher.finish = request => {
    if (request.claim.key !== `alice:${commandId}`) return finish(request);
    attempts++;
    if (attempts === 1) {
      if (mode === 'after-write') finish(request);
      throw Error('command receipt acknowledgement unavailable');
    }
    return finish(request);
  };
  return () => attempts;
}

for (const mode of ['before-write', 'after-write']) {
  test(`initial Spell payment retains its original claim after ${mode} receipt failure`, () => {
    const { match, session: base } = baseSession(), svc = services(match);
    const attempts = failOneCommandReceipt(svc, 'receipt-play', mode);
    const action = createDuelSpellCardPlaySessionV2(base, svc);
    const uid = match.players[0].hand[0].uid;
    const envelope = { commandId: 'receipt-play', expectedVersion: match.stateVersion, command: { cardUID: uid } };
    let r = playDuelSpellCardV2(action, 'alice', envelope);
    assert.equal(r.outcome.step, 'payment');
    assert.equal(r.outcome.reason, 'command-receipt-unconfirmed');
    const advanced = r.session.commandSession.match;
    assert.equal(advanced.chainCards[0].uid, uid);
    assert.equal(advanced.frame.pendingPayment.paymentId, paymentId('receipt-play'));
    const snapshot = inspectDuelSpellPrivateStateV2(r.session);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.pendingReceipt), true);
    assert.equal(snapshot.pendingReceipt.claimIssued, true);
    assert.equal(snapshot.pendingReceipt.request.kind, 'spell');
    assert.equal(snapshot.pendingReceipt.spellReceiptPending, true);
    assert.equal(snapshot.pendingReceipt.outcome.status, 'pending');
    assert.equal(snapshot.pendingReceipt.stateVersion, advanced.stateVersion);
    assert.equal(Object.hasOwn(snapshot.pendingReceipt, 'claim'), false);
    assert.throws(() => inspectDuelSpellPrivateStateV2(JSON.parse(JSON.stringify(r.session))), /unadmitted/);
    const wrongPayload = playDuelSpellCardV2(r.session, 'alice', { ...envelope,
      command: { cardUID: match.players[0].hand[1].uid } });
    assert.deepEqual(wrongPayload.outcome, { status: 'rejected', reason: 'command-conflict' });
    assert.strictEqual(wrongPayload.session, r.session);
    const otherActor = playDuelSpellCardV2(r.session, 'bob', envelope);
    assert.equal(otherActor.outcome.status, 'blocked');
    const otherCommand = applyDuelSpellResourceCommandV2(r.session, 'alice', {
      commandId: 'cannot-overtake', expectedVersion: advanced.stateVersion,
      command: { type: 'rune-energy', uid: advanced.resources.bases[0].baseRunes[0].uid },
    });
    assert.equal(otherCommand.outcome.status, 'blocked');
    assert.strictEqual(otherCommand.session, r.session);
    assert.equal(resumeDuelSpellPaymentV2(r.session).outcome.status, 'blocked');
    assert.equal(finalizeDuelSpellCardPlayV2(r.session, 'alice').outcome.status, 'blocked');
    assert.equal(passDuelSpellPriorityV2(r.session, 'alice').outcome.status, 'blocked');
    r = playDuelSpellCardV2(r.session, 'alice', envelope);
    assert.equal(r.duplicate, true);
    assert.equal(r.outcome.step, 'payment');
    assert.strictEqual(r.session.commandSession.match, advanced);
    assert.equal(inspectDuelSpellPrivateStateV2(r.session).pendingReceipt, null);
    assert.equal(r.session.receipts.filter(row => row.commandId === envelope.commandId).length, 1);
    assert.equal(attempts(), mode === 'before-write' ? 2 : 1);
    const replay = playDuelSpellCardV2(r.session, 'alice', envelope);
    assert.equal(replay.duplicate, true);
    assert.strictEqual(replay.session, r.session);
    assert.equal(replay.outcome.step, 'payment');
    r = payAndPass(r, envelope.commandId);
    r = resolveDuelSpellCardPlayV2(r.session);
    assert.equal(r.outcome.status, 'applied');
    assert.equal(r.session.commandSession.match.players[0].trash.filter(card => card.uid === uid).length, 1);
  });

  test(`rune-energy receipt ${mode} recovers the spent native successor once`, () => {
    const { match, session: base } = baseSession(), svc = services(match);
    const action = createDuelSpellCardPlaySessionV2(base, svc);
    const play = playDuelSpellCardV2(action, 'alice', { commandId: 'energy-source',
      expectedVersion: match.stateVersion, command: { cardUID: match.players[0].hand[0].uid } });
    const before = play.session.commandSession.match;
    const uid = before.resources.bases[0].baseRunes[0].uid;
    const envelope = { commandId: 'energy-ack', expectedVersion: before.stateVersion,
      command: { type: 'rune-energy', uid } };
    const attempts = failOneCommandReceipt(svc, envelope.commandId, mode);
    let r = applyDuelSpellResourceCommandV2(play.session, 'alice', envelope);
    assert.deepEqual(r.outcome, { status: 'blocked', reason: 'outstanding-task-or-session' });
    assert.equal(r.persistRequired, true);
    const advanced = r.session.commandSession.match;
    assert.notStrictEqual(advanced, before);
    assert.equal(advanced.resources.bases[0].baseRunes.find(rune => rune.uid === uid).readied, false);
    const snapshot = inspectDuelSpellPrivateStateV2(r.session);
    assert.equal(snapshot.pendingReceipt.request.kind, 'resource');
    assert.equal(snapshot.pendingReceipt.outcome.status, 'applied');
    assert.equal(snapshot.pendingReceipt.spellReceiptPending, false);
    const conflict = applyDuelSpellResourceCommandV2(r.session, 'alice', { ...envelope,
      command: { type: 'rune-energy', uid: 'different-rune' } });
    assert.deepEqual(conflict.outcome, { status: 'rejected', reason: 'command-conflict' });
    assert.strictEqual(conflict.session, r.session);
    assert.equal(applyDuelSpellResourceCommandV2(r.session, 'bob', envelope).outcome.status, 'blocked');
    assert.equal(resumeDuelSpellPaymentV2(r.session).outcome.status, 'blocked');
    r = applyDuelSpellResourceCommandV2(r.session, 'alice', envelope);
    assert.equal(r.duplicate, true);
    assert.equal(r.outcome.step, 'payment');
    assert.strictEqual(r.session.commandSession.match, advanced);
    assert.equal(inspectDuelSpellPrivateStateV2(r.session).pendingReceipt, null);
    assert.equal(attempts(), mode === 'before-write' ? 2 : 1);
    const duplicate = applyDuelSpellResourceCommandV2(r.session, 'alice', envelope);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.outcome.status, 'applied');
    assert.strictEqual(duplicate.session.commandSession.match, advanced);
  });

  test(`pay-pending receipt ${mode} cannot debit twice or run the effect early`, () => {
    const { match, session: base } = baseSession(), svc = services(match);
    let r = playDuelSpellCardV2(createDuelSpellCardPlaySessionV2(base, svc), 'alice', {
      commandId: 'pay-source', expectedVersion: match.stateVersion, command: { cardUID: match.players[0].hand[0].uid },
    });
    r = applyDuelSpellResourceCommandV2(r.session, 'alice', { commandId: 'pay-energy',
      expectedVersion: r.session.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: r.session.commandSession.match.resources.bases[0].baseRunes[0].uid },
    });
    const envelope = { commandId: 'pay-ack', expectedVersion: r.session.commandSession.match.stateVersion,
      command: { type: 'pay-pending', paymentId: paymentId('pay-source') } };
    const attempts = failOneCommandReceipt(svc, envelope.commandId, mode);
    r = applyDuelSpellResourceCommandV2(r.session, 'alice', envelope);
    assert.deepEqual(r.outcome, { status: 'blocked', reason: 'outstanding-task-or-session' });
    assert.equal(r.persistRequired, true);
    const paid = r.session.commandSession.match;
    assert.equal(paid.frame.pendingPayment, null);
    assert.equal(r.session.commandSession.requiredTasks.find(task => task.paymentId === paymentId('pay-source')).status, 'completed');
    assert.equal(inspectDuelSpellPrivateStateV2(r.session).pendingReceipt.response.step, 'priority');
    assert.equal(inspectDuelSpellPrivateStateV2(r.session).pendingCost, null);
    assert.equal(finalizeDuelSpellCardPlayV2(r.session, 'alice').outcome.status, 'blocked');
    assert.equal(resolveDuelSpellCardPlayV2(r.session).outcome.status, 'blocked');
    const wrong = applyDuelSpellResourceCommandV2(r.session, 'alice', { ...envelope,
      command: { type: 'pay-pending', paymentId: 'wrong-payment' } });
    assert.deepEqual(wrong.outcome, { status: 'rejected', reason: 'command-conflict' });
    r = applyDuelSpellResourceCommandV2(r.session, 'alice', envelope);
    assert.equal(r.duplicate, true);
    assert.equal(r.outcome.step, 'priority');
    assert.strictEqual(r.session.commandSession.match, paid);
    assert.equal(inspectDuelSpellPrivateStateV2(r.session).pendingReceipt, null);
    assert.equal(attempts(), mode === 'before-write' ? 2 : 1);
    assert.equal(applyDuelSpellResourceCommandV2(r.session, 'alice', envelope).duplicate, true);
    r = finalizeDuelSpellCardPlayV2(r.session, 'alice');
    r = passDuelSpellPriorityV2(r.session, 'alice');
    r = passDuelSpellPriorityV2(r.session, 'bob');
    r = resolveDuelSpellCardPlayV2(r.session);
    assert.equal(r.outcome.status, 'applied');
    assert.equal(r.session.commandSession.match.players[0].trash.filter(card => card.uid === match.players[0].hand[0].uid).length, 1);
  });
}

test('repeated receipt failure, mismatched duplicate outcome and reentry cannot replay rune energy', () => {
  const { match, session: base } = baseSession(), svc = services(match);
  const play = playDuelSpellCardV2(createDuelSpellCardPlaySessionV2(base, svc), 'alice', {
    commandId: 'guarded-source', expectedVersion: match.stateVersion,
    command: { cardUID: match.players[0].hand[0].uid },
  });
  const before = play.session.commandSession.match;
  const envelope = { commandId: 'guarded-energy', expectedVersion: before.stateVersion,
    command: { type: 'rune-energy', uid: before.resources.bases[0].baseRunes[0].uid } };
  const finish = svc.dispatcher.finish;
  let attempts = 0, r;
  svc.dispatcher.finish = request => {
    if (request.claim.key !== 'alice:guarded-energy') return finish(request);
    attempts++;
    if (attempts < 3) throw Error('receipt store unavailable');
    assert.throws(() => applyDuelSpellResourceCommandV2(r.session, 'alice', envelope), /reentrant command/);
    return finish(request);
  };
  r = applyDuelSpellResourceCommandV2(play.session, 'alice', envelope);
  const pending = r.session, advanced = pending.commandSession.match;
  const failedRetry = applyDuelSpellResourceCommandV2(pending, 'alice', envelope);
  assert.equal(failedRetry.outcome.status, 'blocked');
  assert.strictEqual(failedRetry.session, pending);
  assert.strictEqual(failedRetry.session.commandSession.match, advanced);
  const claim = svc.dispatcher.claim;
  svc.dispatcher.claim = request => request.commandId === envelope.commandId
    ? { status: 'duplicate', outcome: { status: 'applied', appliedVersion: 999, eventSeq: 999 } }
    : claim(request);
  const mismatched = applyDuelSpellResourceCommandV2(pending, 'alice', envelope);
  assert.equal(mismatched.outcome.status, 'blocked');
  assert.strictEqual(mismatched.session, pending);
  assert.equal(attempts, 2);
  svc.dispatcher.claim = claim;
  r = applyDuelSpellResourceCommandV2(pending, 'alice', envelope);
  assert.equal(r.duplicate, true);
  assert.equal(r.outcome.step, 'payment');
  assert.strictEqual(r.session.commandSession.match, advanced);
  assert.equal(attempts, 3);
  assert.equal(inspectDuelSpellPrivateStateV2(r.session).pendingReceipt, null);
  assert.equal(applyDuelSpellResourceCommandV2(r.session, 'alice', envelope).duplicate, true);
});

test('Spell CardPlay rejects wrong actor/cursor reuse without a second effect', () => {
  const { match, session: base } = baseSession();
  const action = createDuelSpellCardPlaySessionV2(base, services(match));
  const uid = match.players[0].hand.find(value => value.cardId === draw.id).uid;
  const wrong = playDuelSpellCardV2(action, 'bob', { commandId: 'bad', expectedVersion: match.stateVersion, command: { cardUID: uid } });
  assert.deepEqual(wrong.outcome, { status: 'rejected', reason: 'no-permission' });
  const invalid = playDuelSpellCardV2(action, 'alice', { commandId: 'bad-shape', expectedVersion: match.stateVersion,
    command: { cardUID: 'missing-card' } });
  assert.equal(invalid.outcome.status, 'blocked');
  assert.strictEqual(invalid.session.commandSession.match, match);
});

test('an explicit empty Damage target group is chosen before payment and resolves without a later choice', () => {
  const { match, session: base } = baseSession(makeSeats(damage.id));
  const action = createDuelSpellCardPlaySessionV2(base, services(match, damage.id, {
    killDamage: {
      verifyCost: () => ({ status: 'approved', proofId: 'damage-cost-proof' }),
      verifyChain: () => ({ status: 'approved', proofId: 'damage-chain-proof', selectionTiming: 'finalization' }),
      resolveDamage: ({ targetUIDs, source }) => ({
        status: 'approved', resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 6,
          responsiblePlayerId: source.controllerPlayerId, sourceObjectIds: [source.sourceUID, source.effectId] })),
        proofId: 'damage-resolution-proof', targetLegality: 'approved',
        preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled',
      }),
    },
  }));
  const uid = match.players[0].hand.find(value => value.cardId === damage.id).uid;
  const epoch = match.physicalCardsByUID[uid].zoneEpoch;
  let result = playDuelSpellCardV2(action, 'alice', {
    commandId: 'damage-spell-1', expectedVersion: match.stateVersion, command: { cardUID: uid, targetUIDs: [] },
  });
  const runeUID = result.session.commandSession.match.resources.bases[0].baseRunes[0].uid;
  result = applyDuelSpellResourceCommandV2(result.session, 'alice', {
    commandId: 'damage-rune-energy', expectedVersion: result.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: runeUID },
  });
  result = applyDuelSpellResourceCommandV2(result.session, 'alice', {
    commandId: 'damage-pay', expectedVersion: result.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: paymentId('damage-spell-1') },
  });
  result = finalizeDuelSpellCardPlayV2(result.session, 'alice');
  result = passDuelSpellPriorityV2(result.session, 'alice');
  result = passDuelSpellPriorityV2(result.session, 'bob');
  result = resolveDuelSpellCardPlayV2(result.session, 'alice');
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.outcome.changed, false);
  const after = result.session.commandSession.match;
  assert.equal(after.players[0].trash.some(value => value.uid === uid), true);
  assert.equal(after.chainCards.length, 0);
  assert.equal(after.physicalCardsByUID[uid].zoneEpoch, epoch + 2);
  const duplicate = playDuelSpellCardV2(result.session, 'alice', {
    commandId: 'damage-spell-1', expectedVersion: match.stateVersion, command: { cardUID: uid, targetUIDs: [] },
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.outcome.status, 'applied');
});

test('a targeted Spell cannot pay or leave hand without its legal pre-payment choice', () => {
  for (const targets of [undefined, ['absent-unit'], ['alice:spell:1'], ['bob:deck:1', 'bob:deck:1'],
    ['bob:deck:1', 'bob:deck:2', 'bob:deck:3']]) {
    const { match, session: base } = boardScene();
    const action = createDuelSpellCardPlaySessionV2(base, services(match, damage.id));
    const command = { cardUID: match.players[0].hand[0].uid, ...(targets ? { targetUIDs: targets } : {}) };
    const r = playDuelSpellCardV2(action, 'alice', { commandId: 'bad-target', expectedVersion: match.stateVersion, command });
    assert.equal(r.outcome.status, 'rejected');
    assert.strictEqual(r.session.commandSession.match, match);
    assert.equal(r.session.chain.items.length, 0);
    assert.equal(match.frame.pendingPayment, null);
  }
});

for (const sourceId of [damage.id, kill.id]) {
  test(`${sourceId} resolves only the original target and rejects changing it after the passes`, () => {
    const { match, session: base, units } = boardScene(sourceId);
    let ready = false, selections = 0;
    const closure = { ...killDamageClosure, verifyChain: (_head, _source, ids) => {
      selections++; assert.deepEqual(ids, [units[0].uid]);
      return ready ? { status: 'approved', proofId: 'captured-choice', selectionTiming: 'finalization' } : null;
    } };
    const svc = services(match, sourceId, { killDamage: closure });
    const action = createDuelSpellCardPlaySessionV2(base, svc);
    const targetUIDs = [units[0].uid];
    const envelope = { commandId: 'locked-target', expectedVersion: match.stateVersion,
      command: { cardUID: match.players[0].hand[0].uid, targetUIDs } };
    let r = playDuelSpellCardV2(action, 'alice', envelope);
    targetUIDs[0] = units[1].uid; // Caller mutation must not change the admitted choice.
    r = payAndPass(r, 'locked-target');
    r = resolveDuelSpellCardPlayV2(r.session);
    assert.equal(r.outcome.status, 'pending');
    assert.equal(r.outcome.step, 'effect');
    assert.equal(selections, 1);
    const pending = r.session;
    for (const actor of ['alice', 'bob']) {
      r = submitDuelSpellTargetV2(r.session, { expectedStateVersion: pending.commandSession.match.stateVersion,
        actorPlayerId: actor, targetUID: units[1].uid, targetUIDs: [units[1].uid] });
      assert.equal(r.outcome.status, 'blocked');
      assert.strictEqual(r.session, pending);
    }
    ready = true;
    r = resumeDuelSpellEffectV2(r.session);
    assert.equal(r.outcome.status, 'applied');
    assert.equal(selections, 2);
    const after = r.session.commandSession.match;
    assert.equal(after.board.units.some(unit => unit.objectId === units[1].uid), true);
    assert.deepEqual(after.unitMeta[units[1].uid].damageMarks, []);
    if (sourceId === kill.id) {
      assert.equal(after.board.units.some(unit => unit.objectId === units[0].uid), false);
      assert.equal(after.players[1].trash.some(card => card.uid === units[0].uid), true);
    } else assert.equal(after.unitMeta[units[0].uid].damageMarks[0].amount, 6);
    const changedPayload = playDuelSpellCardV2(r.session, 'alice', { ...envelope,
      command: { ...envelope.command, targetUIDs: [units[1].uid] } });
    assert.deepEqual(changedPayload.outcome, { status: 'rejected', reason: 'command-conflict' });
  });
}

test('an unpaid source-proof continuation cannot Finalize or pass priority', () => {
  const { match, session: base } = baseSession(), svc = services(match);
  svc.sourceAttestor = () => { throw Error('source not available'); };
  let r = playDuelSpellCardV2(createDuelSpellCardPlaySessionV2(base, svc), 'alice', {
    commandId: 'unissued-cost', expectedVersion: match.stateVersion, command: { cardUID: match.players[0].hand[0].uid },
  });
  assert.equal(r.outcome.step, 'payment');
  assert.equal(r.session.commandSession.match.frame.pendingPayment, null);
  const pending = r.session;
  r = finalizeDuelSpellCardPlayV2(r.session, 'alice');
  assert.equal(r.outcome.status, 'blocked');
  assert.strictEqual(r.session, pending);
  r = passDuelSpellPriorityV2(r.session, 'alice');
  assert.equal(r.outcome.status, 'blocked');
  assert.equal(r.session.chain.items[0].status, 'pending');
});

test('a parent command receipt failure after Chain close retries only the receipt', () => {
  const f = readySpell(), finish = f.svc.dispatcher.finish;
  let attempts = 0;
  f.svc.dispatcher.finish = request => { attempts++; if (attempts === 1) throw Error('receipt store unavailable'); finish(request); };
  let r = resolveDuelSpellCardPlayV2(f.result.session);
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.outcome.reason, 'command-receipt-unconfirmed');
  assert.equal(r.session.chain.items.length, 0);
  const closed = r.session.commandSession.match;
  assert.equal(closed.frame.stateOpen, true);
  const newSpell = playDuelSpellCardV2(r.session, 'alice', { commandId: 'next-before-receipt',
    expectedVersion: closed.stateVersion, command: { cardUID: closed.players[0].hand[0].uid } });
  assert.equal(newSpell.outcome.status, 'blocked');
  r = resumeDuelSpellEffectV2(newSpell.session);
  assert.equal(r.outcome.status, 'applied');
  assert.strictEqual(r.session.commandSession.match, closed);
  assert.equal(closed.players[0].hand.length, f.match.players[0].hand.length + 3);
  assert.equal(closed.players[0].trash.filter(card => card.uid === f.uid).length, 1);
});

test('each player chooses their own unit during resolution, independently of the Spell target group', () => {
  const { match, session: base, units } = boardScene(each.id, true);
  const closure = { ...killDamageClosure,
    verifyChain: () => ({ status: 'approved', proofId: 'fixture-each-resolution', selectionTiming: 'resolution' }) };
  const action = createDuelSpellCardPlaySessionV2(base, services(match, each.id, { killDamage: closure }));
  let r = playDuelSpellCardV2(action, 'alice', { commandId: 'each-resolution', expectedVersion: match.stateVersion,
    command: { cardUID: match.players[0].hand[0].uid } });
  r = payAndPass(r, 'each-resolution');
  r = resolveDuelSpellCardPlayV2(r.session);
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.outcome.step, 'target');
  const aliceUnit = units.find(unit => unit.owner === 'alice'), bobUnit = units.find(unit => unit.owner === 'bob');
  r = submitDuelSpellTargetV2(r.session, { expectedStateVersion: r.session.commandSession.match.stateVersion,
    actorPlayerId: 'alice', targetUID: aliceUnit.uid });
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.session.commandSession.match.board.units.length, 3);
  r = submitDuelSpellTargetV2(r.session, { expectedStateVersion: r.session.commandSession.match.stateVersion,
    actorPlayerId: 'bob', targetUID: bobUnit.uid });
  assert.equal(r.outcome.status, 'applied');
  assert.equal(r.session.commandSession.match.board.units.length, 1);
  assert.equal(r.session.commandSession.match.players[0].trash.some(card => card.uid === aliceUnit.uid), true);
  assert.equal(r.session.commandSession.match.players[1].trash.some(card => card.uid === bobUnit.uid), true);
});

test('wrong priority and stale action capabilities cannot change the canonical response window', () => {
  const { match, session: base } = baseSession();
  let r = playDuelSpellCardV2(createDuelSpellCardPlaySessionV2(base, services(match)), 'alice', {
    commandId: 'priority-check', expectedVersion: match.stateVersion, command: { cardUID: match.players[0].hand[0].uid },
  });
  const old = r.session;
  const premature = passDuelSpellPriorityV2(old, 'alice');
  assert.equal(premature.outcome.status, 'blocked');
  assert.strictEqual(premature.session, old);
  r = payAndPass(r, 'priority-check');
  const locked = r.session;
  const tooLate = passDuelSpellPriorityV2(locked, 'bob');
  assert.equal(tooLate.outcome.status, 'blocked');
  assert.strictEqual(tooLate.session, locked);
  assert.throws(() => finalizeDuelSpellCardPlayV2(old, 'alice'), /inactive Spell session/);
  assert.equal(locked.commandSession.match.frame.priorityPlayerId, null);
  assert.equal(locked.commandSession.match.frame.stateOpen, false);
});

test('target array accessors never execute and cannot install a payment or physical Chain', () => {
  const { match, session: base } = boardScene();
  const action = createDuelSpellCardPlaySessionV2(base, services(match, damage.id));
  let reads = 0;
  const targetUIDs = [];
  Object.defineProperty(targetUIDs, '0', { enumerable: true, get: () => { reads++; return match.board.units[0].objectId; } });
  const r = playDuelSpellCardV2(action, 'alice', { commandId: 'accessor-target', expectedVersion: match.stateVersion,
    command: { cardUID: match.players[0].hand[0].uid, targetUIDs } });
  assert.deepEqual(r.outcome, { status: 'rejected', reason: 'invalid-command' });
  assert.equal(reads, 0);
  assert.strictEqual(r.session.commandSession.match, match);
  assert.equal(r.session.chain.items.length, 0);
});

function respondableScene(bobSpellId = reaction.id, seatInput = makeSeats(draw.id, bobSpellId), extraAliceRune = false, edit = () => {}) {
  let { match } = baseSession(seatInput, 1);
  if (extraAliceRune) match = channelDuelRunesV2(match, 'alice', 1);
  const svc = responseServices(match); edit(svc);
  const action = createDuelSpellCardPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(match), svc);
  const uid = match.players[0].hand.find(card => card.cardId === draw.id).uid;
  const envelope = { commandId: 'same-client-id', expectedVersion: match.stateVersion, command: { cardUID: uid } };
  let r = playDuelSpellCardV2(action, 'alice', envelope);
  r = payAndFinalize(r, envelope.commandId);
  r = passDuelSpellPriorityV2(r.session, 'alice');
  assert.equal(r.session.commandSession.match.frame.priorityPlayerId, 'bob');
  return { match, svc, result: r, uid, envelope };
}
function passBoth(result, first) {
  let r = passDuelSpellPriorityV2(result.session, first);
  assert.equal(r.outcome.status, 'pending');
  r = passDuelSpellPriorityV2(r.session, first === 'alice' ? 'bob' : 'alice');
  assert.equal(r.outcome.step, 'effect');
  return r;
}

test('a real Reaction permission shares the original Chain and scopes identical command IDs by actor', () => {
  const f = respondableScene(), bobUID = f.match.players[1].hand[0].uid;
  const notifications = [];
  f.svc.dispatcher.notifyCommitted = request => { notifications.push(request); };
  const response = { commandId: f.envelope.commandId, expectedVersion: f.result.session.commandSession.match.stateVersion,
    command: { cardUID: bobUID } };
  let r = playDuelSpellCardV2(f.result.session, 'bob', response);
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.session.chain.items.length, 2);
  assert.deepEqual(r.session.chain.items.map(item => item.id), [JSON.stringify(['alice', response.commandId]), JSON.stringify(['bob', response.commandId])]);
  assert.equal(r.session.commandSession.match.chainCards.length, 2);
  assert.equal(r.session.commandSession.match.frame.pendingPayment.actor, 'bob');
  assert.equal(r.session.chain.consecutivePasses, 0);
  const duplicate = playDuelSpellCardV2(r.session, 'bob', response);
  assert.equal(duplicate.duplicate, true);
  assert.strictEqual(duplicate.session, r.session);
  r = payAndFinalize(r, response.commandId, 'bob');
  assert.equal(r.outcome.cardUID, bobUID);
  r = passBoth(r, 'bob');
  r = resolveDuelSpellCardPlayV2(r.session, 'bob');
  assert.equal(r.outcome.status, 'applied');
  assert.equal(r.outcome.cardUID, bobUID);
  let after = r.session.commandSession.match;
  assert.equal(after.players[1].hand.length, f.match.players[1].hand.length + 2);
  assert.equal(after.players[0].hand.length, f.match.players[0].hand.length - 1);
  assert.equal(after.chainCards.length, 1);
  assert.equal(after.chainCards[0].uid, f.uid);
  assert.equal(after.frame.stateOpen, false);
  assert.equal(after.frame.priorityPlayerId, 'alice');
  const duplicateDone = playDuelSpellCardV2(r.session, 'bob', response);
  assert.equal(duplicateDone.duplicate, true);
  assert.equal(duplicateDone.outcome.status, 'applied');
  assert.strictEqual(duplicateDone.session, r.session);
  r = resolveDuelSpellCardPlayV2(passBoth(r, 'alice').session, 'alice');
  assert.equal(r.outcome.status, 'applied');
  after = r.session.commandSession.match;
  assert.equal(after.players[0].hand.length, f.match.players[0].hand.length + 3);
  assert.equal(after.players[1].hand.length, f.match.players[1].hand.length + 2);
  assert.equal(after.chainCards.length, 0);
  assert.equal(after.frame.stateOpen, true);
  assert.equal(after.frame.priorityPlayerId, 'alice');
  for (const uid of [f.uid, bobUID]) assert.equal(after.physicalCardsByUID[uid].zoneEpoch, f.match.physicalCardsByUID[uid].zoneEpoch + 2);
  assert.equal(r.session.receipts.filter(receipt => receipt.commandId === response.commandId && receipt.outcome.status === 'applied').length, 2);
  assert.deepEqual(notifications.map(request => [request.cardUID, request.controller]), [[bobUID, 'bob'], [f.uid, 'alice']]);
  assert.equal(notifications[0].ticket.chainId, notifications[1].ticket.chainId);
  assert.equal(notifications[0].ticket.executorId, notifications[1].ticket.executorId);
});

test('ordinary Spells cannot exploit another player\'s Closed response priority', () => {
  const f = respondableScene(draw.id), head = f.result.session.commandSession.match;
  const r = playDuelSpellCardV2(f.result.session, 'bob', { commandId: 'no-reaction', expectedVersion: head.stateVersion,
    command: { cardUID: head.players[1].hand[0].uid } });
  assert.deepEqual(r.outcome, { status: 'rejected', reason: 'no-permission' });
  assert.strictEqual(r.session.commandSession.match, head);
  assert.equal(r.session.chain.items.length, 1);
  assert.equal(head.frame.pendingPayment, null);
});

test('a third Reaction joins the same native Chain, resolves newest first, then returns the previous controllers', () => {
  const seats = makeSeats(reaction.id, reaction.id);
  seats[0].mainDeck[1] = card(seats[0].mainDeck[1].uid, draw.id);
  const f = respondableScene(reaction.id, seats, true);
  let r = playDuelSpellCardV2(f.result.session, 'bob', { commandId: 'middle-response',
    expectedVersion: f.result.session.commandSession.match.stateVersion, command: { cardUID: f.match.players[1].hand[0].uid } });
  r = payAndFinalize(r, 'middle-response', 'bob');
  r = passDuelSpellPriorityV2(r.session, 'bob');
  const aliceReactionUID = f.match.players[0].hand.find(card => card.cardId === reaction.id).uid;
  r = playDuelSpellCardV2(r.session, 'alice', { commandId: 'newest-response', expectedVersion: r.session.commandSession.match.stateVersion,
    command: { cardUID: aliceReactionUID } });
  r = payAndFinalize(r, 'newest-response');
  assert.equal(r.session.chain.items.length, 3);
  r = resolveDuelSpellCardPlayV2(passBoth(r, 'alice').session);
  assert.equal(r.outcome.status, 'applied');
  assert.equal(r.outcome.cardUID, aliceReactionUID);
  assert.equal(r.session.chain.items.length, 2);
  assert.equal(r.session.commandSession.match.frame.priorityPlayerId, 'bob');
  r = resolveDuelSpellCardPlayV2(passBoth(r, 'bob').session);
  assert.equal(r.outcome.status, 'applied');
  assert.equal(r.session.chain.items.length, 1);
  assert.equal(r.session.commandSession.match.frame.priorityPlayerId, 'alice');
  r = resolveDuelSpellCardPlayV2(passBoth(r, 'alice').session);
  assert.equal(r.outcome.status, 'applied');
  assert.equal(r.session.chain.items.length, 0);
  const after = r.session.commandSession.match;
  assert.equal(after.players[0].hand.length, f.match.players[0].hand.length + 5);
  assert.equal(after.players[1].hand.length, f.match.players[1].hand.length + 2);
  assert.equal(after.frame.stateOpen, true);
});

test('a lost response effect receipt retains both native items and never repeats the response Draw', () => {
  const f = respondableScene(), commit = f.svc.dispatcher.commitEffect;
  let r = playDuelSpellCardV2(f.result.session, 'bob', { commandId: 'lost-response',
    expectedVersion: f.result.session.commandSession.match.stateVersion, command: { cardUID: f.match.players[1].hand[0].uid } });
  r = passBoth(payAndFinalize(r, 'lost-response', 'bob'), 'bob');
  let writes = 0;
  f.svc.dispatcher.commitEffect = request => { writes++; commit(request); throw Error('lost receipt acknowledgement'); };
  r = resolveDuelSpellCardPlayV2(r.session);
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.session.chain.items.length, 2);
  assert.equal(r.session.chain.phase, 'await-commit');
  const drawn = r.session.commandSession.match;
  assert.equal(drawn.players[0].hand.length, f.match.players[0].hand.length - 1);
  assert.equal(drawn.players[1].hand.length, f.match.players[1].hand.length + 2);
  r = resumeDuelSpellEffectV2(r.session);
  assert.equal(r.outcome.status, 'applied');
  assert.equal(writes, 1);
  assert.equal(r.session.chain.items.length, 1);
  assert.equal(r.session.commandSession.match.players[1].hand.length, drawn.players[1].hand.length);
  assert.equal(r.session.commandSession.match.frame.priorityPlayerId, 'alice');
  assert.equal(r.session.commandSession.match.frame.stateOpen, false);
});

test('native commit notification receives the exact admitted proof and original binding', () => {
  const f = readySpell(), events = [];
  f.svc.dispatcher.notifyCommitted = request => { events.push(request); };
  const binding = inspectDuelSpellResolutionBindingV2(f.result.session);
  assert.equal(typeof binding.chainId, 'string');
  assert.equal(typeof binding.executorId, 'string');
  const r = resolveDuelSpellCardPlayV2(f.result.session, 'alice');
  assert.equal(r.outcome.status, 'applied');
  assert.equal(events.length, 1);
  const event = events[0];
  const inspected = inspectDuelChainCommittedProofV2(event.proof);
  assert.strictEqual(inspected.resolutionAuthority, binding.resolutionAuthority);
  assert.equal(inspected.chainId, binding.chainId);
  assert.equal(inspected.executorId, binding.executorId);
  assert.equal(inspected.itemId, event.ticket.itemId);
  assert.equal(event.cardUID, f.uid);
  assert.equal(event.cardId, f.match.players[0].hand.find(card => card.uid === f.uid).cardId);
  assert.equal(event.controller, 'alice');
  assert.equal(event.sourceEpoch, f.match.physicalCardsByUID[f.uid].zoneEpoch + 1);
  assert.throws(() => inspectDuelSpellResolutionBindingV2(JSON.parse(JSON.stringify(f.result.session))), /unadmitted/);
  assert.throws(() => inspectDuelSpellResolutionBindingV2(f.result.session), /inactive/);
});

test('native commit notification retries the same proof and closed successor after throw', () => {
  const f = readySpell(), events = [], candidate = f.result.session.commandSession.match;
  let attempts = 0;
  f.svc.dispatcher.notifyCommitted = request => {
    events.push(request);
    attempts++;
    if (attempts === 1) throw Error('native journal unavailable');
  };
  let r = resolveDuelSpellCardPlayV2(f.result.session, 'alice');
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.session.chain.phase, 'open');
  assert.equal(passDuelSpellPriorityV2(r.session, 'alice').outcome.status, 'blocked');
  const committedMatch = r.session.commandSession.match;
  const drawCount = committedMatch.players[0].remainingMainDeck.length;
  const trashCount = committedMatch.players[0].trash.filter(card => card.uid === f.uid).length;
  r = resumeDuelSpellEffectV2(r.session);
  assert.equal(r.outcome.status, 'applied');
  assert.equal(attempts, 2);
  assert.strictEqual(events[0].proof, events[1].proof);
  assert.strictEqual(events[0].chain, events[1].chain);
  assert.strictEqual(r.session.commandSession.match, committedMatch);
  assert.equal(r.session.commandSession.match.players[0].remainingMainDeck.length, drawCount);
  assert.equal(r.session.commandSession.match.players[0].trash.filter(card => card.uid === f.uid).length, trashCount);
  assert.notStrictEqual(committedMatch, candidate);
});

test('Promise and thenable notifications cannot confirm a native commit before synchronous acknowledgment', () => {
  for (const result of [new Promise(() => {}), { then() { throw Error('then must not be invoked'); } }]) {
    const f = readySpell(), events = [];
    f.svc.dispatcher.notifyCommitted = request => { events.push(request); return result; };
    let r = resolveDuelSpellCardPlayV2(f.result.session, 'alice');
    assert.equal(r.outcome.status, 'pending');
    const head = r.session.commandSession.match;
    assert.equal(inspectDuelSpellPrivateStateV2(r.session).pendingEffect.closed.notificationAcknowledged, false);
    f.svc.dispatcher.notifyCommitted = request => { events.push(request); };
    r = resumeDuelSpellEffectV2(r.session);
    assert.equal(r.outcome.status, 'applied');
    assert.strictEqual(r.session.commandSession.match, head);
    assert.strictEqual(events[0].proof, events[1].proof);
    assert.strictEqual(events[0].chain, events[1].chain);
  }
});

test('an unfinished Promise command receipt keeps the actual committed successor pending', () => {
  const f = readySpell(), finish = f.svc.dispatcher.finish;
  f.svc.dispatcher.finish = () => new Promise(() => {});
  let r = resolveDuelSpellCardPlayV2(f.result.session, 'alice');
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.outcome.reason, 'command-receipt-unconfirmed');
  const head = r.session.commandSession.match;
  f.svc.dispatcher.finish = finish;
  r = resumeDuelSpellEffectV2(r.session);
  assert.equal(r.outcome.status, 'applied');
  assert.strictEqual(r.session.commandSession.match, head);
});

test('a then accessor on a receipt result is rejected without being executed', () => {
  const f = readySpell(), finish = f.svc.dispatcher.finish;
  let reads = 0;
  f.svc.dispatcher.finish = () => Object.defineProperty({}, 'then', {
    get() { reads++; throw Error('receipt result getter must not run'); },
  });
  let r = resolveDuelSpellCardPlayV2(f.result.session, 'alice');
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.outcome.reason, 'command-receipt-unconfirmed');
  assert.equal(reads, 0);
  const head = r.session.commandSession.match;
  f.svc.dispatcher.finish = finish;
  r = resumeDuelSpellEffectV2(r.session);
  assert.equal(r.outcome.status, 'applied');
  assert.strictEqual(r.session.commandSession.match, head);
  assert.equal(reads, 0);
});

test('reentrant native commit notification retains pending native successor until a clean retry', () => {
  const f = readySpell();
  let input = f.result.session, reentered = false, attempts = 0;
  f.svc.dispatcher.notifyCommitted = () => {
    attempts++;
    if (attempts === 1) {
      assert.throws(() => resolveDuelSpellCardPlayV2(input, 'alice'), /reentrant command/);
      reentered = true;
    }
  };
  let r = resolveDuelSpellCardPlayV2(input, 'alice');
  assert.equal(reentered, true);
  assert.equal(r.outcome.status, 'pending');
  assert.equal(r.session.chain.phase, 'open');
  f.svc.dispatcher.notifyCommitted = () => { attempts++; };
  r = resumeDuelSpellEffectV2(r.session);
  assert.equal(r.outcome.status, 'applied');
  assert.equal(attempts, 2);
});

test('receipt recovery rejects getter, symbol and cyclic duplicate outcomes without executing getters', () => {
  const { match, session: base } = baseSession(), svc = services(match);
  failOneCommandReceipt(svc, 'opaque-recovery', 'before-write');
  const action = createDuelSpellCardPlaySessionV2(base, svc);
  const envelope = { commandId: 'opaque-recovery', expectedVersion: match.stateVersion,
    command: { cardUID: match.players[0].hand[0].uid } };
  const first = playDuelSpellCardV2(action, 'alice', envelope);
  let reads = 0;
  const claim = svc.dispatcher.claim;
  svc.dispatcher.claim = request => {
    if (request.commandId !== envelope.commandId) return claim(request);
    const outcome = Object.create(null);
    Object.defineProperty(outcome, 'status', { enumerable: true, get: () => { reads++; return 'pending'; } });
    Object.defineProperty(outcome, Symbol('opaque'), { enumerable: true, value: 'x' });
    outcome.self = outcome;
    return { status: 'duplicate', outcome };
  };
  const recovered = playDuelSpellCardV2(first.session, 'alice', envelope);
  assert.equal(recovered.outcome.status, 'blocked');
  assert.equal(reads, 0);
});

test('an actual fresh factory replays a paid response Chain with equal recorded identities and private state', () => {
  const run = () => {
    const identities = [], checkpoints = [];
    const f = respondableScene(reaction.id, makeSeats(draw.id, reaction.id), false, svc => {
      svc.chainId = 'replayed-source-chain';
      svc.identityFactory = () => { const uid = `owned-identity:${identities.length}`; identities.push(uid); return uid; };
    });
    const observe = session => {
      const privateState = inspectDuelSpellPrivateStateV2(session);
      assert.equal(Object.isFrozen(privateState.bindings), true);
      checkpoints.push({ session: JSON.parse(JSON.stringify(session)), privateState });
    };
    let r = f.result; observe(r.session);
    r = playDuelSpellCardV2(r.session, 'bob', { commandId: f.envelope.commandId,
      expectedVersion: r.session.commandSession.match.stateVersion, command: { cardUID: f.match.players[1].hand[0].uid } });
    observe(r.session); assert.equal(inspectDuelSpellPrivateStateV2(r.session).pendingCost.authorityIssued, true);
    r = passBoth(payAndFinalize(r, f.envelope.commandId, 'bob'), 'bob'); observe(r.session);
    r = resolveDuelSpellCardPlayV2(r.session); assert.equal(r.outcome.status, 'applied'); observe(r.session);
    r = passBoth(r, 'alice'); observe(r.session);
    r = resolveDuelSpellCardPlayV2(r.session); assert.equal(r.outcome.status, 'applied'); observe(r.session);
    const final = inspectDuelSpellPrivateStateV2(r.session);
    assert.equal(final.chain.identityMode, 'parent-recorded');
    assert.equal(final.chain.issuedTicketKeys.length, 2);
    assert.equal(final.expectedCommittedEffects.length, 2);
    assert.equal(final.pendingCost, null); assert.equal(final.pendingEffect, null);
    assert.equal(r.session.commandSession.match.frame.stateOpen, true);
    assert.throws(() => inspectDuelSpellPrivateStateV2(JSON.parse(JSON.stringify(r.session))), /unadmitted/);
    return { identities, checkpoints, nativeSession: r.session };
  };
  const live = run(), replay = run();
  assert.deepEqual(live.identities, ['owned-identity:0', 'owned-identity:1', 'owned-identity:2']);
  assert.deepEqual(replay.identities, live.identities);
  assert.deepEqual(replay.checkpoints, live.checkpoints);
  assert.notStrictEqual(live.nativeSession.commandSession.match, replay.nativeSession.commandSession.match);
  assert.notStrictEqual(live.nativeSession.chain, replay.nativeSession.chain);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import official from '../../card-data/data/deck-catalog.json' with { type: 'json' };
import { createDuelPointDamageOfficialProgramRegistryV1, duelAbilitySourceFromCatalog } from '@riftbound/card-dsl/duel';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2, adoptAdmittedDuelPlayingSessionV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2 } from '../dist/duel/core-v2.js';
import { placeDuelUnit } from '../dist/duel/battlefields.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from '../dist/duel/cost-resolver-v2.js';
import {
  createDuelSpellCardPlaySessionV2, playDuelSpellCardV2,
  inspectDuelSpellChainFirstLifecycleProofV3,
  inspectDuelSpellChainFirstResolvedProofV3,
} from '../dist/duel/cardplay-spell-v2.js';

const source = official.cards.find(card => card.id === 'ogs-003-024');
assert.ok(source, 'fixture Point source must exist in the official catalog');
const targetCard = {
  id: 'fixture-point-target', cardType: 'Unit', ability: '', energy: 0, power: null, might: 10,
  domains: ['Colorless'], tags: [], canonicalCardId: 'fixture-point-target', name: 'Fixture Target',
  fullName: 'Fixture Target', localizedName: 'Fixture Target', setCode: 'TST', cardNumber: 'T1', variant: 'normal',
};
const extras = ['alice', 'bob'].flatMap(player => [
  { ...targetCard, id: `${player}:unit`, canonicalCardId: `${player}:unit`, name: `${player} Unit`, fullName: `${player} Unit`, localizedName: `${player} Unit` },
  { ...targetCard, id: `${player}:champion`, cardType: 'Champion', canonicalCardId: `${player}:champion` },
  { ...targetCard, id: `${player}:legend`, cardType: 'Legend', canonicalCardId: `${player}:legend` },
  { ...targetCard, id: `${player}:rune`, cardType: 'Rune', canonicalCardId: `${player}:rune` },
  ...Array.from({ length: 3 }, (_, index) => ({ ...targetCard, id: `${player}:field:${index}`, cardType: 'Battlefield', canonicalCardId: `${player}:field:${index}` })),
]);
const catalog = { schemaVersion: 1, dataVersion: official.dataVersion, digest: official.digest, cards: [source, targetCard, ...extras] };
const programs = createDuelPointDamageOfficialProgramRegistryV1(duelAbilitySourceFromCatalog(catalog));
const card = (uid, cardId) => ({ uid, cardId });

function fixture() {
  const seats = ['alice', 'bob'].map(playerId => ({
    playerId,
    mainDeck: Array.from({ length: 8 }, (_, index) => card(`${playerId}:main:${index}`,
      playerId === 'alice' ? (index === 1 ? source.id : 'fixture-point-target') : 'fixture-point-target')),
    champion: card(`${playerId}:champion`, `${playerId}:champion`),
    legend: card(`${playerId}:legend`, `${playerId}:legend`),
    runeDeck: Array.from({ length: 4 }, (_, index) => ({ ...card(`${playerId}:rune:${index}`, `${playerId}:rune`), domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, index) => ({ instanceId: `${playerId}:field:${index}`, cardId: `${playerId}:field:${index}` })),
  }));
  const metadata = { matchId: `point-target-proof-${Date.now()}`, dataVersion: catalog.dataVersion,
    catalogDigest: catalog.digest, roster: ['alice', 'bob'].map(playerId => ({ playerId, displayName: playerId })) };
  const typeOf = id => id === source.id ? 'Other' : id === 'fixture-point-target' ? 'Unit' :
    id.includes(':champion') ? 'Champion' : id.includes(':legend') ? 'Legend' :
      id.includes(':rune') ? 'Rune' : 'Battlefield';
  let command = createDuelCommandSessionV2(seats, metadata, () => 0, typeOf);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(command, actor, { commandId: `mulligan:${actor}`,
      expectedVersion: command.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    assert.equal(result.outcome.status, 'applied');
    command = result.session;
  }
  command = { ...command, match: channelDuelRunesV2(command.match, 'alice', 1) };
  let match = commitDuelPlayingMutationV2(command.match, draft => ({ match: {
    ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, value]) => [uid, { ...value, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' },
  }, transitions: [] }));
  const target = match.players[0].hand.find(value => value.cardId === 'fixture-point-target');
  assert.ok(target, 'target must be in the opening hand');
  const field = match.board.battlefields.find(value => value.ownerPlayerId === 'alice');
  assert.ok(field);
  match = commitDuelPlayingMutationV2(match, draft => {
    const board = placeDuelUnit(draft.board, { objectId: target.uid, controllerPlayerId: 'alice', locationId: field.locationId });
    return { match: { ...draft,
      board,
      players: draft.players.map(player => player.playerId === 'alice'
        ? { ...player, hand: player.hand.filter(value => value.uid !== target.uid) } : player),
      unitMeta: { ...draft.unitMeta, [target.uid]: { ownerPlayerId: 'alice', readied: false,
        damageMarks: [], trait: { kind: 'card', cardId: target.cardId } } },
    }, transitions: [{ uid: target.uid, from: { kind: 'hand', zonePlayerId: 'alice' },
      to: { kind: 'board-battlefield', locationId: field.locationId } }] };
  });
  const sourceCard = match.players[0].hand.find(value => value.cardId === source.id);
  assert.ok(sourceCard, 'Point source must remain in the hand');
  const epoch = match.physicalCardsByUID[sourceCard.uid].zoneEpoch;
  const facts = { registryRevision: 'target-proof-r1', catalogRevision: catalog.digest,
    nonResourceCosts: 'none', base: { cost: { energy: 0, power: [] }, sourceUid: sourceCard.uid, sourceEpoch: epoch },
    candidates: [], orderedModifiers: [] };
  const authority = createDuelCostResolverAuthorityV2(request => ({ request,
    base: { request, status: 'complete', proofId: 'target-proof-base', cost: facts.base.cost,
      sourceUid: sourceCard.uid, sourceEpoch: epoch, registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision },
    coverage: { request, status: 'complete', proofId: 'target-proof-coverage', allModifierSourcesCovered: true,
      choicesResolved: true, nonResourceCosts: 'none', registryRevision: facts.registryRevision,
      catalogRevision: facts.catalogRevision, ...fingerprintDuelCostCoverageV2(facts) }, proofs: [], modifiers: []
  }), () => facts);
  const claims = new Map(), committed = new Map();
  let nativeRequest;
  const service = {
    programs, cardPlayOrder: 'chain-first-v3', pointDamageSpellV1: true, cost: authority,
    costForChain: request => { nativeRequest = request; return authority; },
    costBinding: request => ({ ...request, status: 'complete' }),
    sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: request.sourceReference, sourceProofId: 'target-proof-source', mode: 'current',
      sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}), ...(request.continuationId ? { continuationId: request.continuationId } : {}) }),
    dispatcher: {
      claim: request => { const key = `${request.actor}:${request.commandId}`; const prior = claims.get(key);
        if (prior) return { status: 'duplicate', outcome: prior.outcome }; const claim = { key }; claims.set(key, { claim }); return { status: 'new', claim }; },
      finish: request => { for (const row of claims.values()) if (row.claim === request.claim) row.outcome = request.outcome; },
      readCommitted: ticket => committed.get(ticket.idempotencyKey) ?? null,
      commitEffect: request => { committed.set(request.ticket.idempotencyKey, request.receipt); },
    },
    closure: { pointDamage: {} },
  };
  const session = createDuelSpellCardPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(match), service);
  const result = playDuelSpellCardV2(session, 'alice', { commandId: 'target-proof-play', expectedVersion: match.stateVersion,
    command: { cardUID: sourceCard.uid, targetUIDs: [target.uid] } });
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.outcome.step, 'payment');
  return { result, nativeRequest, targetUID: target.uid };
}

test('native Point callback publishes one frozen target array to lifecycle and resolved proofs', () => {
  const context = fixture();
  const lifecycle = inspectDuelSpellChainFirstLifecycleProofV3(context.nativeRequest);
  const resolved = inspectDuelSpellChainFirstResolvedProofV3(context.nativeRequest);
  assert.ok(lifecycle);
  assert.ok(resolved);
  assert.strictEqual(lifecycle.targetUIDs, context.nativeRequest.targetUIDs);
  assert.strictEqual(resolved.lifecycle.targetUIDs, lifecycle.targetUIDs);
  assert.strictEqual(resolved.lifecycle.targetUIDs, resolved.lifecycle.request.targetUIDs);
  assert.equal(Object.isFrozen(context.nativeRequest.targetUIDs), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(context.nativeRequest.targetUIDs, '0'),
    { value: context.targetUID, writable: false, enumerable: true, configurable: false });
});

test('native Point callback rejects target mutation and toJSON spoofing without losing proof', () => {
  const context = fixture();
  const native = context.nativeRequest;
  const proof = inspectDuelSpellChainFirstLifecycleProofV3(native);
  assert.ok(proof);
  assert.throws(() => { native.targetUIDs[0] = 'forged-target'; }, TypeError);
  assert.throws(() => Object.defineProperty(native.targetUIDs, 'toJSON', { value: () => [context.targetUID] }), TypeError);
  assert.strictEqual(inspectDuelSpellChainFirstLifecycleProofV3(native), proof);
  assert.strictEqual(inspectDuelSpellChainFirstResolvedProofV3(native).lifecycle, proof);
});

test('lifecycle proof comparison does not call clone toJSON, index getters, or iterators', () => {
  const context = fixture();
  const native = context.nativeRequest;
  const proof = inspectDuelSpellChainFirstLifecycleProofV3(native);
  assert.ok(proof);
  let toJSONCalls = 0;
  const jsonClone = [context.targetUID];
  Object.defineProperty(jsonClone, 'toJSON', { value: () => { toJSONCalls++; return [context.targetUID]; } });
  Object.freeze(jsonClone);
  assert.equal(inspectDuelSpellChainFirstLifecycleProofV3({ ...native, targetUIDs: jsonClone }), null);
  assert.equal(toJSONCalls, 0);
  let getterCalls = 0;
  const getterClone = [context.targetUID];
  Object.defineProperty(getterClone, '0', { enumerable: true, configurable: true, get: () => { getterCalls++; return context.targetUID; } });
  Object.freeze(getterClone);
  assert.equal(inspectDuelSpellChainFirstLifecycleProofV3({ ...native, targetUIDs: getterClone }), null);
  assert.equal(getterCalls, 0);
  let iteratorCalls = 0;
  const iteratorClone = [context.targetUID];
  Object.defineProperty(iteratorClone, Symbol.iterator, { value: () => { iteratorCalls++; throw Error('iterator called'); } });
  Object.freeze(iteratorClone);
  assert.equal(inspectDuelSpellChainFirstLifecycleProofV3({ ...native, targetUIDs: iteratorClone }), null);
  assert.equal(iteratorCalls, 0);
  assert.equal(inspectDuelSpellChainFirstLifecycleProofV3({ ...native, targetUIDs: Object.freeze(['changed-target']) }), null);
  assert.strictEqual(inspectDuelSpellChainFirstLifecycleProofV3(native), proof);
});

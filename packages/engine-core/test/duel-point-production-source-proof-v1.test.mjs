import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelOfficialProgramRegistry, duelAbilitySourceFromCatalog } from '@riftbound/card-dsl/duel';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2, adoptAdmittedDuelPlayingSessionV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, commitDuelPlayingMutationV2 } from '../dist/duel/core-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from '../dist/duel/cost-resolver-v2.js';
import { createDuelSpellCardPlaySessionV2, playDuelSpellCardV2,
  inspectDuelSpellChainFirstLifecycleProofV3,
  inspectDuelSpellChainFirstResolvedProofV3 } from '../dist/duel/cardplay-spell-v2.js';

test('Point production lifecycle inspector rejects wire-shaped and cloned Chain requests', () => {
  const request = {
    commandSession: {}, match: {}, chain: { chainId: 'foreign', stateVersion: 1 },
    cardUID: 'spell', cardId: 'point', controller: 'alice', sourceEpoch: 1,
    targetUIDs: ['unit'], transactionId: '["foreign",1,"alice","cmd","spell",1,["unit"]]',
    authority: {},
  };
  assert.equal(inspectDuelSpellChainFirstLifecycleProofV3(request), null);
  assert.equal(inspectDuelSpellChainFirstLifecycleProofV3(structuredClone(request)), null);
  assert.equal(inspectDuelSpellChainFirstResolvedProofV3(request), null);
});

test('native Chain-first callback binds its exact request to the resolved full cost', () => {
  const printing = { id: 'proof-draw', cardType: 'Spell', ability: 'Draw 4.', energy: 0,
    power: null, might: null, domains: [], tags: [], canonicalCardId: 'proof-draw',
    name: 'Proof Draw', fullName: 'Proof Draw', localizedName: 'Proof Draw', setCode: 'TST', cardNumber: 'P1', variant: 'normal' };
  const extras = ['alice', 'bob'].flatMap(player => [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `${player}:field:${i}`, cardType: 'Battlefield' })),
    { id: `${player}:champion`, cardType: 'Champion' }, { id: `${player}:legend`, cardType: 'Legend' },
    { id: `${player}:rune`, cardType: 'Rune' },
  ]).map(card => ({ ...printing, ...card, ability: '' }));
  const catalog = { dataVersion: 'proof-v1', digest: 'proof-v1', cards: [printing, ...extras] };
  const programs = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog(catalog));
  const card = (uid, cardId = printing.id) => ({ uid, cardId });
  const seats = ['alice', 'bob'].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 10 }, (_, i) => card(`${playerId}:m:${i}`)),
    champion: card(`${playerId}:c`, `${playerId}:champion`), legend: card(`${playerId}:l`, `${playerId}:legend`),
    runeDeck: Array.from({ length: 3 }, (_, i) => ({ ...card(`${playerId}:r:${i}`, `${playerId}:rune`), domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}:f:${i}`, cardId: `${playerId}:field:${i}` })) }));
  const metadata = { matchId: 'proof-match', dataVersion: catalog.dataVersion, catalogDigest: catalog.digest,
    roster: ['alice', 'bob'].map(playerId => ({ playerId, displayName: playerId })) };
  const typeOf = id => id === printing.id ? 'Other' : id.includes(':c') ? 'Champion' : id.includes(':l') ? 'Legend' : id.includes(':rune') ? 'Rune' : id.includes(':field:') ? 'Battlefield' : 'Unit';
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, typeOf);
  for (const actor of ['alice', 'bob']) session = applyDuelResourceCommandV2(session, actor,
    { commandId: `m:${actor}`, expectedVersion: session.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } }).session;
  let match = channelDuelRunesV2(session.match, 'alice', 1);
  match = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, value]) => [uid, { ...value, readiness: 'ready' }])),
    frame: { ...draft.frame, phase: 'main', stateOpen: true, priorityPlayerId: 'alice', turnPlayerId: 'alice' } }, transitions: [] }));
  let seen = null, nativeRequest = null;
  const facts = { registryRevision: 'proof-r1', catalogRevision: catalog.digest, nonResourceCosts: 'none',
    base: { cost: { energy: 0, power: [] }, sourceUid: 'alice:m:0', sourceEpoch: 1 }, candidates: [], orderedModifiers: [] };
  const authority = createDuelCostResolverAuthorityV2(request => ({ request,
    base: { ...facts.base, request, proofId: 'proof-base', status: 'complete', registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision },
    coverage: { request, proofId: 'proof-coverage', status: 'complete', allModifierSourcesCovered: true, choicesResolved: true,
      nonResourceCosts: 'none', registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision, ...fingerprintDuelCostCoverageV2(facts) }, proofs: [], modifiers: [] }),
    () => facts);
  const services = { programs, cardPlayOrder: 'chain-first-v3', cost: authority,
    costForChain: request => {
      nativeRequest = request;
      seen = inspectDuelSpellChainFirstLifecycleProofV3(request);
      assert.ok(seen);
      assert.equal(inspectDuelSpellChainFirstLifecycleProofV3(structuredClone(request)), null);
      assert.equal(inspectDuelSpellChainFirstResolvedProofV3(request), null);
      return authority;
    }, costBinding: request => ({ ...request, status: 'complete' }),
    sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: request.sourceReference, sourceProofId: 'proof-source', mode: 'current',
      sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch }),
    dispatcher: { claim: request => ({ status: 'new', claim: request }), finish: () => {}, readCommitted: () => null, commitEffect: () => {} },
    closure: { draw: { randomIndex: upper => upper - 1 } } };
  const action = createDuelSpellCardPlaySessionV2(adoptAdmittedDuelPlayingSessionV2(match), services);
  const uid = match.players[0].hand[0].uid;
  const result = playDuelSpellCardV2(action, 'alice', { commandId: 'proof-play', expectedVersion: match.stateVersion, command: { cardUID: uid } });
  assert.equal(result.outcome.status, 'pending');
  assert.ok(seen);
  const resolved = inspectDuelSpellChainFirstResolvedProofV3(nativeRequest);
  assert.equal(resolved.lifecycle, seen);
  assert.equal(resolved.authority, authority);
  assert.deepEqual(resolved.resolved.finalResolvedCost, { energy: 0, power: [] });
  assert.equal(inspectDuelSpellChainFirstResolvedProofV3({ ...nativeRequest }), null);
  assert.equal(inspectDuelSpellChainFirstResolvedProofV3(structuredClone(nativeRequest)), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import officialCatalog from '../../card-data/data/deck-catalog.json' with { type: 'json' };
import {
  createDuelMatchV2, resolveDuelMulliganV2, commitDuelPlayingMutationV2,
  moveDuelPhysicalCardToChainV2, attestDuelTokenSourceV2, createDuelRecruitUnitV2,
  assertAdmittedDuelMatchV2, inspectDuelNativeOriginV2, inspectDuelNativeCommitPathV2,
} from '../dist/duel/core-v2.js';
import { placeDuelUnit } from '../dist/duel/battlefields.js';
import {
  createDuelPointDamageEffectAuthorityV1,
  beginDuelPointDamageEffectV1,
  submitDuelPointDamageEffectChoiceV1,
  DuelKillDamageEffectBlockedErrorV2,
} from '../dist/duel/point-damage-effect-executor-v1.js';
import {
  createDuelPointDamageOfficialProgramRegistryV1,
  duelAbilitySourceFromCatalog,
} from '../../card-dsl/dist/duel/official-programs.js';

const DATA_VERSION = officialCatalog.dataVersion;
const DIGEST = officialCatalog.digest;
const POINT_IDS = ['ogs-003-024', 'ogn-009-298', 'ogn-085-298', 'ogs-022-024'];
const real = (id) => officialCatalog.cards.find((card) => card.id === id);
const pointCards = POINT_IDS.map(real);

function synthetic(id, cardType, ability = '') {
  return {
    id, cardType, ability, energy: cardType === 'Unit' ? 1 : null,
    power: null, might: cardType === 'Unit' ? 1 : null, domains: ['Colorless'], tags: [],
    canonicalCardId: `fixture-${id}`, name: id, fullName: id, localizedName: id,
    setCode: 'fixture', cardNumber: id, variant: 'standard',
  };
}

const cards = [
  ...pointCards,
  synthetic('fixture-unit', 'Unit'), synthetic('fixture-champion', 'Champion'), synthetic('fixture-legend', 'Legend'),
  synthetic('fixture-rune', 'Rune'),
  ...['a', 'b'].flatMap((player) => Array.from({ length: 3 }, (_, i) =>
    synthetic(`${player}-field-${i}`, 'Battlefield'))),
];
const catalog = { schemaVersion: 1, dataVersion: DATA_VERSION, digest: DIGEST, cards };
const registry = createDuelPointDamageOfficialProgramRegistryV1(duelAbilitySourceFromCatalog(catalog));
const approved = { status: 'approved', proofId: 'point-fixture-proof' };

function scene(sourceId, targetLocation = 'base') {
  const seats = ['a', 'b'].map((playerId) => ({
    playerId,
    mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-${i}`,
      cardId: playerId === 'a' && i === 1 ? sourceId : 'fixture-unit' })),
    champion: { uid: `${playerId}-champion`, cardId: 'fixture-champion' },
    legend: { uid: `${playerId}-legend`, cardId: 'fixture-legend' },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
      cardId: 'fixture-rune', domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
      cardId: `${playerId}-field-${i}` })),
  }));
  const metadata = { matchId: `point-${sourceId}-${targetLocation}-${Date.now()}-${Math.random()}`,
    dataVersion: DATA_VERSION, catalogDigest: DIGEST,
    roster: seats.map((seat) => ({ playerId: seat.playerId, displayName: seat.playerId })) };
  const typeOf = (cardId) => cards.find((card) => card.id === cardId)?.cardType === 'Spell' ? 'Other' :
    cards.find((card) => card.id === cardId)?.cardType;
  let state = createDuelMatchV2(seats, metadata, () => 0, typeOf);
  state = resolveDuelMulliganV2(state, 'a', []);
  state = resolveDuelMulliganV2(state, 'b', []);
  const aliceUnits = state.players[0].hand.filter((card) => card.cardId === 'fixture-unit').slice(0, 2);
  const bobUnits = state.players[1].hand.filter((card) => card.cardId === 'fixture-unit').slice(0, 1);
  const targetUID = aliceUnits[0].uid;
  state = commitDuelPlayingMutationV2(state, (draft) => {
    let board = draft.board;
    const base = board.bases.find((entry) => entry.ownerPlayerId === 'a').locationId;
    const bobBase = board.bases.find((entry) => entry.ownerPlayerId === 'b').locationId;
    const battlefield = board.battlefields.find((entry) => entry.ownerPlayerId === 'a').locationId;
    const locationId = targetLocation === 'battlefield' ? battlefield : base;
    for (const entry of [...aliceUnits, ...bobUnits]) {
      const destination = entry.uid === targetUID ? locationId : (entry.uid.startsWith('a-') ? base : bobBase);
      board = placeDuelUnit(board, { objectId: entry.uid, controllerPlayerId: entry.uid.startsWith('a-') ? 'a' : 'b', locationId: destination });
    }
    const placed = new Set([...aliceUnits, ...bobUnits].map((entry) => entry.uid));
    return {
      match: { ...draft, board, frame: { ...draft.frame, phase: 'main' },
        legendStates: Object.fromEntries(Object.entries(draft.legendStates)
          .map(([uid, value]) => [uid, { ...value, readiness: 'ready' }])),
        players: draft.players.map((player) => ({ ...player,
          hand: player.hand.filter((entry) => !placed.has(entry.uid)),
          remainingMainDeck: player.remainingMainDeck.filter((entry) => !placed.has(entry.uid)),
        })),
        unitMeta: Object.fromEntries([...aliceUnits, ...bobUnits].map((entry) => [entry.uid, {
          ownerPlayerId: entry.uid.startsWith('a-') ? 'a' : 'b', readied: false,
          damageMarks: [], trait: { kind: 'card', cardId: 'fixture-unit' },
        }])),
      },
      transitions: [...aliceUnits, ...bobUnits].map((entry) => ({ uid: entry.uid,
        from: { kind: 'hand', zonePlayerId: entry.uid.startsWith('a-') ? 'a' : 'b' },
        to: { kind: targetLocation === 'battlefield' && entry.uid === targetUID ? 'board-battlefield' : 'board-base', locationId:
          entry.uid === targetUID ? locationId : (entry.uid.startsWith('a-') ? base : bobBase) },
      })),
    };
  });
  const source = registry.reference(sourceId);
  const sourceEntry = state.players[0].hand.find((entry) => entry.cardId === sourceId);
  assert.ok(sourceEntry, `source ${sourceId} must be in the initial hand`);
  const sourceUID = sourceEntry.uid;
  const sourceCardBeforeChain = state.physicalCardsByUID[sourceUID];
  state = moveDuelPhysicalCardToChainV2(state,
    { uid: sourceUID, zoneEpoch: sourceCardBeforeChain.zoneEpoch }, 'a');
  const sourceCard = state.physicalCardsByUID[sourceUID];
  const sourceTuple = {
    sourceUID, sourceZoneEpoch: sourceCard.zoneEpoch, controllerPlayerId: 'a', cardId: source.cardId,
    programId: source.programId, dataVersion: DATA_VERSION, catalogDigest: DIGEST,
    effectId: `point-effect-${sourceId}-${targetLocation}`, phase: 'spell-resolution', window: 'main',
  };
  let head = state;
  const options = {
    state, source: sourceTuple, registry, readHead: () => head,
    verifyCost: () => approved,
    verifyChain: () => ({ ...approved, selectionTiming: 'finalization' }),
    resolveDamage: ({ targetUIDs, amount, source: effectSource }) => ({
      ...approved, resolvedMarks: targetUIDs.map((uid) => ({ uid, amount,
        responsiblePlayerId: effectSource.controllerPlayerId, sourceObjectIds: [effectSource.sourceUID, effectSource.effectId] })),
      targetLegality: 'approved', preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled',
    }),
    resolveLethal: ({ plan, proposedDamage }) => ({ ...approved, approvedUnitUIDs: [],
      targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved', proposal: proposedDamage,
      lethalProof: { kind: 'duel-lethal-candidate-proof-v2', proposal: proposedDamage,
        candidates: [], evaluatorProofId: 'point-fixture-lethal-proof' } }),
  };
  return { state, targetUID, source: sourceTuple, options, get head() { return head; }, setHead: (next) => { head = next; } };
}

const choose = (ctx, authority, targetUID = ctx.targetUID) => submitDuelPointDamageEffectChoiceV1(authority, {
  expectedStateVersion: ctx.state.stateVersion, actorPlayerId: 'a', targetUIDs: [targetUID],
});
const blocked = (fn, code) => assert.throws(fn,
  (error) => error instanceof DuelKillDamageEffectBlockedErrorV2 && error.code === code);
const candidateEvidence = (request, ids) => ids.map(unitUID => ({ unitUID, currentMight: 1,
  lethalDamageThreshold: 1, totalDamage: request.plan.snapshots.find(snapshot => snapshot.objectId === unitUID).totalDamage }));
const lethalApproval = (request, candidateUnitUIDs = []) => ({ ...approved,
  approvedUnitUIDs: [], targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved',
  proposal: request.proposedDamage,
  lethalProof: { kind: 'duel-lethal-candidate-proof-v2', proposal: request.proposedDamage,
    candidates: candidateEvidence(request, candidateUnitUIDs), evaluatorProofId: 'point-fixture-lethal-proof' } });

test('all four real point-damage printings carry their fixed amount through the Core kernel', () => {
  const amounts = [2, 3, 6, 8];
  for (let i = 0; i < POINT_IDS.length; i++) {
    const ctx = scene(POINT_IDS[i], i === 3 ? 'base' : 'battlefield');
    let requested;
    const options = { ...ctx.options, resolveDamage: ({ targetUIDs, amount, source }) => {
      requested = amount;
      return { ...ctx.options.resolveDamage({ targetUIDs, amount, source }) };
    } };
    const authority = createDuelPointDamageEffectAuthorityV1(options);
    assert.equal(beginDuelPointDamageEffectV1(authority).status, 'pending');
    const result = submitDuelPointDamageEffectChoiceV1(authority, {
      expectedStateVersion: ctx.state.stateVersion, actorPlayerId: 'a', targetUIDs: [ctx.targetUID],
    });
    assert.equal(result.status, 'complete');
    assert.equal(requested, amounts[i]);
    assert.equal(result.state.unitMeta[ctx.targetUID].damageMarks[0].amount, amounts[i]);
  }
});

test('Battlefield-qualified point damage rejects Base targets and unqualified 8 accepts Base', () => {
  const battlefield = scene('ogn-009-298', 'base');
  const authority = createDuelPointDamageEffectAuthorityV1(battlefield.options);
  beginDuelPointDamageEffectV1(authority);
  blocked(() => choose(battlefield, authority), 'illegal-target');
  const anyLocation = scene('ogs-022-024', 'base');
  const anyAuthority = createDuelPointDamageEffectAuthorityV1(anyLocation.options);
  assert.equal(choose(anyLocation, anyAuthority).status, 'complete');
});

test('source epoch, response head and duplicate effect identity remain protected', () => {
  const ctx = scene('ogn-085-298', 'battlefield');
  blocked(() => createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    source: { ...ctx.source, sourceZoneEpoch: ctx.source.sourceZoneEpoch + 1 } }), 'source-not-live');
  blocked(() => createDuelPointDamageEffectAuthorityV1({ ...ctx.options, registry: {} }), 'source-program-mismatch');
  blocked(() => createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    registry: { reference: () => { throw new Error('forged registry'); }, resolve: () => null } }), 'source-program-mismatch');
  const authority = createDuelPointDamageEffectAuthorityV1(ctx.options);
  assert.equal(beginDuelPointDamageEffectV1(authority).status, 'pending');
  ctx.setHead(commitDuelPlayingMutationV2(ctx.state, (draft) => ({
    match: { ...draft, legendStates: Object.fromEntries(Object.entries(draft.legendStates)
      .map(([uid, value], index) => [uid, index === 0 ? { ...value, readiness: 'exhausted' } : value])) },
    transitions: [],
  })));
  blocked(() => choose(ctx, authority), 'stale-head');
  const fresh = scene('ogn-085-298', 'battlefield');
  createDuelPointDamageEffectAuthorityV1(fresh.options);
  blocked(() => createDuelPointDamageEffectAuthorityV1(fresh.options), 'duplicate-effect-id');
});

test('point damage can use the real lethal kernel and move the physical Unit to owner Trash', () => {
  const ctx = scene('ogs-022-024', 'base');
  const options = {
    ...ctx.options,
    resolveLethal: ({ plan, proposedDamage }) => ({ ...approved,
      approvedUnitUIDs: plan.snapshots.map((snapshot) => snapshot.objectId),
      targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved', proposal: proposedDamage,
      lethalProof: { kind: 'duel-lethal-candidate-proof-v2', proposal: proposedDamage,
        candidates: candidateEvidence({ plan }, plan.snapshots.map((snapshot) => snapshot.objectId)), evaluatorProofId: 'point-fixture-lethal-proof' } }),
  };
  const result = choose(ctx, createDuelPointDamageEffectAuthorityV1(options));
  assert.equal(result.status, 'complete');
  assert.equal(result.state.board.units.some((unit) => unit.objectId === ctx.targetUID), false);
  assert.equal(result.state.players[0].trash.some((card) => card.uid === ctx.targetUID), true);
  assert.equal(result.notices.some((notice) => notice.kind === 'Killed'), true);
});

test('point damage remains pending when the lethal/cleanup closure is unknown', () => {
  const ctx = scene('ogs-022-024', 'base');
  const authority = createDuelPointDamageEffectAuthorityV1({ ...ctx.options, resolveLethal: undefined });
  const result = choose(ctx, authority);
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'lethal-cleanup-proof-required');
  assert.equal(result.state, ctx.state);
  assert.equal(ctx.state.unitMeta[ctx.targetUID].damageMarks.length, 0);
});

test('mechanism fixture: token damage keeps identity and a token lethal approval stays pending', () => {
  const base = scene('ogs-022-024', 'base');
  const locationId = base.state.board.bases.find((entry) => entry.ownerPlayerId === 'a').locationId;
  const request = {
    kind: 'recruit', tokenUID: 'fixture-recruit-token', sourceEffectId: 'fixture-token-effect',
    eventId: 'fixture-token-event', sourceUID: base.source.sourceUID,
    sourceZoneEpoch: base.source.sourceZoneEpoch, sourceMode: 'current',
    effectControllerPlayerId: 'a', controllerPlayerId: 'a', locationId, readied: false,
    name: 'Recruit', baseMight: 1, tags: ['Recruit'],
  };
  const issued = attestDuelTokenSourceV2(base.state, request, ({ match, request: proposed }) => ({
    ...proposed, matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, sourceProofId: 'fixture-token-source-proof',
  }));
  const tokenState = createDuelRecruitUnitV2(base.state, request, issued.authority);
  const token = { ...base, state: tokenState, targetUID: request.tokenUID };
  const mark = createDuelPointDamageEffectAuthorityV1({ ...token.options,
    state: tokenState, readHead: () => tokenState,
    source: { ...token.source, effectId: 'fixture-token-damage' },
    resolveLethal: ({ proposedDamage }) => ({ ...approved, approvedUnitUIDs: [],
      targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved', proposal: proposedDamage,
      lethalProof: { kind: 'duel-lethal-candidate-proof-v2', proposal: proposedDamage,
        candidates: [], evaluatorProofId: 'point-fixture-lethal-proof' } }),
  });
  const marked = choose({ ...token, state: tokenState }, mark);
  assert.equal(marked.status, 'complete');
  assert.equal(marked.state.unitMeta[request.tokenUID].damageMarks[0].amount, 8);
  assert.equal(marked.state.board.units.some((unit) => unit.objectId === request.tokenUID), true);

  const lethal = createDuelPointDamageEffectAuthorityV1({ ...token.options,
    state: marked.state, readHead: () => marked.state,
    source: { ...token.source, effectId: 'fixture-token-lethal' },
    resolveLethal: ({ plan, proposedDamage }) => ({ ...approved,
      approvedUnitUIDs: plan.snapshots.map((snapshot) => snapshot.objectId),
      targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved', proposal: proposedDamage,
      lethalProof: { kind: 'duel-lethal-candidate-proof-v2', proposal: proposedDamage,
        candidates: candidateEvidence({ plan }, plan.snapshots.map((snapshot) => snapshot.objectId)), evaluatorProofId: 'point-fixture-lethal-proof' } }),
  });
  const result = choose({ ...token, state: marked.state }, lethal);
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'token-lethal-core-api-required');
  assert.equal(result.state.board.units.some((unit) => unit.objectId === request.tokenUID), true);
  assert.equal(result.state.unitMeta[request.tokenUID].damageMarks.length, 1);
});

test('point damage accepts trusted partial prevention and keeps the admitted head in lethal closure', () => {
  const ctx = scene('ogs-022-024', 'base');
  let lethalRequest;
  const authority = createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    resolveDamage: ({ targetUIDs, source }) => ({ ...approved,
      resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 2,
        responsiblePlayerId: source.controllerPlayerId, sourceObjectIds: [source.sourceUID, source.effectId] })),
      targetLegality: 'approved', preventionReplacement: 'resolved', attribution: 'approved',
      requiredCleanup: 'scheduled' }),
    resolveLethal: request => {
      lethalRequest = request;
      assert.strictEqual(request.state, ctx.state);
      assert.doesNotThrow(() => assertAdmittedDuelMatchV2(request.state));
      assert.doesNotThrow(() => inspectDuelNativeOriginV2(request.state));
      assert.doesNotThrow(() => inspectDuelNativeCommitPathV2(ctx.state, request.state));
      assert.equal(request.proposedDamage.marks[0].amount, 2);
      assert.equal(request.proposedDamage.baseStateVersion, ctx.state.stateVersion);
      return lethalApproval(request);
    },
  });
  const result = choose(ctx, authority);
  assert.equal(result.status, 'complete');
  assert.equal(result.state.unitMeta[ctx.targetUID].damageMarks[0].amount, 2);
  assert.equal(result.state.board.units.some(unit => unit.objectId === ctx.targetUID), true);
  assert.ok(lethalRequest.plan.snapshots.some(snapshot => snapshot.objectId === ctx.targetUID));
});

test('full prevention remains a terminal no-change and does not invoke lethal cleanup', () => {
  const ctx = scene('ogs-022-024', 'base');
  let invoked = false;
  const authority = createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    resolveDamage: () => ({ ...approved, resolvedMarks: [], targetLegality: 'approved',
      preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled' }),
    resolveLethal: () => { invoked = true; return { status: 'pending' }; },
  });
  const result = choose(ctx, authority);
  assert.equal(result.status, 'no-change');
  assert.strictEqual(result.state, ctx.state);
  assert.equal(invoked, false);
  assert.equal(ctx.state.unitMeta[ctx.targetUID].damageMarks.length, 0);
});

test('point damage rejects forged source attribution and malformed resolved amounts', () => {
  const forged = scene('ogs-022-024', 'base');
  const forgedAuthority = createDuelPointDamageEffectAuthorityV1({ ...forged.options,
    resolveDamage: ({ targetUIDs, source }) => ({ ...approved,
      resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 2, responsiblePlayerId: 'a',
        sourceObjectIds: [source.sourceUID, 'forged-unbound-object'] })),
      targetLegality: 'approved', preventionReplacement: 'resolved', attribution: 'approved',
      requiredCleanup: 'scheduled' }),
  });
  blocked(() => choose(forged, forgedAuthority), 'internal-error');

  const malformed = scene('ogs-022-024', 'base');
  const malformedAuthority = createDuelPointDamageEffectAuthorityV1({ ...malformed.options,
    resolveDamage: ({ targetUIDs, source }) => ({ ...approved,
      resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 0, responsiblePlayerId: 'a',
        sourceObjectIds: [source.sourceUID, source.effectId] })),
      targetLegality: 'approved', preventionReplacement: 'resolved', attribution: 'approved',
      requiredCleanup: 'scheduled' }),
  });
  blocked(() => choose(malformed, malformedAuthority), 'internal-error');
});

test('host callback throw is recoverable pending, while lethal candidate proof is proposal-bound', () => {
  const ctx = scene('ogs-022-024', 'base');
  let damageAttempts = 0;
  const authority = createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    resolveDamage: request => {
      if (damageAttempts++ === 0) throw new Error('temporary host failure');
      return ctx.options.resolveDamage(request);
    },
  });
  assert.equal(choose(ctx, authority).reason, 'damage-proof-pending');
  assert.equal(choose(ctx, authority).status, 'complete');

  const malformed = scene('ogs-022-024', 'base');
  const malformedAuthority = createDuelPointDamageEffectAuthorityV1({ ...malformed.options,
    resolveLethal: request => ({ ...lethalApproval(request), proposal: { ...request.proposedDamage } }),
  });
  blocked(() => choose(malformed, malformedAuthority), 'internal-error');
});

test('lethal callback throw is recoverable without committing the provisional marks twice', () => {
  const ctx = scene('ogs-022-024', 'base');
  let attempts = 0;
  const authority = createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    resolveLethal: request => {
      if (attempts++ === 0) throw new Error('temporary cleanup failure');
      return lethalApproval(request);
    },
  });
  const first = choose(ctx, authority);
  assert.equal(first.status, 'pending');
  assert.equal(first.reason, 'lethal-cleanup-pending');
  assert.equal(ctx.state.unitMeta[ctx.targetUID].damageMarks.length, 0);
  const second = choose(ctx, authority);
  assert.equal(second.status, 'complete');
  assert.equal(second.state.unitMeta[ctx.targetUID].damageMarks.length, 1);
  assert.equal(second.state.unitMeta[ctx.targetUID].damageMarks[0].amount, 8);
});

test('lethal callback drift fails closed and can be retried only from the canonical head', () => {
  const ctx = scene('ogs-022-024', 'base');
  const authority = createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    resolveLethal: request => {
      ctx.setHead(commitDuelPlayingMutationV2(ctx.state, draft => ({
        match: { ...draft, frame: { ...draft.frame, stateOpen: !draft.frame.stateOpen } }, transitions: [],
      })));
      return lethalApproval(request);
    },
  });
  blocked(() => choose(ctx, authority), 'stale-head');
  assert.equal(ctx.head.unitMeta[ctx.targetUID].damageMarks.length, 0);
});

test('a cleanup callback cannot alter damage inside its read-only proposal plan', () => {
  const ctx = scene('ogs-022-024', 'base');
  const authority = createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    resolveLethal: request => {
      const snapshot = request.proposedDamage.plan.snapshots.find(item => item.objectId === ctx.targetUID);
      assert.equal(snapshot.damageMarks[0].amount, 8);
      assert.throws(() => { snapshot.damageMarks[0].amount = 99; }, TypeError);
      assert.throws(() => { snapshot.damageMarks[0].responsiblePlayerId = 'b'; }, TypeError);
      return lethalApproval(request);
    },
  });
  const settled = choose(ctx, authority);
  assert.equal(settled.status, 'complete');
  assert.equal(settled.state.unitMeta[ctx.targetUID].damageMarks[0].amount, 8);
  assert.equal(settled.state.unitMeta[ctx.targetUID].damageMarks[0].responsiblePlayerId, 'a');
});


test('Point Core rejects damage responsibility attributed to the other player', () => {
  const ctx = scene('ogs-022-024', 'base');
  const authority = createDuelPointDamageEffectAuthorityV1({ ...ctx.options,
    resolveDamage: ({ targetUIDs, source }) => ({ ...approved,
      resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 2, responsiblePlayerId: 'b',
        sourceObjectIds: [source.sourceUID, source.effectId] })),
      targetLegality: 'approved', preventionReplacement: 'resolved', attribution: 'approved',
      requiredCleanup: 'scheduled' }),
  });
  blocked(() => choose(ctx, authority), 'internal-error');
  assert.equal(ctx.state.unitMeta[ctx.targetUID].damageMarks.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelMatchV2, resolveDuelMulliganV2, attestDuelTokenSourceV2,
  createDuelGoldTokenV2, activateDuelGoldPowerV2, createDuelRecruitUnitV2,
  killRetireDuelUnitTokenV2, commitDuelPlayingMutationV2, restoreDuelPlayingStateV2,
  enumerateDuelObjectsV2,
} from '../dist/duel/core-v2.js';

// Independently fixed test receipt, not an echo of a proposed token's source. Not production IR.
const clone = structuredClone;
const same = value => JSON.stringify(value);
const timing = () => ({ stateOpen: true, priorityPlayerId: 'a', resourcePaymentPlayerId: null });
function fixture() {
  const seats = ['a', 'b'].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 9 }, (_, i) => ({ uid: `${playerId}-c-${i}`, cardId: `print-${i}` })),
    champion: { uid: `${playerId}-champ`, cardId: 'champ' },
    legend: { uid: `${playerId}-legend`, cardId: 'legend' },
    runeDeck: Array.from({ length: 4 }, (_, i) => ({ uid: `${playerId}-r-${i}`, cardId: 'rune', domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-f-${i}`, cardId: `field-${i}` })),
  }));
  const setup = createDuelMatchV2(seats, {
    matchId: 'token-invariants-independent', dataVersion: 'test-catalog-v1', catalogDigest: 'sha256:test-catalog',
    roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })),
  }, () => 0, cardId => cardId === 'champ' ? 'Champion' : cardId === 'legend' ? 'Legend' :
    cardId === 'rune' ? 'Rune' : cardId.startsWith('field-') ? 'Battlefield' : 'Unit');
  const first = resolveDuelMulliganV2(setup, 'a', []);
  const state = resolveDuelMulliganV2(first, 'b', []);
  assert.equal(state.stage, 'playing');
  return { setup, state, base: state.board.bases.find(b => b.ownerPlayerId === 'a').locationId,
    field: state.board.battlefields[0].locationId };
}
function request(c, kind, label, extras = {}) {
  return { kind, tokenUID: `${kind}-${label}`, sourceEffectId: `effect-${label}`, eventId: `event-${label}`,
    sourceUID: 'a-c-1', sourceZoneEpoch: 0, sourceMode: 'current', effectControllerPlayerId: 'a',
    controllerPlayerId: 'a', locationId: c.base, readied: kind === 'gold',
    ...(kind === 'recruit' ? { name: 'Recruit', baseMight: 1, tags: ['Recruit'] } : {}), ...extras };
}
function fixedReceipt(c, kind, label, extras = {}) {
  const receipt = request(c, kind, label, extras);
  return Object.freeze({ ...receipt,
    ...(receipt.tags ? { tags: Object.freeze([...receipt.tags]) } : {}) });
}
function independentAttestor(receipt) {
  return ({ match, request: proposed }) => {
    for (const key of ['kind', 'tokenUID', 'sourceEffectId', 'eventId', 'sourceUID', 'sourceZoneEpoch',
      'sourceMode', 'effectControllerPlayerId', 'controllerPlayerId', 'locationId', 'readied',
      ...(receipt.kind === 'recruit' ? ['name', 'baseMight', 'tags'] : [])])
      assert.deepEqual(proposed[key], receipt[key], `fixed external receipt ${key}`);
    return { ...proposed, matchId: match.matchId, dataVersion: match.dataVersion,
      catalogDigest: match.catalogDigest, sourceProofId: `fixed-receipt:${receipt.eventId}` };
  };
}
function born(c, kind, label, extras = {}) {
  const req = request(c, kind, label, extras);
  const issued = attestDuelTokenSourceV2(c.state, req, independentAttestor(fixedReceipt(c, kind, label, extras)));
  const state = kind === 'gold' ? createDuelGoldTokenV2(c.state, req, issued.authority)
    : createDuelRecruitUnitV2(c.state, req, issued.authority);
  return { ...c, req, state, birth: { ...issued.attestation, createdAtStateVersion: state.stateVersion } };
}
// No proof field is inferred from the candidate snapshot. Factory provenance predates token creation.
function proof(c, tokenOwners = {}) {
  const originals = c.setup.provenance.originalPhysicalCards.map(o => ({ ...o }));
  return { matchId: c.setup.matchId, dataVersion: c.setup.dataVersion, catalogDigest: c.setup.catalogDigest,
    rosterPlayerIds: c.setup.roster.map(p => p.playerId), originalPhysicalCards: originals,
    submittedBattlefieldUIDs: [...c.setup.provenance.submittedBattlefieldUIDs],
    retiredPhysicalUIDs: c.setup.setup.selection.removedByPlayer.flatMap(p => p.battlefields.map(b => b.instanceId)),
    expectedZoneEpochByUID: Object.fromEntries(originals.map(o => [o.uid, 0])),
    goldOwnersByUID: {}, unitTokenOwnersByUID: {}, ...tokenOwners };
}
function creation(c) {
  return { matchId: c.setup.matchId, dataVersion: c.setup.dataVersion, catalogDigest: c.setup.catalogDigest,
    rosterPlayerIds: c.setup.roster.map(p => p.playerId),
    originalPhysicalCards: c.setup.provenance.originalPhysicalCards.map(o => ({ ...o })),
    submittedBattlefieldUIDs: [...c.setup.provenance.submittedBattlefieldUIDs],
    retiredPhysicalUIDs: c.setup.setup.selection.removedByPlayer.flatMap(p => p.battlefields.map(b => b.instanceId)),
    initialZonesByUID: clone(c.setup.provenance.initialZonesByUID), transitions: [] };
}
function journal(c, retiredVersion) {
  const retirements = retiredVersion === undefined ? [] : [{ kind: c.req.kind, tokenUID: c.req.tokenUID,
    ownerPlayerId: 'a', sourceEffectId: c.req.sourceEffectId, eventId: c.req.eventId,
    reason: c.req.kind === 'gold' ? 'consume-gold' : 'kill-recruit', retiredAtStateVersion: retiredVersion }];
  return { births: [c.birth], retirements };
}
function rejectPreserving(snapshot, act, pattern) {
  const bytes = same(snapshot), clocks = [snapshot.stateVersion, snapshot.eventSeq];
  assert.throws(act, pattern);
  assert.equal(same(snapshot), bytes);
  assert.deepEqual([snapshot.stateVersion, snapshot.eventSeq], clocks);
  return { bytes: bytes.length, clocks };
}
function resume(state) {
  return commitDuelPlayingMutationV2(state, draft => ({
    match: { ...draft, frame: { ...draft.frame, stateOpen: !draft.frame.stateOpen } }, transitions: [],
  }));
}

test('real factory / fixed receipt gives 1-Might Recruit with intrinsic Recruit name/tag', () => {
  const c = born(fixture(), 'recruit', 'factory');
  assert.equal(c.state.stateVersion, 3);
  assert.equal(c.state.eventSeq, 3);
  assert.deepEqual(c.state.unitMeta[c.req.tokenUID].trait,
    { kind: 'token', name: 'Recruit', baseMight: 1, tags: ['Recruit'] });
  assert.equal(enumerateDuelObjectsV2(c.state).find(o => o.uid === c.req.tokenUID).cardId, null);
});

test('Recruit remains intrinsic after legal ready + controller change and restore using genuine independent birth', () => {
  const original = fixture();
  const c = born(original, 'recruit', 'ready-control', { locationId: original.field });
  const later = commitDuelPlayingMutationV2(c.state, draft => ({ match: { ...draft,
    unitMeta: { ...draft.unitMeta, [c.req.tokenUID]: { ...draft.unitMeta[c.req.tokenUID], readied: true } },
    board: { ...draft.board, units: draft.board.units.map(u => u.objectId === c.req.tokenUID
      ? { ...u, controllerPlayerId: 'b' } : u) },
  }, transitions: [] }));
  assert.equal(later.unitMeta[c.req.tokenUID].readied, true);
  assert.equal(later.board.units.find(u => u.objectId === c.req.tokenUID).controllerPlayerId, 'b');
  const restored = restoreDuelPlayingStateV2(clone(later),
    proof(c, { unitTokenOwnersByUID: { [c.req.tokenUID]: 'a' } }), creation(c), journal(c));
  assert.equal(resume(restored).stateVersion, later.stateVersion + 1);
  assert.deepEqual(restored.unitMeta[c.req.tokenUID].trait, c.state.unitMeta[c.req.tokenUID].trait);
});

test('Recruit intrinsic trait survives unrelated effects; Might bonuses need a separate derived layer', () => {
  const c = born(fixture(), 'recruit', 'bonus');
  // There is no Might buff/layer state in this Core slice. We test a real unrelated state
  // mutation without pretending arithmetic in a test implements a settled game effect.
  const later = resume(c.state);
  assert.deepEqual(later.unitMeta[c.req.tokenUID].trait, c.state.unitMeta[c.req.tokenUID].trait);
  assert.equal(later.stateVersion, c.state.stateVersion + 1);
});

test('restore rejects #21 genuinely born Recruit whose snapshot changes name/9-Might/tag, preserving bytes and clock', () => {
  const c = born(fixture(), 'recruit', 'trait-restore');
  const raw = clone(c.state);
  raw.unitMeta[c.req.tokenUID].trait = { kind: 'token', name: 'False Recruit', baseMight: 9, tags: ['Elite'] };
  raw.unitMeta[c.req.tokenUID].readied = true;
  rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw,
    proof(c, { unitTokenOwnersByUID: { [c.req.tokenUID]: 'a' } }), creation(c), journal(c)),
  /trait|Recruit/);
});

test('live generic mutation rejects #22 25-Might/NotRecruit trait, preserving bytes/clock', () => {
  const c = born(fixture(), 'recruit', 'trait-live');
  rejectPreserving(c.state, () => commitDuelPlayingMutationV2(c.state, draft => ({ match: { ...draft,
    unitMeta: { ...draft.unitMeta, [c.req.tokenUID]: { ...draft.unitMeta[c.req.tokenUID],
      trait: { kind: 'token', name: 'Corrupted', baseMight: 25, tags: ['NotRecruit'] }, readied: true } },
  }, transitions: [] })), /trait|Recruit/);
  assert.equal(resume(c.state).stateVersion, c.state.stateVersion + 1);
});

test('live commit individually rejects name-only / Might-only / tag-only trait rewrites', () => {
  const c = born(fixture(), 'recruit', 'trait-fields');
  for (const change of [{ name: 'False Recruit' }, { baseMight: 9 }, { tags: ['Recruit', 'Elite'] }]) {
    rejectPreserving(c.state, () => commitDuelPlayingMutationV2(c.state, draft => ({ match: { ...draft,
      unitMeta: { ...draft.unitMeta, [c.req.tokenUID]: { ...draft.unitMeta[c.req.tokenUID],
        trait: { ...draft.unitMeta[c.req.tokenUID].trait, ...change } } },
    }, transitions: [] })), /trait|Recruit/);
  }
});

test('creation rejects non-Recruit name or extra intrinsic tag atomically', () => {
  const c = fixture();
  for (const bad of [{ name: 'False Recruit' }, { tags: ['Recruit', 'Elite'] }]) {
    const req = request(c, 'recruit', 'bad-trait', bad);
    rejectPreserving(c.state, () => createDuelRecruitUnitV2(c.state, req,
      independentAttestor(fixedReceipt(c, 'recruit', 'bad-trait', bad))), /Recruit|tags|name/);
  }
});

test('retire after real Recruit birth, independent journal restore then commit (no physical Trash)', () => {
  const c = born(fixture(), 'recruit', 'retire');
  const dead = killRetireDuelUnitTokenV2(c.state, c.req.tokenUID);
  const restored = restoreDuelPlayingStateV2(clone(dead), proof(c), creation(c), journal(c, dead.stateVersion));
  assert.equal(resume(restored).stateVersion, dead.stateVersion + 1);
  assert.deepEqual(restored.retiredUnitTokenUIDs, [c.req.tokenUID]);
  assert.equal(restored.players.some(p => p.trash.some(card => card.uid === c.req.tokenUID)), false);
});

test('reject #17 ghost owner/controller on retired token journal, preserving bytes/clock', () => {
  const c = born(fixture(), 'recruit', 'ghost');
  const dead = killRetireDuelUnitTokenV2(c.state, c.req.tokenUID);
  const forged = journal(c, dead.stateVersion);
  forged.births = [{ ...c.birth, effectControllerPlayerId: 'ghost-not-seat', controllerPlayerId: 'ghost-not-seat' }];
  forged.retirements = [{ ...forged.retirements[0], ownerPlayerId: 'ghost-not-seat' }];
  const raw = clone(dead);
  rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, proof(c), creation(c), forged), /seat|owner|controller/);
});

test('retired Gold also rejects a ghost creator/owner even with no live owner map', () => {
  const c = born(fixture(), 'gold', 'ghost-gold');
  const dead = activateDuelGoldPowerV2(c.state, 'a', c.req.tokenUID, timing());
  const real = journal(c, dead.stateVersion);
  const forged = { births: [{ ...c.birth, effectControllerPlayerId: 'ghost-not-seat',
    controllerPlayerId: 'ghost-not-seat' }],
  retirements: [{ ...real.retirements[0], ownerPlayerId: 'ghost-not-seat' }] };
  const raw = clone(dead);
  rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, proof(c), creation(c), forged), /seat|owner/);
});

test('reject #18 retirement earlier than birth and same version as birth', () => {
  const c = born(fixture(), 'gold', 'time');
  const dead = activateDuelGoldPowerV2(c.state, 'a', c.req.tokenUID, timing());
  const real = journal(c, dead.stateVersion);
  assert.equal(restoreDuelPlayingStateV2(clone(dead), proof(c), creation(c), real).stateVersion, 4);
  for (const impossible of [c.birth.createdAtStateVersion - 1, c.birth.createdAtStateVersion]) {
    const altered = { ...real, retirements: [{ ...real.retirements[0], retiredAtStateVersion: impossible }] };
    const raw = clone(dead);
    rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, proof(c), creation(c), altered), /version|chronolog|birth|retirement/);
  }
});

test('history rejects retirement beyond snapshot and birth beyond outer version', () => {
  const c = born(fixture(), 'gold', 'future');
  const dead = activateDuelGoldPowerV2(c.state, 'a', c.req.tokenUID, timing());
  const real = journal(c, dead.stateVersion);
  const variants = [
    { births: real.births, retirements: [{ ...real.retirements[0], retiredAtStateVersion: dead.stateVersion + 1 }] },
    { births: [{ ...real.births[0], createdAtStateVersion: dead.stateVersion + 1 }], retirements: real.retirements },
  ];
  for (const history of variants) {
    const raw = clone(dead);
    rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, proof(c), creation(c), history), /version|future/);
  }
});

test('source authority rejects a different readiness tuple while preserving retry and clock', () => {
  const c = fixture();
  const req = request(c, 'gold', 'same-commit-ready', { readied: false });
  const receipt = attestDuelTokenSourceV2(c.state, req,
    independentAttestor(fixedReceipt(c, 'gold', 'same-commit-ready', { readied: false })));
  // The one-use authority cannot be reused to apply a different entry result; the outer
  // clock then binds the actual created state to the fixed readiness on its birth version.
  rejectPreserving(c.state, () => createDuelGoldTokenV2(c.state,
    { ...req, readied: true }, receipt.authority), /differs/);
  const exhausted = createDuelGoldTokenV2(c.state, req, receipt.authority);
  assert.equal(exhausted.resources.bases[0].goldTokens[0].readied, false);
});

test('Gold normal consume uses one outer clock and exactly +1 Any', () => {
  const c = born(fixture(), 'gold', 'consume');
  const dead = activateDuelGoldPowerV2(c.state, 'a', c.req.tokenUID, timing());
  assert.deepEqual([c.state.stateVersion, dead.stateVersion], [3, 4]);
  assert.deepEqual([c.state.eventSeq, dead.eventSeq], [3, 4]);
  assert.equal(dead.resources.players[0].runePool.power.any, 1);
  assert.deepEqual(dead.resources.retiredGoldUids, [c.req.tokenUID]);
});

test('same-creation-version exhausted Gold readiness tamper rejects; later legit ready remains legal', () => {
  const c = born(fixture(), 'gold', 'readiness-entry', { readied: false });
  const p = proof(c, { goldOwnersByUID: { [c.req.tokenUID]: 'a' } });
  const raw = clone(c.state);
  raw.resources.bases[0].goldTokens[0].readied = true;
  rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, p, creation(c), journal(c)), /readied|readiness|birth/);
  const later = commitDuelPlayingMutationV2(c.state, draft => ({ match: { ...draft,
    resources: { ...draft.resources, bases: draft.resources.bases.map(base => ({ ...base,
      goldTokens: base.goldTokens.map(g => g.uid === c.req.tokenUID ? { ...g, readied: true } : g) })) },
  }, transitions: [] }));
  const restored = restoreDuelPlayingStateV2(clone(later), p, creation(c), journal(c));
  assert.equal(restored.resources.bases[0].goldTokens[0].readied, true);
  assert.equal(activateDuelGoldPowerV2(restored, 'a', c.req.tokenUID, timing()).stateVersion, 5);
});

test('reject out-of-order birth array but accept genuine order for two live tokens', () => {
  const first = born(fixture(), 'gold', 'birth-first');
  const req = request(first, 'recruit', 'birth-second');
  const receipt = attestDuelTokenSourceV2(first.state, req,
    independentAttestor(fixedReceipt(first, 'recruit', 'birth-second')));
  const second = createDuelRecruitUnitV2(first.state, req, receipt.authority);
  const secondBirth = { ...receipt.attestation, createdAtStateVersion: second.stateVersion };
  const p = proof(first, { goldOwnersByUID: { [first.req.tokenUID]: 'a' },
    unitTokenOwnersByUID: { [req.tokenUID]: 'a' } });
  const trueHistory = { births: [first.birth, secondBirth], retirements: [] };
  assert.equal(restoreDuelPlayingStateV2(clone(second), p, creation(first), trueHistory).stateVersion, 4);
  const raw = clone(second);
  rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, p, creation(first),
    { ...trueHistory, births: [secondBirth, first.birth] }), /order|version/);
});

test('reject out-of-order retirement array but accept genuine order for two retired tokens', () => {
  const first = born(fixture(), 'gold', 'retire-first');
  const secondReq = request(first, 'gold', 'retire-second');
  const issued = attestDuelTokenSourceV2(first.state, secondReq,
    independentAttestor(fixedReceipt(first, 'gold', 'retire-second')));
  const both = createDuelGoldTokenV2(first.state, secondReq, issued.authority);
  const secondBirth = { ...issued.attestation, createdAtStateVersion: both.stateVersion };
  const oneDead = activateDuelGoldPowerV2(both, 'a', first.req.tokenUID, timing());
  const allDead = activateDuelGoldPowerV2(oneDead, 'a', secondReq.tokenUID, timing());
  const retirement = (req, at) => ({ kind: 'gold', tokenUID: req.tokenUID, ownerPlayerId: 'a',
    sourceEffectId: req.sourceEffectId, eventId: req.eventId, reason: 'consume-gold', retiredAtStateVersion: at });
  const history = { births: [first.birth, secondBirth],
    retirements: [retirement(first.req, oneDead.stateVersion), retirement(secondReq, allDead.stateVersion)] };
  assert.equal(restoreDuelPlayingStateV2(clone(allDead), proof(first), creation(first), history).stateVersion, 6);
  const raw = clone(allDead);
  rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, proof(first), creation(first),
    { ...history, retirements: [...history.retirements].reverse() }), /order|version/);
});

test('duplicate token UID or source effect remains rejected without allowing one effect to mint twice', () => {
  const first = born(fixture(), 'gold', 'duplicate');
  const p = proof(first, { goldOwnersByUID: { [first.req.tokenUID]: 'a' } });
  for (const duplicate of [first.birth,
    { ...first.birth, tokenUID: 'other-uid', createdAtStateVersion: first.state.stateVersion }]) {
    const raw = clone(first.state);
    rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, p, creation(first),
      { births: [first.birth, duplicate], retirements: [] }), /duplicate|carrier/);
  }
});

test('later Gold ready and later rune-pool balance are not authenticated by a birth-only journal', () => {
  const c = born(fixture(), 'gold', 'later-limit', { readied: false });
  const p = proof(c, { goldOwnersByUID: { [c.req.tokenUID]: 'a' } });
  const legitimateLater = resume(c.state); // v4, after entry; birth-only proof no longer constrains readiness.
  const forged = clone(legitimateLater);
  forged.resources.bases[0].goldTokens[0].readied = true;
  const structurallyAdmitted = restoreDuelPlayingStateV2(forged, p, creation(c), journal(c));
  assert.equal(structurallyAdmitted.resources.bases[0].goldTokens[0].readied, true);
  const activated = activateDuelGoldPowerV2(structurallyAdmitted, 'a', c.req.tokenUID, timing());
  assert.equal(activated.resources.players[0].runePool.power.any, 1);
  const genuineRetirement = journal(c, activated.stateVersion);
  const poolTamper = clone(activated);
  poolTamper.resources.players[0].runePool.power.any = 2;
  assert.equal(restoreDuelPlayingStateV2(poolTamper, proof(c), creation(c), genuineRetirement)
    .resources.players[0].runePool.power.any, 2);
  // Positive structural acceptance above does NOT establish archive authenticity. A protected
  // state/event proof must reject both forged later fields before this restore API is called.
});

test('birth-version readiness match also applies to genuine Recruit; later ready is not frozen', () => {
  const c = born(fixture(), 'recruit', 'ready-entry');
  const p = proof(c, { unitTokenOwnersByUID: { [c.req.tokenUID]: 'a' } });
  const raw = clone(c.state);
  raw.unitMeta[c.req.tokenUID].readied = true;
  rejectPreserving(raw, () => restoreDuelPlayingStateV2(raw, p, creation(c), journal(c)), /readiness/);
  const later = commitDuelPlayingMutationV2(c.state, draft => ({ match: { ...draft,
    unitMeta: { ...draft.unitMeta, [c.req.tokenUID]: { ...draft.unitMeta[c.req.tokenUID], readied: true } },
  }, transitions: [] }));
  assert.equal(restoreDuelPlayingStateV2(clone(later), p, creation(c), journal(c))
    .unitMeta[c.req.tokenUID].readied, true);
});

test('separate effects sharing one event ID create separate tokens without event-ID uniqueness', () => {
  const c = born(fixture(), 'gold', 'event-one', { eventId: 'shared-event' });
  const req2 = request(c, 'gold', 'event-two', { eventId: 'shared-event' });
  const second = createDuelGoldTokenV2(c.state, req2,
    independentAttestor(fixedReceipt(c, 'gold', 'event-two', { eventId: 'shared-event' })));
  assert.deepEqual(second.resources.bases[0].goldTokens.map(token => token.uid),
    [c.req.tokenUID, req2.tokenUID]);
  assert.deepEqual([c.state.stateVersion, second.stateVersion], [3, 4]);
});

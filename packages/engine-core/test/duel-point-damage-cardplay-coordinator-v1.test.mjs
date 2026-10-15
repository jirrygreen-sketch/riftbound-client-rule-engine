import test from 'node:test';
import assert from 'node:assert/strict';
import official from '../../card-data/data/deck-catalog.json' with { type: 'json' };
import { createDuelPointDamageOfficialProgramRegistryV1, duelAbilitySourceFromCatalog,
  DUEL_PREMONITION_REACTION_TEXT } from
  '../../card-dsl/dist/duel/official-programs.js';
import { createDuelPhaseSourceRegistryV2 } from '../dist/duel/phase-source-authority-v2.js';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2,
  advanceDuelCommandSessionNativeV2 } from '../dist/duel/canonical-session-v2.js';
import { channelDuelRunesV2, moveDuelUnitV2 } from '../dist/duel/core-v2.js';
import { runDuelStartOfTurnV2 } from '../dist/duel/turn-executor-v2.js';
import { createDuelUnitPlaySessionV2, playDuelNoAbilityUnitToBaseV2 } from '../dist/duel/cardplay-unit-v2.js';
import { createDuelCostResolverAuthorityV2, fingerprintDuelCostCoverageV2 } from
  '../dist/duel/cost-resolver-v2.js';
import { createDuelSpellCardPlaySessionV2, playDuelSpellCardV2,
  applyDuelSpellResourceCommandV2, finalizeDuelSpellCardPlayV2,
  passDuelSpellPriorityV2, resolveDuelSpellCardPlayV2, resumeDuelSpellEffectV2,
  inspectDuelSpellPrivateStateV2 } from '../dist/duel/cardplay-spell-v2.js';

const IDS = ['ogs-003-024', 'ogn-009-298', 'ogn-085-298', 'ogs-022-024'];
const points = IDS.map(id => official.cards.find(card => card.id === id));
const synthetic = (id, type, might = null) => ({ id, cardType: type, ability: '', energy: 0,
  power: null, might, domains: ['Colorless'], tags: [], canonicalCardId: `fixture-${id}`,
  name: id, fullName: id, localizedName: id, setCode: 'fixture', cardNumber: id, variant: 'normal' });
const extra = [synthetic('point-target', 'Unit', 10), synthetic('point-fragile-target', 'Unit', 1),
  { ...synthetic('point-reaction', 'Spell'), ability: DUEL_PREMONITION_REACTION_TEXT, energy: 1 },
  synthetic('point-champion', 'Champion'),
  synthetic('point-legend', 'Legend'), synthetic('point-rune', 'Rune'),
  ...['a', 'b'].flatMap(player => Array.from({ length: 3 }, (_, i) => synthetic(`${player}-field-${i}`, 'Battlefield')))];
const catalog = { schemaVersion: 1, dataVersion: official.dataVersion, digest: official.digest,
  cards: [...points, ...extra] };
const programs = createDuelPointDamageOfficialProgramRegistryV1(duelAbilitySourceFromCatalog(catalog));
const card = (uid, cardId) => ({ uid, cardId });
let fixtureNumber = 0;

function setup(sourceId, { location = 'battlefield', optIn = true, serviceEdit = {}, fragile = false,
  responseReaction = false } = {}) {
  const targetCardId = fragile ? 'point-fragile-target' : 'point-target';
  const seats = ['a', 'b'].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 10 }, (_, i) => card(`${playerId}-main-${i}`,
      playerId === 'a' && i === 1 ? sourceId :
        playerId === 'b' && i === 1 && responseReaction ? 'point-reaction' : targetCardId)),
    champion: card(`${playerId}-champion`, 'point-champion'),
    legend: card(`${playerId}-legend`, 'point-legend'),
    runeDeck: Array.from({ length: 10 }, (_, i) => ({ ...card(`${playerId}-rune-${i}`, 'point-rune'), domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
      cardId: `${playerId}-field-${i}` })),
  }));
  const metadata = { matchId: `point-coordinator-${++fixtureNumber}`, dataVersion: official.dataVersion,
    catalogDigest: official.digest, roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
  const typeOf = id => IDS.includes(id) || id === 'point-reaction' ? 'Other' :
    id === 'point-target' || id === 'point-fragile-target' ? 'Unit' :
    id === 'point-champion' ? 'Champion' : id === 'point-legend' ? 'Legend' :
    id === 'point-rune' ? 'Rune' : 'Battlefield';
  let command = createDuelCommandSessionV2(seats, metadata, () => 0, typeOf);
  for (const actor of ['a', 'b']) {
    const result = applyDuelResourceCommandV2(command, actor, { commandId: `mulligan-${actor}`,
      expectedVersion: command.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
    assert.equal(result.outcome.status, 'applied');
    command = result.session;
  }
  const printings = [...new Set(seats.flatMap(seat => [
    ...seat.mainDeck.map(value => value.cardId), seat.champion.cardId, seat.legend.cardId,
    ...seat.runeDeck.map(value => value.cardId), ...seat.battlefields.map(value => value.cardId),
  ]))];
  const refs = new Map(printings.map(id => [id, `whole:${id}`]));
  const phase = createDuelPhaseSourceRegistryV2({ matchId: metadata.matchId,
    dataVersion: metadata.dataVersion, catalogDigest: metadata.catalogDigest,
    printings: printings.map(cardId => ({ cardId, programReference: refs.get(cardId) })) }, request => ({
    status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: refs.get(request.source.cardId), event: request.event,
    eventSupported: true, scope: 'known-no-handler', replacementsCovered: true,
    staticCovered: true, continuousCovered: true, triggersCovered: true,
  }));
  const started = runDuelStartOfTurnV2(command, { sources: phase, fepr: () => ({ status: 'none' }),
    randomIndex: () => 0 });
  assert.equal(started.status, 'main', started.reason);
  command = started.session;
  const zero = { energy: 0, power: [] };
  const unitCost = createDuelCostResolverAuthorityV2(request => {
    const facts = { registryRevision: 'fixture-r1', catalogRevision: catalog.digest,
      nonResourceCosts: 'none', base: { cost: zero, sourceUid: command.match.players[0].hand[0].uid,
        sourceEpoch: command.match.physicalCardsByUID[command.match.players[0].hand[0].uid].zoneEpoch },
      candidates: [], orderedModifiers: [] };
    return { request, base: { request, status: 'complete', proofId: 'unit-base', cost: zero,
      sourceUid: facts.base.sourceUid, sourceEpoch: facts.base.sourceEpoch,
      registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision },
      coverage: { request, status: 'complete', proofId: 'unit-coverage', allModifierSourcesCovered: true,
        choicesResolved: true, nonResourceCosts: 'none', registryRevision: facts.registryRevision,
        catalogRevision: facts.catalogRevision, ...fingerprintDuelCostCoverageV2(facts) },
      proofs: [], modifiers: [] };
  }, request => ({ registryRevision: 'fixture-r1', catalogRevision: catalog.digest,
    nonResourceCosts: 'none', base: { cost: zero, sourceUid: command.match.players[0].hand[0].uid,
      sourceEpoch: command.match.physicalCardsByUID[command.match.players[0].hand[0].uid].zoneEpoch },
    candidates: [], orderedModifiers: [] }));
  const unit = createDuelUnitPlaySessionV2(command, { programs, cost: unitCost,
    costBinding: request => ({ ...request, status: 'complete' }),
    entry: request => {
      const { match: ignored, ...facts } = request;
      return { ...facts, sourceCensus: 'complete', sources: [],
        scopes: { play: 'clear', replacement: 'clear', static: 'clear', trigger: 'clear',
          pendingTasks: 'clear', chain: 'clear' } };
    } });
  const targetUID = command.match.players[0].hand.find(value => value.cardId === targetCardId).uid;
  const placed = playDuelNoAbilityUnitToBaseV2(unit, 'a', { commandId: 'place-unit',
    expectedVersion: command.match.stateVersion, command: { cardUID: targetUID } });
  assert.equal(placed.outcome.status, 'applied', placed.outcome.reason);
  command = placed.session.commandSession;
  const printing = points.find(value => value.id === sourceId);
  const requiredRunes = printing.energy + (printing.power ?? 0);
  const existingRunes = command.match.resources.bases.find(base => base.playerId === 'a').baseRunes.length;
  if (requiredRunes > existingRunes) {
    command = advanceDuelCommandSessionNativeV2(command,
      channelDuelRunesV2(command.match, 'a', requiredRunes - existingRunes)).session;
  }
  if (responseReaction) {
    command = advanceDuelCommandSessionNativeV2(command, channelDuelRunesV2(command.match, 'b', 1)).session;
  }
  if (location === 'battlefield') {
    const field = command.match.board.battlefields.find(value => value.ownerPlayerId === 'a').locationId;
    command = advanceDuelCommandSessionNativeV2(command, moveDuelUnitV2(command.match, targetUID, field)).session;
  }
  const source = command.match.players[0].hand.find(value => value.cardId === sourceId);
  assert.ok(source);
  let damageCalls = 0;
  const effects = new Map(), claims = new Map();
  const service = { programs, cardPlayOrder: 'chain-first-v3', pointDamageSpellV1: optIn,
    cost: createDuelCostResolverAuthorityV2(() => { throw Error('pre-chain cost'); }, () => { throw Error('pre-chain facts'); }),
    costForChain: request => {
      const printing = catalog.cards.find(value => value.id === request.cardId);
      assert.ok(printing);
      const cost = { energy: printing.energy,
        power: printing.power ? [{ allowedDomains: ['Fury'], amount: printing.power }] : [] };
      const facts = { registryRevision: 'point-r1', catalogRevision: catalog.digest,
        nonResourceCosts: 'none', base: { cost, sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch },
        candidates: [], orderedModifiers: [] };
      return createDuelCostResolverAuthorityV2(costRequest => ({ request: costRequest,
        base: { request: costRequest, status: 'complete', proofId: 'point-base', cost,
          sourceUid: request.cardUID, sourceEpoch: request.sourceEpoch,
          registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision },
        coverage: { request: costRequest, status: 'complete', proofId: 'point-coverage',
          allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: 'none',
          registryRevision: facts.registryRevision, catalogRevision: facts.catalogRevision,
          ...fingerprintDuelCostCoverageV2(facts) }, proofs: [], modifiers: [] }), () => facts);
    },
    costBinding: request => ({ ...request, status: 'complete' }),
    sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor,
      paymentId: request.paymentId, sourceReference: request.sourceReference,
      sourceProofId: 'source-current', mode: 'current',
      sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID].zoneEpoch,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      ...(request.continuationId ? { continuationId: request.continuationId } : {}) }),
    dispatcher: {
      claim: request => {
        const key = `${request.actor}:${request.commandId}`;
        const old = claims.get(key);
        if (old) return old.fingerprint === request.payloadFingerprint
          ? { status: 'duplicate', outcome: old.outcome } : { status: 'conflict' };
        const claim = { key }; claims.set(key, { fingerprint: request.payloadFingerprint, claim });
        return { status: 'new', claim };
      },
      finish: request => { for (const entry of claims.values()) if (entry.claim === request.claim) entry.outcome = request.outcome; },
      readCommitted: ticket => effects.get(ticket.idempotencyKey) ?? null,
      commitEffect: request => { effects.set(request.ticket.idempotencyKey, request.receipt); },
    },
    closure: { draw: { randomIndex: bound => bound - 1 }, pointDamage: {
      verifyCost: () => ({ status: 'approved', proofId: 'paid-task' }),
      verifyChain: () => ({ status: 'approved', proofId: 'locked-target', selectionTiming: 'finalization' }),
      resolveDamage: request => {
        damageCalls++;
        return serviceEdit.resolveDamage?.(request) ?? { status: 'approved', proofId: 'damage-resolution',
          resolvedMarks: request.targetUIDs.map(uid => ({ uid, amount: request.amount,
            responsiblePlayerId: request.source.controllerPlayerId,
            sourceObjectIds: [request.source.sourceUID, request.source.effectId] })),
          targetLegality: 'approved', preventionReplacement: 'resolved', attribution: 'approved',
          requiredCleanup: 'scheduled' };
      },
      resolveLethal: request => {
        if (serviceEdit.resolveLethal) return serviceEdit.resolveLethal(request);
        const current = request.state.unitMeta[targetUID];
        assert.equal(current.trait.cardId, targetCardId);
        const currentMight = programs.getProgram(targetCardId).source.might;
        assert.ok(request.plan.snapshots.every(snapshot => snapshot.totalDamage < currentMight),
          'this fixture only approves nonlethal outcomes for the unchanged printed Might');
        return { status: 'approved', proofId: 'current-unit-nonlethal', approvedUnitUIDs: [],
          targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved',
          proposal: request.proposedDamage,
          lethalProof: { kind: 'duel-lethal-candidate-proof-v2', proposal: request.proposedDamage,
            candidates: [], evaluatorProofId: 'fixture-unchanged-printed-might' } };
      },
    } },
  };
  return { command, targetUID, targetCardId, sourceUID: source.uid, service,
    get damageCalls() { return damageCalls; }, effects };
}

function cast(ctx, commandId = 'point-play') {
  const action = createDuelSpellCardPlaySessionV2(ctx.command, ctx.service);
  return playDuelSpellCardV2(action, 'a', { commandId, expectedVersion: ctx.command.match.stateVersion,
    command: { cardUID: ctx.sourceUID, targetUIDs: [ctx.targetUID] } });
}

function payAndClose(ctx, commandId = 'point-play') {
  let current = cast(ctx, commandId);
  assert.equal(current.outcome.step, 'payment', current.outcome.reason);
  const printed = points.find(value => value.id === ctx.command.match.players[0].hand
    .find(card => card.uid === ctx.sourceUID).cardId);
  for (let i = 0; i < printed.energy + (printed.power ?? 0); i++) {
    const rune = current.session.commandSession.match.resources.bases.find(base => base.playerId === 'a')
      .baseRunes.find(value => value.readied);
    assert.ok(rune, 'printed cost needs a ready physical Rune');
    current = applyDuelSpellResourceCommandV2(current.session, 'a', {
      commandId: `${commandId}:rune-${i}`, expectedVersion: current.session.commandSession.match.stateVersion,
      command: { type: i < printed.energy ? 'rune-energy' : 'rune-power', uid: rune.uid } });
    assert.equal(current.outcome.step, 'payment', current.outcome.reason);
  }
  current = applyDuelSpellResourceCommandV2(current.session, 'a', {
    commandId: `${commandId}:pay`, expectedVersion: current.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: `spell-payment:${JSON.stringify(['a', commandId])}` } });
  assert.equal(current.outcome.step, 'priority', current.outcome.reason);
  current = finalizeDuelSpellCardPlayV2(current.session, 'a');
  assert.equal(current.outcome.step, 'priority', current.outcome.reason);
  current = passDuelSpellPriorityV2(current.session, 'a');
  current = passDuelSpellPriorityV2(current.session, 'b');
  assert.equal(current.outcome.step, 'effect', current.outcome.reason);
  return current;
}

test('source-bound Point Spell pays on Chain, closes priority, damages once and trashes', () => {
  const ctx = setup(IDS[0]);
  let current = cast(ctx);
  assert.equal(current.outcome.step, 'payment', current.outcome.reason);
  assert.equal(current.session.commandSession.match.chainCards[0].uid, ctx.sourceUID);
  assert.equal(current.session.commandSession.match.frame.stateOpen, false);
  for (let i = 0; i < 2; i++) {
    const rune = current.session.commandSession.match.resources.bases.find(base => base.playerId === 'a')
      .baseRunes.find(value => value.readied);
    const next = applyDuelSpellResourceCommandV2(current.session, 'a', {
      commandId: `energy-${i}`, expectedVersion: current.session.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: rune.uid } });
    assert.equal(next.outcome.status, 'pending', next.outcome.reason);
    current = next;
  }
  current = applyDuelSpellResourceCommandV2(current.session, 'a', { commandId: 'pay',
    expectedVersion: current.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: `spell-payment:${JSON.stringify(['a', 'point-play'])}` } });
  assert.equal(current.outcome.step, 'priority', current.outcome.reason);
  current = finalizeDuelSpellCardPlayV2(current.session, 'a');
  assert.equal(current.outcome.step, 'priority');
  current = passDuelSpellPriorityV2(current.session, 'a');
  current = passDuelSpellPriorityV2(current.session, 'b');
  assert.equal(current.outcome.step, 'effect');
  current = resolveDuelSpellCardPlayV2(current.session, 'a');
  assert.equal(current.outcome.status, 'applied', current.outcome.reason);
  assert.equal(current.outcome.changed, true);
  assert.equal(ctx.damageCalls, 1);
  assert.equal(current.session.commandSession.match.unitMeta[ctx.targetUID].damageMarks[0].amount, 2);
  assert.equal(current.session.commandSession.match.players[0].trash.some(value => value.uid === ctx.sourceUID), true);
  assert.equal(current.session.chain.items.length, 0);
  assert.equal(current.session.commandSession.match.frame.stateOpen, true);
  assert.equal(ctx.effects.size, 1);
  assert.equal(resolveDuelSpellCardPlayV2(current.session, 'a').outcome.status, 'blocked');
  assert.equal(ctx.damageCalls, 1);
  assert.equal(inspectDuelSpellPrivateStateV2(current.session).pendingEffect, null);
});

test('Point Spell is closed by default and illegal/missing targets never leave Hand', () => {
  const disabled = setup(IDS[0], { optIn: false });
  const denied = cast(disabled);
  assert.equal(denied.outcome.status, 'blocked');
  assert.equal(denied.session.commandSession.match.players[0].hand.some(value => value.uid === disabled.sourceUID), true);
  for (const targetUIDs of [undefined, [], ['unknown-unit']]) {
    const ctx = setup(IDS[0]);
    const action = createDuelSpellCardPlaySessionV2(ctx.command, ctx.service);
    const result = playDuelSpellCardV2(action, 'a', { commandId: 'bad-target',
      expectedVersion: ctx.command.match.stateVersion,
      command: { cardUID: ctx.sourceUID, ...(targetUIDs ? { targetUIDs } : {}) } });
    assert.deepEqual(result.outcome, { status: 'rejected', reason: 'illegal-target' });
    assert.equal(result.session.commandSession.match.chainCards?.length ?? 0, 0);
  }
  const base = setup(IDS[1], { location: 'base' });
  assert.deepEqual(cast(base).outcome, { status: 'rejected', reason: 'illegal-target' });
});

test('all four source-bound printings retain their actual amount, printed fee and location', () => {
  for (const [index, sourceId] of IDS.entries()) {
    const ctx = setup(sourceId, { location: index === 3 ? 'base' : 'battlefield' });
    const ready = payAndClose(ctx, `printing-${index}`);
    assert.equal(ready.session.commandSession.requiredTasks.length, 1);
    assert.equal(ready.session.commandSession.requiredTasks[0].status, 'completed');
    const done = resolveDuelSpellCardPlayV2(ready.session, 'a');
    assert.equal(done.outcome.status, 'applied', `${sourceId}: ${done.outcome.reason}`);
    assert.equal(done.session.commandSession.match.unitMeta[ctx.targetUID].damageMarks[0].amount,
      [2, 3, 6, 8][index]);
    assert.equal(ctx.damageCalls, 1);
  }
});

test('trusted prevention result applies partial 8 to 2 and complete prevention closes without a mark', () => {
  const partial = setup(IDS[3], { location: 'base', serviceEdit: { resolveDamage: request => ({
    status: 'approved', proofId: 'partial-prevention', targetLegality: 'approved',
    preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled',
    resolvedMarks: [{ uid: request.targetUIDs[0], amount: 2,
      responsiblePlayerId: request.source.controllerPlayerId,
      sourceObjectIds: [request.source.sourceUID, request.source.effectId] }],
  }) } });
  const partialDone = resolveDuelSpellCardPlayV2(payAndClose(partial).session, 'a');
  assert.equal(partialDone.outcome.status, 'applied');
  assert.equal(partialDone.session.commandSession.match.unitMeta[partial.targetUID].damageMarks[0].amount, 2);
  const prevented = setup(IDS[0], { serviceEdit: { resolveDamage: () => ({
    status: 'approved', proofId: 'full-prevention', targetLegality: 'approved',
    preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled', resolvedMarks: [],
  }) } });
  const before = prevented.command.match.unitMeta[prevented.targetUID].damageMarks.length;
  const noChange = resolveDuelSpellCardPlayV2(payAndClose(prevented).session, 'a');
  assert.equal(noChange.outcome.status, 'applied');
  assert.equal(noChange.outcome.changed, false);
  assert.equal(noChange.session.commandSession.match.unitMeta[prevented.targetUID].damageMarks.length, before);
  assert.equal([...prevented.effects.values()][0].effectStatus, 'no-change');
});

test('lethal proof sees the admitted head and removes the original physical Unit', () => {
  let callbackCalls = 0;
  const ctx = setup(IDS[0], { fragile: true, serviceEdit: { resolveLethal: request => {
    callbackCalls++;
    assert.equal(request.state.stateVersion, request.proposedDamage.baseStateVersion);
    assert.equal(request.proposedDamage.resultStateVersion, request.state.stateVersion + 1);
    assert.equal(request.state.unitMeta[request.plan.snapshots[0].objectId].damageMarks.length, 0);
    const snapshot = request.plan.snapshots[0];
    const currentMight = programs.getProgram('point-fragile-target').source.might;
    assert.equal(currentMight, 1);
    return { status: 'approved', proofId: 'fixture-current-might',
      approvedUnitUIDs: [snapshot.objectId], targetLegality: 'approved',
      deathknell: 'resolved', replacements: 'resolved', proposal: request.proposedDamage,
      lethalProof: { kind: 'duel-lethal-candidate-proof-v2', proposal: request.proposedDamage,
        candidates: [{ unitUID: snapshot.objectId, currentMight,
          lethalDamageThreshold: currentMight, totalDamage: snapshot.totalDamage }],
        evaluatorProofId: 'fixture-no-modifier-current-might' } };
  } } });
  const done = resolveDuelSpellCardPlayV2(payAndClose(ctx).session, 'a');
  assert.equal(done.outcome.status, 'applied', done.outcome.reason);
  assert.equal(callbackCalls, 1);
  assert.equal(done.session.commandSession.match.board.units.some(unit => unit.objectId === ctx.targetUID), false);
  assert.equal(done.session.commandSession.match.players[0].trash.some(card => card.uid === ctx.targetUID), true);
  assert.equal(done.session.commandSession.match.players[0].trash.some(card => card.uid === ctx.sourceUID), true);
});

test('unknown cleanup retries the same nominal effect and false source attribution cannot commit', () => {
  let cleanupKnown = false;
  const ctx = setup(IDS[0], { serviceEdit: { resolveLethal: request => cleanupKnown ? ({
    status: 'approved', proofId: 'cleanup-now-known', approvedUnitUIDs: [],
    targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved',
    proposal: request.proposedDamage,
    lethalProof: { kind: 'duel-lethal-candidate-proof-v2', proposal: request.proposedDamage,
      candidates: [], evaluatorProofId: 'current-might-10' },
  }) : { status: 'pending', reason: 'cleanup-unknown' } } });
  const ready = payAndClose(ctx);
  let result = resolveDuelSpellCardPlayV2(ready.session, 'a');
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.session.commandSession.match.unitMeta[ctx.targetUID].damageMarks.length, 0);
  cleanupKnown = true;
  result = resumeDuelSpellEffectV2(result.session);
  assert.equal(result.outcome.status, 'applied', result.outcome.reason);
  assert.equal(result.session.commandSession.match.unitMeta[ctx.targetUID].damageMarks.length, 1);
  const forged = setup(IDS[0], { serviceEdit: { resolveDamage: request => ({
    status: 'approved', proofId: 'forged-attribution', targetLegality: 'approved',
    preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled',
    resolvedMarks: [{ uid: request.targetUIDs[0], amount: request.amount,
      responsiblePlayerId: 'b', sourceObjectIds: [request.source.sourceUID] }],
  }) } });
  const blocked = resolveDuelSpellCardPlayV2(payAndClose(forged).session, 'a');
  assert.equal(blocked.outcome.status, 'pending');
  assert.equal(blocked.session.commandSession.match.unitMeta[forged.targetUID].damageMarks.length, 0);
  assert.equal(forged.effects.size, 0);
  const foreignSource = setup(IDS[0], { serviceEdit: { resolveDamage: request => ({
    status: 'approved', proofId: 'forged-source', targetLegality: 'approved',
    preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled',
    resolvedMarks: [{ uid: request.targetUIDs[0], amount: request.amount,
      responsiblePlayerId: request.source.controllerPlayerId,
      sourceObjectIds: [request.source.sourceUID, 'foreign-effect'] }],
  }) } });
  const foreign = resolveDuelSpellCardPlayV2(payAndClose(foreignSource).session, 'a');
  assert.equal(foreign.outcome.status, 'pending');
  assert.equal(foreign.session.commandSession.match.unitMeta[foreignSource.targetUID].damageMarks.length, 0);
  assert.equal(foreignSource.effects.size, 0);
});

test('failed effect persistence retains one candidate and retry never applies damage again', () => {
  const ctx = setup(IDS[0]);
  let first = true;
  const commit = ctx.service.dispatcher.commitEffect;
  ctx.service.dispatcher.commitEffect = request => {
    if (first) { first = false; throw Error('storage temporarily unavailable'); }
    commit(request);
  };
  let result = resolveDuelSpellCardPlayV2(payAndClose(ctx).session, 'a');
  assert.equal(result.outcome.status, 'pending');
  assert.equal(ctx.damageCalls, 1);
  assert.equal(result.session.commandSession.match.unitMeta[ctx.targetUID].damageMarks.length, 1);
  result = resolveDuelSpellCardPlayV2(result.session, 'a');
  assert.equal(result.outcome.status, 'applied', result.outcome.reason);
  assert.equal(ctx.damageCalls, 1);
  assert.equal(result.session.commandSession.match.unitMeta[ctx.targetUID].damageMarks.length, 1);
  assert.equal(ctx.effects.size, 1);
});

test('Point callback reentry stays pending before native damage and succeeds on a later retry', () => {
  let resolutionSession, reenter = true;
  const ctx = setup(IDS[0], { serviceEdit: { resolveDamage: request => {
    if (reenter) {
      reenter = false;
      assert.throws(() => resolveDuelSpellCardPlayV2(resolutionSession, 'a'), /reentrant command/);
    }
    return { status: 'approved', proofId: 'current-damage', targetLegality: 'approved',
      preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled',
      resolvedMarks: [{ uid: request.targetUIDs[0], amount: request.amount,
        responsiblePlayerId: request.source.controllerPlayerId,
        sourceObjectIds: [request.source.sourceUID, request.source.effectId] }] };
  } } });
  const ready = payAndClose(ctx);
  resolutionSession = ready.session;
  let result = resolveDuelSpellCardPlayV2(ready.session, 'a');
  assert.equal(result.outcome.status, 'pending');
  assert.equal(result.session.commandSession.match.unitMeta[ctx.targetUID].damageMarks.length, 0);
  result = resumeDuelSpellEffectV2(result.session);
  assert.equal(result.outcome.status, 'applied', result.outcome.reason);
  assert.equal(result.session.commandSession.match.unitMeta[ctx.targetUID].damageMarks.length, 1);
  assert.equal(ctx.effects.size, 1);
});

test('a real Reaction resolves above Point in LIFO order before the original target is damaged', () => {
  const ctx = setup(IDS[0], { responseReaction: true });
  let current = cast(ctx, 'lower-point');
  for (let i = 0; i < 2; i++) {
    const rune = current.session.commandSession.match.resources.bases.find(base => base.playerId === 'a')
      .baseRunes.find(value => value.readied);
    current = applyDuelSpellResourceCommandV2(current.session, 'a', {
      commandId: `lower-energy-${i}`, expectedVersion: current.session.commandSession.match.stateVersion,
      command: { type: 'rune-energy', uid: rune.uid } });
  }
  current = applyDuelSpellResourceCommandV2(current.session, 'a', { commandId: 'lower-pay',
    expectedVersion: current.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: `spell-payment:${JSON.stringify(['a', 'lower-point'])}` } });
  assert.equal(current.outcome.step, 'priority');
  current = finalizeDuelSpellCardPlayV2(current.session, 'a');
  current = passDuelSpellPriorityV2(current.session, 'a');
  const reactionUID = current.session.commandSession.match.players[1].hand
    .find(value => value.cardId === 'point-reaction').uid;
  current = playDuelSpellCardV2(current.session, 'b', { commandId: 'upper-reaction',
    expectedVersion: current.session.commandSession.match.stateVersion,
    command: { cardUID: reactionUID } });
  assert.equal(current.outcome.step, 'payment', current.outcome.reason);
  const rune = current.session.commandSession.match.resources.bases.find(base => base.playerId === 'b')
    .baseRunes.find(value => value.readied);
  current = applyDuelSpellResourceCommandV2(current.session, 'b', { commandId: 'upper-energy',
    expectedVersion: current.session.commandSession.match.stateVersion,
    command: { type: 'rune-energy', uid: rune.uid } });
  current = applyDuelSpellResourceCommandV2(current.session, 'b', { commandId: 'upper-pay',
    expectedVersion: current.session.commandSession.match.stateVersion,
    command: { type: 'pay-pending', paymentId: `spell-payment:${JSON.stringify(['b', 'upper-reaction'])}` } });
  assert.equal(current.outcome.step, 'priority', current.outcome.reason);
  current = finalizeDuelSpellCardPlayV2(current.session, 'b');
  current = passDuelSpellPriorityV2(current.session, 'b');
  current = passDuelSpellPriorityV2(current.session, 'a');
  current = resolveDuelSpellCardPlayV2(current.session, 'b');
  assert.equal(current.outcome.status, 'applied', current.outcome.reason);
  assert.equal(current.outcome.effect, 'draw-cards');
  assert.equal(current.session.chain.items.length, 1);
  assert.equal(ctx.damageCalls, 0);
  current = passDuelSpellPriorityV2(current.session, 'a');
  current = passDuelSpellPriorityV2(current.session, 'b');
  current = resolveDuelSpellCardPlayV2(current.session, 'a');
  assert.equal(current.outcome.status, 'applied', current.outcome.reason);
  assert.equal(current.outcome.effect, 'point-damage');
  assert.equal(ctx.damageCalls, 1);
  assert.equal(current.session.chain.items.length, 0);
});

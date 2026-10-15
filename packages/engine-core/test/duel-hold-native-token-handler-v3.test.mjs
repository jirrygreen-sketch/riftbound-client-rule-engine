import test from 'node:test';
import assert from 'node:assert/strict';
import { playing, oracle, metadata, seats, types } from './duel-phase-source-authority-v2.test.mjs';
import {
  applyDuelResourceCommandV2, commitDuelCommandMutationV2,
} from '../dist/duel/canonical-session-v2.js';
import {
  attestDuelTokenSourceV2, commitDuelPlayingMutationV2, createDuelRecruitUnitV2,
  inspectDuelNativeTokenHistoryV2,
} from '../dist/duel/core-v2.js';
import { runDuelStartOfTurnV2 } from '../dist/duel/turn-executor-v2.js';
import { createDuelPhaseSourceRegistryWithNativeTokenSourceV2 } from '../dist/duel/phase-source-authority-v2.js';

function holdOracle({ tokenProof = true, allHandlers = false, nonSubjectHandler = false } = {}) {
  const printings = [...new Set(seats.flatMap(seat => [seat.champion.cardId,
    seat.legend.cardId, ...seat.mainDeck.map(card => card.cardId),
    ...seat.runeDeck.map(card => card.cardId), ...seat.battlefields.map(card => card.cardId)]))]
    .map(cardId => ({ cardId, programReference: `test-native:${cardId}` }));
  const handledUID = playing().match.board.battlefields[0].instanceId;
  const physical = request => ({
    status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `test-native:${request.source.cardId}`,
    event: request.event, eventSupported: true,
    scope: request.event === 'hold' && ((allHandlers && request.source.kind === 'battlefield' &&
      (request.subjectUID === undefined || request.source.uid === request.subjectUID)) ||
      (nonSubjectHandler && request.source.kind === 'legend' && request.source.controllerPlayerId === 'alice') ||
      (request.source.uid === handledUID && request.source.kind === 'battlefield' &&
        (request.subjectUID === undefined || request.source.uid === request.subjectUID))) &&
      request.source.controllerPlayerId === 'alice'
      ? 'handlers-or-modifiers' : 'known-no-handler',
    replacementsCovered: true, staticCovered: true, continuousCovered: true, triggersCovered: true,
  });
  const token = request => {
    if (!tokenProof) return { status: 'unknown' };
    if (request.source.kind !== 'unit' || request.source.cardId !== null ||
        request.source.zone.kind !== 'board-base' || request.source.zoneEpoch !== null) return { status: 'unknown' };
    const unit = request.match.board.units.find(item => item.objectId === request.source.uid);
    const trait = unit && request.match.unitMeta[unit.objectId]?.trait;
    const birth = inspectDuelNativeTokenHistoryV2(request.match).births.find(item =>
      item.kind === 'recruit' && item.tokenUID === request.source.uid);
    if (!unit || unit.controllerPlayerId !== request.source.controllerPlayerId ||
        unit.locationId !== request.source.zone.locationId || !trait || trait.kind !== 'token' ||
        trait.name !== 'Recruit' || trait.baseMight !== 1 || JSON.stringify(trait.tags) !== JSON.stringify(['Recruit']) ||
        !birth || birth.controllerPlayerId !== request.source.controllerPlayerId) return { status: 'unknown' };
    const programReference = JSON.stringify({ birthEventId: birth.eventId,
      catalogDigest: request.catalogDigest, dataVersion: request.dataVersion,
      kind: 'recruit-birth-reference', matchId: request.matchId, schemaVersion: 1,
      sourceEffectId: birth.sourceEffectId, sourceMode: birth.sourceMode,
      sourceProofId: birth.sourceProofId, sourceUID: birth.sourceUID,
      sourceZoneEpoch: birth.sourceZoneEpoch, tokenUID: birth.tokenUID });
    return { status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
      catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
      uid: request.source.uid, zoneEpoch: null, controllerPlayerId: request.source.controllerPlayerId,
      cardId: null, programReference, event: request.event,
      eventSupported: true, scope: 'known-no-handler', replacementsCovered: true,
      staticCovered: true, continuousCovered: true, triggersCovered: true };
  };
  return createDuelPhaseSourceRegistryWithNativeTokenSourceV2({ ...metadata, printings }, physical, token);
}

function controlledPlaying() {
  const base = playing();
  return commitDuelCommandMutationV2(base, draft => {
    const field = draft.board.battlefields[0];
    return { match: { ...draft, board: { ...draft.board, battlefields: draft.board.battlefields.map(item =>
      item.locationId === field.locationId ? { ...item, controllerPlayerId: 'alice', contestingPlayerId: null,
        contested: false, combat: 'none', showdown: 'none' } : item) } }, transitions: [] };
  }).session;
}

function services(overrides = {}) {
  return { sources: holdOracle(), fepr: () => ({ status: 'none' }), ...overrides };
}

test('native Hold Recruit is a real successor and the next fixed point sees its birth', () => {
  let calls = 0;
  let observed = 0;
  const result = runDuelStartOfTurnV2(controlledPlaying(), services({
    observeCheckpoint: () => { observed += 1; return true; },
    resolveNativeHandlers: ({ match, sources, step }) => {
      calls += 1;
      assert.equal(step, 'hold');
      const source = sources.find(item => item.kind === 'battlefield');
      assert.ok(source);
      const locationId = match.board.bases.find(base => base.ownerPlayerId === 'alice').locationId;
      const request = { kind: 'recruit', tokenUID: 'native-recruit-1', sourceEffectId: 'hold-effect-1',
        eventId: 'hold-event-1', sourceUID: source.uid, sourceZoneEpoch: source.zoneEpoch,
        sourceMode: 'current', effectControllerPlayerId: 'alice', controllerPlayerId: 'alice',
        locationId, readied: false, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
      const { authority } = attestDuelTokenSourceV2(match, request, ({ match: current, request: asked }) => ({
        ...asked, matchId: current.matchId, dataVersion: current.dataVersion,
        catalogDigest: current.catalogDigest, sourceProofId: 'native-hold-proof-1',
      }));
      return { status: 'applied', match: createDuelRecruitUnitV2(match, request, authority),
        handledSources: [source] };
    },
  }));
  assert.equal(result.status, 'main', result.reason);
  assert.equal(calls, 1);
  assert.ok(observed > 1, 'the native birth must pass another checkpoint');
  const recruit = result.session.match.board.units.find(unit => unit.objectId === 'native-recruit-1');
  assert.equal(recruit.controllerPlayerId, 'alice');
  assert.deepEqual(inspectDuelNativeTokenHistoryV2(result.session.match).births.map(birth =>
    [birth.tokenUID, birth.sourceEffectId, birth.eventId]), [['native-recruit-1', 'hold-effect-1', 'hold-event-1']]);
  assert.equal(result.session.match.stateVersion > controlledPlaying().match.stateVersion, true);
});

test('a native Recruit birth cannot inherit pending whole-program coverage', () => {
  const original = controlledPlaying();
  let calls = 0;
  const result = runDuelStartOfTurnV2(original, services({
    sources: holdOracle({ tokenProof: false }),
    resolveNativeHandlers: ({ match, sources }) => {
      calls += 1;
      const source = sources[0];
      const locationId = match.board.bases.find(base => base.ownerPlayerId === 'alice').locationId;
      const request = { kind: 'recruit', tokenUID: 'pending-proof-recruit', sourceEffectId: 'pending-proof-effect',
        eventId: 'pending-proof-event', sourceUID: source.uid, sourceZoneEpoch: source.zoneEpoch,
        sourceMode: 'current', effectControllerPlayerId: 'alice', controllerPlayerId: 'alice',
        locationId, readied: false, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
      const { authority } = attestDuelTokenSourceV2(match, request, ({ match: checked, request: asked }) => ({
        ...asked, matchId: checked.matchId, dataVersion: checked.dataVersion,
        catalogDigest: checked.catalogDigest, sourceProofId: 'pending-proof-native',
      }));
      return { status: 'applied', match: createDuelRecruitUnitV2(match, request, authority),
        handledSources: [source] };
    },
  }));
  assert.equal(calls, 1);
  assert.equal(result.status, 'pending');
  assert.equal(result.session.match.board.units.some(unit => unit.objectId === 'pending-proof-recruit'), true);
  assert.match(result.pending.taskId, /hold/);
});

test('Hold subjects are local: two held fields each create one Recruit birth', () => {
  const base = controlledPlaying();
  const original = commitDuelCommandMutationV2(base, draft => ({ match: { ...draft,
    board: { ...draft.board, battlefields: draft.board.battlefields.map(field => ({ ...field,
      controllerPlayerId: 'alice', contested: false, contestingPlayerId: null,
      combat: 'none', showdown: 'none' })) } }, transitions: [] })).session;
  const result = runDuelStartOfTurnV2(original, services({
    sources: holdOracle({ allHandlers: true }),
    resolveNativeHandlers: ({ match, sources }) => {
      const source = sources[0];
      const locationId = match.board.bases.find(base => base.ownerPlayerId === 'alice').locationId;
      const request = { kind: 'recruit', tokenUID: `two-field-${source.uid}`,
        sourceEffectId: `two-field-effect-${source.uid}`, eventId: `two-field-event-${source.uid}`,
        sourceUID: source.uid, sourceZoneEpoch: source.zoneEpoch, sourceMode: 'current',
        effectControllerPlayerId: 'alice', controllerPlayerId: 'alice', locationId,
        readied: false, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
      const { authority } = attestDuelTokenSourceV2(match, request, ({ match: checked, request: asked }) => ({
        ...asked, matchId: checked.matchId, dataVersion: checked.dataVersion,
        catalogDigest: checked.catalogDigest, sourceProofId: `two-field-proof-${source.uid}`,
      }));
      return { status: 'applied', match: createDuelRecruitUnitV2(match, request, authority),
        handledSources: [source] };
    },
  }));
  assert.equal(result.status, 'main', result.reason);
  assert.deepEqual(inspectDuelNativeTokenHistoryV2(result.session.match).births
    .filter(birth => birth.kind === 'recruit').map(birth => birth.sourceUID).sort(),
    original.match.board.battlefields.map(field => field.instanceId).sort());
});

test('native Hold cannot skip an unrelated handler at the same boundary', () => {
  const original = controlledPlaying();
  const seen = [];
  const result = runDuelStartOfTurnV2(original, services({
    sources: holdOracle({ nonSubjectHandler: true }),
    resolveNativeHandlers: ({ match, sources }) => {
      seen.push(sources.map(source => `${source.kind}:${source.uid}`));
      const subject = sources.find(source => source.kind === 'battlefield');
      if (!subject) return { status: 'pending' };
      const next = commitDuelPlayingMutationV2(match, draft => ({ match: {
        ...draft, scoring: { ...draft.scoring, players: draft.scoring.players.map(player =>
          player.playerId === 'bob' ? { ...player, points: player.points + 1 } : player) },
      }, transitions: [] }));
      return { status: 'applied', match: next, handledSources: [subject] };
    },
  }));
  assert.equal(result.status, 'pending');
  assert.ok(seen.some(sources => sources.some(source => source.startsWith('legend:'))));
  assert.match(result.pending.taskId, /hold/);
});

test('native capability rejects same-head, foreign, wrong-turn and fake token responses without publication', () => {
  const original = controlledPlaying();
  for (const response of [
    ({ match }) => ({ status: 'applied', match }),
    ({ match }) => ({ status: 'applied', match: structuredClone(match) }),
    ({ match }) => ({ status: 'applied', match: playing().match }),
    ({ match }) => ({ status: 'applied', match: { ...match, frame: { ...match.frame,
      turnPlayerId: 'bob' } } }),
  ]) {
    const result = runDuelStartOfTurnV2(original, services({
      resolveNativeHandlers: context => response(context),
    }));
    assert.equal(result.status, 'pending');
    assert.equal(result.session.match.board.units.length, 0);
    assert.equal(result.session.match.frame.turnPlayerId, 'alice');
  }
});

test('native callback reentry is fail-closed while legacy draft handler remains available', () => {
  const original = controlledPlaying();
  let entered = false;
  let nested;
  const reentrant = context => {
    if (!entered) {
      entered = true;
      nested = runDuelStartOfTurnV2(original, services({ resolveNativeHandlers: reentrant }));
    }
    return { status: 'pending' };
  };
  const result = runDuelStartOfTurnV2(original, services({ resolveNativeHandlers: reentrant }));
  assert.equal(result.status, 'pending');
  assert.equal(nested.status, 'pending');
  assert.equal(result.session.match.board.units.length, 0);

  let legacyCalls = 0;
  const legacy = runDuelStartOfTurnV2(original, services({
    resolveHandlers: ({ match }) => {
      legacyCalls += 1;
      return { status: 'applied', match: { ...match, scoring: { ...match.scoring,
        players: match.scoring.players.map(player => player.playerId === 'bob'
          ? { ...player, points: player.points + 1 } : player) } }, transitions: [] };
    },
  }));
  assert.equal(legacy.status, 'main', legacy.reason);
  assert.ok(legacyCalls > 0);
});

test('nested native pipeline poisons an outer applied response', () => {
  const original = controlledPlaying();
  let entered = false;
  let nested;
  const reentrantApplied = context => {
    if (!entered) {
      entered = true;
      nested = runDuelStartOfTurnV2(original, services({ resolveNativeHandlers: reentrantApplied }));
    }
    const source = context.sources[0];
    const locationId = context.match.board.bases.find(base => base.ownerPlayerId === 'alice').locationId;
    const request = { kind: 'recruit', tokenUID: 'poisoned-outer-recruit', sourceEffectId: 'poisoned-outer-effect',
      eventId: 'poisoned-outer-event', sourceUID: source.uid, sourceZoneEpoch: source.zoneEpoch,
      sourceMode: 'current', effectControllerPlayerId: 'alice', controllerPlayerId: 'alice',
      locationId, readied: false, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
    const { authority } = attestDuelTokenSourceV2(context.match, request,
      ({ match, request: asked }) => ({ ...asked, matchId: match.matchId,
        dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
        sourceProofId: 'poisoned-outer-proof' }));
    return { status: 'applied', match: createDuelRecruitUnitV2(context.match, request, authority) };
  };
  const result = runDuelStartOfTurnV2(original, services({ resolveNativeHandlers: reentrantApplied }));
  assert.equal(nested.status, 'pending');
  assert.equal(result.status, 'pending');
  assert.equal(result.session.match.board.units.length, 0);
});


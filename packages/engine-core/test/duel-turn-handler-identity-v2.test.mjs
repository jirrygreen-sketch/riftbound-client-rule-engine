import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuelCommandSessionV2, applyDuelResourceCommandV2,
  commitDuelCommandMutationV2 } from '../dist/duel/canonical-session-v2.js';
import { createDuelPhaseSourceRegistryV2 } from '../dist/duel/phase-source-authority-v2.js';
import { runDuelStartOfTurnV2 } from '../dist/duel/turn-executor-v2.js';
import { placeDuelUnit, relocateDuelUnit } from '../dist/duel/battlefields.js';

const seats = ['alice', 'bob'].map(playerId => ({ playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-card-${i}`, cardId: 'plain-unit' })),
  champion: { uid: `${playerId}-champion`, cardId: 'plain-champion' },
  legend: { uid: `${playerId}-legend`, cardId: 'plain-legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) =>
    ({ uid: `${playerId}-rune-${i}`, cardId: 'plain-rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) =>
    ({ instanceId: `${playerId}-field-${i}`, cardId: `plain-field-${i}` })),
}));
const metadata = { matchId: 'handler-identity-v2', dataVersion: 'handler-identity-fixture',
  catalogDigest: 'sha256:handler-identity-fixture',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const cardType = cardId => cardId === 'plain-champion' ? 'Champion' :
  cardId === 'plain-legend' ? 'Legend' : cardId === 'plain-rune' ? 'Rune' :
    cardId.startsWith('plain-field-') ? 'Battlefield' : 'Unit';
const printings = ['plain-unit', 'plain-champion', 'plain-legend', 'plain-rune',
  'plain-field-0', 'plain-field-1', 'plain-field-2']
  .map(cardId => ({ cardId, programReference: `test-only-whole-program:${cardId}` }));

function admittedPlayingSession() {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, cardType);
  for (const actor of ['alice', 'bob']) {
    const result = applyDuelResourceCommandV2(session, actor, {
      commandId: `mulligan-${actor}`, expectedVersion: session.match.stateVersion,
      command: { type: 'mulligan', selectedUIDs: [] },
    });
    assert.equal(result.outcome.status, 'applied');
    session = result.session;
  }
  assert.equal(session.match.stage, 'playing');
  assert.equal(session.match.frame.phase, 'awaiting-turn-start');
  return session;
}

function sourceRegistry(targetUID) {
  return createDuelPhaseSourceRegistryV2({
    matchId: metadata.matchId, dataVersion: metadata.dataVersion,
    catalogDigest: metadata.catalogDigest, printings,
  }, request => ({
    status: 'complete', matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `test-only-whole-program:${request.source.cardId}`,
    event: request.event, eventSupported: true,
    // The target is a real card entered from hand into its Base before Awaken.
    scope: request.event === 'awaken' &&
      (request.source.kind === 'legend' || request.source.uid === targetUID)
      ? 'handlers-or-modifiers' : 'known-no-handler',
    replacementsCovered: true, staticCovered: true, continuousCovered: true,
    triggersCovered: true,
  }));
}

function handlerSource(source) {
  return {
    uid: source.uid, kind: source.kind, cardId: source.cardId,
    zoneEpoch: source.zoneEpoch, controllerPlayerId: source.controllerPlayerId,
    zone: { ...source.zone },
  };
}

function legacyHandlerKey(source) {
  // This is the pre-fix identity intentionally retained as a negative control. It aliases
  // board-only relocation plus control change when the physical epoch is unchanged.
  return JSON.stringify([source.uid, source.zoneEpoch, source.kind, source.cardId]);
}

test('Awaken re-resolves a UID once per changed controller/zone identity and reaches fixed point', () => {
  let session = admittedPlayingSession();
  const targetUID = session.match.players[0].hand[0].uid;
  const initialLocationId = session.match.board.bases[0].locationId;
  session = commitDuelCommandMutationV2(session, draft => ({
    match: { ...draft,
      board: placeDuelUnit(draft.board, {
        objectId: targetUID, controllerPlayerId: 'alice', locationId: initialLocationId,
      }),
      players: draft.players.map(player => player.playerId === 'alice'
        ? { ...player, hand: player.hand.filter(card => card.uid !== targetUID) } : player),
      unitMeta: { ...draft.unitMeta, [targetUID]: {
        ownerPlayerId: 'alice', readied: true, damageMarks: [],
        trait: { kind: 'card', cardId: 'plain-unit' },
      } },
    },
    transitions: [{ uid: targetUID,
      from: { kind: 'hand', zonePlayerId: 'alice' },
      to: { kind: 'board-base', locationId: initialLocationId },
    }],
  })).session;
  assert.equal(session.match.frame.phase, 'awaiting-turn-start');
  assert.equal(session.match.provenance.transitions.at(-1).uid, targetUID);
  const calls = [];
  const sources = sourceRegistry(targetUID);
  const result = runDuelStartOfTurnV2(session, {
    sources,
    fepr: () => ({ status: 'none' }),
    resolveHandlers: ({ match, sources: handlers }) => {
      calls.push(handlers.map(handlerSource));
      const target = handlers.find(source => source.uid === targetUID);
      assert.ok(target);
      if (calls.length === 1) {
        assert.equal(target.controllerPlayerId, 'alice');
        assert.deepEqual(target.zone, { kind: 'board-base', locationId: match.board.bases[0].locationId });
        const locationId = match.board.battlefields[0].locationId;
        const moved = relocateDuelUnit(match.board, targetUID, locationId);
        // A board-only relocation changes the eligible source zone but not controller or
        // physical epoch; source enumeration must expose the newly qualified battlefield.
        return { status: 'applied', match: { ...match, board: moved }, transitions: [{ uid: targetUID,
          from: { kind: 'board-base', locationId: match.board.bases[0].locationId },
          to: { kind: 'board-battlefield', locationId },
        }] };
      }
      if (calls.length === 2) {
        assert.equal(target.controllerPlayerId, 'alice');
        assert.equal(target.zone.kind, 'board-battlefield');
        // A second trusted resolution changes only control. The physical UID/epoch and zone
        // remain stable, so this specifically exercises the controller component of identity.
        const locationId = match.board.battlefields[0].locationId;
        const board = { ...match.board,
          units: match.board.units.map(unit => unit.objectId === targetUID
            ? { ...unit, controllerPlayerId: 'bob' } : unit),
          battlefields: match.board.battlefields.map(field => field.locationId === locationId
            ? { ...field, contestingPlayerId: 'bob' } : field),
        };
        return { status: 'applied', match: { ...match, board }, transitions: [] };
      }
      assert.equal(calls.length, 3);
      assert.equal(target.controllerPlayerId, 'bob');
      assert.equal(target.zone.kind, 'board-battlefield');
      return { status: 'applied', match: { ...match,
        scoring: { ...match.scoring,
          players: match.scoring.players.map(player => player.playerId === 'bob'
            ? { ...player, points: player.points + 1 } : player) },
      }, transitions: [] };
    },
  });

  assert.equal(result.status, 'main', result.reason);
  assert.equal(calls.length, 3, 'fixed point must include each changed target identity');
  assert.deepEqual(calls.map(batch => batch.map(source => source.uid)), [
    [targetUID, 'alice-legend', 'bob-legend'], [targetUID], [targetUID],
  ], 'settled Legends and earlier target identities must not replay');
  const targetCalls = calls.flat().filter(source => source.uid === targetUID);
  assert.equal(targetCalls.length, 3, 'each changed target identity is handled once');
  assert.equal(targetCalls[0].zone.kind, 'board-base');
  assert.equal(targetCalls[0].controllerPlayerId, 'alice');
  assert.equal(targetCalls[1].zone.kind, 'board-battlefield');
  assert.equal(targetCalls[1].controllerPlayerId, 'alice');
  assert.equal(targetCalls[2].zone.kind, 'board-battlefield');
  assert.equal(targetCalls[2].controllerPlayerId, 'bob');
  assert.equal(targetCalls[0].zoneEpoch, 1);
  assert.equal(targetCalls[1].zoneEpoch, 1,
    'board-only relocation must not manufacture a new physical epoch');
  assert.equal(targetCalls[2].zoneEpoch, 1,
    'controller-only change must not manufacture a new physical epoch');
  assert.equal(legacyHandlerKey(targetCalls[0]), legacyHandlerKey(targetCalls[1]),
    'negative control: the old key aliases these two qualified sources');
  assert.equal(legacyHandlerKey(targetCalls[1]), legacyHandlerKey(targetCalls[2]),
    'negative control: the old key also aliases controller-only changes');
  assert.notDeepEqual(targetCalls[0], targetCalls[1]);
  assert.notDeepEqual(targetCalls[1], targetCalls[2]);
  assert.equal(result.session.match.scoring.players.find(player => player.playerId === 'bob').points, 1,
    'the final fixed-point handler must execute after the identity change');
  assert.equal(result.session.match.frame.phase, 'main');
});

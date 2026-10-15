import { describe, expect, it } from 'vitest';
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 } from '@riftbound/protocol';
import { loadCardCatalogRuntime, validateCatalogDeck } from '../../src/card-catalog.js';
import {
  createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT,
  DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT, DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN,
} from '../../src/duel/command-journal-p4.js';
import { fury77RealDecks } from './fixtures/fury77-real-decks.js';

async function fixture() {
  const catalog = await loadCardCatalogRuntime();
  for (const deck of Object.values(fury77RealDecks)) {
    const validated = validateCatalogDeck(catalog, deck);
    expect(validated.valid).toBe(true);
    expect(validated.issues).toEqual([]);
  }
  let uid = 0;
  return { catalog, matchId: 'optional-profile-real-roster', randomIndex: () => 0,
    uidFactory: () => `optional-profile-${++uid}`,
    roster: [{ playerId: 'alice', displayName: 'Alice', deck: fury77RealDecks.a },
      { playerId: 'bob', displayName: 'Bob', deck: fury77RealDecks.b }] as const };
}

describe('explicit optional Unit archive profile', () => {
  it('runs four real turns with enabled actions and preserves both views through replay', async () => {
    const options = await fixture();
    const recorded = createDuelRecordedRuntimeP4(options, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT);
    for (let index = 0; index < 2; index++) {
      const view = recorded.runtime.project(null);
      if (view.match.stage !== 'setup') throw new Error('actual setup required');
      const commandId = `real-mulligan-${index}`;
      expect(recorded.runtime.dispatch(view.match.setup.currentMulliganOwner!, {
        type: 'duel-command', commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
        requestId: commandId, commandId, expectedVersion: view.match.stateVersion,
        command: { type: 'mulligan', selectedUIDs: [] },
      }).ack.ok).toBe(true);
    }
    for (let index = 0; index < 4; index++) {
      const before = recorded.runtime.project(null);
      if (before.match.stage !== 'playing') throw new Error('actual playing state required');
      expect(before.match.frame.phase).toBe('main');
      expect(before.match.frame.execution.status).toBe('ready');
      const actor = before.match.frame.turnPlayerId;
      const action = recorded.runtime.project(actor).actions.find(value => value.kind === 'end-turn' && value.enabled);
      if (!action || action.kind !== 'end-turn') throw new Error('enabled End action required');
      const commandId = `real-end-${index}`;
      expect(recorded.runtime.dispatch(actor, {
        type: 'duel-command', commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
        requestId: commandId, commandId, expectedVersion: before.match.stateVersion,
        command: { type: 'end-turn', windowId: action.windowId },
      }).ack.ok).toBe(true);
      const after = recorded.runtime.project(null);
      if (after.match.stage !== 'playing') throw new Error('actual successor required');
      expect(after.match.frame.phase).toBe('main');
      expect(after.match.frame.turnNumber).toBe(before.match.frame.turnNumber + 1);
      expect(after.match.frame.turnPlayerId).not.toBe(actor);
      expect(after.match.stateVersion).toBeGreaterThan(before.match.stateVersion);
      expect(recorded.runtime.resumePending()).toBeNull();
    }
    const archive = recorded.archive();
    const restored = replayDuelCommandArchiveP4(archive,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(archive), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT));
    for (const viewer of ['alice', 'bob', null])
      expect(restored.runtime.project(viewer)).toEqual(recorded.runtime.project(viewer));
    expect(restored.archive()).toEqual(archive);
  }, 30_000);

  it('pins schema 6 and replays actual legal rosters through both mulligans', async () => {
    const options = await fixture();
    const recorded = createDuelRecordedRuntimeP4(options, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT);
    for (const commandId of ['optional-m1', 'optional-m2']) {
      const view = recorded.runtime.project(null);
      if (view.match.stage !== 'setup') throw new Error('actual setup required');
      const actor = view.match.setup.currentMulliganOwner!;
      const result = recorded.runtime.dispatch(actor, { type: 'duel-command',
        commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, commandId, requestId: commandId,
        expectedVersion: view.match.stateVersion, command: { type: 'mulligan', selectedUIDs: [] } });
      expect(result.ack.ok).toBe(true);
    }
    const archive = recorded.archive();
    expect(archive.schemaVersion).toBe(6);
    expect(archive.profile).toBe(DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT);
    expect(archive.semanticVersion).toBe(DUEL_RUNTIME_SEMANTIC_VERSION_P4_OPTIONAL_UNIT);
    const restored = replayDuelCommandArchiveP4(archive,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(archive), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT));
    expect(restored.archive()).toEqual(archive);
    expect(recorded.fork().archive()).toEqual(archive);
    for (const viewer of ['alice', 'bob', null])
      expect(restored.runtime.project(viewer)).toEqual(recorded.runtime.project(viewer));
  });

  it('requires the independent optional profile and its exact semantic version', async () => {
    const options = await fixture();
    const recorded = createDuelRecordedRuntimeP4(options, DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT);
    const archive = recorded.archive();
    const digest = digestDuelCommandArchiveP4(archive);
    expect(() => replayDuelCommandArchiveP4(archive,
      createDuelReplayGateP4(options, digest))).toThrow(/profile mismatch/);
    for (const forged of [
      { ...archive, semanticVersion: 'future-version' },
      { ...archive, schemaVersion: 4 as const },
      { ...archive, profile: DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN },
    ]) {
      expect(() => replayDuelCommandArchiveP4(forged,
        createDuelReplayGateP4(options, digestDuelCommandArchiveP4(forged), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT)))
        .toThrow(/profile mismatch/);
    }
  });

  it('retains the historical public Chain default and rejects new-profile gate downgrade', async () => {
    const options = await fixture();
    const recorded = createDuelRecordedRuntimeP4(options);
    const archive = recorded.archive();
    expect(archive.schemaVersion).toBe(4);
    expect(archive.profile).toBe(DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN);
    expect(archive.semanticVersion).toBe('riftbound-p4-public-chain-v1');
    expect(() => replayDuelCommandArchiveP4(archive,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(archive), DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT)))
      .toThrow(/profile mismatch/);
  });
});

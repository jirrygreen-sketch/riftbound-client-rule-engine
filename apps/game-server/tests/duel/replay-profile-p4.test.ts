import { describe, expect, it } from 'vitest';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import {
  createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4, DUEL_REPLAY_PROFILE_P4_LEGACY, DUEL_REPLAY_PROFILE_P4_SPELL, DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN,
} from '../../src/duel/command-journal-p4.js';
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 } from '@riftbound/protocol';
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';

async function fixture() {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === 'Unit' ? '' : card.cardType === 'Spell' ? 'Draw 4.' :
      card.cardType === 'Legend' ? ':rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.' :
        card.cardType === 'Battlefield' ? 'You may hide an additional card here.' : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: '2026-10-12-official-gallery',
    digest: 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10' } });
  let uid = 0;
  const options = { catalog, matchId: 'p4-replay-profile-fixture', randomIndex: () => 0,
    uidFactory: () => `replay-profile-${++uid}`,
    roster: [{ playerId: 'alice', displayName: 'Alice', deck: setupAdapterFixtureDecks.a.submission },
      { playerId: 'bob', displayName: 'Bob', deck: setupAdapterFixtureDecks.b.submission }] as const };
  return { options };
}

function mulligan(recorded: ReturnType<typeof createDuelRecordedRuntimeP4>, id: string) {
  const projection = recorded.runtime.project(null);
  if (projection.match.stage !== 'setup') throw Error('setup required');
  const actor = projection.match.setup.currentMulliganOwner!;
  const packet = { type: 'duel-command' as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: id, commandId: id, expectedVersion: projection.match.stateVersion,
    command: { type: 'mulligan' as const, selectedUIDs: [] } };
  expect(recorded.runtime.dispatch(actor, packet).ack.ok).toBe(true);
}

function legacyContext(options: Awaited<ReturnType<typeof fixture>>['options']) {
  const catalog = options.catalog;
  return digestDuelCommandArchiveP4({ matchId: options.matchId, roster: options.roster,
    catalog: catalog.publicCatalog, validationCards: catalog.validationCards, deckRules: catalog.deckRules,
    constructedRules: { rules: catalog.constructedRules.rules, policy: catalog.constructedRules.policy,
      identityMetadata: { byCardId: [...catalog.constructedRules.identityMetadata.byCardId]
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
        knownChampionTags: [...catalog.constructedRules.identityMetadata.knownChampionTags].sort() } },
    rules: 'CR-1.4', profile: 'duel-command-v3-actions-1' } as never);
}

function endTurn(recorded: ReturnType<typeof createDuelRecordedRuntimeP4>) {
  const projection = recorded.runtime.project('alice');
  const action = projection.actions.find(value => value.kind === 'end-turn');
  if (!action || action.kind !== 'end-turn') throw Error('real End action required');
  return recorded.runtime.dispatch('alice', { type: 'duel-command' as const,
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, requestId: 'profile-end', commandId: 'profile-end',
    expectedVersion: projection.match.stateVersion,
    command: { type: 'end-turn' as const, windowId: action.windowId } });
}

describe.skip('P4 server-owned replay profiles [legacy-replay-e2cbcdf]', () => {
  it('restores schema 1 and 2 only under an explicit legacy gate, then forks and continues real turns', async () => {
    const { options } = await fixture();
    const recorded = createDuelRecordedRuntimeP4(options, DUEL_REPLAY_PROFILE_P4_LEGACY);
    mulligan(recorded, 'legacy-m-1'); mulligan(recorded, 'legacy-m-2');
    const v2 = recorded.archive();
    expect(v2.schemaVersion).toBe(2);
    expect(v2.profile).toBeUndefined();
    const v1 = { ...v2, schemaVersion: 1 as const, policyCheckedAt: undefined, contextDigest: legacyContext(options) };
    for (const archive of [v1, v2]) {
      const digest = digestDuelCommandArchiveP4(archive);
      expect(() => replayDuelCommandArchiveP4(archive,
        createDuelReplayGateP4(options, digest))).toThrow(/independent replay profile gate/);
      const restored = replayDuelCommandArchiveP4(archive,
        createDuelReplayGateP4(options, digest, { profile: DUEL_REPLAY_PROFILE_P4_LEGACY }));
      expect(restored.runtime.project('alice')).toEqual(recorded.runtime.project('alice'));
      expect(restored.fork().runtime.project(null)).toEqual(recorded.runtime.project(null));
      expect(endTurn(restored).ack.ok).toBe(true);
    }
  }, 30_000);

  it('records the explicit historical Spell profile as schema 3 and preserves it through an isolated fork', async () => {
    const { options } = await fixture();
    const recorded = createDuelRecordedRuntimeP4(options, DUEL_REPLAY_PROFILE_P4_SPELL);
    mulligan(recorded, 'spell-m-1'); mulligan(recorded, 'spell-m-2');
    const archive = recorded.archive();
    expect(archive.schemaVersion).toBe(3);
    expect(archive.profile).toBe(DUEL_REPLAY_PROFILE_P4_SPELL);
    expect(archive.semanticVersion).toBe('riftbound-p4-spell-v1');
    const fork = recorded.fork();
    expect(fork.archive()).toEqual(archive);
    expect(fork.runtime.project('alice')).toEqual(recorded.runtime.project('alice'));
  }, 30_000);

  it('records the new public Chain default as schema 4 and requires its own replay profile', async () => {
    const { options } = await fixture();
    const recorded = createDuelRecordedRuntimeP4(options);
    mulligan(recorded, 'public-m-1'); mulligan(recorded, 'public-m-2');
    const archive = recorded.archive();
    expect(archive.schemaVersion).toBe(4);
    expect(archive.profile).toBe(DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN);
    expect(archive.semanticVersion).toBe('riftbound-p4-public-chain-v1');
    expect(recorded.fork().archive()).toEqual(archive);
    const digest = digestDuelCommandArchiveP4(archive);
    const restored = replayDuelCommandArchiveP4(archive, createDuelReplayGateP4(options, digest));
    for (const actor of ['alice', 'bob', null])
      expect(restored.runtime.project(actor)).toEqual(recorded.runtime.project(actor));
    expect(() => replayDuelCommandArchiveP4(archive,
      createDuelReplayGateP4(options, digest, DUEL_REPLAY_PROFILE_P4_SPELL))).toThrow(/profile mismatch/);
  }, 30_000);

  it('keeps Spell actions out of legacy projections and rejects forged profile/context admission', async () => {
    const { options } = await fixture();
    const legacy = createDuelRecordedRuntimeP4(options, DUEL_REPLAY_PROFILE_P4_LEGACY);
    const spell = createDuelRecordedRuntimeP4(options, DUEL_REPLAY_PROFILE_P4_SPELL);
    mulligan(legacy, 'legacy-action-m-1'); mulligan(legacy, 'legacy-action-m-2');
    mulligan(spell, 'spell-action-m-1'); mulligan(spell, 'spell-action-m-2');
    const legacySpellActions = legacy.runtime.project('alice').actions.filter(action => action.kind === 'play-card' &&
      action.label === '施放法术');
    expect(legacySpellActions).toEqual([]);
    expect(spell.archive().profile).toBe(DUEL_REPLAY_PROFILE_P4_SPELL);

    const archive = legacy.archive();
    const forged = { ...archive, profile: DUEL_REPLAY_PROFILE_P4_SPELL, semanticVersion: 'riftbound-p4-spell-v1' };
    expect(() => replayDuelCommandArchiveP4(forged,
      createDuelReplayGateP4(options, digestDuelCommandArchiveP4(forged), DUEL_REPLAY_PROFILE_P4_LEGACY)))
      .toThrow(/legacy schema profile mismatch/);
    const changed = { ...options, roster: [{ ...options.roster[0], displayName: 'Changed' }, options.roster[1]] as const };
    expect(() => replayDuelCommandArchiveP4(archive,
      createDuelReplayGateP4(changed, digestDuelCommandArchiveP4(archive), DUEL_REPLAY_PROFILE_P4_LEGACY)))
      .toThrow(/context/);
  }, 30_000);
});

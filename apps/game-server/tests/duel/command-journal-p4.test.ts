import { describe, expect, it } from 'vitest';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4, DUEL_RUNTIME_PROFILE_P4_LEGACY } from '../../src/duel/command-journal-p4.js';
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
  const options = { catalog, matchId: 'p4-command-journal-fixture', randomIndex: () => 0,
    // These historical schema/date cases retain their original execution profile.
    // The current Spell profile is covered by replay-profile and recorded-Spell tests.
    runtimeProfile: DUEL_RUNTIME_PROFILE_P4_LEGACY,
    uidFactory: () => `journal-fixture-${++uid}`,
    roster: [{ playerId: 'alice', displayName: 'Alice', deck: setupAdapterFixtureDecks.a.submission },
      { playerId: 'bob', displayName: 'Bob', deck: setupAdapterFixtureDecks.b.submission }] as const };
  return { options, recorded: createDuelRecordedRuntimeP4(options), uidCount: () => uid };
}
function atAuditDay(options: Awaited<ReturnType<typeof fixture>>['options'], checkedAt: string) {
  const catalog = { ...options.catalog,
    publicCatalog: { ...options.catalog.publicCatalog,
      policy: { ...(options.catalog.publicCatalog.policy as object), checkedAt } },
    constructedRules: { ...options.catalog.constructedRules,
      policy: { ...options.catalog.constructedRules.policy, checkedAt } } };
  catalog.publicCatalogJson = `${JSON.stringify(catalog.publicCatalog)}\n`;
  return { ...options, catalog };
}
// Synthetic old schema serialization for the default suite; a real protected
// GUI archive is separately replayed without editing its stored bytes.
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
function mulligan(recorded: Awaited<ReturnType<typeof fixture>>['recorded'], id: string) {
  const p = recorded.runtime.project(null);
  if (p.match.stage !== 'setup') throw Error('setup required');
  const actor = p.match.setup.currentMulliganOwner!;
  const packet = { type: 'duel-command' as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: id, commandId: id, expectedVersion: p.match.stateVersion,
    command: { type: 'mulligan' as const, selectedUIDs: [] } };
  expect(recorded.runtime.dispatch(actor, packet).ack.ok).toBe(true);
  return { actor, packet };
}

describe.skip('P4 private command replay [legacy-replay-e2cbcdf]', () => {
  it('omits repeated genuine null resumes at setup and Main without changing private state or future commands', async () => {
    const f = await fixture();
    const unchanged = () => {
      const archive = f.recorded.archive(), digest = digestDuelCommandArchiveP4(archive);
      const views = [f.recorded.runtime.project('alice'), f.recorded.runtime.project('bob'), f.recorded.runtime.project(null)];
      const uidCount = f.uidCount();
      for (let n = 0; n < 3; n++) {
        expect(f.recorded.runtime.resumePending()).toBeNull();
        expect(f.recorded.archive()).toEqual(archive);
        expect(digestDuelCommandArchiveP4(f.recorded.archive())).toBe(digest);
        expect([f.recorded.runtime.project('alice'), f.recorded.runtime.project('bob'), f.recorded.runtime.project(null)]).toEqual(views);
        expect(f.uidCount()).toBe(uidCount);
      }
    };
    unchanged();
    mulligan(f.recorded, 'noop-m-1'); mulligan(f.recorded, 'noop-m-2');
    expect(f.recorded.runtime.project(null).match.stage).toBe('playing');
    unchanged();
    const fork = f.recorded.fork(), before = f.recorded.archive();
    expect(fork.runtime.resumePending()).toBeNull();
    expect(fork.archive().operations).toEqual(before.operations);
    const p = fork.runtime.project('alice'), end = p.actions.find(action => action.kind === 'end-turn');
    if (!end || end.kind !== 'end-turn') throw Error('real End required');
    expect(fork.runtime.dispatch('alice', { type: 'duel-command', commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: 'noop-end', commandId: 'noop-end', expectedVersion: p.match.stateVersion,
      command: { type: 'end-turn', windowId: end.windowId } }).ack.ok).toBe(true);
    expect(fork.archive().operations).toHaveLength(before.operations.length + 1);
    expect(f.recorded.archive()).toEqual(before);
  }, 30_000);

  it('replays genuine legacy null resumes in both schemas, then uses the live omission policy', async () => {
    for (const schema of [1, 2] as const) {
      const f = await fixture();
      if (schema === 2) { mulligan(f.recorded, 'old-m-1'); mulligan(f.recorded, 'old-m-2'); }
      expect(f.recorded.runtime.resumePending()).toBeNull();
      const snapshot = f.recorded.archive(), observation = snapshot.operations.at(-1)?.observation ?? snapshot.creation.observation;
      const nullOp = { kind: 'resume' as const, entropy: [], observation: { ...observation, ack: null } };
      const v2 = { ...snapshot, operations: [...snapshot.operations, nullOp] };
      const { policyCheckedAt: _metadata, ...rest } = v2;
      const legacy = schema === 1 ? { ...rest, schemaVersion: 1 as const, contextDigest: legacyContext(f.options) } : v2;
      const original = JSON.stringify(legacy), digest = digestDuelCommandArchiveP4(legacy);
      const replayed = replayDuelCommandArchiveP4(legacy, createDuelReplayGateP4(f.options, digest));
      expect(replayed.archive().operations).toEqual(legacy.operations);
      expect(replayed.runtime.resumePending()).toBeNull();
      expect(replayed.archive().operations).toEqual(legacy.operations);
      expect(replayed.fork().archive().operations).toEqual(legacy.operations);
      expect(JSON.stringify(legacy)).toBe(original);
      expect(digestDuelCommandArchiveP4(legacy)).toBe(digest);

      const forgedObservation = structuredClone(legacy) as any;
      forgedObservation.operations.at(-1).observation.privateDigest = '0'.repeat(64);
      expect(() => replayDuelCommandArchiveP4(forgedObservation,
        createDuelReplayGateP4(f.options, digestDuelCommandArchiveP4(forgedObservation)))).toThrow(/private state mismatch/);
      const forgedEntropy = structuredClone(legacy) as any;
      forgedEntropy.operations.at(-1).entropy.push({ kind: 'uid', value: 'unexpected-uid' });
      expect(() => replayDuelCommandArchiveP4(forgedEntropy,
        createDuelReplayGateP4(f.options, digestDuelCommandArchiveP4(forgedEntropy)))).toThrow(/unused entropy/);
    }
  }, 30_000);

  it('restores v2 across UTC audit-day changes and preserves the recorded date through forks', async () => {
    const f = await fixture(), before = atAuditDay(f.options, '2026-10-13'), after = atAuditDay(f.options, '2026-10-14');
    const recorded = createDuelRecordedRuntimeP4(before); mulligan(recorded, 'day-m-1');
    const archive = recorded.archive();
    expect(archive.schemaVersion).toBe(2);
    expect(archive.policyCheckedAt).toBe('2026-10-13');
    const restored = replayDuelCommandArchiveP4(archive, createDuelReplayGateP4(after, digestDuelCommandArchiveP4(archive)));
    expect(restored.runtime.project('alice')).toEqual(recorded.runtime.project('alice'));
    expect(restored.archive().contextDigest).toBe(archive.contextDigest);
    expect(restored.fork().archive().policyCheckedAt).toBe('2026-10-13');
  });

  it('recovers only the missing v1 audit date by its original context hash, then emits v2', async () => {
    const f = await fixture(), before = atAuditDay(f.options, '2026-10-13'), after = atAuditDay(f.options, '2026-10-14');
    const recorded = createDuelRecordedRuntimeP4(before); mulligan(recorded, 'legacy-m-1');
    const { policyCheckedAt: _metadata, ...snapshot } = recorded.archive();
    const legacy = { ...snapshot, schemaVersion: 1 as const, contextDigest: legacyContext(before) };
    const expected = digestDuelCommandArchiveP4(legacy), raw = JSON.stringify(legacy);
    const restored = replayDuelCommandArchiveP4(legacy, createDuelReplayGateP4(after, expected));
    expect(restored.runtime.project('bob')).toEqual(recorded.runtime.project('bob'));
    expect(restored.archive().schemaVersion).toBe(2);
    expect(restored.archive().policyCheckedAt).toBe('2026-10-13');
    expect(JSON.stringify(legacy)).toBe(raw);
    expect(digestDuelCommandArchiveP4(legacy)).toBe(expected);
  });

  it('does not normalize effective policy, availability, rule or printing-stat changes in either schema', async () => {
    const f = await fixture(), before = atAuditDay(f.options, '2026-10-13'), after = atAuditDay(f.options, '2026-10-14');
    const recorded = createDuelRecordedRuntimeP4(before), v2 = recorded.archive();
    const { policyCheckedAt: _metadata, ...snapshot } = v2;
    const v1 = { ...snapshot, schemaVersion: 1 as const, contextDigest: legacyContext(before) };
    for (const archive of [v1, v2]) for (const mutate of [
      (catalog: typeof after.catalog) => { (catalog.publicCatalog.cards[0] as any).available = !catalog.publicCatalog.cards[0]!.available; },
      (catalog: typeof after.catalog) => { (catalog.publicCatalog.cards[0] as any).energy = 991; },
      (catalog: typeof after.catalog) => { (catalog.constructedRules.policy as any).banResolutionComplete = !catalog.constructedRules.policy.banResolutionComplete; },
      (catalog: typeof after.catalog) => { (catalog.deckRules as any).defaultMaxCopiesPerCanonical = 991; },
    ]) {
      const changed = { ...after, catalog: structuredClone(after.catalog) }; mutate(changed.catalog);
      expect(() => replayDuelCommandArchiveP4(archive, createDuelReplayGateP4(changed, digestDuelCommandArchiveP4(archive)))).toThrow(/context/);
    }
    const missing = { ...v2, policyCheckedAt: undefined };
    expect(() => replayDuelCommandArchiveP4(missing, createDuelReplayGateP4(after, digestDuelCommandArchiveP4(missing)))).toThrow(/context/);
  });

  it('replays actual setup and Main, compares private state, and resumes with fresh live entropy', async () => {
    const f = await fixture();
    mulligan(f.recorded, 'm-1'); mulligan(f.recorded, 'm-2');
    const snapshot = f.recorded.archive(), digest = digestDuelCommandArchiveP4(snapshot);
    const restored = replayDuelCommandArchiveP4(JSON.parse(JSON.stringify(snapshot)), createDuelReplayGateP4(f.options, digest));
    expect(restored.runtime.project('alice')).toEqual(f.recorded.runtime.project('alice'));
    const p = restored.runtime.project('alice'), end = p.actions.find(action => action.kind === 'end-turn');
    if (!end || end.kind !== 'end-turn') throw Error('real End required');
    expect(restored.runtime.dispatch('alice', { type: 'duel-command', commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: 'end', commandId: 'end', expectedVersion: p.match.stateVersion,
      command: { type: 'end-turn', windowId: end.windowId } }).ack.ok).toBe(true);
    expect(restored.archive().operations).toHaveLength(3);
  }, 30_000);

  it('forks a real isolated owner and keeps duplicate commands from consuming entropy', async () => {
    const f = await fixture(), first = mulligan(f.recorded, 'm-1');
    const copy = f.recorded.fork();
    expect(copy.runtime.dispatch(first.actor, first.packet).ack.duplicate).toBe(true);
    expect(copy.archive().operations.at(-1)?.entropy).toEqual([]);
    const before = f.recorded.runtime.project(null);
    mulligan(copy, 'm-2');
    expect(f.recorded.runtime.project(null)).toEqual(before);
    expect(copy.runtime.project(null).match.stage).toBe('playing');
  }, 30_000);

  it('refuses a copied gate, changed command body and a different independent roster', async () => {
    const f = await fixture(); mulligan(f.recorded, 'm-1');
    const archive = f.recorded.archive(), digest = digestDuelCommandArchiveP4(archive);
    const gate = createDuelReplayGateP4(f.options, digest);
    expect(() => replayDuelCommandArchiveP4(archive, { ...gate })).toThrow(/unadmitted/);
    const forged = JSON.parse(JSON.stringify(archive)); forged.operations[0].actor = 'bob';
    expect(() => replayDuelCommandArchiveP4(forged, gate)).toThrow(/digest/);
    const other = { ...f.options, roster: [{ ...f.options.roster[0], displayName: 'Changed' }, f.options.roster[1]] as const };
    expect(() => replayDuelCommandArchiveP4(archive, createDuelReplayGateP4(other, digest))).toThrow(/context/);
  });
});

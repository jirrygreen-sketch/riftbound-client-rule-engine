import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { createPersistentDuelRuntimeP4, openPersistentDuelRuntimeP4 } from '../../src/duel/persistent-command-runtime-p4.js';
import { createPrivateJournalCasStore, openPrivateJournalCasStore } from '../../src/duel/private-journal-cas-store.js';
import { createDuelRecordedRuntimeP4 } from '../../src/duel/command-journal-p4.js';
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, isJournal } from '@riftbound/protocol';
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';

async function options(directory: string) {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === 'Unit' ? '' : card.cardType === 'Spell' ? 'Draw 4.' :
      card.cardType === 'Legend' ? ':rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.' :
        card.cardType === 'Battlefield' ? 'You may hide an additional card here.' : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: '2026-10-12-official-gallery', digest: 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10' } });
  let uid = 0;
  return { directory, catalog, matchId: 'persistent-p4-fixture', randomIndex: () => 0,
    uidFactory: () => `persistent-p4-${++uid}`, roster: [
      { playerId: 'alice', displayName: 'Alice', deck: setupAdapterFixtureDecks.a.submission },
      { playerId: 'bob', displayName: 'Bob', deck: setupAdapterFixtureDecks.b.submission }] as const };
}
function packet(version: number, id: string, command: unknown) {
  return { type: 'duel-command', commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: id, commandId: id, expectedVersion: version, command };
}
describe('P4 protected persistence', () => {
  it('records and commits a real non-null pending resume', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-pending-cas-'));
    try {
      const opts = { ...await options(directory), catalog: await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog }) };
      const runtime = await createPersistentDuelRuntimeP4(opts);
      for (let n = 0; n < 2; n++) {
        const p = runtime.project(null);
        if (p.match.stage !== 'setup') throw Error('setup required');
        expect((await runtime.dispatch(p.match.setup.currentMulliganOwner!,
          packet(p.match.stateVersion, `pending-m-${n}`, { type: 'mulligan', selectedUIDs: [] }))).ack.ok).toBe(true);
      }
      const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      const before = await store.load(), resumed = await runtime.resumePending(), after = await store.load();
      expect(resumed?.ack.pending).toBe(true);
      expect(after.head.revision).toBe(before.head.revision + 1);
      const journal = (after.data as { journal: unknown }).journal;
      expect(isJournal(journal)).toBe(true);
      if (!isJournal(journal)) throw Error('journal v1 required');
      expect(journal.entries.at(-1)).toMatchObject({ kind: 'operation', phase: 'resume', pendingReason: 'pending' });
      await runtime.close(); await store.close();
      const restored = await openPersistentDuelRuntimeP4(opts);
      expect(restored.project(null)).toEqual(resumed?.projection);
      await restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('keeps the protected head byte-identical for null resumes and refreshes after another owner writes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-noop-cas-'));
    try {
      const opts = await options(directory), genesis = await createPersistentDuelRuntimeP4(opts);
      await genesis.close();
      const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      const compareAndSwap = vi.fn((...args: Parameters<typeof store.compareAndSwap>) => store.compareAndSwap(...args));
      const tracked = { key: store.key, keyHash: store.keyHash, load: () => store.load(),
        compareAndSwap, close: () => store.close() };
      const first = await openPersistentDuelRuntimeP4({ ...opts, store: tracked });
      const second = await openPersistentDuelRuntimeP4(opts);
      const headPath = path.join(directory, store.keyHash, 'head.json');
      const assertNoWrite = async () => {
        const before = await readFile(headPath), blob = JSON.parse(before.toString());
        const snapshot = await store.load(), views = [first.project('alice'), first.project('bob'), first.project(null)];
        const count = compareAndSwap.mock.calls.length;
        for (let n = 0; n < 3; n++) expect(await first.resumePending()).toBeNull();
        const after = await readFile(headPath), loaded = await store.load(), current = JSON.parse(after.toString());
        expect(after).toEqual(before);
        expect(loaded.head).toEqual(snapshot.head);
        expect(current.revision).toBe(blob.revision);
        expect(current.nonce).toBe(blob.nonce);
        expect(current.payloadDigest).toBe(blob.payloadDigest);
        expect(current.receipts).toEqual(blob.receipts);
        expect(compareAndSwap).toHaveBeenCalledTimes(count);
        expect([first.project('alice'), first.project('bob'), first.project(null)]).toEqual(views);
      };
      await assertNoWrite();
      const before = second.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      expect((await second.dispatch(before.match.setup.currentMulliganOwner!,
        packet(before.match.stateVersion, 'other-m-1', { type: 'mulligan', selectedUIDs: [] }))).ack.ok).toBe(true);
      expect(await first.resumePending()).toBeNull();
      expect(first.project(null)).toEqual(second.project(null));
      expect(compareAndSwap).toHaveBeenCalledTimes(0);
      const refreshed = first.project(null);
      if (refreshed.match.stage !== 'setup') throw Error('setup required');
      expect((await first.dispatch(refreshed.match.setup.currentMulliganOwner!,
        packet(refreshed.match.stateVersion, 'first-m-2', { type: 'mulligan', selectedUIDs: [] }))).ack.ok).toBe(true);
      expect(first.project(null).match.stage).toBe('playing');
      expect(compareAndSwap).toHaveBeenCalledTimes(1);
      await assertNoWrite();
      await first.close(); await second.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('reopens actual Main, preserves duplicate receipts and continues the next real turn', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-cas-'));
    try {
      const opts = await options(directory), runtime = await createPersistentDuelRuntimeP4(opts);
      for (let n = 0; n < 2; n++) {
        const p = runtime.project(null); if (p.match.stage !== 'setup') throw Error('setup required');
        expect((await runtime.dispatch(p.match.setup.currentMulliganOwner!, packet(p.match.stateVersion, `m-${n}`, { type: 'mulligan', selectedUIDs: [] }))).ack.ok).toBe(true);
      }
      const p = runtime.project('alice'), action = p.actions.find(action => action.kind === 'end-turn');
      if (!action || action.kind !== 'end-turn') throw Error('End required');
      const end = packet(p.match.stateVersion, 'end-1', { type: 'end-turn', windowId: action.windowId });
      expect((await runtime.dispatch('alice', end)).ack.ok).toBe(true);
      const before = runtime.project('bob'); await runtime.close();
      const restored = await openPersistentDuelRuntimeP4(opts);
      expect(restored.project('bob')).toEqual(before);
      expect((await restored.dispatch('alice', end)).ack.duplicate).toBe(true);
      expect(restored.project('bob')).toEqual(before);
      const next = restored.project('bob'), secondEnd = next.actions.find(action => action.kind === 'end-turn');
      if (!secondEnd || secondEnd.kind !== 'end-turn') throw Error('next End required');
      expect((await restored.dispatch('bob', packet(next.match.stateVersion, 'end-2', { type: 'end-turn', windowId: secondEnd.windowId }))).ack.ok).toBe(true);
      await restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('does not publish an applied acknowledgement or new head when the protected write fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-cas-fail-'));
    try {
      const opts = await options(directory), recorded = createDuelRecordedRuntimeP4(opts);
      expect(isJournal(recorded.archive().journal)).toBe(true);
      const store = await createPrivateJournalCasStore({ directory, key: opts.matchId,
        genesisData: JSON.parse(JSON.stringify({ journal: recorded.archive().journal })) });
      const failing = { key: store.key, keyHash: store.keyHash, load: () => store.load(), close: () => store.close(),
        compareAndSwap: async () => { throw Error('write failed'); } };
      const runtime = await createPersistentDuelRuntimeP4({ ...opts, store: failing });
      const before = runtime.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      const result = await runtime.dispatch(before.match.setup.currentMulliganOwner!, packet(0, 'm-fail', { type: 'mulligan', selectedUIDs: [] }));
      expect(result.ack.type).toBe('error'); expect(result.ack.ok).toBeUndefined();
      expect(runtime.project(null)).toEqual(before);
      await runtime.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it('recovers a durable command after its acknowledgement was lost without applying it again', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-lost-ack-'));
    try {
      const opts = await options(directory), recorded = createDuelRecordedRuntimeP4(opts);
      expect(isJournal(recorded.archive().journal)).toBe(true);
      const store = await createPrivateJournalCasStore({ directory, key: opts.matchId,
        genesisData: JSON.parse(JSON.stringify({ journal: recorded.archive().journal })) });
      const lostAck = { key: store.key, keyHash: store.keyHash, load: () => store.load(), close: () => store.close(),
        compareAndSwap: async (...args: Parameters<typeof store.compareAndSwap>) => {
          await store.compareAndSwap(...args); throw Error('acknowledgement lost after durable write');
        } };
      const runtime = await createPersistentDuelRuntimeP4({ ...opts, store: lostAck });
      const before = runtime.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      const actor = before.match.setup.currentMulliganOwner!;
      const command = packet(before.match.stateVersion, 'm-lost-ack', { type: 'mulligan', selectedUIDs: [] });
      expect((await runtime.dispatch(actor, command)).ack.type).toBe('error');
      expect(runtime.project(null)).toEqual(before);
      await runtime.close();
      const recovered = await openPersistentDuelRuntimeP4(opts), saved = recovered.project(null);
      expect(saved.match.stateVersion).toBeGreaterThan(before.match.stateVersion);
      expect((await recovered.dispatch(actor, command)).ack.duplicate).toBe(true);
      expect(recovered.project(null)).toEqual(saved);
      await recovered.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('publishes one competing proposal and refreshes the losing owner from the durable head', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-competing-'));
    try {
      const opts = await options(directory), genesis = await createPersistentDuelRuntimeP4(opts);
      await genesis.close();
      const firstStore = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      const secondStore = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      let armed = false, arrivals = 0, release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const wrapped = (store: typeof firstStore) => ({ key: store.key, keyHash: store.keyHash,
        load: async () => {
          const value = await store.load();
          if (armed) { if (++arrivals === 2) release(); await barrier; }
          return value;
        }, compareAndSwap: (...args: Parameters<typeof store.compareAndSwap>) => store.compareAndSwap(...args),
        close: () => store.close() });
      const first = await openPersistentDuelRuntimeP4({ ...opts, store: wrapped(firstStore) });
      const second = await openPersistentDuelRuntimeP4({ ...opts, store: wrapped(secondStore) });
      const before = first.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      const actor = before.match.setup.currentMulliganOwner!;
      armed = true;
      const results = await Promise.all([
        first.dispatch(actor, packet(before.match.stateVersion, 'race-a', { type: 'mulligan', selectedUIDs: [] })),
        second.dispatch(actor, packet(before.match.stateVersion, 'race-b', { type: 'mulligan', selectedUIDs: [] }))]);
      expect(results.filter(result => result.ack.ok)).toHaveLength(1);
      expect(results.filter(result => result.ack.type === 'error')).toHaveLength(1);
      expect(first.project(null)).toEqual(second.project(null));
      expect(first.project(null).match.stateVersion).toBe(before.match.stateVersion + 1);
      await first.close(); await second.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('closes an acquired store when restoration rejects legacy profile data', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-invalid-restore-'));
    try {
      const opts = await options(directory), store = await createPrivateJournalCasStore({
        directory, key: opts.matchId, genesisData: { profile: 'unexpected', journal: {} } });
      let closed = 0;
      const tracked = { key: store.key, keyHash: store.keyHash, load: () => store.load(),
        compareAndSwap: (...args: Parameters<typeof store.compareAndSwap>) => store.compareAndSwap(...args),
        close: async () => { closed++; await store.close(); } };
      await expect(openPersistentDuelRuntimeP4({ ...opts, store: tracked })).rejects.toThrow('Durable runtime requires protected journal v1 data');
      expect(closed).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});

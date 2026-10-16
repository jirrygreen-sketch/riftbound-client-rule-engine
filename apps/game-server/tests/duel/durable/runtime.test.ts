import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCardCatalogRuntime } from '../../../src/card-catalog.js';
import { createDurableDuelRuntime, openDurableDuelRuntime } from '../../../src/duel/runtime/durable/index.js';
import { createPrivateJournalCasStore, openPrivateJournalCasStore } from '../../../src/duel/private-journal-cas-store.js';
import { createPersistentDuelCommandRuntimeV3 } from '../../../src/duel/persistent-command-runtime-v3.js';
import { createPersistentDuelRuntimeP4 } from '../../../src/duel/persistent-command-runtime-p4.js';
import { journalOf, createRecording } from '../../../src/duel/runtime/durable/recording.js';
import { canonicalJournalJson, computeJournalDigest, isJournal } from '@riftbound/protocol';
import { setupAdapterFixtureCatalog } from '../fixtures/setup-adapter-catalog.js';

import { options, packet } from './fixtures.js';

describe('journal v1 protected persistence', () => {
  it('records and commits a real non-null pending resume', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-pending-cas-'));
    try {
      const opts = { ...await options(directory), catalog: await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog }) };
      const runtime = await createDurableDuelRuntime(opts);
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
      const journal = (after.data as { journal: { entries: unknown[] } }).journal;
      expect(journal.entries.at(-1)).toMatchObject({ kind: 'operation', phase: 'resume', pendingReason: 'pending' });
      await runtime.close(); await store.close();
      const restored = await openDurableDuelRuntime(opts);
      expect(restored.project(null)).toEqual(resumed?.projection);
      await restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('keeps the protected head byte-identical for null resumes and refreshes after another owner writes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-noop-cas-'));
    try {
      const opts = await options(directory), genesis = await createDurableDuelRuntime(opts);
      await genesis.close();
      const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      const compareAndSwap = vi.fn((...args: Parameters<typeof store.compareAndSwap>) => store.compareAndSwap(...args));
      const tracked = { key: store.key, keyHash: store.keyHash, load: () => store.load(),
        compareAndSwap, close: () => store.close() };
      const first = await openDurableDuelRuntime({ ...opts, store: tracked });
      const second = await openDurableDuelRuntime(opts);
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
      const opts = await options(directory), runtime = await createDurableDuelRuntime(opts);
      for (let n = 0; n < 2; n++) {
        const p = runtime.project(null); if (p.match.stage !== 'setup') throw Error('setup required');
        expect((await runtime.dispatch(p.match.setup.currentMulliganOwner!, packet(p.match.stateVersion, `m-${n}`, { type: 'mulligan', selectedUIDs: [] }))).ack.ok).toBe(true);
      }
      const p = runtime.project('alice'), action = p.actions.find(action => action.kind === 'end-turn');
      if (!action || action.kind !== 'end-turn') throw Error('End required');
      const end = packet(p.match.stateVersion, 'end-1', { type: 'end-turn', windowId: action.windowId });
      expect((await runtime.dispatch('alice', end)).ack.ok).toBe(true);
      const before = runtime.project('bob'); await runtime.close();
      const restored = await openDurableDuelRuntime(opts);
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
      const opts = await options(directory), recorded = createRecording(opts);
      const store = await createPrivateJournalCasStore({ directory, key: opts.matchId,
        genesisData: JSON.parse(JSON.stringify({ journal: journalOf(recorded) })) });
      const failing = { key: store.key, keyHash: store.keyHash, load: () => store.load(), close: () => store.close(),
        compareAndSwap: async () => { throw Error('write failed'); } };
      const runtime = await createDurableDuelRuntime({ ...opts, store: failing });
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
      const opts = await options(directory), recorded = createRecording(opts);
      const store = await createPrivateJournalCasStore({ directory, key: opts.matchId,
        genesisData: JSON.parse(JSON.stringify({ journal: journalOf(recorded) })) });
      const lostAck = { key: store.key, keyHash: store.keyHash, load: () => store.load(), close: () => store.close(),
        compareAndSwap: async (...args: Parameters<typeof store.compareAndSwap>) => {
          await store.compareAndSwap(...args); throw Error('acknowledgement lost after durable write');
        } };
      const runtime = await createDurableDuelRuntime({ ...opts, store: lostAck });
      const before = runtime.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      const actor = before.match.setup.currentMulliganOwner!;
      const command = packet(before.match.stateVersion, 'm-lost-ack', { type: 'mulligan', selectedUIDs: [] });
      expect((await runtime.dispatch(actor, command)).ack.type).toBe('error');
      expect(runtime.project(null)).toEqual(before);
      await runtime.close();
      const recovered = await openDurableDuelRuntime(opts), saved = recovered.project(null);
      expect(saved.match.stateVersion).toBeGreaterThan(before.match.stateVersion);
      expect((await recovered.dispatch(actor, command)).ack.duplicate).toBe(true);
      expect(recovered.project(null)).toEqual(saved);
      await recovered.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('publishes one competing proposal and refreshes the losing owner from the durable head', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-competing-'));
    try {
      const opts = await options(directory), genesis = await createDurableDuelRuntime(opts);
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
      const first = await openDurableDuelRuntime({ ...opts, store: wrapped(firstStore) });
      const second = await openDurableDuelRuntime({ ...opts, store: wrapped(secondStore) });
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

  it('closes an acquired store when restoration rejects the stored profile', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-p4-invalid-restore-'));
    try {
      const opts = await options(directory), store = await createPrivateJournalCasStore({
        directory, key: opts.matchId, genesisData: { profile: 'unexpected', journal: {} } });
      let closed = 0;
      const tracked = { key: store.key, keyHash: store.keyHash, load: () => store.load(),
        compareAndSwap: (...args: Parameters<typeof store.compareAndSwap>) => store.compareAndSwap(...args),
        close: async () => { closed++; await store.close(); } };
      await expect(openDurableDuelRuntime({ ...opts, store: tracked })).rejects.toThrow('Durable runtime requires protected journal v1 data');
      expect(closed).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});

describe('single durable adapter integrity', () => {
  it('shares both compatibility entries and publishes only the protocol journal with confirmed CAS evidence', async () => {
    expect(createPersistentDuelCommandRuntimeV3).toBe(createDurableDuelRuntime);
    expect(createPersistentDuelRuntimeP4).toBe(createDurableDuelRuntime);
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-durable-head-'));
    try {
      const opts = await options(directory), runtime = await createDurableDuelRuntime(opts);
      const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      const first = await store.load();
      const before = runtime.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      expect((await runtime.dispatch(before.match.setup.currentMulliganOwner!,
        packet(before.match.stateVersion, 'head-1', { type: 'mulligan', selectedUIDs: [] }))).ack.ok).toBe(true);
      const last = await store.load(), genesis = (first.data as any).journal, journal = (last.data as any).journal;
      expect(Object.keys(last.data!)).toEqual(['journal']);
      expect(isJournal(journal)).toBe(true);
      expect(Object.keys(journal).sort()).toEqual(['entries', 'head', 'header', 'integrity']);
      expect(journal.head.parentJournalDigest).toBe(genesis.integrity.currentDigest);
      expect(journal.integrity.parentDigest).toBe(genesis.integrity.currentDigest);
      expect(journal.integrity.currentDigest).toBe(computeJournalDigest(journal));
      expect(journal.integrity.revision).toBe(last.head.revision);
      expect(journal.integrity.protectedHeadReference).toEqual({ revision: journal.integrity.revision, nonce: journal.integrity.nonce });
      expect(last.head.nonce).not.toBe(first.head.nonce);
      expect(runtime.protectedHeadReference).toEqual(last.head);
      await store.close(); await runtime.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('does not write duplicates, illegal packets, or actor/payload conflicts and remains usable', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-durable-duplicate-'));
    try {
      const opts = await options(directory), runtime = await createDurableDuelRuntime(opts);
      const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      const before = runtime.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      const actor = before.match.setup.currentMulliganOwner!;
      const command = packet(before.match.stateVersion, 'duplicate-1', { type: 'mulligan', selectedUIDs: [] });
      const applied = await runtime.dispatch(actor, command);
      expect(applied.ack.ok).toBe(true);
      const snapshot = await store.load();
      expect((await runtime.dispatch(actor, { ...command, requestId: 'retry-new-request' })).ack.duplicate).toBe(true);
      expect((await runtime.dispatch(actor, { ...command, command: { type: 'concede' } })).ack.type).toBe('error');
      expect((await runtime.dispatch(actor === 'alice' ? 'bob' : 'alice', command)).ack.type).toBe('error');
      expect((await runtime.dispatch(actor, { type: 'duel-command' })).ack.type).toBe('error');
      expect(await store.load()).toEqual(snapshot);
      expect(runtime.isFrozen).toBe(false);
      const next = runtime.project(null);
      if (next.match.stage !== 'setup') throw Error('setup required');
      expect((await runtime.dispatch(next.match.setup.currentMulliganOwner!,
        packet(next.match.stateVersion, 'duplicate-2', { type: 'mulligan', selectedUIDs: [] }))).ack.ok).toBe(true);
      await store.close(); await runtime.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it.each(['record-chain', 'parent-head', 'private-state', 'cas-revision', 'command-semantics', 'trusted-roster'] as const)(
    'rejects %s tampering even through an injected protected load', async tamper => {
      const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-durable-tamper-'));
      try {
        const opts = await options(directory), runtime = await createDurableDuelRuntime(opts);
        const before = runtime.project(null);
        if (before.match.stage !== 'setup') throw Error('setup required');
        expect((await runtime.dispatch(before.match.setup.currentMulliganOwner!,
          packet(before.match.stateVersion, 'tamper-1', { type: 'mulligan', selectedUIDs: [] }))).ack.ok).toBe(true);
        await runtime.close();
        const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
        const snapshot = await store.load(), journal = JSON.parse(canonicalJournalJson((snapshot.data as any).journal));
        if (tamper === 'record-chain') journal.entries[0].integrity.parentDigest = 'a'.repeat(64);
        if (tamper === 'parent-head') {
          journal.head.parentJournalDigest = journal.integrity.parentDigest = 'b'.repeat(64);
          journal.head.journalDigest = journal.integrity.currentDigest = computeJournalDigest(journal);
        }
        if (tamper === 'private-state') {
          journal.head.privateStateDigest = 'c'.repeat(64);
          journal.head.journalDigest = journal.integrity.currentDigest = computeJournalDigest(journal);
        }
        if (tamper === 'cas-revision') {
          journal.integrity.revision++;
          journal.integrity.protectedHeadReference.revision++;
          journal.head.journalDigest = journal.integrity.currentDigest = computeJournalDigest(journal);
        }
        if (tamper === 'command-semantics') {
          journal.entries[0].command = journal.entries[0].payload = { type: 'concede' };
          const { integrity: _integrity, ...record } = journal.entries[0];
          // Use the contract helper to re-sign the ordinary digest, so replay
          // must also validate the command against its recorded engine packet.
          const { computeJournalRecordDigest } = await import('@riftbound/protocol');
          journal.entries[0].integrity.currentDigest = computeJournalRecordDigest(record, journal.entries[0].integrity.parentDigest);
          journal.head.journalDigest = journal.integrity.currentDigest = computeJournalDigest(journal);
        }
        if (tamper === 'trusted-roster') {
          journal.header.trustedDeckDigest = 'd'.repeat(64);
          const { computeJournalHeaderDigest, computeJournalRecordDigest } = await import('@riftbound/protocol');
          const first = journal.entries[0], { integrity: _integrity, ...record } = first;
          first.integrity.parentDigest = computeJournalHeaderDigest(journal.header);
          first.integrity.currentDigest = computeJournalRecordDigest(record, first.integrity.parentDigest);
          journal.head.journalDigest = journal.integrity.currentDigest = computeJournalDigest(journal);
        }
        let closed = 0;
        const injected = { key: store.key, keyHash: store.keyHash,
          load: async () => ({ head: snapshot.head, data: { journal } }),
          compareAndSwap: (...args: Parameters<typeof store.compareAndSwap>) => store.compareAndSwap(...args),
          close: async () => { closed++; await store.close(); } };
        await expect(openDurableDuelRuntime({ ...opts, store: injected })).rejects.toThrow();
        expect(closed).toBe(1);
      } finally { await rm(directory, { recursive: true, force: true }); }
    }, 60_000);

  it('marks an engine version mismatch without rewriting the stored journal', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-durable-engine-'));
    try {
      const opts = await options(directory), journal = JSON.parse(canonicalJournalJson(journalOf(createRecording(opts))));
      journal.header.engineVersion = 'another-engine-build';
      journal.head.journalDigest = journal.integrity.currentDigest = computeJournalDigest(journal);
      const store = await createPrivateJournalCasStore({ directory, key: opts.matchId, genesisData: { journal } });
      const before = await store.load();
      const runtime = await openDurableDuelRuntime({ ...opts, store });
      expect(runtime.engineMismatch).toBe(true);
      expect(await store.load()).toEqual(before);
      await runtime.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('withholds publication when a CAS response reuses the previous storage nonce', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-durable-nonce-'));
    try {
      const opts = await options(directory), genesis = await createDurableDuelRuntime(opts);
      await genesis.close();
      const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      const injected = { key: store.key, keyHash: store.keyHash, load: () => store.load(), close: () => store.close(),
        compareAndSwap: async (...args: Parameters<typeof store.compareAndSwap>) => {
          const saved = await store.compareAndSwap(...args);
          return saved.status === 'conflict' ? saved : { ...saved, head: { ...saved.head, nonce: args[0].nonce } };
        } };
      const runtime = await openDurableDuelRuntime({ ...opts, store: injected });
      const before = runtime.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      const actor = before.match.setup.currentMulliganOwner!;
      const command = packet(before.match.stateVersion, 'nonce-1', { type: 'mulligan', selectedUIDs: [] });
      expect((await runtime.dispatch(actor, command)).ack.type).toBe('error');
      expect(runtime.project(null)).toEqual(before);
      expect(runtime.isFrozen).toBe(true);
      await runtime.close();
      const restored = await openDurableDuelRuntime(opts);
      expect((await restored.dispatch(actor, command)).ack.duplicate).toBe(true);
      await restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('keeps projections unpublished and waits for an in-flight CAS before closing its store', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-durable-closing-'));
    try {
      const opts = await options(directory), genesis = await createDurableDuelRuntime(opts);
      await genesis.close();
      const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
      let release!: () => void, entered!: () => void, closed = false;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const arrival = new Promise<void>(resolve => { entered = resolve; });
      const injected = { key: store.key, keyHash: store.keyHash, load: () => store.load(),
        compareAndSwap: async (...args: Parameters<typeof store.compareAndSwap>) => {
          entered(); await gate;
          return store.compareAndSwap(...args);
        }, close: async () => { closed = true; await store.close(); } };
      const runtime = await openDurableDuelRuntime({ ...opts, store: injected });
      const before = runtime.project(null);
      if (before.match.stage !== 'setup') throw Error('setup required');
      const dispatch = runtime.dispatch(before.match.setup.currentMulliganOwner!,
        packet(before.match.stateVersion, 'closing-1', { type: 'mulligan', selectedUIDs: [] }));
      await arrival;
      const closing = runtime.close();
      expect(closed).toBe(false);
      expect(runtime.project(null)).toEqual(before);
      release();
      expect((await dispatch).ack.ok).toBe(true);
      await closing;
      expect(closed).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60_000);
});

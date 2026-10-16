import { constants } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDurableDuelRuntime, openDurableDuelRuntime } from '../../../src/duel/runtime/durable/index.js';
import { openPrivateJournalCasStore } from '../../../src/duel/private-journal-cas-store.js';
import { options, packet } from './fixtures.js';

const fault = vi.hoisted(() => ({ mode: '', renamed: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const failure = () => Object.assign(new Error('injected interrupted journal write'), { code: 'EIO' });
  return { ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (typeof args[0] === 'string' && args[0].endsWith('.tmp')) {
        const write = handle.write.bind(handle);
        Object.defineProperty(handle, 'write', { value: async (...writeArgs: Parameters<typeof handle.write>) => {
          if (fault.mode === 'partial-write') {
            await write(Buffer.from('{"interrupted":'));
            throw failure();
          }
          return write(...writeArgs);
        } });
      }
      if (typeof args[1] === 'number' && (args[1] & constants.O_DIRECTORY) !== 0) {
        const sync = handle.sync.bind(handle);
        Object.defineProperty(handle, 'sync', { value: async () => {
          if (fault.mode === 'after-rename' && fault.renamed) throw failure();
          return sync();
        } });
      }
      return handle;
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fault.mode === 'before-rename') throw failure();
      const result = await actual.rename(...args);
      if (fault.mode) fault.renamed = true;
      return result;
    } };
});
afterEach(() => { fault.mode = ''; fault.renamed = false; });

describe('real private CAS write interruptions', () => {
  it.each(['partial-write', 'before-rename', 'after-rename'])(
    'withholds the ACK for %s and resumes only from the durable protected head', async mode => {
      const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-durable-interrupted-'));
      try {
        const opts = await options(directory), runtime = await createDurableDuelRuntime(opts);
        const store = await openPrivateJournalCasStore({ directory, key: opts.matchId });
        const headPath = path.join(directory, store.keyHash, 'head.json');
        const beforeBytes = await readFile(headPath), before = runtime.project(null);
        if (before.match.stage !== 'setup') throw Error('setup required');
        const actor = before.match.setup.currentMulliganOwner!;
        const command = packet(before.match.stateVersion, `interrupted-${mode}`, { type: 'mulligan', selectedUIDs: [] });
        fault.mode = mode;
        const rejected = await runtime.dispatch(actor, command);
        expect(rejected.ack.type).toBe('error');
        expect(rejected.ack.ok).toBeUndefined();
        expect(runtime.project(null)).toEqual(before);
        expect(runtime.isFrozen).toBe(true);
        fault.mode = '';
        if (mode !== 'after-rename') expect(await readFile(headPath)).toEqual(beforeBytes);
        await runtime.close(); await store.close();
        const recovered = await openDurableDuelRuntime(opts);
        const restored = recovered.project(null);
        expect(restored.match.stateVersion).toBe(before.match.stateVersion + (mode === 'after-rename' ? 1 : 0));
        const retry = await recovered.dispatch(actor, command);
        expect(retry.ack.ok).toBe(true);
        expect(retry.ack.duplicate === true).toBe(mode === 'after-rename');
        expect(recovered.project(null).match.stateVersion).toBe(before.match.stateVersion + 1);
        await recovered.close();
      } finally {
        fault.mode = '';
        await rm(directory, { recursive: true, force: true });
      }
    }, 60_000);
});

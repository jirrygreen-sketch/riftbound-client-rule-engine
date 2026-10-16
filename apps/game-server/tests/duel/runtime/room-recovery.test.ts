import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GameRoom } from '../../../src/room.js';
import { packet, project, readyRoom } from '../../room/current-runtime.fixture.js';
import { createDurableDuelRuntime, openDurableDuelRuntime } from '../../../src/duel/runtime/durable/index.js';
import { options } from '../durable/fixtures.js';

describe('room recovery through the batch C protected head', () => {
  it('recovers an accepted CAS command beyond a lagging room checkpoint, with original idempotency and privacy', async () => {
    const parent = '/tmp/RIFT-254-server-batch-d-room-dispatch';
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, 'checkpoint-'));
    const h = await readyRoom();
    let restored: GameRoom | undefined;
    try {
      await h.room.enableDurability(directory);
      const checkpoint = h.room.exportArchive(), initial = project(h.room);
      if (initial.match.stage !== 'setup') throw Error('Setup required');
      const actor = h.sessions.findIndex(s => s.playerId === initial.match.setup.currentMulliganOwner);
      const command = packet('lost-room-save', 0, { type: 'mulligan', selectedUIDs: [] });
      await h.room.submitDuel(h.sessions[actor]!, h.connections[actor]!.connectionId, command, h.send[actor]!);
      const journal = h.room.exportArchive().journal, views = h.sessions.map(s => project(h.room, s.playerId));
      expect(journal!.head.stateVersion).toBe(1);
      await h.room.close();
      restored = GameRoom.restore(checkpoint, h.catalog);
      expect(restored.runtimeClock.stateVersion).toBe(0);
      await restored.enableDurability(directory);
      expect(restored.exportArchive().journal).toEqual(journal);
      expect(h.sessions.map(s => project(restored!, s.playerId))).toEqual(views);
      expect(restored.runtimeClock).toEqual({ stateVersion: views[0]!.match.stateVersion, eventSeq: views[0]!.match.eventSeq });
      const packets: typeof h.messages[number] = [];
      restored.reconnect(h.sessions[actor]!.resumeToken, m => packets.push(m), 'recovered');
      await restored.submitDuel(h.sessions[actor]!, 'recovered', { ...command, requestId: 'lost-ack-retry' }, m => packets.push(m));
      expect(packets.find(m => m.type === 'request-result')).toMatchObject({ duplicate: true, appliedVersion: 1 });
      expect(restored.exportArchive().journal).toEqual(journal);
      expect(JSON.stringify(packets)).not.toContain(h.sessions[1 - actor]!.resumeToken);
      const keyHash = createHash('sha256').update(`duel:${h.room.roomId}`).digest('hex');
      const blob = JSON.parse(await readFile(path.join(directory, 'duel-journals', keyHash, 'head.json'), 'utf8'));
      expect(Object.keys(blob.data)).toEqual(['journal']);
      expect(blob.data.journal).toEqual(journal);
      expect(blob.data).not.toHaveProperty('duelJournal');
    } finally {
      await h.room.close(); await restored?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects future resume cursors before replacing the active connection', async () => {
    const h = await readyRoom();
    const archive = h.room.exportArchive();
    expect(() => h.room.validateResumeCursors(h.sessions[0]!.resumeToken,
      h.room.runtimeClock.eventSeq + 1, h.room.currentRoomEventSeq)).toThrow(/ahead/);
    expect(h.room.isCurrentConnection('player-1', 'a')).toBe(true);
    expect(h.room.exportArchive()).toEqual(archive);
  });

  it('refreshes the protected clock before resume without creating a journal operation', async () => {
    const parent = '/tmp/RIFT-254-server-batch-d-room-dispatch';
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, 'refresh-'));
    const opts = await options(directory), first = await createDurableDuelRuntime(opts);
    const second = await openDurableDuelRuntime(opts);
    try {
      const initial = second.project(null);
      if (initial.match.stage !== 'setup') throw Error('Setup required');
      await second.dispatch(initial.match.setup.currentMulliganOwner!, packet('other-owner', 0, { type: 'mulligan', selectedUIDs: [] }));
      expect(first.stateVersion).toBe(0);
      const journal = second.exportJournal();
      await first.synchronize();
      expect(first.project(null)).toEqual(second.project(null));
      expect(first.exportJournal()).toEqual(journal);
      await first.synchronize();
      expect(first.exportJournal()).toEqual(journal);
    } finally { await first.close(); await second.close(); await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it('reopens a frozen protected head on reconnect without replaying a failed operation', async () => {
    const parent = '/tmp/RIFT-254-server-batch-d-room-dispatch';
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, 'reconnect-io-'));
    const h = await readyRoom();
    const keyHash = createHash('sha256').update(`duel:${h.room.roomId}`).digest('hex');
    const head = path.join(directory, 'duel-journals', keyHash, 'head.json');
    try {
      await h.room.enableDurability(directory);
      const journal = h.room.exportArchive().journal, views = h.sessions.map(s => project(h.room, s.playerId));
      // An actual filesystem protection failure freezes the adapter. No game
      // state or protected journal bytes are edited by this fault injection.
      await chmod(head, 0o644);
      await expect(h.room.enableDurability()).rejects.toThrow();
      expect(h.room.exportArchive().journal).toEqual(journal);
      await chmod(head, 0o600);
      await h.room.enableDurability();
      expect(h.room.exportArchive().journal).toEqual(journal);
      expect(h.sessions.map(s => project(h.room, s.playerId))).toEqual(views);
      const setup = views[0]!.match;
      if (setup.stage !== 'setup') throw Error('Setup required');
      const actor = h.sessions.findIndex(s => s.playerId === setup.setup.currentMulliganOwner);
      h.room.reconnect(h.sessions[actor]!.resumeToken, h.send[actor]!, 'after-io-reconnect');
      await h.room.submitDuel(h.sessions[actor]!, 'after-io-reconnect',
        packet('fresh-after-io', setup.stateVersion, { type: 'mulligan', selectedUIDs: [] }), h.send[actor]!);
      expect(h.room.exportArchive().journal!.entries).toHaveLength(1);
    } finally {
      await chmod(head, 0o600).catch(() => {});
      await h.room.close(); await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

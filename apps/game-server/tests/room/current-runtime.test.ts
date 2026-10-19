import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isJournal, isServerMessage } from '@riftbound/protocol';
import { GameRoom } from '../../src/room.js';
import { CurrentDuelRuntime } from '../../src/duel/runtime/current.js';
import { bindConstructedRegion } from '../../src/constructed-regional-context.js';
import { packet, project, readyRoom } from './current-runtime.fixture.js';
import { FileRoomStore } from '../../src/file-room-store.js';

const storageDirectories: string[] = [];
afterEach(async () => {
  for (const directory of storageDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('one authoritative room runtime', () => {
  it.each([undefined, 'v1', 'p4'] as const)('ignores the deprecated %s selector and keeps the CLI mechanism baseline', async profile => {
    const h = await readyRoom(profile, profile === 'p4' ? 'optional-unit-resolved-history-v5' : undefined);
    expect(isJournal(h.room.exportArchive().journal)).toBe(true);
    expect(h.room.exportArchive()).not.toHaveProperty('duelSession');
    expect(h.room.exportArchive()).not.toHaveProperty('duelJournal');
    expect(h.room.exportArchive()).not.toHaveProperty('duelProfile');
    expect(h.room.exportArchive()).not.toHaveProperty('duelRuntimeProfile');
    for (let n = 0; n < 2; n++) {
      const p = project(h.room);
      if (p.match.stage !== 'setup') throw Error('Setup required');
      const actor = h.sessions.findIndex(s => s.playerId === p.match.setup.currentMulliganOwner);
      await h.room.submitDuel(h.sessions[actor]!, h.connections[actor]!.connectionId,
        packet(`m-${n}`, p.match.stateVersion, { type: 'mulligan', selectedUIDs: [] }), h.send[actor]!);
    }
    const main = project(h.room).match;
    expect(main.stage).toBe('playing');
    if (main.stage === 'playing') expect(main.frame.phase).toBe('main');
    expect(h.messages.flat().every(isServerMessage)).toBe(true);
  });

  it('journals accepted commands once, rejects stale/conflicting requests and recovers original duplicate receipts', async () => {
    const h = await readyRoom(), initial = project(h.room);
    if (initial.match.stage !== 'setup') throw Error('Setup required');
    const actor = h.sessions.findIndex(s => s.playerId === initial.match.setup.currentMulliganOwner);
    const command = packet('keep', 0, { type: 'mulligan', selectedUIDs: [] });
    const submit = (value: typeof command, index = actor) => h.room.submitDuel(h.sessions[index]!,
      h.connections[index]!.connectionId, value, h.send[index]!);
    const genesis = h.room.exportArchive().journal!;
    await submit(packet('invalid', 0, { type: 'mulligan', selectedUIDs: ['unknown'] }));
    expect(h.room.exportArchive().journal).toEqual(genesis);
    await submit(command);
    const saved = h.room.exportArchive(), views = h.sessions.map(s => project(h.room, s.playerId));
    await submit({ ...command, requestId: 'retry' });
    expect(h.messages[actor]!.find(m => m.type === 'request-result' && m.requestId === 'retry'))
      .toMatchObject({ duplicate: true, appliedVersion: 1 });
    await submit({ ...command, requestId: 'conflict', command: { type: 'mulligan', selectedUIDs: ['unknown'] } });
    await submit({ ...command, requestId: 'other-actor' }, 1 - actor);
    expect(h.messages[1 - actor]!.find(m => m.type === 'error' && m.requestId === 'other-actor'))
      .toMatchObject({ code: 'command-rejected' });
    await submit(packet('stale', 0, { type: 'mulligan', selectedUIDs: [] }));
    expect(h.room.exportArchive()).toEqual(saved);
    const restored = GameRoom.restore(saved, h.catalog);
    expect(restored.exportArchive()).toEqual(saved);
    expect(h.sessions.map(s => project(restored, s.playerId))).toEqual(views);
    const recovered: typeof h.messages[number] = [];
    restored.reconnect(h.sessions[actor]!.resumeToken, m => recovered.push(m), 'resumed');
    await restored.submitDuel(h.sessions[actor]!, 'resumed', { ...command, requestId: 'after-restore' }, m => recovered.push(m));
    expect(recovered.find(m => m.type === 'request-result')).toMatchObject({ duplicate: true, appliedVersion: 1 });
  });

  it('keeps a used command id actor-scoped across FileRoomStore restart', async () => {
    const h = await readyRoom(), initial = project(h.room);
    if (initial.match.stage !== 'setup') throw Error('Setup required');
    const actor = h.sessions.findIndex(s => s.playerId === initial.match.setup.currentMulliganOwner);
    const other = 1 - actor;
    const directory = await mkdtemp(path.join('/tmp', process.env.SWARM_TASK ?? 'RIFT-350-server-cutover-engine-runtime', 'conflict-'));
    storageDirectories.push(directory);
    const store = new FileRoomStore(directory, async () => h.catalog);
    await store.create(h.room);
    await store.save(h.room);
    const original = packet('shared-id', 0, { type: 'mulligan', selectedUIDs: [] });
    await h.room.submitDuel(h.sessions[actor]!, h.connections[actor]!.connectionId, original, h.send[actor]!);
    expect(h.messages[actor]!.some(m => m.type === 'request-result' && m.requestId === original.requestId)).toBe(true);
    expect(h.room.exportArchive().journal?.entries).toHaveLength(1);
    await store.save(h.room);
    await store.close();

    const reload = new FileRoomStore(directory, async () => h.catalog);
    const [restored] = await reload.list();
    expect(restored!.exportArchive()).toEqual(h.room.exportArchive());
    const packets: typeof h.messages[number] = [];
    restored!.reconnect(h.sessions[actor]!.resumeToken, m => packets.push(m), 'restored-first');
    await restored!.submitDuel(h.sessions[actor]!, 'restored-first',
      { ...original, requestId: 'changed-payload', expectedVersion: 1 }, m => packets.push(m));
    expect(packets.find(m => m.type === 'error' && m.requestId === 'changed-payload'))
      .toMatchObject({ type: 'error', code: 'command-rejected' });
    expect(restored!.exportArchive().journal?.entries).toHaveLength(1);

    packets.length = 0;
    restored!.reconnect(h.sessions[other]!.resumeToken, m => packets.push(m), 'restored-second');
    await restored!.submitDuel(h.sessions[other]!, 'restored-second',
      packet('shared-id', 0, { type: 'mulligan', selectedUIDs: [] }), m => packets.push(m));
    expect(packets.some(m => m.type === 'error' && m.requestId === 'shared-id')).toBe(true);
    expect(packets.some(m => m.type === 'error' && m.message === '命令标识与此前请求冲突')).toBe(false);
    await reload.close();
  });

  it('validates journal integrity and trusted seats, rejects historical archives without upgrading them', async () => {
    const h = await readyRoom(), archive = h.room.exportArchive();
    const renamed = structuredClone(archive);
    (renamed.seats[0] as { name: string }).name = 'Impostor';
    expect(() => GameRoom.restore(renamed, h.catalog)).toThrow();
    const forged = structuredClone(archive);
    (forged.journal!.head as { stateVersion: number }).stateVersion++;
    expect(() => GameRoom.restore(forged, h.catalog)).toThrow();
    for (const journal of [false, 0, '', {}, []])
      expect(() => GameRoom.restore({ ...archive, journal }, h.catalog)).toThrow();
    expect(() => GameRoom.restore({ ...archive, duelProfile: 'p4' }, h.catalog)).toThrow(/legacy replayer/);
    const a = project(h.room), b = project(h.room, 'player-2');
    if (a.match.stage !== 'setup' || b.match.stage !== 'setup') throw Error('Setup required');
    expect(a.match.setup.players.filter(p => p.hand)).toHaveLength(1);
    expect(b.match.setup.players.filter(p => p.hand)).toHaveLength(1);
    expect(JSON.stringify(h.messages[0])).not.toContain(h.sessions[1]!.resumeToken);
    expect(JSON.stringify(h.messages[1])).not.toContain(h.sessions[0]!.resumeToken);
  });

  it('binds the trusted regional admission context into the current journal', async () => {
    const h = await readyRoom(), seats = h.room.exportArchive().seats;
    const roster = seats.map(seat => ({ playerId: seat.id, displayName: seat.name, deck: seat.deck! })) as
      Parameters<typeof CurrentDuelRuntime.create>[0]['roster'];
    const options = { catalog: h.catalog, roster, matchId: 'regional-current', randomIndex: () => 0,
      constructedRegion: bindConstructedRegion({ regionCode: 'ROW', eventDate: '2026-10-14' }) };
    const runtime = CurrentDuelRuntime.create(options), journal = runtime.exportJournal();
    expect(CurrentDuelRuntime.restore(options, journal).project('player-1')).toEqual(runtime.project('player-1'));
    expect(() => CurrentDuelRuntime.restore({ ...options,
      constructedRegion: bindConstructedRegion({ regionCode: 'ROW', eventDate: '2026-10-15' }) }, journal)).toThrow(/trusted.*mismatch/);
  });
});

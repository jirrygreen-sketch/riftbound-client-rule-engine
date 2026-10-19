import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { DUEL_RULESET_ID, PROTOCOL_VERSION, isServerMessage, isDuelProjectionV3Actions1,
  type ClientSession, type DuelProjectionV3Actions1, type ServerToClientMessage } from '@riftbound/protocol';
import { createGameServer, type GameServer } from '../../src/server.js';
import { FileRoomStore } from '../../src/file-room-store.js';
import type { RoomStore } from '../../src/room-store.js';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { p4RuntimeFixtureCatalog } from '../duel/fixtures/p4-runtime-catalog.js';
import { setupAdapterFixtureDecks } from '../duel/fixtures/setup-adapter-catalog.js';
import { packet, project } from '../room/current-runtime.fixture.js';

const portBase = Number(process.env.SWARM_PORT_BASE ?? 34680);
const scratch = path.join('/tmp', process.env.SWARM_TASK ?? 'RIFT-350-server-cutover-engine-runtime');
const servers: GameServer[] = [], clients: Client[] = [], directories: string[] = [];
class Client {
  readonly messages: ServerToClientMessage[] = [];
  readonly invalid: unknown[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on('message', raw => {
      const value = JSON.parse(String(raw));
      if (isServerMessage(value)) this.messages.push(value);
      else this.invalid.push(value);
    });
  }
  send(value: unknown) { this.socket.send(JSON.stringify(value)); }
  async wait<T extends ServerToClientMessage['type']>(type: T,
    predicate: (value: Extract<ServerToClientMessage, { type: T }>) => boolean = () => true) {
    // The room runtime serializes every command; under full-suite load the
    // request-result can legitimately lag behind its projection broadcast by
    // more than the previous 30s window.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(value => value.type === type && predicate(value as Extract<ServerToClientMessage, { type: T }>));
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<ServerToClientMessage, { type: T }>;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Missing ${type}; received ${this.messages.map(m => m.type === 'error' ? JSON.stringify(m) : m.type).join(', ')}`);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.once('close', resolve); this.socket.close(); });
  }
}
afterEach(async () => {
  for (const client of clients.splice(0)) { await client.close(); expect(client.invalid).toEqual([]); }
  for (const server of servers.splice(0)) await server.stop();
  for (const directory of directories.splice(0)) {
    // Journal stores close asynchronously during server.stop(); retry cleanup
    // so a racing lock-file unlink cannot mask the assertions under test.
    for (let attempt = 0; ; attempt++) {
      try { await rm(directory, { recursive: true, force: true }); break; }
      catch (error) {
        if (attempt >= 5 || (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
});
async function start(port: number, storageDirectory?: string, roomStore?: RoomStore) {
  const server = createGameServer({ port, storageDirectory, roomStore, catalog: p4RuntimeFixtureCatalog,
    roomIdFactory: () => 'current-ws', duelRandomIndex: () => 0, duelRuntimeMode: 'legacy-p4' });
  servers.push(server); await server.start();
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}
async function connect(url: string, session?: ClientSession, cursor?: number) {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const client = new Client(socket); clients.push(client);
  client.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION,
    ...(session ? { roomId: session.roomId, resumeToken: session.resumeToken, afterEventSeq: cursor } : {}) });
  await client.wait('welcome', m => session ? m.resumed === true : !m.session);
  return client;
}
async function projection(client: Client, version = -1): Promise<DuelProjectionV3Actions1> {
  const value = (await client.wait('duel-projection', m => m.projection.match.stateVersion > version)).projection;
  if (!isDuelProjectionV3Actions1(value)) throw Error('Current projection required');
  return value;
}
async function pair(port: number, directory?: string, roomStore?: RoomStore) {
  const running = await start(port, directory, roomStore), a = await connect(running.url), b = await connect(running.url);
  a.send({ type: 'create-room', requestId: 'create', playerName: 'Alice', rulesetId: DUEL_RULESET_ID });
  const first = (await a.wait('welcome', m => Boolean(m.session))).session!;
  await a.wait('request-result', m => m.requestId === 'create');
  b.send({ type: 'join-room', requestId: 'join', roomId: first.roomId, playerName: 'Bob' });
  const second = (await b.wait('welcome', m => Boolean(m.session))).session!;
  await b.wait('request-result', m => m.requestId === 'join');
  const sockets = [a, b], sessions = [first, second];
  const room = running.server.rooms.get(first.roomId)!;
  let version = room.currentRoomVersion;
  for (const i of [0, 1]) {
    sockets[i]!.send({ type: 'submit-deck', requestId: `deck-${i}`, expectedRoomVersion: version,
      deck: i === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission });
    version = (await sockets[i]!.wait('request-result', m => m.requestId === `deck-${i}`)).roomVersion!;
    sockets[i]!.send({ type: 'set-ready', requestId: `ready-${i}`, expectedRoomVersion: version, ready: true });
    version = (await sockets[i]!.wait('request-result', m => m.requestId === `ready-${i}`)).roomVersion!;
  }
  let views = await Promise.all(sockets.map(c => projection(c)));
  for (let n = 0; n < 2; n++) {
    const setup = views[0]!;
    if (setup.match.stage !== 'setup') throw Error('Setup required');
    const actor = sessions.findIndex(s => s.playerId === setup.match.setup.currentMulliganOwner);
    sockets[actor]!.send(packet(`m-${n}`, setup.match.stateVersion, { type: 'mulligan', selectedUIDs: [] }));
    await sockets[actor]!.wait('request-result', m => m.requestId === `m-${n}`);
    views = await Promise.all(sockets.map(c => projection(c, setup.match.stateVersion)));
  }
  const main = views[0]!.match;
  if (main.stage !== 'playing' || main.frame.phase !== 'main') throw Error('Real Main required');
  const actor = sessions.findIndex(s => s.playerId === main.frame.turnPlayerId);
  const rune = views[actor]!.actions.find(action => action.kind === 'rune-energy' && action.enabled);
  if (!rune || rune.kind !== 'rune-energy') throw Error('Rune action required');
  const command = packet('rune', views[actor]!.match.stateVersion, { type: 'rune-energy', uid: rune.uid });
  sockets[actor]!.send(command);
  const ack = await sockets[actor]!.wait('request-result', m => m.requestId === 'rune');
  views = await Promise.all(sockets.map(c => projection(c, main.stateVersion)));
  return { ...running, room, sockets, sessions, views, command, actor, ack };
}
function privacy(views: DuelProjectionV3Actions1[]) {
  for (const view of views) {
    const match = view.match;
    if (match.stage !== 'playing') throw Error('Playing required');
    expect(match.players.filter(p => p.hand)).toHaveLength(1);
    expect(match.players.find(p => p.hand)?.playerId).toBe(view.viewerPlayerId);
    const other = views.find(p => p.viewerPlayerId !== view.viewerPlayerId)!.match;
    if (other.stage !== 'playing') throw Error('Playing required');
    for (const hidden of other.players.find(p => p.playerId !== view.viewerPlayerId)!.hand!)
      expect(JSON.stringify(view)).not.toContain(hidden.uid);
  }
}

describe('current runtime over actual WebSocket transport', () => {
  it('creates a two-client room, executes commands and resumes the same private projections using event cursors', async () => {
    const h = await pair(portBase + 1);
    privacy(h.views);
    const journal = h.room.exportArchive().journal;
    await h.sockets[0]!.close();
    const resumed = await connect(h.url, h.sessions[0], h.views[0]!.match.eventSeq);
    expect(await projection(resumed)).toEqual(h.views[0]);
    expect(project(h.room, 'player-2')).toEqual(h.views[1]);
    expect(h.room.exportArchive().journal).toEqual(journal);
    resumed.send({ ...h.command, requestId: 'foreign-id' });
    if (h.actor === 0) expect(await resumed.wait('request-result', m => m.requestId === 'foreign-id'))
      .toMatchObject({ duplicate: true, appliedVersion: h.ack.appliedVersion });
    else expect(await resumed.wait('error', m => m.requestId === 'foreign-id')).toMatchObject({ code: 'command-rejected' });
    expect(JSON.stringify(resumed.messages)).not.toContain(h.sessions[1]!.resumeToken);
    expect(JSON.stringify(h.sockets[1]!.messages)).not.toContain(h.sessions[0]!.resumeToken);
    expect(JSON.stringify(resumed.messages)).not.toContain('privateStateDigest');
  }, 120_000);

  it('restarts storage mode with exactly the same journal and views, returns the original duplicate and continues commands', async () => {
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(path.join(scratch, 'restart-')); directories.push(directory);
    const h = await pair(portBase + 2, directory), journal = h.room.exportArchive().journal;
    for (const client of h.sockets) await client.close();
    await h.server.stop();
    const restarted = await start(portBase + 2, directory), room = restarted.server.rooms.get(h.sessions[0]!.roomId)!;
    expect(room.exportArchive().journal).toEqual(journal);
    expect(room.roomView()).toMatchObject({ status: 'playing', version: h.views[0]!.match.stateVersion });
    const resumed = await Promise.all(h.sessions.map(s => connect(restarted.url, s, h.views[0]!.match.eventSeq)));
    const views = await Promise.all(resumed.map(c => projection(c)));
    expect(views).toEqual(h.views); privacy(views);
    resumed[h.actor]!.send({ ...h.command, requestId: 'restart-retry' });
    expect(await resumed[h.actor]!.wait('request-result', m => m.requestId === 'restart-retry'))
      .toMatchObject({ duplicate: true, appliedVersion: h.ack.appliedVersion, eventSeq: h.ack.eventSeq });
    expect(room.exportArchive().journal).toEqual(journal);
    const end = views[h.actor]!.actions.find(a => a.kind === 'end-turn' && a.enabled);
    if (!end || end.kind !== 'end-turn') throw Error('End action required');
    resumed[h.actor]!.send(packet('end-after-restart', views[h.actor]!.match.stateVersion,
      { type: 'end-turn', windowId: end.windowId }));
    expect(await resumed[h.actor]!.wait('request-result', m => m.requestId === 'end-after-restart')).toMatchObject({ ok: true });
    expect(room.runtimeClock.stateVersion).toBeGreaterThan(views[0]!.match.stateVersion);
  }, 120_000);

  it('withholds a success ACK when room metadata fails after CAS and recovers that command after restart', async () => {
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(path.join(scratch, 'metadata-failure-')); directories.push(directory);
    const catalog = await loadCardCatalogRuntime({ catalog: p4RuntimeFixtureCatalog });
    class FailingMetadataStore extends FileRoomStore {
      failNext = false;
      override async save(room: Parameters<FileRoomStore['save']>[0]) {
        if (this.failNext) { this.failNext = false; throw Error('room metadata write failed'); }
        return super.save(room);
      }
    }
    const store = new FailingMetadataStore(directory, async () => catalog);
    const h = await pair(portBase + 3, directory, store);
    const end = h.views[h.actor]!.actions.find(a => a.kind === 'end-turn' && a.enabled);
    if (!end || end.kind !== 'end-turn') throw Error('End action required');
    const command = packet('end-with-lost-metadata', h.views[h.actor]!.match.stateVersion,
      { type: 'end-turn', windowId: end.windowId });
    store.failNext = true;
    h.sockets[h.actor]!.send(command);
    expect(await h.sockets[h.actor]!.wait('error', m => m.requestId === command.requestId))
      .toMatchObject({ code: 'command-rejected', message: 'room metadata write failed' });
    expect(h.sockets[h.actor]!.messages.some(m => m.type === 'request-result' && m.requestId === command.requestId)).toBe(false);
    const journal = h.room.exportArchive().journal, views = h.sessions.map(s => project(h.room, s.playerId));
    expect(journal!.head.stateVersion).toBeGreaterThan(command.expectedVersion);
    // Stop while sockets remain attached: no later disconnect save can repair the lagging checkpoint.
    await h.server.stop();
    const restarted = await start(portBase + 3, directory), room = restarted.server.rooms.get(h.room.roomId)!;
    expect(room.exportArchive().journal).toEqual(journal);
    const resumed = await connect(restarted.url, h.sessions[h.actor], journal!.head.eventSeq);
    expect(await projection(resumed)).toEqual(views[h.actor]);
    resumed.send({ ...command, requestId: 'metadata-failure-retry' });
    expect(await resumed.wait('request-result', m => m.requestId === 'metadata-failure-retry'))
      .toMatchObject({ duplicate: true });
    expect(room.exportArchive().journal).toEqual(journal);
  }, 120_000);
});

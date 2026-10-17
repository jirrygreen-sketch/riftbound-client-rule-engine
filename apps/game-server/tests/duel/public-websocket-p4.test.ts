import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DUEL_RULESET_ID, PROTOCOL_VERSION, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isServerMessage, isDuelProjectionV3Actions1, type ClientSession,
  type DuelCommandMessageV3Actions1, type DuelProjectionV3Actions1,
  type ServerToClientMessage } from '@riftbound/protocol';
import { createGameServer, type GameServer, type GameServerOptions } from '../../src/server.js';
import { InMemoryRoomStore } from '../../src/room-store.js';
import { p4RuntimeFixtureCatalog } from './fixtures/p4-runtime-catalog.js';
import { setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';

class Client {
  readonly messages: ServerToClientMessage[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on('message', raw => {
      const value = JSON.parse(String(raw)); expect(isServerMessage(value)).toBe(true);
      this.messages.push(value);
    });
  }
  send(value: unknown) { this.socket.send(JSON.stringify(value)); }
  async wait<T extends ServerToClientMessage['type']>(type: T,
    predicate: (value: Extract<ServerToClientMessage, { type: T }>) => boolean = () => true) {
    // The shared runner can spike past load 100; commands stay queued on the
    // serialized room runtime far longer than the previous 10s window.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(value => value.type === type && predicate(value as Extract<ServerToClientMessage, { type: T }>));
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<ServerToClientMessage, { type: T }>;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw Error(`missing ${type}`);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.once('close', resolve); this.socket.close(); });
  }
}
class ControlledStore extends InMemoryRoomStore {
  fail = false; delay: Promise<void> | null = null; entered: (() => void) | null = null;
  override async save(room: Parameters<InMemoryRoomStore['save']>[0]) {
    this.entered?.(); await this.delay;
    if (this.fail) throw Error('P4 durable save failed');
    await super.save(room);
  }
}
const clients: Client[] = [], servers: GameServer[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.stop();
});
async function start(options: Partial<GameServerOptions> = {}) {
  const server = createGameServer({ port: 0, catalog: p4RuntimeFixtureCatalog,
    roomIdFactory: () => 'p4-public-socket', duelRoomProfile: 'p4', ...options });
  servers.push(server); await server.start();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw Error('listening address required');
  return { server, url: `ws://127.0.0.1:${address.port}/ws` };
}
async function connect(url: string, resume?: ClientSession) {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const client = new Client(socket); clients.push(client);
  client.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION,
    ...(resume ? { roomId: resume.roomId, resumeToken: resume.resumeToken } : {}) });
  await client.wait('welcome', value => resume ? value.resumed === true : !value.session);
  return client;
}
async function pair(options: Partial<GameServerOptions> = {}) {
  const running = await start(options), a = await connect(running.url), b = await connect(running.url);
  a.send({ type: 'create-room', requestId: 'create', playerName: 'Alice', rulesetId: DUEL_RULESET_ID });
  const sessionA = (await a.wait('welcome', value => Boolean(value.session))).session!;
  await a.wait('request-result', value => value.requestId === 'create');
  b.send({ type: 'join-room', requestId: 'join', roomId: sessionA.roomId, playerName: 'Bob' });
  const sessionB = (await b.wait('welcome', value => Boolean(value.session))).session!;
  await b.wait('request-result', value => value.requestId === 'join');
  const sockets = [a, b], sessions = [sessionA, sessionB];
  let version = (await a.wait('room', value => value.room.players.length === 2)).room.roomVersion;
  for (let i = 0; i < 2; i++) {
    sockets[i]!.send({ type: 'submit-deck', requestId: `deck-${i}`, expectedRoomVersion: version,
      deck: i === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission });
    version = (await sockets[i]!.wait('request-result', value => value.requestId === `deck-${i}`)).roomVersion!;
    sockets[i]!.send({ type: 'set-ready', requestId: `ready-${i}`, expectedRoomVersion: version, ready: true });
    version = (await sockets[i]!.wait('request-result', value => value.requestId === `ready-${i}`)).roomVersion!;
  }
  const setup = await a.wait('duel-projection');
  if (!isDuelProjectionV3Actions1(setup.projection)) throw Error('P4 setup required');
  return { ...running, a, b, sockets, sessions, setup: setup.projection };
}
function packet(id: string, p: DuelProjectionV3Actions1, command: DuelCommandMessageV3Actions1['command']): DuelCommandMessageV3Actions1 {
  return { type: 'duel-command', requestId: id, commandId: id, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    expectedVersion: p.match.stateVersion, command };
}
async function enterMain(h: Awaited<ReturnType<typeof pair>>) {
  let p = h.setup;
  for (let n = 0; n < 2; n++) {
    if (p.match.stage !== 'setup') throw Error('setup required');
    const actor = p.match.setup.currentMulliganOwner, client = actor === h.sessions[0]!.playerId ? h.a : h.b;
    client.send(packet(`m-${n}`, p, { type: 'mulligan', selectedUIDs: [] }));
    const ack = await client.wait('request-result', value => value.requestId === `m-${n}`);
    const next = (await client.wait('duel-projection', value => value.projection.match.stateVersion >= ack.appliedVersion! &&
      value.projection.match.stateVersion > p.match.stateVersion)).projection;
    if (!isDuelProjectionV3Actions1(next)) throw Error('P4 projection required'); p = next;
  }
  if (p.match.stage !== 'playing' || p.match.frame.phase !== 'main') throw Error('real Main required');
  const client = p.match.frame.turnPlayerId === h.sessions[0]!.playerId ? h.a : h.b;
  const main = (await client.wait('duel-projection', value => value.projection.match.stateVersion === p.match.stateVersion)).projection;
  if (!isDuelProjectionV3Actions1(main)) throw Error('owner projection required');
  return { p: main, client };
}
describe('public /ws P4 lifecycle', () => {
  it('uses the selected profile for actual Main, rune commands and duplicate receipts', async () => {
    const h = await pair(), main = await enterMain(h);
    const rune = main.p.actions.find(action => action.kind === 'rune-energy' && action.enabled);
    if (!rune || rune.kind !== 'rune-energy') throw Error('real Rune action required');
    const command = packet('rune', main.p, { type: 'rune-energy', uid: rune.uid });
    main.client.send(command);
    const ack = await main.client.wait('request-result', value => value.requestId === 'rune');
    const before = h.server.rooms.get(h.sessions[0]!.roomId)!.roomView().version;
    main.client.send({ ...command, requestId: 'rune-duplicate' });
    expect(await main.client.wait('request-result', value => value.requestId === 'rune-duplicate')).toMatchObject({ duplicate: true, appliedVersion: ack.appliedVersion });
    expect(h.server.rooms.get(h.sessions[0]!.roomId)!.roomView().version).toBe(before);
    main.client.send({ type: 'duel-command', requestId: 'legacy', commandId: 'legacy', expectedVersion: before,
      command: { type: 'mulligan', selectedUIDs: [] } });
    expect((await main.client.wait('error', value => value.requestId === 'legacy')).code).toBe('command-rejected');
  }, 120_000);

  it('holds the public acknowledgement until the whole P4 archive is saved', async () => {
    const store = new ControlledStore(), h = await pair({ roomStore: store });
    let release!: () => void, entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    store.entered = entered; store.delay = new Promise(resolve => { release = resolve; });
    const actor = h.setup.match.turnOrder[0], client = actor === h.sessions[0]!.playerId ? h.a : h.b;
    client.send(packet('held-ack', h.setup, { type: 'mulligan', selectedUIDs: [] }));
    await reached;
    expect(client.messages.some(value => value.type === 'request-result' && value.requestId === 'held-ack')).toBe(false);
    release(); await client.wait('request-result', value => value.requestId === 'held-ack');
    expect(h.server.rooms.get(h.sessions[0]!.roomId)!.exportArchive().journal?.entries).toHaveLength(1);
  }, 120_000);

  it('rolls a failed Main command back and can accept the same command after storage recovers', async () => {
    const store = new ControlledStore(), h = await pair({ roomStore: store }), main = await enterMain(h);
    const action = main.p.actions.find(action => action.kind === 'end-turn');
    if (!action || action.kind !== 'end-turn') throw Error('End required');
    const command = packet('failed-end', main.p, { type: 'end-turn', windowId: action.windowId });
    const room = h.server.rooms.get(h.sessions[0]!.roomId)!, archive = room.exportArchive();
    store.fail = true; main.client.send(command);
    await main.client.wait('error', value => value.requestId === 'failed-end');
    expect(room.exportArchive()).toEqual(archive);
    expect(main.client.messages.some(value => value.type === 'request-result' && value.requestId === 'failed-end')).toBe(false);
    store.fail = false; main.client.send(command);
    expect(await main.client.wait('request-result', value => value.requestId === 'failed-end')).toMatchObject({ duplicate: false });
  }, 120_000);

  it('restores private P4 history and authenticated sessions through a fresh file-backed server', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'riftbound-public-p4-'));
    try {
      const h = await pair({ storageDirectory: directory }), main = await enterMain(h);
      const action = main.p.actions.find(action => action.kind === 'end-turn');
      if (!action || action.kind !== 'end-turn') throw Error('End required');
      const command = packet('saved-end', main.p, { type: 'end-turn', windowId: action.windowId });
      main.client.send(command); const ack = await main.client.wait('request-result', value => value.requestId === 'saved-end');
      const saved = (await main.client.wait('duel-projection', value => value.projection.match.stateVersion >= ack.appliedVersion!)).projection;
      for (const client of h.sockets) await client.close();
      await h.server.stop();
      const fresh = await start({ storageDirectory: directory });
      const actorSession = main.p.viewerPlayerId === h.sessions[0]!.playerId ? h.sessions[0]! : h.sessions[1]!;
      const resumed = await connect(fresh.url, actorSession);
      const restored = await resumed.wait('duel-projection');
      expect(restored.projection).toEqual(saved);
      expect(isDuelProjectionV3Actions1(restored.projection)).toBe(true);
      resumed.send({ ...command, requestId: 'saved-end-retry' });
      expect(await resumed.wait('request-result', value => value.requestId === 'saved-end-retry')).toMatchObject({ duplicate: true, appliedVersion: ack.appliedVersion });
      const otherSession = actorSession.playerId === h.sessions[0]!.playerId ? h.sessions[1]! : h.sessions[0]!;
      const other = await connect(fresh.url, otherSession), current = (await other.wait('duel-projection')).projection;
      if (!isDuelProjectionV3Actions1(current)) throw Error('P4 restored action view required');
      const end = current.actions.find(value => value.kind === 'end-turn' && value.enabled);
      if (!end || end.kind !== 'end-turn') throw Error('restored next turn action required');
      other.send(packet('after-restart-end', current, { type: 'end-turn', windowId: end.windowId }));
      await other.wait('request-result', value => value.requestId === 'after-restart-end');
      await resumed.close(); await other.close(); await fresh.server.stop();
    } finally {
      // Journal stores close asynchronously during server.stop(); a single rm
      // pass can race the final lock-file unlink. Retry so cleanup never masks
      // the assertions under test.
      for (let attempt = 0; ; attempt++) {
        try { await rm(directory, { recursive: true, force: true }); break; }
        catch (error) {
          if (attempt >= 5 || (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    }
  }, 120_000);
});

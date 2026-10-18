import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  DUEL_RULESET_ID, PROTOCOL_VERSION, isServerMessage, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  type ClientToServerMessage, type ServerToClientMessage, type DuelCommandMessage,
  type ClientSession
} from "@riftbound/protocol";
import { createGameServer, type GameServer } from "../../src/server.js";
import { InMemoryRoomStore } from "../../src/room-store.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
class SocketClient {
  readonly messages: ServerToClientMessage[] = [];
  private readonly waiters = new Set<() => void>();
  constructor(readonly socket: WebSocket) {
    socket.on("message", raw => {
      const parsed = JSON.parse(String(raw)) as ServerToClientMessage;
      expect(isServerMessage(parsed)).toBe(true);
      this.messages.push(parsed);
      for (const wake of this.waiters) wake();
    });
  }
  send(message: ClientToServerMessage | Record<string, unknown>) {
    this.socket.send(JSON.stringify(message));
  }
  async wait<T extends ServerToClientMessage["type"]>(type: T,
    predicate: (message: Extract<ServerToClientMessage, { type: T }>) => boolean = () => true) {
    const deadline = Date.now() + 5000;
    while (true) {
      const index = this.messages.findIndex(m => m.type === type && predicate(m as Extract<ServerToClientMessage, { type: T }>));
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<ServerToClientMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`Timed out for ${type}: ${JSON.stringify(this.messages)}`);
      await new Promise<void>(resolve => {
        const wake = () => { this.waiters.delete(wake); resolve(); };
        this.waiters.add(wake);
        setTimeout(wake, 10);
      });
    }
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }
}
class ControlledStore extends InMemoryRoomStore {
  saves = 0;
  delay: Promise<void> | null = null;
  fail = false;
  override async save(room: Parameters<InMemoryRoomStore["save"]>[0]) {
    this.saves++;
    await this.delay;
    if (this.fail) throw new Error("Injected durable save failure");
    await super.save(room);
  }
}
const openSockets: SocketClient[] = [];
const openServers: GameServer[] = [];
afterEach(async () => {
  for (const socket of openSockets.splice(0)) await socket.close();
  for (const server of openServers.splice(0)) await server.stop();
});
async function start(store = new ControlledStore()) {
  const server = createGameServer({ port: 0, catalog: setupAdapterFixtureCatalog,
    imagesDirectory, roomStore: store, roomIdFactory: () => "duel-socket-test", duelRuntimeMode: "legacy-p4" });
  openServers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (typeof address === "string" || !address) throw new Error("Missing listening address");
  return { store, server, url: `ws://127.0.0.1:${address.port}/ws` };
}
async function connect(url: string) {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const client = new SocketClient(socket);
  openSockets.push(client);
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  await client.wait("welcome", m => m.session === undefined);
  return client;
}
async function create(client: SocketClient) {
  client.send({ type: "create-room", requestId: "create", playerName: "Alice", rulesetId: DUEL_RULESET_ID });
  const welcome = await client.wait("welcome", m => !!m.session);
  await client.wait("request-result", m => m.requestId === "create");
  return welcome.session!;
}
async function join(client: SocketClient, roomId: string) {
  client.send({ type: "join-room", requestId: "join", roomId, playerName: "Bob" });
  const welcome = await client.wait("welcome", m => !!m.session);
  await client.wait("request-result", m => m.requestId === "join");
  return welcome.session!;
}
async function ready(client: SocketClient, deck: typeof setupAdapterFixtureDecks.a.submission,
  prefix: string, version: number) {
  client.send({ type: "submit-deck", requestId: `${prefix}-deck`, expectedRoomVersion: version, deck });
  const deckReceipt = await client.wait("request-result", m => m.requestId === `${prefix}-deck`);
  client.send({ type: "set-ready", requestId: `${prefix}-ready`, expectedRoomVersion: deckReceipt.roomVersion!, ready: true });
  return (await client.wait("request-result", m => m.requestId === `${prefix}-ready`)).roomVersion!;
}
async function pair(store = new ControlledStore()) {
  const running = await start(store);
  const a = await connect(running.url), sessionA = await create(a);
  const b = await connect(running.url), sessionB = await join(b, sessionA.roomId);
  const v = await a.wait("room", m => m.room.players.length === 2);
  await ready(a, setupAdapterFixtureDecks.a.submission, "a", v.room.roomVersion);
  const after = await a.wait("room", m => m.room.players[0]?.ready === true);
  await ready(b, setupAdapterFixtureDecks.b.submission, "b", after.room.roomVersion);
  const setupA = await a.wait("duel-projection");
  const setupB = await b.wait("duel-projection");
  return { ...running, a, b, sessionA, sessionB, setupA: setupA.projection,
    setupB: setupB.projection };
}
function mulligan(commandId: string, version: number): DuelCommandMessage {
  return { type: "duel-command", requestId: commandId, commandId, expectedVersion: version,
    command: { type: "mulligan", selectedUIDs: [] } };
}

 describe("real /ws opt-in duel", () => {
  it("rejects P4 packets when the room has not selected that profile", async () => {
    const h = await start();
    const a = await connect(h.url);
    const session = await create(a);
    const saves = h.store.saves;
    a.send({ ...mulligan("unselected-profile", 0),
      commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 });
    const error = await a.wait("error", m => m.requestId === "unselected-profile");
    expect(error.code).toBe("command-rejected");
    expect(h.store.saves).toBe(saves);
    expect(h.server.rooms.get(session.roomId)?.roomView().version).toBe(0);
  });
  it("exposes canonical setup, private hands, turn-order mulligans and two shared fields", async () => {
    const h = await pair();
    const setup = h.setupA.match;
    expect(setup.stage).toBe("setup");
    if (setup.stage !== "setup") return;
    expect(setup.setup.players.map(p => p.handCount)).toEqual([4, 4]);
    expect(h.setupA.viewerPlayerId).toBe(h.sessionA.playerId);
    expect(h.setupB.viewerPlayerId).toBe(h.sessionB.playerId);
    expect(setup.setup.players.filter(p => Object.hasOwn(p, "hand"))).toHaveLength(1);
    expect(JSON.stringify(h.setupA)).not.toContain(h.sessionB.resumeToken);
    const first = setup.turnOrder[0] === h.sessionA.playerId ? h.a : h.b;
    const second = first === h.a ? h.b : h.a;
    second.send(mulligan("out-of-order", 0));
    await second.wait("error", m => m.requestId === "out-of-order");
    first.send(mulligan("first", 0));
    expect((await first.wait("request-result", m => m.requestId === "first")).appliedVersion).toBe(1);
    second.send(mulligan("second", 1));
    expect((await second.wait("request-result", m => m.requestId === "second")).appliedVersion).toBe(2);
    for (const client of [h.a, h.b]) {
      const p = (await client.wait("duel-projection", m => m.projection.match.stage === "playing" &&
        m.projection.match.stateVersion === 2)).projection;
      expect(p.match.stage).toBe("playing");
      if (p.match.stage !== "playing") continue;
      expect(p.match.board.battlefields).toHaveLength(2);
      expect(p.match.frame.phase).toBe("awaiting-turn-start");
      expect(p.match.frame.priorityPlayerId).toBeNull();
      expect(p.actions).toEqual([]);
    }
  });

  it("rejects extra actors/cost, cross-ruleset commands, and replaced connections", async () => {
    const h = await pair();
    h.a.send({ ...mulligan("extra-actor", 0), actor: h.sessionB.playerId });
    expect((await h.a.wait("error")).code).toBe("protocol-error");
    h.a.send({ ...mulligan("extra-cost", 0), command: { type: "mulligan", selectedUIDs: [], cost: 1 } });
    expect((await h.a.wait("error")).code).toBe("protocol-error");
    h.a.send({ type: "command", requestId: "legacy", commandId: "legacy", expectedVersion: 0,
      command: { type: "pass" } });
    expect((await h.a.wait("error", m => m.requestId === "legacy")).code).toBe("command-rejected");
    const replacementSocket = new WebSocket(h.url);
    await new Promise<void>((resolve, reject) => {
      replacementSocket.once("open", resolve);
      replacementSocket.once("error", reject);
    });
    const replacement = new SocketClient(replacementSocket);
    openSockets.push(replacement);
    replacement.send({ type: "hello", protocolVersion: PROTOCOL_VERSION,
      roomId: h.sessionA.roomId, resumeToken: h.sessionA.resumeToken });
    await replacement.wait("welcome", m => m.resumed === true);
    h.a.send(mulligan("old-socket", 0));
    expect((await h.a.wait("error", m => m.requestId === "old-socket")).code).toBe("session-replaced");
    expect(h.server.rooms.get(h.sessionA.roomId)?.roomView().version).toBe(0);
  });

  it("validates future cursors and uses latest duel projection for sync instead of fake event replay", async () => {
    const h = await pair();
    h.a.send({ type: "sync-events", requestId: "future", afterEventSeq: 1 });
    expect((await h.a.wait("error", m => m.requestId === "future")).code).toBe("command-rejected");
    h.a.send({ type: "sync-events", requestId: "current", afterEventSeq: 0 });
    await h.a.wait("request-result", m => m.requestId === "current");
    expect((await h.a.wait("duel-projection", m => m.projection.match.stateVersion === 0)).projection.match.stateVersion).toBe(0);
    expect(h.a.messages.every(m => m.type !== "events")).toBe(true);
  });

  it("serializes two sockets at the same version and never sends ACK before durable save", async () => {
    const store = new ControlledStore();
    const h = await pair(store);
    const first = h.setupA.match.turnOrder[0] === h.sessionA.playerId ? h.a : h.b;
    const second = first === h.a ? h.b : h.a;
    let release!: () => void;
    store.delay = new Promise(resolve => { release = resolve; });
    first.send(mulligan("first", 0));
    second.send(mulligan("stale", 0));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(first.messages.some(m => m.type === "request-result" && m.requestId === "first")).toBe(false);
    expect(second.messages.some(m => m.type === "error" && m.requestId === "stale")).toBe(false);
    release();
    expect((await first.wait("request-result", m => m.requestId === "first")).appliedVersion).toBe(1);
    expect((await second.wait("error", m => m.requestId === "stale")).code).toBe("command-rejected");
    expect(store.saves).toBeGreaterThan(0);
    expect(h.server.rooms.get(h.sessionA.roomId)?.roomView().version).toBe(1);
    const archived = h.server.rooms.get(h.sessionA.roomId)?.exportArchive();
    expect(archived?.journal?.entries).toHaveLength(1);
  });

  it("rolls back failed sticky receipt and socket bindings without acknowledging it", async () => {
    const store = new ControlledStore();
    const h = await pair(store);
    const first = h.setupA.match.turnOrder[0] === h.sessionA.playerId ? h.a : h.b;
    const room = h.server.rooms.get(h.sessionA.roomId)!;
    const previous = room.exportArchive();
    store.fail = true;
    first.send(mulligan("failed-save", 0));
    expect((await first.wait("error", m => m.requestId === "failed-save")).code).toBe("command-rejected");
    expect(first.messages.some(m => m.type === "request-result" && m.requestId === "failed-save")).toBe(false);
    expect(room.exportArchive()).toEqual(previous);
    store.fail = false;
    first.send(mulligan("retry-save", 0));
    expect((await first.wait("request-result", m => m.requestId === "retry-save")).appliedVersion).toBe(1);
  });
});

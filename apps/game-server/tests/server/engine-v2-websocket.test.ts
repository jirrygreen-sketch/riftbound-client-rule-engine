import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import {
  PROTOCOL_V2_VERSION,
  isV2CommandReceipt,
  isV2Projection,
  type V2Projection
} from "../../../../packages/protocol/dist/v2/index.js";
import { createGameServer, type GameServer } from "../../src/server.js";
import { p4RuntimeFixtureCatalog } from "../duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "../duel/fixtures/setup-adapter-catalog.js";

const servers: GameServer[] = [];
const sockets: WebSocket[] = [];
const directories: string[] = [];

class Client {
  readonly messages: unknown[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", raw => this.messages.push(JSON.parse(String(raw))));
  }

  send(value: unknown) { this.socket.send(JSON.stringify(value)); }

  async wait(predicate: (value: unknown) => boolean): Promise<any> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for v2 message; received ${this.messages.map(value => typeof value === "object" && value !== null && "type" in value ? (value as { type: unknown }).type : "unknown").join(", ")}`);
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.once("close", resolve); this.socket.close(); });
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  for (const server of servers.splice(0)) await server.stop();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function start(port: number, storageDirectory?: string) {
  const server = createGameServer({ port, storageDirectory, catalog: p4RuntimeFixtureCatalog,
    roomIdFactory: () => "v2-room", duelRandomIndex: () => 0 });
  servers.push(server);
  await server.start();
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

async function connect(url: string, session?: ClientSession, afterEventSeq?: number) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const client = new Client(socket);
  client.send({ type: "hello", protocolVersion: PROTOCOL_V2_VERSION,
    ...(session ? { roomId: session.roomId, resumeToken: session.resumeToken, afterEventSeq } : {}) });
  const welcome = await client.wait(value => value !== null && typeof value === "object" &&
    ((value as { type?: unknown }).type === "welcome" || (value as { type?: unknown }).type === "error"));
  if ((welcome as { type?: unknown }).type === "error") throw new Error(`v2 handshake failed: ${JSON.stringify(welcome)}`);
  return client;
}

async function projection(client: Client): Promise<V2Projection> {
  const message = await client.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "projection");
  const value = (message as { projection: unknown }).projection;
  if (!isV2Projection(value)) throw new Error("Invalid protocol v2 projection");
  return value;
}

describe("protocol v2 engine runtime over WebSocket", () => {
  it("creates, resumes and restores a private two-client match", async () => {
    const directory = await mkdtemp(path.join("/tmp", "rift-350-v2-"));
    directories.push(directory);
    const running = await start(33040, directory);
    const alice = await connect(running.url);
    alice.send({ type: "create-room", requestId: "create", playerName: "Alice", rulesetId: DUEL_RULESET_ID });
    const welcomeA = await alice.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "welcome" && "session" in value);
    await alice.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" && (value as { requestId?: unknown }).requestId === "create");
    const sessionA = (welcomeA as { session: ClientSession }).session;

    const bob = await connect(running.url);
    bob.send({ type: "join-room", requestId: "join", roomId: sessionA.roomId, playerName: "Bob" });
    const welcomeB = await bob.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "welcome" && "session" in value);
    await bob.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" && (value as { requestId?: unknown }).requestId === "join");
    const sessionB = (welcomeB as { session: ClientSession }).session;

    const room = running.server.rooms.get(sessionA.roomId)!;
    let roomVersion = room.currentRoomVersion;
    for (const [index, client] of [alice, bob].entries()) {
      client.send({ type: "submit-deck", requestId: `deck-${index}`, expectedRoomVersion: roomVersion,
        deck: index === 0 ? setupAdapterFixtureDecks.a.submission : setupAdapterFixtureDecks.b.submission });
      roomVersion = (await client.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === `deck-${index}`)).roomVersion;
      client.send({ type: "set-ready", requestId: `ready-${index}`, expectedRoomVersion: roomVersion, ready: true });
      roomVersion = (await client.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === `ready-${index}`)).roomVersion;
    }

    const [viewA, viewB] = await Promise.all([projection(alice), projection(bob)]);
    expect(viewA.viewerPlayerId).toBe(sessionA.playerId);
    expect(viewB.viewerPlayerId).toBe(sessionB.playerId);
    expect(viewB.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === sessionA.playerId)?.objects).toBeUndefined();

    const actor = viewA.activePlayerId === sessionA.playerId ? alice : bob;
    const pass = { type: "command", protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "pass", commandId: "v2-pass", stateVersion: viewA.stateVersion } };
    actor.send(pass);
    const receipt = await actor.wait(value => isV2CommandReceipt(value) && value.commandId === "v2-pass");
    expect(receipt).toMatchObject({ accepted: true, duplicate: false, stateVersion: viewA.stateVersion + 1 });
    await projection(alice);
    await projection(bob);

    await alice.close();
    const resumed = await connect(running.url, sessionA, receipt.eventSeq);
    const resumedProjection = await projection(resumed);
    expect(resumedProjection.stateVersion).toBe(receipt.stateVersion);
    resumed.send(pass);
    expect(await resumed.wait(value => isV2CommandReceipt(value) && value.commandId === "v2-pass"))
      .toMatchObject({ accepted: true, duplicate: true, stateVersion: receipt.stateVersion });

    await bob.close();
    await resumed.close();
    await running.server.stop();
    const restarted = await start(33040, directory);
    const [restoredA, restoredB] = await Promise.all([
      connect(restarted.url, sessionA, receipt.eventSeq),
      connect(restarted.url, sessionB, receipt.eventSeq)
    ]);
    const restoredViews = await Promise.all([projection(restoredA), projection(restoredB)]);
    expect(restoredViews[0]!.stateVersion).toBe(receipt.stateVersion);
    expect(restoredViews[1]!.stateVersion).toBe(receipt.stateVersion);
    restoredA.send(pass);
    expect(await restoredA.wait(value => isV2CommandReceipt(value) && value.commandId === "v2-pass"))
      .toMatchObject({ accepted: true, duplicate: true });
  }, 120_000);
});

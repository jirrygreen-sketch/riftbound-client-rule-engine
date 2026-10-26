import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import { PROTOCOL_V2_VERSION } from "../../../../packages/protocol/dist/v2/index.js";
import {
  createGameServer,
  type GameServer,
  resolveDuelRandomIndex
} from "../../src/server.js";
import { deterministicLoadCommandId } from "../../scripts/load-test.js";
import { p4RuntimeFixtureCatalog } from "../duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "../duel/fixtures/setup-adapter-catalog.js";

const gate = "RIFTBOUND_ALLOW_DETERMINISTIC_RANDOM";
const seedVariable = "RIFTBOUND_DETERMINISTIC_RANDOM_SEED";
const servers: GameServer[] = [];
const sockets: WebSocket[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  for (const server of servers.splice(0)) await server.stop();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

interface Packet {
  readonly type: string;
  readonly requestId?: string;
  readonly session?: ClientSession;
  readonly roomVersion?: number;
  readonly projection?: {
    readonly activePlayerId: string;
    readonly battlefields: readonly { readonly battlefieldId: string }[];
    readonly zones: readonly {
      readonly zone: string;
      readonly ownerPlayerId: string;
      readonly objects?: readonly { readonly objectId: string; readonly cardId?: string }[];
    }[];
  };
}

interface OpeningObservation {
  readonly roomId: string;
  readonly firstPlayerId: string;
  readonly battlefields: readonly string[];
}

class Client {
  readonly packets: Packet[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", raw => this.packets.push(JSON.parse(String(raw)) as Packet));
  }

  send(value: unknown): void { this.socket.send(JSON.stringify(value)); }

  async wait(predicate: (packet: Packet) => boolean): Promise<Packet> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const index = this.packets.findIndex(predicate);
      if (index >= 0) return this.packets.splice(index, 1)[0]!;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for server packet: ${JSON.stringify(this.packets)}`);
  }
}

async function startServer(): Promise<{ readonly server: GameServer; readonly url: string }> {
  const directory = await mkdtemp(path.join("/tmp", "rift-1090-deterministic-"));
  directories.push(directory);
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    storageDirectory: directory,
    catalog: p4RuntimeFixtureCatalog
  });
  servers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("Server has no TCP address");
  return { server, url: `ws://127.0.0.1:${address.port}/ws` };
}

async function connect(url: string, roomId?: string): Promise<Client> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client = new Client(socket);
  client.send({ type: "hello", protocolVersion: PROTOCOL_V2_VERSION });
  await client.wait(packet => packet.type === "welcome");
  if (roomId === undefined) {
    client.send({ type: "create-room", requestId: "create", playerName: "Alice", rulesetId: DUEL_RULESET_ID });
  } else {
    client.send({ type: "join-room", requestId: "join", roomId, playerName: "Bob" });
  }
  const welcome = await client.wait(packet => packet.type === "welcome" && packet.session !== undefined);
  if (welcome.session === undefined) throw new Error("Room welcome did not contain a session");
  await client.wait(packet => packet.type === "request-result" && packet.requestId === (roomId === undefined ? "create" : "join"));
  (client as Client & { session: ClientSession }).session = welcome.session;
  return client;
}

async function observeOpening(server: GameServer, url: string): Promise<OpeningObservation> {
  const alice = await connect(url);
  const bob = await connect(url, (alice as Client & { readonly session: ClientSession }).session.roomId);
  const aliceSession = (alice as Client & { readonly session: ClientSession }).session;
  if ((bob as Client & { readonly session?: ClientSession }).session === undefined) {
    throw new Error("Joined client has no session");
  }
  const room = server.rooms.get(aliceSession.roomId);
  if (room === undefined) throw new Error("Created room is missing");
  let roomVersion = room.currentRoomVersion;
  for (const [index, client, deck] of [
    [0, alice, setupAdapterFixtureDecks.a.submission],
    [1, bob, setupAdapterFixtureDecks.b.submission]
  ] as const) {
    client.send({ type: "submit-deck", requestId: `deck-${index}`, expectedRoomVersion: roomVersion, deck });
    roomVersion = (await client.wait(packet => packet.type === "request-result" && packet.requestId === `deck-${index}`)).roomVersion!;
    client.send({ type: "set-ready", requestId: `ready-${index}`, expectedRoomVersion: roomVersion, ready: true });
    roomVersion = (await client.wait(packet => packet.type === "request-result" && packet.requestId === `ready-${index}`)).roomVersion!;
  }
  const [aliceView] = await Promise.all([
    alice.wait(packet => packet.type === "projection" && packet.projection?.zones.some(zone =>
      zone.zone === "hand" && zone.ownerPlayerId === aliceSession.playerId) === true)
  ]);
  if (aliceView.projection === undefined) {
    throw new Error("Setup projections are missing");
  }
  const opening = {
    roomId: aliceSession.roomId,
    firstPlayerId: aliceView.projection.activePlayerId,
    battlefields: aliceView.projection.battlefields.map(field => field.battlefieldId)
  };
  return opening;
}

describe("deterministic profile RNG gate", () => {
  it("uses prefix plus sequence command identities for profile load runs", () => {
    expect(deterministicLoadCommandId("RIFT-1082-0", "first", 0)).toBe("load-RIFT-1082-0-first-0");
    expect(deterministicLoadCommandId("RIFT-1082-0", "second", 42)).toBe("load-RIFT-1082-0-second-42");
  });

  it.each([
    [{}, "both variables missing"],
    [{ [seedVariable]: "profile-seed" }, "explicit gate missing"],
    [{ [gate]: "1" }, "explicit seed missing"],
    [{ [gate]: "true", [seedVariable]: "profile-seed" }, "gate is not exactly 1"],
    [{ [gate]: "1", [seedVariable]: "" }, "seed is empty"]
  ])("uses the default crypto adapter for %s", (environment, description) => {
    const cryptoRandomIndex = vi.fn((bound: number) => bound - 1);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const randomIndex = resolveDuelRandomIndex(environment, cryptoRandomIndex);

    expect(randomIndex).toBe(cryptoRandomIndex);
    expect(randomIndex(3)).toBe(2);
    expect(cryptoRandomIndex).toHaveBeenCalledExactlyOnceWith(3);
    expect(warning, description).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it("returns identical streams for two instances using the same explicit seed", () => {
    const environment = { [gate]: "1", [seedVariable]: "RIFT-1090:reproducible" };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const first = resolveDuelRandomIndex(environment, () => { throw new Error("crypto must not be used"); });
    const second = resolveDuelRandomIndex(environment, () => { throw new Error("crypto must not be used"); });
    const draws = (randomIndex: (bound: number) => number) =>
      Array.from({ length: 32 }, (_, index) => randomIndex((index % 7) + 1));

    expect(draws(first)).toEqual(draws(second));
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning.mock.calls[0]?.[0]).toContain("[SECURITY WARNING]");
    warning.mockRestore();
  });

  it("derives different streams from different explicit seeds", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const draws = (seed: string) => {
      const randomIndex = resolveDuelRandomIndex({ [gate]: "1", [seedVariable]: seed });
      return Array.from({ length: 32 }, () => randomIndex(3));
    };

    expect(draws("profile-a")).not.toEqual(draws("profile-b"));
    warning.mockRestore();
  });

  it("produces the same public opening in two server instances with the same seed", async () => {
    vi.stubEnv(gate, "1");
    vi.stubEnv(seedVariable, "RIFT-1090-server-instance");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const first = await startServer();
    const second = await startServer();
    const [firstOpening, secondOpening] = await Promise.all([
      observeOpening(first.server, first.url),
      observeOpening(second.server, second.url)
    ]);

    expect(firstOpening.roomId).not.toBe(secondOpening.roomId);
    expect(firstOpening.firstPlayerId).toBe(secondOpening.firstPlayerId);
    expect(firstOpening.battlefields).toEqual(secondOpening.battlefields);
    expect(warning).toHaveBeenCalledTimes(2);
  });

  it("keeps live crypto entropy when the opt-in is absent", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const randomIndex = resolveDuelRandomIndex({});
    const draws = Array.from({ length: 64 }, () => randomIndex(1_000_000));

    expect(new Set(draws).size).toBeGreaterThan(1);
    expect(warning).not.toHaveBeenCalled();
  });
});

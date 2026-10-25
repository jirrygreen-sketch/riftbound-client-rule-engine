import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createGameServer, type GameServer } from "../../game-server/src/server.js";
import { loadCardCatalogRuntime } from "../../game-server/src/card-catalog.js";
import { buildM1Deck, type M1PreconId } from "../../../packages/integration-tests/src/headless/decks.js";
import type { ClientSession, RoomDeckSubmission } from "@riftbound/protocol";
import {
  isV2CommandReceipt,
  isV2Projection,
  type V2Projection
} from "../../../packages/protocol/src/v2/index.js";
import { V2MatchSessionController } from "../src/full-product/v2/V2MatchSession";

const servers: GameServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

class WireClient {
  readonly messages: unknown[] = [];

  constructor(readonly socket: WebSocket) {
    socket.addEventListener("message", event => this.messages.push(JSON.parse(String(event.data))));
  }

  send(value: unknown): void { this.socket.send(JSON.stringify(value)); }

  async wait(predicate: (value: unknown) => boolean): Promise<any> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const error = this.messages.find(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "error");
      if (error) throw new Error(`Real V2 server error: ${JSON.stringify(error)}`);
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for real V2 server packet");
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.addEventListener("close", () => resolve(), { once: true }); this.socket.close(); });
  }
}

async function connect(url: string): Promise<WireClient> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("V2 WebSocket failed")), { once: true });
  });
  const client = new WireClient(socket);
  client.send({ type: "hello", protocolVersion: "2.0.0" });
  await client.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "welcome");
  return client;
}

async function submissions(): Promise<readonly [RoomDeckSubmission, RoomDeckSubmission]> {
  const catalog = await loadCardCatalogRuntime();
  const printingByCanonical = new Map(catalog.publicCatalog.cards.map(card =>
    [card.canonicalCardId, card.id] as const));
  const entries = (cards: readonly { readonly canonicalCardId: string }[]) => {
    const quantities = new Map<string, number>();
    for (const card of cards) quantities.set(card.canonicalCardId,
      (quantities.get(card.canonicalCardId) ?? 0) + 1);
    return [...quantities].map(([canonicalCardId, quantity]) => {
      const printing = printingByCanonical.get(canonicalCardId);
      if (!printing) throw new Error(`No real catalog printing for ${canonicalCardId}`);
      return { cardId: printing, quantity };
    });
  };
  const submission = (id: M1PreconId, seat: "A" | "B"): RoomDeckSubmission => {
    const deck = buildM1Deck(id, seat);
    return {
      mainDeck: entries(deck.mainDeck), runes: entries(deck.runeDeck),
      legend: entries([deck.championLegend]), champion: entries([deck.chosenChampion]),
      battlefields: entries(deck.battlefields)
    };
  };
  return [submission("rumble-sfd", "A"), submission("fiora-sfd", "B")];
}

function projection(client: WireClient, minimumStateVersion = 0,
  expectedPhase?: V2Projection["phase"]): Promise<V2Projection> {
  return client.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "projection" &&
    ((value as { projection?: { stateVersion?: number } }).projection?.stateVersion ?? -1) >= minimumStateVersion &&
    (expectedPhase === undefined ||
      (value as { projection?: { phase?: unknown } }).projection?.phase === expectedPhase))
    .then(message => {
      if (!isV2Projection(message.projection)) throw new Error("Invalid real V2 projection");
      return message.projection;
    });
}

function receipt(client: WireClient, commandId: string): Promise<any> {
  return client.wait(value => isV2CommandReceipt(value) && value.commandId === commandId);
}

describe("desktop V2 session against the real public server", () => {
  it("opens a fresh protocol-v2 session and creates a server-backed room", async () => {
    const port = Number(process.env.SWARM_PORT_BASE ?? 39500);
    const server = createGameServer({ port, roomIdFactory: () => "desktop-v2-real", duelRandomIndex: () => 0 });
    servers.push(server);
    await server.start();
    let controller: V2MatchSessionController | null = null;
    const room = await new Promise<Awaited<ReturnType<V2MatchSessionController["createRoom"]>>>((resolve, reject) => {
      controller = new V2MatchSessionController({ serverUrl: `ws://127.0.0.1:${port}/ws`,
        requestTimeoutMs: 60_000 });
      let requested = false;
      controller.subscribe(snapshot => {
        if (requested || snapshot.state.connectionStatus !== "connected") return;
        requested = true;
        void controller!.createRoom("Alice").then(resolve, reject);
      });
      controller.start();
    });
    expect(room).toMatchObject({ roomId: "desktop-v2-real", rulesetId: "riftbound-duel", status: "waiting" });
    expect(controller!.currentSession?.roomId).toBe("desktop-v2-real");
    controller!.stop();
  }, 120_000);

  it("accepts projected Rune identity over the real WebSocket and exposes the resource", async () => {
    const port = Number(process.env.SWARM_PORT_BASE ?? 39500) + 1;
    const taskDirectory = path.join("/tmp", process.env.SWARM_TASK ?? "RIFT-925-v2-desktop-client-playable");
    await mkdir(taskDirectory, { recursive: true });
    const directory = await mkdtemp(path.join(taskDirectory, "v2-real-"));
    directories.push(directory);
    const server = createGameServer({ port, storageDirectory: directory,
      roomIdFactory: () => "desktop-v2-runes", duelRandomIndex: () => 0 });
    servers.push(server);
    await server.start();
    const [deckA, deckB] = await submissions();
    const alice = await connect(`ws://127.0.0.1:${port}/ws`);
    alice.send({ type: "create-room", requestId: "real-create", playerName: "Alice", rulesetId: "riftbound-duel" });
    const sessionA = ((await alice.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "welcome" && "session" in value)) as { session: ClientSession }).session;
    await alice.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "request-result" && (value as { requestId?: unknown }).requestId === "real-create");
    const bob = await connect(`ws://127.0.0.1:${port}/ws`);
    bob.send({ type: "join-room", requestId: "real-join", roomId: sessionA.roomId, playerName: "Bob" });
    const sessionB = ((await bob.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "welcome" && "session" in value)) as { session: ClientSession }).session;
    await bob.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "request-result" && (value as { requestId?: unknown }).requestId === "real-join");
    let roomVersion = server.rooms.get(sessionA.roomId)!.currentRoomVersion;
    const players: readonly [WireClient, RoomDeckSubmission][] = [[alice, deckA], [bob, deckB]];
    for (const [index, [client, deck]] of players.entries()) {
      client.send({ type: "submit-deck", requestId: `real-deck-${index}`, expectedRoomVersion: roomVersion, deck });
      roomVersion = (await client.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === `real-deck-${index}`)).roomVersion;
      client.send({ type: "set-ready", requestId: `real-ready-${index}`, expectedRoomVersion: roomVersion, ready: true });
      roomVersion = (await client.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === `real-ready-${index}`)).roomVersion;
    }
    let [viewA, viewB] = await Promise.all([projection(alice), projection(bob)]);
    const firstMulligan = viewA.activePlayerId === sessionA.playerId ? alice : bob;
    for (const [index, client] of [firstMulligan,
      firstMulligan === alice ? bob : alice].entries()) {
      const commandId = `real-mulligan-${index}`;
      client.send({ type: "command", protocolVersion: "2.0.0",
        command: { type: "mulligan", commandId, stateVersion: 0, selectedObjectIds: [] } });
      expect(await receipt(client, commandId))
        .toMatchObject({ accepted: true, rejection: null });
    }
    [viewA, viewB] = await Promise.all([projection(alice, 0, "main"), projection(bob, 0, "main")]);
    for (let turn = 0; turn < 8; turn += 1) {
      const actorIsAlice = viewA.activePlayerId === sessionA.playerId;
      const actor = actorIsAlice ? alice : bob;
      const view = actorIsAlice ? viewA : viewB;
      if (view.phase === "main" && (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === view.viewerPlayerId)
        ?.objects ?? []).some(object => object.exhausted === false)) break;
      const commandId = `real-advance-${turn}`;
      actor.send({ type: "command", protocolVersion: "2.0.0",
        command: { type: "pass", commandId, stateVersion: view.stateVersion } });
      const accepted = await receipt(actor, commandId);
      expect(accepted.accepted).toBe(true);
      [viewA, viewB] = await Promise.all([projection(alice, accepted.stateVersion), projection(bob, accepted.stateVersion)]);
    }
    const actorIsAlice = viewA.activePlayerId === sessionA.playerId;
    const actor = actorIsAlice ? alice : bob;
    const ownerPlayerId = actorIsAlice ? sessionA.playerId : sessionB.playerId;
    const view = actorIsAlice ? viewA : viewB;
    const rune = view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === ownerPlayerId)
      ?.objects?.find(object => object.exhausted === false);
    expect(rune?.zoneEntryId).toEqual(expect.any(Number));
    if (!rune) throw new Error("A real ready Rune is required");
    const before = view.players.find(player => player.playerId === ownerPlayerId)?.energy ?? 0;
    actor.send({ type: "command", protocolVersion: "2.0.0", command: {
      type: "rune-energy", commandId: "real-rune-energy", stateVersion: view.stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!
    } });
    const accepted = await receipt(actor, "real-rune-energy");
    expect(accepted).toMatchObject({ accepted: true, duplicate: false });
    const [afterA, afterB] = await Promise.all([
      projection(alice, accepted.stateVersion), projection(bob, accepted.stateVersion)
    ]);
    const after = actorIsAlice ? afterA : afterB;
    expect(after.players.find(player => player.playerId === ownerPlayerId)?.energy).toBe(before + 1);
    expect(after.objects.find(object => object.objectId === rune.objectId)?.exhausted).toBe(true);
    await alice.close();
    await bob.close();
  }, 180_000);
});

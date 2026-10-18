import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { DUEL_RULESET_ID, type ClientSession, type RoomDeckSubmission } from "@riftbound/protocol";
import {
  PROTOCOL_V2_VERSION,
  isV2CommandReceipt,
  isV2Projection,
  type V2Projection
} from "../../../../packages/protocol/dist/v2/index.js";
import { createGameServer, type GameServer } from "../../src/server.js";
import { buildM1Deck, type M1PreconId } from "../../../../packages/integration-tests/src/headless/decks.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";

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
    const deadline = Date.now() + 60_000;
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
  const server = createGameServer({ port, storageDirectory,
    roomIdFactory: () => "v2-room", duelRandomIndex: () => 0 });
  servers.push(server);
  await server.start();
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

async function m1Submissions(): Promise<readonly [RoomDeckSubmission, RoomDeckSubmission]> {
  const catalog = await loadCardCatalogRuntime();
  const printingByCanonical = new Map(
    catalog.publicCatalog.cards.map(card => [card.canonicalCardId, card.id] as const)
  );
  const printing = (canonicalCardId: string): string => {
    const printingId = printingByCanonical.get(canonicalCardId);
    if (!printingId) throw new Error(`No catalog printing for M1 card ${canonicalCardId}`);
    return printingId;
  };
  const entries = (cards: readonly { readonly canonicalCardId: string }[]) => {
    const quantities = new Map<string, number>();
    for (const card of cards) quantities.set(card.canonicalCardId,
      (quantities.get(card.canonicalCardId) ?? 0) + 1);
    return [...quantities].map(([canonicalCardId, quantity]) => ({ cardId: printing(canonicalCardId), quantity }));
  };
  const submission = (id: M1PreconId, seat: "A" | "B"): RoomDeckSubmission => {
    const deck = buildM1Deck(id, seat);
    return {
      mainDeck: entries(deck.mainDeck),
      runes: entries(deck.runeDeck),
      legend: entries([deck.championLegend]),
      champion: entries([deck.chosenChampion]),
      battlefields: entries(deck.battlefields),
    };
  };
  return [submission("rumble-sfd", "A"), submission("fiora-sfd", "B")];
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

function assertPrivateProjection(value: V2Projection, viewerPlayerId: string, opponentPlayerId: string): void {
  expect(value.viewerPlayerId).toBe(viewerPlayerId);
  expect(value.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === opponentPlayerId)?.objects)
    .toBeUndefined();
  expect(value.objects.filter(object => object.ownerPlayerId === opponentPlayerId && object.faceDown)
    .every(object => object.cardId === undefined && object.name === undefined)).toBe(true);
  expect(value.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === viewerPlayerId)?.objects
    ?.every(object => object.cardId !== undefined)).toBe(true);
}

describe("protocol v2 engine runtime over WebSocket", () => {
  it("creates, resumes and restores a private two-client match", async () => {
    const directory = await mkdtemp(path.join("/tmp", "rift-350-v2-"));
    directories.push(directory);
    const running = await start(33040, directory);
    const [deckA, deckB] = await m1Submissions();
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
        deck: index === 0 ? deckA : deckB });
      roomVersion = (await client.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === `deck-${index}`)).roomVersion;
      client.send({ type: "set-ready", requestId: `ready-${index}`, expectedRoomVersion: roomVersion, ready: true });
      roomVersion = (await client.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === `ready-${index}`)).roomVersion;
    }

    const [viewA, viewB] = await Promise.all([projection(alice), projection(bob)]);
    assertPrivateProjection(viewA, sessionA.playerId, sessionB.playerId);
    assertPrivateProjection(viewB, sessionB.playerId, sessionA.playerId);

    let views: readonly [V2Projection, V2Projection] = [viewA, viewB];
    let receipt: any;
    let lastPass: any;
    let lastActor: Client;
    for (let turn = 0; turn < 6; turn += 1) {
      const actor = views[0]!.activePlayerId === sessionA.playerId ? alice : bob;
      const actorView = views[0]!.activePlayerId === sessionA.playerId ? views[0]! : views[1]!;
      const pass = { type: "command", protocolVersion: PROTOCOL_V2_VERSION,
        command: { type: "pass", commandId: `v2-pass-${turn}`, stateVersion: actorView.stateVersion } } as const;
      actor.send(pass);
      receipt = await actor.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "command-receipt" &&
        (value as { commandId?: unknown }).commandId === `v2-pass-${turn}`);
      expect(receipt).toMatchObject({ accepted: true, duplicate: false, stateVersion: actorView.stateVersion + 1 });
      lastPass = pass;
      lastActor = actor;
      views = await Promise.all([projection(alice), projection(bob)]) as [V2Projection, V2Projection];
      assertPrivateProjection(views[0]!, sessionA.playerId, sessionB.playerId);
      assertPrivateProjection(views[1]!, sessionB.playerId, sessionA.playerId);
    }
    expect(views[0]!.turnNumber).toBeGreaterThan(1);
    const beforeReconnect: readonly [V2Projection, V2Projection] = [structuredClone(views[0]), structuredClone(views[1])];

    await alice.close();
    const resumed = await connect(running.url,
      lastActor === alice ? sessionA : sessionB, receipt.eventSeq);
    const resumedProjection = await projection(resumed);
    expect(resumedProjection).toEqual(lastActor === alice ? beforeReconnect[0] : beforeReconnect[1]);
    assertPrivateProjection(resumedProjection, lastActor === alice ? sessionA.playerId : sessionB.playerId,
      lastActor === alice ? sessionB.playerId : sessionA.playerId);
    resumed.send(lastPass);
    const replayed = await resumed.wait(value => isV2CommandReceipt(value) &&
      value.commandId === lastPass.command.commandId);
    expect(replayed).toMatchObject({ accepted: true, duplicate: true, stateVersion: receipt.stateVersion });
    expect(replayed.rejection).toBeNull();

    await bob.close();
    await resumed.close();
    await running.server.stop();
    const restarted = await start(33040, directory);
    const [restoredA, restoredB] = await Promise.all([
      connect(restarted.url, sessionA, receipt.eventSeq),
      connect(restarted.url, sessionB, receipt.eventSeq)
    ]);
    const restoredViews = await Promise.all([projection(restoredA), projection(restoredB)]);
    expect(restoredViews[0]).toEqual(beforeReconnect[0]);
    expect(restoredViews[1]).toEqual(beforeReconnect[1]);
    assertPrivateProjection(restoredViews[0]!, sessionA.playerId, sessionB.playerId);
    assertPrivateProjection(restoredViews[1]!, sessionB.playerId, sessionA.playerId);
    const restoredActor = lastActor === alice ? restoredA : restoredB;
    restoredActor.send(lastPass);
    const recoveredDuplicate = await restoredActor.wait(value => isV2CommandReceipt(value) &&
      value.commandId === lastPass.command.commandId);
    expect(recoveredDuplicate).toMatchObject({ accepted: true, duplicate: true, stateVersion: receipt.stateVersion });
    expect(recoveredDuplicate.rejection).toBeNull();
  }, 120_000);
});

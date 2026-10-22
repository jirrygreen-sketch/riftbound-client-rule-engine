import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { DUEL_RULESET_ID, type ClientSession, type RoomDeckSubmission } from "@riftbound/protocol";
import {
  PROTOCOL_V2_VERSION,
  isV2CommandReceipt,
  isV2Projection,
  type V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";
import { createGameServer, type GameServer } from "../../src/server.js";
import { FileRoomStore } from "../../src/file-room-store.js";
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
  async wait(predicate: (value: unknown) => boolean, rejectAnyError = true): Promise<any> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const error = this.messages.find(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "error");
      if (error && rejectAnyError) throw new Error(`v2 operation failed: ${JSON.stringify(error)}`);
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for v2 message; received ${this.messages.map(value =>
      typeof value === "object" && value !== null && "type" in value ? (value as { type: unknown }).type : "unknown").join(", ")}`);
  }
  discardErrors(): unknown[] {
    const errors: unknown[] = [];
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const value = this.messages[index];
      if (value !== null && typeof value === "object" && (value as { type?: unknown }).type === "error") {
        errors.unshift(...this.messages.splice(index, 1));
      }
    }
    return errors;
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.once("close", resolve); this.socket.close(); });
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  for (const server of servers.splice(0)) await server.stop();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function start(port: number, storageDirectory?: string) {
  const server = createGameServer({ port, storageDirectory, roomIdFactory: () => "r861-rune-room",
    duelRandomIndex: () => 0 });
  servers.push(server);
  await server.start();
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

async function startWithStore(port: number, storageDirectory: string, store: FileRoomStore) {
  const server = createGameServer({ port, storageDirectory, roomStore: store, roomIdFactory: () => "r861-rune-room",
    duelRandomIndex: () => 0 });
  servers.push(server);
  await server.start();
  return { server, url: `ws://127.0.0.1:${port}/ws` };
}

async function submissions(): Promise<readonly [RoomDeckSubmission, RoomDeckSubmission]> {
  const catalog = await loadCardCatalogRuntime();
  const printingByCanonical = new Map(catalog.publicCatalog.cards.map(card => [card.canonicalCardId, card.id] as const));
  const entries = (cards: readonly { readonly canonicalCardId: string }[]) => {
    const quantities = new Map<string, number>();
    for (const card of cards) quantities.set(card.canonicalCardId, (quantities.get(card.canonicalCardId) ?? 0) + 1);
    return [...quantities].map(([canonicalCardId, quantity]) => {
      const printing = printingByCanonical.get(canonicalCardId);
      if (!printing) throw new Error(`No printing for ${canonicalCardId}`);
      return { cardId: printing, quantity };
    });
  };
  const submission = (id: M1PreconId, seat: "A" | "B"): RoomDeckSubmission => {
    const deck = buildM1Deck(id, seat);
    return {
      mainDeck: entries(deck.mainDeck), runes: entries(deck.runeDeck),
      legend: entries([deck.championLegend]), champion: entries([deck.chosenChampion]),
      battlefields: entries(deck.battlefields),
    };
  };
  return [submission("rumble-sfd", "A"), submission("fiora-sfd", "B")];
}

async function connect(url: string, session?: ClientSession, afterEventSeq?: number) {
  const socket = new WebSocket(url); sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const client = new Client(socket);
  client.send({ type: "hello", protocolVersion: PROTOCOL_V2_VERSION,
    ...(session ? { roomId: session.roomId, resumeToken: session.resumeToken, afterEventSeq } : {}) });
  const welcome = await client.wait(value => value !== null && typeof value === "object" &&
    ((value as { type?: unknown }).type === "welcome" || (value as { type?: unknown }).type === "error"));
  if ((welcome as { type?: unknown }).type === "error") throw new Error(`v2 handshake failed: ${JSON.stringify(welcome)}`);
  return client;
}

async function projection(client: Client, minimumStateVersion = -1): Promise<V2Projection> {
  const message = await client.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "projection" &&
    ((value as { projection?: { stateVersion?: number } }).projection?.stateVersion ?? -1) >= minimumStateVersion);
  const value = (message as { projection: unknown }).projection;
  if (!isV2Projection(value)) throw new Error("Invalid projection");
  return value;
}

async function syncAt(client: Client, clientSession: ClientSession, requestId: string,
  minimumStateVersion: number): Promise<V2Projection> {
  client.send({ type: "sync-events", requestId, afterEventSeq: 0 });
  await client.wait(value => (value as { type?: unknown }).type === "request-result" &&
    (value as { requestId?: unknown }).requestId === requestId);
  return projection(client, minimumStateVersion);
}

async function pair(port: number, storageDirectory?: string, roomStore?: FileRoomStore) {
  const running = roomStore === undefined
    ? await start(port, storageDirectory)
    : await startWithStore(port, storageDirectory!, roomStore);
  const [deckA, deckB] = await submissions();
  const alice = await connect(running.url);
  alice.send({ type: "create-room", requestId: "create", playerName: "Alice", rulesetId: DUEL_RULESET_ID });
  const sessionA = ((await alice.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "welcome" && "session" in value)) as { session: ClientSession }).session;
  await alice.wait(value => (value as { type?: unknown }).type === "request-result" &&
    (value as { requestId?: unknown }).requestId === "create");
  const bob = await connect(running.url);
  bob.send({ type: "join-room", requestId: "join", roomId: sessionA.roomId, playerName: "Bob" });
  const sessionB = ((await bob.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "welcome" && "session" in value)) as { session: ClientSession }).session;
  await bob.wait(value => (value as { type?: unknown }).type === "request-result" &&
    (value as { requestId?: unknown }).requestId === "join");
  const room = running.server.rooms.get(sessionA.roomId)!;
  let version = room.currentRoomVersion;
  for (const [index, client] of [alice, bob].entries()) {
    client.send({ type: "submit-deck", requestId: `deck-${index}`, expectedRoomVersion: version,
      deck: index === 0 ? deckA : deckB });
    version = (await client.wait(value => (value as { type?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === `deck-${index}`)).roomVersion;
    client.send({ type: "set-ready", requestId: `ready-${index}`, expectedRoomVersion: version, ready: true });
    version = (await client.wait(value => (value as { type?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === `ready-${index}`)).roomVersion;
  }
  return { ...running, room, alice, bob, sessionA, sessionB };
}

function receipt(client: Client, commandId: string) {
  return client.wait(value => isV2CommandReceipt(value) && value.commandId === commandId);
}

async function sync(client: Client, session: ClientSession, requestId: string): Promise<void> {
  client.send({ type: "sync-events", requestId, afterEventSeq: 0 });
  await client.wait(value => (value as { type?: unknown }).type === "request-result" &&
    (value as { requestId?: unknown }).requestId === requestId);
}

// Core Rules v1.5 (2026-10-09):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 164.2, 166.1, 312.1.a, 357.1.a, 430.2.a, 430.3.
// Bubble Bot canonical: card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389.
// Mind/Fury Rune canonical IDs match the focused runtime source header above.
describe("default createGameServer v2 Rune resource path", () => {
  it("activates real Rune Energy through the default public room and persists the ACK across restart", async () => {
    const port = 36060;
    const taskDirectory = path.join("/tmp", process.env.SWARM_TASK ?? "RIFT-861-eg-v2-rune-runtime");
    await mkdir(taskDirectory, { recursive: true });
    const directory = await mkdtemp(path.join(taskDirectory, "v2-rune-"));
    directories.push(directory);
    const running = await pair(port, directory);
    await Promise.all([sync(running.alice, running.sessionA, "sync-a0"),
      sync(running.bob, running.sessionB, "sync-b0")]);
    const [a0, b0] = await Promise.all([projection(running.alice), projection(running.bob)]);
    expect(a0.viewerPlayerId).toBe(running.sessionA.playerId);
    expect(b0.viewerPlayerId).toBe(running.sessionB.playerId);
    expect(a0.phase).toBe("main");
    expect(b0.phase).toBe("main");
    const actorIsAlice = a0.activePlayerId === running.sessionA.playerId;
    const actor = actorIsAlice ? running.alice : running.bob;
    const viewer = actorIsAlice ? a0 : b0;
    const ownerPlayerId = viewer.viewerPlayerId!;
    const opponent = actorIsAlice ? running.bob : running.alice;
    const opponentView = actorIsAlice ? b0 : a0;
    expect(opponentView.players.find(player => player.playerId === ownerPlayerId)?.energy).toBe(0);
    expect(viewer.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === ownerPlayerId)?.objects?.length).toBeGreaterThan(0);
    expect(opponentView.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === ownerPlayerId)?.objects).toBeUndefined();
    for (const advanced of [0, 1]) {
      const current = await projection(actor);
      const active = current.activePlayerId;
      const next = active === running.sessionA.playerId ? running.alice : running.bob;
      next.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
        command: { type: "pass", commandId: `advance-from-current-${advanced}`, stateVersion: current.stateVersion } });
      await receipt(next, `advance-from-current-${advanced}`);
      await Promise.all([sync(running.alice, running.sessionA, `sync-a-${advanced}`),
        sync(running.bob, running.sessionB, `sync-b-${advanced}`)]);
      await Promise.all([projection(running.alice), projection(running.bob)]);
    }
    const ready = await projection(actor);
    const rune = ready.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === ownerPlayerId)
      ?.objects?.find(object => object.exhausted === false);
    expect(rune).toBeTruthy();
    if (!rune) throw new Error("Ready Rune required");
    const runeCommand = {
      type: "command" as const,
      protocolVersion: PROTOCOL_V2_VERSION,
      command: {
        type: "rune-energy" as const,
        commandId: "durable-rune-energy",
        stateVersion: ready.stateVersion,
        runeObjectId: rune.objectId,
        zoneEntryId: rune.zoneEntryId!,
      },
    };
    actor.send(runeCommand);
    const accepted = await receipt(actor, "durable-rune-energy");
    expect(accepted).toMatchObject({ accepted: true, duplicate: false, stateVersion: ready.stateVersion + 1 });
    await Promise.all([sync(running.alice, running.sessionA, "sync-after-rune-a"),
      sync(running.bob, running.sessionB, "sync-after-rune-b")]);
    const [afterA, afterB] = await Promise.all([
      projection(running.alice, accepted.stateVersion),
      projection(running.bob, accepted.stateVersion),
    ]);
    const currentViewer = ownerPlayerId === afterA.viewerPlayerId ? afterA : afterB;
    const currentOpponent = currentViewer === afterA ? afterB : afterA;
    expect(currentViewer.players.find(player => player.playerId === ownerPlayerId)?.energy).toBe(1);
    // Resource totals are public; the opponent projection must still hide the
    // Rune Zone order/identity and hand identities.
    expect(currentOpponent.players.find(player => player.playerId === ownerPlayerId)?.energy).toBe(1);
    const spentRune = currentViewer.objects.find(object => object.objectId === rune.objectId);
    expect(spentRune?.exhausted).toBe(true);

    await actor.send(runeCommand);
    expect(await receipt(actor, "durable-rune-energy"))
      .toMatchObject({ accepted: true, duplicate: true, stateVersion: accepted.stateVersion });
    await actor.close();
    await opponent.close();
    await running.server.stop();
    const restarted = await start(port, directory);
    const resumed = await connect(restarted.url,
      actorIsAlice ? running.sessionA : running.sessionB, accepted.eventSeq);
    const restored = await projection(resumed);
    expect(restored).toEqual(currentViewer);
    resumed.send(runeCommand);
    expect(await receipt(resumed, "durable-rune-energy"))
      .toMatchObject({ accepted: true, duplicate: true, stateVersion: accepted.stateVersion });
  }, 180_000);

  it("rejects unknown and actor-injected Rune commands at the public transport", async () => {
    const port = 36061;
    const running = await pair(port);
    // Wait for both authenticated room sessions before staging a transport
    // rejection; a projection is not required for the malformed packet.
    running.alice.discardErrors();
    running.alice.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "rune-energy", commandId: "forged-rune", stateVersion: 0,
        runeObjectId: "forged", zoneEntryId: 0, playerId: running.sessionB.playerId } });
    const rejected = await running.alice.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "error" &&
      (value as { code?: unknown }).code === "protocol-error", false);
    expect(rejected).toMatchObject({ code: "protocol-error" });
  }, 120_000);

  it("uses real Rune Energy to pay a real hand card in the active player's Main", async () => {
    const port = 36063;
    const running = await pair(port);
    await Promise.all([sync(running.alice, running.sessionA, "sync-pay-a0"),
      sync(running.bob, running.sessionB, "sync-pay-b0")]);
    let [viewA, viewB] = await Promise.all([projection(running.alice), projection(running.bob)]);
    let actorIsAlice = false;
    let actor = running.alice;
    let view = viewA;
    let card: V2Projection["objects"][number] | undefined;
    for (let index = 0; index < 8; index += 1) {
      actorIsAlice = viewA.activePlayerId === running.sessionA.playerId;
      actor = actorIsAlice ? running.alice : running.bob;
      view = actorIsAlice ? viewA : viewB;
      // Each prior turn completed only after both projections were synced to
      // its accepted receipt clock; the selected hand is therefore current.
      const ownerPlayerId = view.viewerPlayerId!;
      card = view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === ownerPlayerId)
        ?.objects?.find(object => object.name === "Bubble Bot");
      if (card && view.turnNumber >= 5) break;
      actor.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
        command: { type: "pass", commandId: `pay-main-advance-${index}`, stateVersion: view.stateVersion } });
      await receipt(actor, `pay-main-advance-${index}`);
      const currentVersion = view.stateVersion + 1;
      [viewA, viewB] = await Promise.all([
        syncAt(running.alice, running.sessionA, `sync-pay-a${index + 1}`, currentVersion),
        syncAt(running.bob, running.sessionB, `sync-pay-b${index + 1}`, currentVersion),
      ]);
    }
    expect(card).toBeTruthy();
    const ownerPlayerId = view.viewerPlayerId!;
    const requiredEnergy = 3;
    let stateVersion = view.stateVersion;
    for (let index = 0; index < requiredEnergy; index += 1) {
      const current = view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === ownerPlayerId)
        ?.objects?.find(object => object.exhausted === false);
      expect(current, `Ready Rune ${index + 1} required`).toBeTruthy();
      actor.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
        command: { type: "rune-energy", commandId: `pay-rune-energy-${index}`, stateVersion,
          runeObjectId: current!.objectId, zoneEntryId: current!.zoneEntryId! } });
      const result = await receipt(actor, `pay-rune-energy-${index}`);
      expect(result, JSON.stringify(result)).toMatchObject({ accepted: true, duplicate: false });
      stateVersion = result.stateVersion;
      const [nextA, nextB] = await Promise.all([
        projection(running.alice, stateVersion),
        projection(running.bob, stateVersion),
      ]);
      view = actorIsAlice ? nextA : nextB;
    }
    actor.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "play", commandId: "pay-real-hand-card", stateVersion, cardObjectId: card!.objectId } });
    const played = await receipt(actor, "pay-real-hand-card");
    expect(played, JSON.stringify(played)).toMatchObject({ accepted: true, duplicate: false });
    await Promise.all([sync(running.alice, running.sessionA, "sync-paid-a"),
      sync(running.bob, running.sessionB, "sync-paid-b")]);
    const [paidA, paidB] = await Promise.all([
      projection(running.alice, played.stateVersion), projection(running.bob, played.stateVersion),
    ]);
    const paid = actorIsAlice ? paidA : paidB;
    expect(paid.players.find(player => player.playerId === ownerPlayerId)?.energy).toBe(0);
    // Unit/Gear enter their Board location and resolve immediately. Their
    // absence from Chain after Finalize/Resolve is the authoritative result;
    // the card and its real cost must no longer be in the paying hand/pool.
    expect(paid.objects.find(object => object.objectId === card!.objectId)).toMatchObject({
      zone: "board",
      location: { kind: "base", playerId: ownerPlayerId },
    });
    expect(paid.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === ownerPlayerId)
      ?.objects?.some(object => object.objectId === card!.objectId)).toBe(false);
    expect(paid.pendingChoice).toEqual({ status: "none" });
  }, 180_000);

  it("rolls a Rune command back when the durable room write fails and retries exactly once", async () => {
    const port = 36062;
    const taskDirectory = path.join("/tmp", process.env.SWARM_TASK ?? "RIFT-861-eg-v2-rune-runtime");
    await mkdir(taskDirectory, { recursive: true });
    const directory = await mkdtemp(path.join(taskDirectory, "v2-rune-store-fail-"));
    directories.push(directory);
    const catalog = await loadCardCatalogRuntime();
    class FailingStore extends FileRoomStore {
      failNext = false;
      override async save(room: Parameters<FileRoomStore["save"]>[0]) {
        if (this.failNext) { this.failNext = false; throw new Error("rune metadata write failed"); }
        return super.save(room);
      }
    }
    const store = new FailingStore(directory, async () => catalog);
    const running = await pair(port, directory, store);
    await Promise.all([sync(running.alice, running.sessionA, "sync-fail-a0"),
      sync(running.bob, running.sessionB, "sync-fail-b0")]);
    let [viewA, viewB] = await Promise.all([projection(running.alice), projection(running.bob)]);
    // Six passes reach A's third Main. Previously channeled Runes have been
    // readied by Awaken, while the unspent prior pool is empty.
    for (const index of [0, 1, 2, 3, 4, 5]) {
      const view = viewA.activePlayerId === running.sessionA.playerId ? viewA : viewB;
      const client = view.activePlayerId === running.sessionA.playerId ? running.alice : running.bob;
      client.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
        command: { type: "pass", commandId: `fail-advance-${index}`, stateVersion: view.stateVersion } });
      await receipt(client, `fail-advance-${index}`);
      await Promise.all([sync(running.alice, running.sessionA, `sync-fail-a${index + 1}`),
        sync(running.bob, running.sessionB, `sync-fail-b${index + 1}`)]);
      [viewA, viewB] = await Promise.all([projection(running.alice), projection(running.bob)]);
    }
    const actorIsAlice = viewA.activePlayerId === running.sessionA.playerId;
    const actor = actorIsAlice ? running.alice : running.bob;
    const view = actorIsAlice ? viewA : viewB;
    const ownerPlayerId = view.viewerPlayerId!;
    const rune = view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === ownerPlayerId)
      ?.objects?.find(object => object.exhausted === false);
    expect(rune).toBeTruthy();
    const command = { type: "command" as const, protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "rune-energy" as const, commandId: "rune-storage-failure",
        stateVersion: view.stateVersion, runeObjectId: rune!.objectId, zoneEntryId: rune!.zoneEntryId! } };
    store.failNext = true;
    actor.send(command);
    const failed = await actor.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "error" &&
      /rune metadata write failed/.test(String((value as { message?: unknown }).message)), false);
    expect(failed).toMatchObject({ code: "command-rejected", message: "rune metadata write failed" });
    actor.discardErrors();
    await Promise.all([sync(running.alice, running.sessionA, "sync-rollback-a"),
      sync(running.bob, running.sessionB, "sync-rollback-b")]);
    const [rolledA, rolledB] = await Promise.all([projection(running.alice), projection(running.bob)]);
    const rolled = actorIsAlice ? rolledA : rolledB;
    expect(rolled).toEqual(view);
    expect(rolled.objects.find(object => object.objectId === rune!.objectId)?.exhausted).toBe(false);
    expect(rolled.players.find(player => player.playerId === ownerPlayerId)?.energy).toBe(0);
    actor.send(command);
    const retried = await receipt(actor, "rune-storage-failure");
    expect(retried).toMatchObject({ accepted: true, duplicate: false,
      stateVersion: view.stateVersion + 1 });
    await Promise.all([sync(running.alice, running.sessionA, "sync-retry-a"),
      sync(running.bob, running.sessionB, "sync-retry-b")]);
    const [retriedA, retriedB] = await Promise.all([
      projection(running.alice, retried.stateVersion),
      projection(running.bob, retried.stateVersion),
    ]);
    const committed = actorIsAlice ? retriedA : retriedB;
    expect(committed.players.find(player => player.playerId === ownerPlayerId)?.energy).toBe(1);
    expect(committed.objects.find(object => object.objectId === rune!.objectId)?.exhausted).toBe(true);
    actor.send(command);
    expect(await receipt(actor, "rune-storage-failure"))
      .toMatchObject({ accepted: true, duplicate: true, stateVersion: retried.stateVersion });
    const [duplicateA, duplicateB] = await Promise.all([
      projection(running.alice, retried.stateVersion),
      projection(running.bob, retried.stateVersion),
    ]);
    const afterDuplicate = actorIsAlice ? duplicateA : duplicateB;
    expect(afterDuplicate.players.find(player => player.playerId === ownerPlayerId)?.energy).toBe(1);
  }, 180_000);
});

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";

const servers: GameServer[] = [];
const sockets: WebSocket[] = [];
const directories: string[] = [];

class Client {
  readonly messages: unknown[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", raw => this.messages.push(JSON.parse(String(raw))));
  }

  send(value: unknown) { this.socket.send(JSON.stringify(value)); }

  discardProjections(): void {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const value = this.messages[index];
      if (value !== null && typeof value === "object" &&
          (value as { type?: unknown }).type === "projection") this.messages.splice(index, 1);
    }
  }

  async wait(predicate: (value: unknown) => boolean): Promise<any> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for v2 message; received ${JSON.stringify(this.messages)}`);
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

async function projection(client: Client, minimumStateVersion = -1,
  expectedPhase?: V2Projection["phase"]): Promise<V2Projection> {
  const message = await client.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "projection" &&
    ((value as { projection?: { stateVersion?: number } }).projection?.stateVersion ?? -1) >= minimumStateVersion &&
    (expectedPhase === undefined ||
      (value as { projection?: { phase?: unknown } }).projection?.phase === expectedPhase));
  const value = (message as { projection: unknown }).projection;
  if (!isV2Projection(value)) throw new Error("Invalid protocol v2 projection");
  if (expectedPhase !== undefined) client.discardProjections();
  return value;
}

async function resync(client: Client, requestId: string, afterEventSeq?: number): Promise<void> {
  client.send({ type: "sync-events", requestId,
    ...(afterEventSeq === undefined ? {} : { afterEventSeq }) });
  await client.wait(value => value !== null && typeof value === "object" &&
    (value as { type?: unknown }).type === "request-result" &&
    (value as { requestId?: unknown }).requestId === requestId);
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
  it("resumes a waiting-room seat before setup and immediately after both preset decks start the match", async () => {
    const port = Number(process.env.SWARM_PORT_BASE ?? 33800);
    const taskDirectory = path.join("/tmp", process.env.SWARM_TASK ?? "RIFT-1021-v2-waiting-room-resume-loop");
    await mkdir(taskDirectory, { recursive: true });
    const directory = await mkdtemp(path.join(taskDirectory, "v2-waiting-"));
    directories.push(directory);
    const running = await start(port, directory);
    const alice = await connect(running.url);
    alice.send({ type: "create-room", requestId: "waiting-create", playerName: "Alice", rulesetId: DUEL_RULESET_ID });
    const createdWelcome = await alice.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "welcome" && "session" in value);
    const session = (createdWelcome as { session: ClientSession }).session;
    await alice.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "waiting-create");
    await alice.close();

    const resumedWithoutCursor = await connect(running.url, session);
    const resumedWithoutCursorRoom = await resumedWithoutCursor.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "room");
    expect(resumedWithoutCursorRoom).toMatchObject({ room: { roomId: session.roomId, status: "waiting" } });
    expect(resumedWithoutCursor.messages).toContainEqual(expect.objectContaining({
      type: "owner-deck-confirmation", roomId: session.roomId,
      playerId: session.playerId, deck: null
    }));

    const bob = await connect(running.url);
    bob.send({ type: "join-room", requestId: "waiting-join", roomId: session.roomId, playerName: "Bob" });
    const bobWelcome = await bob.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "welcome" && "session" in value);
    const bobSession = (bobWelcome as { session: ClientSession }).session;
    await bob.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "waiting-join");
    expect(bobSession.playerId).toBe("player-2");
    expect(running.server.rooms.get(session.roomId)!.status).toBe("waiting");

    await bob.close();
    const resumedWithZero = await connect(running.url, session, 0);
    const resumedWithZeroRoom = await resumedWithZero.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "room");
    expect(resumedWithZeroRoom).toMatchObject({ room: { roomId: session.roomId, status: "waiting" } });
    expect(resumedWithZero.messages.some(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "projection")).toBe(false);
    await resumedWithZero.close();
    const aliceActive = await connect(running.url, session);
    const bobResumed = await connect(running.url, bobSession);

    const [deckA, deckB] = await m1Submissions();
    let roomVersion = running.server.rooms.get(session.roomId)!.currentRoomVersion;
    aliceActive.send({ type: "submit-deck", requestId: "waiting-deck-a",
      expectedRoomVersion: roomVersion, deck: deckA });
    roomVersion = (await aliceActive.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "waiting-deck-a")).roomVersion;
    bobResumed.send({ type: "submit-deck", requestId: "waiting-deck-b",
      expectedRoomVersion: roomVersion, deck: deckB });
    roomVersion = (await bobResumed.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "waiting-deck-b")).roomVersion;
    aliceActive.send({ type: "set-ready", requestId: "waiting-ready-a",
      expectedRoomVersion: roomVersion, ready: true });
    roomVersion = (await aliceActive.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "waiting-ready-a")).roomVersion;
    bobResumed.send({ type: "set-ready", requestId: "waiting-ready-b",
      expectedRoomVersion: roomVersion, ready: true });
    await bobResumed.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "waiting-ready-b");
    aliceActive.send({ type: "sync-events", requestId: "waiting-setup-sync-a", afterEventSeq: 0 });
    bobResumed.send({ type: "sync-events", requestId: "waiting-setup-sync-b", afterEventSeq: 0 });
    await Promise.all([
      aliceActive.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === "waiting-setup-sync-a"),
      bobResumed.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === "waiting-setup-sync-b"),
    ]);
    const setupA = await projection(aliceActive, -1, "setup");
    const setupB = await projection(bobResumed, -1, "setup");
    expect(setupA.phase).toBe("setup");
    expect(setupB.phase).toBe("setup");
    const first = setupA.activePlayerId === session.playerId ? aliceActive : bobResumed;
    const second = first === aliceActive ? bobResumed : aliceActive;
    for (const [index, actor] of [first, second].entries()) {
      const commandId = `waiting-mulligan-${index}`;
      actor.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
        command: { type: "mulligan", commandId, stateVersion: 0, selectedObjectIds: [] } });
      expect(await actor.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "command-receipt" &&
        (value as { commandId?: unknown }).commandId === commandId))
        .toMatchObject({ accepted: true, rejection: null });
    }
    // Final setup completes at stateVersion 0; the following events are the
    // real turn pipeline. Resync by event cursor instead of assuming that the
    // first command necessarily advances stateVersion to 1.
    await Promise.all([resync(aliceActive, "waiting-sync-final-a"),
      resync(bobResumed, "waiting-sync-final-b")]);
    const [startedA, startedB] = await Promise.all([
      projection(aliceActive, -1, "main"), projection(bobResumed, -1, "main"),
    ]);
    expect(running.server.rooms.get(session.roomId)!.status).toBe("playing");
    expect(startedA.phase).toBe("main");
    expect(startedB.phase).toBe("main");
    expect(startedA.viewerPlayerId).toBe(session.playerId);
    expect(startedB.viewerPlayerId).toBe(bobSession.playerId);
    const gameEventSeq = Math.max(startedA.eventSeq, startedB.eventSeq);

    await resumedWithoutCursor.close();
    await aliceActive.close();
    await bobResumed.close();
    const resumedAfterStart = await connect(running.url, session, gameEventSeq);
    const resumedProjection = await projection(resumedAfterStart);
    expect(resumedProjection.viewerPlayerId).toBe(session.playerId);
    expect(resumedProjection.stateVersion).toBe(startedA.stateVersion);
    expect(resumedProjection.eventSeq).toBe(startedA.eventSeq);
    await resumedAfterStart.close();
  }, 180_000);

  it("runs the real default entry without a runtime override and reaches the authoritative resource check", async () => {
    const cli = await readFile(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
    expect(cli).toContain("requestedRuntimeMode === undefined ? {} : { duelRuntimeMode: requestedRuntimeMode as DuelRuntimeMode }");
    expect(cli).toContain("const requestedRuntimeMode = process.env.RIFTBOUND_DUEL_RUNTIME_MODE;");
    const port = Number(process.env.SWARM_PORT_BASE ?? 33800);
    const running = await start(port);
    const client = await connect(running.url);
    client.send({ type: "create-room", requestId: "default-create", playerName: "Alice", rulesetId: DUEL_RULESET_ID });
    const welcome = await client.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "welcome" && "session" in value);
    const session = (welcome as { session: ClientSession }).session;
    const room = running.server.rooms.get(session.roomId)!;
    expect(room.runtimeMode).toBe("engine-v2");
    await client.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "default-create");
    const [deckA] = await m1Submissions();
    let roomVersion = room.currentRoomVersion;
    client.send({ type: "submit-deck", requestId: "default-deck", expectedRoomVersion: roomVersion, deck: deckA });
    roomVersion = (await client.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "default-deck")).roomVersion;
    client.send({ type: "set-ready", requestId: "default-ready", expectedRoomVersion: roomVersion, ready: true });
    await client.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "default-ready");
    expect(room.status).toBe("waiting");

    const second = await connect(running.url);
    second.send({ type: "join-room", requestId: "default-join", roomId: session.roomId, playerName: "Bob" });
    const secondWelcome = await second.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "welcome" && "session" in value);
    await second.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "default-join");
    const secondSession = (secondWelcome as { session: ClientSession }).session;
    const [, deckB] = await m1Submissions();
    roomVersion = room.currentRoomVersion;
    second.send({ type: "submit-deck", requestId: "default-deck-b", expectedRoomVersion: roomVersion, deck: deckB });
    roomVersion = (await second.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "default-deck-b")).roomVersion;
    second.send({ type: "set-ready", requestId: "default-ready-b", expectedRoomVersion: roomVersion, ready: true });
    await second.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown; requestId?: unknown }).type === "request-result" &&
      (value as { requestId?: unknown }).requestId === "default-ready-b");
    // Drain any waiting-room fan-out packet before matching the setup projection.
    await new Promise(resolve => setTimeout(resolve, 20));
    client.send({ type: "sync-events", requestId: "default-setup-sync-a" });
    second.send({ type: "sync-events", requestId: "default-setup-sync-b" });
    await Promise.all([
      client.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === "default-setup-sync-a"),
      second.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "request-result" &&
        (value as { requestId?: unknown }).requestId === "default-setup-sync-b"),
    ]);
    const setupA = await projection(client, -1, "setup");
    const setupB = await projection(second, -1, "setup");
    expect(setupA.phase).toBe("setup");
    expect(setupB.phase).toBe("setup");
    const first = setupA.activePlayerId === session.playerId ? client : second;
    const follow = first === client ? second : client;
    for (const [index, actor] of [first, follow].entries()) {
      const commandId = `default-mulligan-${index}`;
      actor.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
        command: { type: "mulligan", commandId, stateVersion: 0, selectedObjectIds: [] } });
      await actor.wait(value => value !== null && typeof value === "object" &&
        (value as { type?: unknown }).type === "command-receipt" &&
        (value as { commandId?: unknown }).commandId === commandId);
    }
    await Promise.all([resync(client, "default-sync-final-a"), resync(second, "default-sync-final-b")]);
    const [defaultViewA, defaultViewB] = await Promise.all([
      projection(client, -1, "main"), projection(second, -1, "main"),
    ]);
    expect(defaultViewA.viewerPlayerId).toBe(session.playerId);
    expect(defaultViewB.viewerPlayerId).toBe(secondSession.playerId);
    expect(defaultViewA.phase).toBe("main");
    expect(defaultViewB.phase).toBe("main");
    const handObject = defaultViewA.zones.find(zone => zone.zone === "hand" &&
      zone.ownerPlayerId === session.playerId)?.objects?.find(object =>
      object.cardId !== undefined && cardProgramsById.get(object.cardId)?.status === "executable");
    expect(handObject?.cardId).toBeTruthy();
    const beforePlay = defaultViewA.stateVersion;
    // Protocol v2 currently has no Rune/Energy selector, so this executable
    // card reaches the authoritative cost check but cannot be paid through a
    // client command. Keep the progress blocked; never mutate host resources.
    client.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "play", commandId: "default-play-without-resource-command",
        stateVersion: beforePlay, cardObjectId: handObject!.objectId } });
    const rejectedPlay = await client.wait(value => value !== null && typeof value === "object" &&
      (value as { type?: unknown }).type === "command-receipt" &&
      (value as { commandId?: unknown }).commandId === "default-play-without-resource-command");
    expect(rejectedPlay).toMatchObject({ accepted: false, duplicate: false,
      rejection: "Duel resources: insufficient Energy" });
    const afterPlay = await projection(client);
    expect(afterPlay.stateVersion).toBe(beforePlay);
  }, 120_000);

  it("creates, resumes and restores a private two-client match", async () => {
    const port = Number(process.env.SWARM_PORT_BASE ?? 33800);
    const taskDirectory = path.join("/tmp", process.env.SWARM_TASK ?? "RIFT-350-server-cutover-engine-runtime");
    await mkdir(taskDirectory, { recursive: true });
    const directory = await mkdtemp(path.join(taskDirectory, "v2-"));
    directories.push(directory);
    const running = await start(port, directory);
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
    const restarted = await start(port, directory);
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

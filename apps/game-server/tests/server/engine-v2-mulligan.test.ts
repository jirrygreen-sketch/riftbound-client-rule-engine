import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DUEL_RULESET_ID, type ClientSession, type RoomDeckSubmission } from "@riftbound/protocol";
import {
  PROTOCOL_V2_VERSION,
  isV2CommandReceipt,
  isV2Projection,
  type V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";
import { createGameServer, type GameServer } from "../../src/server.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { buildM1Deck, type M1PreconId } from "../../../../packages/integration-tests/src/headless/decks.js";

const servers: GameServer[] = [];
const sockets: WebSocket[] = [];
let roomNumber = 0;

class Client {
  readonly messages: unknown[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on("message", raw => this.messages.push(JSON.parse(String(raw))));
  }

  send(value: unknown): void { this.socket.send(JSON.stringify(value)); }

  discardProjections(): void {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const value = this.messages[index];
      if (value !== null && typeof value === "object" &&
          (value as { type?: unknown }).type === "projection") this.messages.splice(index, 1);
    }
  }

  async wait(predicate: (value: any) => boolean, timeoutMs = 90_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out; received ${JSON.stringify(this.messages)}`);
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.once("close", resolve); this.socket.close(); });
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  for (const server of servers.splice(0)) await server.stop();
});

function taskPort(): number {
  const port = Number(process.env.SWARM_PORT_BASE);
  if (!Number.isInteger(port) || port < 34100 || port > 34119) {
    throw new Error("SWARM_PORT_BASE must be within the assigned 34100-34119 range");
  }
  return port;
}

async function start(): Promise<{ readonly url: string; readonly server: GameServer }> {
  const roomId = `mulligan-real-${++roomNumber}`;
  const port = taskPort();
  const server = createGameServer({
    port,
    roomIdFactory: () => roomId,
    // A fixed battlefield RNG keeps the approved battlefield selection stable.
    duelRandomIndex: () => 0,
  });
  servers.push(server);
  await server.start();
  return { url: `ws://127.0.0.1:${port}/ws`, server };
}

async function connect(url: string): Promise<Client> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client = new Client(socket);
  client.send({ type: "hello", protocolVersion: PROTOCOL_V2_VERSION });
  await client.wait(value => value?.type === "welcome");
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
      if (!printing) throw new Error(`No catalog printing for ${canonicalCardId}`);
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

async function projection(client: Client, minimumStateVersion = -1): Promise<V2Projection> {
  const message = await client.wait(value => value?.type === "projection" &&
    (value.projection?.stateVersion ?? -1) >= minimumStateVersion);
  if (!isV2Projection(message.projection)) throw new Error("Invalid V2 projection");
  return message.projection;
}

async function syncProjection(client: Client, requestId: string): Promise<V2Projection> {
  client.discardProjections();
  client.send({ type: "sync-events", requestId });
  await client.wait(value => value?.type === "request-result" && value.requestId === requestId);
  return projection(client);
}

async function readyPair(url: string) {
  const [deckA, deckB] = await submissions();
  const alice = await connect(url);
  alice.send({ type: "create-room", requestId: "create", playerName: "Alice", rulesetId: DUEL_RULESET_ID });
  const sessionA = ((await alice.wait(value => value?.type === "welcome" && value.session !== undefined)) as {
    readonly session: ClientSession
  }).session;
  const bob = await connect(url);
  bob.send({ type: "join-room", requestId: "join", playerName: "Bob", roomId: sessionA.roomId });
  const sessionB = ((await bob.wait(value => value?.type === "welcome" && value.session !== undefined)) as {
    readonly session: ClientSession
  }).session;
  await alice.wait(value => value?.type === "request-result" && value.requestId === "create");
  await bob.wait(value => value?.type === "request-result" && value.requestId === "join");
  const server = servers.at(-1)!;
  const room = server.rooms.get(sessionA.roomId)!;
  let version = room.currentRoomVersion;
  for (const [index, client, deck] of [[0, alice, deckA], [1, bob, deckB]] as const) {
    client.send({ type: "submit-deck", requestId: `deck-${index}`, expectedRoomVersion: version, deck });
    const result = await client.wait(value => value?.type === "request-result" && value.requestId === `deck-${index}`);
    version = result.roomVersion;
    client.send({ type: "set-ready", requestId: `ready-${index}`, expectedRoomVersion: version, ready: true });
    version = (await client.wait(value => value?.type === "request-result" && value.requestId === `ready-${index}`)).roomVersion;
  }
  return { alice, bob, sessionA, sessionB, room };
}

function command(client: Client, value: Record<string, unknown>, commandId: string): void {
  client.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
    command: { ...value, commandId, stateVersion: 0 } });
}

async function receipt(client: Client, commandId: string) {
  const value = await client.wait(message => isV2CommandReceipt(message) && message.commandId === commandId);
  return value;
}

function hand(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function openedChoice(view: V2Projection) {
  expect(view.pendingChoice.status).toBe("pending");
  if (view.pendingChoice.status !== "pending") throw new Error("Expected mulligan choice");
  expect(view.pendingChoice.kind).toBe("select-objects");
  expect(view.pendingChoice.ownerPlayerId).toBe(view.viewerPlayerId);
  expect(view.pendingChoice.min).toBe(0);
  expect(view.pendingChoice.max).toBe(2);
  return view.pendingChoice;
}

describe("protocol v2 real mulligan ceremony", () => {
  it("restores a pending mulligan window and replays an accepted receipt idempotently", async () => {
    const catalog = await loadCardCatalogRuntime();
    const [deckA, deckB] = await submissions();
    const room = new GameRoom(`mulligan-restore-${++roomNumber}`, DUEL_RULESET_ID, catalog,
      () => 0, undefined, undefined, undefined, "engine-v2");
    const send = () => undefined;
    const alice = room.join("Alice", send, "restore-a");
    const bob = room.join("Bob", send, "restore-b");
    const sessionA = { roomId: room.roomId, playerId: alice.playerId, resumeToken: alice.resumeToken };
    const sessionB = { roomId: room.roomId, playerId: bob.playerId, resumeToken: bob.resumeToken };
    room.submitDeck(sessionA, alice.connectionId, room.currentRoomVersion, deckA, "restore-deck-a", send);
    room.setReady(sessionA, alice.connectionId, room.currentRoomVersion, true, "restore-ready-a", send);
    room.submitDeck(sessionB, bob.connectionId, room.currentRoomVersion, deckB, "restore-deck-b", send);
    room.setReady(sessionB, bob.connectionId, room.currentRoomVersion, true, "restore-ready-b", send);
    let setup: V2Projection | undefined;
    room.sendProjection(alice.playerId, message => { setup = (message as { projection: V2Projection }).projection; });
    expect(setup?.phase).toBe("setup");
    if (!setup || setup.pendingChoice.status !== "pending") throw new Error("Mulligan window required");
    const firstSession = setup.pendingChoice.ownerPlayerId === sessionA.playerId ? sessionA : sessionB;
    const firstConnection = firstSession === sessionA ? alice : bob;
    const command = { type: "mulligan" as const, commandId: "restore-accepted",
      stateVersion: 0, selectedObjectIds: [] };
    const receipts: unknown[] = [];
    room.submitEngineV2(firstSession, firstConnection.connectionId, command, value => receipts.push(value));
    const archive = room.exportArchive();
    expect(archive.engineMulligan).not.toBeNull();
    expect(archive.engineRuntimeJournal).toBeNull();
    const restored = GameRoom.restore(archive, catalog);
    // A pending setup archive intentionally carries no formal journal. The
    // trusted preview runtime is rebuilt by restore for internal inspection but
    // cannot be reached through the command or public projection paths until
    // both mulligans complete.
    const restoredBob = restored.reconnect(sessionB.resumeToken, send, "restored-b");
    if (!restoredBob) throw new Error("Second resume token must restore the socket binding");
    let restoredSetup: V2Projection | undefined;
    restored.sendProjection(firstSession.playerId, message => {
      restoredSetup = (message as { projection: V2Projection }).projection;
    });
    expect(restoredSetup?.phase).toBe("setup");
    const restoredConnection = restored.reconnect(firstSession.resumeToken, send, "restored-a");
    if (!restoredConnection) throw new Error("Resume token must restore the socket binding");
    restored.submitEngineV2(firstSession, restoredConnection.connectionId, command, value => receipts.push(value));
    expect(receipts[1]).toMatchObject({ commandId: command.commandId, accepted: true, duplicate: true });
    expect(restored.status).toBe("playing");
  }, 180_000);

  it("accepts keep-all and partial choices in turn order, then starts the real match without leaks", async () => {
    const { url } = await start();
    const { alice, bob, sessionA, sessionB, room } = await readyPair(url);
    const [initialA, initialB] = await Promise.all([projection(alice), projection(bob)]);
    const firstIsAlice = initialA.activePlayerId === sessionA.playerId;
    const first = firstIsAlice ? alice : bob;
    const second = firstIsAlice ? bob : alice;
    const firstSession = firstIsAlice ? sessionA : sessionB;
    const viewA = firstIsAlice ? initialA : initialB;
    const viewB = firstIsAlice ? initialB : initialA;
    expect(viewA.phase).toBe("setup");
    expect(viewB.phase).toBe("setup");
    expect(viewA.viewerPlayerId).toBe(firstSession.playerId);
    expect(hand(viewA, firstSession.playerId)).toHaveLength(4);
    expect(hand(viewB, viewB.viewerPlayerId!)).toHaveLength(4);
    expect(viewA.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === sessionB.playerId)?.objects).toBeUndefined();
    expect(viewB.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === sessionA.playerId)?.objects).toBeUndefined();

    command(first, { type: "mulligan", selectedObjectIds: [] }, "keep-all");
    await expect(receipt(first, "keep-all")).resolves.toMatchObject({ accepted: true, rejection: null });

    const waitingFirst = firstIsAlice ? await projection(alice, 0) : await projection(bob, 0);
    expect(waitingFirst.pendingChoice).toEqual({ status: "none" });
    expect(hand(waitingFirst, firstSession.playerId)).toHaveLength(4);

    const secondSession = second === alice ? sessionA : sessionB;
    const secondView = second === alice ? await projection(alice, 0) : await projection(bob, 0);
    const secondChoice = openedChoice(secondView);
    expect(secondChoice.ownerPlayerId).toBe(secondSession.playerId);
    expect(hand(waitingFirst, firstSession.playerId)).toHaveLength(4);

    const partial = hand(secondView, secondSession.playerId)[0]!;
    command(second, { type: "mulligan", selectedObjectIds: [partial.objectId] }, "partial");
    await expect(receipt(second, "partial")).resolves.toMatchObject({ accepted: true, rejection: null });

    expect(room.status).toBe("playing");
    expect(room.exportArchive().engineRuntimeJournal).not.toBeNull();
    expect(room.exportArchive().engineMulligan).toBeNull();
    const recorded = room.exportArchive().engineRuntimeJournal?.header.setup?.mulligans;
    expect(recorded?.[firstIsAlice ? 0 : 1]).toEqual([]);
    expect(recorded?.[firstIsAlice ? 1 : 0]).toEqual([partial.cardId]);

    const finalA = await projection(alice);
    const finalB = await projection(bob);
    expect(finalA.phase).not.toBe("setup");
    expect(finalB.phase).not.toBe("setup");
    expect(finalA.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === sessionB.playerId)?.objects).toBeUndefined();
    expect(finalB.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === sessionA.playerId)?.objects).toBeUndefined();
  }, 180_000);

  it("uses the full two-card mulligan limit and records each canonical identity through real setup", async () => {
    const { url } = await start();
    const { alice, bob, sessionA, sessionB, room } = await readyPair(url);
    const [initialA, initialB] = await Promise.all([projection(alice), projection(bob)]);
    const firstIsAlice = initialA.activePlayerId === sessionA.playerId;
    const first = firstIsAlice ? alice : bob;
    const second = firstIsAlice ? bob : alice;
    const firstView = firstIsAlice ? initialA : initialB;
    const opening = hand(firstView, firstView.viewerPlayerId!);
    const selected = opening.slice(0, 2);
    expect(selected).toHaveLength(2);

    command(first, { type: "mulligan", selectedObjectIds: selected.map(card => card.objectId) }, "two-cards");
    await expect(receipt(first, "two-cards")).resolves.toMatchObject({ accepted: true, rejection: null });
    const secondView = second === alice ? await projection(alice, 0) : await projection(bob, 0);
    expect(openedChoice(secondView).ownerPlayerId).toBe(second === alice ? sessionA.playerId : sessionB.playerId);
    command(second, { type: "mulligan", selectedObjectIds: [] }, "keep-all-after-limit");
    await expect(receipt(second, "keep-all-after-limit")).resolves.toMatchObject({ accepted: true, rejection: null });

    const journal = room.exportArchive().engineRuntimeJournal;
    expect(journal).not.toBeNull();
    const recorded = journal?.header.setup?.mulligans;
    const firstIndex = firstIsAlice ? 0 : 1;
    expect(recorded?.[firstIndex]).toEqual(selected.map(card => card.cardId));
    expect(recorded?.[firstIndex]).toHaveLength(2);
    expect(recorded?.[firstIsAlice ? 1 : 0]).toEqual([]);
    const [finalA, finalB] = await Promise.all([
      syncProjection(alice, "after-two-final-a"),
      syncProjection(bob, "after-two-final-b"),
    ]);
    const finalView = firstIsAlice ? finalA : finalB;
    expect(finalView.phase).not.toBe("setup");
    const finalHand = hand(finalView, finalView.viewerPlayerId!);
    expect(finalHand).toHaveLength(5);
    expect(finalHand.map(card => card.objectId)).not.toEqual(expect.arrayContaining(
      selected.map(card => card.objectId)));
    expect(sessionA.playerId).not.toBe(sessionB.playerId);
  }, 180_000);

  it("rejects over-limit, foreign and stale mulligans without accepting or leaking cards", async () => {
    const { url } = await start();
    const { alice, bob, sessionA, sessionB } = await readyPair(url);
    const a0 = await projection(alice);
    const b0 = await projection(bob);
    const dueIsAlice = a0.activePlayerId === sessionA.playerId;
    const due = dueIsAlice ? alice : bob;
    const waiting = dueIsAlice ? bob : alice;
    const dueSession = dueIsAlice ? sessionA : sessionB;
    const dueView = dueIsAlice ? a0 : b0;
    const handCards = hand(dueView, dueSession.playerId);
    expect(handCards).toHaveLength(4);

    command(due, { type: "mulligan", selectedObjectIds: handCards.slice(0, 3).map(card => card.objectId) }, "too-many");
    await expect(receipt(due, "too-many")).resolves.toMatchObject({ accepted: false });
    command(due, { type: "mulligan", selectedObjectIds: ["forged-object"] }, "foreign");
    await expect(receipt(due, "foreign")).resolves.toMatchObject({ accepted: false });
    due.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "mulligan", commandId: "stale", stateVersion: 4, selectedObjectIds: [] } });
    await expect(receipt(due, "stale")).resolves.toMatchObject({ accepted: false });

    command(waiting, { type: "mulligan", selectedObjectIds: [] }, "out-of-order");
    await expect(receipt(waiting, "out-of-order")).resolves.toMatchObject({ accepted: false });

    const unchanged = dueIsAlice ? await projection(alice, 0) : await projection(bob, 0);
    expect(unchanged.stateVersion).toBe(0);
    expect(unchanged.pendingChoice.status).toBe("pending");
    expect(hand(unchanged, dueSession.playerId)).toEqual(handCards);
  }, 180_000);

  it("rejects an out-of-order pass until both explicit mulligan answers are recorded", async () => {
    const { url } = await start();
    const { alice, bob, sessionA, sessionB, room } = await readyPair(url);
    const [viewA, viewB] = await Promise.all([projection(alice), projection(bob)]);
    const firstIsAlice = viewA.activePlayerId === sessionA.playerId;
    const waiting = firstIsAlice ? bob : alice;
    const waitingSession = firstIsAlice ? sessionB : sessionA;
    const roomVersion = room.currentRoomVersion;
    const roomEventSeq = room.currentRoomEventSeq;

    command(waiting, { type: "pass" }, "out-of-order-pass");
    const setupError = await waiting.wait(value => value?.type === "error" &&
      value.requestId === "out-of-order-pass");
    expect(setupError).toMatchObject({
      type: "error",
      code: "command-rejected",
      message: "Waiting for both players to finish their Mulligan",
    });
    expect(room.status).toBe("playing");
    expect(room.exportArchive().engineRuntimeJournal).toBeNull();
    expect(room.currentRoomVersion).toBe(roomVersion);
    expect(room.currentRoomEventSeq).toBe(roomEventSeq);
    const waitingView = await syncProjection(waiting, "setup-after-rejected-pass");
    expect(waitingView.viewerPlayerId).toBe(waitingSession.playerId);
    expect(waitingView.phase).toBe("setup");
    expect(waitingView.pendingChoice).toEqual({ status: "none" });

    const first = firstIsAlice ? alice : bob;
    const second = first === alice ? bob : alice;
    for (const [index, actor] of [first, second].entries()) {
      const commandId = `pass-regression-mulligan-${index}`;
      command(actor, { type: "mulligan", selectedObjectIds: [] }, commandId);
      await expect(receipt(actor, commandId)).resolves.toMatchObject({ accepted: true });
    }
    expect(room.status).toBe("playing");
    expect(room.exportArchive().engineRuntimeJournal).not.toBeNull();
    const started = await syncProjection(first, "main-after-explicit-mulligans");
    expect(started.phase).toBe("main");
  }, 180_000);
});

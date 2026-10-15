import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  FOUNDATION_RULESET_ID, DUEL_RULESET_ID, RULESET_ID, PROTOCOL_VERSION,
  isServerMessage, type ClientSession, type OwnerDeckConfirmationMessage,
  type RoomDeckSubmission, type ServerToClientMessage
} from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck, type CardCatalogRuntime } from "../src/card-catalog.js";
import { GameRoom, RoomError } from "../src/room.js";
import { InMemoryRoomStore } from "../src/room-store.js";
import { createGameServer, type GameServer } from "../src/server.js";

const rules: CardCatalogRuntime["deckRules"] = {
  defaultMaxCopiesPerCanonical: 3, cardPolicies: {},
  copyRules: [
    { zones: ["mainDeck", "champion", "sideboard"], maxCopiesPerCanonical: 3 },
    { zones: ["legend"], maxCopiesPerCanonical: 3 },
    { zones: ["runes"], maxCopiesPerCanonical: 12 },
    { zones: ["battlefields"], maxCopiesPerCanonical: 1 }
  ],
  sizeRules: {
    legend: { minimum: 1, maximum: 1 }, champion: { minimum: 1, maximum: 1 },
    runes: { minimum: 12, maximum: 12 }, battlefields: { minimum: 3, maximum: 3 }
  },
  sizeGroups: [{ zones: ["mainDeck", "champion"], rule: { minimum: 40, maximum: 40 } }],
  uniqueCanonicalZones: ["battlefields"]
};
const card = (id: string, cardType = "Unit", tags: string[] = []) => ({
  id, canonicalCardId: id, name: id, fullName: id, cardType, tags,
  domains: ["Fury"], setCode: "ogs", cardNumber: id.slice(-2), variant: "standard",
  imageUrl: null, energy: 1, power: 1, might: null, ability: ""
});
const fillers = Array.from({ length: 13 }, (_, index) => `unit-${index}`);
const catalog = {
  schemaVersion: 1, dataVersion: "owner-private-fixture-v1", digest: "sha256:" + "f".repeat(64),
  cards: [card("unit-a"), card("unit-b"), ...fillers.map(id => card(id)),
    card("hero", "Unit", ["Champion", "Testchamp"]),
    card("legend", "Legend", ["Testchamp"]), card("rune", "Rune"),
    card("field", "Battlefield"), card("field-b", "Battlefield"),
    card("field-c", "Battlefield")]
};
const deckA: RoomDeckSubmission = {
  mainDeck: fillers.map(cardId => ({ cardId, quantity: 3 })),
  champion: [{ cardId: "hero", quantity: 1 }], legend: [{ cardId: "legend", quantity: 1 }],
  runes: [{ cardId: "rune", quantity: 12 }],
  battlefields: ["field", "field-b", "field-c"].map(cardId => ({ cardId, quantity: 1 }))
};
const deckB: RoomDeckSubmission = { ...deckA, mainDeck: [
  ...deckA.mainDeck!.slice(0, -1), { cardId: "unit-a", quantity: 3 }
] };

async function runtime() {
  const result = await loadCardCatalogRuntime({ catalog, deckRules: rules });
  const validation = validateCatalogDeck(result, deckA);
  if (!validation.valid) throw new Error(`Fixture invalid: ${JSON.stringify(validation)}`);
  return result;
}
function seat(room: GameRoom, name: string, connectionId: string) {
  const messages: ServerToClientMessage[] = [];
  const send = (message: ServerToClientMessage) => messages.push(message);
  const connection = room.join(name, send, connectionId);
  const session: ClientSession = { roomId: room.roomId, playerId: connection.playerId,
    resumeToken: connection.resumeToken };
  return { messages, send, session, connectionId };
}
function echoes(messages: ServerToClientMessage[]): OwnerDeckConfirmationMessage[] {
  return messages.filter((message): message is OwnerDeckConfirmationMessage =>
    message.type === "owner-deck-confirmation");
}

class SocketCapture {
  readonly messages: ServerToClientMessage[] = [];
  private readonly waiters = new Set<() => void>();
  private constructor(private readonly socket: WebSocket) {
    socket.on("message", raw => {
      this.messages.push(JSON.parse(String(raw)) as ServerToClientMessage);
      for (const wake of this.waiters) wake();
    });
  }
  static async connect(url: string): Promise<SocketCapture> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve); socket.once("error", reject);
    });
    return new SocketCapture(socket);
  }
  send(message: unknown) { this.socket.send(JSON.stringify(message)); }
  async waitFor<T extends ServerToClientMessage["type"]>(
    type: T, match: (message: Extract<ServerToClientMessage, { type: T }>) => boolean = () => true
  ): Promise<Extract<ServerToClientMessage, { type: T }>> {
    const until = Date.now() + 3_000;
    while (Date.now() < until) {
      const index = this.messages.findIndex(item => item.type === type &&
        match(item as Extract<ServerToClientMessage, { type: T }>));
      if (index !== -1) return this.messages.splice(index, 1)[0] as Extract<ServerToClientMessage, { type: T }>;
      await new Promise<void>(resolve => {
        const wake = () => { this.waiters.delete(wake); resolve(); };
        this.waiters.add(wake);
        setTimeout(wake, 10);
      });
    }
    throw new Error(`Missing ${type}; saw ${this.messages.map(m => m.type).join(",")}`);
  }
  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.once("close", () => resolve()); this.socket.close(); });
  }
}
class SaveFailStore extends InMemoryRoomStore {
  fail = false;
  override async save(): Promise<void> { if (this.fail) throw new Error("save-failed"); }
}
const openSockets: SocketCapture[] = [];
const openServers: GameServer[] = [];
afterEach(async () => {
  for (const socket of openSockets.splice(0)) await socket.close();
  for (const server of openServers.splice(0)) await server.stop();
});
async function start(store = new SaveFailStore()) {
  const server = createGameServer({ host: "127.0.0.1", port: 0,
    roomIdFactory: () => "owner-room", catalog, deckRules: rules, roomStore: store });
  openServers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return { server, store, url: `ws://127.0.0.1:${address.port}/ws` };
}
async function connect(url: string): Promise<SocketCapture> {
  const socket = await SocketCapture.connect(url);
  openSockets.push(socket);
  socket.send({ type: "hello", protocolVersion: PROTOCOL_VERSION });
  await socket.waitFor("welcome");
  return socket;
}
async function create(socket: SocketCapture): Promise<ClientSession> {
  socket.send({ type: "create-room", playerName: "Alice", requestId: "create",
    rulesetId: FOUNDATION_RULESET_ID });
  const welcome = await socket.waitFor("welcome", m => m.session !== undefined);
  if (!welcome.session) throw new Error("Missing session");
  const snapshot = await socket.waitFor("room");
  socket.messages.push(snapshot);
  return welcome.session;
}

// Unit tests inspect direct transports; WebSocket tests cover buffering/durable ACK.
describe("owner-only normalized deck echo", () => {
  it.each([FOUNDATION_RULESET_ID, DUEL_RULESET_ID])("private owner A/B scopes in %s", async ruleset => {
    const room = new GameRoom("owner-room", ruleset, await runtime());
    const a = seat(room, "Alice", "a"); const b = seat(room, "Bob", "b");
    expect(echoes(a.messages)).toHaveLength(0);
    room.broadcastRoom();
    expect(echoes(a.messages).at(-1)).toMatchObject({ playerId: "player-1", deck: null });
    expect(echoes(b.messages).at(-1)).toMatchObject({ playerId: "player-2", deck: null });
    a.messages.length = 0; b.messages.length = 0;
    room.submitDeck(a.session, "a", room.currentRoomVersion, deckA, "submit-a", a.send);
    expect(echoes(a.messages).at(-1)).toMatchObject({
      playerId: "player-1", rulesetId: ruleset, deck: deckA,
      catalog: { dataVersion: catalog.dataVersion, digest: catalog.digest }
    });
    expect(echoes(b.messages).at(-1)).toMatchObject({ playerId: "player-2", deck: null });
    expect(b.messages.every(message => !JSON.stringify(message).includes('"cardId":"unit-12"'))).toBe(true);
    expect(a.messages.filter(message => message.type === "room").every(message =>
      !JSON.stringify(message).includes('"cardId"'))).toBe(true);
    expect(isServerMessage(echoes(a.messages).at(-1))).toBe(true);
    a.messages.length = 0; b.messages.length = 0;
    room.submitDeck(b.session, "b", room.currentRoomVersion, deckB, "submit-b", b.send);
    expect(echoes(b.messages).at(-1)?.deck?.mainDeck).toEqual(deckB.mainDeck);
    expect(echoes(a.messages).at(-1)?.deck?.mainDeck).toEqual(deckA.mainDeck);
  });

  it("echoes aggregate repeated printing quantities without changing zones", async () => {
    const room = new GameRoom("owner-room", FOUNDATION_RULESET_ID, await runtime());
    const owner = seat(room, "Alice", "alice");
    const repeated: RoomDeckSubmission = {
      ...deckA,
      mainDeck: [...deckA.mainDeck!.slice(0, -1),
        { cardId: "unit-12", quantity: 1 }, { cardId: "unit-12", quantity: 2 }]
    };
    room.submitDeck(owner.session, owner.connectionId, room.currentRoomVersion,
      repeated, "repeat-printing", owner.send);
    const echoed = echoes(owner.messages).at(-1);
    expect(echoed?.deck?.mainDeck).toEqual(deckA.mainDeck);
    expect(echoed?.deck?.mainDeck?.filter(entry => entry.cardId === "unit-12")).toHaveLength(1);
    expect(isServerMessage(echoed)).toBe(true);
    expect(owner.messages.filter(message => message.type === "room").every(message =>
      !JSON.stringify(message).includes('"cardId"'))).toBe(true);
  });

  it("waiting-room resume replays only the authenticated current seat", async () => {
    const room = new GameRoom("owner-room", FOUNDATION_RULESET_ID, await runtime());
    const a = seat(room, "Alice", "old"); const b = seat(room, "Bob", "bob");
    room.submitDeck(a.session, "old", room.currentRoomVersion, deckA, "submit", a.send);
    const next: ServerToClientMessage[] = [];
    const resumedSend = (message: ServerToClientMessage) => next.push(message);
    room.reconnect(a.session.resumeToken, resumedSend, "new");
    room.sendProjection(a.session.playerId, resumedSend);
    expect(echoes(next).at(-1)?.deck?.mainDeck).toEqual(deckA.mainDeck);
    expect(next.every(message => message.type === "owner-deck-confirmation")).toBe(true);
    expect(echoes(b.messages).every(message => message.playerId === "player-2")).toBe(true);
    expect(() => room.submitDeck(a.session, "old", room.currentRoomVersion, deckB, "old-submit", a.send))
      .toThrowError(RoomError);
    expect(echoes(a.messages).every(message => message.deck?.mainDeck?.[0]?.quantity === 3 || message.deck === null)).toBe(true);
  });

  it("synthetic mode never emits private deck proof", () => {
    const room = new GameRoom("synthetic-room", RULESET_ID);
    const a = seat(room, "Alice", "a");
    room.broadcastRoom(); room.sendProjection(a.session.playerId, a.send);
    expect(echoes(a.messages)).toHaveLength(0);
  });

  it("join failure never flushes a private echo and successful join scopes each owner", async () => {
    const { url, store } = await start();
    const owner = await connect(url);
    const session = await create(owner);
    const joiner = await connect(url);
    owner.messages.length = 0; joiner.messages.length = 0;
    store.fail = true;
    joiner.send({ type: "join-room", requestId: "failed-join",
      roomId: session.roomId, playerName: "Bob" });
    await joiner.waitFor("error", message => message.requestId === "failed-join");
    expect(echoes(joiner.messages)).toHaveLength(0);
    expect(echoes(owner.messages)).toHaveLength(0);
    store.fail = false;
    joiner.send({ type: "join-room", requestId: "join",
      roomId: session.roomId, playerName: "Bob" });
    await joiner.waitFor("request-result", message => message.requestId === "join");
    const joined = await joiner.waitFor("owner-deck-confirmation", message =>
      message.playerId === "player-2");
    const ownerEcho = await owner.waitFor("owner-deck-confirmation", message =>
      message.playerId === session.playerId);
    expect(joined.deck).toBeNull();
    expect(joined.roomVersion).toBe(ownerEcho.roomVersion);
    expect(joiner.messages.some(message => message.type === "owner-deck-confirmation" &&
      message.playerId !== "player-2")).toBe(false);
  });

  it("create/waiting/submit messages flush only after durable save, rollback emits no false proof", async () => {
    const { store, server, url } = await start();
    const a = await connect(url);
    const session = await create(a);
    const initial = server.rooms.get(session.roomId)!.roomView();
    expect(initial.roomVersion).toBe(server.rooms.get(session.roomId)?.currentRoomVersion);
    await a.waitFor("request-result", m => m.requestId === "create");
    expect(echoes(a.messages)).toHaveLength(0);
    const room = server.rooms.get(session.roomId)!;
    const before = room.exportArchive();
    a.messages.length = 0;
    store.fail = true;
    a.send({ type: "submit-deck", requestId: "failed", expectedRoomVersion: room.currentRoomVersion,
      deck: deckA });
    const error = await a.waitFor("error", m => m.requestId === "failed");
    expect(error.message).toContain("save-failed");
    expect(a.messages.some(m => m.type === "owner-deck-confirmation" && m.deck !== null)).toBe(false);
    expect(a.messages.some(m => m.type === "request-result" && m.requestId === "failed")).toBe(false);
    expect(room.exportArchive()).toEqual(before);
    store.fail = false;
    a.send({ type: "submit-deck", requestId: "retry", expectedRoomVersion: room.currentRoomVersion,
      deck: deckA });
    const ack = await a.waitFor("request-result", m => m.requestId === "retry");
    const echo = await a.waitFor("owner-deck-confirmation", m => m.deck !== null);
    expect(echo).toMatchObject({ roomVersion: ack.roomVersion, roomEventSeq: ack.roomEventSeq,
      playerId: session.playerId, deck: deckA });
    expect(room.exportArchive().seats[0]?.deck).toEqual(deckA);
  });

  it("failed resume save sends no owner deck and does not displace the old socket", async () => {
    const { url, store, server } = await start();
    const old = await connect(url);
    const session = await create(old);
    const room = server.rooms.get(session.roomId)!;
    old.send({ type: "submit-deck", requestId: "submit", expectedRoomVersion: room.currentRoomVersion,
      deck: deckA });
    await old.waitFor("request-result", message => message.requestId === "submit");
    await old.waitFor("owner-deck-confirmation", message => message.deck !== null);
    old.messages.length = 0;
    store.fail = true;
    const replacement = await SocketCapture.connect(url);
    openSockets.push(replacement);
    replacement.send({ type: "hello", protocolVersion: PROTOCOL_VERSION,
      roomId: session.roomId, resumeToken: session.resumeToken });
    const error = await replacement.waitFor("error");
    expect(error.message).toContain("save-failed");
    expect(echoes(replacement.messages)).toHaveLength(0);
    expect(echoes(old.messages)).toHaveLength(0);
    store.fail = false;
    old.send({ type: "submit-deck", requestId: "still-current",
      expectedRoomVersion: room.currentRoomVersion, deck: deckA });
    await old.waitFor("request-result", message => message.requestId === "still-current");
    expect((await old.waitFor("owner-deck-confirmation", message => message.deck !== null)).deck)
      .toEqual(deckA);
    expect(echoes(replacement.messages)).toHaveLength(0);
  });

  it("WebSocket resume sends a fresh owner deck independently of a submit ACK", async () => {
    const { url } = await start();
    const a = await connect(url);
    const session = await create(a);
    const initial = a.messages.find(message => message.type === "room");
    if (!initial || initial.type !== "room") throw new Error("Missing room view");
    a.send({ type: "submit-deck", requestId: "valid", expectedRoomVersion: initial.room.roomVersion,
      deck: deckA });
    await a.waitFor("request-result", m => m.requestId === "valid");
    await a.waitFor("owner-deck-confirmation", m => m.deck !== null);
    const b = await SocketCapture.connect(url);
    openSockets.push(b);
    b.send({ type: "hello", protocolVersion: PROTOCOL_VERSION,
      roomId: session.roomId, resumeToken: session.resumeToken });
    await b.waitFor("welcome", m => m.resumed === true);
    const room = await b.waitFor("room");
    const resumed = await b.waitFor("owner-deck-confirmation", m => m.deck !== null);
    expect(resumed.roomVersion).toBeGreaterThanOrEqual(room.room.roomVersion);
    expect(resumed.deck).toEqual(deckA);
    expect(b.messages.some(m => m.type === "request-result" && m.requestId === "valid")).toBe(false);
  });
});

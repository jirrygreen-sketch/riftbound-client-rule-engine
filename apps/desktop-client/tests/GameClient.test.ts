import {
  OFFICIAL_RULESET_ID,
  DUEL_RULESET_ID,
  RULESET_ID,
  OWNER_DECK_CONFIRMATION_SCHEMA,
  PROTOCOL_VERSION,
  type ClientSession,
  type GameProjection,
  type GameEvent,
  type RoomEvent,
  type RoomPlayer,
  type RoomView,
  type OwnerDeckConfirmationMessage
} from "@riftbound/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameClient,
  normalizeServerUrl,
  type GameClientHandlers,
  type GameClientStatus,
  type OwnerDeckConfirmation
} from "../src/net/GameClient";

const SERVER_URL = "ws://127.0.0.1:8787/ws";
const SESSION: ClientSession = {
  roomId: "room-1",
  playerId: "player-1",
  resumeToken: "resume-token-1"
};

type SocketEvent = { data?: unknown };
type SocketListener = (event: SocketEvent) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeCalls = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<SocketListener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(payload: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error("Socket is not open");
    }
    this.sent.push(payload);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  receive(message: unknown): void {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    this.emit("message", { data });
  }

  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map(payload => JSON.parse(payload) as Record<string, unknown>);
  }

  private emit(type: string, event: SocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

interface Harness {
  client: GameClient;
  statuses: GameClientStatus[];
  sessions: Array<ClientSession | null>;
  projections: Array<GameProjection | null>;
  errors: string[];
  rooms: Array<string | null>;
  handshakes: boolean[];
  pending: boolean[];
  roomViews: Array<RoomView | null>;
  gameEvents: GameEvent[][];
  roomEvents: RoomEvent[][];
  requestPending: boolean[];
  roomReceipts: Array<{
    requestId: string;
    requestType: "submit-deck" | "set-ready";
    roomId: string;
    playerId: string;
    socketGeneration: number;
    ready?: boolean;
    roomVersion?: number;
    roomEventSeq?: number;
  }>;
  roomFailures: string[];
  ownerConfirmations: Array<OwnerDeckConfirmation | null>;
}

let originalWindow: unknown;
let originalWebSocket: unknown;
let hadWindow = false;
let hadWebSocket = false;
let storage: MemoryStorage;
const clients: GameClient[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);

  hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  hadWebSocket = Object.prototype.hasOwnProperty.call(globalThis, "WebSocket");
  originalWindow = (globalThis as { window?: unknown }).window;
  originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

  storage = new MemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { sessionStorage: storage }
  });
  FakeWebSocket.reset();
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: FakeWebSocket
  });
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();

  if (hadWindow) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: originalWindow
    });
  } else {
    delete (globalThis as { window?: unknown }).window;
  }

  if (hadWebSocket) {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: originalWebSocket
    });
  } else {
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
  }
});

describe("GameClient", () => {
  it("rejects invalid wire shapes instead of accepting legacy messages", () => {
    const harness = createHarness();
    const socket = connect(harness);
    socket.open();

    socket.receive("{not-json");
    socket.receive({ type: "event", seq: 1 });
    socket.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      roomId: "room-1",
      playerId: "player-1",
      resumeToken: "resume-token-1"
    });
    socket.receive({
      type: "room",
      room: { id: "room-1", status: "playing", seats: 2, filledSeats: 2 }
    });

    expect(harness.errors).toHaveLength(4);
    expect(harness.sessions).toEqual([]);
    expect(harness.handshakes).toEqual([]);
    expect(socket.sentJson()).toEqual([
      { type: "hello", protocolVersion: PROTOCOL_VERSION }
    ]);
  });

  it("validates the welcome protocol version and stops reconnecting on mismatch", () => {
    const harness = createHarness();
    const socket = connect(harness);
    socket.open();

    socket.receive({ type: "welcome", protocolVersion: "9.9.9" });

    expect(harness.handshakes).toEqual([]);
    expect(harness.statuses.at(-1)).toBe("disconnected");
    expect(harness.errors.at(-1)).toContain("版本不兼容");
    expect(socket.closeCalls).toBe(1);

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("parses and normalizes server URLs with the URL API", () => {
    expect(normalizeServerUrl("")).toBe(SERVER_URL);
    expect(normalizeServerUrl("127.0.0.1:8787")).toBe(SERVER_URL);
    expect(normalizeServerUrl("http://127.0.0.1:8787/ws")).toBe(SERVER_URL);
    expect(normalizeServerUrl("https://example.com/ws")).toBe("wss://example.com/ws");
    expect(normalizeServerUrl("wss://example.com/custom")).toBe(
      "wss://example.com/custom/ws"
    );
    expect(normalizeServerUrl("ftp://example.com/ws")).toBeNull();
    expect(normalizeServerUrl("http://")).toBeNull();
  });

  it("ignores delayed events from a replaced socket", () => {
    const harness = createHarness();
    const first = connect(harness);
    const second = connect(harness);

    expect(first.closeCalls).toBe(1);
    first.emitClose();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(harness.statuses.at(-1)).toBe("connecting");

    second.open();
    second.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
    expect(harness.statuses.at(-1)).toBe("connected");
    expect(harness.handshakes.at(-1)).toBe(true);
  });

  it("does not let an old heartbeat timer close the replacement socket", () => {
    const harness = createHarness();
    const first = connect(harness);
    first.open();
    first.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION });

    const second = connect(harness);
    second.open();
    second.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION });

    vi.advanceTimersByTime(40_000);
    expect(first.closeCalls).toBe(1);
    expect(second.readyState).toBe(FakeWebSocket.OPEN);
  });

  it.each(["invalid-token", "room-not-found"] as const)(
    "drops stale resume state and reconnects cleanly after %s",
    code => {
      storage.setItem(
        "riftbound.desktop-client.session",
        JSON.stringify({ ...SESSION, serverUrl: SERVER_URL })
      );
      const harness = createHarness();
      const first = connect(harness);
      first.open();

      expect(first.sentJson().at(-1)).toMatchObject({
        type: "hello",
        roomId: SESSION.roomId,
        resumeToken: SESSION.resumeToken
      });

      first.receive({ type: "error", code, message: "session unavailable" });

      expect(harness.sessions.at(-1)).toBeNull();
      expect(storage.getItem("riftbound.desktop-client.session")).toBeNull();
      expect(FakeWebSocket.instances).toHaveLength(2);

      const second = latestSocket();
      second.open();
      expect(second.sentJson().at(-1)).toEqual({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION
      });

      second.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
      expect(harness.handshakes.at(-1)).toBe(true);
      expect(harness.client.createRoom("Alice")).toBe(true);
      expect(second.sentJson().at(-1)).toMatchObject({
        type: "create-room",
        playerName: "Alice"
      });
    }
  );

  it("stops reconnecting permanently when the session was replaced", () => {
    storage.setItem(
      "riftbound.desktop-client.session",
      JSON.stringify({ ...SESSION, serverUrl: SERVER_URL })
    );
    const harness = createHarness();
    const socket = connect(harness);
    socket.open();
    socket.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      session: SESSION,
      resumed: true
    });

    socket.receive({
      type: "error",
      code: "session-replaced",
      message: "The session was replaced"
    });

    expect(harness.statuses.at(-1)).toBe("disconnected");
    expect(harness.sessions.at(-1)).toBeNull();
    expect(harness.handshakes.at(-1)).toBe(false);
    expect(storage.getItem("riftbound.desktop-client.session")).toBeNull();

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("drops a stored session when connecting to a different server", () => {
    storage.setItem(
      "riftbound.desktop-client.session",
      JSON.stringify({ ...SESSION, serverUrl: SERVER_URL })
    );
    const harness = createHarness();
    const socket = connect(harness);
    socket.open();
    socket.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      session: SESSION,
      resumed: true
    });
    expect(harness.sessions.at(-1)).toMatchObject({ playerId: SESSION.playerId });

    harness.client.disconnect();
    harness.client.connect("ws://192.0.2.10:8787/ws");

    expect(harness.sessions.at(-1)).toBeNull();
    expect(harness.rooms.at(-1)).toBeNull();
    expect(storage.getItem("riftbound.desktop-client.session")).toBeNull();

    const next = latestSocket();
    next.open();
    expect(next.sentJson().at(-1)).toEqual({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION
    });
  });

  it("resumes a stored session after a page reload", () => {
    storage.setItem(
      "riftbound.desktop-client.session",
      JSON.stringify({ ...SESSION, serverUrl: SERVER_URL })
    );
    const harness = createHarness();

    expect(harness.client.resumeStoredSession()).toBe(true);

    const socket = latestSocket();
    expect(socket.url).toBe(SERVER_URL);
    socket.open();
    expect(socket.sentJson().at(-1)).toEqual({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      roomId: SESSION.roomId,
      resumeToken: SESSION.resumeToken
    });
  });

  it("exposes the normalized active server URL without credentials", () => {
    const harness = createHarness();
    expect(harness.client.activeServerUrl).toBeNull();

    harness.client.connect("127.0.0.1:8793");

    expect(harness.client.activeServerUrl).toBe("ws://127.0.0.1:8793/ws");
    expect(latestSocket().url).toBe("ws://127.0.0.1:8793/ws");
    expect(harness.client.activeServerUrl).not.toContain(SESSION.resumeToken);
    expect(harness.client.activeServerUrl).not.toContain(SESSION.playerId);
  });

  it("reports the persisted resume target until a connection is requested", () => {
    storage.setItem(
      "riftbound.desktop-client.session",
      JSON.stringify({ ...SESSION, serverUrl: "ws://127.0.0.1:8793/ws" })
    );
    const harness = createHarness();

    expect(harness.client.activeServerUrl).toBe("ws://127.0.0.1:8793/ws");

    expect(harness.client.resumeStoredSession()).toBe(true);
    expect(harness.client.activeServerUrl).toBe("ws://127.0.0.1:8793/ws");
    expect(latestSocket().url).toBe("ws://127.0.0.1:8793/ws");
  });

  it("tracks the current normalized target when switching servers", () => {
    const harness = createHarness();
    harness.client.connect(SERVER_URL);
    expect(harness.client.activeServerUrl).toBe(SERVER_URL);

    harness.client.connect("http://192.0.2.10:8793");
    expect(harness.client.activeServerUrl).toBe("ws://192.0.2.10:8793/ws");
  });

  it("keeps the active server URL getter read-only", () => {
    const harness = createHarness();
    harness.client.connect(SERVER_URL);
    const socket = latestSocket();
    const statusCount = harness.statuses.length;

    expect(harness.client.activeServerUrl).toBe(SERVER_URL);
    expect(harness.client.activeServerUrl).toBe(SERVER_URL);

    expect(harness.statuses).toHaveLength(statusCount);
    expect(harness.sessions).toHaveLength(0);
    expect(socket.sent).toHaveLength(0);
    expect(storage.getItem("riftbound.desktop-client.session")).toBeNull();
  });

  it("keeps one command in flight, acknowledges it, and uses the latest projection version", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();

    expect(harness.client.pass()).toBe(true);
    const firstCommand = socket.sentJson().at(-1)!;
    expect(firstCommand).toMatchObject({
      type: "command",
      expectedVersion: 1,
      command: { type: "pass" }
    });
    expect(firstCommand.commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(harness.pending).toEqual([true]);

    expect(harness.client.pass()).toBe(false);
    expect(socket.sentJson().filter(message => message.type === "command")).toHaveLength(1);
    expect(harness.errors.at(-1)).toContain("确认中");

    socket.receive({
      type: "request-result",
      requestId: firstCommand.requestId,
      ok: true,
      commandId: firstCommand.commandId,
      appliedVersion: 2,
      eventSeq: 1,
      duplicate: false
    });
    expect(harness.pending).toEqual([true, false]);

    expect(harness.client.pass()).toBe(false);
    expect(harness.errors.at(-1)).toContain("牌桌状态");

    receiveProjection(socket, 2);
    expect(harness.client.pass()).toBe(true);
    expect(socket.sentJson().at(-1)).toMatchObject({
      type: "command",
      expectedVersion: 2,
      command: { type: "pass" }
    });
  });

  it("clears a pending command on a matching server error", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();

    expect(harness.client.pass()).toBe(true);
    const command = socket.sentJson().at(-1)!;
    socket.receive({
      type: "error",
      requestId: command.requestId,
      code: "stale-version",
      message: "stale"
    });

    expect(harness.pending).toEqual([true, false]);
    expect(harness.client.pass()).toBe(false);
    receiveProjection(socket, 2);
    expect(harness.client.pass()).toBe(true);
    expect(socket.sentJson().at(-1)).toMatchObject({ expectedVersion: 2 });
  });

  it("keeps a command pending across reconnect and resumes from the stored session", () => {
    const harness = createPlayableClient();
    const first = latestSocket();

    expect(harness.client.pass()).toBe(true);
    first.serverClose();

    expect(harness.pending).toEqual([true]);
    expect(harness.projections.at(-1)).toStrictEqual(makeProjection(1));
    expect(harness.client.pass()).toBe(false);
    expect(harness.statuses.at(-1)).toBe("reconnecting");

    vi.advanceTimersByTime(1_000);
    const second = latestSocket();
    expect(second).not.toBe(first);
    second.open();
    expect(second.sentJson().at(-1)).toMatchObject({
      type: "hello",
      roomId: SESSION.roomId,
      resumeToken: SESSION.resumeToken
    });

    second.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      session: SESSION,
      resumed: true
    });
    receiveProjection(second, 3);
    expect(harness.client.pass()).toBe(false);
    expect(harness.errors.at(-1)).toContain("确认中");
    const retry = second.sentJson().find(
      message => message.type === "command" && message.expectedVersion === 3
    );
    // A legacy retry rebases onto the latest confirmed legacy projection while
    // keeping the same command ID.
    expect(retry).toMatchObject({ expectedVersion: 3 });
  });

  it("keeps the last confirmed projection visible while reconnecting", () => {
    const harness = createPlayableClient();
    const first = latestSocket();
    const confirmed = makeProjection(1);

    receiveProjection(first, 1);
    expect(harness.projections.at(-1)).toStrictEqual(confirmed);

    first.serverClose();
    expect(harness.projections.at(-1)).toStrictEqual(confirmed);
    expect(harness.statuses.at(-1)).toBe("reconnecting");

    vi.advanceTimersByTime(1_000);
    expect(harness.projections.at(-1)).toStrictEqual(confirmed);
  });

  it("retries a command with the same id after an acknowledgement timeout", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();

    expect(harness.client.pass()).toBe(true);
    const firstCommand = socket.sentJson().at(-1)!;
    vi.advanceTimersByTime(10_000);

    const commands = socket
      .sentJson()
      .filter(message => message.type === "command") as Array<{
      commandId: string;
      requestId: string;
      expectedVersion: number;
    }>;
    expect(commands).toHaveLength(2);
    expect(new Set(commands.map(command => command.commandId)).size).toBe(1);
    expect(commands.at(-1)?.requestId).not.toBe(firstCommand.requestId);
    expect(harness.pending).toEqual([true]);
  });

  it("retries a command with the same id after reconnecting", () => {
    const harness = createPlayableClient();
    const first = latestSocket();

    expect(harness.client.pass()).toBe(true);
    const firstCommand = first.sentJson().at(-1)!;
    first.serverClose();

    vi.advanceTimersByTime(1_000);
    const second = latestSocket();
    second.open();
    second.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      session: SESSION,
      resumed: true
    });
    receiveProjection(second, 3);

    const retry = second.sentJson().find(
      message => message.type === "command" && message.commandId === firstCommand.commandId
    );
    expect(retry).toMatchObject({
      type: "command",
      commandId: firstCommand.commandId,
      expectedVersion: 3,
      command: { type: "pass" }
    });
    expect(retry?.requestId).not.toBe(firstCommand.requestId);
    expect(harness.pending).toEqual([true]);

    second.receive({
      type: "request-result",
      requestId: retry?.requestId,
      ok: true,
      commandId: firstCommand.commandId,
      appliedVersion: 3,
      eventSeq: 2,
      duplicate: true
    });
    expect(harness.pending).toEqual([true, false]);
  });

  it("rebases a legacy retry onto the newest confirmed version on reconnect without changing identity or targets", () => {
    const harness = createPlayableClient();
    const first = latestSocket();
    receiveProjection(first, 2);

    const targets = [{ kind: "object", objectId: "object-1" }] as const;
    expect(harness.client.playCard("hand-1", targets)).toBe(true);
    const original = first.sentJson().at(-1)!;
    expect(original).toMatchObject({
      type: "command",
      expectedVersion: 2,
      command: {
        type: "play-card",
        instanceId: "hand-1",
        targets: [{ kind: "object", objectId: "object-1" }]
      }
    });

    first.serverClose();
    vi.advanceTimersByTime(1_000);
    const second = latestSocket();
    second.open();
    second.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      session: SESSION,
      resumed: true
    });
    receiveProjection(second, 3);

    const retry = second.sentJson().find(
      message => message.type === "command" && message.commandId === original.commandId
    );
    expect(retry).toMatchObject({
      type: "command",
      commandId: original.commandId,
      expectedVersion: 3,
      command: {
        type: "play-card",
        instanceId: "hand-1",
        targets: [{ kind: "object", objectId: "object-1" }]
      }
    });
    expect(retry?.requestId).not.toBe(original.requestId);
    expect(harness.pending).toEqual([true]);
  });

  it("abandons a command after exhausting idempotent retries", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();

    expect(harness.client.pass()).toBe(true);
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);

    const commands = socket
      .sentJson()
      .filter(message => message.type === "command") as Array<{
      commandId: string;
      requestId: string;
      expectedVersion: number;
    }>;
    expect(commands).toHaveLength(3);
    expect(new Set(commands.map(command => command.commandId)).size).toBe(1);
    expect(harness.pending).toEqual([true, false]);
    expect(harness.errors.at(-1)).toContain("超时");
  });

  it("creates foundation rooms by default and keeps synthetic demo explicit", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();

    expect(harness.client.createRoom("Alice")).toBe(true);
    expect(socket.sentJson().at(-1)).toMatchObject({
      type: "create-room",
      playerName: "Alice",
      rulesetId: OFFICIAL_RULESET_ID
    });

    expect(harness.client.createRoom("Alice", RULESET_ID)).toBe(true);
    expect(socket.sentJson().at(-1)).toMatchObject({
      type: "create-room",
      playerName: "Alice",
      rulesetId: RULESET_ID
    });
  });

  it("sends the exact duel ruleset packet when Duel is explicitly chosen", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();

    expect(harness.client.createRoom("Alice", DUEL_RULESET_ID)).toBe(true);
    // Exact wire packet: no extra fields, and the Duel id is the real protocol
    // constant rather than a foundation/synthetic alias.
    expect(socket.sentJson().at(-1)).toEqual({
      type: "create-room",
      requestId: expect.any(String),
      playerName: "Alice",
      rulesetId: DUEL_RULESET_ID
    });
    expect(DUEL_RULESET_ID).not.toBe(OFFICIAL_RULESET_ID);
    expect(DUEL_RULESET_ID).not.toBe(RULESET_ID);
  });

  it("sends explicit event-local region selections without allowing source-version fields", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    const region = {regionCode:"ROW",eventDate:"2026-10-14"};
    expect(harness.client.createRoom("Alice",DUEL_RULESET_ID,region)).toBe(true);
    expect(socket.sentJson().at(-1)).toEqual({type:"create-room",requestId:expect.any(String),
      playerName:"Alice",rulesetId:DUEL_RULESET_ID,constructedRegion:region});
    const count=socket.sentJson().length;
    expect(harness.client.createRoom("Alice",DUEL_RULESET_ID,{...region,eventDate:"2026-02-30"})).toBe(false);
    expect(harness.client.createRoom("Alice",OFFICIAL_RULESET_ID,region)).toBe(false);
    expect(harness.client.createRoom("Alice",DUEL_RULESET_ID,{...region,scheduleDigest:"forged"} as never)).toBe(false);
    expect(socket.sentJson()).toHaveLength(count);
    expect(harness.errors.at(-1)).toContain("赛事地区");
  });

  it("submits all six deck zones using the room version", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, {
      self: { deckSubmitted: false, ready: false },
      roomVersion: 3
      ,
      roomEventSeq: 3
    });
    expect(harness.roomViews.at(-1)).toMatchObject({ roomVersion: 3 });
    expect(harness.errors).toEqual([]);

    expect(harness.client.submitDeck({
      mainDeck: [{ cardId: "card-1", quantity: 3 }],
      runes: [{ cardId: "rune-1", quantity: 12 }],
      legend: [{ cardId: "legend-1", quantity: 1 }],
      champion: [{ cardId: "champion-1", quantity: 1 }],
      battlefields: [{ cardId: "battlefield-1", quantity: 1 }],
      sideboard: [{ cardId: "card-2", quantity: 2 }]
    })).toBe(true);

    expect(socket.sentJson().at(-1)).toMatchObject({
      type: "submit-deck",
      expectedRoomVersion: 3,
      deck: {
        mainDeck: [{ cardId: "card-1", quantity: 3 }],
        runes: [{ cardId: "rune-1", quantity: 12 }],
        legend: [{ cardId: "legend-1", quantity: 1 }],
        champion: [{ cardId: "champion-1", quantity: 1 }],
        battlefields: [{ cardId: "battlefield-1", quantity: 1 }],
        sideboard: [{ cardId: "card-2", quantity: 2 }]
      }
    });
    expect(harness.requestPending).toEqual([true]);
  });

  it("emits a matched room request receipt with captured request context only once", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4 });

    expect(harness.client.setReadyTracked(true)).toMatch(/^set-ready-/);
    const request = socket.sentJson().at(-1)!;
    socket.receive({
      type: "request-result",
      requestId: request.requestId,
      ok: true,
      roomVersion: 5,
      roomEventSeq: 5,
      duplicate: false
    });

    expect(harness.roomReceipts).toHaveLength(1);
    expect(harness.roomReceipts[0]).toMatchObject({
      requestId: request.requestId,
      requestType: "set-ready",
      socketGeneration: expect.any(Number),
      roomId: SESSION.roomId,
      playerId: SESSION.playerId,
      ready: true,
      roomVersion: 5,
      roomEventSeq: 5
    });
    socket.receive({
      type: "request-result",
      requestId: request.requestId,
      ok: true,
      roomVersion: 5,
      roomEventSeq: 5
    });
    expect(harness.roomReceipts).toHaveLength(1);
  });

  it("ignores unrelated room receipts and reports only the matching request error", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4 });
    expect(harness.client.setReadyTracked(true)).not.toBeNull();
    const request = socket.sentJson().at(-1)!;

    socket.receive({ type: "request-result", requestId: "set-ready-other", ok: true, roomVersion: 8 });
    expect(harness.roomReceipts).toHaveLength(0);
    expect(harness.requestPending).toEqual([true]);
    socket.receive({
      type: "error",
      requestId: "set-ready-other",
      code: "invalid-deck",
      message: "other request"
    });
    expect(harness.requestPending).toEqual([true]);
    expect(harness.roomFailures).toEqual([]);

    socket.receive({
      type: "error",
      requestId: request.requestId,
      code: "invalid-deck",
      message: "matching request"
    });
    expect(harness.requestPending).toEqual([true, false]);
    expect(harness.roomFailures).toEqual([request.requestId]);
  });

  it("emits a receipt without a room version (the app rejects it) but never after the socket context is replaced", () => {
    const harness = createPlayableClient();
    const first = latestSocket();
    receiveRoom(first, { roomVersion: 4, roomEventSeq: 4 });
    expect(harness.client.setReadyTracked(true)).not.toBeNull();
    const request = first.sentJson().at(-1)!;

    first.receive({ type: "request-result", requestId: request.requestId, ok: true });
    expect(harness.roomReceipts).toHaveLength(1);
    expect(harness.roomReceipts[0]?.roomVersion).toBeUndefined();
    expect(harness.roomReceipts[0]?.roomEventSeq).toBeUndefined();

    receiveRoom(first, { roomVersion: 5, roomEventSeq: 5 });
    expect(harness.client.setReadyTracked(false)).not.toBeNull();
    const oldRequest = first.sentJson().at(-1)!;
    first.serverClose();
    vi.advanceTimersByTime(1_000);
    const second = latestSocket();
    second.open();
    second.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      session: SESSION,
      resumed: true
    });
    receiveRoom(second, { roomVersion: 6, roomEventSeq: 6 });
    second.receive({ type: "request-result", requestId: oldRequest.requestId, ok: true, roomVersion: 7 });
    expect(harness.roomReceipts).toHaveLength(1);
  });

  it("clears the matching request on timeout and emits no success receipt", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4 });
    expect(harness.client.setReadyTracked(true)).not.toBeNull();
    const request = socket.sentJson().at(-1)!;
    vi.advanceTimersByTime(10_000);
    expect(harness.requestPending).toEqual([true, false]);
    expect(harness.roomReceipts).toEqual([]);
    expect(harness.roomFailures).toEqual([request.requestId]);

    socket.receive({
      type: "request-result",
      requestId: request.requestId,
      ok: true,
      roomVersion: 5,
      roomEventSeq: 5
    });
    expect(harness.roomReceipts).toEqual([]);
  });

  it("tracks ready state, errors, and request receipts", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, {
      self: { deckSubmitted: true, ready: false },
      roomVersion: 4,
      roomEventSeq: 4
    });

    expect(harness.client.setReady(true)).toBe(true);
    const request = socket.sentJson().at(-1)!;
    expect(request).toMatchObject({
      type: "set-ready",
      expectedRoomVersion: 4,
      ready: true
    });
    expect(harness.requestPending).toEqual([true]);

    expect(harness.client.setReady(false)).toBe(false);

    socket.receive({
      type: "error",
      requestId: request.requestId,
      code: "invalid-deck",
      message: "invalid deck"
    });
    expect(harness.requestPending).toEqual([true, false]);
    expect(harness.errors.at(-1)).toContain("卡组");
  });

  it("recovers a pending room request after disconnect or acknowledgement timeout", () => {
    const harness = createPlayableClient();
    const first = latestSocket();
    receiveRoom(first, {
      self: { deckSubmitted: true, ready: false },
      roomVersion: 4,
      roomEventSeq: 4
    });

    expect(harness.client.setReady(true)).toBe(true);
    expect(harness.requestPending).toEqual([true]);

    first.serverClose();
    expect(harness.requestPending).toEqual([true, false]);
    expect(harness.client.setReady(true)).toBe(false);

    vi.advanceTimersByTime(1_000);
    const second = latestSocket();
    second.open();
    second.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      session: SESSION,
      resumed: true
    });
    receiveRoom(second, { roomVersion: 5, roomEventSeq: 5 });

    expect(harness.client.setReady(true)).toBe(true);
    expect(harness.requestPending).toEqual([true, false, true, false, true]);

    vi.advanceTimersByTime(10_000);
    expect(harness.requestPending).toEqual(
      [true, false, true, false, true, false]
    );
    expect(harness.errors.at(-1)).toContain("超时");

    receiveRoom(second, { roomVersion: 6, roomEventSeq: 6 });
    expect(harness.client.setReady(true)).toBe(true);
  });

  it("clears a pending room request when the client is explicitly disconnected", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, {
      self: { deckSubmitted: true, ready: false },
      roomVersion: 4,
      roomEventSeq: 4
    });

    expect(harness.client.setReady(true)).toBe(true);
    harness.client.disconnect();

    expect(harness.requestPending).toEqual([true, false]);
    vi.advanceTimersByTime(10_000);
    expect(harness.errors).toEqual([]);
  });

  it("merges server events and room events by sequence and resumes with cursors", () => {
    const harness = createPlayableClient();
    const first = latestSocket();

    first.receive({
      type: "events",
      roomId: SESSION.roomId,
      afterEventSeq: 0,
      nextEventSeq: 2,
      version: 1,
      events: [
        makeGameEvent(1),
        makeGameEvent(2)
      ]
    });
    first.receive({
      type: "events",
      roomId: SESSION.roomId,
      afterEventSeq: 1,
      nextEventSeq: 3,
      version: 1,
      events: [
        makeGameEvent(2, { activePlayerId: "player-2" }),
        makeGameEvent(3)
      ]
    });
    first.receive({
      type: "room-events",
      roomId: SESSION.roomId,
      afterRoomEventSeq: 0,
      nextRoomEventSeq: 2,
      roomVersion: 2,
      events: [
        makeRoomEvent(1),
        makeRoomEvent(2, { type: "player-ready", playerId: SESSION.playerId, ready: true })
      ]
    });

    expect(harness.gameEvents.map(events => events.map(event => event.seq))).toEqual([[1, 2], [2, 3]]);
    expect(harness.gameEvents.flatMap(events => events).filter(
      (event, index, all) => all.findIndex(candidate => candidate.seq === event.seq) === index
    )).toHaveLength(3);
    expect(harness.roomEvents.flatMap(events => events.map(event => event.seq))).toEqual([1, 2]);

    first.serverClose();
    vi.advanceTimersByTime(1_000);
    const second = latestSocket();
    second.open();
    expect(second.sentJson().at(-1)).toMatchObject({
      type: "hello",
      roomId: SESSION.roomId,
      resumeToken: SESSION.resumeToken,
      afterEventSeq: 3,
      afterRoomEventSeq: 2
    });
  });
});

function ownerEcho(overrides: Partial<OwnerDeckConfirmationMessage> = {}): OwnerDeckConfirmationMessage {
  return {
    type: "owner-deck-confirmation",
    schema: OWNER_DECK_CONFIRMATION_SCHEMA,
    roomId: SESSION.roomId,
    playerId: SESSION.playerId,
    rulesetId: OFFICIAL_RULESET_ID,
    roomVersion: 4,
    roomEventSeq: 4,
    catalog: { dataVersion: "server-v1", digest: "sha256:server-catalog" },
    deck: { mainDeck: [{ cardId: "owner-only-card", quantity: 3 }] },
    ...overrides
  };
}

describe("owner-only deck transport", () => {
  it("restores a new page's private witness only after resume welcome and matching room", () => {
    storage.setItem("riftbound.desktop-client.session",
      JSON.stringify({ ...SESSION, serverUrl: SERVER_URL }));
    const fresh = createHarness();
    expect(fresh.ownerConfirmations).toEqual([]);
    expect(fresh.client.resumeStoredSession()).toBe(true);
    const socket = latestSocket();
    socket.open();
    expect(socket.sentJson().at(-1)).toMatchObject({
      type: "hello", roomId: SESSION.roomId, resumeToken: SESSION.resumeToken
    });
    socket.receive(ownerEcho());
    expect(fresh.ownerConfirmations).toEqual([]);
    socket.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: SESSION, resumed: true });
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4,
      self: { deckSubmitted: true } });
    expect(fresh.ownerConfirmations).toEqual([]);
    socket.receive(ownerEcho());
    expect(fresh.ownerConfirmations).toMatchObject([{
      deck: ownerEcho().deck, roomId: SESSION.roomId, playerId: SESSION.playerId,
      serverUrl: SERVER_URL
    }]);
    expect(JSON.parse(storage.getItem("riftbound.desktop-client.session")!))
      .toEqual({ ...SESSION, serverUrl: SERVER_URL });
  });

  it("accepts only the current authenticated seat and exact waiting room clock", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4, self: { deckSubmitted: true } });
    for (const invalid of [
      ownerEcho({ roomId: "other-room" }), ownerEcho({ playerId: "player-2" }),
      ownerEcho({ rulesetId: DUEL_RULESET_ID }), ownerEcho({ roomVersion: 3 }),
      ownerEcho({ roomEventSeq: 3 }), ownerEcho({ roomEventSeq: 5 }),
      ownerEcho({ deck: null }),
      { ...ownerEcho(), requestId: "fake-ack" }
    ]) socket.receive(invalid);
    expect(harness.ownerConfirmations).toEqual([]);
    socket.receive(ownerEcho());
    expect(harness.ownerConfirmations).toHaveLength(1);
    expect(harness.ownerConfirmations[0]).toMatchObject({
      playerId: SESSION.playerId, serverUrl: SERVER_URL,
      socketGeneration: expect.any(Number), catalog: { dataVersion: "server-v1" }
    });
    socket.receive(ownerEcho());
    expect(harness.ownerConfirmations).toHaveLength(2);
    receiveRoom(socket, { roomVersion: 5, roomEventSeq: 5, self: { deckSubmitted: true } });
    expect(harness.ownerConfirmations.at(-1)).toBeNull();
    socket.receive(ownerEcho());
    expect(harness.ownerConfirmations.at(-1)).toBeNull();
    expect(harness.ownerConfirmations).toHaveLength(3);
  });

  it("requires a private non-null deck even when the public seat says submitted", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4, self: { deckSubmitted: true } });
    socket.receive(ownerEcho({ deck: null }));
    expect(harness.ownerConfirmations).toEqual([]);
    socket.receive(ownerEcho());
    receiveRoom(socket, { roomVersion: 5, roomEventSeq: 5,
      self: { deckSubmitted: false } });
    socket.receive(ownerEcho({ roomVersion: 5, roomEventSeq: 5 }));
    expect(harness.ownerConfirmations).toEqual([expect.objectContaining({ deck: ownerEcho().deck }), null]);
    socket.receive(ownerEcho({ roomVersion: 5, roomEventSeq: 5, deck: null }));
    expect(harness.ownerConfirmations.at(-1)).toMatchObject({ deck: null });
  });

  it("accepts a join echo after its authenticated welcome and stages a match echo before its room", () => {
    const harness = createHarness();
    const socket = connect(harness);
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
    expect(harness.client.joinRoom("Alice", SESSION.roomId)).toBe(true);
    socket.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: SESSION, resumed: false });
    receiveRoom(socket, { roomVersion: 1, roomEventSeq: 1 });
    socket.receive(ownerEcho({ roomVersion: 1, roomEventSeq: 1, deck: null }));
    expect(harness.ownerConfirmations.at(-1)).toMatchObject({ deck: null });
    socket.receive(ownerEcho({ roomVersion: 2, roomEventSeq: 2 }));
    expect(harness.ownerConfirmations.at(-1)).toMatchObject({ deck: null });
    receiveRoom(socket, { roomVersion: 2, roomEventSeq: 2, self: { deckSubmitted: true } });
    expect(harness.ownerConfirmations.at(-1)).toMatchObject({ deck: ownerEcho().deck });
  });

  it("discards unsolicited pre-welcome echoes instead of promoting them after identity changes", () => {
    const harness = createHarness();
    const socket = connect(harness);
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION });
    expect(harness.client.createRoom("Alice")).toBe(true);
    socket.receive(ownerEcho({ roomVersion: 1, roomEventSeq: 1 }));
    socket.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: SESSION, resumed: false });
    receiveRoom(socket, { roomVersion: 1, roomEventSeq: 1,
      self: { deckSubmitted: true } });
    expect(harness.ownerConfirmations).toEqual([]);
    socket.receive(ownerEcho({ roomVersion: 1, roomEventSeq: 1 }));
    expect(harness.ownerConfirmations).toHaveLength(1);
  });

  it("does not stage a forged future echo before the first authenticated room", () => {
    const harness = createHarness();
    const socket = connect(harness);
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: SESSION, resumed: true });
    socket.receive(ownerEcho({ roomVersion: 20, roomEventSeq: 20 }));
    receiveRoom(socket, { roomVersion: 20, roomEventSeq: 20,
      self: { deckSubmitted: true } });
    expect(harness.ownerConfirmations).toEqual([]);
    socket.receive(ownerEcho({ roomVersion: 20, roomEventSeq: 20 }));
    expect(harness.ownerConfirmations).toHaveLength(1);
  });

  it("does not promote a staged future echo against an intervening newer room", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4,
      self: { deckSubmitted: true } });
    socket.receive(ownerEcho({ roomVersion: 5, roomEventSeq: 5 }));
    expect(harness.ownerConfirmations).toEqual([]);
    receiveRoom(socket, { roomVersion: 6, roomEventSeq: 6,
      self: { deckSubmitted: true } });
    expect(harness.ownerConfirmations).toEqual([]);
    socket.receive(ownerEcho({ roomVersion: 5, roomEventSeq: 5 }));
    expect(harness.ownerConfirmations).toEqual([]);
    socket.receive(ownerEcho({ roomVersion: 6, roomEventSeq: 6 }));
    expect(harness.ownerConfirmations).toHaveLength(1);
  });

  it("never treats a private echo as an ACK for submit, set-ready, or a command", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4, self: { deckSubmitted: true } });
    expect(harness.client.setReadyTracked(true)).not.toBeNull();
    const request = socket.sentJson().at(-1)!;
    socket.receive(ownerEcho());
    expect(harness.ownerConfirmations).toHaveLength(1);
    expect(harness.requestPending).toEqual([true]);
    expect(harness.roomReceipts).toEqual([]);
    socket.receive({ type: "request-result", requestId: request.requestId, ok: true,
      roomVersion: 5, roomEventSeq: 5 });
    expect(harness.requestPending).toEqual([true, false]);
    expect(harness.roomReceipts).toHaveLength(1);
    expect(harness.client.pass()).toBe(true);
    socket.receive(ownerEcho());
    expect(harness.pending).toEqual([true]);
    expect(harness.client.pass()).toBe(false);
  });

  it("keeps a submit pending until request-result even after matching room and private echo", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();
    receiveRoom(socket, { roomVersion: 3, roomEventSeq: 3 });
    expect(harness.client.submitDeck({ mainDeck: [
      { cardId: "owner-only-card", quantity: 3 }
    ] })).toBe(true);
    const request = socket.sentJson().at(-1)!;
    receiveRoom(socket, { roomVersion: 4, roomEventSeq: 4,
      self: { deckSubmitted: true } });
    socket.receive(ownerEcho());
    expect(harness.ownerConfirmations).toHaveLength(1);
    expect(harness.requestPending).toEqual([true]);
    expect(harness.roomReceipts).toEqual([]);
    socket.receive({ type: "request-result", requestId: request.requestId,
      ok: true, roomVersion: 4, roomEventSeq: 4 });
    expect(harness.requestPending).toEqual([true, false]);
    expect(harness.roomReceipts).toMatchObject([{
      requestType: "submit-deck", requestId: request.requestId
    }]);
  });

  it("discards prior socket, server, and identity proofs across reconnect", () => {
    const harness = createPlayableClient();
    const first = latestSocket();
    receiveRoom(first, { roomVersion: 4, roomEventSeq: 4, self: { deckSubmitted: true } });
    first.receive(ownerEcho());
    expect(harness.ownerConfirmations.at(-1)?.serverUrl).toBe(SERVER_URL);
    first.serverClose();
    expect(harness.ownerConfirmations.at(-1)).toBeNull();
    first.receive(ownerEcho());
    vi.advanceTimersByTime(1_000);
    const second = latestSocket();
    second.open();
    second.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: SESSION, resumed: true });
    second.receive(ownerEcho());
    expect(harness.ownerConfirmations.at(-1)).toBeNull();
    receiveRoom(second, { roomVersion: 4, roomEventSeq: 4, self: { deckSubmitted: true } });
    second.receive(ownerEcho());
    expect(harness.ownerConfirmations.at(-1)).toMatchObject({ deck: ownerEcho().deck });
    harness.client.connect("ws://127.0.0.1:9000/ws");
    expect(harness.ownerConfirmations.at(-1)).toBeNull();
    expect(harness.ownerConfirmations).toHaveLength(4);
  });
});

function createHarness(): Harness {
  const statuses: GameClientStatus[] = [];
  const sessions: Array<ClientSession | null> = [];
  const projections: Array<GameProjection | null> = [];
  const errors: string[] = [];
  const rooms: Array<string | null> = [];
  const handshakes: boolean[] = [];
  const pending: boolean[] = [];
  const roomViews: Array<RoomView | null> = [];
  const gameEvents: GameEvent[][] = [];
  const roomEvents: RoomEvent[][] = [];
  const requestPending: boolean[] = [];
  const roomReceipts: Harness["roomReceipts"] = [];
  const roomFailures: string[] = [];
  const ownerConfirmations: Array<OwnerDeckConfirmation | null> = [];
  const handlers: GameClientHandlers = {
    onStatus: status => statuses.push(status),
    onSession: session => sessions.push(session),
    onProjection: projection => projections.push(projection),
    onError: error => errors.push(error),
    onRoom: roomId => rooms.push(roomId),
    onHandshake: ready => handshakes.push(ready),
    onPendingCommand: value => pending.push(value),
    onRoomView: room => roomViews.push(room),
    onOwnerDeckConfirmation: confirmation => ownerConfirmations.push(confirmation),
    onEvents: events => gameEvents.push([...events]),
    onRoomEvents: events => roomEvents.push([...events]),
    onPendingRequest: value => requestPending.push(value),
    onRoomRequestResult: receipt => roomReceipts.push(receipt),
    onRoomRequestFailure: failure => roomFailures.push(failure.requestId)
  };
  const client = new GameClient(handlers);
  clients.push(client);
  return {
    client,
    statuses,
    sessions,
    projections,
    errors,
    rooms,
    handshakes,
    pending,
    roomViews,
    gameEvents,
    roomEvents,
    requestPending,
    roomReceipts,
    roomFailures,
    ownerConfirmations
  };
}

function connect(harness: Harness): FakeWebSocket {
  harness.client.connect(SERVER_URL);
  return latestSocket();
}

function createPlayableClient(): Harness {
  const harness = createHarness();
  const socket = connect(harness);
  socket.open();
  socket.receive({
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    session: SESSION,
    resumed: true
  });
  receiveProjection(socket, 1);
  return harness;
}

function receiveProjection(socket: FakeWebSocket, version: number): void {
  socket.receive({
    type: "projection",
    roomId: SESSION.roomId,
    projection: makeProjection(version)
  });
}

function receiveRoom(
  socket: FakeWebSocket,
  overrides: {
    self?: Partial<RoomPlayer>;
    opponent?: Partial<RoomPlayer>;
  } & Partial<Omit<RoomView, "players">> = {}
): void {
  const self = {
    id: SESSION.playerId,
    name: "Alice",
    connected: true,
    ready: false,
    deckSubmitted: false,
    ...overrides.self
  };
  const opponent = {
    id: "player-2",
    name: "Bob",
    connected: true,
    ready: false,
    deckSubmitted: false,
    ...overrides.opponent
  };
  const { self: _self, opponent: _opponent, ...room } = overrides;
  socket.receive({
    type: "room",
    room: {
      roomId: SESSION.roomId,
      status: "waiting",
      rulesetId: OFFICIAL_RULESET_ID,
      version: 1,
      roomVersion: 1,
      roomEventSeq: 1,
      players: [self, opponent],
      ...room
    }
  });
}

function makeGameEvent(
  seq: number,
  overrides: Partial<GameEvent> = {}
): GameEvent {
  return {
    type: "turn-passed",
    seq,
    turnNumber: 1,
    activePlayerId: SESSION.playerId,
    playerId: SESSION.playerId,
    ...overrides
  } as GameEvent;
}

function makeRoomEvent(
  seq: number,
  overrides: Partial<RoomEvent> = {}
): RoomEvent {
  return {
    type: "deck-submitted",
    seq,
    roomId: SESSION.roomId,
    playerId: SESSION.playerId,
    ...overrides
  };
}

function makeProjection(version: number): GameProjection {
  return {
    version,
    eventSeq: Math.max(0, version - 1),
    phase: "main",
    turnNumber: 1,
    activePlayerId: SESSION.playerId,
    winnerPlayerId: null,
    prompt: null,
    waitingForPlayerId: null,
    players: [
      {
        id: SESSION.playerId,
        name: "Alice",
        life: 20,
        mana: 1,
        handCount: 0,
        hand: []
      },
      {
        id: "player-2",
        name: "Bob",
        life: 20,
        mana: 1,
        handCount: 0,
        hand: []
      }
    ],
    events: []
  };
}

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("No fake socket was created");
  return socket;
}

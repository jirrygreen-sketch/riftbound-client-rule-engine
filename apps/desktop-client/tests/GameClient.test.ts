import {
  PROTOCOL_VERSION,
  type ClientSession,
  type GameProjection
} from "@riftbound/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameClient,
  normalizeServerUrl,
  type GameClientHandlers,
  type GameClientStatus
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

  it("clears a pending command on disconnect and resumes from the stored session", () => {
    const harness = createPlayableClient();
    const first = latestSocket();

    expect(harness.client.pass()).toBe(true);
    first.serverClose();

    expect(harness.pending).toEqual([true, false]);
    expect(harness.projections.at(-1)).toBeNull();
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
    expect(harness.client.pass()).toBe(true);
    expect(second.sentJson().at(-1)).toMatchObject({ expectedVersion: 3 });
  });

  it("clears a pending command after the acknowledgement timeout", () => {
    const harness = createPlayableClient();
    const socket = latestSocket();

    expect(harness.client.pass()).toBe(true);
    vi.advanceTimersByTime(10_000);

    expect(harness.pending).toEqual([true, false]);
    expect(harness.errors.at(-1)).toContain("超时");
    expect(harness.client.pass()).toBe(true);
    expect(socket.sentJson().filter(message => message.type === "command")).toHaveLength(2);
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
  const handlers: GameClientHandlers = {
    onStatus: status => statuses.push(status),
    onSession: session => sessions.push(session),
    onProjection: projection => projections.push(projection),
    onError: error => errors.push(error),
    onRoom: roomId => rooms.push(roomId),
    onHandshake: ready => handshakes.push(ready),
    onPendingCommand: value => pending.push(value)
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
    pending
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

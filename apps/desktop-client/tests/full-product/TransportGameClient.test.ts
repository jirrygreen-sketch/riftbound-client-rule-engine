import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { PROTOCOL_VERSION, type ClientSession } from "@riftbound/protocol";
import {
  GameClient,
  type GameClientHandlers
} from "../../src/net/GameClient";

const SERVER_URL = "ws://127.0.0.1:8787/ws";
const SESSION: ClientSession = {
  roomId: "room-1",
  playerId: "player-1",
  resumeToken: "resume-token-1"
};

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
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
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
    this.emit("open");
  }

  receive(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map(payload => JSON.parse(payload) as Record<string, unknown>);
  }

  private emit(type: string, event: unknown): void {
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

describe("full-product GameClient transport commands", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001"
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeWebSocket.reset();
  });

  it("sends targets as part of the idempotent command payload", () => {
    const harness = createConnectedClient();
    const socket = FakeWebSocket.instances.at(-1)!;

    expect(harness.client.playCard("hand-1", [
      { kind: "object", objectId: "object-1" },
      { kind: "player", playerId: "player-2" }
    ])).toBe(true);

    const command = socket.sentJson().find(message => message.type === "command")!;
    expect(command).toMatchObject({
      type: "command",
      expectedVersion: 2,
      command: {
        type: "play-card",
        instanceId: "hand-1",
        targets: [
          { kind: "object", objectId: "object-1" },
          { kind: "player", playerId: "player-2" }
        ]
      }
    });
    expect(harness.pending).toEqual([true]);
  });

  it("keeps targets on idempotent command retries", () => {
    const harness = createConnectedClient();
    const first = FakeWebSocket.instances.at(-1)!;
    const targets = [{ kind: "object", objectId: "object-1" }] as const;

    expect(harness.client.playCard("hand-1", targets)).toBe(true);
    const original = first.sentJson().find(message => message.type === "command")!;
    first.serverClose();
    vi.advanceTimersByTime(1_000);

    const second = FakeWebSocket.instances.at(-1)!;
    second.open();
    second.receive({
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      session: SESSION,
      resumed: true
    });
    second.receive({
      type: "projection",
      roomId: SESSION.roomId,
      projection: makeProjection(3)
    });
    const retry = second.sentJson().find(
      message =>
        message.type === "command" &&
        message.commandId === original.commandId
    )!;
    expect(retry).toMatchObject({
      expectedVersion: 3,
      command: {
        type: "play-card",
        instanceId: "hand-1",
        targets: [{ kind: "object", objectId: "object-1" }]
      }
    });
    expect(harness.pending).toEqual([true]);
  });

  it("sends concede through the same command pending pipeline", () => {
    const harness = createConnectedClient();
    const socket = FakeWebSocket.instances.at(-1)!;

    expect(harness.client.concede()).toBe(true);
    const command = socket.sentJson().find(message => message.type === "command")!;
    expect(command).toMatchObject({
      command: { type: "concede" },
      expectedVersion: 2
    });
    expect(harness.client.concede()).toBe(false);
  });

  it("keeps the confirmed projection visible after stale-version", () => {
    const harness = createConnectedClient();
    const socket = FakeWebSocket.instances.at(-1)!;

    expect(harness.client.pass()).toBe(true);
    const command = socket.sentJson().find(message => message.type === "command")!;
    socket.receive({
      type: "error",
      requestId: command.requestId,
      code: "stale-version",
      message: "stale"
    });

    expect(harness.pending).toEqual([true, false]);
    expect(harness.projections.at(-1)).toMatchObject({ version: 2 });
  });
});

function createConnectedClient() {
  const pending: boolean[] = [];
  const projections: Array<Record<string, unknown> | null> = [];
  const errors: string[] = [];
  const handlers: GameClientHandlers = {
    onStatus: () => {},
    onSession: () => {},
    onProjection: projection => projections.push(projection as never),
    onError: message => errors.push(message),
    onRoom: () => {},
    onHandshake: () => {},
    onPendingCommand: value => pending.push(value)
  };
  const client = new GameClient(handlers);
  client.connect(SERVER_URL);
  const socket = FakeWebSocket.instances.at(-1)!;
  socket.open();
  socket.receive({
    type: "welcome",
    protocolVersion: PROTOCOL_VERSION,
    session: SESSION,
    resumed: true
  });
  socket.receive({
    type: "projection",
    roomId: SESSION.roomId,
    projection: makeProjection(2)
  });
  return { client, pending, projections, errors };
}

function makeProjection(version: number): Record<string, unknown> {
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

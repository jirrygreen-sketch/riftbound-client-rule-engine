import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseV2MatchOptions } from "../../src/hooks/useV2Match";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<{ dependencies?: readonly unknown[]; cleanup: (() => void) | void }>,
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0
}));

const sessionProbe = vi.hoisted(() => ({
  create: vi.fn(),
  starts: 0,
  stops: 0,
  discards: 0,
  initialSessions: [] as unknown[],
  snapshot: {
    state: {
      viewerPlayerId: null,
      projection: null,
      stateVersion: 0,
      eventSeq: 0,
      events: [],
      bufferedEvents: [],
      choice: { status: "none", choice: { status: "none" }, startedAt: null, expiresAt: null, answerable: false },
      connectionStatus: "disconnected",
      lastError: null,
      rejectedMessages: 0
    },
    room: null,
    session: null,
    pendingCommandIds: [],
    error: null,
    reconnectUrl: "",
    lastReceipt: null
  }
}));

vi.mock("react", () => ({
  useState<T>(initial: T | (() => T)): [T, (next: T | ((current: T) => T)) => void] {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) {
      hooks.states[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    }
    return [hooks.states[index] as T, (next: T | ((current: T) => T)) => {
      hooks.states[index] = typeof next === "function"
        ? (next as (current: T) => T)(hooks.states[index] as T)
        : next;
    }];
  },
  useRef<T>(initial: T): { current: T } {
    const index = hooks.refIndex++;
    if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
    return hooks.refs[index] as { current: T };
  },
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void {
    const index = hooks.effectIndex++;
    const previous = hooks.effects[index];
    const changed = previous === undefined || dependencies === undefined || previous.dependencies === undefined ||
      dependencies.length !== previous.dependencies.length ||
      dependencies.some((value, dependencyIndex) =>
        !Object.is(value, previous.dependencies?.[dependencyIndex]));
    if (!changed) return;
    if (typeof previous?.cleanup === "function") previous.cleanup();
    hooks.effects[index] = { dependencies, cleanup: effect() };
  }
}));

vi.mock("../../src/full-product/v2/V2MatchSession", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/full-product/v2/V2MatchSession")>();
  return {
    ...original,
    createV2MatchSessionController: (
      options: ConstructorParameters<typeof original.V2MatchSessionController>[0],
      initialSession: ConstructorParameters<typeof original.V2MatchSessionController>[1]
    ) => {
      sessionProbe.create(options, initialSession);
      sessionProbe.initialSessions.push(initialSession);
      return {
        reconnectUrl: options.serverUrl,
        subscribe(listener: (snapshot: unknown) => void) {
          listener(sessionProbe.snapshot);
          return () => undefined;
        },
        start() { sessionProbe.starts += 1; },
        stop() { sessionProbe.stops += 1; },
        discardRecoverySession() { sessionProbe.discards += 1; },
        createRoom: vi.fn(), joinRoom: vi.fn(), submitDeck: vi.fn(),
        setReady: vi.fn(), sendCommand: vi.fn(), connect: vi.fn()
      } as unknown as original.V2MatchSessionController;
    }
  };
});

import { buildV2RoomUrl, useV2Match } from "../../src/hooks/useV2Match";
import {
  clearV2Session,
  readV2Session,
  V2_SESSION_STORAGE_KEY,
  writeV2Session,
  type V2SessionStorage
} from "../../src/full-product/v2/session-storage";
import type { V2Socket } from "../../src/transport/v2";

type StableTransportKey = {
  readonly enabled: boolean;
  readonly serverUrl: string | null;
  readonly socketFactory: (() => void) | undefined;
  readonly choiceTimeoutMs: number | undefined;
  readonly requestTimeoutMs: number | undefined;
};

function renderHook(options: UseV2MatchOptions) {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effectIndex = 0;
  return useV2Match(options);
}

beforeEach(() => {
  hooks.states.length = 0;
  hooks.refs.length = 0;
  for (const effect of hooks.effects) if (typeof effect.cleanup === "function") effect.cleanup();
  hooks.effects.length = 0;
  sessionProbe.create.mockClear();
  sessionProbe.starts = 0;
  sessionProbe.stops = 0;
  sessionProbe.discards = 0;
  sessionProbe.initialSessions.length = 0;
});

// React's effect dependency list mirrors this key. Session identity is
// intentionally absent: persisting a created room must not replace its socket.
function transportEffectKey(value: StableTransportKey): readonly unknown[] {
  return [value.enabled, value.serverUrl, value.socketFactory,
    value.choiceTimeoutMs, value.requestTimeoutMs];
}

// The hook's initialization path is deterministic: the resume identity is
// read only for a newly mounted connection. Existing session identity in
// later props never participates in the socket effect key above.
function initialResume(options: Pick<UseV2MatchOptions, "roomId" | "session">) {
  return options.roomId && options.session?.playerId && options.session.resumeToken
    ? { roomId: options.roomId, playerId: options.session.playerId, resumeToken: options.session.resumeToken }
    : null;
}

describe("useV2Match room URL", () => {
  it("binds the v2 route to the authenticated room without changing the server path", () => {
    expect(buildV2RoomUrl("ws://127.0.0.1:8787/ws", "room-7", {
      playerId: "alice",
      resumeToken: "resume-7"
    })).toBe("ws://127.0.0.1:8787/ws?roomId=room-7&playerId=alice&resumeToken=resume-7");
  });

  it("keeps session identity out of transport effect recreation and URL authority", () => {
    const socketFactory = () => undefined;
    const before: StableTransportKey = {
      enabled: true,
      serverUrl: "ws://127.0.0.1:8787/ws",
      socketFactory,
      choiceTimeoutMs: 30_000,
      requestTimeoutMs: 10_000
    };
    const withSession: StableTransportKey & { readonly roomId: string;
      readonly session: { readonly playerId: string; readonly resumeToken: string } } = {
      ...before,
      roomId: "room-7",
      session: { playerId: "alice", resumeToken: "private" }
    };
    expect(transportEffectKey(before)).toEqual(transportEffectKey(withSession));
    expect(before.serverUrl).toBe("ws://127.0.0.1:8787/ws");
    expect(before.serverUrl).not.toContain(withSession.roomId);
    expect(before.serverUrl).not.toContain(withSession.session.resumeToken);
    expect(initialResume(before)).toBeNull();
    expect(initialResume(withSession)).toEqual({
      roomId: "room-7", playerId: "alice", resumeToken: "private"
    });
  });

  it("exports the hook used by the production app and keeps callbacks stable", () => {
    expect(useV2Match).toBeTypeOf("function");
  });

  it("persists a created session without rebuilding or stopping the live controller", () => {
    const initial: UseV2MatchOptions = {
      enabled: true, serverUrl: "ws://127.0.0.1:8787/ws", roomId: null, session: null
    };
    renderHook(initial);
    expect(sessionProbe.create).toHaveBeenCalledTimes(1);
    expect(sessionProbe.initialSessions).toEqual([null]);
    expect(sessionProbe.starts).toBe(1);

    renderHook({ ...initial, roomId: "room-1",
      session: { playerId: "player-1", resumeToken: "resume-1" } });
    expect(sessionProbe.create).toHaveBeenCalledTimes(1);
    expect(sessionProbe.starts).toBe(1);
    expect(sessionProbe.stops).toBe(0);
  });

  it("drops the live controller's room and projection when leaving", () => {
    const client = renderHook({
      enabled: true, serverUrl: "ws://127.0.0.1:8787/ws", roomId: null, session: null
    });
    client.leaveRoom();
    expect(sessionProbe.discards).toBe(1);
  });
});

describe("useV2Match leave-room storage", () => {
  it("removes the persisted session so a reload cannot resume the finished room", () => {
    const values = new Map<string, string>();
    const storage: V2SessionStorage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: key => { values.delete(key); }
    };
    const session = { roomId: "finished-room", playerId: "player-1", resumeToken: "token" };
    expect(writeV2Session(storage, session)).toBe(true);
    expect(readV2Session(storage)).toEqual(session);

    expect(clearV2Session(storage)).toBe(true);
    expect(storage.getItem(V2_SESSION_STORAGE_KEY)).toBeNull();
    expect(readV2Session(storage)).toBeNull();
  });
});

describe("V2MatchSessionController leave room", () => {
  it("reconnects without a resume identity after clearing room and projection", async () => {
    const { V2MatchSessionController } = await vi.importActual<
      typeof import("../../src/full-product/v2/V2MatchSession")
    >("../../src/full-product/v2/V2MatchSession");
    const sockets: FakeV2Socket[] = [];
    const controller = new V2MatchSessionController({
      serverUrl: "ws://example.test",
      socketFactory: () => {
        const socket = new FakeV2Socket();
        sockets.push(socket);
        return socket;
      },
      reconnectDelayMs: 0
    }, { roomId: "finished-room", playerId: "player-1", resumeToken: "finished-token" });
    controller.start();
    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toMatchObject({
      type: "hello", roomId: "finished-room", resumeToken: "finished-token"
    });

    controller.discardRecoverySession();
    expect(controller.snapshot.session).toBeNull();
    expect(controller.snapshot.room).toBeNull();
    expect(controller.snapshot.state.projection).toBeNull();
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toEqual({
      type: "hello", protocolVersion: "2.0.0"
    });
    controller.stop();
  });
});

class FakeV2Socket implements V2Socket {
  readonly sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string): void { this.sent.push(data); }
  close(): void { this.onclose?.({}); }
  open(): void { this.onopen?.({}); }
}

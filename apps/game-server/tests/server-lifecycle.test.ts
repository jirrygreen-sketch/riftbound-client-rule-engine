import { describe, expect, it, vi } from "vitest";
import { createGameServer } from "../src/server.js";
import { InMemoryRoomStore } from "../src/room-store.js";

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class ControlledListRoomStore extends InMemoryRoomStore {
  constructor(private readonly listResult: Promise<readonly never[]>) {
    super();
  }

  override async list(): Promise<readonly unknown[]> {
    return this.listResult;
  }
}

class FailingListRoomStore extends InMemoryRoomStore {
  readonly listCalls: Promise<unknown>[] = [];

  override async list(): Promise<readonly never[]> {
    const failure = Promise.reject(new Error("Injected list failure"));
    this.listCalls.push(failure.catch(() => undefined));
    return failure;
  }
}

class CloseFailureRoomStore extends InMemoryRoomStore {
  closeCalls = 0;

  override close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closeCalls === 1) {
      return Promise.reject(new Error("Injected close failure"));
    }
    return Promise.resolve();
  }
}

describe("game server lifecycle", () => {
  it("does not listen when stop is requested during room restoration", async () => {
    const list = new Deferred<readonly never[]>();
    const store = new ControlledListRoomStore(list.promise);
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      roomStore: store
    });

    const started = server.start();
    const stopped = server.stop();
    list.resolve([]);
    await Promise.all([started, stopped]);

    expect(server.httpServer.listening).toBe(false);
    await expect(server.start()).rejects.toThrow("cannot start while stopped");
  });

  it("is idempotent while started and rejects a second concurrent start", async () => {
    const list = new Deferred<readonly never[]>();
    const store = new ControlledListRoomStore(list.promise);
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      roomStore: store
    });

    const first = server.start();
    const second = server.start();
    list.resolve([]);
    await first;
    await second;
    await expect(server.start()).resolves.toBeUndefined();

    expect(server.httpServer.listening).toBe(true);
    await server.stop();
  });

  it("keeps the list failure and closes the room store", async () => {
    const store = new FailingListRoomStore();
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      roomStore: store
    });

    await expect(server.start()).rejects.toThrow("Injected list failure");
    expect(server.httpServer.listening).toBe(false);
    await expect(server.start()).rejects.toThrow("cannot start while stopped");
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it("keeps the listen failure and closes the room store", async () => {
    const blocker = await import("node:net").then(net =>
      new Promise<{ server: import("node:net").Server; port: number }>(resolve => {
        const blockerServer = net.createServer();
        blockerServer.listen(0, "127.0.0.1", () => {
          const address = blockerServer.address();
          if (!address || typeof address === "string") {
            throw new Error("Blocker did not expose a TCP port");
          }
          resolve({ server: blockerServer, port: address.port });
        });
      })
    );
    const store = new CloseFailureRoomStore();
    const server = createGameServer({
      host: "127.0.0.1",
      port: blocker.port,
      roomStore: store
    });

    try {
      const failure = await server.start().then(
        () => {
          throw new Error("Expected the occupied port to fail startup");
        },
        (error: Error & { cause?: unknown }) => error
      );
      expect(failure.message).toMatch(/listen EADDRINUSE/i);
      expect((failure.cause as Error).message).toBe("Injected close failure");
      expect(server.httpServer.listening).toBe(false);
      expect(store.closeCalls).toBe(1);
      await expect(server.start()).rejects.toThrow("cannot start while stopped");
    } finally {
      await new Promise<void>(resolve => blocker.server.close(() => resolve()));
    }
  });

  it("can retry stop after a cleanup close failure", async () => {
    const store = new CloseFailureRoomStore();
    const server = createGameServer({
      host: "127.0.0.1",
      port: 0,
      roomStore: store
    });
    await server.start();

    await expect(server.stop()).rejects.toThrow("Injected close failure");
    expect(server.httpServer.listening).toBe(false);
    await expect(server.stop()).resolves.toBeUndefined();
    expect(store.closeCalls).toBe(2);
  });
});

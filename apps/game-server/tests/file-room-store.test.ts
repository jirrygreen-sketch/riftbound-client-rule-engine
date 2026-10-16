import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FOUNDATION_RULESET_ID, RULESET_ID } from "@riftbound/protocol";
import { FileEventStore } from "@riftbound/replay-core/full-product";
import { GameRoom } from "../src/room.js";
import { FileRoomStore } from "../src/file-room-store.js";
import { PersistentRoomArchiveStore } from "../src/storage/persistent-room-store.js";
import type { CardCatalogRuntime } from "../src/card-catalog.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await chmod(directory, 0o777).catch(() => undefined);
    const expectedPrefix = path.resolve(
      tmpdir(),
      "riftbound-file-room-store-"
    );
    if (path.resolve(directory).startsWith(expectedPrefix)) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "riftbound-file-room-store-")
  );
  temporaryDirectories.push(directory);
  return directory;
}

function makeStore(
  directory: string,
  catalog: () => Promise<CardCatalogRuntime> = loadCatalog
): FileRoomStore {
  return new FileRoomStore(directory, catalog);
}

async function loadCatalog(): Promise<CardCatalogRuntime> {
  throw new Error("Unexpected Foundation catalog load");
}

function room(roomId: string, rulesetId = RULESET_ID): GameRoom {
  return new GameRoom(roomId, rulesetId);
}

function hashRoomId(roomId: string): string {
  return createHash("sha256").update(roomId, "utf8").digest("hex");
}

function roomPath(directory: string, roomId: string): string {
  return path.join(directory, hashRoomId(roomId));
}

type FileEventStoreInternals = {
  handle?: {
    datasync(): Promise<void>;
  };
};

type PersistentRoomArchiveStoreInternals = {
  close?: () => Promise<void>;
};

async function saveRoom(
  store: FileRoomStore,
  gameRoom: GameRoom
): Promise<void> {
  await store.create(gameRoom);
  await store.save(gameRoom);
}

describe("FileRoomStore", () => {
  it("creates in process, saves archives, and caches restored rooms", async () => {
    const directory = await temporaryDirectory();
    const first = makeStore(directory);
    const created = room("room-restart");
    await first.create(created);
    expect(await first.count()).toBe(1);
    expect(await first.get("room-restart")).toBe(created);

    await first.save(created);
    await first.close();

    const second = makeStore(directory);
    const restored = await second.get("room-restart");
    if (!restored) throw new Error("The room archive was not restored");
    expect(await second.get("room-restart")).toBe(restored);
    expect(restored.roomId).toBe("room-restart");
    expect(restored.exportArchive()).toEqual(created.exportArchive());
    await second.close();
  });

  it("rejects duplicate create calls without writing an empty seat archive", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("room-duplicate");
    await store.create(created);
    await expect(store.create(room("room-duplicate")))
      .rejects.toThrow("already exists");
    await expect(stat(path.join(roomPath(directory, "room-duplicate"), "archive.log")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await store.close();
  });

  it("returns null for an unknown room without creating a room directory", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    await expect(store.get("missing-room")).resolves.toBeNull();
    expect(await readdir(directory)).toEqual([]);
    await store.close();
  });

  it("does not expose a path traversal with a crafted roomId", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("../escape");
    await saveRoom(store, created);

    const restored = await store.get("../escape");
    if (!restored) throw new Error("The crafted room was not restored");
    expect(restored.roomId).toBe("../escape");
    await store.close();
  });

  it("propagates invalid log errors without losing room state", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("room-invalid-log");
    await saveRoom(store, created);
    await store.close();

    const logPath = path.join(roomPath(directory, "room-invalid-log"), "archive.log");
    await writeFile(logPath, "not-json\n", "utf8");

    const reopened = makeStore(directory);
    await expect(reopened.get("room-invalid-log"))
      .rejects.toThrow("not valid JSON");
    await reopened.close();
  });

  it("restores Foundation rooms only after loading the catalog", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("room-foundation", FOUNDATION_RULESET_ID);
    await saveRoom(store, created);
    await store.close();

    let loadCount = 0;
    const foundation = makeStore(directory, async () => {
      loadCount += 1;
      throw new Error("Injected Foundation catalog failure");
    });
    await expect(foundation.get("room-foundation")).rejects.toThrow(
      "Injected Foundation catalog failure"
    );
    expect(loadCount).toBe(1);
    await foundation.close();
  });

  it("lists all valid hashed room directories after a restart", async () => {
    const directory = await temporaryDirectory();
    const first = makeStore(directory);
    const roomOne = room("room-list-1");
    const roomTwo = room("room-list-2");
    await saveRoom(first, roomOne);
    await saveRoom(first, roomTwo);
    await first.close();

    const reopened = makeStore(directory);
    const restored = await reopened.list();
    expect(restored.map(current => current.roomId).sort()).toEqual([
      "room-list-1",
      "room-list-2"
    ]);
    expect(await reopened.count()).toBe(2);
    expect(await reopened.get("room-list-1")).toBe(
      restored.find(current => current.roomId === "room-list-1")
    );
    await reopened.close();
  });

  it("recovers an incomplete log tail during list without parsing it as a record", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("room-damaged-tail");
    await saveRoom(store, created);
    await store.close();

    const logPath = path.join(roomPath(directory, "room-damaged-tail"), "archive.log");
    const log = await readFile(logPath);
    if (!log.includes(0x0a)) {
      throw new Error("The valid archive had no complete record");
    }
    await writeFile(logPath, Buffer.concat([log, Buffer.from("{\"incomplete\"", "utf8")]));

    const reopened = makeStore(directory);
    const restored = await reopened.list();
    expect(restored.map(current => current.roomId)).toEqual(["room-damaged-tail"]);
    expect(restored[0].exportArchive()).toEqual(created.exportArchive());
    expect(await reopened.get("room-damaged-tail")).toBe(restored[0]);
    await reopened.close();
  });

  it("does not create a room when a hashed directory has an empty or incomplete log", async () => {
    const directory = await temporaryDirectory();
    const hashedPath = roomPath(directory, "room-empty-tail");
    await mkdir(hashedPath, { recursive: true });
    await writeFile(path.join(hashedPath, "archive.log"), "{\"incomplete\"", "utf8");

    const store = makeStore(directory);
    expect(await store.list()).toEqual([]);
    expect(await store.count()).toBe(0);
    await store.close();
  });

  it("rejects an archive whose event does not match its hashed directory", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("room-identity-directory");
    await saveRoom(store, created);
    await store.close();

    const sourcePath = roomPath(directory, "room-identity-directory");
    const wrongPath = roomPath(directory, "room-identity-other");
    await rename(sourcePath, wrongPath);

    const reopened = makeStore(directory);
    await expect(reopened.list()).rejects.toThrow(
      "Room archive directory does not match its roomId"
    );
    await reopened.close();
  });

  it("removes a room, closes its archive handle, and deletes only its directory", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const first = room("room-remove-1");
    const second = room("room-remove-2");
    await saveRoom(store, first);
    await saveRoom(store, second);

    await store.remove(first);
    expect(await store.count()).toBe(1);
    await expect(store.get("room-remove-1")).resolves.toBeNull();
    expect(await store.get("room-remove-2")).toBe(second);
    await store.close();
  });

  it("removes only the exact registered room object", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("room-remove-identity");
    await saveRoom(store, created);

    await expect(store.remove(room("room-remove-identity")))
      .rejects.toThrow("is not registered");
    expect(await store.get("room-remove-identity")).toBe(created);
    expect((await stat(path.join(
      roomPath(directory, "room-remove-identity"),
      "archive.log"
    ))).isFile()).toBe(true);
    await store.close();
  });

  it("does not remove a non-directory or symlink room path", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("room-remove-non-directory");
    await store.create(created);
    const roomDirectory = roomPath(directory, "room-remove-non-directory");

    try {
      const symlinkPath = path.join(directory, "outside-target");
      await mkdir(symlinkPath, { recursive: true });
      await writeFile(path.join(symlinkPath, "keep.txt"), "kept", "utf8");
      temporaryDirectories.push(symlinkPath);
      await symlink(symlinkPath, roomDirectory, "junction");

      await expect(store.remove(created)).rejects.toThrow(
        "symbolic or non-directory room path"
      );
      await expect(readFile(path.join(symlinkPath, "keep.txt"), "utf8"))
        .resolves.toBe("kept");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      await rm(roomDirectory, { force: true });
      await writeFile(roomDirectory, "not-a-directory", "utf8");
      await expect(store.remove(created)).rejects.toThrow(
        "symbolic or non-directory room path"
      );
    }
    await store.close();
  });

  it("becomes unavailable after a durable write failure and preserves the log", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const created = room("room-write-fails");
    await store.create(created);
    await store.save(created);

    const logPath = path.join(roomPath(directory, "room-write-fails"), "archive.log");
    const originalAppendEvents = FileEventStore.prototype.appendEvents;
    FileEventStore.prototype.appendEvents = async function injectedAppendEvents(
      this: FileEventStore,
      ...args: Parameters<typeof originalAppendEvents>
    ) {
      const handle = (this as unknown as FileEventStoreInternals).handle;
      if (!handle) throw new Error("The archive store was not open");
      const originalDatasync = handle.datasync.bind(handle);
      handle.datasync = async () => {
        throw new Error("Injected datasync failure");
      };
      try {
        return await originalAppendEvents.apply(this, args);
      } finally {
        handle.datasync = originalDatasync;
      }
    };
    try {
      await expect(store.save(created)).rejects.toThrow("Injected datasync failure");
    } finally {
      FileEventStore.prototype.appendEvents = originalAppendEvents;
    }
    await expect(store.get("room-write-fails"))
      .rejects.toThrow("unavailable after a write failure");
    await expect(store.create(room("room-after-failure")))
      .rejects.toThrow("unavailable after a write failure");
    await expect(store.list())
      .rejects.toThrow("unavailable after a write failure");

    const beforeLog = await readFile(logPath, "utf8");
    await store.remove(created);
    expect(await store.count()).toBe(0);
    await expect(store.get("room-write-fails"))
      .rejects.toThrow("unavailable after a write failure");
    expect(await readFile(logPath, "utf8")).toBe(beforeLog);
    expect((await stat(logPath)).isFile()).toBe(true);

    const reopened = makeStore(directory);
    const restored = await reopened.list();
    expect(restored.map(current => current.roomId)).toEqual(["room-write-fails"]);
    await reopened.close();
    await store.close();
  });

  it("closes remaining stores when one close fails and keeps failed stores retryable", async () => {
    const directory = await temporaryDirectory();
    const store = makeStore(directory);
    const first = room("room-close-first");
    const second = room("room-close-second");
    await saveRoom(store, first);
    await saveRoom(store, second);

    const originalClose = PersistentRoomArchiveStore.prototype.close;
    let injectionCalls = 0;
    PersistentRoomArchiveStore.prototype.close = async function injectedClose(
      this: PersistentRoomArchiveStore
    ) {
      injectionCalls += 1;
      if (injectionCalls <= 2) {
        throw new Error("Injected handle close failure");
      }
      return originalClose.call(this);
    };

    let firstError: unknown;
    let retryError: unknown;
    try {
      firstError = await store.close().catch(error => error);
      retryError = await store.close().then(
        () => undefined,
        error => error
      );
    } finally {
      PersistentRoomArchiveStore.prototype.close = originalClose;
    }

    expect(firstError).toBeInstanceOf(Error);
    expect(injectionCalls).toBe(4);
    expect((firstError as Error).message).toContain("Injected handle close failure");
    expect(retryError).toBeUndefined();

    const reopened = makeStore(directory);
    const restored = await reopened.list();
    expect(restored.map(current => current.roomId).sort()).toEqual([
      "room-close-first",
      "room-close-second"
    ]);
    await reopened.close();
  });
});

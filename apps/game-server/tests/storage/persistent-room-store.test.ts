import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PersistentRoomArchiveStore } from "../../src/storage/persistent-room-store.js";

function archive(schemaVersion: number, marker: string) {
  return {
    schemaVersion,
    roomId: "room-1",
    rulesetId: "riftbound-foundation",
    seats: [{
      id: "player-1",
      name: "Alice",
      resumeToken: "token",
      deck: { mainDeck: [] },
      ready: true
    }],
    state: null,
    roomVersion: 3,
    roomEventSeq: 2,
    roomEventLog: [{ type: "room-created", seq: 1 }],
    processedCommands: [],
    marker
  };
}

describe("PersistentRoomArchiveStore", () => {
  it("saves opaque archives and loads the last durable record", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const store = new PersistentRoomArchiveStore(directory);

    await store.save("room-1", archive(1, "first"));
    await store.save("room-1", archive(1, "second"));

    expect(await store.load("room-1")).toEqual(archive(1, "second"));
    await store.close();

    const reopened = new PersistentRoomArchiveStore(directory);
    expect(await reopened.load("room-1")).toEqual(archive(1, "second"));
    expect(reopened.recovery.truncatedTailBytes).toBe(0);
    await reopened.close();
  });

  it("returns null for an empty archive", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const store = new PersistentRoomArchiveStore(directory);
    expect(await store.load("room-empty")).toBeNull();
    await store.close();
  });

  it("binds one store to one room and validates roomId", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const store = new PersistentRoomArchiveStore(directory);
    await store.save("room-bound", archive(1, "first"));

    await expect(store.load("other-room")).rejects.toThrow("another room");
    await expect(store.save("other-room", archive(1, "first")))
      .rejects.toThrow("another room");
    await expect(store.save("room-bound", null as never))
      .rejects.toThrow("Room archive must be a JSON object");
    await store.close();
  });

  it("recovers the last valid archive after a damaged tail", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const store = new PersistentRoomArchiveStore(directory);
    await store.save("room-tail", archive(1, "valid"));
    await store.close();

    const logPath = path.join(directory, "archive.log");
    const validSize = (await stat(logPath)).size;
    await appendFile(logPath, '{"partial":"record"');
    const damagedSize = (await stat(logPath)).size;

    const reopened = new PersistentRoomArchiveStore(directory);
    expect(await reopened.load("room-tail")).toEqual(archive(1, "valid"));
    expect(reopened.recovery.headEventSeq).toBe(1);
    expect(reopened.recovery.truncatedTailBytes)
      .toBe(damagedSize - validSize);
    expect((await stat(logPath)).size).toBe(validSize);
    await reopened.close();

    const continued = new PersistentRoomArchiveStore(directory);
    await continued.save("room-tail", archive(1, "next"));
    expect(await continued.load("room-tail")).toEqual(archive(1, "next"));
    await continued.close();
  });

  it("writes archive events durably and keeps snapshot generation disabled", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const store = new PersistentRoomArchiveStore(directory);
    const first = archive(1, "first");
    await store.save("room-fsync", first);

    const eventLog = await readFile(path.join(directory, "archive.log"), "utf8");
    const records = eventLog.trimEnd().split("\n").map(line => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      record: {
        formatVersion: 1,
        kind: "events",
        entries: [{
          eventSeq: 1,
          event: {
            type: "room-archive",
            roomId: "room-fsync",
            archive: first
          }
        }]
      }
    });
    expect(records[0].checksum).toHaveLength(64);

    await expect(stat(path.join(directory, "archive.snapshot.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await store.close();
  });

  it("keeps a durable save successful when the snapshot cache cannot be written", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const store = new PersistentRoomArchiveStore(directory);
    await store.load("room-snapshot");

    await mkdir(path.join(directory, "archive.snapshot.json"));
    const saved = archive(1, "durable");
    await expect(store.save("room-snapshot", saved)).resolves.toBeUndefined();
    expect(await store.load("room-snapshot")).toEqual(saved);
    await store.close();
  });

  it("reopens from the log when snapshot cache states are invalid", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const snapshotPath = path.join(directory, "archive.snapshot.json");
    const store = new PersistentRoomArchiveStore(directory);
    const saved = archive(1, "valid");
    await store.save("room-cache", saved);
    await store.close();

    await mkdir(snapshotPath);
    const directorySnapshot = new PersistentRoomArchiveStore(directory);
    expect(await directorySnapshot.load("room-cache")).toEqual(saved);
    await directorySnapshot.close();

    await rm(snapshotPath, { recursive: true });
    await writeFile(snapshotPath, "not-json", "utf8");
    const corruptSnapshot = new PersistentRoomArchiveStore(directory);
    expect(await corruptSnapshot.load("room-cache")).toEqual(saved);
    await corruptSnapshot.close();

    await writeFile(snapshotPath, JSON.stringify({
      checksum: "0".repeat(64),
      record: {
        formatVersion: 1,
        eventSeq: 999,
        payload: { archive: archive(1, "ahead") }
      }
    }), "utf8");
    const aheadSnapshot = new PersistentRoomArchiveStore(directory);
    expect(await aheadSnapshot.load("room-cache")).toEqual(saved);
    await aheadSnapshot.close();
  });

  it("rejects rebinding a closed store to another room", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const store = new PersistentRoomArchiveStore(directory);
    await store.save("room-closed", archive(1, "saved"));
    await store.close();

    await expect(store.load("other-room")).rejects.toThrow("another room");
    await expect(store.save("other-room", archive(1, "other")))
      .rejects.toThrow("another room");
  });

  it("fails when the authoritative log has a checksum error", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-archive-"));
    const logPath = path.join(directory, "archive.log");
    const store = new PersistentRoomArchiveStore(directory);
    await store.save("room-log", archive(1, "first"));
    await store.save("room-log", archive(1, "second"));
    await store.close();

    const lines = (await readFile(logPath, "utf8")).trimEnd().split("\n");
    const first = JSON.parse(lines[0]);
    if (first.checksum.startsWith("0")) {
      first.checksum = first.checksum.replace("0", "1");
    } else {
      first.checksum = first.checksum.replace(/[^0]/, "0");
    }
    lines[0] = JSON.stringify(first);
    await writeFile(logPath, `${lines.join("\n")}\n`, "utf8");

    const reopened = new PersistentRoomArchiveStore(directory);
    await expect(reopened.load("room-log")).rejects.toThrow("failed its checksum");
  });
});

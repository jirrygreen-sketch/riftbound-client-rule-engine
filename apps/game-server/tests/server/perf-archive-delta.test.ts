import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  stableStringify,
  type JsonObject
} from "@riftbound/replay-core/full-product";
import {
  PersistentRoomArchiveStore,
  type PersistentRoomArchiveDeltaEvent
} from "../../src/storage/persistent-room-store.js";
import { FileRoomStore } from "../../src/file-room-store.js";
import { GameRoom } from "../../src/room.js";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function directory(): Promise<string> {
  const scratch = path.join(
    "/tmp",
    process.env.SWARM_TASK ?? "RIFT-1087-perf-e-archive-delta"
  );
  await mkdir(scratch, { recursive: true });
  const created = await mkdtemp(path.join(scratch, "archive-delta-"));
  directories.push(created);
  return created;
}

function digest(value: JsonObject): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function archive(version: number, label = "state"): JsonObject {
  return {
    schemaVersion: 1,
    roomId: "seed-room",
    version,
    label,
    opaqueJournalPayload: "stable-".repeat(512),
    nested: {
      values: [version, version + 1, version + 2],
      hidden: { token: `private-${version}` }
    }
  };
}

function encodeRecord(record: JsonObject): string {
  return `${JSON.stringify({
    checksum: digest(record),
    record
  })}\n`;
}

async function writeLegacyLog(
  root: string,
  archives: readonly JsonObject[]
): Promise<void> {
  const entries = archives.map((value, index) => ({
    eventSeq: index + 1,
    event: {
      type: "room-archive",
      roomId: "seed-room",
      archive: value
    }
  }));
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "archive.log"),
    encodeRecord({ formatVersion: 1, kind: "events", entries }),
    "utf8"
  );
}

describe("RIFT-1087-E private archive delta", () => {
  it("restores the production room through compact archive history", async () => {
    const root = await directory();
    const store = new FileRoomStore(root, async () => {
      throw new Error("Synthetic rooms do not load a catalog");
    });
    const room = new GameRoom("seed-room");
    await store.create(room);
    await store.save(room);
    const first = room.exportArchive();
    const firstConnection = room.join("Alice", () => undefined, "archive-first");
    const firstSession = {
      roomId: room.roomId,
      playerId: firstConnection.playerId,
      resumeToken: firstConnection.resumeToken
    };
    room.sendChat(firstSession, firstConnection.connectionId, "archive-message", "private room text", "archive-request", () => undefined);
    await store.save(room);
    expect(firstConnection.playerId).toBe("player-1");
    const expected = room.exportArchive();
    await store.close();

    const log = await readFile(
      path.join(
        root,
        createHash("sha256").update("seed-room").digest("hex"),
        "archive.log"
      ),
      "utf8"
    );
    const records = log.trimEnd().split("\n").map(line => JSON.parse(line));
    expect(records.at(-1).record.entries[0].event.type).toBe("room-archive-delta");
    expect(records.length).toBe(2);

    const reopened = new FileRoomStore(root, async () => {
      throw new Error("Synthetic rooms do not load a catalog");
    });
    const restored = await reopened.get("seed-room");
    expect(restored?.exportArchive()).toEqual(expected);
    expect(restored?.exportArchive()).not.toEqual(first);
    await reopened.close();
  });

  it("loads a legacy complete-snapshot log and appends a compatible delta", async () => {
    const root = await directory();
    const first = archive(1, "legacy");
    const second = archive(2, "legacy updated");
    await writeLegacyLog(root, [first, second]);

    const store = new PersistentRoomArchiveStore(root);
    expect(await store.load("seed-room")).toEqual(second);
    await store.save("seed-room", archive(3, "current"));
    await store.close();

    const log = await readFile(path.join(root, "archive.log"), "utf8");
    const records = log.trimEnd().split("\n").map(line => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0].record.entries[0].event.type).toBe("room-archive");
    expect(records[1].record.entries[0].event).toMatchObject({
      type: "room-archive-delta",
      roomId: "seed-room",
      formatVersion: 1,
      baseArchiveSeq: 2
    });

    const reopened = new PersistentRoomArchiveStore(root);
    expect(await reopened.load("seed-room")).toEqual(archive(3, "current"));
    const history = await reopened.readArchives("seed-room");
    expect(history.archives.map(record => record.archive)).toEqual([
      first,
      second,
      archive(3, "current")
    ]);
    await reopened.close();
  });

  it("rejects a digest-valid delta whose base digest is wrong", async () => {
    const root = await directory();
    const first = archive(1);
    const next = archive(2);
    await writeLegacyLog(root, [first]);
    const delta: PersistentRoomArchiveDeltaEvent = {
      type: "room-archive-delta",
      roomId: "seed-room",
      formatVersion: 1,
      baseArchiveSeq: 1,
      baseArchiveDigest: "0".repeat(64),
      archiveDigest: digest(next),
      operations: [
        JSON.stringify(["version"]), "set", JSON.stringify(next.version),
        JSON.stringify(["label"]), "set", JSON.stringify(next.label),
        JSON.stringify(["nested"]), "set", JSON.stringify(next.nested)
      ]
    };
    await appendFile(path.join(root, "archive.log"), encodeRecord({
      formatVersion: 1,
      kind: "events",
      entries: [{ eventSeq: 2, event: delta }]
    }), "utf8");

    const store = new PersistentRoomArchiveStore(root);
    await expect(store.load("seed-room")).rejects.toThrow(
      "Room archive delta base digest mismatch"
    );
    await store.close();
  });

  it("keeps the compact representation while paging full archive history", async () => {
    const root = await directory();
    const store = new PersistentRoomArchiveStore(root);
    const snapshots: JsonObject[] = [archive(1)];
    let current = snapshots[0]!;
    for (let index = 2; index <= 8; index += 1) {
      current = {
        ...current,
        version: index,
        journal: Array.from({ length: index * 8 }, (_, entry) => ({
          seq: entry + 1,
          payload: `journal-entry-${entry}`
        }))
      };
      snapshots.push(current);
    }
    for (const snapshot of snapshots) await store.save("seed-room", snapshot);
    await store.close();

    const bytes = (await stat(path.join(root, "archive.log"))).size;
    const reopened = new PersistentRoomArchiveStore(root);
    const pageOne = await reopened.readArchives("seed-room", 0, 3);
    const pageTwo = await reopened.readArchives(
      "seed-room",
      pageOne.nextCursor,
      3
    );
    const pageThree = await reopened.readArchives(
      "seed-room",
      pageTwo.nextCursor,
      3
    );
    expect([...pageOne.archives, ...pageTwo.archives, ...pageThree.archives]
      .map(record => record.archive)).toEqual(snapshots);
    expect(pageThree.hasMore).toBe(false);
    const deltaBytes = (await readFile(path.join(root, "archive.log"), "utf8"))
      .trimEnd().split("\n").slice(1)
      .reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);
    const completeTailBytes = snapshots.slice(1).reduce((total, snapshot) =>
      total + Buffer.byteLength(JSON.stringify({
        checksum: "0".repeat(64),
        record: {
          formatVersion: 1,
          kind: "events",
          entries: [{
            eventSeq: snapshot.version + 1,
            event: { type: "room-archive", roomId: "seed-room", archive: snapshot }
          }]
        }
      })) + 1, 0);
    expect(bytes).toBeGreaterThan(0);
    expect(deltaBytes).toBeLessThan(completeTailBytes);
    await reopened.close();
  });

  it("repairs an interrupted final write before replaying the last durable archive", async () => {
    const root = await directory();
    const store = new PersistentRoomArchiveStore(root);
    await store.save("seed-room", archive(1));
    await store.save("seed-room", archive(2));
    await store.close();

    const logPath = path.join(root, "archive.log");
    const durable = await readFile(logPath);
    await appendFile(logPath, '{"checksum":"interrupted","record":', "utf8");

    const reopened = new PersistentRoomArchiveStore(root);
    expect({ ...(await reopened.load("seed-room") as JsonObject) }).toEqual(archive(2));
    expect(reopened.recovery.headEventSeq).toBe(2);
    expect(reopened.recovery.truncatedTailBytes).toBeGreaterThan(0);
    expect((await readFile(logPath)).equals(durable)).toBe(true);
    await reopened.close();
  });

  it("recovers a delta log after a process-like write interruption leaves a garbage tail", async () => {
    const root = await directory();
    const store = new PersistentRoomArchiveStore(root);
    await store.save("seed-room", archive(1));
    await store.save("seed-room", archive(2));
    await store.save("seed-room", archive(3));
    const expected = archive(3);
    await store.close();

    const logPath = path.join(root, "archive.log");
    const durable = await readFile(logPath);
    await appendFile(logPath, "{\"checksum\":\"terminated\",\"record\":{", "utf8");

    const reopened = new PersistentRoomArchiveStore(root);
    expect(await reopened.load("seed-room")).toEqual(expected);
    expect(reopened.recovery.truncatedTailBytes).toBeGreaterThan(0);
    expect((await readFile(logPath)).equals(durable)).toBe(true);
    await reopened.close();
  });

  it("recovers the last durable delta after SIGTERM interrupts an in-flight append", async () => {
    const root = await directory();
    const store = new PersistentRoomArchiveStore(root);
    await store.save("seed-room", archive(1));
    await store.save("seed-room", archive(2));
    const expected = archive(2);
    await store.close();

    const script = [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const handle = fs.openSync(path.join(process.argv[1], "archive.log"), "a");',
      'fs.writeSync(handle, \'{"checksum":"sigterm","record":\');',
      'process.stdout.write("partial-tail\\n");',
      "setInterval(() => undefined, 1000);"
    ].join("\n");
    const writer = spawn(process.execPath, ["-e", script, root], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Signal writer timed out")), 30_000);
      writer.stdout.once("data", () => { clearTimeout(timer); resolve(); });
      writer.once("error", error => { clearTimeout(timer); reject(error); });
      writer.once("exit", code => {
        if (code !== null && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`Signal writer exited with ${code}`));
        }
      });
    });
    writer.kill("SIGTERM");
    await new Promise<void>(resolve => writer.once("close", () => resolve()));

    const reopened = new PersistentRoomArchiveStore(root);
    expect(await reopened.load("seed-room")).toEqual(expected);
    expect(reopened.recovery.truncatedTailBytes).toBeGreaterThan(0);
    await reopened.close();
  }, 120_000);

});

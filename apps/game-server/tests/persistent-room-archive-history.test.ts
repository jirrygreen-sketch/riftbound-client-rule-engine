import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FileEventStore,
  stableStringify,
  type JsonObject
} from "@riftbound/replay-core/full-product";
import { PersistentRoomArchiveStore } from "../src/storage/persistent-room-store.js";

/**
 * Focused coverage for the read-only private archive history reader. All
 * scratch fixture directories live under this task's own artifact directory
 * (never the shared system temp root) and are removed after the run.
 */
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const scratchRoot = path.join(
  repoRoot,
  "outputs/coordination/full-product-20261012/task-artifacts/private-room-archive-history-reader/.scratch"
);

const createdDirectories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(scratchRoot, "history-"));
  createdDirectories.push(directory);
  return directory;
}

/** Opaque, token-free fixture archive with a nested object to exercise clones. */
function archive(marker: string): JsonObject {
  return {
    schemaVersion: 1,
    marker,
    nested: { value: marker, list: [1, 2, 3] }
  };
}

function encodeRecord(record: JsonObject): string {
  const checksum = createHash("sha256")
    .update(stableStringify(record))
    .digest("hex");
  return `${JSON.stringify({ checksum, record })}\n`;
}

/** Write a single checksum-valid room-archive log record from a raw event. */
async function writeSingleEventLog(
  directory: string,
  event: JsonObject
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const record: JsonObject = {
    formatVersion: 1,
    kind: "events",
    entries: [{ eventSeq: 1, event }]
  };
  await writeFile(
    path.join(directory, "archive.log"),
    encodeRecord(record),
    "utf8"
  );
}

beforeAll(async () => {
  await mkdir(scratchRoot, { recursive: true });
});

afterAll(async () => {
  for (const directory of createdDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
  await rm(scratchRoot, { recursive: true, force: true });
});

describe("PersistentRoomArchiveStore.readArchives", () => {
  it("returns the earliest archive first in log order and keeps the tail load unchanged", async () => {
    const directory = await makeDirectory();
    const store = new PersistentRoomArchiveStore(directory);
    await store.save("room-1", archive("first"));
    await store.save("room-1", archive("second"));
    await store.save("room-1", archive("third"));

    const page = await store.readArchives("room-1");
    expect(page.archives.map(record => record.archiveSeq)).toEqual([1, 2, 3]);
    expect(page.archives[0]!.archive).toEqual(archive("first"));
    expect(page.archives[2]!.archive).toEqual(archive("third"));
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBe(3);

    // The reader is additive: the existing tail load is untouched.
    expect(await store.load("room-1")).toEqual(archive("third"));
    await store.close();
  });

  it("pages with an exclusive cursor and reports hasMore/nextCursor", async () => {
    const directory = await makeDirectory();
    const store = new PersistentRoomArchiveStore(directory);
    for (const marker of ["a", "b", "c", "d", "e"]) {
      await store.save("room-page", archive(marker));
    }

    const pageOne = await store.readArchives("room-page", 0, 2);
    expect(pageOne.archives.map(record => record.archiveSeq)).toEqual([1, 2]);
    expect(pageOne.hasMore).toBe(true);
    expect(pageOne.nextCursor).toBe(2);

    const pageTwo = await store.readArchives("room-page", pageOne.nextCursor, 2);
    expect(pageTwo.archives.map(record => record.archiveSeq)).toEqual([3, 4]);
    expect(pageTwo.hasMore).toBe(true);
    expect(pageTwo.nextCursor).toBe(4);

    const pageThree = await store.readArchives(
      "room-page",
      pageTwo.nextCursor,
      2
    );
    expect(pageThree.archives.map(record => record.archiveSeq)).toEqual([5]);
    expect(pageThree.hasMore).toBe(false);
    expect(pageThree.nextCursor).toBe(5);

    const exhausted = await store.readArchives("room-page", pageThree.nextCursor);
    expect(exhausted.archives).toEqual([]);
    expect(exhausted.hasMore).toBe(false);
    expect(exhausted.nextCursor).toBe(5);
    await store.close();
  });

  it("rejects unsafe pagination arguments and a cursor ahead of the log", async () => {
    const directory = await makeDirectory();
    const store = new PersistentRoomArchiveStore(directory);
    await store.save("room-args", archive("only"));

    await expect(store.readArchives("room-args", -1)).rejects.toThrow(
      "afterArchiveSeq must be a safe integer"
    );
    await expect(store.readArchives("room-args", 0, 0)).rejects.toThrow(
      "limit must be a safe integer"
    );
    await expect(store.readArchives("room-args", 0, 1.5)).rejects.toThrow(
      "limit must be a safe integer"
    );
    await expect(
      store.readArchives("room-args", 0, Number.MAX_SAFE_INTEGER + 1)
    ).rejects.toThrow("limit must be a safe integer");

    // A cursor beyond the durable head is fail-closed, not a silent empty page.
    await expect(store.readArchives("room-args", 2)).rejects.toThrow(
      "ahead of the event log"
    );
    await store.close();
  });

  it("rejects a room id that contradicts the instance binding or the log", async () => {
    const directory = await makeDirectory();
    const bound = new PersistentRoomArchiveStore(directory);
    await bound.save("room-bound", archive("one"));

    await expect(bound.readArchives("room-other")).rejects.toThrow(
      "bound to another room"
    );
    await bound.close();

    // A fresh instance binds to the requested id, then rejects on the event.
    const fresh = new PersistentRoomArchiveStore(directory);
    await expect(fresh.readArchives("room-other")).rejects.toThrow(
      "another room"
    );
    await fresh.close();
  });

  it("rejects checksum-valid records that are not room-archive events (corruption shape check, not a MAC)", async () => {
    const fixtures: readonly {
      readonly label: string;
      readonly event: JsonObject;
      readonly message: string;
    }[] = [
      {
        label: "foreign-room",
        event: { type: "room-archive", roomId: "room-forged", archive: archive("x") },
        message: "another room"
      },
      {
        label: "wrong-type",
        event: { type: "room-mutation", roomId: "room-1", archive: archive("x") },
        message: "not a room-archive event"
      },
      {
        label: "missing-archive",
        event: { type: "room-archive", roomId: "room-1" },
        message: "does not contain a JSON archive"
      }
    ];

    for (const fixture of fixtures) {
      const directory = await makeDirectory();
      await writeSingleEventLog(directory, fixture.event);

      // Prove the durable codec accepts the rewritten record: the checksum is
      // recomputed consistently, so a raw store reads it without complaint.
      // The rejection below is therefore a shape/room check, not authentication.
      const raw = await FileEventStore.open({
        eventLogPath: path.join(directory, "archive.log"),
        snapshotPath: path.join(directory, "archive.snapshot.json"),
        snapshotMode: "ignored"
      });
      const rawWindow = await raw.readEvents(0, 10);
      expect(rawWindow.events, fixture.label).toHaveLength(1);
      await raw.close();

      const store = new PersistentRoomArchiveStore(directory);
      await expect(
        store.readArchives("room-1"),
        fixture.label
      ).rejects.toThrow(fixture.message);
      await store.close();
    }
  });

  it("detaches returned archives so caller mutation cannot pollute later reads or the tail", async () => {
    const directory = await makeDirectory();
    const store = new PersistentRoomArchiveStore(directory);
    await store.save("room-clone", archive("original"));
    await store.save("room-clone", archive("tail"));

    const page = await store.readArchives("room-clone");
    const record = page.archives[0]!;
    expect(record.archive).toEqual(archive("original"));

    const mutable = record.archive as Record<string, unknown>;
    mutable.marker = "tampered";
    const nested = mutable.nested as Record<string, unknown> | undefined;
    if (nested) nested.value = "tampered";

    const reread = await store.readArchives("room-clone");
    expect(reread.archives[0]!.archive).toEqual(archive("original"));
    expect(await store.load("room-clone")).toEqual(archive("tail"));
    await store.close();
  });

  it("preserves genesis across close/reopen and keeps history after damaged-tail recovery", async () => {
    const directory = await makeDirectory();
    const store = new PersistentRoomArchiveStore(directory);
    await store.save("room-recover", archive("genesis"));
    await store.save("room-recover", archive("middle"));
    await store.save("room-recover", archive("tail"));
    await store.close();

    const logPath = path.join(directory, "archive.log");
    await appendFile(logPath, '{"partial":"record"');

    const reopened = new PersistentRoomArchiveStore(directory);
    const page = await reopened.readArchives("room-recover", 0);
    expect(page.archives.map(record => record.archiveSeq)).toEqual([1, 2, 3]);
    expect(page.archives[0]!.archive).toEqual(archive("genesis"));
    expect(page.archives[2]!.archive).toEqual(archive("tail"));
    expect(reopened.recovery.headEventSeq).toBe(3);
    expect(reopened.recovery.truncatedTailBytes).toBeGreaterThan(0);
    expect(await reopened.load("room-recover")).toEqual(archive("tail"));

    // History continues after recovery, retaining the earlier records.
    await reopened.save("room-recover", archive("fourth"));
    const continued = await reopened.readArchives("room-recover", 0);
    expect(continued.archives.map(record => record.archiveSeq)).toEqual([
      1, 2, 3, 4
    ]);
    await reopened.close();
  });
});

import assert from "node:assert/strict";
import { readFile, mkdtemp, appendFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FileEventStore,
  IdempotencyConflictError,
  PersistenceClosedError,
  PersistenceError
} from "../../dist/full-product/index.js";

function event(eventSeq, type = "game-event") {
  return { eventSeq, event: { type, value: eventSeq } };
}

function eventInput(firstSeq, count) {
  return Array.from({ length: count }, (_, index) => event(firstSeq + index));
}

function request(requestId, command, commandId = `${requestId}:command`) {
  return { requestId, commandId, command };
}

function corruptChecksum(checksum) {
  assert.equal(checksum.length, 64);
  return checksum.startsWith("0")
    ? checksum.replace("0", "1")
    : checksum.replace(/[^0]/, "0");
}

async function testDir(name) {
  const directory = await mkdtemp(path.join(tmpdir(), `riftbound-${name}-`));
  return {
    eventLogPath: path.join(directory, "events.log"),
    snapshotPath: path.join(directory, "snapshot.json"),
    directory
  };
}

test("appends ordered event records and recovers the complete log", async () => {
  const paths = await testDir("ordered");
  const store = await FileEventStore.open(paths);
  assert.equal(store.headEventSeq, 0);
  assert.equal(store.recovery.headEventSeq, 0);
  assert.equal(store.recovery.truncatedTailBytes, 0);

  const first = await store.appendEvents({
    events: eventInput(1, 2),
    request: request("request-1", { type: "pass" }),
    response: { ok: true, eventSeq: 2 }
  });
  assert.equal(first.duplicate, false);
  assert.deepEqual(first.events.map(item => item.eventSeq), [1, 2]);
  assert.equal(first.events[0].request.requestId, "request-1");
  assert.equal(first.events[0].request.eventSeq, 2);

  const second = await store.appendEvents({ events: eventInput(3, 1) });
  assert.equal(second.events[0].request, undefined);
  assert.equal(store.headEventSeq, 3);

  await store.close();
  const reopened = await FileEventStore.open(paths);
  assert.equal(reopened.headEventSeq, 3);
  assert.equal(reopened.recovery.headEventSeq, 3);
  assert.equal(reopened.recovery.truncatedTailBytes, 0);

  const window = await reopened.readEvents(0);
  assert.deepEqual(window.events.map(item => item.eventSeq), [1, 2, 3]);
  assert.deepEqual(window.events.map(item => item.event.value), [1, 2, 3]);
  assert.equal(window.events[0].request.response.eventSeq, 2);
  assert.equal(window.events[2].request, undefined);
  await reopened.close();
});

test("backfill uses eventSeq cursors, limits, and rejects a future cursor", async () => {
  const paths = await testDir("backfill");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({ events: eventInput(1, 3) });

  const firstPage = await store.readEvents(0, 2);
  assert.deepEqual(firstPage.events.map(item => item.eventSeq), [1, 2]);
  assert.equal(firstPage.afterEventSeq, 0);
  assert.equal(firstPage.headEventSeq, 3);

  const secondPage = await store.readEvents(firstPage.events.at(-1).eventSeq, 2);
  assert.deepEqual(secondPage.events.map(item => item.eventSeq), [3]);
  assert.equal(secondPage.afterEventSeq, 2);

  await assert.rejects(
    () => store.readEvents(4),
    /afterEventSeq is ahead of the event log/
  );
  await store.close();
});

test("saves an atomic snapshot and replays only events after its checkpoint", async () => {
  const paths = await testDir("snapshot");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({ events: eventInput(1, 2) });
  const snapshot = await store.saveSnapshot({
    eventSeq: 2,
    payload: { version: 7, eventSeq: 2 }
  });
  assert.deepEqual(snapshot, { eventSeq: 2, payload: { version: 7, eventSeq: 2 } });

  await store.appendEvents({ events: eventInput(3, 1) });
  await store.close();

  const reopened = await FileEventStore.open(paths);
  assert.deepEqual(await reopened.readSnapshot(), snapshot);
  const window = await reopened.readEvents(snapshot.eventSeq);
  assert.deepEqual(window.events.map(item => item.eventSeq), [3]);

  const next = await reopened.appendEvents({ events: eventInput(4, 1) });
  assert.equal(next.events[0].eventSeq, 4);
  await reopened.close();
});

test("a duplicate requestId returns the original events and response", async () => {
  const paths = await testDir("duplicate");
  const store = await FileEventStore.open(paths);
  const command = { type: "pass", playerId: "player-1" };

  const first = await store.appendEvents({
    events: eventInput(1, 2),
    request: request("request-1", command),
    response: { ok: true, eventSeq: 2 }
  });
  const duplicate = await store.appendEvents({
    events: eventInput(1, 2),
    request: request("request-1", { playerId: "player-1", type: "pass" }),
    response: { ok: true, eventSeq: 2 }
  });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.events, first.events);
  assert.equal(store.headEventSeq, 2);

  const requestOnly = await store.appendRequest({
    request: request("request-2", command),
    response: { ok: true }
  });
  assert.equal(requestOnly.duplicate, false);
  assert.equal(requestOnly.request.eventSeq, null);
  const duplicateRequestOnly = await store.appendRequest({
    request: request("request-2", command),
    response: { ok: true }
  });
  assert.equal(duplicateRequestOnly.duplicate, true);
  assert.deepEqual(duplicateRequestOnly.request, requestOnly.request);

  await store.close();
  const reopened = await FileEventStore.open(paths);
  assert.equal((await reopened.getRequest("request-1")).response.eventSeq, 2);
  assert.equal((await reopened.getRequest("request-2")).eventSeq, null);
  await reopened.close();
});

test("requestId reuse with another command is rejected without growing the log", async () => {
  const paths = await testDir("idempotency-conflict");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({
    events: eventInput(1, 1),
    request: { requestId: "request-1", command: { type: "pass" } }
  });
  const before = (await stat(paths.eventLogPath)).size;

  await assert.rejects(
    () => store.appendEvents({
    events: eventInput(2, 1),
    request: { requestId: "request-1", command: { type: "play-card" } }
    }),
    IdempotencyConflictError
  );
  const requestDuplicate = await store.appendRequest({
    request: { requestId: "request-1", command: { type: "pass" } }
  });
  assert.equal(requestDuplicate.duplicate, true);

  assert.equal((await stat(paths.eventLogPath)).size, before);
  assert.equal(store.headEventSeq, 1);
  const window = await store.readEvents(0);
  assert.deepEqual(window.events.map(item => item.eventSeq), [1]);
  await store.close();
});

test("rejects non-contiguous writes and leaves the head unchanged", async () => {
  const paths = await testDir("sequence");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({ events: eventInput(1, 1) });

  await assert.rejects(
    () => store.appendEvents({ events: [event(3)] }),
    /event sequences must be contiguous; expected 2/
  );
  await assert.rejects(
    () => store.appendEvents({ events: [] }),
    /events must contain at least one event/
  );
  assert.equal(store.headEventSeq, 1);

  const next = await store.appendEvents({ events: eventInput(2, 1) });
  assert.equal(next.events[0].eventSeq, 2);
  await store.close();
});

test("truncates an incomplete final record and continues the sequence", async () => {
  const paths = await testDir("crash");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({
    events: eventInput(1, 1),
    request: request("request-1", { type: "pass" })
  });
  await store.close();

  const completeSize = (await stat(paths.eventLogPath)).size;
  await appendFile(paths.eventLogPath, '{"partial":"record"');
  const truncatedSize = (await stat(paths.eventLogPath)).size;

  const reopened = await FileEventStore.open(paths);
  assert.equal(reopened.recovery.headEventSeq, 1);
  assert.equal(
    reopened.recovery.truncatedTailBytes,
    truncatedSize - completeSize
  );
  assert.equal((await stat(paths.eventLogPath)).size, completeSize);

  const appended = await reopened.appendEvents({ events: eventInput(2, 1) });
  assert.equal(appended.events[0].eventSeq, 2);
  await reopened.close();

  const recovered = await FileEventStore.open(paths);
  assert.equal(recovered.recovery.truncatedTailBytes, 0);
  assert.deepEqual(
    (await recovered.readEvents(0)).events.map(item => item.eventSeq),
    [1, 2]
  );
  await recovered.close();
});

test("rejects corruption before the final record instead of silently skipping it", async () => {
  const paths = await testDir("corruption");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({ events: eventInput(1, 1) });
  await store.appendEvents({ events: eventInput(2, 1) });
  await store.close();

  const lines = (await readFile(paths.eventLogPath, "utf8")).trimEnd().split("\n");
  const first = JSON.parse(lines[0]);
  first.checksum = corruptChecksum(first.checksum);
  lines[0] = JSON.stringify(first);
  await writeFile(paths.eventLogPath, `${lines.join("\n")}\n`, "utf8");

  await assert.rejects(
    () => FileEventStore.open(paths),
    /failed its checksum/
  );
});

test("a failed open closes the event log handle", async () => {
  const paths = await testDir("open-failure");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({ events: eventInput(1, 1) });
  await store.close();

  await writeFile(paths.snapshotPath, "not-json", "utf8");
  await assert.rejects(
    () => FileEventStore.open(paths),
    /not valid JSON/
  );

  assert.equal(process.getActiveResourcesInfo().includes("FileHandle"), false);
});

test("a partial record write poisons the store until reopen", async () => {
  const paths = await testDir("write-partial");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({ events: eventInput(1, 1) });
  const completeSize = (await stat(paths.eventLogPath)).size;

  const originalWrite = store.handle.write.bind(store.handle);
  let failNextWrite = true;
  store.handle.write = async (buffer, offset) => {
    if (failNextWrite) {
      failNextWrite = false;
      const result = await originalWrite(buffer.subarray(0, 1), offset);
      throw new Error("simulated interrupted write");
    }
    return originalWrite(buffer, offset);
  };

  await assert.rejects(
    () => store.appendEvents({ events: eventInput(2, 1) }),
    /simulated interrupted write/
  );
  assert.equal(store.headEventSeq, 1);
  await assert.rejects(
    () => store.appendEvents({ events: eventInput(2, 1) }),
    /unresolved failed write/
  );
  await store.close();
  assert.equal((await stat(paths.eventLogPath)).size, completeSize + 1);
  assert.equal(process.getActiveResourcesInfo().includes("FileHandle"), false);

  const reopened = await FileEventStore.open(paths);
  assert.equal(reopened.recovery.headEventSeq, 1);
  assert.equal(reopened.recovery.truncatedTailBytes, 1);
  const appended = await reopened.appendEvents({ events: eventInput(2, 1) });
  assert.equal(appended.events[0].eventSeq, 2);
  await reopened.close();

  const recovered = await FileEventStore.open(paths);
  assert.deepEqual(
    (await recovered.readEvents(0)).events.map(item => item.eventSeq),
    [1, 2]
  );
  await recovered.close();
});

test("a failed datasync poisons the store and leaves a restart-safe record", async () => {
  const paths = await testDir("datasync-failure");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({ events: eventInput(1, 1) });

  store.handle.datasync = async () => {
    throw new Error("simulated fsync failure");
  };
  await assert.rejects(
    () => store.appendEvents({ events: eventInput(2, 1) }),
    /simulated fsync failure/
  );
  assert.equal(store.headEventSeq, 1);
  await assert.rejects(
    () => store.appendRequest({ request: request("request-2", {}) }),
    /unresolved failed write/
  );
  await store.close();
  assert.equal(process.getActiveResourcesInfo().includes("FileHandle"), false);

  const reopened = await FileEventStore.open(paths);
  const survived = reopened.headEventSeq;
  assert.ok(survived === 1 || survived === 2);
  const nextSeq = survived + 1;
  const appended = await reopened.appendEvents({
    events: eventInput(nextSeq, 1)
  });
  assert.equal(appended.events[0].eventSeq, nextSeq);
  await reopened.close();
});

test("serialized writes are deterministic under concurrent callers", async () => {
  const paths = await testDir("concurrent");
  const store = await FileEventStore.open(paths);
  const uniqueWrites = Array.from({ length: 35 }, (_, index) => index + 1).map(
    eventSeq =>
      store.appendEvents({
        events: [event(eventSeq)],
        request: request(`request-${eventSeq}`, { seq: eventSeq })
      })
  );
  const outcomes = await Promise.all(uniqueWrites);
  const unique = outcomes;
  assert.deepEqual(
    unique.map(outcome => outcome.events[0].eventSeq),
    Array.from({ length: 35 }, (_, index) => index + 1)
  );
  assert.equal(unique.every(outcome => outcome.duplicate === false), true);
  assert.equal(store.headEventSeq, 35);
  await store.appendRequest({
    request: request("duplicate-request", { stable: true })
  });
  const duplicateOutcomes = await Promise.all(
    Array.from({ length: 10 }, () =>
      store.appendEvents({
        events: [event(1)],
        request: request("duplicate-request", { stable: true })
      })
    )
  );
  assert.equal(
    duplicateOutcomes.every(outcome => outcome.duplicate === true),
    true
  );

  const window = await store.readEvents(0);
  assert.deepEqual(
    window.events.map(item => item.eventSeq),
    Array.from({ length: 35 }, (_, index) => index + 1)
  );
  await assert.rejects(
    () =>
      store.appendEvents({
        events: [event(999)],
        request: request("request-1", { type: "play-card" })
      }),
    IdempotencyConflictError
  );
  assert.equal(store.headEventSeq, 35);
  await store.close();

  const reopened = await FileEventStore.open(paths);
  assert.equal(reopened.headEventSeq, 35);
  assert.equal((await reopened.getRequest("request-35")).eventSeq, 35);
  assert.equal((await reopened.getRequest("duplicate-request")).eventSeq, null);
  await reopened.close();
});

test("snapshots cannot bypass event-log validation", async () => {
  const paths = await testDir("snapshot-validation");
  const store = await FileEventStore.open(paths);
  await assert.rejects(
    () => store.saveSnapshot({ eventSeq: 1, payload: {} }),
    /snapshot cannot be ahead of the event log/
  );
  assert.equal(await stat(paths.snapshotPath).catch(() => null), null);

  await store.appendEvents({ events: eventInput(1, 1) });
  await store.saveSnapshot({ eventSeq: 1, payload: { version: 1 } });
  await store.close();

  const snapshotLine = await readFile(paths.snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotLine);
  snapshot.record.eventSeq = 2;
  await writeFile(
    paths.snapshotPath,
    JSON.stringify({
      ...snapshot,
      checksum: "0".repeat(64)
    })
  );

  await assert.rejects(
    () => FileEventStore.open(paths),
    /failed its checksum/
  );
});

test("ignored snapshots never affect authoritative log recovery", async () => {
  const paths = await testDir("snapshot-ignored");
  const options = { ...paths, snapshotMode: "ignored" };
  const store = await FileEventStore.open(options);
  await store.appendEvents({ events: eventInput(1, 2) });
  await store.saveSnapshot({ eventSeq: 1, payload: { version: 1 } });
  await store.close();

  await writeFile(paths.snapshotPath, "not-json", "utf8");
  let reopened = await FileEventStore.open(options);
  assert.equal(reopened.headEventSeq, 2);
  assert.equal(await reopened.readSnapshot(), null);
  await reopened.close();

  await writeFile(paths.snapshotPath, JSON.stringify({
    checksum: "0".repeat(64),
    record: { formatVersion: 1, eventSeq: 999, payload: {} }
  }), "utf8");
  reopened = await FileEventStore.open(options);
  assert.equal(reopened.headEventSeq, 2);
  assert.equal(await reopened.readSnapshot(), null);
  await reopened.close();
});

test("closed stores reject operations and stores cannot share paths", async () => {
  const paths = await testDir("closed");
  const store = await FileEventStore.open(paths);
  await store.appendEvents({ events: eventInput(1, 1) });
  await store.close();

  await assert.rejects(() => store.readEvents(0), PersistenceClosedError);
  await assert.rejects(() => store.readSnapshot(), PersistenceClosedError);
  await assert.rejects(() => store.getRequest("request-1"), PersistenceClosedError);
  await assert.rejects(
    () =>
      store.appendEvents({
        events: eventInput(2, 1),
        request: request("request-2", { type: "pass" })
      }),
    PersistenceClosedError
  );
  await assert.rejects(
    () => store.appendRequest({ request: request("request-3", {}) }),
    PersistenceClosedError
  );
  await assert.rejects(
    () => store.saveSnapshot({ eventSeq: 1, payload: {} }),
    PersistenceClosedError
  );
  await store.close();

  await assert.rejects(
    () =>
      FileEventStore.open({
        eventLogPath: paths.eventLogPath,
        snapshotPath: paths.eventLogPath
      }),
    PersistenceError
  );
});

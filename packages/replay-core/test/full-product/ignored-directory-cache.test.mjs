import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// POSIX-only suite. Both this guard and the runner's file selection come from
// scripts/run-tests.mjs, so they cannot drift apart. On an unsupported host the
// file registers no tests at all (never test.skip) and still reports zero skips,
// and the guard runs before the build is imported so a direct `node --test`
// invocation on such a host does not fail either.
import { fifoChildTimeoutMs, suiteRunsOnThisHost } from "../../scripts/run-tests.mjs";

if (!suiteRunsOnThisHost(fileURLToPath(import.meta.url))) {
  process.exit(0);
}

// Always use the isolated, freshly compiled copy; never consume the shared dist.
const dist = process.env.RIFTBOUND_REPLAY_TEST_DIST;
if (!dist) throw new Error("RIFTBOUND_REPLAY_TEST_DIST must point to an isolated build");
const { FileEventStore } = await import(pathToFileURL(path.join(dist, "full-product/index.js")));

async function withStore(name, run) {
  const directory = await mkdtemp(path.join(tmpdir(), `ignored-cache-${name}-`));
  const paths = {
    directory,
    eventLogPath: path.join(directory, "events.log"),
    snapshotPath: path.join(directory, "snapshot.json")
  };
  try {
    await run(paths);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function makeValidLog(paths) {
  const store = await FileEventStore.open(paths);
  await store.appendEvents({
    events: [{ eventSeq: 1, event: { source: "private-log" } }],
    request: { requestId: "durable-1", command: { source: "private-log" } }
  });
  await store.close();
  return readFile(paths.eventLogPath);
}

async function assertRecovered(store) {
  assert.equal(store.headEventSeq, 1);
  assert.deepEqual(store.recovery, { headEventSeq: 1, truncatedTailBytes: 0 });
  assert.deepEqual((await store.readEvents(0)).events.map(e => e.event), [{ source: "private-log" }]);
  assert.equal((await store.getRequest("durable-1"))?.eventSeq, 1);
  assert.equal(await store.readSnapshot(), null);
}

async function fileMode(file) {
  return (await stat(file)).mode & 0o7777;
}

function digest(data) {
  return createHash("sha256").update(data).digest("hex");
}

test("ignored real directory: only the verified log is replayed, without touching directory mode or contents", async () => {
  await withStore("directory", async paths => {
    const log = await makeValidLog(paths);
    await mkdir(paths.snapshotPath, { mode: 0o755 });
    const member = path.join(paths.snapshotPath, "sensitive-member");
    await writeFile(member, "unrelated directory bytes", { mode: 0o644 });
    await chmod(member, 0o644);
    const before = await lstat(paths.snapshotPath);
    const memberBytes = await readFile(member);
    const store = await FileEventStore.open({ ...paths, snapshotMode: "ignored" });
    try {
      await assertRecovered(store);
      assert.equal((await lstat(paths.snapshotPath)).ino, before.ino);
      assert.equal((await lstat(paths.snapshotPath)).mode, before.mode);
      assert.deepEqual(await readFile(member), memberBytes);
      assert.equal(await fileMode(member), 0o644);
      assert.deepEqual(await readFile(paths.eventLogPath), log);
      assert.equal(await fileMode(paths.eventLogPath), 0o600);
    } finally {
      await store.close();
    }
  });
});

for (const [name, bytes] of [
  ["missing", null],
  ["invalid JSON", "not-json"],
  ["wrong schema", '{"checksum":"0","record":{"alien":true}}'],
  ["bad checksum", JSON.stringify({
    checksum: "0".repeat(64),
    record: { formatVersion: 1, eventSeq: 999, payload: { source: "untrusted-cache" } }
  })]
]) {
  test(`ignored ${name} optional regular cache: recover log; existing files become 0600 without reading cache`, async () => {
    await withStore(name.replaceAll(" ", "-"), async paths => {
      const log = await makeValidLog(paths);
      if (bytes !== null) {
        await writeFile(paths.snapshotPath, bytes, { mode: 0o644 });
        await chmod(paths.snapshotPath, 0o644);
      }
      const store = await FileEventStore.open({ ...paths, snapshotMode: "ignored" });
      try {
        await assertRecovered(store);
        assert.deepEqual(await readFile(paths.eventLogPath), log);
        if (bytes === null) {
          await assert.rejects(() => lstat(paths.snapshotPath), { code: "ENOENT" });
        } else {
          assert.equal(await fileMode(paths.snapshotPath), 0o600);
          assert.equal(await readFile(paths.snapshotPath, "utf8"), bytes);
        }
      } finally {
        await store.close();
      }
    });
  });
}

test("ignored regular cache is repaired via no-follow non-blocking descriptor without reading contents", async () => {
  await withStore("regular-descriptor", async paths => {
    await makeValidLog(paths);
    await writeFile(paths.snapshotPath, "private fixture cache bytes", { mode: 0o644 });
    await chmod(paths.snapshotPath, 0o644);
    const child = `
      import assert from 'node:assert/strict';
      import {constants} from 'node:fs';
      import * as fs from 'node:fs/promises';
      import {mock} from 'node:test';
      import path from 'node:path';
      import {pathToFileURL} from 'node:url';
      const p = JSON.parse(process.argv[1]);
      let opened = 0, read = 0;
      mock.module('node:fs/promises', {namedExports: {...fs, open: async (name, flags, ...args) => {
        const handle = await fs.open(name, flags, ...args);
        if (name === p.snapshotPath) {
          opened++;
          assert.ok((flags & constants.O_NOFOLLOW) !== 0);
          assert.ok((flags & constants.O_NONBLOCK) !== 0);
          handle.read = async () => { read++; throw new Error('cache contents read'); };
        }
        return handle;
      }}});
      const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
      const store = await FileEventStore.open({...p, snapshotMode:'ignored'});
      assert.equal(await store.readSnapshot(), null);
      await store.close();
      assert.equal(opened, 1);
      assert.equal(read, 0);
      assert.equal((await fs.stat(p.snapshotPath)).mode & 0o7777, 0o600);
      assert.equal(await fs.readFile(p.snapshotPath, 'utf8'), 'private fixture cache bytes');
      mock.restoreAll();
    `;
    const result = spawnSync(process.execPath,
      ["--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", child, JSON.stringify(paths)],
      { encoding: "utf8", timeout: fifoChildTimeoutMs(), env: { ...process.env } });
    assert.notEqual(result.error?.code, "ETIMEDOUT");
    assert.equal(result.status, 0, result.stderr);
  });
});

test("ignored symlink cache refuses to follow, write or chmod its referent", async () => {
  await withStore("symlink", async paths => {
    await makeValidLog(paths);
    const referent = path.join(paths.directory, "foreign-file");
    await writeFile(referent, "foreign referent fixture", { mode: 0o644 });
    await chmod(referent, 0o644);
    const before = digest(await readFile(referent));
    await symlink(referent, paths.snapshotPath);
    await assert.rejects(() => FileEventStore.open({ ...paths, snapshotMode: "ignored" }));
    assert.equal((await lstat(paths.snapshotPath)).isSymbolicLink(), true);
    assert.equal(await readlink(paths.snapshotPath), referent);
    assert.equal(await fileMode(referent), 0o644);
    assert.equal(digest(await readFile(referent)), before);
  });
});

test("ignored FIFO cache rejects in a bounded child without blocking or changing its mode", async () => {
  await withStore("fifo", async paths => {
    await makeValidLog(paths);
    const made = spawnSync("python3", ["-I", "-c", "import os,sys;os.mkfifo(sys.argv[1],0o600)", paths.snapshotPath],
      { encoding: "utf8", timeout: 3000 });
    assert.equal(made.status, 0, made.stderr);
    const child = `
      import assert from 'node:assert/strict';
      import path from 'node:path';
      import {pathToFileURL} from 'node:url';
      const p = JSON.parse(process.argv[1]);
      const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
      await assert.rejects(() => FileEventStore.open({...p, snapshotMode:'ignored'}));
    `;
    const result = spawnSync(process.execPath,
      ["--input-type=module", "-e", child, JSON.stringify(paths)],
      { encoding: "utf8", timeout: fifoChildTimeoutMs(), env: { ...process.env } });
    assert.notEqual(result.error?.code, "ETIMEDOUT", "FIFO may never block open");
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await lstat(paths.snapshotPath)).isFIFO(), true);
    assert.equal((await lstat(paths.snapshotPath)).mode & 0o7777, 0o600);
  });
});

test("directory cache recovery never opens, reads, chmods or removes that directory", async () => {
  await withStore("no-directory-io", async paths => {
    await makeValidLog(paths);
    await mkdir(paths.snapshotPath);
    await writeFile(path.join(paths.snapshotPath, "private-member"), "unrelated bytes");
    const child = `
      import assert from 'node:assert/strict';
      import * as fs from 'node:fs/promises';
      import {mock} from 'node:test';
      import path from 'node:path';
      import {pathToFileURL} from 'node:url';
      const p = JSON.parse(process.argv[1]);
      let inspections = 0;
      const guard = name => assert.notEqual(name, p.snapshotPath, 'directory I/O is forbidden');
      mock.module('node:fs/promises', {namedExports: {...fs,
        lstat: async (...args) => {
          if (args[0] === p.snapshotPath) inspections++;
          return fs.lstat(...args);
        },
        open: async (name, ...args) => { guard(name); return fs.open(name, ...args); },
        readFile: async (name, ...args) => { guard(name); return fs.readFile(name, ...args); },
        chmod: async (name, ...args) => { guard(name); return fs.chmod(name, ...args); },
        rm: async (name, ...args) => { guard(name); return fs.rm(name, ...args); }
      }});
      const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
      const store = await FileEventStore.open({...p, snapshotMode:'ignored'});
      assert.equal(store.headEventSeq, 1);
      assert.equal(await store.readSnapshot(), null);
      await store.close();
      assert.ok(inspections >= 1, 'directory must first be classified by lstat');
      mock.restoreAll();
    `;
    const result = spawnSync(process.execPath,
      ["--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", child, JSON.stringify(paths)],
      { encoding: "utf8", timeout: fifoChildTimeoutMs(), env: { ...process.env } });
    assert.notEqual(result.error?.code, "ETIMEDOUT");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(paths.snapshotPath, "private-member"), "utf8"), "unrelated bytes");
  });
});

test("ignored cache lstat errors are not reinterpreted as absent paths", async () => {
  await withStore("lstat-error", async paths => {
    await makeValidLog(paths);
    await mkdir(paths.snapshotPath);
    const child = `
      import assert from 'node:assert/strict';
      import * as fs from 'node:fs/promises';
      import {mock} from 'node:test';
      import path from 'node:path';
      import {pathToFileURL} from 'node:url';
      const p = JSON.parse(process.argv[1]);
      let hit = 0;
      mock.module('node:fs/promises', {namedExports: {...fs, lstat: async (...args) => {
        if (args[0] === p.snapshotPath) {
          hit++;
          const error = new Error('injected cache inspection error');
          error.code = 'EACCES';
          throw error;
        }
        return fs.lstat(...args);
      }}});
      const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
      await assert.rejects(() => FileEventStore.open({...p, snapshotMode:'ignored'}), {code:'EACCES'});
      assert.equal(hit, 1);
      mock.restoreAll();
    `;
    const result = spawnSync(process.execPath,
      ["--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", child, JSON.stringify(paths)],
      { encoding: "utf8", timeout: fifoChildTimeoutMs(), env: { ...process.env } });
    assert.notEqual(result.error?.code, "ETIMEDOUT");
    assert.equal(result.status, 0, result.stderr);
  });
});

test("authoritative mode continues to reject a directory cache", async () => {
  await withStore("authoritative", async paths => {
    const log = await makeValidLog(paths);
    await mkdir(paths.snapshotPath);
    const mode = (await lstat(paths.snapshotPath)).mode;
    await assert.rejects(() => FileEventStore.open(paths));
    assert.equal((await lstat(paths.snapshotPath)).mode, mode);
    assert.deepEqual(await readFile(paths.eventLogPath), log);
  });
});

test("ignored directory does not authorize snapshot saving or advance the in-memory snapshot", async () => {
  await withStore("save", async paths => {
    await makeValidLog(paths);
    await mkdir(paths.snapshotPath);
    const before = await lstat(paths.snapshotPath);
    const store = await FileEventStore.open({ ...paths, snapshotMode: "ignored" });
    try {
      await assert.rejects(() => store.saveSnapshot({ eventSeq: 1, payload: { untrusted: true } }));
      assert.equal(await store.readSnapshot(), null);
      assert.equal((await lstat(paths.snapshotPath)).mode, before.mode);
      assert.equal((await lstat(paths.snapshotPath)).ino, before.ino);
    } finally {
      await store.close();
    }
  });
});

test("invalid private log is not swallowed by ignored directory recovery", async () => {
  await withStore("invalid-log", async paths => {
    await writeFile(paths.eventLogPath, "{not-json}\n", { mode: 0o644 });
    await mkdir(paths.snapshotPath);
    await assert.rejects(() => FileEventStore.open({ ...paths, snapshotMode: "ignored" }), /not valid JSON/);
    assert.equal(await fileMode(paths.eventLogPath), 0o600);
    assert.equal(await readFile(paths.eventLogPath, "utf8"), "{not-json}\n");
  });
});

test("symlink private log stays rejected even when optional snapshot path is a directory", async () => {
  await withStore("log-symlink", async paths => {
    await mkdir(paths.snapshotPath);
    const referent = path.join(paths.directory, "foreign-log");
    await writeFile(referent, "foreign log fixture", { mode: 0o644 });
    await chmod(referent, 0o644);
    const before = digest(await readFile(referent));
    await symlink(referent, paths.eventLogPath);
    await assert.rejects(() => FileEventStore.open({ ...paths, snapshotMode: "ignored" }));
    assert.equal(await fileMode(referent), 0o644);
    assert.equal(digest(await readFile(referent)), before);
  });
});

test("log and optional cache path alias is rejected before replay", async () => {
  await withStore("path-alias", async paths => {
    const log = await makeValidLog(paths);
    await assert.rejects(() => FileEventStore.open({
      ...paths,
      snapshotPath: paths.eventLogPath,
      snapshotMode: "ignored"
    }), /event log and snapshot paths must be different/);
    assert.deepEqual(await readFile(paths.eventLogPath), log);
  });
});

test("non-regular log is rejected even with an ignored directory cache", async () => {
  await withStore("log-directory", async paths => {
    await mkdir(paths.eventLogPath);
    await mkdir(paths.snapshotPath);
    await assert.rejects(() => FileEventStore.open({ ...paths, snapshotMode: "ignored" }));
    assert.equal((await lstat(paths.eventLogPath)).isDirectory(), true);
  });
});

test("log path alias after opening rejects duplicate ACK even when directory cache is ignored", async () => {
  await withStore("log-alias-swap", async paths => {
    await makeValidLog(paths);
    await mkdir(paths.snapshotPath);
    const store = await FileEventStore.open({ ...paths, snapshotMode: "ignored" });
    const moved = path.join(paths.directory, "moved-private-log");
    try {
      const original = await readFile(paths.eventLogPath);
      await rename(paths.eventLogPath, moved);
      const foreign = path.join(paths.directory, "foreign-log");
      await writeFile(foreign, "unrelated fixture", { mode: 0o644 });
      await chmod(foreign, 0o644);
      const before = digest(await readFile(foreign));
      await symlink(foreign, paths.eventLogPath);
      await assert.rejects(() => store.appendEvents({
        events: [{ eventSeq: 2, event: { source: "must-not-ACK" } }],
        request: { requestId: "durable-1", command: { source: "private-log" } }
      }), /private file changed/);
      assert.equal(store.headEventSeq, 1);
      await assert.rejects(() => store.appendRequest({ request: { requestId: "no-false-ACK" } }), /unresolved failed write/);
      assert.deepEqual(await readFile(moved), original);
      assert.equal(digest(await readFile(foreign)), before);
      assert.equal(await fileMode(foreign), 0o644);
    } finally {
      await store.close();
    }
  });
});

test("a swapped-away log after opening cannot ACK or advance memory, despite ignored directory", async () => {
  await withStore("orphan-log", async paths => {
    await makeValidLog(paths);
    await mkdir(paths.snapshotPath);
    const store = await FileEventStore.open({ ...paths, snapshotMode: "ignored" });
    const moved = path.join(paths.directory, "old-log");
    try {
      const original = await readFile(paths.eventLogPath);
      await rename(paths.eventLogPath, moved);
      await writeFile(paths.eventLogPath, "", { mode: 0o600 });
      await assert.rejects(() => store.appendEvents({
        events: [{ eventSeq: 2, event: { source: "must-not-ACK" } }],
        request: { requestId: "must-not-ACK" }
      }), /private file changed/);
      assert.equal(store.headEventSeq, 1);
      assert.equal(await store.getRequest("must-not-ACK").catch(() => null), null);
      await assert.rejects(() => store.appendRequest({ request: { requestId: "must-not-ACK" } }), /unresolved failed write/);
      assert.deepEqual(await readFile(moved), original);
      assert.equal((await readFile(paths.eventLogPath)).length, 0);
    } finally {
      await store.close();
    }
  });
});

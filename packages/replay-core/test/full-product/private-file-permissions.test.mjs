import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants as fsConstants, readFileSync } from "node:fs";
import {
  chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// POSIX-only suite. Both this guard and the runner's file selection come from
// scripts/run-tests.mjs, so they cannot drift apart. On an unsupported host the
// file registers no tests at all (never test.skip) and still reports zero skips,
// and the guard runs before the build is imported so a direct `node --test`
// invocation on such a host does not fail either.
import { fifoChildTimeoutMs, suiteRunsOnThisHost } from "../../scripts/run-tests.mjs";

if (!suiteRunsOnThisHost(fileURLToPath(import.meta.url))) {
  process.exit(0);
}

const output = process.env.RIFTBOUND_REPLAY_TEST_DIST;
if (!output) throw new Error("An isolated replay-core build path is required");
const { FileEventStore } = await import("../../dist/full-product/index.js");

async function pathsFor(name) {
  const directory = await mkdtemp(path.join(tmpdir(), `replay-private-${name}-`));
  return {
    directory,
    eventLogPath: path.join(directory, "events.log"),
    snapshotPath: path.join(directory, "snapshot.json")
  };
}

async function withPaths(name, run) {
  const paths = await pathsFor(name);
  try {
    await run(paths);
  } finally {
    await rm(paths.directory, { recursive: true, force: true });
  }
}

async function mode(file) {
  return (await stat(file)).mode & 0o7777;
}

function assertChild(code, args, umask = "022", extras = []) {
  const result = spawnSync(process.execPath, [
    ...extras, "--input-type=module", "-e", code, JSON.stringify(args)
  ], {
    env: { ...process.env, TEST_UMASK: umask },
    encoding: "utf8", timeout: 10000
  });
  assert.equal(result.status, 0, `child failed (${result.status}): ${result.stderr}`);
}

const storeInChild = `
import assert from 'node:assert/strict';
import { readdir, readFile, stat, chmod } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const {paths, scenario} = JSON.parse(process.argv[1]);
process.umask(Number.parseInt(process.env.TEST_UMASK, 8));
const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
const privateMode = async file => (await stat(file)).mode & 0o7777;
if (scenario === 'fresh') {
  const store = await FileEventStore.open(paths);
  assert.equal(await privateMode(paths.eventLogPath), 0o600);
  await store.appendEvents({events:[{eventSeq:1,event:{kind:'private'}}], request:{requestId:'id-1',command:{privateDeck:'fixture-deck'}}});
  await store.saveSnapshot({eventSeq:1,payload:{privateDeck:'fixture-deck'}});
  assert.equal(await privateMode(paths.snapshotPath), 0o600);
  assert.deepEqual(await readdir(paths.directory), ['events.log', 'snapshot.json']);
  await store.close();
} else if (scenario === 'repair') {
  const store = await FileEventStore.open(paths);
  assert.equal(store.headEventSeq, 1);
  assert.deepEqual(await store.readSnapshot(), {eventSeq:1,payload:{privateDeck:'fixture-deck'}});
  assert.equal(await privateMode(paths.eventLogPath), 0o600);
  assert.equal(await privateMode(paths.snapshotPath), 0o600);
  await store.appendEvents({events:[{eventSeq:2,event:{kind:'next'}}]});
  assert.match(await readFile(paths.eventLogPath,'utf8'), /fixture-deck/);
  await store.close();
} else if (scenario === 'ignored-repair') {
  const store = await FileEventStore.open({...paths,snapshotMode:'ignored'});
  assert.equal(await store.readSnapshot(), null);
  assert.equal(await privateMode(paths.snapshotPath), 0o600);
  await store.close();
}
`;

test("runtime Node constants, not a Darwin numeric table, govern open flags", () => {
  const source = readFileSync(new URL("../../src/full-product/file-event-store.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ constants as fsConstants \} from "node:fs"/);
  for (const name of ["O_CREAT", "O_EXCL", "O_NOFOLLOW", "O_APPEND", "S_IFMT", "S_IFREG"]) {
    assert.match(source, new RegExp(`fsConstants\\.${name}`));
    assert.ok(Number.isSafeInteger(fsConstants[name]) && fsConstants[name] > 0);
  }
  assert.ok((fsConstants.S_IFREG & fsConstants.S_IFMT) === fsConstants.S_IFREG);
  assert.doesNotMatch(source, /const O_CREAT\s*=|const O_NOFOLLOW\s*=/);
});

for (const umask of ["022", "000"]) {
  test(`child umask ${umask}: newly created log, snapshot temp and final are 0600`, async () => {
    await withPaths(`fresh-${umask}`, async paths => {
      assertChild(storeInChild, { paths, scenario: "fresh" }, umask);
      assert.equal(await mode(paths.eventLogPath), 0o600);
      assert.equal(await mode(paths.snapshotPath), 0o600);
    });
  });
}

test("snapshot temporary inode is 0600 before writing sensitive data", async () => {
  await withPaths("temp-mode", async paths => {
    const child = `
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const paths = JSON.parse(process.argv[1]);
process.umask(Number.parseInt(process.env.TEST_UMASK, 8));
let observed = 0;
mock.module('node:fs/promises', { namedExports: {
  ...nativeFs,
  open: async (...args) => {
    const handle = await nativeFs.open(...args);
    if (args[0].startsWith(paths.snapshotPath + '.')) {
      const originalWrite = handle.write.bind(handle);
      handle.write = async (...writeArgs) => {
        observed++;
        assert.equal((await handle.stat()).mode & 0o7777, 0o600);
        assert.equal((await nativeFs.stat(args[0])).mode & 0o7777, 0o600);
        return originalWrite(...writeArgs);
      };
    }
    return handle;
  }
}});
const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
const store = await FileEventStore.open(paths);
await store.saveSnapshot({eventSeq:0,payload:{privateDeck:'fixture-deck'}});
await store.close();
assert.ok(observed > 0);
assert.equal((await nativeFs.stat(paths.snapshotPath)).mode & 0o7777, 0o600);
assert.deepEqual(await nativeFs.readdir(paths.directory), ['events.log','snapshot.json']);
mock.restoreAll();
`;
    assertChild(child, paths, "000", ["--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning"]);
  });
});

test("repairs existing 0644 journal and snapshot before replay, without truncating data", async () => {
  await withPaths("repair", async paths => {
    assertChild(storeInChild, { paths, scenario: "fresh" });
    const oldLog = await readFile(paths.eventLogPath);
    const oldSnapshot = await readFile(paths.snapshotPath);
    await chmod(paths.eventLogPath, 0o644);
    await chmod(paths.snapshotPath, 0o644);
    assertChild(storeInChild, { paths, scenario: "repair" }, "000");
    assert.equal(await mode(paths.eventLogPath), 0o600);
    assert.equal(await mode(paths.snapshotPath), 0o600);
    assert.ok((await readFile(paths.eventLogPath)).subarray(0, oldLog.length).equals(oldLog));
    assert.deepEqual(await readFile(paths.snapshotPath), oldSnapshot);
    const store = await FileEventStore.open(paths);
    assert.equal(store.headEventSeq, 2);
    await store.close();
  });
});

test("ignored snapshot contents still receive private-mode repair", async () => {
  await withPaths("ignored", async paths => {
    await writeFile(paths.snapshotPath, "not-json", { mode: 0o644 });
    assertChild(storeInChild, { paths, scenario: "ignored-repair" });
    assert.equal(await mode(paths.snapshotPath), 0o600);
  });
});

test("reopened log preserves checksum, idempotency, event sequence and crash-tail truncation", async () => {
  await withPaths("reopen", async paths => {
    let store = await FileEventStore.open(paths);
    const request = { requestId: "fixture-id", command: { privateDeck: "fixture-deck" } };
    const events = [{ eventSeq: 1, event: { kind: "created" } }];
    assert.equal((await store.appendEvents({ events, request })).duplicate, false);
    await store.close();
    const original = await readFile(paths.eventLogPath);
    await writeFile(paths.eventLogPath, Buffer.concat([original, Buffer.from('{"unfinished":"private"')]));
    await chmod(paths.eventLogPath, 0o644);
    store = await FileEventStore.open(paths);
    assert.equal(store.recovery.truncatedTailBytes, Buffer.byteLength('{"unfinished":"private"'));
    assert.equal(await mode(paths.eventLogPath), 0o600);
    assert.deepEqual(await readFile(paths.eventLogPath), original);
    assert.equal((await store.appendEvents({ events, request })).duplicate, true);
    assert.equal((await store.appendEvents({ events: [{ eventSeq: 2, event: { kind: "next" } }] })).duplicate, false);
    await store.close();
    const reopened = await FileEventStore.open(paths);
    assert.deepEqual((await reopened.readEvents(0)).events.map(item => item.eventSeq), [1, 2]);
    assert.equal(await mode(paths.eventLogPath), 0o600);
    await reopened.close();
  });
});

test("symlink event log and snapshot are rejected without changing targets", async () => {
  await withPaths("symlink", async paths => {
    const target = path.join(paths.directory, "unrelated-target");
    await writeFile(target, "unrelated fixture", { mode: 0o600 });
    await chmod(target, 0o644);
    await symlink(target, paths.eventLogPath);
    await assert.rejects(() => FileEventStore.open(paths));
    assert.equal(await mode(target), 0o644);
    assert.equal(await readFile(target, "utf8"), "unrelated fixture");
    await rm(paths.eventLogPath);
    const store = await FileEventStore.open(paths);
    await store.close();
    await symlink(target, paths.snapshotPath);
    await assert.rejects(() => FileEventStore.open(paths));
    assert.equal(await mode(target), 0o644);
    assert.equal(await readFile(target, "utf8"), "unrelated fixture");
    assert.equal((await lstat(paths.snapshotPath)).isSymbolicLink(), true);
  });
});

test("post-open snapshot symlink cannot be replaced by atomic snapshot save", async () => {
  await withPaths("snapshot-symlink", async paths => {
    const target = path.join(paths.directory, "unrelated-target");
    await writeFile(target, "unrelated fixture", { mode: 0o600 });
    await chmod(target, 0o644);
    const store = await FileEventStore.open(paths);
    await symlink(target, paths.snapshotPath);
    await assert.rejects(() => store.saveSnapshot({ eventSeq: 0, payload: {} }));
    await store.close();
    assert.equal((await lstat(paths.snapshotPath)).isSymbolicLink(), true);
    assert.equal(await mode(target), 0o644);
    assert.equal(await readFile(target, "utf8"), "unrelated fixture");
  });
});

test("rejects a non-regular log/snapshot without chmodding the directory", async () => {
  await withPaths("nonregular", async paths => {
    await mkdir(paths.eventLogPath);
    await assert.rejects(() => FileEventStore.open(paths));
    const dirMode = await mode(paths.eventLogPath);
    assert.ok(dirMode !== 0o600);
    await rm(paths.eventLogPath, { recursive: true });
    await mkdir(paths.snapshotPath);
    await assert.rejects(() => FileEventStore.open(paths));
    assert.ok((await mode(paths.snapshotPath)) !== 0o600);
  });
});

// Mock only Node's native fs/promises.open in a separate process. All other
// production operations use real descriptors; counters verify call order and
// closure without adding permission callbacks to the store API.
const injectedFailure = `
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as nativeFs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const {paths, failAt} = JSON.parse(process.argv[1]);
process.umask(Number.parseInt(process.env.TEST_UMASK, 8));
let opened = 0, closed = 0, reads = 0, writes = 0, chmods = 0, stats = 0;
let original = await nativeFs.readFile(paths.eventLogPath).catch(() => null);
const target = failAt.startsWith('snapshot') ? paths.snapshotPath : paths.eventLogPath;
mock.module('node:fs/promises', { namedExports: {
  ...nativeFs,
  open: async (...args) => {
    const handle = await nativeFs.open(...args);
    if (args[0] !== target && !(failAt === 'snapshot-temp-chmod' && args[0].startsWith(target + '.'))) return handle;
    if (failAt === 'snapshot-temp-chmod' && args[0] === target) return handle;
    opened++;
    const originalClose = handle.close.bind(handle);
    const originalRead = handle.read.bind(handle);
    const originalWrite = handle.write.bind(handle);
    const originalStat = handle.stat.bind(handle);
    const originalChmod = handle.chmod.bind(handle);
    handle.close = async () => { closed++; return originalClose(); };
    handle.read = async (...a) => { reads++; return originalRead(...a); };
    handle.write = async (...a) => { writes++; return originalWrite(...a); };
    handle.stat = async (...a) => {
      stats++;
      if (failAt === 'log-stat-error' || failAt === 'snapshot-stat-error') throw new Error('simulated stat failure');
      const real = await originalStat(...a);
      if (failAt === 'log-verify-mode' && stats > 1) return {...real, mode: (real.mode & ~0o7777) | 0o644, isFile: () => true};
      if (failAt === 'snapshot-verify-mode' && stats > 1) return {...real, mode: (real.mode & ~0o7777) | 0o644, isFile: () => true};
      return real;
    };
    handle.chmod = async (...a) => {
      chmods++;
      if (failAt.endsWith('chmod')) throw new Error('simulated chmod failure');
      return originalChmod(...a);
    };
    return handle;
  }
}});
const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
if (failAt.startsWith('snapshot-temp')) {
  const store = await FileEventStore.open(paths);
  await assert.rejects(() => store.saveSnapshot({eventSeq:0,payload:{privateDeck:'fixture-deck'}}), /private file permissions/);
  await store.close();
  assert.equal(await nativeFs.stat(paths.snapshotPath).catch(() => null), null);
  assert.deepEqual(await nativeFs.readdir(paths.directory), ['events.log']);
} else {
  await assert.rejects(() => FileEventStore.open(paths), err => {
    assert.match(err.message, /private file|permissions/);
    assert.doesNotMatch(err.message, /fixture-deck/);
    return true;
  });
}
assert.ok(opened > 0);
assert.equal(opened, closed);
assert.equal(reads, 0);
assert.equal(writes, 0);
if (failAt.endsWith('chmod')) assert.ok(chmods > 0);
if (failAt.endsWith('stat-error') || failAt.endsWith('verify-mode')) assert.ok(stats > 0);
assert.deepEqual(await nativeFs.readFile(paths.eventLogPath), original);
assert.equal(process.getActiveResourcesInfo().includes('FileHandle'), false);
mock.restoreAll();
`;

for (const failAt of [
  "log-chmod", "log-stat-error", "log-verify-mode", "snapshot-chmod",
  "snapshot-stat-error", "snapshot-verify-mode", "snapshot-temp-chmod"
]) {
  test(`injected ${failAt}: fail closed before read/write, close descriptors`, async () => {
    await withPaths(failAt, async paths => {
      if (failAt.startsWith("snapshot-")) {
        const store = await FileEventStore.open(paths);
        await store.close();
        if (failAt !== "snapshot-temp-chmod") {
          await writeFile(paths.snapshotPath, "fixture-deck", { mode: 0o644 });
        }
      } else {
        await writeFile(paths.eventLogPath, "fixture-deck", { mode: 0o644 });
      }
      const before = await readFile(paths.eventLogPath);
      assertChild(injectedFailure, { paths, failAt }, "022", ["--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning"]);
      assert.deepEqual(await readFile(paths.eventLogPath), before);
    });
  });
}

test("post-open log chmod failure blocks append and any success acknowledgement", async () => {
  await withPaths("append-fail", async paths => {
    const store = await FileEventStore.open(paths);
    const before = await readFile(paths.eventLogPath);
    store.handle.chmod = async () => { throw new Error("simulated chmod failure"); };
    await assert.rejects(
      () => store.appendEvents({ events: [{ eventSeq: 1, event: { kind: "private" } }] }),
      /private file permissions/
    );
    await assert.rejects(() => store.appendRequest({ request: { requestId: "private" } }), /unresolved failed write/);
    assert.equal(store.headEventSeq, 0);
    assert.deepEqual(await readFile(paths.eventLogPath), before);
    await store.close();
  });
});

test("failed snapshot validation closes both snapshot and journal file handles", async () => {
  await withPaths("snapshot-close", async paths => {
    await writeFile(paths.snapshotPath, "fixture-private-token", { mode: 0o600 });
    const original = await readFile(paths.snapshotPath);
    await assert.rejects(() => FileEventStore.open(paths), error => {
      assert.doesNotMatch(error.message, /fixture-private-token/);
      return true;
    });
    assert.deepEqual(await readFile(paths.snapshotPath), original);
    assert.equal(process.getActiveResourcesInfo().includes("FileHandle"), false);
  });
});

test("malformed JSON errors and idempotency conflicts do not echo private payloads", async () => {
  await withPaths("errors", async paths => {
    const secret = "fixture-private-token";
    await writeFile(paths.eventLogPath, `{bad json ${secret}\n`, { mode: 0o600 });
    await assert.rejects(() => FileEventStore.open(paths), error => {
      assert.doesNotMatch(error.message, /fixture-private-token/);
      return true;
    });
    await rm(paths.eventLogPath);
    const store = await FileEventStore.open(paths);
    await store.appendRequest({ request: { requestId: secret, command: { type: "first" } } });
    await assert.rejects(() => store.appendRequest({ request: { requestId: secret, command: { type: "other" } } }), error => {
      assert.doesNotMatch(error.message, /fixture-private-token/);
      return true;
    });
    await store.close();
  });
});

// All new fixtures operate on real POSIX files. Child timeouts guard against
// regressions where an open(2) blocks before fstat can reject a FIFO. The budget
// comes from the runner so a loaded host cannot turn startup cost into a false
// red; it stays a finite upper bound, so a genuine blocking open still trips it.
for (const scenario of ["open-snapshot", "save-snapshot", "open-log"]) {
  test(`FIFO ${scenario} rejects promptly with its mode unchanged`, async () => {
    await withPaths(`fifo-${scenario}`, async paths => {
      const fifoPath = scenario === "open-log" ? paths.eventLogPath : paths.snapshotPath;
      if (scenario !== "save-snapshot") {
        const made = spawnSync("python3", ["-I", "-c",
          "import os,sys; os.mkfifo(sys.argv[1], 0o600)", fifoPath
        ], { encoding: "utf8", timeout: 3000 });
        assert.equal(made.status, 0, made.stderr);
      }
      const child = `
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const paths = JSON.parse(process.argv[1]);
const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
if (process.env.FIFO_SCENARIO === 'save-snapshot') {
  const store = await FileEventStore.open(paths);
  const made = spawnSync('python3', ['-I','-c',
    'import os,sys; os.mkfifo(sys.argv[1], 0o600)', paths.snapshotPath], {encoding:'utf8',timeout:3000});
  assert.equal(made.status, 0, made.stderr);
  try { await assert.rejects(() => store.saveSnapshot({eventSeq:0,payload:{}})); }
  finally { await store.close(); }
} else {
  await assert.rejects(() => FileEventStore.open(paths));
}
`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", child,
        JSON.stringify(paths)], {
        encoding: "utf8", timeout: fifoChildTimeoutMs(),
        env: { ...process.env, FIFO_SCENARIO: scenario }
      });
      assert.notEqual(result.error?.code, "ETIMEDOUT", "must inspect FIFO without a blocking open");
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await mode(fifoPath), 0o600);
    });
  });
}

for (const replacement of ["moved", "new-file", "symlink"]) {
  test(`opened log ${replacement} path rejects append/duplicate and poisons store`, async () => {
    await withPaths(`log-${replacement}`, async paths => {
      const store = await FileEventStore.open(paths);
      try {
        const first = { events: [{ eventSeq: 1, event: { kind: "original" } }],
          request: { requestId: "first", command: { kind: "original" } } };
        await store.appendEvents(first);
        const saved = await readFile(paths.eventLogPath);
        const moved = path.join(paths.directory, "moved-original.log");
        await rename(paths.eventLogPath, moved);
        if (replacement === "new-file") {
          await writeFile(paths.eventLogPath, "", { mode: 0o600 });
        } else if (replacement === "symlink") {
          await symlink(moved, paths.eventLogPath);
        }
        await assert.rejects(() => store.appendEvents(first), /private file changed/);
        await assert.rejects(() => store.appendRequest({ request: { requestId: "second" } }), /unresolved failed write/);
        assert.equal(store.headEventSeq, 1);
        assert.deepEqual(await readFile(moved), saved);
        if (replacement === "new-file") assert.equal((await readFile(paths.eventLogPath)).length, 0);
      } finally {
        await store.close();
      }
    });
  });
}

const racedFileSystem = `
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {mock} from 'node:test';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {paths, scenario} = JSON.parse(process.argv[1]);
const other = path.join(paths.directory, 'unrelated');
const old = path.join(paths.directory, 'old-snapshot');
const originalOpen = fs.open, originalRename = fs.rename;
let swapped = false, closed = 0;
const expected = scenario === 'fallback' ? 'unrelated original contents' : 'snapshot fixture';
await fs.writeFile(other, expected, {mode:0o600});
await fs.chmod(other, 0o644);
if (scenario === 'fallback') {
  await fs.chmod(paths.eventLogPath, 0o644);
  mock.module('node:fs/promises', {namedExports:{...fs, open: async (name, flags, ...rest) => {
    if (name === paths.eventLogPath && flags === (constants.O_RDWR|constants.O_APPEND|constants.O_NOFOLLOW|constants.O_NONBLOCK) && !swapped) {
      swapped = true;
      const err = new Error('fallback forced'); err.code = 'EACCES'; throw err;
    }
    const handle = await originalOpen(name, flags, ...rest);
    if (name === paths.eventLogPath && flags === (constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)) {
      const originalClose = handle.close.bind(handle);
      handle.close = async () => {
        closed++;
        await originalClose();
        await originalRename(paths.eventLogPath, old);
        await originalRename(other, paths.eventLogPath);
      };
    }
    return handle;
  }}});
} else if (scenario === 'temp-symlink' || scenario === 'temp-inode') {
  mock.module('node:fs/promises', {namedExports:{...fs, rename: async (src, dest) => {
    if (dest === paths.snapshotPath && src.startsWith(paths.snapshotPath + '.')) {
      swapped = true;
      await originalRename(src, old);
      if (scenario === 'temp-symlink') await fs.symlink(other, src);
      else {
        await fs.writeFile(src, 'unrelated temp contents', {mode:0o600});
        await fs.chmod(src, 0o644);
      }
    }
    return originalRename(src, dest);
  }}});
} else if (scenario === 'postsync' || scenario === 'pretemp-symlink' || scenario === 'predestination') {
  mock.module('node:fs/promises', {namedExports:{...fs, open: async (name, ...args) => {
    const handle = await originalOpen(name, ...args);
    if (scenario === 'postsync' && name === path.dirname(paths.snapshotPath)) {
      handle.sync = async () => { swapped = true; throw new Error('injected directory sync failure'); };
    }
    if (typeof name === 'string' && name.startsWith(paths.snapshotPath + '.')) {
      const originalClose = handle.close.bind(handle);
      handle.close = async () => { closed++; await originalClose(); };
      if (scenario !== 'postsync') {
        const originalSync = handle.sync.bind(handle);
        handle.sync = async () => {
          await originalSync();
          swapped = true;
          if (scenario === 'pretemp-symlink') {
            await originalRename(name, old);
            await fs.symlink(other, name);
          } else {
            await originalRename(paths.snapshotPath, old);
            await originalRename(other, paths.snapshotPath);
          }
        };
      }
    }
    return handle;
  }}});
}
const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST, 'full-product/index.js')));
if (scenario === 'fallback') {
  await assert.rejects(() => FileEventStore.open(paths), /private file changed while opening/);
  assert.equal(swapped, true); assert.equal(closed, 1);
  assert.equal((await fs.stat(paths.eventLogPath)).mode & 0o7777, 0o644);
  assert.equal(await fs.readFile(paths.eventLogPath, 'utf8'), expected);
} else {
  const store = await FileEventStore.open(paths);
  if (scenario === 'postsync' || scenario === 'predestination') {
    // Existing private snapshot is created outside the injected failure path.
    assert.equal((await store.readSnapshot()).payload.original, true);
  }
  const before = store.snapshot;
  await assert.rejects(() => store.saveSnapshot({eventSeq:0,payload:{changed:true}}));
  assert.deepEqual(store.snapshot, before, 'failed save cannot advance in-memory snapshot');
  assert.equal(swapped, true);
  if (scenario === 'postsync') {
    await assert.rejects(() => store.readSnapshot(), /unresolved failed write/);
    await assert.rejects(() => store.appendEvents({events:[{eventSeq:1,event:{}}]}), /unresolved failed write/);
    assert.equal(closed, 1);
  } else if (scenario === 'predestination') {
    assert.equal(await fs.readFile(paths.snapshotPath, 'utf8'), expected);
    assert.equal((await fs.stat(paths.snapshotPath)).mode & 0o7777, 0o644);
    assert.equal((await store.readSnapshot()).payload.original, true);
    assert.equal(closed, 1);
  } else if (scenario === 'pretemp-symlink') {
    assert.equal((await fs.lstat(paths.snapshotPath).catch(() => null)), null);
    assert.equal((await fs.lstat(old)).isFile(), true);
    assert.equal(await fs.readFile(other, 'utf8'), expected);
    assert.equal((await store.readSnapshot()), null);
    assert.equal(closed, 1);
  } else if (scenario.startsWith('temp-')) {
    const final = await fs.lstat(paths.snapshotPath).catch(() => null);
    assert.equal(final?.isSymbolicLink(), scenario === 'temp-symlink');
    assert.equal(await fs.readFile(other, 'utf8'), expected);
    assert.equal((await fs.stat(other)).mode & 0o7777, 0o644);
    assert.equal((await fs.lstat(old)).isFile(), true);
    if (scenario === 'temp-symlink') {
      assert.equal((await fs.readlink(paths.snapshotPath)), other);
      assert.ok((await fs.readdir(paths.directory)).some(name => name.startsWith('snapshot.json.') && name.endsWith('.tmp')) === false);
    } else {
      assert.equal((await fs.stat(paths.snapshotPath)).mode & 0o7777, 0o644);
      assert.equal(await fs.readFile(paths.snapshotPath, 'utf8'), 'unrelated temp contents');
    }
  }
  await store.close();
}
`;

for (const scenario of ["fallback", "temp-symlink", "temp-inode", "pretemp-symlink", "predestination", "postsync"]) {
  test(`real descriptor race ${scenario} fails closed without foreign chmod/ACK`, async () => {
    await withPaths(`race-${scenario}`, async paths => {
      if (scenario === "fallback") {
        const store = await FileEventStore.open(paths);
        await store.appendEvents({ events: [{ eventSeq: 1, event: { kind: "before" } }] });
        await store.close();
      } else if (scenario === "postsync" || scenario === "predestination") {
        const store = await FileEventStore.open(paths);
        await store.saveSnapshot({ eventSeq: 0, payload: { original: true } });
        await store.close();
      }
      assertChild(racedFileSystem, { paths, scenario }, "022", [
        "--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning"
      ]);
      if (scenario === "postsync") assert.equal(await mode(paths.snapshotPath), 0o600);
    });
  });
}

test("missing native O_NONBLOCK fails closed before creating a journal", async () => {
  await withPaths("missing-nonblock", async paths => {
    const child = `
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const paths = JSON.parse(process.argv[1]);
mock.module('node:fs', {namedExports:{constants:{...constants,O_NONBLOCK:undefined}}});
const {FileEventStore} = await import(pathToFileURL(path.join(process.env.RIFTBOUND_REPLAY_TEST_DIST,'full-product/index.js')));
await assert.rejects(() => FileEventStore.open(paths), /require POSIX filesystem constants/);
assert.deepEqual(await fs.readdir(paths.directory), []);
`;
    assertChild(child, paths, "022", [
      "--experimental-test-module-mocks", "--disable-warning=ExperimentalWarning"
    ]);
  });
});

test("normal atomic replacement retains only the new private snapshot", async () => {
  await withPaths("snapshot-atomic", async paths => {
    const store = await FileEventStore.open(paths);
    try {
      await store.saveSnapshot({ eventSeq: 0, payload: { original: true } });
      const original = await stat(paths.snapshotPath);
      await store.saveSnapshot({ eventSeq: 0, payload: { replacement: true } });
      const latest = await stat(paths.snapshotPath);
      assert.notEqual(latest.ino, original.ino);
      assert.equal(await mode(paths.snapshotPath), 0o600);
      assert.deepEqual((await store.readSnapshot()).payload, { replacement: true });
      assert.deepEqual(await readdir(paths.directory), ["events.log", "snapshot.json"]);
    } finally {
      await store.close();
    }
    const reopened = await FileEventStore.open(paths);
    assert.deepEqual((await reopened.readSnapshot()).payload, { replacement: true });
    await reopened.close();
  });
});

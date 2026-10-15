import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  openTemporary: false,
  writeTemporary: false,
  syncTemporary: false,
  rename: false,
  syncDirectory: false,
  syncHead: false,
  failDirectorySyncOn: 0,
  directorySyncs: 0,
  headSyncs: 0
}));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (fault.openTemporary && typeof args[0] === "string" && args[0].endsWith(".tmp")) {
        throw Object.assign(new Error("injected temporary open failure"), { code: "EIO" });
      }
      const handle = await actual.open(...args);
      if (typeof args[0] === "string" && args[0].endsWith(".tmp")) {
        const write = handle.write.bind(handle);
        Object.defineProperty(handle, "write", { value: (...writeArgs: Parameters<typeof handle.write>) => {
          if (fault.writeTemporary) {
            throw Object.assign(new Error("injected temporary write failure"), { code: "EIO" });
          }
          return write(...writeArgs);
        } });
        const sync = handle.sync.bind(handle);
        Object.defineProperty(handle, "sync", { value: async () => {
          if (fault.syncTemporary) {
            throw Object.assign(new Error("injected temporary sync failure"), { code: "EIO" });
          }
          return sync();
        } });
      }
      if (typeof args[1] === "number" && (args[1] & fsConstants.O_DIRECTORY) !== 0) {
        const sync = handle.sync.bind(handle);
        Object.defineProperty(handle, "sync", { value: async () => {
          fault.directorySyncs++;
          const fail = fault.syncDirectory ||
            (fault.failDirectorySyncOn > 0 && fault.directorySyncs === fault.failDirectorySyncOn);
          if (fail) {
            throw Object.assign(new Error("injected directory sync failure"), { code: "EIO" });
          }
          return sync();
        } });
      }
      if (typeof args[0] === "string" && args[0].endsWith("head.json")) {
        const sync = handle.sync.bind(handle);
        Object.defineProperty(handle, "sync", { value: async () => {
          fault.headSyncs++;
          if (fault.syncHead) {
            throw Object.assign(new Error("injected head sync failure"), { code: "EIO" });
          }
          return sync();
        } });
      }
      return handle;
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fault.rename && typeof args[0] === "string" && args[0].endsWith(".tmp")) {
        throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
      }
      return actual.rename(...args);
    }
  };
});

import {
  createPrivateJournalCasStore,
  openPrivateJournalCasStore,
  PrivateJournalCasConflictError,
  PrivateJournalCasLockBusyError,
  type PrivateJournalCasHead
} from "../../src/duel/private-journal-cas-store.js";

const testRoot = process.env.RIFTBOUND_PRIVATE_CAS_TEST_TMP ?? tmpdir();

const moduleUrl = pathToFileURL(fileURLToPath(new URL("../../src/duel/private-journal-cas-store.ts", import.meta.url))).href;
const tsxLoader = fileURLToPath(new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url));
const directories: string[] = [];

async function directory(): Promise<string> {
  await fsPromises.mkdir(testRoot!, { recursive: true, mode: 0o700 });
  const result = await fsPromises.mkdtemp(path.join(testRoot!, "cas-"));
  await fsPromises.chmod(result, 0o700);
  directories.push(result);
  return result;
}

function keyDirectory(directoryPath: string, key: string): string {
  return path.join(directoryPath, createHash("sha256").update(key).digest("hex"));
}

async function waitForLine(child: ChildProcessWithoutNullStreams, expected: string): Promise<string> {
  let output = "";
  let errorOutput = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child timed out: ${output} ${errorOutput}`)), 5000);
    child.stderr.on("data", (chunk: Buffer) => { errorOutput += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(expected)) {
        clearTimeout(timer);
        resolve(output);
      }
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (!output.includes(expected)) reject(new Error(`child exited ${code}: ${output} ${errorOutput}`));
    });
  });
}

async function finishChild(child: ChildProcessWithoutNullStreams): Promise<string> {
  let output = "";
  let error = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString("utf8"); });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve(output) : reject(new Error(`child ${code}: ${error} ${output}`)));
  });
}

beforeEach(() => {
  fault.openTemporary = false;
  fault.writeTemporary = false;
  fault.syncTemporary = false;
  fault.rename = false;
  fault.syncDirectory = false;
  fault.syncHead = false;
  fault.failDirectorySyncOn = 0;
  fault.directorySyncs = 0;
  fault.headSyncs = 0;
});
afterEach(async () => {
  fault.openTemporary = false;
  fault.writeTemporary = false;
  fault.syncTemporary = false;
  fault.rename = false;
  fault.syncDirectory = false;
  fault.syncHead = false;
  fault.failDirectorySyncOn = 0;
  for (const item of directories.splice(0)) await fsPromises.rm(item, { recursive: true, force: true });
});

describe("private journal conditional durable store", () => {
  it("creates one genesis, uses only a hashed private path, and reloads after reopen", async () => {
    const root = await directory();
    const key = "../room/secret";
    const first = await createPrivateJournalCasStore({ directory: root, key, genesisData: { marker: "private", count: 0 } });
    expect(first.keyHash).toMatch(/^[0-9a-f]{64}$/);
    const initial = await first.load();
    expect(initial.head.revision).toBe(0);
    expect(initial.data).toEqual({ count: 0, marker: "private" });
    await expect(createPrivateJournalCasStore({ directory: root, key, genesisData: { marker: "other" } }))
      .rejects.toBeInstanceOf(PrivateJournalCasConflictError);
    const result = await first.compareAndSwap(initial.head, "write-1", { marker: "private", count: 1 });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("expected commit");
    expect(result.head.revision).toBe(1);
    const privateDir = keyDirectory(root, key);
    expect((await fsPromises.lstat(privateDir)).mode & 0o7777).toBe(0o700);
    expect((await fsPromises.lstat(path.join(privateDir, "head.json"))).mode & 0o7777).toBe(0o600);
    expect(await fsPromises.readdir(root)).toEqual([first.keyHash]);
    const blob = JSON.parse(await fsPromises.readFile(path.join(privateDir, "head.json"), "utf8"));
    expect(blob).toMatchObject({ revision: 1, nonce: result.head.nonce,
      parentNonce: initial.head.nonce, writeId: "write-1", data: { count: 1, marker: "private" } });
    expect(blob.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    await first.close();
    const reopened = await openPrivateJournalCasStore({ directory: root, key });
    const loaded = await reopened.load();
    expect(loaded.head).toEqual(result.head);
    expect((await reopened.compareAndSwap(loaded.head, "write-2", { count: 2 })).status).toBe("committed");
  });

  it("allows only one in-process writer and rejects clone, foreign and stale heads", async () => {
    const root = await directory();
    const store = await createPrivateJournalCasStore({ directory: root, key: "one", genesisData: 0 });
    const sibling = await openPrivateJournalCasStore({ directory: root, key: "one" });
    const other = await createPrivateJournalCasStore({ directory: root, key: "two", genesisData: 0 });
    const head = (await store.load()).head;
    await expect(store.compareAndSwap({ ...head }, "clone", 1)).rejects.toBeInstanceOf(PrivateJournalCasConflictError);
    await expect(sibling.compareAndSwap(head, "foreign-store", 1)).rejects.toBeInstanceOf(PrivateJournalCasConflictError);
    await expect(other.compareAndSwap(head, "foreign-key", 1)).rejects.toBeInstanceOf(PrivateJournalCasConflictError);
    const outcomes = await Promise.all([
      store.compareAndSwap(head, "a", 1),
      store.compareAndSwap(head, "b", 2)
    ]);
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(["committed", "conflict"]);
    const current = await sibling.load();
    expect(current.head.revision).toBe(1);
    const stale = await store.compareAndSwap(head, "stale", 3);
    expect(stale).toMatchObject({ status: "conflict", reason: "stale-head" });
    if (stale.status !== "conflict") throw new Error("expected conflict");
    expect(stale.current.head).toEqual(current.head);
  });

  it("returns the original receipt for a matching writeId and conflicts on another body", async () => {
    const root = await directory();
    const store = await createPrivateJournalCasStore({ directory: root, key: "receipts", genesisData: null });
    const genesis = (await store.load()).head;
    const committed = await store.compareAndSwap(genesis, "same-id", { a: 1, b: 2 });
    expect(committed.status).toBe("committed");
    const nextHead = (await store.load()).head;
    const second = await store.compareAndSwap(nextHead, "second-id", { a: 3 });
    expect(second.status).toBe("committed");
    const beforeDuplicateSyncs = fault.directorySyncs;
    const duplicate = await store.compareAndSwap(genesis, "same-id", { b: 2, a: 1 });
    expect(duplicate).toMatchObject({ status: "duplicate", head: committed.head, data: { a: 1, b: 2 } });
    expect(fault.directorySyncs).toBeGreaterThan(beforeDuplicateSyncs);
    expect((await store.compareAndSwap(genesis, "same-id", { a: 9 })).status).toBe("conflict");
    expect((await store.compareAndSwap(nextHead, "same-id", { a: 1, b: 2 })).status).toBe("duplicate");
    expect((await store.load()).head.revision).toBe(2);
  });

  it("uses a bounded lock wait and does not break an existing lock", async () => {
    const root = await directory();
    const key = "locked";
    const store = await createPrivateJournalCasStore({ directory: root, key, genesisData: 0, busyTimeoutMs: 20 });
    const head = (await store.load()).head;
    const lockPath = path.join(keyDirectory(root, key), ".cas.lock");
    const stalePidLock = "999999999:old-owner\n";
    await fsPromises.writeFile(lockPath, stalePidLock, { flag: "wx", mode: 0o600 });
    const started = Date.now();
    await expect(store.compareAndSwap(head, "blocked", 1)).rejects.toBeInstanceOf(PrivateJournalCasLockBusyError);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await fsPromises.readFile(lockPath, "utf8")).toBe(stalePidLock);
    expect((await store.load()).head.revision).toBe(0);
  });

  it("keeps the previous complete head on temporary write and rename failures", async () => {
    for (const failure of ["openTemporary", "writeTemporary", "syncTemporary", "rename"] as const) {
      const root = await directory();
      const key = `fail-${failure}`;
      const store = await createPrivateJournalCasStore({ directory: root, key, genesisData: { count: 0 } });
      const before = await store.load();
      fault[failure] = true;
      await expect(store.compareAndSwap(before.head, "failed", { count: 1 })).rejects.toThrow(/injected/);
      fault[failure] = false;
      await expect(store.load()).rejects.toThrow(/unresolved failed write/);
      const reopened = await openPrivateJournalCasStore({ directory: root, key });
      expect(await reopened.load()).toMatchObject({ head: before.head, data: { count: 0 } });
      expect((await reopened.compareAndSwap((await reopened.load()).head, "retry", { count: 1 })).status).toBe("committed");
      expect((await fsPromises.readdir(keyDirectory(root, key))).sort()).toEqual(["head.json"]);
    }
  });

  it("does not ACK a rename when directory fsync fails and can reconcile by writeId", async () => {
    const root = await directory();
    const key = "uncertain-sync";
    const store = await createPrivateJournalCasStore({ directory: root, key, genesisData: 0 });
    const genesis = (await store.load()).head;
    // The current head must be read durably first; fail the directory sync
    // performed immediately after the replacement rename.
    fault.failDirectorySyncOn = fault.directorySyncs + 2;
    await expect(store.compareAndSwap(genesis, "uncertain", 1)).rejects.toThrow(/injected directory sync failure/);
    fault.failDirectorySyncOn = 0;
    await expect(store.load()).rejects.toThrow(/unresolved failed write/);
    const reopened = await openPrivateJournalCasStore({ directory: root, key });
    const loaded = await reopened.load();
    expect(loaded.head.revision).toBe(1);
    const retry = await reopened.compareAndSwap(loaded.head, "uncertain", 1);
    expect(retry).toMatchObject({ status: "duplicate", head: loaded.head, data: 1 });
    expect((await reopened.compareAndSwap(loaded.head, "next", 2)).status).toBe("committed");
  });

  it("rejects recovery while directory fsync stays failed and confirms a duplicate after sync recovers", async () => {
    const root = await directory();
    const key = "persistent-sync-failure";
    const store = await createPrivateJournalCasStore({ directory: root, key, genesisData: 0 });
    const genesis = (await store.load()).head;
    fault.failDirectorySyncOn = fault.directorySyncs + 2;
    await expect(store.compareAndSwap(genesis, "same-write", 1)).rejects.toThrow(/injected directory sync failure/);
    const failedSyncCount = fault.directorySyncs;
    fault.failDirectorySyncOn = 0;
    fault.syncDirectory = true;
    await expect(openPrivateJournalCasStore({ directory: root, key })).rejects.toThrow(/injected directory sync failure/);
    await expect(store.compareAndSwap(genesis, "same-write", 1)).rejects.toThrow(/unresolved failed write/);
    fault.syncDirectory = false;
    const reopened = await openPrivateJournalCasStore({ directory: root, key });
    const loaded = await reopened.load();
    expect(loaded.data).toBe(1);
    expect(fault.directorySyncs).toBeGreaterThan(failedSyncCount);
    fault.syncDirectory = true;
    await expect(reopened.compareAndSwap(loaded.head, "same-write", 1))
      .rejects.toThrow(/injected directory sync failure/);
    await expect(reopened.load()).rejects.toThrow(/unresolved failed write/);
    fault.syncDirectory = false;
    const recovered = await openPrivateJournalCasStore({ directory: root, key });
    const recoveredHead = (await recovered.load()).head;
    const beforeDuplicateSyncs = fault.directorySyncs;
    const duplicate = await recovered.compareAndSwap(recoveredHead, "same-write", 1);
    expect(duplicate).toMatchObject({ status: "duplicate", data: 1, head: recoveredHead });
    expect(fault.directorySyncs).toBeGreaterThan(beforeDuplicateSyncs);
  });

  it("requires a durable head file before exposing a snapshot", async () => {
    const root = await directory();
    const key = "head-sync-failure";
    const store = await createPrivateJournalCasStore({ directory: root, key, genesisData: 0 });
    const head = (await store.load()).head;
    fault.syncHead = true;
    await expect(store.compareAndSwap(head, "blocked", 1)).rejects.toThrow(/injected head sync failure/);
    await expect(store.load()).rejects.toThrow(/unresolved failed write/);
    fault.syncHead = false;
    const reopened = await openPrivateJournalCasStore({ directory: root, key });
    expect((await reopened.load()).head).toEqual(head);
    fault.syncHead = true;
    await expect(reopened.load()).rejects.toThrow(/injected head sync failure/);
    await expect(reopened.compareAndSwap(head, "blocked", 1)).rejects.toThrow(/unresolved failed write/);
    await expect(openPrivateJournalCasStore({ directory: root, key })).rejects.toThrow(/injected head sync failure/);
  });

  it("rejects corruption, truncation, nonregular files and symlink replacement", async () => {
    const root = await directory();
    const key = "corrupt";
    const store = await createPrivateJournalCasStore({ directory: root, key, genesisData: { count: 0 } });
    const headPath = path.join(keyDirectory(root, key), "head.json");
    const original = await fsPromises.readFile(headPath);
    await fsPromises.writeFile(headPath, original.subarray(0, 12));
    await expect(store.load()).rejects.toThrow(/not valid JSON|truncated/);
    await fsPromises.writeFile(headPath, original);
    const decoded = JSON.parse(original.toString("utf8"));
    decoded.data.count = 9;
    await fsPromises.writeFile(headPath, JSON.stringify(decoded));
    await expect(store.load()).rejects.toThrow(/digest/);
    await fsPromises.rm(headPath);
    await fsPromises.symlink(path.join(root, "outside"), headPath);
    await expect(store.load()).rejects.toThrow();
    await fsPromises.rm(headPath);
    await fsPromises.mkdir(headPath);
    await expect(store.load()).rejects.toThrow();
  });

  it("refuses public file modes and a symbolic key directory without repairing them", async () => {
    const root = await directory();
    const key = "mode";
    await createPrivateJournalCasStore({ directory: root, key, genesisData: "private" });
    const headPath = path.join(keyDirectory(root, key), "head.json");
    await fsPromises.chmod(headPath, 0o644);
    await expect(openPrivateJournalCasStore({ directory: root, key })).rejects.toThrow(/not protected/);
    expect((await fsPromises.lstat(headPath)).mode & 0o7777).toBe(0o644);

    const linkedKey = "linked";
    const outside = await directory();
    await fsPromises.symlink(outside, keyDirectory(root, linkedKey));
    await expect(createPrivateJournalCasStore({ directory: root, key: linkedKey, genesisData: null }))
      .rejects.toThrow();
    expect(await fsPromises.readdir(outside)).toEqual([]);
  });

  it("rechecks private directory modes and symlinks on an existing store", async () => {
    const root = await directory();
    const key = "directory-replacement";
    const store = await createPrivateJournalCasStore({ directory: root, key, genesisData: 0 });
    const head = (await store.load()).head;
    const privateDir = keyDirectory(root, key);

    await fsPromises.chmod(root, 0o755);
    await expect(store.load()).rejects.toThrow(/not protected/);
    await expect(store.compareAndSwap(head, "public-root", 1)).rejects.toThrow(/not protected/);
    await fsPromises.chmod(root, 0o700);

    await fsPromises.chmod(privateDir, 0o755);
    await expect(store.load()).rejects.toThrow(/not protected/);
    await expect(store.compareAndSwap(head, "public-key", 1)).rejects.toThrow(/not protected/);
    await fsPromises.chmod(privateDir, 0o700);

    const moved = path.join(root, "moved-key-directory");
    await fsPromises.rename(privateDir, moved);
    await fsPromises.symlink(moved, privateDir);
    await expect(store.load()).rejects.toThrow();
    await expect(store.compareAndSwap(head, "linked-key", 1)).rejects.toThrow();
    expect((await fsPromises.readdir(moved)).sort()).toEqual(["head.json"]);
  });

  it("rejects accessors, toJSON, symbols, sparse arrays, nonfinite and nonplain values", async () => {
    const root = await directory();
    const store = await createPrivateJournalCasStore({ directory: root, key: "shape", genesisData: null });
    const head = (await store.load()).head;
    let invoked = 0;
    const accessor = Object.defineProperty({}, "secret", { enumerable: true, get() { invoked++; return "leak"; } });
    const toJson = { toJSON() { invoked++; return { forgery: true }; } };
    const sparse = new Array(2); sparse[0] = 1;
    for (const data of [accessor, toJson, sparse, { x: Infinity }, new Date(), { [Symbol("x")]: 1 }]) {
      await expect(store.compareAndSwap(head, "bad", data as never)).rejects.toThrow();
    }
    expect(invoked).toBe(0);
    const withProto = JSON.parse('{"__proto__":{"polluted":true},"ok":1}');
    expect((await store.compareAndSwap(head, "safe", withProto)).status).toBe("committed");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("has one real winner across two child processes", async () => {
    const root = await directory();
    const key = "cross-process";
    const store = await createPrivateJournalCasStore({ directory: root, key, genesisData: 0, busyTimeoutMs: 1000 });
    await store.close();
    const script = `
      import { openPrivateJournalCasStore } from ${JSON.stringify(moduleUrl)};
      const [directory, key, writeId] = process.argv.slice(1);
      const store = await openPrivateJournalCasStore({ directory, key, busyTimeoutMs: 1000 });
      const head = (await store.load()).head;
      process.stdout.write("ready\\n");
      for await (const chunk of process.stdin) { if (chunk.toString().includes("go")) break; }
      const outcome = await store.compareAndSwap(head, writeId, writeId);
      process.stdout.write(JSON.stringify({ status: outcome.status, revision: outcome.status === "conflict" ? outcome.currentHead.revision : outcome.head.revision }) + "\\n");
    `;
    const env = { ...process.env, TMPDIR: testRoot! };
    const makeChild = (writeId: string) => spawn(process.execPath,
      ["--import", tsxLoader, "--input-type=module", "-e", script, root, key, writeId],
      { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), env, stdio: "pipe" });
    const children = [makeChild("child-a"), makeChild("child-b")];
    await Promise.all(children.map(child => waitForLine(child, "ready\n")));
    const finished = children.map(finishChild);
    children.forEach(child => child.stdin.end("go\n"));
    const results = (await Promise.all(finished)).map(output => JSON.parse(output.trim()));
    expect(results.map(result => result.status).sort()).toEqual(["committed", "conflict"]);
    expect((await (await openPrivateJournalCasStore({ directory: root, key })).load()).head.revision).toBe(1);
  });
});

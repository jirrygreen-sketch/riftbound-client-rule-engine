import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  attachmentsFor,
  loadConfig,
  readSecretFile,
  createReportServerClient,
  createZiraClient,
  issueFieldsFor,
  loadState,
  readZiraAuthorization,
  runOnce,
  saveState
} from "./pull.mjs";

const config = {
  projectKey: "RIFT",
  issueType: "Task",
  parentKey: "RIFT-1046",
  labels: ["user-report", "m1"],
  batchSize: 10
};

function report(overrides = {}) {
  return {
    schemaVersion: 1,
    reportId: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
    createdAt: "2026-10-29T09:30:00.000Z",
    title: "换牌后卡住",
    description: "点了保留起手后一直转圈",
    client: { appVersion: "0.1.0", platform: "desktop-macos", userAgent: "UA", serverUrl: "https://rift-beta.xjerryx.com", locale: "zh-CN" },
    player: { name: "jirry", roomId: "78b0294b", playerId: "player-1" },
    clientLog: [
      { at: "2026-10-29T09:29:00.000Z", level: "info", source: "v2-session", message: "connected" },
      { at: "2026-10-29T09:29:30.000Z", level: "error", source: "v2-session", message: "Cannot read properties of null (reading 'eventSeq')" }
    ],
    matchLog: { roomId: "78b0294b", matchId: "m-1", protocol: "v2", viewerPlayerId: "A", capturedAt: "2026-10-29T09:30:00.000Z", entries: [{ at: "2026-10-29T09:29:10.000Z", kind: "status", payload: { status: "connected" } }] },
    ...overrides
  };
}

function fakeServer(reports) {
  const queue = [...reports];
  const acked = [];
  return {
    acked,
    queue,
    async pending(limit) { return queue.slice(0, limit); },
    async ack(ids) {
      acked.push(...ids);
      for (const id of ids) {
        const index = queue.findIndex(entry => entry.reportId === id);
        if (index >= 0) queue.splice(index, 1);
      }
      return ids.length;
    }
  };
}

function fakeZira({ failAttach = false, failNames = [] } = {}) {
  const issues = [];
  const attachments = [];
  return {
    issues,
    attachments,
    async createIssue(fields) {
      issues.push(fields);
      return `RIFT-${2000 + issues.length}`;
    },
    async attach(key, file) {
      if (failAttach || failNames.includes(file.name)) throw new Error("upload failed");
      attachments.push({ key, name: file.name, body: file.body });
    }
  };
}

test("files one issue per report with both logs attached, then acknowledges", async () => {
  const server = fakeServer([report()]);
  const zira = fakeZira();
  const state = { filed: {} };
  const summary = await runOnce({ server, zira, state, config, saveStateFn: async () => undefined });
  assert.deepEqual(summary, { fetched: 1, filed: 1, resumed: 0, reacknowledged: 0, skipped: 0, failed: 0 });
  assert.equal(zira.issues.length, 1);
  assert.equal(zira.issues[0].summary, "【玩家上报】换牌后卡住");
  assert.deepEqual(zira.issues[0].labels, ["user-report", "m1"]);
  assert.equal(zira.issues[0].parentKey, "RIFT-1046");
  assert.match(zira.issues[0].description, /点了保留起手后一直转圈/);
  assert.match(zira.issues[0].description, /reading 'eventSeq'/);
  assert.deepEqual(zira.attachments.map(file => file.name), ["client-log.json", "match-log.json"]);
  assert.deepEqual(server.acked, [report().reportId]);
  assert.equal(state.filed[report().reportId].issueKey, "RIFT-2001");
  assert.deepEqual(state.filed[report().reportId].uploaded, ["client-log.json", "match-log.json"]);
});

test("a report outside a match carries only the client log", () => {
  const files = attachmentsFor(report({ matchLog: null }));
  assert.deepEqual(files.map(file => file.name), ["client-log.json"]);
  assert.match(issueFieldsFor(report({ matchLog: null }), config).description, /不在对局中/);
});

test("an already filed report is only re-acknowledged, never filed twice", async () => {
  const server = fakeServer([report()]);
  const zira = fakeZira();
  const state = { filed: { [report().reportId]: { issueKey: "RIFT-1999", attached: true } } };
  const summary = await runOnce({ server, zira, state, config, saveStateFn: async () => undefined });
  assert.equal(summary.reacknowledged, 1);
  assert.equal(zira.issues.length, 0);
  assert.deepEqual(server.acked, [report().reportId]);
});

test("a partial attachment failure keeps the report queued, then uploads only the missing file", async () => {
  const server = fakeServer([report()]);
  const first = fakeZira({ failNames: ["match-log.json"] });
  const state = { filed: {} };
  const summary = await runOnce({ server, zira: first, state, config, saveStateFn: async () => undefined });
  assert.equal(summary.failed, 1);
  assert.deepEqual(server.acked, []);
  assert.deepEqual(first.attachments.map(file => file.name), ["client-log.json"]);
  assert.equal(state.filed[report().reportId].issueKey, "RIFT-2001");
  assert.deepEqual(state.filed[report().reportId].uploaded, ["client-log.json"]);

  // the next run reuses the issue, uploads only the missing attachment, then acknowledges
  const second = fakeZira();
  const again = await runOnce({ server, zira: second, state, config, saveStateFn: async () => undefined });
  assert.equal(again.resumed, 1);
  assert.equal(second.issues.length, 0);
  assert.deepEqual(second.attachments, [{ key: "RIFT-2001", name: "match-log.json", body: attachmentsFor(report())[1].body }]);
  assert.deepEqual(server.acked, [report().reportId]);
  assert.deepEqual(state.filed[report().reportId].uploaded, ["client-log.json", "match-log.json"]);
});

test("a complete report whose acknowledgement failed is only re-acknowledged", async () => {
  const server = fakeServer([report()]);
  const failingAck = { ...server, async ack() { throw new Error("ack HTTP 502"); } };
  const zira = fakeZira();
  const state = { filed: {} };
  await assert.rejects(runOnce({ server: failingAck, zira, state, config, saveStateFn: async () => undefined }), /ack HTTP 502/);
  assert.equal(zira.issues.length, 1);
  assert.equal(zira.attachments.length, 2);

  const retry = fakeZira();
  const again = await runOnce({ server, zira: retry, state, config, saveStateFn: async () => undefined });
  assert.equal(again.reacknowledged, 1);
  assert.equal(retry.issues.length, 0);
  assert.equal(retry.attachments.length, 0);
  assert.deepEqual(server.acked, [report().reportId]);
});

test("legacy state marked attached is treated as complete", async () => {
  const server = fakeServer([report()]);
  const zira = fakeZira();
  const state = { filed: { [report().reportId]: { issueKey: "RIFT-1999", attached: true } } };
  const summary = await runOnce({ server, zira, state, config, saveStateFn: async () => undefined });
  assert.equal(summary.reacknowledged, 1);
  assert.equal(zira.attachments.length, 0);
});

test("malformed reports are skipped and stay queued", async () => {
  const server = fakeServer([{ schemaVersion: 2, reportId: "x" }]);
  const zira = fakeZira();
  const summary = await runOnce({ server, zira, state: { filed: {} }, config, saveStateFn: async () => undefined });
  assert.equal(summary.skipped, 1);
  assert.equal(zira.issues.length, 0);
  assert.deepEqual(server.acked, []);
});

test("long titles and multi-line fields are bounded in the issue", () => {
  const long = "很".repeat(300);
  const fields = issueFieldsFor(report({ title: long, client: { ...report().client, userAgent: "a\nb\tc" } }), config);
  assert.ok(fields.summary.length <= "【玩家上报】".length + 120);
  assert.match(fields.description, /浏览器标识：a b c/);
});

test("server client sends the bearer token and parses pending/ack", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = url.includes("pending") ? { reports: [report()] } : { removed: 1 };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const client = createReportServerClient({ serverUrl: "https://example.test/", pullToken: "t".repeat(40), fetchImpl });
  assert.equal((await client.pending(5)).length, 1);
  assert.equal(await client.ack(["a"]), 1);
  assert.equal(calls[0].url, "https://example.test/api/issue-reports/pending?limit=5");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${"t".repeat(40)}`);
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), { reportIds: ["a"] });
});

test("server errors surface without leaking the token", async () => {
  const fetchImpl = async () => new Response("nope", { status: 401 });
  const client = createReportServerClient({ serverUrl: "https://example.test", pullToken: "secret-token-value-0123456789abcdef", fetchImpl });
  await assert.rejects(client.pending(1), error => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /secret-token-value/);
    return true;
  });
});

test("zira client posts Jira-style fields and multipart attachments", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(url.endsWith("/attachments") ? "[]" : JSON.stringify({ key: "RIFT-3000" }), { status: 201 });
  };
  const zira = createZiraClient({ baseUrl: "https://zira.example", authorization: "Bearer z", fetchImpl });
  const key = await zira.createIssue(issueFieldsFor(report(), config));
  await zira.attach(key, attachmentsFor(report())[0]);
  assert.equal(key, "RIFT-3000");
  const created = JSON.parse(calls[0].init.body);
  assert.deepEqual(created.fields.project, { key: "RIFT" });
  assert.deepEqual(created.fields.issuetype, { name: "Task" });
  assert.deepEqual(created.fields.parent, { key: "RIFT-1046" });
  assert.equal(calls[1].url, "https://zira.example/api/v1/issues/RIFT-3000/attachments");
  assert.ok(calls[1].init.body instanceof FormData);
});

test("the pull token is only read from a private regular file", async () => {
  const { chmod, writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(path.join(tmpdir(), "issue-puller-"));
  try {
    const file = path.join(directory, "token");
    const secret = "pull-token-0123456789abcdef0123456789";
    await writeFile(file, `${secret}\n`, { mode: 0o600 });
    await chmod(file, 0o600);
    assert.equal(await readSecretFile(file, "pull token"), secret);
    await chmod(file, 0o644);
    await assert.rejects(readSecretFile(file, "pull token"), error => {
      assert.match(error.message, /mode 644; chmod 600/);
      assert.doesNotMatch(error.message, /pull-token-0123/);
      return true;
    });
    await assert.rejects(readSecretFile(directory, "pull token"), /not a regular file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the Zira base URL must come from local config or the environment", async () => {
  const { writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(path.join(tmpdir(), "issue-puller-"));
  try {
    const missing = path.join(directory, "missing.json");
    await assert.rejects(loadConfig(missing, {}), /set "ziraBaseUrl"/);
    const fromEnv = await loadConfig(missing, { RIFTBOUND_ZIRA_BASE_URL: "https://zira.example.test/" });
    assert.equal(fromEnv.ziraBaseUrl, "https://zira.example.test");
    const file = path.join(directory, "config.json");
    await writeFile(file, JSON.stringify({ ziraBaseUrl: "https://tracker.example.test", batchSize: 3 }));
    const fromFile = await loadConfig(file, {});
    assert.equal(fromFile.ziraBaseUrl, "https://tracker.example.test");
    assert.equal(fromFile.batchSize, 3);
    assert.equal(fromFile.serverUrl, "https://rift-beta.xjerryx.com");
    await writeFile(file, JSON.stringify({ ziraBaseUrl: "http://tracker.example.test" }));
    await assert.rejects(loadConfig(file, {}), /https URL without credentials/);
    await writeFile(file, JSON.stringify({ ziraBaseUrl: "https://user:pw@tracker.example.test" }));
    await assert.rejects(loadConfig(file, {}), /https URL without credentials/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("state is written atomically with private permissions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "issue-puller-"));
  try {
    const file = path.join(directory, "nested", "state.json");
    assert.deepEqual(await loadState(file), { filed: {} });
    await saveState(file, { filed: { a: { issueKey: "RIFT-1" } } });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { filed: { a: { issueKey: "RIFT-1" } } });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reads the Zira authorization from the configured JSON path", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "issue-puller-"));
  try {
    const file = path.join(directory, "auth.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify({ mcpServers: { zira: { headers: { Authorization: "Bearer abc" } } } }));
    assert.equal(await readZiraAuthorization({ ziraAuthFile: file, ziraAuthPath: "mcpServers.zira.headers.Authorization" }), "Bearer abc");
    await assert.rejects(readZiraAuthorization({ ziraAuthFile: file, ziraAuthPath: "missing.path" }), /no Zira Authorization/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

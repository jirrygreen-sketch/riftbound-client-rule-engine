import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameServer, type GameServer } from "../../src/server.js";
import { IssueReportQueue } from "../../src/issue-reports.js";

const PULL_TOKEN = "r".repeat(48);
const EMPTY_CATALOG = {
  schemaVersion: 1,
  dataVersion: "issue-report-fixture",
  digest: `sha256:${"0".repeat(64)}`,
  cards: []
};

interface StartedServer {
  readonly server: GameServer;
  readonly baseUrl: string;
}

const servers: GameServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
  vi.restoreAllMocks();
});

function report(reportId: string, title = "Issue report") {
  return {
    schemaVersion: 1,
    reportId,
    createdAt: "2026-10-29T09:30:00.000Z",
    title,
    description: "The board did not update.",
    client: {
      appVersion: "0.1.0",
      platform: "desktop-macos",
      userAgent: "Riftbound test",
      serverUrl: "https://game.example.test",
      locale: "zh-CN"
    },
    player: { name: "Alice", roomId: "room-1" },
    clientLog: [{
      at: "2026-10-29T09:29:59.000Z",
      level: "info",
      source: "v2-session",
      message: "Connected",
      data: { stateVersion: 1 }
    }],
    matchLog: null
  };
}

function uuid(index = 1): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

async function startServer(
  options: Parameters<typeof createGameServer>[0] = {}
): Promise<StartedServer> {
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    catalog: EMPTY_CATALOG,
    ...options
  });
  servers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("The issue-report test server did not expose a TCP address.");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function submit(baseUrl: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}/api/issue-reports`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { response, json: await response.json() };
}

async function pending(
  baseUrl: string,
  token = PULL_TOKEN,
  query = ""
) {
  const response = await fetch(`${baseUrl}/api/issue-reports/pending${query}`, {
    headers: token === "" ? {} : { authorization: `Bearer ${token}` }
  });
  return { response, json: await response.json() };
}

async function acknowledge(baseUrl: string, reportIds: unknown) {
  const response = await fetch(`${baseUrl}/api/issue-reports/ack`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${PULL_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ reportIds })
  });
  return { response, json: await response.json() };
}

describe("issue report server API", () => {
  it("keeps every endpoint disabled without a configured pull token", async () => {
    const { baseUrl } = await startServer();

    const post = await submit(baseUrl, report(uuid()));
    expect(post.response.status).toBe(503);
    expect(post.json).toEqual({ error: "issue-reports-disabled" });

    const list = await pending(baseUrl, "");
    expect(list.response.status).toBe(503);
    expect(list.json).toEqual({ error: "issue-reports-disabled" });

    const ack = await acknowledge(baseUrl, [uuid()]);
    expect(ack.response.status).toBe(503);
    expect(ack.json).toEqual({ error: "issue-reports-disabled" });
  });

  it("accepts a report once, applies CORS only to intake, and acknowledges it", async () => {
    const { baseUrl } = await startServer({ issueReportPullToken: PULL_TOKEN });
    const sample = report(uuid());

    const preflight = await fetch(`${baseUrl}/api/issue-reports`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    for (let index = 0; index < 2; index += 1) {
      const accepted = await submit(baseUrl, sample, { origin: "http://localhost:5173" });
      expect(accepted.response.status).toBe(202);
      expect(accepted.response.headers.get("access-control-allow-origin")).toBe("*");
      expect(accepted.json).toEqual({ reportId: sample.reportId, status: "queued" });
    }

    const list = await pending(baseUrl);
    expect(list.response.status).toBe(200);
    expect(list.response.headers.get("access-control-allow-origin")).toBeNull();
    expect(list.json.reports).toEqual([sample]);

    const ack = await acknowledge(baseUrl, [sample.reportId, sample.reportId]);
    expect(ack.response.status).toBe(200);
    expect(ack.json).toEqual({ removed: 1 });
    expect((await pending(baseUrl)).json).toEqual({ reports: [] });

    const invalidAck = await acknowledge(baseUrl, "not-an-array");
    expect(invalidAck.response.status).toBe(400);
    expect(invalidAck.json).toEqual({ error: "invalid-ack" });
  });

  it("accepts RIFT-1131 redacted log fields and returns them unchanged in pending", async () => {
    const { baseUrl } = await startServer({ issueReportPullToken: PULL_TOKEN });
    const base = report(uuid());
    const sample = {
      ...base,
      clientLog: [{
        ...base.clientLog[0],
        data: {
          stateVersion: 1,
          resumeToken: "[redacted]",
          authorization: "[redacted]",
          creds: [{ password: "[redacted]" }]
        }
      }],
      matchLog: {
        roomId: "room-1",
        matchId: "match-1",
        protocol: "v2",
        viewerPlayerId: "player-1",
        capturedAt: "2026-10-29T09:30:00.000Z",
        entries: [{
          at: "2026-10-29T09:30:00.000Z",
          kind: "event",
          eventSeq: 1,
          payload: {
            audience: { visibility: "private" },
            session: { nested: { resumeToken: "[redacted]" } },
            credentials: [{ clientSecret: "[redacted]" }]
          }
        }]
      }
    };

    const accepted = await submit(baseUrl, sample);
    expect(accepted.response.status).toBe(202);
    expect(accepted.json).toEqual({ reportId: sample.reportId, status: "queued" });
    expect((await pending(baseUrl)).json).toEqual({ reports: [sample] });
  });

  it("rejects unredacted and noncanonical sensitive values with their paths", async () => {
    const { baseUrl } = await startServer({ issueReportPullToken: PULL_TOKEN });
    const base = report(uuid());
    const matchLog = {
      roomId: "room-1",
      matchId: "match-1",
      protocol: "v2",
      viewerPlayerId: "player-1",
      capturedAt: "2026-10-29T09:30:00.000Z",
      entries: [{
        at: "2026-10-29T09:30:00.000Z",
        kind: "event",
        payload: { nested: { resumeToken: "not-redacted" } }
      }]
    };

    for (const [field, value, expectedPath] of [
      ["resumeToken", "plaintext-token", "report.clientLog[0].data.resumeToken"],
      ["authorization", "Bearer plaintext", "report.clientLog[0].data.authorization"],
      ["password", "<redacted>", "report.clientLog[0].data.password"]
    ] as const) {
      const rejected = await submit(baseUrl, {
        ...base,
        clientLog: [{ ...base.clientLog[0], data: { [field]: value } }]
      });
      expect(rejected.response.status).toBe(400);
      expect(rejected.json).toEqual({
        error: "invalid-report",
        message: `${expectedPath} must be the string "[redacted]"`
      });
    }

    const rejected = await submit(baseUrl, { ...base, matchLog });
    expect(rejected.response.status).toBe(400);
    expect(rejected.json).toEqual({
      error: "invalid-report",
      message:
        "report.matchLog.entries[0].payload.nested.resumeToken must be the string \"[redacted]\""
    });
  });

  it("returns 400 for malformed, unknown, and oversized-field reports", async () => {
    const { baseUrl } = await startServer({ issueReportPullToken: PULL_TOKEN });
    const cases: unknown[] = [
      { ...report(uuid()), unexpected: true },
      report("00000000-0000-4000-8000-00000000000A"),
      { ...report(uuid()), title: "   " },
      { ...report(uuid()), description: "x".repeat(4001) },
      {
        ...report(uuid()),
        client: { ...report(uuid()).client, platform: "mobile" }
      },
      {
        ...report(uuid()),
        player: { name: "Alice", resumeToken: "must-not-be-accepted" }
      },
      {
        ...report(uuid()),
        clientLog: [{ ...report(uuid()).clientLog[0], data: { authorization: "Bearer secret" } }]
      },
      {
        ...report(uuid()),
        matchLog: {
          roomId: "room-1",
          matchId: null,
          protocol: "v2",
          viewerPlayerId: null,
          capturedAt: "2026-02-30T00:00:00.000Z",
          entries: []
        }
      },
      {
        ...report(uuid()),
        clientLog: [{ ...report(uuid()).clientLog[0], surprise: true }]
      },
      {
        ...report(uuid()),
        clientLog: Array.from({ length: 2001 }, () => report(uuid()).clientLog[0])
      },
      {
        ...report(uuid()),
        matchLog: {
          roomId: "room-1",
          matchId: null,
          protocol: "v2",
          viewerPlayerId: null,
          capturedAt: "2026-10-29T09:30:00.000Z",
          entries: [{
            at: "2026-10-29T09:30:00.000Z",
            kind: "event",
            payload: { body: "x".repeat(64 * 1024) }
          }]
        }
      }
    ];

    for (const sample of cases) {
      const index = cases.indexOf(sample);
      const rejected = await submit(baseUrl, sample);
      expect(rejected.response.status).toBe(400);
      expect(rejected.json).toMatchObject({ error: "invalid-report" });
      if (index === 6) {
        expect(rejected.json.message).toBe(
          "report.clientLog[0].data.authorization must be the string \"[redacted]\""
        );
      }
    }

    const wrongType = await fetch(`${baseUrl}/api/issue-reports`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(report(uuid()))
    });
    expect(wrongType.status).toBe(400);
  });

  it("returns 413 and never consumes a data chunk after the 2 MiB limit", async () => {
    const { server, baseUrl } = await startServer({ issueReportPullToken: PULL_TOKEN });
    let serverDataEvents = 0;
    let observedRequest: import("node:http").IncomingMessage | undefined;
    const observeRequest = (request: import("node:http").IncomingMessage): void => {
      observedRequest = request;
      const emit = request.emit;
      request.emit = function (this: import("node:http").IncomingMessage, event: string, ...args: unknown[]) {
        if (event === "data") serverDataEvents += 1;
        return emit.call(this, event, ...args);
      } as typeof request.emit;
      request.on("data", () => {});
    };
    server.httpServer.prependListener("request", observeRequest);

    const address = server.httpServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("The issue-report test server did not expose a TCP address.");
    }
    const socket = createConnection(address.port, "127.0.0.1");
    let responseText = "";
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      responseText += chunk;
    });
    const closed = new Promise<void>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", error => {
        if (!responseText.includes("HTTP/1.1 413")) reject(error);
      });
    });

    const thresholdChunk = Buffer.from(
      `{"description":"${"x".repeat(2 * 1024 * 1024 - 64)}"}`
    );
    socket.write(
      "POST /api/issue-reports HTTP/1.1\r\n" +
      "Host: 127.0.0.1\r\n" +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${thresholdChunk.byteLength + 1024}\r\n` +
      "Connection: close\r\n\r\n"
    );
    while (!socket.write(thresholdChunk)) {
      await new Promise(resolve => socket.once("drain", resolve));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    const dataEventsBeforeLateWrite = serverDataEvents;
    socket.write("x".repeat(1024));
    expect(serverDataEvents).toBe(dataEventsBeforeLateWrite);
    await closed;
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(responseText).toContain("HTTP/1.1 413 Payload Too Large\r\n");
    expect(responseText.toLowerCase()).toContain("connection: close\r\n");
    expect(responseText).toContain('{"error":"report-too-large"}');
    expect(serverDataEvents).toBeGreaterThan(0);
    expect(dataEventsBeforeLateWrite).toBe(serverDataEvents);
    expect(observedRequest?.socket.destroyed).toBe(true);
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await pending(baseUrl)).json).toEqual({ reports: [] });
  });

  it("requires a correct bearer token with constant-time comparison", async () => {
    const { baseUrl } = await startServer({ issueReportPullToken: PULL_TOKEN });

    for (const token of ["", "x".repeat(48)]) {
      const response = await pending(baseUrl, token);
      expect(response.response.status).toBe(401);
      expect(response.json).toEqual({ error: "unauthorized" });
    }

    const short = await pending(baseUrl, "short");
    expect(short.response.status).toBe(401);
    expect(short.json).toEqual({ error: "unauthorized" });

    const ackWithoutToken = await fetch(`${baseUrl}/api/issue-reports/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportIds: [] })
    });
    expect(ackWithoutToken.status).toBe(401);

    const preflight = await fetch(`${baseUrl}/api/issue-reports/pending`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET"
      }
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("orders pending reports by enqueue time and applies limit", async () => {
    const { baseUrl } = await startServer({ issueReportPullToken: PULL_TOKEN });
    await submit(baseUrl, report(uuid(2), "second submitted"));
    await submit(baseUrl, report(uuid(1), "first submitted"));
    await submit(baseUrl, report(uuid(3), "third submitted"));

    const all = await pending(baseUrl, PULL_TOKEN, "?limit=2");
    expect(all.response.status).toBe(200);
    expect(all.json.reports.map((item: { reportId: string }) => item.reportId))
      .toEqual([uuid(2), uuid(1)]);

    const defaultLimit = await startServer({
      issueReportPullToken: PULL_TOKEN
    });
    for (let index = 1; index <= 10; index += 1) {
      await submit(defaultLimit.baseUrl, report(uuid(index + 10)));
    }
    expect((await pending(defaultLimit.baseUrl)).json.reports).toHaveLength(10);
    expect((await pending(defaultLimit.baseUrl, PULL_TOKEN, "?limit=50")).json.reports)
      .toHaveLength(10);

    const invalidLimit = await pending(baseUrl, PULL_TOKEN, "?limit=abc");
    expect(invalidLimit.response.status).toBe(400);
    expect(invalidLimit.json).toEqual({ error: "invalid-query" });
  });

  it("rate limits by source IP and trusts the last X-Forwarded-For hop only from loopback", async () => {
    const { baseUrl } = await startServer({ issueReportPullToken: PULL_TOKEN });

    for (let index = 1; index <= 10; index += 1) {
      const accepted = await submit(baseUrl, report(uuid(index)), {
        "x-forwarded-for": "198.51.100.1, 192.0.2.44"
      });
      expect(accepted.response.status).toBe(202);
    }
    const limited = await submit(baseUrl, report(uuid(11)), {
      "x-forwarded-for": "198.51.100.1, 192.0.2.44"
    });
    expect(limited.response.status).toBe(429);
    expect(limited.json).toEqual({ error: "rate-limited" });

    const otherSource = await submit(baseUrl, report(uuid(12)), {
      "x-forwarded-for": "198.51.100.1, 192.0.2.45"
    });
    expect(otherSource.response.status).toBe(202);

    const nextForwardedSource = await submit(baseUrl, report(uuid(13)), {
      "x-forwarded-for": "198.51.100.1, 192.0.2.46"
    });
    expect(nextForwardedSource.response.status).toBe(202);

    const directSource = await submit(baseUrl, report(uuid(14)));
    expect(directSource.response.status).toBe(202);
  });

  it("enforces report, report-count, byte caps, and expiry in the queue", async () => {
    let now = Date.parse("2026-10-29T09:30:00.000Z");
    const countQueue = new IssueReportQueue({
      pullToken: PULL_TOKEN,
      clock: () => now,
      limits: { maxReports: 2 }
    });
    const oversizedReportQueue = new IssueReportQueue({ pullToken: PULL_TOKEN });
    const queue = new IssueReportQueue({
      pullToken: PULL_TOKEN,
      limits: { maxBytes: 1 }
    });
    try {
      expect(countQueue.enqueue(report(uuid(1)) as never, "source-a")).toBe("queued");
      await new Promise(resolve => setTimeout(resolve, 2));
      expect(countQueue.enqueue(report(uuid(2)) as never, "source-b")).toBe("queued");
      await new Promise(resolve => setTimeout(resolve, 2));
      expect(countQueue.enqueue(report(uuid(3)) as never, "source-c")).toBe("queue-full");
      now += 7 * 24 * 60 * 60 * 1000;
      expect(countQueue.pending()).toEqual([]);
      expect(countQueue.enqueue(report(uuid(4)) as never, "source-d")).toBe("queued");

      const oversized = {
        ...report(uuid(1)),
        clientLog: [{
          ...report(uuid(1)).clientLog[0],
          message: "x".repeat(2 * 1024 * 1024)
        }]
      };
      expect(oversizedReportQueue.enqueue(oversized as never, "127.0.0.1")).toBe("too-large");
      expect(oversizedReportQueue.size).toBe(0);
      expect(queue.enqueue(report(uuid()) as never, "127.0.0.1")).toBe("queue-full");
      expect(queue.size).toBe(0);
      expect(queue.bytes).toBe(0);
    } finally {
      countQueue.close();
      oversizedReportQueue.close();
      queue.close();
    }
  });

  it("returns queue-full over HTTP and expires reports with the injected clock", async () => {
    let now = 0;
    const queueFull = await startServer({
      issueReportPullToken: PULL_TOKEN,
      issueReportClock: () => now,
      issueReportLimits: { maxReports: 1 }
    });
    expect((await submit(queueFull.baseUrl, report(uuid(1)))).response.status).toBe(202);
    const full = await submit(queueFull.baseUrl, report(uuid(2)));
    expect(full.response.status).toBe(503);
    expect(full.json).toEqual({ error: "queue-full" });

    const expiry = await startServer({
      issueReportPullToken: PULL_TOKEN,
      issueReportClock: () => now
    });
    expect((await submit(expiry.baseUrl, report(uuid(3)))).response.status).toBe(202);
    now += 7 * 24 * 60 * 60 * 1000;
    expect((await pending(expiry.baseUrl)).json).toEqual({ reports: [] });
  });

  it("never writes report content or other files under storageDirectory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rift-1132-issue-report-"));
    const storageDirectory = path.join(root, "storage");
    await mkdir(storageDirectory);
    try {
      const { baseUrl } = await startServer({
        issueReportPullToken: PULL_TOKEN,
        storageDirectory
      });
      const before = await recursiveDirectorySnapshot(storageDirectory);
      expect((await submit(baseUrl, report(uuid()))).response.status).toBe(202);
      expect((await pending(baseUrl)).json.reports).toHaveLength(1);
      expect(await recursiveDirectorySnapshot(storageDirectory)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function recursiveDirectorySnapshot(
  directory: string,
  relative = ""
): Promise<readonly string[]> {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    result.push(`${entry.isDirectory() ? "dir" : "file"}:${child}`);
    if (entry.isDirectory()) {
      result.push(...await recursiveDirectorySnapshot(directory, child));
    }
  }
  return result.sort();
}

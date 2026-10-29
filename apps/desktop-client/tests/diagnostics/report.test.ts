import { describe, expect, it } from "vitest";
import {
  buildIssueReport,
  detectIssueReportPlatform,
  fitIssueReport,
  ISSUE_REPORT_BYTES,
  newIssueReportId,
  normalizeIssueServerUrl,
  submitIssueReport
} from "../../src/diagnostics/report";
import type { ClientLogEntry, IssueReportV1, MatchLogCapture } from "../../src/diagnostics/types";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function clientEntry(index: number, size = 10): ClientLogEntry {
  return { at: "2026-10-29T09:30:00.000Z", level: "info", source: "test",
    message: `${index}:${"x".repeat(Math.max(0, size - `${index}:`.length))}`.slice(0, size) };
}

function matchLog(entries = 1): MatchLogCapture {
  return { roomId: "room-1", matchId: "match-1", protocol: "v2", viewerPlayerId: "player-1",
    capturedAt: "2026-10-29T09:30:00.000Z",
    entries: Array.from({ length: entries }, (_, index) => ({
      at: "2026-10-29T09:30:00.000Z", kind: "event" as const, eventSeq: index + 1,
      payload: { index, text: "y".repeat(60_000) }
    })) };
}

describe("IssueReportV1 assembly", () => {
  it("distinguishes Tauri desktop and browser platforms", () => {
    expect(detectIssueReportPlatform("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64", true))
      .toBe("desktop-linux");
    expect(detectIssueReportPlatform("Mozilla/5.0 (Windows NT 10.0)", "Win32", true))
      .toBe("desktop-windows");
    expect(detectIssueReportPlatform("Mozilla/5.0 (Macintosh)", "MacIntel", true))
      .toBe("desktop-macos");
    expect(detectIssueReportPlatform("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64", false))
      .toBe("web");
  });
  it("generates a lowercase UUID v4 and emits the shared schema", () => {
    const reportId = newIssueReportId();
    expect(reportId).toMatch(UUID_V4);
    const report = buildIssueReport({
      title: "  对局无法继续  ", description: "复现步骤", appVersion: "0.1.0",
      platform: "desktop-linux", userAgent: "UA", serverUrl: "http://127.0.0.1:37480", locale: "zh-CN",
      playerName: "Alice", roomId: "room-1", playerId: "player-1",
      clientLog: [clientEntry(1)], matchLog: null
    }, reportId, "2026-10-29T09:30:00.000Z");
    expect(report).toEqual({
      schemaVersion: 1, reportId, createdAt: "2026-10-29T09:30:00.000Z",
      title: "对局无法继续", description: "复现步骤",
      client: { appVersion: "0.1.0", platform: "desktop-linux", userAgent: "UA",
        serverUrl: "http://127.0.0.1:37480", locale: "zh-CN" },
      player: { name: "Alice", roomId: "room-1", playerId: "player-1" },
      clientLog: [clientEntry(1)], matchLog: null
    } satisfies IssueReportV1);
  });

  it("clips oldest client entries before any match entry", () => {
    const report = buildIssueReport({
      title: "large", description: "", appVersion: "0.1.0", platform: "web",
      userAgent: "UA", serverUrl: "https://example.test", locale: "en",
      clientLog: Array.from({ length: 400 }, (_, index) => ({
        ...clientEntry(index, 40_000),
        data: { index, text: "x".repeat(7_000) }
      })),
      matchLog: matchLog(3)
    }, newIssueReportId(), "2026-10-29T09:30:00.000Z");
    const fitted = fitIssueReport(report);
    expect(new TextEncoder().encode(JSON.stringify(fitted)).byteLength).toBeLessThanOrEqual(ISSUE_REPORT_BYTES);
    expect(fitted.matchLog?.entries.at(-1)?.eventSeq).toBe(3);
    expect(fitted.matchLog?.entries.length).toBeGreaterThan(0);
    expect(fitted.clientLog.at(-1)?.message.startsWith("399:")).toBe(true);
    expect(fitted.clientLog.length).toBeLessThan(report.clientLog.length);
  });

  it("uses match entries last when an oversized report is still too large", () => {
    const report = buildIssueReport({
      title: "huge", description: "", appVersion: "0.1.0", platform: "web",
      userAgent: "UA", serverUrl: "https://example.test", locale: "en",
      clientLog: [], matchLog: matchLog(35)
    }, newIssueReportId(), "2026-10-29T09:30:00.000Z");
    const fitted = fitIssueReport(report);
    expect(fitted.clientLog).toEqual([]);
    expect(fitted.matchLog!.entries.length).toBeLessThan(35);
    expect(fitted.matchLog!.entries.at(-1)?.eventSeq).toBe(35);
    expect(new TextEncoder().encode(JSON.stringify(fitted)).byteLength).toBeLessThanOrEqual(ISSUE_REPORT_BYTES);
  });
});

describe("issue report submission client", () => {
  it("resolves web and websocket server paths to the HTTP API origin", () => {
    expect(normalizeIssueServerUrl("ws://127.0.0.1:37480/ws")).toBe("http://127.0.0.1:37480");
    expect(normalizeIssueServerUrl("wss://example.test/ws")).toBe("https://example.test");
    expect(normalizeIssueServerUrl("https://example.test/api/cards")).toBe("https://example.test");
    expect(normalizeIssueServerUrl("ftp://example.test")).toBeNull();
  });

  it.each([
    [202, 200], [413, 413], [429, 429], [503, 503]
  ])("maps HTTP %i to the expected client outcome", async (status, expectedStatus) => {
    const fetchImpl = (async () => new Response(null, { status })) as typeof fetch;
    const report = buildIssueReport({
      title: "error", description: "", appVersion: "0.1.0", platform: "web",
      userAgent: "UA", serverUrl: "http://server", locale: "en", clientLog: [], matchLog: null
    }, newIssueReportId());
    const outcome = await submitIssueReport(report, "ws://server/ws", fetchImpl);
    expect(outcome.status).toBe(expectedStatus === 200 ? "success" : "failure");
  });

  it("reports a network failure without throwing", async () => {
    const fetchImpl = (async () => { throw new Error("offline"); }) as typeof fetch;
    const report = buildIssueReport({
      title: "error", description: "", appVersion: "0.1.0", platform: "web",
      userAgent: "UA", serverUrl: "http://server", locale: "en", clientLog: [], matchLog: null
    }, newIssueReportId());
    await expect(submitIssueReport(report, "http://server", fetchImpl)).resolves.toMatchObject({
      status: "failure", retryable: true
    });
  });
});

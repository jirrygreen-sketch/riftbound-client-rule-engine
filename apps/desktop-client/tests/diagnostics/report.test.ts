import { describe, expect, it } from "vitest";
import {
  buildIssueReport,
  detectIssueReportPlatform,
  fitIssueReport,
  ISSUE_REPORT_BYTES,
  newIssueReportId,
  normalizeIssueServerUrl,
  prepareIssueReport,
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

  it("redacts text credentials in the final report", () => {
    const report = buildIssueReport({
      title: "credential leak", description: '{"Authorization":"Bearer REPORTSECRET"}',
      appVersion: "0.1.0", platform: "web", userAgent: "UA",
      serverUrl: "https://example.test", locale: "en",
      clientLog: [{ at: "2026-10-29T09:30:00.000Z", level: "error", source: "window",
        message: "resumeToken=CLIENTSECRET" }], matchLog: null
    }, newIssueReportId(), "2026-10-29T09:30:00.000Z");
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("REPORTSECRET");
    expect(serialized).not.toContain("CLIENTSECRET");
    expect(serialized).toContain("[redacted]");
  });

  it("redacts the reviewed API, cookie and session key forms from a final report", () => {
    const report = buildIssueReport({
      title: "reviewed credential forms",
      description: 'accessToken=ACCESS_SECRET&safe=1 apiToken: API_SECRET, done ' +
        'auth_token="SNAKE_SECRET"',
      appVersion: "0.1.0", platform: "web", userAgent: "UA",
      serverUrl: "https://example.test", locale: "en",
      clientLog: [{ at: "2026-10-29T09:30:00.000Z", level: "error", source: "window",
      message: 'sessionSecret=value {"apiKey":"K"} Cookie: a=b' }], matchLog: null
    }, newIssueReportId(), "2026-10-29T09:30:00.000Z");
    const serialized = JSON.stringify(report);
    for (const secret of ["ACCESS_SECRET", "API_SECRET", "SNAKE_SECRET"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain('"apiKey":"K"');
    expect(serialized).not.toContain("Cookie: a=b");
    expect(serialized).toContain("safe=1");
    expect(serialized).toContain("done");
  });

  it("redacts every player identity field and changes none because of the 64-character limit", () => {
    const secrets = [
      "PLAYER_AUTH_SECRET", "PLAYER_ACCESS_SECRET", "PLAYER_API_SECRET",
      "PLAYER_SNAKE_SECRET", "PLAYER_SESSION_SECRET", "PLAYER_JSON_SECRET"
    ];
    const forms = [
      "Authorization: Bearer PLAYER_AUTH_SECRET",
      "accessToken=PLAYER_ACCESS_SECRET",
      "apiToken:PLAYER_API_SECRET",
      'auth_token="PLAYER_SNAKE_SECRET"',
      "sessionSecret=PLAYER_SESSION_SECRET",
      '{"apiKey":"PLAYER_JSON_SECRET"}'
    ];
    for (const form of forms) {
      const report = buildIssueReport({
        title: "player redaction", description: "", appVersion: "0.1.0", platform: "web",
        userAgent: "UA", serverUrl: "https://example.test", locale: "en",
        playerName: form, roomId: form, playerId: form, clientLog: [], matchLog: null
      }, newIssueReportId(), "2026-10-29T09:30:00.000Z");
      const serialized = JSON.stringify(report);
      for (const secret of secrets) expect(serialized).not.toContain(secret);
      expect(report.player.name?.length).toBeLessThanOrEqual(64);
      expect(report.player.roomId?.length).toBeLessThanOrEqual(64);
      expect(report.player.playerId?.length).toBeLessThanOrEqual(64);
      expect(report.player.name).toContain("[redacted]");
      expect(report.player.roomId).toContain("[redacted]");
      expect(report.player.playerId).toContain("[redacted]");
      expect(serialized).toContain("[redacted]");
    }
  });

  it("applies the same redaction to report title, description, userAgent and serverUrl", () => {
    const forms = [
      "Authorization: Bearer META_AUTH_SECRET",
      "accessToken=META_ACCESS_SECRET",
      "apiToken:META_API_SECRET",
      'auth_token="META_SNAKE_SECRET"',
      "sessionSecret=META_SESSION_SECRET",
      '{"apiKey":"META_JSON_SECRET"}'
    ];
    for (const form of forms) {
      const report = buildIssueReport({
        title: form, description: form, appVersion: "0.1.0", platform: "web",
        userAgent: form, serverUrl: form, locale: "en", clientLog: [], matchLog: null
      }, newIssueReportId(), "2026-10-29T09:30:00.000Z");
      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain("META_AUTH_SECRET");
      expect(serialized).not.toContain("META_ACCESS_SECRET");
      expect(serialized).not.toContain("META_API_SECRET");
      expect(serialized).not.toContain("META_SNAKE_SECRET");
      expect(serialized).not.toContain("META_SESSION_SECRET");
      expect(serialized).not.toContain("META_JSON_SECRET");
      expect(serialized).toContain("[redacted]");
    }
  });

  it("redacts before trimming the 64-character player limit", () => {
    const report = buildIssueReport({
      title: "redaction ordering", description: "", appVersion: "0.1.0", platform: "web",
      userAgent: "UA", serverUrl: "https://example.test", locale: "en",
      playerName: `Authorization: Bearer ${'A'.repeat(80)}`, roomId: `accessToken=${'R'.repeat(80)}`,
      playerId: `sessionSecret=${'P'.repeat(80)}`, clientLog: [], matchLog: null
    }, newIssueReportId(), "2026-10-29T09:30:00.000Z");
    expect(report.player.name).toBe("Authorization: [redacted]");
    expect(report.player.roomId).toBe("accessToken=[redacted]");
    expect(report.player.playerId).toBe("sessionSecret=[redacted]");
    expect(report.player.name).not.toContain("AAAA");
    expect(report.player.roomId).not.toContain("RRRR");
    expect(report.player.playerId).not.toContain("PPPP");
  });

  it("does not rewrite already-redacted report text during fitting", () => {
    const raw = buildIssueReport({
      title: "Authorization: Bearer TITLE_SECRET",
      description: "accessToken=DESCRIPTION_SECRET&safe=1",
      appVersion: "0.1.0", platform: "web",
      userAgent: "apiToken:USER_AGENT_SECRET, done",
      serverUrl: '{"apiKey":"SERVER_SECRET"}', locale: "en",
      playerName: "sessionSecret=PLAYER_SECRET", roomId: "auth_token=\"ROOM_SECRET\"",
      playerId: "accessToken=ID_SECRET", clientLog: [], matchLog: null
    }, newIssueReportId(), "2026-10-29T09:30:00.000Z");
    const once = prepareIssueReport(raw);
    const twice = prepareIssueReport(once);
    expect(twice).toEqual(once);
    const serialized = JSON.stringify(twice);
    expect(serialized).not.toContain("[redacted]]");
    for (const secret of ["TITLE_SECRET", "DESCRIPTION_SECRET", "USER_AGENT_SECRET",
      "SERVER_SECRET", "PLAYER_SECRET", "ROOM_SECRET", "ID_SECRET"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("safe=1");
    expect(serialized).toContain("done");
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

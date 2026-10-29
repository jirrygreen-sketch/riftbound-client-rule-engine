import type { ClientLogEntry, IssueReportPlatform, IssueReportV1, MatchLogCapture } from "./types";
import { redactCredentialText, sanitizeDiagnosticRecord } from "./redaction";

export const ISSUE_REPORT_BYTES = 2 * 1024 * 1024;
export const ISSUE_REPORT_TITLE_MAX = 120;
export const ISSUE_REPORT_DESCRIPTION_MAX = 4_000;

export interface ReportContext {
  readonly title: string;
  readonly description: string;
  readonly appVersion: string;
  readonly platform: IssueReportPlatform;
  readonly userAgent: string;
  readonly serverUrl: string;
  readonly locale: string;
  readonly playerName?: string;
  readonly roomId?: string;
  readonly playerId?: string;
  readonly clientLog: readonly ClientLogEntry[];
  readonly matchLog: MatchLogCapture | null;
}

export function newIssueReportId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID().toLowerCase();
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function trimOptional(value: string | undefined, max: number): string | undefined {
  if (!value || !value.trim()) return undefined;
  return value.slice(0, max);
}

export function buildIssueReport(context: ReportContext, reportId: string, createdAt = new Date().toISOString()): IssueReportV1 {
  const clientLog = context.clientLog.slice(-2_000);
  const matchLog = context.matchLog === null ? null : {
    ...context.matchLog,
    entries: context.matchLog.entries.slice(-5_000)
  };
  return {
    schemaVersion: 1,
    reportId,
    createdAt,
    title: redactCredentialText(context.title).trim().slice(0, ISSUE_REPORT_TITLE_MAX),
    description: redactCredentialText(context.description).slice(0, ISSUE_REPORT_DESCRIPTION_MAX),
    client: {
      appVersion: context.appVersion.slice(0, 64),
      platform: context.platform,
      userAgent: redactCredentialText(context.userAgent).slice(0, 512),
      serverUrl: redactCredentialText(context.serverUrl).slice(0, 512),
      locale: redactCredentialText(context.locale).slice(0, 32)
    },
    player: {
      ...(trimOptional(context.playerName, 64) === undefined ? {} : { name: trimOptional(context.playerName, 64) }),
      ...(trimOptional(context.roomId, 64) === undefined ? {} : { roomId: trimOptional(context.roomId, 64) }),
      ...(trimOptional(context.playerId, 64) === undefined ? {} : { playerId: trimOptional(context.playerId, 64) })
    },
    clientLog: clientLog.map(entry => ({
      ...entry,
      source: entry.source.slice(0, 64),
      message: redactCredentialText(entry.message).slice(0, 2_000),
      ...(entry.data === undefined ? {} : { data: safeClientEntryData(entry.data) })
    })),
    matchLog: matchLog === null ? null : {
      ...matchLog,
      entries: matchLog.entries.map(entry => ({ ...entry, payload: safeReportPayload(entry.payload) }))
    }
  };
}

const SIXTY_FOUR_KIB = 64 * 1024;
const EIGHT_KIB = 8 * 1024;

function bytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

/** Clips oldest client entries first, then oldest match entries, until <= 2 MiB. */
export function fitIssueReport(report: IssueReportV1): IssueReportV1 {
  let clientLog = report.clientLog.slice(-2_000).map(entry => ({
    ...entry,
    source: entry.source.slice(0, 64),
    message: redactCredentialText(entry.message).slice(0, 2_000),
    ...(entry.data === undefined ? {} : { data: safeClientEntryData(entry.data) })
  }));
  let matchEntries = report.matchLog === null ? null : report.matchLog.entries.slice(-5_000).map(entry =>
    ({ ...entry, payload: safeReportPayload(entry.payload) }));
  let candidate: IssueReportV1 = report;
  const rebuild = (): IssueReportV1 => ({
    ...report,
    title: redactCredentialText(report.title).slice(0, ISSUE_REPORT_TITLE_MAX),
    description: redactCredentialText(report.description).slice(0, ISSUE_REPORT_DESCRIPTION_MAX),
    clientLog,
    matchLog: report.matchLog === null || matchEntries === null ? null : { ...report.matchLog, entries: matchEntries }
  });
  candidate = rebuild();
  while (bytes(candidate) > ISSUE_REPORT_BYTES && clientLog.length > 0) {
    clientLog = clientLog.slice(1);
    candidate = rebuild();
  }
  while (bytes(candidate) > ISSUE_REPORT_BYTES && matchEntries !== null && matchEntries.length > 0) {
    matchEntries = matchEntries.slice(1);
    candidate = rebuild();
  }
  if (bytes(candidate) > ISSUE_REPORT_BYTES) {
    throw new Error("Issue report exceeds 2 MiB after diagnostics were clipped.");
  }
  return candidate;
}

function safeReportPayload(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const sanitized = sanitizeDiagnosticRecord(payload);
  const size = new TextEncoder().encode(JSON.stringify(sanitized)).byteLength;
  return size <= SIXTY_FOUR_KIB ? sanitized : { diagnosticPayloadTruncated: true, originalBytes: size };
}

function safeClientEntryData(data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const sanitized = sanitizeDiagnosticRecord(data);
  const size = new TextEncoder().encode(JSON.stringify(sanitized)).byteLength;
  return size <= EIGHT_KIB ? sanitized : { diagnosticDataTruncated: true, originalBytes: size };
}

export function detectIssueReportPlatform(userAgent = "", platform = "", isDesktop = false): IssueReportPlatform {
  if (!isDesktop) return "web";
  if (/mac/i.test(platform) || /Macintosh|Mac OS X/i.test(userAgent)) return "desktop-macos";
  if (/win/i.test(platform) || /Windows/i.test(userAgent)) return "desktop-windows";
  if (/linux/i.test(platform) || /Linux/i.test(userAgent)) return "desktop-linux";
  return "web";
}

export type IssueSubmitOutcome =
  | { readonly status: "success"; readonly reportId: string }
  | { readonly status: "failure"; readonly message: string; readonly retryable: boolean };

export async function submitIssueReport(
  report: IssueReportV1,
  serverUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<IssueSubmitOutcome> {
  try {
    const normalizedServerUrl = normalizeIssueServerUrl(serverUrl);
    if (normalizedServerUrl === null) {
      return { status: "failure", message: "当前服务地址无效，无法提交报告。", retryable: false };
    }
    const response = await fetchImpl(`${normalizedServerUrl}/api/issue-reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fitIssueReport(report)),
      ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? { signal: AbortSignal.timeout(15_000) }
        : {})
    });
    if (response.ok) return { status: "success", reportId: report.reportId };
    if (response.status === 413) return { status: "failure", message: "报告超过服务器允许的大小，请缩短描述后重试。", retryable: true };
    if (response.status === 429) return { status: "failure", message: "提交过于频繁，请稍后再试。", retryable: true };
    if (response.status === 503) return { status: "failure", message: "问题上报服务暂不可用，请稍后重试。", retryable: true };
    return { status: "failure", message: `服务器未能接收报告（HTTP ${response.status}），请稍后重试。`, retryable: true };
  } catch {
    return { status: "failure", message: "网络错误，无法连接当前游戏服务器，请检查网络后重试。", retryable: true };
  }
}

/** Uses the catalog HTTP address resolver while accepting the active WS URL. */
export function normalizeIssueServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let value = trimmed;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `http://${value}`);
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    else if (parsed.protocol === "wss:") parsed.protocol = "https:";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.pathname = parsed.pathname.replace(/\/(?:ws|api\/cards)\/?$/iu, "").replace(/\/$/u, "");
    parsed.search = "";
    parsed.hash = "";
    value = parsed.toString().replace(/\/$/u, "");
  } catch { return null; }
  return value;
}

import { timingSafeEqual } from "node:crypto";

export const ISSUE_REPORT_SCHEMA_VERSION = 1 as const;
export const ISSUE_REPORT_MAX_BYTES = 2 * 1024 * 1024;
export const ISSUE_REPORT_MAX_QUEUE_ENTRIES = 200;
export const ISSUE_REPORT_MAX_QUEUE_BYTES = 100 * 1024 * 1024;
export const ISSUE_REPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const ISSUE_REPORT_RATE_LIMIT = 10;
export const ISSUE_REPORT_RATE_WINDOW_MS = 10 * 60 * 1000;
export const ISSUE_REPORT_DEFAULT_PENDING_LIMIT = 10;
export const ISSUE_REPORT_MAX_PENDING_LIMIT = 50;

export interface IssueReportV1 {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly createdAt: string;
  readonly title: string;
  readonly description: string;
  readonly client: {
    readonly appVersion: string;
    readonly platform: "desktop-macos" | "desktop-windows" | "desktop-linux" | "web";
    readonly userAgent: string;
    readonly serverUrl: string;
    readonly locale: string;
  };
  readonly player: {
    readonly name?: string;
    readonly roomId?: string;
    readonly playerId?: string;
  };
  readonly clientLog: readonly IssueReportClientLogEntry[];
  readonly matchLog: null | {
    readonly roomId: string;
    readonly matchId: string | null;
    readonly protocol: "v2";
    readonly viewerPlayerId: string | null;
    readonly capturedAt: string;
    readonly entries: readonly IssueReportMatchLogEntry[];
  };
}

export interface IssueReportClientLogEntry {
  readonly at: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly source: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface IssueReportMatchLogEntry {
  readonly at: string;
  readonly kind: "projection" | "event" | "command" | "receipt" | "error" | "status";
  readonly stateVersion?: number;
  readonly eventSeq?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface IssueReportQueueLimits {
  readonly maxReports: number;
  readonly maxBytes: number;
  readonly retentionMs: number;
  readonly rateLimitReports: number;
  readonly rateLimitWindowMs: number;
}

export interface IssueReportQueueOptions {
  readonly pullToken?: string;
  readonly clock?: () => number;
  readonly limits?: Partial<IssueReportQueueLimits>;
  readonly sweepIntervalMs?: number;
}

export type IssueReportValidationResult =
  | { readonly ok: true; readonly report: IssueReportV1 }
  | { readonly ok: false; readonly message: string };

export type IssueReportEnqueueResult =
  | "queued"
  | "duplicate"
  | "rate-limited"
  | "too-large"
  | "invalid-report"
  | "queue-full";

interface QueuedIssueReport {
  readonly report: IssueReportV1;
  readonly enqueuedAt: number;
  readonly bytes: number;
}

const DEFAULT_LIMITS: IssueReportQueueLimits = {
  maxReports: ISSUE_REPORT_MAX_QUEUE_ENTRIES,
  maxBytes: ISSUE_REPORT_MAX_QUEUE_BYTES,
  retentionMs: ISSUE_REPORT_RETENTION_MS,
  rateLimitReports: ISSUE_REPORT_RATE_LIMIT,
  rateLimitWindowMs: ISSUE_REPORT_RATE_WINDOW_MS
};

const ROOT_KEYS = new Set([
  "schemaVersion",
  "reportId",
  "createdAt",
  "title",
  "description",
  "client",
  "player",
  "clientLog",
  "matchLog"
]);
const CLIENT_KEYS = new Set([
  "appVersion",
  "platform",
  "userAgent",
  "serverUrl",
  "locale"
]);
const PLAYER_KEYS = new Set(["name", "roomId", "playerId"]);
const CLIENT_LOG_KEYS = new Set(["at", "level", "source", "message", "data"]);
const MATCH_LOG_KEYS = new Set([
  "roomId",
  "matchId",
  "protocol",
  "viewerPlayerId",
  "capturedAt",
  "entries"
]);
const MATCH_ENTRY_KEYS = new Set([
  "at",
  "kind",
  "stateVersion",
  "eventSeq",
  "payload"
]);
const CLIENT_PLATFORMS = new Set([
  "desktop-macos",
  "desktop-windows",
  "desktop-linux",
  "web"
]);
const CLIENT_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const MATCH_ENTRY_KINDS = new Set([
  "projection",
  "event",
  "command",
  "receipt",
  "error",
  "status"
]);
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;
const SENSITIVE_FIELD_PATTERN = /(?:token|secret|password|authorization)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  path: string
): string | null {
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  return unknown === undefined ? null : `${path}.${unknown} is not allowed`;
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  maximumCharacters: number,
  required = true
): string | null {
  const field = value[key];
  if (field === undefined && !required) return null;
  if (typeof field !== "string") return `${path}.${key} must be a string`;
  if (characterLength(field) > maximumCharacters) {
    return `${path}.${key} must be at most ${maximumCharacters} characters`;
  }
  return null;
}

function isIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , , ,] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > 31 ||
      hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const offsetHours = Number(match[9]);
    const offsetRemainder = Number(match[10]);
    if (offsetHours > 23 || offsetRemainder > 59) return false;
    offsetMinutes = (match[8] === "+" ? 1 : -1) * (offsetHours * 60 + offsetRemainder);
  }
  const local = new Date(timestamp + offsetMinutes * 60_000);
  return local.getUTCFullYear() === year &&
    local.getUTCMonth() + 1 === month &&
    local.getUTCDate() === day &&
    local.getUTCHours() === hour &&
    local.getUTCMinutes() === minute &&
    local.getUTCSeconds() === second;
}

function serializedObjectBytes(
  value: Readonly<Record<string, unknown>>,
  maximumBytes: number,
  path: string
): string | null {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return `${path} must be JSON-serializable`;
  }
  if (serialized === undefined) return `${path} must be JSON-serializable`;
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    return `${path} must serialize to at most ${maximumBytes} bytes`;
  }
  return null;
}

function findSensitiveField(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitiveField(value[index], `${path}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SENSITIVE_FIELD_PATTERN.test(key)) return `${childPath} is not allowed`;
    const found = findSensitiveField(child, childPath);
    if (found !== null) return found;
  }
  return null;
}

function hasSensitiveServerUrlParameter(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username.length > 0 || url.password.length > 0) return true;
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) return true;
  }
  return false;
}

export function validateIssueReport(input: unknown): IssueReportValidationResult {
  if (!isRecord(input)) {
    return { ok: false, message: "report must be an object" };
  }
  const unknownKey = hasOnlyKeys(input, ROOT_KEYS, "report");
  if (unknownKey !== null) return { ok: false, message: unknownKey };
  const sensitiveField = findSensitiveField(input, "report");
  if (sensitiveField !== null) return { ok: false, message: sensitiveField };

  if (input.schemaVersion !== ISSUE_REPORT_SCHEMA_VERSION) {
    return { ok: false, message: "report.schemaVersion must be 1" };
  }
  if (typeof input.reportId !== "string" || !UUID_V4_PATTERN.test(input.reportId)) {
    return { ok: false, message: "report.reportId must be a lowercase UUID v4" };
  }
  if (typeof input.createdAt !== "string" ||
      !input.createdAt.endsWith("Z") || !isIsoDate(input.createdAt)) {
    return { ok: false, message: "report.createdAt must be an ISO 8601 UTC timestamp" };
  }
  if (typeof input.title !== "string" || characterLength(input.title) < 1 ||
      characterLength(input.title) > 120 || input.title.trim().length === 0) {
    return { ok: false, message: "report.title must contain 1 to 120 characters" };
  }
  if (typeof input.description !== "string" || characterLength(input.description) > 4000) {
    return { ok: false, message: "report.description must be at most 4000 characters" };
  }

  if (!isRecord(input.client)) {
    return { ok: false, message: "report.client must be an object" };
  }
  const unknownClientKey = hasOnlyKeys(input.client, CLIENT_KEYS, "report.client");
  if (unknownClientKey !== null) return { ok: false, message: unknownClientKey };
  for (const [key, maximum] of [
    ["appVersion", 64],
    ["userAgent", 512],
    ["serverUrl", 512],
    ["locale", 32]
  ] as const) {
    const failure = stringField(input.client, key, "report.client", maximum);
    if (failure !== null) return { ok: false, message: failure };
  }
  if (typeof input.client.platform !== "string" ||
      !CLIENT_PLATFORMS.has(input.client.platform)) {
    return { ok: false, message: "report.client.platform is not supported" };
  }
  if (hasSensitiveServerUrlParameter(input.client.serverUrl as string)) {
    return { ok: false, message: "report.client.serverUrl must not contain credentials" };
  }

  if (!isRecord(input.player)) {
    return { ok: false, message: "report.player must be an object" };
  }
  const unknownPlayerKey = hasOnlyKeys(input.player, PLAYER_KEYS, "report.player");
  if (unknownPlayerKey !== null) return { ok: false, message: unknownPlayerKey };
  for (const key of PLAYER_KEYS) {
    const failure = stringField(input.player, key, "report.player", 64, false);
    if (failure !== null) return { ok: false, message: failure };
  }

  if (!Array.isArray(input.clientLog) || input.clientLog.length > 2000) {
    return { ok: false, message: "report.clientLog must contain at most 2000 entries" };
  }
  for (let index = 0; index < input.clientLog.length; index += 1) {
    const entry = input.clientLog[index];
    const path = `report.clientLog[${index}]`;
    if (!isRecord(entry)) return { ok: false, message: `${path} must be an object` };
    const unknownEntryKey = hasOnlyKeys(entry, CLIENT_LOG_KEYS, path);
    if (unknownEntryKey !== null) return { ok: false, message: unknownEntryKey };
    if (typeof entry.at !== "string" || !isIsoDate(entry.at)) {
      return { ok: false, message: `${path}.at must be an ISO 8601 timestamp` };
    }
    if (typeof entry.level !== "string" || !CLIENT_LOG_LEVELS.has(entry.level)) {
      return { ok: false, message: `${path}.level is not supported` };
    }
    const sourceFailure = stringField(entry, "source", path, 64);
    if (sourceFailure !== null) return { ok: false, message: sourceFailure };
    const messageFailure = stringField(entry, "message", path, 2000);
    if (messageFailure !== null) return { ok: false, message: messageFailure };
    if (entry.data !== undefined) {
      if (!isRecord(entry.data)) return { ok: false, message: `${path}.data must be an object` };
      const dataFailure = serializedObjectBytes(entry.data, 8 * 1024, `${path}.data`);
      if (dataFailure !== null) return { ok: false, message: dataFailure };
    }
  }

  if (input.matchLog !== null) {
    if (!isRecord(input.matchLog)) {
      return { ok: false, message: "report.matchLog must be null or an object" };
    }
    const unknownMatchKey = hasOnlyKeys(input.matchLog, MATCH_LOG_KEYS, "report.matchLog");
    if (unknownMatchKey !== null) return { ok: false, message: unknownMatchKey };
    if (typeof input.matchLog.roomId !== "string") {
      return { ok: false, message: "report.matchLog.roomId must be a string" };
    }
    if (input.matchLog.matchId !== null && typeof input.matchLog.matchId !== "string") {
      return { ok: false, message: "report.matchLog.matchId must be a string or null" };
    }
    if (input.matchLog.protocol !== "v2") {
      return { ok: false, message: "report.matchLog.protocol must be v2" };
    }
    if (input.matchLog.viewerPlayerId !== null &&
        typeof input.matchLog.viewerPlayerId !== "string") {
      return { ok: false, message: "report.matchLog.viewerPlayerId must be a string or null" };
    }
    if (typeof input.matchLog.capturedAt !== "string" ||
        !isIsoDate(input.matchLog.capturedAt)) {
      return { ok: false, message: "report.matchLog.capturedAt must be an ISO 8601 timestamp" };
    }
    if (!Array.isArray(input.matchLog.entries) || input.matchLog.entries.length > 5000) {
      return { ok: false, message: "report.matchLog.entries must contain at most 5000 entries" };
    }
    for (let index = 0; index < input.matchLog.entries.length; index += 1) {
      const entry = input.matchLog.entries[index];
      const path = `report.matchLog.entries[${index}]`;
      if (!isRecord(entry)) return { ok: false, message: `${path} must be an object` };
      const unknownEntryKey = hasOnlyKeys(entry, MATCH_ENTRY_KEYS, path);
      if (unknownEntryKey !== null) return { ok: false, message: unknownEntryKey };
      if (typeof entry.at !== "string" || !isIsoDate(entry.at)) {
        return { ok: false, message: `${path}.at must be an ISO 8601 timestamp` };
      }
      if (typeof entry.kind !== "string" || !MATCH_ENTRY_KINDS.has(entry.kind)) {
        return { ok: false, message: `${path}.kind is not supported` };
      }
      for (const key of ["stateVersion", "eventSeq"] as const) {
        const sequence = entry[key];
        if (sequence !== undefined &&
            (typeof sequence !== "number" || !Number.isFinite(sequence))) {
          return { ok: false, message: `${path}.${key} must be a finite number` };
        }
      }
      if (!isRecord(entry.payload)) {
        return { ok: false, message: `${path}.payload must be an object` };
      }
      const payloadFailure = serializedObjectBytes(
        entry.payload,
        64 * 1024,
        `${path}.payload`
      );
      if (payloadFailure !== null) return { ok: false, message: payloadFailure };
    }
  }

  return { ok: true, report: input as unknown as IssueReportV1 };
}

function mergeLimits(partial: Partial<IssueReportQueueLimits> | undefined): IssueReportQueueLimits {
  const limits = { ...DEFAULT_LIMITS, ...partial };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Issue report queue limit ${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function actualSourceIp(value: string): string {
  const normalized = value.trim();
  return normalized.length === 0 || normalized.toLowerCase() === "unknown"
    ? "unknown"
    : normalized;
}

export class IssueReportQueue {
  private readonly reports = new Map<string, QueuedIssueReport>();
  private readonly seenReportIds = new Set<string>();
  private readonly rateWindows = new Map<string, number[]>();
  private limits: IssueReportQueueLimits;
  private readonly clock: () => number;
  private readonly pullToken: Buffer | null;
  private readonly sweepTimer: NodeJS.Timeout;
  private readonly sweepIntervalMs: number;
  private queuedBytes = 0;
  private closed = false;

  constructor(options: IssueReportQueueOptions = {}) {
    if (options.pullToken !== undefined && options.pullToken.length > 0 &&
        characterLength(options.pullToken) < 32) {
      throw new TypeError("Issue report pull token must be at least 32 characters");
    }
    this.pullToken = options.pullToken === undefined || options.pullToken.length === 0
      ? null
      : Buffer.from(options.pullToken, "utf8");
    this.limits = mergeLimits(options.limits);
    this.clock = options.clock ?? Date.now;
    this.sweepIntervalMs = options.sweepIntervalMs ??
      Math.min(60_000, Math.max(1_000, this.limits.retentionMs));
    if (!Number.isSafeInteger(this.sweepIntervalMs) || this.sweepIntervalMs < 1) {
      throw new TypeError("Issue report sweep interval must be a positive safe integer");
    }
    this.sweepTimer = setInterval(() => this.sweepExpired(), this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  get enabled(): boolean {
    return this.pullToken !== null;
  }

  get size(): number {
    this.sweepExpired();
    return this.reports.size;
  }

  get bytes(): number {
    this.sweepExpired();
    return this.queuedBytes;
  }

  isAuthorized(authorization: string | undefined): boolean {
    if (this.pullToken === null || authorization === undefined) return false;
    const match = /^Bearer (.+)$/i.exec(authorization);
    if (match === null) return false;
    const supplied = Buffer.from(match[1]!, "utf8");
    return supplied.length === this.pullToken.length && timingSafeEqual(supplied, this.pullToken);
  }

  enqueue(report: IssueReportV1, sourceIp: string): IssueReportEnqueueResult {
    const now = this.now();
    const rateIdentity = actualSourceIp(sourceIp);
    this.sweepExpired(now);
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(report);
    } catch {
      return "invalid-report";
    }
    if (typeof serialized !== "string") return "invalid-report";
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > ISSUE_REPORT_MAX_BYTES) return "too-large";
    if (this.seenReportIds.has(report.reportId)) return "duplicate";

    const cutoff = now - this.limits.rateLimitWindowMs;
    const recent = (this.rateWindows.get(rateIdentity) ?? []).filter(at => at > cutoff);
    if (recent.length >= this.limits.rateLimitReports) {
      this.rateWindows.set(rateIdentity, recent);
      return "rate-limited";
    }

    if (this.reports.size >= this.limits.maxReports ||
        this.queuedBytes + bytes > this.limits.maxBytes) {
      return "queue-full";
    }

    recent.push(now);
    this.rateWindows.set(rateIdentity, recent);
    this.reports.set(report.reportId, { report, enqueuedAt: now, bytes });
    this.seenReportIds.add(report.reportId);
    this.queuedBytes += bytes;
    return "queued";
  }

  pending(limit: number = ISSUE_REPORT_DEFAULT_PENDING_LIMIT): IssueReportV1[] {
    this.sweepExpired();
    const bounded = Math.min(
      Math.max(1, Math.trunc(limit)),
      ISSUE_REPORT_MAX_PENDING_LIMIT
    );
    return [...this.reports.values()]
      .sort((left, right) => left.enqueuedAt - right.enqueuedAt)
      .slice(0, bounded)
      .map(item => item.report);
  }

  acknowledge(reportIds: readonly string[]): number {
    this.sweepExpired();
    let removed = 0;
    for (const reportId of new Set(reportIds)) {
      const queued = this.reports.get(reportId);
      if (queued === undefined) continue;
      this.reports.delete(reportId);
      this.queuedBytes -= queued.bytes;
      removed += 1;
    }
    return removed;
  }

  sweepExpired(now: number = this.now()): void {
    for (const [reportId, queued] of this.reports) {
      if (now - queued.enqueuedAt >= this.limits.retentionMs) {
        this.reports.delete(reportId);
        this.queuedBytes -= queued.bytes;
      }
    }
    const cutoff = now - this.limits.rateLimitWindowMs;
    for (const [sourceIp, timestamps] of this.rateWindows) {
      const recent = timestamps.filter(at => at > cutoff);
      if (recent.length === 0) this.rateWindows.delete(sourceIp);
      else this.rateWindows.set(sourceIp, recent);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.sweepTimer);
    this.reports.clear();
    this.seenReportIds.clear();
    this.rateWindows.clear();
    this.queuedBytes = 0;
  }

  private now(): number {
    const now = this.clock();
    if (!Number.isFinite(now)) throw new Error("Issue report clock returned a non-finite value");
    return now;
  }
}

export function normalizePendingLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return ISSUE_REPORT_DEFAULT_PENDING_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return ISSUE_REPORT_DEFAULT_PENDING_LIMIT;
  return Math.min(parsed, ISSUE_REPORT_MAX_PENDING_LIMIT);
}

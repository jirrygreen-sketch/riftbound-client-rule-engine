import { sanitizeDiagnosticRecord, safeErrorMessage } from "./redaction";
import type { DiagnosticStorage } from "./match-log";
import type { ClientLogEntry, ClientLogLevel } from "./types";

export const CLIENT_LOG_STORAGE_KEY = "riftbound.desktop-client.client-log.v1";
export const CLIENT_LOG_LIMIT = 2_000;
export const CLIENT_LOG_STORAGE_BYTES = 512 * 1024;

export type { DiagnosticStorage } from "./match-log";

export interface ClientLogInput {
  readonly level: ClientLogLevel;
  readonly source: string;
  readonly message: string;
  readonly data?: unknown;
  readonly at?: string;
}

function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }

function normalize(input: ClientLogInput): ClientLogEntry {
  return {
    at: typeof input.at === "string" && !Number.isNaN(Date.parse(input.at))
      ? input.at : new Date().toISOString(),
    level: input.level,
    source: safeErrorMessage(input.source).slice(0, 64),
    message: safeErrorMessage(input.message).slice(0, 2_000),
    ...(input.data === undefined ? {} : { data: sanitizeDiagnosticRecord(input.data) })
  };
}

export function trimClientLog(entries: readonly ClientLogEntry[]): ClientLogEntry[] {
  let next = entries.slice(-CLIENT_LOG_LIMIT).map(entry => enforceEntryCap(entry));
  while (next.length > 0 && byteLength(JSON.stringify(next)) > CLIENT_LOG_STORAGE_BYTES) next = next.slice(1);
  return next;
}

function enforceEntryCap(entry: ClientLogEntry): ClientLogEntry {
  if (entry.data === undefined) return entry;
  const data = sanitizeDiagnosticRecord(entry.data);
  const size = byteLength(JSON.stringify(data));
  return size <= 8 * 1024 ? { ...entry, data } : {
    ...entry,
    data: { diagnosticDataTruncated: true, originalBytes: size }
  };
}

export function readClientLog(storage: DiagnosticStorage | null): ClientLogEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CLIENT_LOG_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const entries = value.flatMap(item => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at)) ||
          !["debug", "info", "warn", "error"].includes(String(record.level)) ||
          typeof record.source !== "string" || typeof record.message !== "string") return [];
      const data = record.data !== null && typeof record.data === "object" && !Array.isArray(record.data)
        ? sanitizeDiagnosticRecord(record.data) : undefined;
      return [normalize({ at: record.at, level: record.level as ClientLogLevel,
        source: record.source, message: record.message, data })];
    });
    return trimClientLog(entries);
  } catch { return []; }
}

let memoryEntries: ClientLogEntry[] = [];
let activeStorage: DiagnosticStorage | null = null;

export function initializeClientLog(storage: DiagnosticStorage | null): void {
  activeStorage = storage;
  memoryEntries = readClientLog(storage);
}

export function appendClientLog(input: ClientLogInput): ClientLogEntry {
  const entry = normalize(input);
  memoryEntries = trimClientLog([...memoryEntries, entry]);
  if (activeStorage) {
    try { activeStorage.setItem(CLIENT_LOG_STORAGE_KEY, JSON.stringify(memoryEntries)); } catch { /* best effort */ }
  }
  return entry;
}

/** Binds this process's client log to the app's single local storage instance. */
export function bindClientLogStorage(storage: DiagnosticStorage | null): void {
  activeStorage = storage;
  if (memoryEntries.length === 0) memoryEntries = readClientLog(storage);
}

/** Releases the process-scoped buffer after tests or an explicit app teardown. */
export function resetClientLogForTests(): void {
  activeStorage = null;
  memoryEntries = [];
}

export function getClientLog(): readonly ClientLogEntry[] { return memoryEntries; }

export function installClientLogCapture(target: Window, storage: DiagnosticStorage | null): () => void {
  initializeClientLog(storage);
  const onError = (event: ErrorEvent): void => {
    if ((event.target as unknown) !== target && !(event.error instanceof Error)) return;
    appendClientLog({ level: "error", source: "window",
      message: safeErrorMessage(event.error ?? event.message) });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    appendClientLog({ level: "error", source: "window",
      message: safeErrorMessage(event.reason) });
  };
  const consoleTarget = globalThis.console;
  const originalWarn = consoleTarget.warn;
  const originalError = consoleTarget.error;
  const warn = (...args: unknown[]): void => {
    appendClientLog({ level: "warn", source: "console", message: args.map(safeErrorMessage).join(" "), data: { args } });
    originalWarn.apply(consoleTarget, args);
  };
  const error = (...args: unknown[]): void => {
    appendClientLog({ level: "error", source: "console", message: args.map(safeErrorMessage).join(" "), data: { args } });
    originalError.apply(consoleTarget, args);
  };
  target.addEventListener("error", onError, true);
  target.addEventListener("unhandledrejection", onRejection);
  consoleTarget.warn = warn;
  consoleTarget.error = error;
  return () => {
    target.removeEventListener("error", onError, true);
    target.removeEventListener("unhandledrejection", onRejection);
    consoleTarget.warn = originalWarn;
    consoleTarget.error = originalError;
  };
}

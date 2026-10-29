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
let persistenceDisabled = false;
let persisting = false;

export function initializeClientLog(storage: DiagnosticStorage | null): void {
  activeStorage = storage;
  persistenceDisabled = false;
  persisting = false;
  memoryEntries = readClientLog(storage);
}

/** A repeated bind only swaps a not-yet-seen storage, never discards memory. */
export function bindClientLogStorage(storage: DiagnosticStorage | null): void {
  if (activeStorage === storage) return;
  activeStorage = storage;
  if (memoryEntries.length === 0) memoryEntries = readClientLog(storage);
}

export function appendClientLog(input: ClientLogInput): ClientLogEntry {
  const entry = normalize(input);
  memoryEntries = trimClientLog([...memoryEntries, entry]);
  if (!persistenceDisabled) persistClientLog();
  return entry;
}


function persistClientLog(): void {
  if (!activeStorage || persisting || persistenceDisabled) return;
  persisting = true;
  try {
    activeStorage.setItem(CLIENT_LOG_STORAGE_KEY, JSON.stringify(memoryEntries));
  } catch {
    // A storage quota/security exception is commonly exposed as a window error.
    // Stop this session's persistence before the capture hook can append that
    // same exception and recurse through another failing setItem call.
    persistenceDisabled = true;
    // A synchronous exception from setItem is not delivered to the window
    // capture listeners by every host. Surface the storage failure once in the
    // in-memory buffer without attempting another persistent write.
    memoryEntries = trimClientLog([...memoryEntries, normalize({
      level: "warn",
      source: "client-log-storage",
      message: "客户端日志持久化失败，已停止本次会话的磁盘写入。"
    })]);
  } finally {
    persisting = false;
  }
}

/** Releases the process-scoped buffer after tests or an explicit app teardown. */
export function resetClientLogForTests(): void {
  activeStorage = null;
  memoryEntries = [];
  persistenceDisabled = false;
  persisting = false;
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

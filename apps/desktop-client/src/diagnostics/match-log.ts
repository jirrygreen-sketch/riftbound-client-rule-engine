import { sanitizeDiagnosticRecord } from "./redaction";
import type { MatchLogCapture, MatchLogEntry, MatchLogKind } from "./types";

export const MATCH_LOG_SETTINGS_KEY = "riftbound.desktop-client.match-log-settings.v1";
export const MATCH_LOG_KEY_PREFIX = "riftbound.desktop-client.match-log.v1.";
export const MATCH_LOG_HISTORY_KEY = "riftbound.desktop-client.match-log-history.v1";
export const MATCH_LOG_KEEP = 5;
export const MATCH_LOG_ENTRY_LIMIT = 5_000;
export const MATCH_LOG_BYTES = 1024 * 1024;

interface MatchLogRecord extends MatchLogCapture { readonly updatedAt: string; readonly entries: MatchLogEntry[]; }
interface MatchLogHistory { readonly schemaVersion: 1; readonly roomIds: readonly string[]; }
interface MatchLogSettings { readonly schemaVersion: 1; readonly activeRoomId: string | null; }

export interface DiagnosticStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const MAX_ENTRY_SCHEMA_BYTES = 64 * 1024;

function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function roomKey(roomId: string): string { return `${MATCH_LOG_KEY_PREFIX}${encodeURIComponent(roomId)}`; }

function readRecord(storage: DiagnosticStorage, roomId: string): MatchLogRecord | null {
  try {
    const raw = storage.getItem(roomKey(roomId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.roomId !== roomId || record.protocol !== "v2" || !Array.isArray(record.entries)) return null;
    return record as unknown as MatchLogRecord;
  } catch { return null; }
}

export function readMatchLogHistory(storage: DiagnosticStorage | null): string[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(MATCH_LOG_HISTORY_KEY) ?? "null");
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
    const roomIds = (value as Record<string, unknown>).roomIds;
    if (!Array.isArray(roomIds)) return [];
    return roomIds.filter((id): id is string => typeof id === "string").slice(-MATCH_LOG_KEEP);
  } catch { return []; }
}

function writeHistory(storage: DiagnosticStorage, roomIds: readonly string[]): void {
  const unique = [...new Set(roomIds.filter(Boolean))].slice(-MATCH_LOG_KEEP);
  const history: MatchLogHistory = { schemaVersion: 1, roomIds: unique };
  storage.setItem(MATCH_LOG_HISTORY_KEY, JSON.stringify(history));
}

export function readActiveMatchRoom(storage: DiagnosticStorage | null): string | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(MATCH_LOG_SETTINGS_KEY) ?? "null");
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const roomId = (value as Record<string, unknown>).activeRoomId;
    return typeof roomId === "string" ? roomId : null;
  } catch { return null; }
}

export function setActiveMatchRoom(storage: DiagnosticStorage | null, roomIdValue: string | null): void {
  if (!storage) return;
  try {
    const value: MatchLogSettings = { schemaVersion: 1, activeRoomId: roomIdValue };
    storage.setItem(MATCH_LOG_SETTINGS_KEY, JSON.stringify(value));
  } catch { /* best effort */ }
}

/** Ends only the active match; historical room logs remain locally available. */
export function clearActiveMatchRoom(storage: DiagnosticStorage | null): void {
  setActiveMatchRoom(storage, null);
}

export function appendMatchLog(
  storage: DiagnosticStorage | null,
  input: {
    readonly roomId: string;
    readonly matchId?: string | null;
    readonly viewerPlayerId?: string | null;
    readonly kind: MatchLogKind;
    readonly stateVersion?: number;
    readonly eventSeq?: number;
    readonly payload: unknown;
    readonly at?: string;
  }
): void {
  if (!storage || !input.roomId) return;
  try {
    const history = readMatchLogHistory(storage);
    const at = typeof input.at === "string" && !Number.isNaN(Date.parse(input.at))
      ? input.at : new Date().toISOString();
    const previous = readRecord(storage, input.roomId);
    const sanitizedPayload = sanitizeDiagnosticRecord(input.payload);
    const serializedPayload = JSON.stringify(sanitizedPayload);
    if (byteLength(serializedPayload) > MAX_ENTRY_SCHEMA_BYTES) {
      appendMatchLog(storage, {
        roomId: input.roomId,
        matchId: input.matchId,
        viewerPlayerId: input.viewerPlayerId,
        kind: input.kind,
        stateVersion: input.stateVersion,
        eventSeq: input.eventSeq,
        at: input.at,
        payload: { truncated: true, originalBytes: byteLength(serializedPayload) }
      });
      return;
    }
    const entry: MatchLogEntry = {
      at,
      kind: input.kind,
      ...(input.stateVersion === undefined ? {} : { stateVersion: input.stateVersion }),
      ...(input.eventSeq === undefined ? {} : { eventSeq: input.eventSeq }),
      payload: sanitizedPayload
    };
    let entries = [...(previous?.entries ?? []), entry].slice(-MATCH_LOG_ENTRY_LIMIT);
    let record: MatchLogRecord = {
      roomId: input.roomId,
      matchId: input.matchId !== undefined ? input.matchId : previous?.matchId ?? null,
      protocol: "v2",
      viewerPlayerId: input.viewerPlayerId !== undefined
        ? input.viewerPlayerId : previous?.viewerPlayerId ?? null,
      capturedAt: previous?.capturedAt ?? at,
      updatedAt: at,
      entries
    };
    while (entries.length > 0 && byteLength(JSON.stringify(record)) > MATCH_LOG_BYTES) {
      entries = entries.slice(1);
      record = { ...record, entries };
    }
    storage.setItem(roomKey(input.roomId), JSON.stringify(record));
    const nextHistory = [...history.filter(id => id !== input.roomId), input.roomId].slice(-MATCH_LOG_KEEP);
    for (const removed of history.filter(id => !nextHistory.includes(id))) {
      try { storage.removeItem?.(roomKey(removed)); } catch { /* best effort */ }
    }
    writeHistory(storage, nextHistory);
  } catch { /* diagnostics never affect gameplay */ }
}

export function readMatchLog(storage: DiagnosticStorage | null, roomId: string): MatchLogCapture | null {
  if (!storage || !roomId) return null;
  const record = readRecord(storage, roomId);
  return record === null ? null : {
    roomId: record.roomId, matchId: record.matchId, protocol: "v2",
    viewerPlayerId: record.viewerPlayerId, capturedAt: record.capturedAt,
    entries: record.entries.map(entry => ({ ...entry, payload: sanitizeDiagnosticRecord(entry.payload) }))
  };
}

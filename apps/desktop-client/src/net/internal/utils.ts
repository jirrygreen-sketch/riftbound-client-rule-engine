import type { ClientSession, ClientToServerMessage, RoomDeckSubmission } from "@riftbound/protocol";
import type { StoredSession } from "./types";

export function sameSession(left: ClientSession, right: ClientSession): boolean {
  return left.roomId === right.roomId && left.playerId === right.playerId &&
    left.resumeToken === right.resumeToken;
}

export function sameStoredSession(left: StoredSession, right: StoredSession): boolean {
  return sameSession(left, right) && left.serverUrl === right.serverUrl;
}

export function requestIdOf(message: ClientToServerMessage): string | null {
  return "requestId" in message && typeof message.requestId === "string"
    ? message.requestId
    : null;
}

export function normalizeRoomDeck(deck: RoomDeckSubmission): RoomDeckSubmission | null {
  if (typeof deck !== "object" || deck === null) return null;
  const result: Record<string, { cardId: string; quantity: number }[]> = {};
  for (const [zone, entries] of Object.entries(deck)) {
    if (!Array.isArray(entries)) return null;
    const normalizedEntries: { cardId: string; quantity: number }[] = [];
    for (const entry of entries) {
      if (
        typeof entry?.cardId !== "string" ||
        !entry.cardId ||
        typeof entry.quantity !== "number" ||
        !Number.isSafeInteger(entry.quantity) ||
        entry.quantity <= 0
      ) return null;
      normalizedEntries.push({ cardId: entry.cardId, quantity: entry.quantity });
    }
    result[zone] = normalizedEntries;
  }
  return result;
}

export function requirePlayerName(input: string): string | null {
  const name = input.trim();
  if (!name || name.length > 32) return null;
  return name;
}

export function createCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable");
  }
  return globalThis.crypto.randomUUID();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

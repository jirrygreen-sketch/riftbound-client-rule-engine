import type { ClientSession } from "@riftbound/protocol";
import type { StorageLike } from "../../settings/display-settings";

export const V2_SESSION_STORAGE_KEY = "riftbound.desktop-client.protocol-v2-session.v1";

export function readV2Session(storage: StorageLike | null): ClientSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(V2_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isSession(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeV2Session(storage: StorageLike | null, session: ClientSession | null): boolean {
  if (!storage) return false;
  try {
    if (session === null) storage.setItem(V2_SESSION_STORAGE_KEY, "");
    else storage.setItem(V2_SESSION_STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

function isSession(value: unknown): value is ClientSession {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as { roomId?: unknown }).roomId === "string" &&
    typeof (value as { playerId?: unknown }).playerId === "string" &&
    typeof (value as { resumeToken?: unknown }).resumeToken === "string";
}

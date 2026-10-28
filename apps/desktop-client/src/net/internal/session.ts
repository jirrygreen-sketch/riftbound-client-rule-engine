import { isRecord } from "./utils";
import type { StoredSession } from "./types";
import { DEFAULT_WS_SERVER_URL } from "../server-defaults";

const STORAGE_KEY = "riftbound.desktop-client.session";
const DEFAULT_SERVER_URL = `${DEFAULT_WS_SERVER_URL}/ws`;

export function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.playerId !== "string" ||
      typeof value.resumeToken !== "string" ||
      typeof value.roomId !== "string" ||
      typeof value.serverUrl !== "string"
    ) {
      return null;
    }
    return {
      playerId: value.playerId,
      resumeToken: value.resumeToken,
      roomId: value.roomId,
      serverUrl: value.serverUrl
    };
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Resume storage is best-effort; the server can always issue a fresh session.
  }
}

export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim() || DEFAULT_SERVER_URL;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : "ws://" + trimmed.replace(/^\/+/, "");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    return null;
  }

  if (!url.hostname) return null;

  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ws";
  } else if (!/\/ws\/?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/$/, "") + "/ws";
  }
  url.hash = "";
  return url.toString();
}

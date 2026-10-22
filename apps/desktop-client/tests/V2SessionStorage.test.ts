import { describe, expect, it } from "vitest";
import {
  readV2Session,
  V2_SESSION_STORAGE_KEY,
  writeV2Session
} from "../src/full-product/v2/session-storage";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("protocol v2 session storage", () => {
  it("persists only its own resume session key", () => {
    const storage = new MemoryStorage();
    const session = { roomId: "room-v2", playerId: "player-1", resumeToken: "opaque-token" };
    expect(writeV2Session(storage, session)).toBe(true);
    expect(readV2Session(storage)).toEqual(session);
    expect(storage.getItem(V2_SESSION_STORAGE_KEY)).toContain("room-v2");
  });

  it("treats absent, malformed and old-shaped values as no session", () => {
    const storage = new MemoryStorage();
    expect(readV2Session(storage)).toBeNull();
    storage.setItem(V2_SESSION_STORAGE_KEY, "{bad json");
    expect(readV2Session(storage)).toBeNull();
    storage.setItem(V2_SESSION_STORAGE_KEY, JSON.stringify({ roomId: "room", resumeToken: "x" }));
    expect(readV2Session(storage)).toBeNull();
  });
});

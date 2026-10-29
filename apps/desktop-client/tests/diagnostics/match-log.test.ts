import { describe, expect, it } from "vitest";
import {
  appendMatchLog,
  MATCH_LOG_KEEP,
  readMatchLog,
  readMatchLogHistory,
  readActiveMatchRoom
} from "../../src/diagnostics/match-log";
import { MemoryStorage } from "./fixtures";

describe("local match logs", () => {
  it("keeps only the five most recently updated rooms", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < MATCH_LOG_KEEP + 2; index += 1) {
      appendMatchLog(storage, { roomId: `room-${index}`, matchId: `match-${index}`,
        viewerPlayerId: "player-1", kind: "status", payload: { index } });
    }
    expect(readMatchLogHistory(storage)).toEqual([
      "room-2", "room-3", "room-4", "room-5", "room-6"
    ]);
    expect(readMatchLog(storage, "room-0")).toBeNull();
    expect(readMatchLog(storage, "room-1")).toBeNull();
    expect(readMatchLog(storage, "room-6")?.entries).toHaveLength(1);
  });

  it("stores projection summaries, visible-shaped entries, and redacts credentials", () => {
    const storage = new MemoryStorage();
    appendMatchLog(storage, {
      roomId: "room-a", matchId: "match-a", viewerPlayerId: "player-1",
      kind: "projection", stateVersion: 12, eventSeq: 7,
      payload: { stateVersion: 12, eventSeq: 7, phase: "main", turnNumber: 3,
        activePlayerId: "player-1", pendingChoice: { status: "none" },
        resumeToken: "must-not-persist" }
    });
    const log = readMatchLog(storage, "room-a");
    expect(log).toMatchObject({ roomId: "room-a", matchId: "match-a", protocol: "v2",
      viewerPlayerId: "player-1", entries: [{ stateVersion: 12, eventSeq: 7,
        payload: { phase: "main", turnNumber: 3, resumeToken: "[redacted]" } }] });
    expect(JSON.stringify(log)).not.toContain("must-not-persist");
    expect(readActiveMatchRoom(storage)).toBe("room-a");
  });

  it("evicts the oldest match entries to keep one room below 1 MiB", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 17; index += 1) {
      appendMatchLog(storage, { roomId: "large-room", kind: "event", eventSeq: index + 1,
        payload: { index, chunks: Array.from({ length: 10 }, () => "z".repeat(6_300)) } });
    }
    const log = readMatchLog(storage, "large-room");
    expect(log).not.toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(log)).byteLength).toBeLessThanOrEqual(1024 * 1024);
    expect(log!.entries.at(-1)?.eventSeq).toBe(17);
    expect(log!.entries.length).toBeLessThan(17);
  });
});

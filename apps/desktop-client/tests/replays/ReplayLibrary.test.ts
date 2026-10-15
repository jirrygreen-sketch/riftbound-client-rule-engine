import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isDuelProjectionTransport,
  type DuelProjection,
  type DuelProjectionTransport
} from "@riftbound/protocol";
import {
  MAX_RECORDING_FRAMES,
  MAX_REPLAY_RECORDINGS,
  REPLAY_LIBRARY_SCHEMA_VERSION,
  REPLAY_LIBRARY_STORAGE_KEY,
  emptyReplayLibrary,
  findReplayRecording,
  frameViewerPlayerId,
  framesShareViewer,
  normalizeReplayRecording,
  readReplayLibrary,
  removeReplayRecording,
  saveReplayRecording,
  serializeReplayLibrary,
  summarizeReplayFrame,
  writeReplayLibrary,
  type ReplayLibrary,
  type ReplayRecording,
  type StorageLike
} from "../../src/replays/replay-library";

/*
 * Every frame used here is a *tracked* protocol fixture, cloned in-test and
 * asserted against the production `isDuelProjectionTransport` guard. These are
 * real wire-shape samples, not bespoke unknown objects, and a guard pass remains
 * structural only: it is never engine/actor/window authority.
 */
const v1Fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../packages/protocol/test/fixtures/duel-projections.json", import.meta.url
)), "utf8")) as Record<string, Record<string, DuelProjection>>;
const v2Fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../packages/protocol/test/fixtures/duel-v2-projection.json", import.meta.url
)), "utf8")) as Record<string, Record<string, DuelProjectionTransport>>;

function v1Frame(scenario: string, viewer: "p1" | "p2" | null = "p1"): DuelProjectionTransport {
  const source = v1Fixtures[scenario]?.[viewer === null ? "null" : viewer];
  if (!source) throw Error(`missing v1 fixture ${scenario}/${viewer}`);
  const clone = structuredClone(source);
  expect(isDuelProjectionTransport(clone)).toBe(true);
  return clone;
}

function v2Frame(scenario: string, viewer: "p1" | "p2" | null = "p1"): DuelProjectionTransport {
  const source = v2Fixtures[scenario]?.[viewer === null ? "null" : viewer];
  if (!source) throw Error(`missing v2 fixture ${scenario}/${viewer}`);
  const clone = structuredClone(source);
  expect(isDuelProjectionTransport(clone)).toBe(true);
  return clone;
}

function recording(overrides: Partial<ReplayRecording> = {}): ReplayRecording {
  return {
    id: "rec-1",
    roomId: "room-1",
    title: "测试对局",
    savedAt: "2026-10-13T00:00:00.000Z",
    frames: [v1Frame("playing", "p1"), v1Frame("changed", "p1")],
    ...overrides
  };
}

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  failNextWrite = false;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failNextWrite) throw new Error("quota");
    this.map.set(key, value);
  }
  raw(key: string): string | null {
    return this.map.get(key) ?? null;
  }
}

describe("replay library storage key and schema", () => {
  it("uses its own key, independent from decks and UI preferences", () => {
    expect(REPLAY_LIBRARY_STORAGE_KEY).toBe("riftbound.desktop-client.replay-library.v1");
    expect(REPLAY_LIBRARY_STORAGE_KEY).not.toContain("deck");
    expect(REPLAY_LIBRARY_STORAGE_KEY).not.toContain("ui-preferences");
    expect(REPLAY_LIBRARY_SCHEMA_VERSION).toBe(1);
  });

  it("an empty or missing storage reads as an empty library", () => {
    expect(readReplayLibrary(null)).toEqual(emptyReplayLibrary());
    expect(readReplayLibrary(new MemoryStorage())).toEqual({ recordings: [] });
  });
});

describe("replay library serialization round-trip", () => {
  it("round-trips real frames byte-for-byte through storage", () => {
    const storage = new MemoryStorage();
    const library = saveReplayRecording(emptyReplayLibrary(), recording());
    expect(writeReplayLibrary(storage, library)).toBe(true);

    const raw = storage.raw(REPLAY_LIBRARY_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}");
    expect(parsed.schemaVersion).toBe(REPLAY_LIBRARY_SCHEMA_VERSION);
    expect(parsed.recordings).toHaveLength(1);

    const restored = readReplayLibrary(storage);
    expect(restored).toEqual(library);
    expect(restored.recordings[0]?.frames[0]).toEqual(v1Frame("playing", "p1"));
  });

  it("serializes the exact declared fields and no hidden extras", () => {
    const library: ReplayLibrary = { recordings: [recording()] };
    const parsed = JSON.parse(serializeReplayLibrary(library));
    expect(Object.keys(parsed).sort()).toEqual(["recordings", "schemaVersion"]);
    const entry = parsed.recordings[0];
    expect(Object.keys(entry).sort()).toEqual(["frames", "id", "roomId", "savedAt", "title"]);
    // No hidden/private keys leaked into the persisted frame record.
    const entryKeys = Object.keys(entry);
    expect(entryKeys).not.toContain("viewerToken");
    expect(entryKeys).not.toContain("session");
    expect(entryKeys).not.toContain("hidden");
  });
});

describe("replay library read validation", () => {
  it("rejects JSON that is not a schema-1 library", () => {
    const storage = new MemoryStorage();
    storage.setItem(REPLAY_LIBRARY_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, recordings: [] }));
    expect(readReplayLibrary(storage)).toEqual(emptyReplayLibrary());

    storage.setItem(REPLAY_LIBRARY_STORAGE_KEY, JSON.stringify({ recordings: [] }));
    expect(readReplayLibrary(storage)).toEqual(emptyReplayLibrary());

    storage.setItem(REPLAY_LIBRARY_STORAGE_KEY, "{not json");
    expect(readReplayLibrary(storage)).toEqual(emptyReplayLibrary());
  });

  it("drops a recording whose frames are not real transport frames", () => {
    const storage = new MemoryStorage();
    storage.setItem(REPLAY_LIBRARY_STORAGE_KEY, JSON.stringify({
      schemaVersion: REPLAY_LIBRARY_SCHEMA_VERSION,
      recordings: [{
        id: "rec-bad",
        roomId: "room-1",
        title: "伪造",
        savedAt: "2026-10-13T00:00:00.000Z",
        frames: [{ projectionSchema: "riftbound-duel-v1", viewerPlayerId: "p1", match: {}, actions: [] }]
      }]
    }));
    expect(readReplayLibrary(storage)).toEqual(emptyReplayLibrary());
  });

  it("never silently accepts an unknown added field inside a frame", () => {
    const tampered = structuredClone(v1Frame("playing", "p1")) as unknown as Record<string, unknown>;
    (tampered as { extraField?: string }).extraField = "injected";
    expect(isDuelProjectionTransport(tampered)).toBe(false);

    const storage = new MemoryStorage();
    storage.setItem(REPLAY_LIBRARY_STORAGE_KEY, JSON.stringify({
      schemaVersion: REPLAY_LIBRARY_SCHEMA_VERSION,
      recordings: [{
        id: "rec-extra",
        roomId: "room-1",
        title: "注入字段",
        savedAt: "2026-10-13T00:00:00.000Z",
        frames: [tampered]
      }]
    }));
    expect(readReplayLibrary(storage)).toEqual(emptyReplayLibrary());
  });

  it("drops an empty frame sequence rather than inventing a placeholder", () => {
    expect(normalizeReplayRecording({ ...recording(), frames: [] })).toBeNull();
  });
});

describe("replay library write refusal", () => {
  it("returns false and does not throw when storage writes fail", () => {
    const storage = new MemoryStorage();
    storage.failNextWrite = true;
    expect(writeReplayLibrary(storage, { recordings: [recording()] })).toBe(false);
    expect(writeReplayLibrary(null, { recordings: [recording()] })).toBe(false);
  });
});

describe("replay library caps", () => {
  it("keeps at most MAX_REPLAY_RECORDINGS entries, newest first", () => {
    let library = emptyReplayLibrary();
    for (let i = 0; i < MAX_REPLAY_RECORDINGS + 3; i += 1) {
      library = saveReplayRecording(library, recording({ id: `rec-${i}` }));
    }
    expect(library.recordings).toHaveLength(MAX_REPLAY_RECORDINGS);
    expect(library.recordings[0]?.id).toBe(`rec-${MAX_REPLAY_RECORDINGS + 2}`);
    expect(library.recordings.map(entry => entry.id)).not.toContain("rec-0");
  });

  it("refuses a recording over MAX_RECORDING_FRAMES instead of truncating it", () => {
    const frames: DuelProjectionTransport[] = [];
    for (let i = 0; i < MAX_RECORDING_FRAMES + 1; i += 1) frames.push(v1Frame("playing", "p1"));
    const oversize = recording({ id: "rec-big", frames });
    const library = saveReplayRecording(emptyReplayLibrary(), oversize);
    expect(library.recordings).toHaveLength(0);

    const storage = new MemoryStorage();
    storage.setItem(REPLAY_LIBRARY_STORAGE_KEY, JSON.stringify({
      schemaVersion: REPLAY_LIBRARY_SCHEMA_VERSION,
      recordings: [oversize]
    }));
    expect(readReplayLibrary(storage)).toEqual(emptyReplayLibrary());
  });

  it("accepts exactly MAX_RECORDING_FRAMES", () => {
    const frames: DuelProjectionTransport[] = [];
    for (let i = 0; i < MAX_RECORDING_FRAMES; i += 1) frames.push(v1Frame("playing", "p1"));
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-max", frames }));
    expect(library.recordings[0]?.frames).toHaveLength(MAX_RECORDING_FRAMES);
  });
});

describe("replay library viewer integrity", () => {
  it("reports the recording viewer from real frames", () => {
    expect(frameViewerPlayerId(v1Frame("playing", "p1"))).toBe("p1");
    expect(frameViewerPlayerId(v1Frame("playing", null))).toBeNull();
  });

  it("refuses a sequence that mixes viewers", () => {
    const mixed = [v1Frame("playing", "p1"), v1Frame("playing", "p2")];
    expect(framesShareViewer(mixed)).toBe(false);
    expect(normalizeReplayRecording(recording({ id: "rec-mixed", frames: mixed }))).toBeNull();
    expect(saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-mixed", frames: mixed })).recordings)
      .toHaveLength(0);
  });

  it("accepts a uniform spectator (null viewer) sequence", () => {
    const frames = [v1Frame("playing", null), v1Frame("changed", null)];
    expect(framesShareViewer(frames)).toBe(true);
    expect(normalizeReplayRecording(recording({ id: "rec-null", frames }))).not.toBeNull();
  });

  it("never trusts an arbitrary viewer swap: a v2 frame cannot be relabelled to p1", () => {
    const v2 = v2Frame("playing", "p2");
    expect(v2.viewerPlayerId).toBe("p2");
    const relabelled = structuredClone(v2) as unknown as Record<string, unknown>;
    relabelled.viewerPlayerId = "p1";
    // Swapping the viewer breaks the projection's own guard: hidden zones no longer
    // match the claimed viewer, so the frame fails closed.
    expect(isDuelProjectionTransport(relabelled)).toBe(false);
  });
});

describe("replay library mutation helpers", () => {
  it("saves, finds and removes by id", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1" }));
    expect(findReplayRecording(library, "rec-1")?.id).toBe("rec-1");
    expect(findReplayRecording(library, null)).toBeNull();
    const removed = removeReplayRecording(library, "rec-1");
    expect(removed.recordings).toHaveLength(0);
    expect(removeReplayRecording(removed, "rec-missing").recordings).toHaveLength(0);
  });

  it("replaces an existing id instead of duplicating it", () => {
    const first = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1", title: "旧" }));
    const second = saveReplayRecording(first, recording({ id: "rec-1", title: "新" }));
    expect(second.recordings).toHaveLength(1);
    expect(second.recordings[0]?.title).toBe("新");
  });
});

describe("replay frame summaries", () => {
  it("reads the playing frame straight off the wire, inventing nothing", () => {
    const rec = recording({ frames: [v1Frame("playing", "p1")] });
    const summary = summarizeReplayFrame(rec, 0);
    expect(summary).not.toBeNull();
    expect(summary?.schema).toBe("riftbound-duel-v1");
    expect(summary?.viewerPlayerId).toBe("p1");
    expect(summary?.stage).toBe("playing");
    expect(summary?.phase).toBe("awaiting-turn-start");
    expect(summary?.turnNumber).toBe(1);
    expect(summary?.turnPlayerId).toBe("p1");
    expect(summary?.priorityPlayerId).toBeNull();
    expect(summary?.actionCount).toBe(0);
    expect(summary?.enabledActionCount).toBe(0);
  });

  it("reports null frame fields for a setup frame with no phase", () => {
    const rec = recording({ frames: [v1Frame("setup", "p1")] });
    const summary = summarizeReplayFrame(rec, 0);
    expect(summary?.stage).toBe("setup");
    expect(summary?.phase).toBeNull();
    expect(summary?.turnNumber).toBeNull();
  });

  it("returns null for an out-of-range index", () => {
    const rec = recording({ frames: [v1Frame("playing", "p1")] });
    expect(summarizeReplayFrame(rec, 3)).toBeNull();
    expect(summarizeReplayFrame(rec, -1)).toBeNull();
  });
});

describe('parent integrated replay identity and write boundary', () => {
  it('refuses mixed matches and reversed authoritative clocks', () => {
    const source = recording();
    const changedMatch = structuredClone(source.frames[1]!);
    changedMatch.match.matchId = 'a-different-match';
    expect(normalizeReplayRecording({...source, frames:[source.frames[0]!,changedMatch]})).toBeNull();
    const last = structuredClone(source.frames[1]!);
    const previous = structuredClone(source.frames[0]!);
    last.match.stateVersion = previous.match.stateVersion + 1;
    last.match.eventSeq = previous.match.eventSeq + 1;
    expect(normalizeReplayRecording({...source,frames:[last,previous]})).toBeNull();
  });
  it('never stores a malformed or oversize frame sequence', () => {
    const storage = new MemoryStorage();
    const frame = recording().frames[0]!;
    expect(writeReplayLibrary(storage,{recordings:[recording({frames:Array.from({length:301},()=>frame)})]})).toBe(false);
    expect(storage.raw(REPLAY_LIBRARY_STORAGE_KEY)).toBeNull();
    expect(writeReplayLibrary(storage,{recordings:[recording({frames:[{...frame,unexpected:'private'} as unknown as DuelProjectionTransport]})]})).toBe(false);
    expect(storage.raw(REPLAY_LIBRARY_STORAGE_KEY)).toBeNull();
  });
});

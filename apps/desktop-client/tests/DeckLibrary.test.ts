import { describe, expect, it } from "vitest";
import {
  DECK_LIBRARY_SCHEMA_VERSION,
  DECK_LIBRARY_STORAGE_KEY,
  cloneDeckByZone,
  deckFingerprint,
  deckTotalCount,
  deckZoneCounts,
  emptyDeckLibrary,
  findNamedDeck,
  readDeckLibrary,
  removeNamedDeck,
  saveNamedDeck,
  updateNamedDeck,
  writeDeckLibrary,
  type DeckLibrary
} from "../src/decks/library";
import { emptyDeckByZone } from "../src/hooks/useCardCatalog";

const DRAFT = {
  ...emptyDeckByZone(),
  mainDeck: { "flame-warden-standard": 3, "flame-warden-alt": 2 },
  runes: { "basic-rune-standard": 12 },
  legend: { "ancient-legend-holo": 1 },
  champion: { "flame-champion-standard": 1 },
  battlefields: { "hall-of-fire-standard": 1 },
  sideboard: { "flame-warden-alt": 1 }
};

describe("deck library storage key", () => {
  it("uses its own key, independent from the prototype and the single working draft", () => {
    expect(DECK_LIBRARY_STORAGE_KEY).toBe("riftbound.desktop-client.deck-library.v1");
    expect(DECK_LIBRARY_STORAGE_KEY).not.toBe("riftbound.desktop-client.deck");
    expect(DECK_LIBRARY_STORAGE_KEY).not.toContain("prototype");
  });

  it("round-trips a named deck and preserves printing ids exactly", () => {
    const storage = new MemoryStorage();
    const saved = saveNamedDeck(emptyDeckLibrary(), { name: "  阿狸 rush  " , deck: DRAFT }, {
      id: "deck-1",
      now: "2026-10-12T00:00:00.000Z"
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(writeDeckLibrary(storage, saved.library)).toEqual({ ok: true });

    const raw = storage.getItem(DECK_LIBRARY_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}");
    expect(parsed.schemaVersion).toBe(DECK_LIBRARY_SCHEMA_VERSION);
    expect(Object.keys(parsed.decks[0])).toEqual(["id", "name", "updatedAt", "deck"]);
    expect(parsed.decks[0].deck).toEqual(DRAFT);
    // Only the printing id and a count are stored; nothing invents a canonical
    // or printing id field.
    expect(Object.keys(parsed.decks[0].deck.mainDeck)).toEqual([
      "flame-warden-standard",
      "flame-warden-alt"
    ]);
    expect(parsed.decks[0].deck.legend).toEqual({ "ancient-legend-holo": 1 });

    const reloaded = readDeckLibrary(storage);
    expect(reloaded.decks).toHaveLength(1);
    expect(reloaded.decks[0]).toMatchObject({
      id: "deck-1",
      name: "阿狸 rush",
      updatedAt: "2026-10-12T00:00:00.000Z"
    });
    expect(reloaded.decks[0]?.deck).toEqual(DRAFT);
  });

  it("deep-clones on read and write instead of aliasing caller objects", () => {
    const storage = new MemoryStorage();
    const saved = saveNamedDeck(emptyDeckLibrary(), { name: "clone", deck: DRAFT }, { id: "deck-1" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    // Mutating the source draft after saving must not change the stored deck.
    const mutableSource = cloneDeckByZone(DRAFT);
    const entry = saveNamedDeck(saved.library, { name: "clone-2", deck: mutableSource }, { id: "deck-2" });
    expect(entry.ok).toBe(true);
    if (!entry.ok) return;
    const mutableMain = mutableSource.mainDeck as Record<string, number>;
    mutableMain["mutated-card"] = 9;
    delete mutableMain["flame-warden-standard"];
    expect(entry.entry.deck.mainDeck).toEqual(DRAFT.mainDeck);

    // Two reads must not share nested objects.
    writeDeckLibrary(storage, entry.library);
    const first = readDeckLibrary(storage);
    const second = readDeckLibrary(storage);
    expect(first).not.toBe(second);
    expect(first.decks[0]?.deck).not.toBe(second.decks[0]?.deck);
    expect(first.decks[0]?.deck.mainDeck).toEqual(DRAFT.mainDeck);
  });

  it("tolerates malformed JSON, unknown schema versions, and invalid entries", () => {
    const storage = new MemoryStorage();
    storage.setItem(DECK_LIBRARY_STORAGE_KEY, "{broken");
    expect(readDeckLibrary(storage)).toEqual(emptyDeckLibrary());

    storage.setItem(DECK_LIBRARY_STORAGE_KEY, JSON.stringify({ schemaVersion: 99, decks: [] }));
    expect(readDeckLibrary(storage)).toEqual(emptyDeckLibrary());

    storage.setItem(DECK_LIBRARY_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, decks: "nope" }));
    expect(readDeckLibrary(storage)).toEqual(emptyDeckLibrary());

    storage.setItem(DECK_LIBRARY_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      decks: [
        { id: "keep", name: "Keep", updatedAt: "x", deck: { mainDeck: { a: 2 } } },
        { id: "", name: "No id", updatedAt: "x", deck: {} },
        { id: "no-name", name: "", updatedAt: "x", deck: {} },
        { id: "keep", name: "Duplicate id", updatedAt: "x", deck: {} },
        null,
        { id: "no-date", name: "No date", deck: {} }
      ]
    }));
    const recovered = readDeckLibrary(storage);
    expect(recovered.decks.map(entry => entry.id)).toEqual(["keep"]);
    expect(recovered.decks[0]?.deck.mainDeck).toEqual({ a: 2 });
  });

  it("drops quantities that are not non-negative safe integers", () => {
    const storage = new MemoryStorage();
    storage.setItem(DECK_LIBRARY_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      decks: [{
        id: "deck-1",
        name: "Quantities",
        updatedAt: "x",
        deck: {
          mainDeck: { ok: 2, zero: 0, negative: -3, fraction: 1.5, huge: Number.MAX_SAFE_INTEGER + 2 },
          runes: { text: "12" }
        }
      }]
    }));

    const library = readDeckLibrary(storage);
    expect(library.decks[0]?.deck.mainDeck).toEqual({ ok: 2 });
    expect(library.decks[0]?.deck.runes).toEqual({});
  });

  it("reports unusable storage instead of throwing, keeping the in-memory library", () => {
    expect(readDeckLibrary(null)).toEqual(emptyDeckLibrary());

    const failed = writeDeckLibrary(null, emptyDeckLibrary());
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.message).toContain("本次运行");

    const quota = writeDeckLibrary(new ThrowingStorage(), emptyDeckLibrary());
    expect(quota.ok).toBe(false);
    if (!quota.ok) expect(quota.message).toContain("本地存储写入失败");
  });

  it("rejects blank names and keeps the library unchanged", () => {
    const library = emptyDeckLibrary();
    const result = saveNamedDeck(library, { name: "   ", deck: DRAFT });
    expect(result).toEqual({ ok: false, reason: "请输入卡组名称。" });
    expect(library.decks).toHaveLength(0);
  });

  it("renames and overwrites a selected deck without touching other entries", () => {
    const first = saveNamedDeck(emptyDeckLibrary(), { name: "A", deck: DRAFT }, { id: "a" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = saveNamedDeck(first.library, { name: "B", deck: emptyDeckByZone() }, { id: "b" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const renamed = updateNamedDeck(
      second.library,
      "b",
      { name: "B renamed", deck: { ...emptyDeckByZone(), mainDeck: { "new-card": 4 } } },
      { now: "2026-10-12T12:00:00.000Z" }
    );
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;

    expect(renamed.library.decks.map(entry => entry.id)).toEqual(["a", "b"]);
    expect(findNamedDeck(renamed.library, "a")?.name).toBe("A");
    const updated = findNamedDeck(renamed.library, "b");
    expect(updated?.name).toBe("B renamed");
    expect(updated?.updatedAt).toBe("2026-10-12T12:00:00.000Z");
    expect(updated?.deck.mainDeck).toEqual({ "new-card": 4 });

    const missing = updateNamedDeck(renamed.library, "nope", { name: "x", deck: DRAFT });
    expect(missing).toEqual({ ok: false, reason: "所选卡组已不存在，请重新选择。" });

    const removed = removeNamedDeck(renamed.library, "b");
    expect(removed.decks.map(entry => entry.id)).toEqual(["a"]);
  });
});

describe("deck summarising", () => {
  it("counts every zone and produces a stable fingerprint", () => {
    expect(deckTotalCount(DRAFT)).toBe(21);
    expect(deckZoneCounts(DRAFT).map(entry => entry.zone)).toEqual([
      "mainDeck",
      "runes",
      "legend",
      "champion",
      "battlefields",
      "sideboard"
    ]);
    expect(deckZoneCounts(DRAFT).find(entry => entry.zone === "runes")?.count).toBe(12);

    const reordered: DeckLibrary = {
      schemaVersion: 1,
      decks: [{
        id: "x",
        name: "reordered",
        updatedAt: "x",
        deck: {
          ...emptyDeckByZone(),
          mainDeck: { "flame-warden-alt": 2, "flame-warden-standard": 3 },
          runes: { "basic-rune-standard": 12 },
          legend: { "ancient-legend-holo": 1 },
          champion: { "flame-champion-standard": 1 },
          battlefields: { "hall-of-fire-standard": 1 },
          sideboard: { "flame-warden-alt": 1 }
        }
      }]
    };
    expect(deckFingerprint(reordered.decks[0]!.deck)).toBe(deckFingerprint(DRAFT));

    const changed = { ...DRAFT, mainDeck: { "flame-warden-standard": 2 } };
    expect(deckFingerprint(changed)).not.toBe(deckFingerprint(DRAFT));
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage {
  getItem(): string | null {
    return null;
  }

  setItem(): void {
    throw new Error("QuotaExceededError");
  }
}

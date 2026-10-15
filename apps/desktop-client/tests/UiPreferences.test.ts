import { describe, expect, it } from "vitest";
import {
  DECK_LIBRARY_STORAGE_KEY,
  deckFingerprint,
  emptyDeckLibrary,
  saveNamedDeck,
  type DeckLibrary
} from "../src/decks/library";
import {
  UI_PREFERENCES_SCHEMA_VERSION,
  UI_PREFERENCES_STORAGE_KEY,
  clearAppliedDeckSelection,
  emptyUiPreferences,
  readUiPreferences,
  resolveCatalogServerUrl,
  resolveSelectedDeckId,
  serializeUiPreferences,
  writeAppliedDeckSelection,
  writeCatalogServerUrl
} from "../src/decks/ui-preferences";
import { emptyDeckByZone } from "../src/hooks/useCardCatalog";
import { DEFAULT_CARD_SERVER_URL } from "../src/net/CardCatalogClient";

const DECK_A = {
  ...emptyDeckByZone(),
  mainDeck: { "flame-warden-standard": 3, "flame-warden-alt": 2 },
  runes: { "basic-rune-standard": 12 },
  legend: { "ancient-legend-holo": 1 }
};

const DECK_B_OTHER = {
  ...emptyDeckByZone(),
  mainDeck: { "tide-caller-standard": 4 }
};

const CATALOG_8793 = "http://127.0.0.1:8793";

function libraryWith(...entries: { id: string; name: string; deck: typeof DECK_A }[]): DeckLibrary {
  let library = emptyDeckLibrary();
  for (const entry of entries) {
    const saved = saveNamedDeck(library, { name: entry.name, deck: entry.deck }, { id: entry.id });
    if (!saved.ok) throw new Error(saved.reason);
    library = saved.library;
  }
  return library;
}

function preferencesWithAppliedDeck(storage: MemoryStorage, deckId: string, deck: typeof DECK_A) {
  writeAppliedDeckSelection(storage, deckId, deckFingerprint(deck));
  return readUiPreferences(storage);
}

describe("ui preferences storage key", () => {
  it("uses its own key, independent of the working draft and the named library", () => {
    expect(UI_PREFERENCES_STORAGE_KEY).toBe("riftbound.desktop-client.ui-preferences.v1");
    expect(UI_PREFERENCES_STORAGE_KEY).not.toBe("riftbound.desktop-client.deck");
    expect(UI_PREFERENCES_STORAGE_KEY).not.toBe(DECK_LIBRARY_STORAGE_KEY);
  });

  it("stores only local preferences and never a server proof", () => {
    const storage = new MemoryStorage();
    writeCatalogServerUrl(storage, CATALOG_8793);
    writeAppliedDeckSelection(storage, "deck-a", "draft-fingerprint");

    const parsed = JSON.parse(storage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "{}");
    expect(Object.keys(parsed).sort()).toEqual([
      "catalogServerUrl",
      "schemaVersion",
      "selectedDeckFingerprint",
      "selectedDeckId"
    ]);
    expect(parsed.schemaVersion).toBe(UI_PREFERENCES_SCHEMA_VERSION);
    // No session/credentials copy and no server-owned confirmation state.
    const raw = storage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("resumeToken");
    expect(raw).not.toContain("session");
    expect(raw).not.toContain("confirmedFingerprint");
    expect(raw).not.toContain("ready");
  });
});

describe("catalog server address reload", () => {
  it("restores the last user-set HTTP base and otherwise uses the default", () => {
    const storage = new MemoryStorage();
    expect(writeCatalogServerUrl(storage, CATALOG_8793)).toBe(true);

    // A fresh read stands in for a full page reload.
    const reloaded = readUiPreferences(storage);
    expect(resolveCatalogServerUrl(reloaded, DEFAULT_CARD_SERVER_URL)).toBe(CATALOG_8793);

    expect(resolveCatalogServerUrl(emptyUiPreferences(), DEFAULT_CARD_SERVER_URL))
      .toBe(DEFAULT_CARD_SERVER_URL);
  });

  it("normalises a bare host:port to an HTTP base URL", () => {
    const storage = new MemoryStorage();
    expect(writeCatalogServerUrl(storage, "127.0.0.1:8793")).toBe(true);
    expect(readUiPreferences(storage).catalogServerUrl).toBe(CATALOG_8793);
  });

  it("rejects non-HTTP(S) input and leaves the stored address untouched", () => {
    const storage = new MemoryStorage();
    writeCatalogServerUrl(storage, CATALOG_8793);
    const before = storage.getItem(UI_PREFERENCES_STORAGE_KEY);

    expect(writeCatalogServerUrl(storage, "ws://127.0.0.1:8793/ws")).toBe(false);
    expect(writeCatalogServerUrl(storage, "ftp://files.example.com")).toBe(false);
    expect(storage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBe(before);
    expect(readUiPreferences(storage).catalogServerUrl).toBe(CATALOG_8793);
  });
});

describe("named deck selection reload", () => {
  it("restores the applied named deck when its content still equals the draft", () => {
    const storage = new MemoryStorage();
    const library = libraryWith({ id: "deck-a", name: "阿狸 rush", deck: DECK_A });
    const preferences = preferencesWithAppliedDeck(storage, "deck-a", DECK_A);

    const reloaded = readUiPreferences(storage);
    expect(resolveSelectedDeckId({
      preferences: reloaded,
      library,
      restoredDeck: DECK_A
    })).toBe("deck-a");
    // The displayed name always comes from the live library entry.
    expect(library.decks.find(entry => entry.id === "deck-a")?.name).toBe("阿狸 rush");
  });

  it("falls back to the plain draft when the draft was edited before reload", () => {
    const storage = new MemoryStorage();
    const library = libraryWith({ id: "deck-a", name: "A", deck: DECK_A });
    const preferences = preferencesWithAppliedDeck(storage, "deck-a", DECK_A);

    const editedDraft = { ...DECK_A, mainDeck: { "flame-warden-standard": 1 } };
    expect(resolveSelectedDeckId({
      preferences,
      library,
      restoredDeck: editedDraft
    })).toBeNull();
  });

  it("does not label a saved id whose content changed later", () => {
    const storage = new MemoryStorage();
    // The user applied deck-a when it held DECK_A...
    const preferences = preferencesWithAppliedDeck(storage, "deck-a", DECK_A);
    // ...but deck-a now holds different contents while the draft was reverted
    // back to the original fingerprint (so the stored fingerprint still matches).
    const library = libraryWith({ id: "deck-a", name: "A", deck: DECK_B_OTHER });
    expect(resolveSelectedDeckId({
      preferences,
      library,
      restoredDeck: DECK_A
    })).toBeNull();
  });

  it("does not restore a deck id that is no longer in the library", () => {
    const storage = new MemoryStorage();
    const preferences = preferencesWithAppliedDeck(storage, "deck-a", DECK_A);
    const library = libraryWith({ id: "deck-b", name: "B", deck: DECK_A });

    expect(resolveSelectedDeckId({
      preferences,
      library,
      restoredDeck: DECK_A
    })).toBeNull();
  });

  it("never treats an unapplied or half-written selection as selected", () => {
    const storage = new MemoryStorage();
    const library = libraryWith({ id: "deck-a", name: "A", deck: DECK_A });

    // Nothing applied yet: a matching library deck alone is not enough.
    expect(resolveSelectedDeckId({
      preferences: emptyUiPreferences(),
      library,
      restoredDeck: DECK_A
    })).toBeNull();

    // A lone id without its captured fingerprint is ignored.
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify({
      schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
      catalogServerUrl: null,
      selectedDeckId: "deck-a",
      selectedDeckFingerprint: null
    }));
    expect(resolveSelectedDeckId({
      preferences: readUiPreferences(storage),
      library,
      restoredDeck: DECK_A
    })).toBeNull();
  });

  it("clears the selection but keeps the catalog address", () => {
    const storage = new MemoryStorage();
    writeCatalogServerUrl(storage, CATALOG_8793);
    writeAppliedDeckSelection(storage, "deck-a", deckFingerprint(DECK_A));

    expect(clearAppliedDeckSelection(storage)).toBe(true);
    const reloaded = readUiPreferences(storage);
    expect(reloaded.selectedDeckId).toBeNull();
    expect(reloaded.selectedDeckFingerprint).toBeNull();
    expect(resolveCatalogServerUrl(reloaded, DEFAULT_CARD_SERVER_URL)).toBe(CATALOG_8793);
  });
});

describe("tolerant, non-throwing storage", () => {
  it("degrades malformed or unknown payloads to empty preferences", () => {
    const storage = new MemoryStorage();
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, "{broken");
    expect(readUiPreferences(storage)).toEqual(emptyUiPreferences());

    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify({
      schemaVersion: 99,
      catalogServerUrl: CATALOG_8793,
      selectedDeckId: "deck-a",
      selectedDeckFingerprint: "fp"
    }));
    expect(readUiPreferences(storage)).toEqual(emptyUiPreferences());

    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      catalogServerUrl: "not a url",
      selectedDeckId: 42,
      selectedDeckFingerprint: ""
    }));
    expect(readUiPreferences(storage)).toEqual(emptyUiPreferences());
  });

  it("ignores injected server-owned fields instead of surfacing them", () => {
    const storage = new MemoryStorage();
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      catalogServerUrl: null,
      selectedDeckId: "deck-a",
      selectedDeckFingerprint: "fp",
      confirmedFingerprint: "server-proof",
      submissionPending: true,
      ready: true
    }));
    const preferences = readUiPreferences(storage);
    expect(Object.keys(preferences).sort()).toEqual([
      "catalogServerUrl",
      "selectedDeckFingerprint",
      "selectedDeckId"
    ]);
    expect((preferences as Record<string, unknown>)["confirmedFingerprint"]).toBeUndefined();
    expect(serializeUiPreferences(preferences)).not.toContain("server-proof");
  });

  it("reports an unusable or throwing storage without throwing", () => {
    expect(readUiPreferences(null)).toEqual(emptyUiPreferences());
    expect(writeCatalogServerUrl(null, CATALOG_8793)).toBe(false);
    expect(writeAppliedDeckSelection(null, "deck-a", "fp")).toBe(false);
    expect(clearAppliedDeckSelection(null)).toBe(false);

    const throwing = new ThrowingStorage();
    expect(writeCatalogServerUrl(throwing, CATALOG_8793)).toBe(false);
    expect(writeAppliedDeckSelection(throwing, "deck-a", "fp")).toBe(false);
    expect(readUiPreferences(throwing)).toEqual(emptyUiPreferences());
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

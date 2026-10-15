import { describe, expect, it } from "vitest";
import {
  CARD_SCALE_OPTIONS,
  DEFAULT_DISPLAY_SETTINGS,
  DISPLAY_SETTINGS_SCHEMA_VERSION,
  DISPLAY_SETTINGS_STORAGE_KEY,
  normalizeDisplaySettings,
  readDisplaySettings,
  writeDisplaySettings,
  type DisplaySettings,
  type StorageLike
} from "../../src/settings/display-settings";
import {
  UI_PREFERENCES_STORAGE_KEY
} from "../../src/decks/ui-preferences";

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.map.set(key, value);
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key) ?? null : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("read blocked");
  }
  setItem(): void {
    throw new Error("write blocked");
  }
}

const FULL: DisplaySettings = {
  cardScale: "large",
  reducedMotion: true,
  showCardNames: false,
  confirmConcede: false
};

describe("display settings defaults and shape", () => {
  it("exposes the exact agreed defaults", () => {
    expect(DEFAULT_DISPLAY_SETTINGS).toEqual({
      cardScale: "medium",
      reducedMotion: false,
      showCardNames: true,
      confirmConcede: true
    });
  });

  it("offers exactly the three card scale options small/medium/large", () => {
    expect(CARD_SCALE_OPTIONS.map(option => option.value)).toEqual(["small", "medium", "large"]);
  });

  it("uses its own key and schema version, separate from ui preferences", () => {
    expect(DISPLAY_SETTINGS_STORAGE_KEY).toBe("riftbound.desktop-client.display-settings.v1");
    expect(DISPLAY_SETTINGS_STORAGE_KEY).not.toBe(UI_PREFERENCES_STORAGE_KEY);
    expect(DISPLAY_SETTINGS_SCHEMA_VERSION).toBe(1);
  });
});

describe("readDisplaySettings", () => {
  it("returns defaults for a null storage", () => {
    expect(readDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("returns defaults when nothing is stored or the raw JSON is malformed", () => {
    expect(readDisplaySettings(new MemoryStorage())).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(
      readDisplaySettings(new MemoryStorage({ [DISPLAY_SETTINGS_STORAGE_KEY]: "{not json" }))
    ).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("ignores an unknown schema version", () => {
    const storage = new MemoryStorage({
      [DISPLAY_SETTINGS_STORAGE_KEY]: JSON.stringify({ schemaVersion: 2, cardScale: "large" })
    });
    expect(readDisplaySettings(storage)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("round-trips a full valid payload written by writeDisplaySettings", () => {
    const storage = new MemoryStorage();
    expect(writeDisplaySettings(storage, FULL)).toBe(true);
    expect(readDisplaySettings(storage)).toEqual(FULL);
  });

  it("repairs a partially invalid payload field-by-field", () => {
    const storage = new MemoryStorage({
      [DISPLAY_SETTINGS_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 1,
        cardScale: "gigantic",
        reducedMotion: "yes",
        showCardNames: false,
        confirmConcede: 0
      })
    });
    expect(readDisplaySettings(storage)).toEqual({
      cardScale: "medium",
      reducedMotion: false,
      showCardNames: false,
      confirmConcede: true
    });
  });

  it("never throws when storage reads throw", () => {
    expect(readDisplaySettings(new ThrowingStorage())).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });
});

describe("writeDisplaySettings", () => {
  it("returns false for a null storage", () => {
    expect(writeDisplaySettings(null, FULL)).toBe(false);
  });

  it("returns false instead of throwing when storage writes throw", () => {
    expect(writeDisplaySettings(new ThrowingStorage(), FULL)).toBe(false);
  });

  it("persists only the settings fields plus the schema version", () => {
    const storage = new MemoryStorage();
    writeDisplaySettings(storage, FULL);
    const raw = storage.getItem(DISPLAY_SETTINGS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ schemaVersion: 1, ...FULL });
  });

  it("does not touch the ui-preferences key", () => {
    const storage = new MemoryStorage({ [UI_PREFERENCES_STORAGE_KEY]: "keep-me" });
    writeDisplaySettings(storage, FULL);
    expect(storage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBe("keep-me");
  });
});

describe("normalizeDisplaySettings", () => {
  it("coerces non-objects to defaults", () => {
    expect(normalizeDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(normalizeDisplaySettings("small")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(normalizeDisplaySettings([1, 2, 3])).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("keeps valid fields and defaults invalid ones", () => {
    expect(
      normalizeDisplaySettings({ cardScale: "small", reducedMotion: true, showCardNames: "no" })
    ).toEqual({ cardScale: "small", reducedMotion: true, showCardNames: true, confirmConcede: true });
  });
});

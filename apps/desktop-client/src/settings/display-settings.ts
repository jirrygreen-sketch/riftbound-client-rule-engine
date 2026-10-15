/**
 * Local, machine-level display settings for the desktop client.
 *
 * These are purely presentational preferences for *this* machine: how large
 * cards render, whether motion is reduced, whether card names are shown, and
 * whether conceding needs an extra confirmation. Nothing here is game state,
 * server state, or a proof of anything the server owns.
 *
 * Storage contract: reads are tolerant (missing storage, malformed JSON, an
 * unknown schema version, or invalid fields degrade to
 * `DEFAULT_DISPLAY_SETTINGS` instead of throwing), and writes are best-effort
 * (they return `false` rather than throwing when storage is unusable). The key
 * is independent from the UI-preferences key, the working draft, and the named
 * deck library.
 */

export const DISPLAY_SETTINGS_STORAGE_KEY = "riftbound.desktop-client.display-settings.v1";
export const DISPLAY_SETTINGS_SCHEMA_VERSION = 1;

/** Minimal storage surface so this works with `window.localStorage` or a test double. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type CardScale = "small" | "medium" | "large";

export interface DisplaySettings {
  readonly cardScale: CardScale;
  readonly reducedMotion: boolean;
  readonly showCardNames: boolean;
  readonly confirmConcede: boolean;
}

/** The three card-size choices, in display order, with their Chinese labels. */
export const CARD_SCALE_OPTIONS: readonly { readonly value: CardScale; readonly label: string }[] = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" }
];

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  cardScale: "medium",
  reducedMotion: false,
  showCardNames: true,
  confirmConcede: true
};

interface StoredDisplaySettings extends DisplaySettings {
  readonly schemaVersion: typeof DISPLAY_SETTINGS_SCHEMA_VERSION;
}

const CARD_SCALES: readonly CardScale[] = ["small", "medium", "large"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCardScale(value: unknown): value is CardScale {
  return typeof value === "string" && (CARD_SCALES as readonly string[]).includes(value);
}

/**
 * Normalize an arbitrary value into a `DisplaySettings`. Every field falls back
 * to its default independently, so one bad field never discards the rest.
 */
export function normalizeDisplaySettings(value: unknown): DisplaySettings {
  if (!isRecord(value)) return DEFAULT_DISPLAY_SETTINGS;
  return {
    cardScale: isCardScale(value.cardScale) ? value.cardScale : DEFAULT_DISPLAY_SETTINGS.cardScale,
    reducedMotion:
      typeof value.reducedMotion === "boolean"
        ? value.reducedMotion
        : DEFAULT_DISPLAY_SETTINGS.reducedMotion,
    showCardNames:
      typeof value.showCardNames === "boolean"
        ? value.showCardNames
        : DEFAULT_DISPLAY_SETTINGS.showCardNames,
    confirmConcede:
      typeof value.confirmConcede === "boolean"
        ? value.confirmConcede
        : DEFAULT_DISPLAY_SETTINGS.confirmConcede
  };
}

export function readDisplaySettings(storage: StorageLike | null): DisplaySettings {
  if (!storage) return DEFAULT_DISPLAY_SETTINGS;
  let parsed: unknown;
  try {
    const raw = storage.getItem(DISPLAY_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_DISPLAY_SETTINGS;
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== DISPLAY_SETTINGS_SCHEMA_VERSION) {
    return DEFAULT_DISPLAY_SETTINGS;
  }
  return normalizeDisplaySettings(parsed);
}

/**
 * Persist `next` under the display-settings key. Returns `true` only when the
 * value was written; an unusable or throwing storage returns `false` and never
 * throws out of this module.
 */
export function writeDisplaySettings(storage: StorageLike | null, next: DisplaySettings): boolean {
  if (!storage) return false;
  const payload: StoredDisplaySettings = {
    schemaVersion: DISPLAY_SETTINGS_SCHEMA_VERSION,
    cardScale: next.cardScale,
    reducedMotion: next.reducedMotion,
    showCardNames: next.showCardNames,
    confirmConcede: next.confirmConcede
  };
  try {
    storage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

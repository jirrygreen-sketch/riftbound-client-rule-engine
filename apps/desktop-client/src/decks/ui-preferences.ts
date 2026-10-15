import { normalizeCardServerUrl } from "../net/CardCatalogClient";
import type { DeckByZone } from "../hooks/useCardCatalog";
import {
  deckFingerprint,
  findNamedDeck,
  type DeckLibrary
} from "./library";

/**
 * Local UI preferences that must survive a full page reload.
 *
 * Two purely local, machine-level settings live here:
 * - the catalog (HTTP) server base URL the user chose;
 * - the named-library deck id that was actually applied to the current draft,
 *   together with the draft fingerprint captured at apply time.
 *
 * This is not server state and it is deliberately not a proof of anything the
 * server owns: no `resumeToken`, no session/credentials copy, no
 * `confirmedFingerprint`, no ready/submission flag. A stored selection is only
 * ever trusted again when the live library still has that id *and* the id's
 * current content still equals the restored draft fingerprint.
 *
 * Storage contract: reads are tolerant (malformed JSON, unknown schema, invalid
 * fields degrade to empty instead of throwing) and writes are best-effort
 * (an unusable or throwing storage never throws out of this module). The key is
 * independent from the named-deck library key and from the working-draft key.
 */
export const UI_PREFERENCES_STORAGE_KEY = "riftbound.desktop-client.ui-preferences.v1";
export const UI_PREFERENCES_SCHEMA_VERSION = 1;

/** Minimal storage surface so this works with `window.localStorage` or a test double. */
export interface UiPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface UiPreferences {
  readonly catalogServerUrl: string | null;
  readonly selectedDeckId: string | null;
  readonly selectedDeckFingerprint: string | null;
}

export interface StoredUiPreferences extends UiPreferences {
  readonly schemaVersion: typeof UI_PREFERENCES_SCHEMA_VERSION;
}

export function emptyUiPreferences(): UiPreferences {
  return {
    catalogServerUrl: null,
    selectedDeckId: null,
    selectedDeckFingerprint: null
  };
}

export function readUiPreferences(storage: UiPreferencesStorage | null): UiPreferences {
  if (!storage) return emptyUiPreferences();
  let parsed: unknown;
  try {
    const raw = storage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!raw) return emptyUiPreferences();
    parsed = JSON.parse(raw);
  } catch {
    return emptyUiPreferences();
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== UI_PREFERENCES_SCHEMA_VERSION) {
    return emptyUiPreferences();
  }

  const catalogServerUrl = normalizeStoredCatalogUrl(parsed.catalogServerUrl);
  const selectedDeckId = isNonEmptyString(parsed.selectedDeckId) ? parsed.selectedDeckId : null;
  const selectedDeckFingerprint = isNonEmptyString(parsed.selectedDeckFingerprint)
    ? parsed.selectedDeckFingerprint
    : null;
  // A selection needs both halves to mean anything; a lone id is ignored.
  const hasSelection = selectedDeckId !== null && selectedDeckFingerprint !== null;
  return {
    catalogServerUrl,
    selectedDeckId: hasSelection ? selectedDeckId : null,
    selectedDeckFingerprint: hasSelection ? selectedDeckFingerprint : null
  };
}

export function serializeUiPreferences(preferences: UiPreferences): string {
  const stored: StoredUiPreferences = {
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    catalogServerUrl: preferences.catalogServerUrl,
    selectedDeckId: preferences.selectedDeckId,
    selectedDeckFingerprint: preferences.selectedDeckFingerprint
  };
  return JSON.stringify(stored);
}

/**
 * Persists a user-chosen catalog base URL. Only a valid HTTP(S) URL is stored;
 * anything else leaves storage untouched. An empty/blank input normalises to the
 * default base URL, matching how the deck editor treats it.
 */
export function writeCatalogServerUrl(storage: UiPreferencesStorage | null, input: string): boolean {
  const normalized = normalizeCardServerUrl(input);
  if (!normalized) return false;
  return updatePreferences(storage, previous => ({
    ...previous,
    catalogServerUrl: normalized
  }));
}

/**
 * Records the named deck that was actually applied. Call this only after the
 * selection has taken effect; in-flight/pending candidates must never reach it.
 */
export function writeAppliedDeckSelection(
  storage: UiPreferencesStorage | null,
  deckId: string,
  fingerprint: string
): boolean {
  if (!isNonEmptyString(deckId) || !isNonEmptyString(fingerprint)) return false;
  return updatePreferences(storage, previous => ({
    ...previous,
    selectedDeckId: deckId,
    selectedDeckFingerprint: fingerprint
  }));
}

/** Forgets the applied selection while keeping the catalog URL. */
export function clearAppliedDeckSelection(storage: UiPreferencesStorage | null): boolean {
  return updatePreferences(storage, previous => ({
    ...previous,
    selectedDeckId: null,
    selectedDeckFingerprint: null
  }));
}

/**
 * The catalog base URL to use after a reload: the last valid HTTP(S) address the
 * user set, otherwise the caller's fallback default. The WS room address is a
 * separate setting and is never used here.
 */
export function resolveCatalogServerUrl(
  preferences: UiPreferences,
  fallback: string
): string {
  return preferences.catalogServerUrl ?? fallback;
}

export interface ResolveSelectedDeckInput {
  readonly preferences: UiPreferences;
  readonly library: DeckLibrary;
  readonly restoredDeck: DeckByZone;
}

/**
 * The named deck id to show as selected after a reload, or `null` for the plain
 * draft. Restores only when every check holds:
 * - the stored id still exists in the live library;
 * - the fingerprint stored at apply time still matches the restored draft;
 * - the library entry's *current* content still matches that same draft.
 *
 * The third check is what stops a saved id whose contents later changed (or a
 * draft that was edited and then reverted) from being mislabelled as "using this
 * named deck". The displayed name always comes from the live library entry.
 */
export function resolveSelectedDeckId(input: ResolveSelectedDeckInput): string | null {
  const { preferences, library, restoredDeck } = input;
  if (preferences.selectedDeckId === null || preferences.selectedDeckFingerprint === null) {
    return null;
  }
  const entry = findNamedDeck(library, preferences.selectedDeckId);
  if (!entry) return null;

  const draftFingerprint = deckFingerprint(restoredDeck);
  if (draftFingerprint !== preferences.selectedDeckFingerprint) return null;
  if (deckFingerprint(entry.deck) !== draftFingerprint) return null;
  return entry.id;
}

function updatePreferences(
  storage: UiPreferencesStorage | null,
  update: (previous: UiPreferences) => UiPreferences
): boolean {
  if (!storage) return false;
  const next = update(readUiPreferences(storage));
  try {
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, serializeUiPreferences(next));
    return true;
  } catch {
    return false;
  }
}

function normalizeStoredCatalogUrl(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  return normalizeCardServerUrl(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

import { DECK_ZONES, type DeckZone } from "../net/CardCatalogClient";
import type { DeckByZone, ZoneEntries } from "../hooks/useCardCatalog";

/**
 * Named, locally stored decks.
 *
 * Storage contract:
 * - A deck is stored as one entry per printing card id plus its copy count for
 *   each of the six deck zones. Nothing else is invented here: no canonical id,
 *   no printing id, no server digest.
 * - Reads are tolerant: malformed JSON, unknown schema versions, and invalid
 *   entries never throw; they degrade to an empty (or partially valid) library.
 * - Every read/write deep-clones through `JSON`, so callers can never mutate
 *   stored data by holding a reference.
 *
 * This key is intentionally independent from the prototype preview storage
 * (`riftbound.prototype.deckbuilder.v1`,
 * `riftbound-prototype-room-selected-deck-v1`) and from the single working
 * draft key `riftbound.desktop-client.deck` owned by `useCardCatalog`.
 */
export const DECK_LIBRARY_STORAGE_KEY = "riftbound.desktop-client.deck-library.v1";
export const DECK_LIBRARY_SCHEMA_VERSION = 1;
export const MAX_DECK_NAME_LENGTH = 40;

/** Minimal storage surface so the library works with `window.localStorage` or a test double. */
export interface DeckLibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NamedDeck {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly deck: DeckByZone;
}

export interface DeckLibrary {
  readonly schemaVersion: typeof DECK_LIBRARY_SCHEMA_VERSION;
  readonly decks: readonly NamedDeck[];
}

export type DeckLibraryWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface ZoneCount {
  readonly zone: DeckZone;
  readonly count: number;
}

export function emptyDeckByZoneSnapshot(): DeckByZone {
  return {
    mainDeck: {},
    runes: {},
    legend: {},
    champion: {},
    battlefields: {},
    sideboard: {}
  };
}

export function emptyDeckLibrary(): DeckLibrary {
  return { schemaVersion: DECK_LIBRARY_SCHEMA_VERSION, decks: [] };
}

export function cloneZoneEntries(entries: Readonly<Record<string, number>>): ZoneEntries {
  const clone: Record<string, number> = {};
  for (const [cardId, quantity] of Object.entries(entries)) {
    if (!isValidQuantity(quantity)) continue;
    clone[cardId] = quantity;
  }
  return clone;
}

export function cloneDeckByZone(deck: DeckByZone): DeckByZone {
  return {
    mainDeck: cloneZoneEntries(deck.mainDeck),
    runes: cloneZoneEntries(deck.runes),
    legend: cloneZoneEntries(deck.legend),
    champion: cloneZoneEntries(deck.champion),
    battlefields: cloneZoneEntries(deck.battlefields),
    sideboard: cloneZoneEntries(deck.sideboard)
  };
}

export function cloneNamedDeck(entry: NamedDeck): NamedDeck {
  return { ...entry, deck: cloneDeckByZone(entry.deck) };
}

export function cloneDeckLibrary(library: DeckLibrary): DeckLibrary {
  return {
    schemaVersion: DECK_LIBRARY_SCHEMA_VERSION,
    decks: library.decks.map(cloneNamedDeck)
  };
}

/**
 * Coerces an untrusted value into a six-zone deck. Non-objects become an empty
 * deck; invalid entries (empty card id, non safe-integer or negative quantity,
 * non-positive quantity) are dropped instead of poisoning the whole record.
 */
export function normalizeDeckByZone(value: unknown): DeckByZone {
  const source = isRecord(value) ? value : {};
  return {
    mainDeck: normalizeZoneEntries(source.mainDeck),
    runes: normalizeZoneEntries(source.runes),
    legend: normalizeZoneEntries(source.legend),
    champion: normalizeZoneEntries(source.champion),
    battlefields: normalizeZoneEntries(source.battlefields),
    sideboard: normalizeZoneEntries(source.sideboard)
  };
}

function normalizeZoneEntries(value: unknown): ZoneEntries {
  if (!isRecord(value)) return {};
  const normalized: Record<string, number> = {};
  for (const [cardId, quantity] of Object.entries(value)) {
    if (!isNonEmptyString(cardId)) continue;
    if (!isValidQuantity(quantity)) continue;
    if (quantity < 1) continue;
    normalized[cardId] = quantity;
  }
  return normalized;
}

export function readDeckLibrary(storage: DeckLibraryStorage | null): DeckLibrary {
  if (!storage) return emptyDeckLibrary();
  let parsed: unknown;
  try {
    const raw = storage.getItem(DECK_LIBRARY_STORAGE_KEY);
    if (!raw) return emptyDeckLibrary();
    parsed = JSON.parse(raw);
  } catch {
    return emptyDeckLibrary();
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== DECK_LIBRARY_SCHEMA_VERSION) {
    return emptyDeckLibrary();
  }
  if (!Array.isArray(parsed.decks)) return emptyDeckLibrary();

  const decks: NamedDeck[] = [];
  const seenIds = new Set<string>();
  for (const candidate of parsed.decks) {
    const entry = normalizeNamedDeck(candidate);
    if (!entry || seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    decks.push(entry);
  }
  return { schemaVersion: DECK_LIBRARY_SCHEMA_VERSION, decks };
}

export function writeDeckLibrary(
  storage: DeckLibraryStorage | null,
  library: DeckLibrary
): DeckLibraryWriteResult {
  if (!storage) {
    return {
      ok: false,
      message: "当前环境无法使用本地存储，卡组库仅保留在本次运行中。"
    };
  }
  try {
    storage.setItem(DECK_LIBRARY_STORAGE_KEY, serializeDeckLibrary(library));
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "本地存储写入失败（可能空间不足），卡组库仅保留在本次运行中。"
    };
  }
}

export function serializeDeckLibrary(library: DeckLibrary): string {
  return JSON.stringify({
    schemaVersion: DECK_LIBRARY_SCHEMA_VERSION,
    decks: library.decks.map(entry => ({
      id: entry.id,
      name: entry.name,
      updatedAt: entry.updatedAt,
      deck: cloneDeckByZone(entry.deck)
    }))
  });
}

export function findNamedDeck(
  library: DeckLibrary,
  deckId: string | null
): NamedDeck | null {
  if (deckId === null) return null;
  return library.decks.find(entry => entry.id === deckId) ?? null;
}

export interface NamedDeckDraft {
  readonly name: string;
  readonly deck: DeckByZone;
}

export type NamedDeckResult =
  | { readonly ok: true; readonly library: DeckLibrary; readonly entry: NamedDeck }
  | { readonly ok: false; readonly reason: string };

export interface SaveNamedDeckOptions {
  readonly id?: string;
  readonly now?: string;
}

/** Creates a new named deck from a draft deck snapshot. */
export function saveNamedDeck(
  library: DeckLibrary,
  draft: NamedDeckDraft,
  options: SaveNamedDeckOptions = {}
): NamedDeckResult {
  const name = normalizeDeckName(draft.name);
  if (!name) return { ok: false, reason: "请输入卡组名称。" };

  const entry: NamedDeck = {
    id: options.id ?? createDeckId(),
    name,
    updatedAt: options.now ?? new Date().toISOString(),
    deck: cloneDeckByZone(draft.deck)
  };
  return {
    ok: true,
    entry,
    library: { schemaVersion: DECK_LIBRARY_SCHEMA_VERSION, decks: [...library.decks, entry] }
  };
}

/** Overwrites an existing named deck with the current draft (optionally renaming it). */
export function updateNamedDeck(
  library: DeckLibrary,
  deckId: string,
  draft: NamedDeckDraft,
  options: SaveNamedDeckOptions = {}
): NamedDeckResult {
  const existing = findNamedDeck(library, deckId);
  if (!existing) return { ok: false, reason: "所选卡组已不存在，请重新选择。" };
  const name = normalizeDeckName(draft.name);
  if (!name) return { ok: false, reason: "请输入卡组名称。" };

  const entry: NamedDeck = {
    id: existing.id,
    name,
    updatedAt: options.now ?? new Date().toISOString(),
    deck: cloneDeckByZone(draft.deck)
  };
  return {
    ok: true,
    entry,
    library: {
      schemaVersion: DECK_LIBRARY_SCHEMA_VERSION,
      decks: library.decks.map(candidate => (candidate.id === deckId ? entry : candidate))
    }
  };
}

export function removeNamedDeck(library: DeckLibrary, deckId: string): DeckLibrary {
  return {
    schemaVersion: DECK_LIBRARY_SCHEMA_VERSION,
    decks: library.decks.filter(entry => entry.id !== deckId)
  };
}

export function normalizeDeckName(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_DECK_NAME_LENGTH);
}

export function createDeckId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const random = Math.random().toString(36).slice(2, 10);
  return `deck-${Date.now().toString(36)}-${random}`;
}

export function deckTotalCount(deck: DeckByZone): number {
  return DECK_ZONES.reduce(
    (total, zone) => total + zoneEntryTotal(deck[zone]),
    0
  );
}

export function deckZoneCounts(deck: DeckByZone): readonly ZoneCount[] {
  return DECK_ZONES.map(zone => ({ zone, count: zoneEntryTotal(deck[zone]) }));
}

export function deckIsEmpty(deck: DeckByZone): boolean {
  return deckTotalCount(deck) === 0;
}

/**
 * Stable identity for "this exact deck". Used to decide whether the current
 * draft still matches the deck the server accepted. Only card ids and counts
 * are part of the fingerprint.
 */
export function deckFingerprint(deck: DeckByZone): string {
  const parts: string[] = [];
  for (const zone of DECK_ZONES) {
    const entries = Object.entries(deck[zone])
      .filter(([, quantity]) => isValidQuantity(quantity) && quantity >= 1)
      .sort((left, right) => left[0].localeCompare(right[0]));
    for (const [cardId, quantity] of entries) {
      parts.push(`${zone}:${cardId}=${quantity}`);
    }
  }
  return parts.join("|");
}

function normalizeNamedDeck(value: unknown): NamedDeck | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.name)) return null;
  if (typeof value.updatedAt !== "string") return null;
  const deck = normalizeDeckByZone(value.deck);
  return {
    id: value.id,
    name: normalizeDeckName(value.name) ?? value.name,
    updatedAt: value.updatedAt,
    deck
  };
}

function zoneEntryTotal(entries: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const quantity of Object.values(entries)) {
    if (isValidQuantity(quantity)) total += quantity;
  }
  return total;
}

function isValidQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

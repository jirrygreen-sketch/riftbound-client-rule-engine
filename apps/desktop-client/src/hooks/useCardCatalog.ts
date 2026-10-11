import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DECK_ZONES,
  CardCatalogClient,
  DEFAULT_CARD_SERVER_URL,
  type CardCatalog,
  type DeckEntry,
  type DeckSubmission,
  type DeckValidationResult,
  type DeckZone
} from "../net/CardCatalogClient";

const DECK_STORAGE_KEY = "riftbound.desktop-client.deck";

export type ZoneEntries = Readonly<Record<string, number>>;

export interface DeckByZone {
  readonly mainDeck: ZoneEntries;
  readonly runes: ZoneEntries;
  readonly legend: ZoneEntries;
  readonly champion: ZoneEntries;
  readonly battlefields: ZoneEntries;
  readonly sideboard: ZoneEntries;
}

interface StoredDeckV1 {
  readonly schemaVersion: 1;
  readonly entries: ZoneEntries;
}

interface StoredDeckV2 {
  readonly schemaVersion: 2;
  readonly mainDeck: ZoneEntries;
  readonly runes: ZoneEntries;
  readonly legend: ZoneEntries;
  readonly champion: ZoneEntries;
  readonly battlefields: ZoneEntries;
  readonly sideboard: ZoneEntries;
}

export interface UseCardCatalogResult {
  readonly catalog: CardCatalog | null;
  readonly catalogStatus: "loading" | "ready" | "error";
  readonly catalogError: string | null;
  readonly deck: DeckByZone;
  readonly setZoneFromEntries: (
    zone: DeckZone,
    entries: readonly { readonly cardId: string; readonly quantity: number }[]
  ) => void;
  readonly validation: DeckValidationResult | null;
  readonly validationStatus: "idle" | "pending" | "done" | "error";
  readonly validationError: string | null;
  readonly validateDeck: () => Promise<void>;
  readonly retryCatalog: () => void;
}

interface UseCardCatalogOptions {
  readonly serverUrl?: string;
  readonly client?: CardCatalogClient;
  readonly storage?: Storage;
  readonly retryToken?: number;
  readonly timeoutMs?: number;
}

export function useCardCatalog(
  options: UseCardCatalogOptions = {}
): UseCardCatalogResult {
  const serverUrl = options.serverUrl ?? DEFAULT_CARD_SERVER_URL;
  const retryToken = options.retryToken ?? 0;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS;
  const storage = options.storage ?? defaultStorage();
  const client = useMemo(
    () => options.client ?? new CardCatalogClient(),
    [options.client]
  );
  const [catalog, setCatalog] = useState<CardCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [deck, setDeck] = useState<DeckByZone>(() => readStoredDeck(storage));
  const [validation, setValidation] = useState<DeckValidationResult | null>(null);
  const [validationStatus, setValidationStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const [manualRetryToken, setManualRetryToken] = useState(0);

  useEffect(() => {
    const requestId = ++requestRef.current;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    setCatalogStatus("loading");
    setCatalogError(null);
    setCatalog(null);

    const request = client.loadCatalog(serverUrl);
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("仓库服务连接超时，请检查服务后重试。")),
        timeoutMs
      );
    });

    Promise.race([request, timeout])
      .then(value => {
        if (requestRef.current !== requestId) return;
        setCatalog(value);
        setCatalogStatus("ready");
      })
      .catch((error: unknown) => {
        if (requestRef.current !== requestId) return;
        setCatalog(null);
        setCatalogStatus("error");
        setCatalogError(messageFrom(error, "无法加载仓库，请稍后重试。"));
      })
      .finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      });
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [client, manualRetryToken, retryToken, serverUrl, timeoutMs]);

  useEffect(() => {
    writeStoredDeck(storage, deck);
  }, [deck, storage]);

  const setZoneFromEntries = useCallback((
    zone: DeckZone,
    entries: readonly { readonly cardId: string; readonly quantity: number }[]
  ) => {
    const next = entriesToRecord(entries);
    setDeck(current => ({ ...current, [zone]: next }));
  }, []);

  const deckSubmission = useMemo<DeckSubmission>(() => toDeckSubmission(deck), [deck]);

  const validateDeck = useCallback(async () => {
    if (validationStatus === "pending") return;
    setValidationStatus("pending");
    setValidationError(null);

    try {
      const result = await client.validateDeck(serverUrl, deckSubmission);
      setValidation(result);
      setValidationStatus("done");
    } catch (error) {
      setValidationError(messageFrom(error, "无法校验卡组，请稍后重试。"));
      setValidationStatus("error");
    }
  }, [client, deckSubmission, serverUrl, validationStatus]);

  const retryCatalog = useCallback(() => {
    setValidation(null);
    setValidationError(null);
    setValidationStatus("idle");
    setManualRetryToken(token => token + 1);
  }, []);

  return {
    catalog,
    catalogStatus,
    catalogError,
    deck,
    setZoneFromEntries,
    validation,
    validationStatus,
    validationError,
    validateDeck,
    retryCatalog
  };
}

function defaultStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

const DEFAULT_CATALOG_TIMEOUT_MS = 15_000;

export function emptyDeckByZone(): DeckByZone {
  return {
    mainDeck: {},
    runes: {},
    legend: {},
    champion: {},
    battlefields: {},
    sideboard: {}
  };
}

export function addDeckEntry(
  deck: Readonly<Record<string, number>>,
  printingId: string,
  limit: number
): Readonly<Record<string, number>> {
  const count = deck[printingId] ?? 0;
  if (!printingId || count >= limit) return deck;
  return { ...deck, [printingId]: count + 1 };
}

export function removeDeckEntry(
  deck: Readonly<Record<string, number>>,
  printingId: string
): Readonly<Record<string, number>> {
  const count = deck[printingId] ?? 0;
  if (!printingId || count === 0) return deck;
  const next = { ...deck };
  if (count === 1) delete next[printingId];
  else next[printingId] = count - 1;
  return next;
}

export function entriesToRecord(
  entries: readonly { readonly cardId: string; readonly quantity: number }[]
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    if (!entry.cardId || !isPositiveInteger(entry.quantity)) continue;
    result[entry.cardId] = entry.quantity;
  }
  return result;
}

export function toDeckSubmission(deck: DeckByZone): DeckSubmission {
  const result = {} as Record<DeckZone, DeckEntry[]>;
  for (const zone of DECK_ZONES) {
    result[zone] = zoneEntries(deck[zone]);
  }
  return result;
}

function zoneEntries(
  entries: Readonly<Record<string, number>>
): DeckEntry[] {
  return Object.entries(entries)
    .filter(([, quantity]) => isPositiveInteger(quantity))
    .map(([cardId, quantity]) => ({ cardId, quantity }))
    .sort((left, right) => left.cardId.localeCompare(right.cardId));
}

export function readStoredDeck(storage: Storage | null): DeckByZone {
  if (!storage) return emptyDeckByZone();
  try {
    const raw = storage.getItem(DECK_STORAGE_KEY);
    if (!raw) return emptyDeckByZone();
    const value: unknown = JSON.parse(raw);
    if (isStoredDeckV1(value)) {
      return { ...emptyDeckByZone(), mainDeck: value.entries };
    }
    if (!isStoredDeckV2(value)) return emptyDeckByZone();
    return {
      mainDeck: value.mainDeck,
      runes: value.runes,
      legend: value.legend,
      champion: value.champion,
      battlefields: value.battlefields,
      sideboard: value.sideboard
    };
  } catch {
    return emptyDeckByZone();
  }
}

export function writeStoredDeck(
  storage: Storage | null,
  deck: DeckByZone
): void {
  if (!storage) return;
  try {
    storage.setItem(DECK_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, ...deck }));
  } catch {
    // Deck persistence is best-effort; building can continue in memory.
  }
}

function isStoredDeckV1(value: unknown): value is StoredDeckV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return isEntryRecord(value.entries);
}

function isStoredDeckV2(value: unknown): value is StoredDeckV2 {
  if (!isRecord(value) || value.schemaVersion !== 2) return false;
  return DECK_ZONES.every(zone => isEntryRecord(value[zone]));
}

function isEntryRecord(value: unknown): value is Readonly<Record<string, number>> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(count =>
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count >= 1
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

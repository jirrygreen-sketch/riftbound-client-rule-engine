import {
  isConstructedRegionSelection,
  type ConstructedRegionSelection
} from "@riftbound/protocol";

export type CardVariant = "standard" | "alternate" | "unknown";

export const DECK_ZONES = [
  "mainDeck",
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
] as const;

export type DeckZone = (typeof DECK_ZONES)[number];

export interface CatalogCard {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly name: string;
  readonly subtitle?: string;
  readonly fullName: string;
  readonly localizedName?: string;
  readonly localizedSubtitle?: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly setCode: string;
  readonly cardNumber: string;
  readonly variant: CardVariant;
  readonly imageUrl: string | null;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly ability: string;
  readonly allowedZones?: readonly DeckZone[];
  readonly maxCopies?: number;
  readonly banned?: boolean;
  readonly available?: boolean;
  readonly availabilityReason?: string;
}

export interface CardCatalog {
  readonly schemaVersion: 1;
  readonly dataVersion: string;
  readonly digest: string;
  readonly cards: readonly CatalogCard[];
}

export interface DeckEntry {
  readonly cardId: string;
  readonly quantity: number;
}

export type DeckSubmission = Readonly<Partial<Record<DeckZone, readonly DeckEntry[]>>>;

export interface DeckValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly cardId?: string;
  readonly canonicalCardId?: string;
  readonly zone?: string;
  readonly zones?: readonly string[];
}

export interface DeckValidationResult {
  readonly valid: boolean;
  readonly overflow: boolean;
  readonly totalCards: number;
  readonly zoneCounts: Readonly<Record<string, number>>;
  readonly canonicalCardCounts: Readonly<Record<string, number>>;
  readonly issues: readonly DeckValidationIssue[];
  readonly printingIssues: readonly DeckValidationPrintingIssue[];
}

export interface DeckValidationPrintingIssue {
  readonly cardId: string;
  readonly canonicalCardId?: string;
  readonly zone?: string;
  readonly status: string;
  readonly message: string;
}

export type CatalogStatus = "loading" | "ready" | "error";

export interface CatalogLoadResult {
  readonly status: CatalogStatus;
  readonly catalog: CardCatalog | null;
  readonly serverUrl: string;
  readonly error: string | null;
}

export type CardCatalogClientError =
  | "invalid-url"
  | "invalid-region"
  | "network"
  | "invalid-catalog";

export class CardCatalogClientErrorImpl extends Error {
  constructor(
    readonly kind: CardCatalogClientError,
    message: string
  ) {
    super(message);
    this.name = "CardCatalogClientError";
  }
}

interface CardCatalogClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly normalize?: (input: string) => string | null;
  readonly retryDelaysMs?: readonly number[];
}

export class CardCatalogClient {
  private readonly fetchImpl: typeof fetch;
  private readonly normalize: (input: string) => string | null;
  private readonly retryDelaysMs: readonly number[];

  constructor(options: CardCatalogClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.normalize = options.normalize ?? normalizeCardServerUrl;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  async loadCatalog(
    serverUrl: string,
    constructedRegion?: ConstructedRegionSelection | null
  ): Promise<CardCatalog> {
    const base = this.requireBaseUrl(serverUrl);
    const query = constructedRegionQuery(constructedRegion);
    const response = await this.requestJsonWithRetries(
      `${base}/api/cards${query}`,
      "仓库",
      undefined
    );

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new CardCatalogClientErrorImpl(
        "invalid-catalog",
        "仓库响应不是有效的 JSON。"
      );
    }

    return parseCardCatalog(value);
  }

  async validateDeck(
    serverUrl: string,
    deck: DeckSubmission,
    constructedRegion?: ConstructedRegionSelection | null
  ): Promise<DeckValidationResult> {
    const base = this.requireBaseUrl(serverUrl);
    const query = constructedRegionQuery(constructedRegion);
    const response = await this.requestJson(
      `${base}/api/decks/validate${query}`,
      "卡组校验",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toDeckSubmission(deck))
      }
    );

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new CardCatalogClientErrorImpl(
        "network",
        "卡组校验响应不是有效的 JSON。"
      );
    }

    return parseDeckValidationResult(value);
  }

  private async requestJson(
    url: string,
    label: string,
    init?: RequestInit
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      throw new CardCatalogClientErrorImpl("network", `无法连接${label}服务。`);
    }

    if (!response.ok) {
      throw new CardCatalogClientErrorImpl(
        response.status >= 500 ? "network" : "invalid-catalog",
        `${label}服务返回错误 ${response.status}。`
      );
    }

    return response;
  }

  private async requestJsonWithRetries(
    url: string,
    label: string,
    init: RequestInit | undefined,
    retryDelaysMs: readonly number[] = this.retryDelaysMs
  ): Promise<Response> {
    try {
      return await this.requestJson(url, label, init);
    } catch (error) {
      if (retryDelaysMs.length === 0 || !isRetryableCatalogError(error)) throw error;
      await delay(retryDelaysMs.at(0) ?? 0);
      return this.requestJsonWithRetries(url, label, init, retryDelaysMs.slice(1));
    }
  }

  private requireBaseUrl(serverUrl: string): string {
    const normalized = this.normalize(serverUrl);
    if (!normalized) {
      throw new CardCatalogClientErrorImpl(
        "invalid-url",
        "服务地址无效，请检查后重试。"
      );
    }
    return normalized;
  }
}

const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1000] as const;

/**
 * Builds the constructed-region query string for the catalog and deck
 * validation endpoints. An absent selection (undefined/null) yields an empty
 * string so the legacy endpoints stay byte-stable. A provided-but-invalid
 * selection fails closed as a client error; it never silently falls back to the
 * global endpoint. The server owns release scheduling and provenance, so no
 * timezone or language default is ever injected here.
 */
export function constructedRegionQuery(
  selection?: ConstructedRegionSelection | null
): string {
  if (selection === undefined || selection === null) return "";
  if (!isConstructedRegionSelection(selection)) {
    throw new CardCatalogClientErrorImpl(
      "invalid-region",
      "赛事地区或本地日期无效，请重新选择。"
    );
  }
  const params = new URLSearchParams();
  params.set("regionCode", selection.regionCode);
  params.set("eventDate", selection.eventDate);
  return `?${params.toString()}`;
}

export function normalizeCardServerUrl(input: string): string | null {
  const trimmed = input.trim() || DEFAULT_CARD_SERVER_URL;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;

  if (url.pathname === "/" || url.pathname === "") url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export const DEFAULT_CARD_SERVER_URL = "http://127.0.0.1:8787";

export function cardImageServerUrl(serverUrl: string, printingId: string): string {
  const base = normalizeCardServerUrl(serverUrl);
  if (!base || !printingId) return "";
  return `${base}/api/card-images/${encodeURIComponent(printingId)}`;
}

function toDeckSubmission(deck: DeckSubmission): { deck: Record<DeckZone, DeckEntry[]> } {
  const result = {} as Record<DeckZone, DeckEntry[]>;
  for (const zone of DECK_ZONES) {
    const entries = deck[zone] ?? [];
    result[zone] = entries
      .filter(entry => isPositiveInteger(entry.quantity))
      .map(entry => ({ cardId: entry.cardId, quantity: entry.quantity }));
  }
  return { deck: result };
}

function parseCardCatalog(value: unknown): CardCatalog {
  if (!isRecord(value) ||
      value.schemaVersion !== 1 ||
      !isNonEmptyString(value.dataVersion) ||
      !isNonEmptyString(value.digest)) {
    throwInvalidCatalog();
  }

  if (!Array.isArray(value.cards)) throwInvalidCatalog();
  const cards: CatalogCard[] = [];
  const ids = new Set<string>();
  for (const item of value.cards) {
    if (!isCatalogCard(item) || ids.has(item.id)) throwInvalidCatalog();
    ids.add(item.id);
    cards.push(item);
  }

  return {
    schemaVersion: 1,
    dataVersion: value.dataVersion,
    digest: value.digest,
    cards
  };
}

function isCatalogCard(value: unknown): value is CatalogCard {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) ||
      !isNonEmptyString(value.canonicalCardId) ||
      !isNonEmptyString(value.name) ||
      !isNonEmptyString(value.fullName) ||
      !isNonEmptyString(value.cardType) ||
      !Array.isArray(value.domains) ||
      !value.domains.every(isNonEmptyString) ||
      !Array.isArray(value.tags) ||
      !value.tags.every(isNonEmptyString) ||
      !isNonEmptyString(value.setCode) ||
      !isNonEmptyString(value.cardNumber) ||
      !isCardVariant(value.variant) ||
      !isStringOrNull(value.imageUrl) ||
      !isNumberOrNull(value.energy) ||
      !isNumberOrNull(value.power) ||
      !isNumberOrNull(value.might) ||
      typeof value.ability !== "string") {
    return false;
  }

  if (value.subtitle !== undefined && !isNonEmptyString(value.subtitle)) return false;
  if (value.localizedName !== undefined && !isNonEmptyString(value.localizedName)) {
    return false;
  }
  if (value.localizedSubtitle !== undefined &&
      !isNonEmptyString(value.localizedSubtitle)) {
    return false;
  }
  if (value.allowedZones !== undefined &&
      !(Array.isArray(value.allowedZones) &&
        value.allowedZones.every(isDeckZone) &&
        new Set(value.allowedZones).size === value.allowedZones.length)) {
    return false;
  }
  if (value.maxCopies !== undefined && !isNonnegativeInteger(value.maxCopies)) {
    return false;
  }
  if (value.banned !== undefined && typeof value.banned !== "boolean") {
    return false;
  }
  if (value.available !== undefined && typeof value.available !== "boolean") {
    return false;
  }
  if (value.availabilityReason !== undefined &&
      !isNonEmptyString(value.availabilityReason)) {
    return false;
  }

  return true;
}

function parseDeckValidationResult(value: unknown): DeckValidationResult {
  if (!isRecord(value) ||
      typeof value.valid !== "boolean" ||
      typeof value.overflow !== "boolean" ||
      !isNonnegativeInteger(value.totalCards) ||
      !isRecord(value.zoneCounts) ||
      !Object.values(value.zoneCounts).every(isNonnegativeInteger) ||
      !isRecord(value.canonicalCardCounts) ||
      !Object.values(value.canonicalCardCounts).every(isNonnegativeInteger) ||
      !Array.isArray(value.issues) ||
      !value.issues.every(isDeckValidationIssue) ||
      !Array.isArray(value.printingIssues) ||
      !value.printingIssues.every(isDeckValidationPrintingIssue)) {
    throw new CardCatalogClientErrorImpl(
      "network",
      "卡组校验响应格式无效。"
    );
  }

  return {
    valid: value.valid,
    overflow: value.overflow,
    totalCards: value.totalCards,
    zoneCounts: value.zoneCounts as Record<string, number>,
    canonicalCardCounts: value.canonicalCardCounts as Record<string, number>,
    issues: value.issues as readonly DeckValidationIssue[],
    printingIssues: value.printingIssues as readonly DeckValidationPrintingIssue[]
  };
}

function isDeckValidationPrintingIssue(
  value: unknown
): value is DeckValidationPrintingIssue {
  return isRecord(value) &&
    isNonEmptyString(value.cardId) &&
    (value.canonicalCardId === undefined ||
      isNonEmptyString(value.canonicalCardId)) &&
    (value.zone === undefined || isNonEmptyString(value.zone)) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.message);
}

function isDeckValidationIssue(value: unknown): value is DeckValidationIssue {
  return isRecord(value) &&
    isNonEmptyString(value.code) &&
    isNonEmptyString(value.message) &&
    (value.cardId === undefined || isNonEmptyString(value.cardId)) &&
    (value.canonicalCardId === undefined ||
      isNonEmptyString(value.canonicalCardId)) &&
    (value.zone === undefined || isNonEmptyString(value.zone)) &&
    (value.zones === undefined ||
      (Array.isArray(value.zones) && value.zones.every(isNonEmptyString)));
}

function throwInvalidCatalog(): never {
  throw new CardCatalogClientErrorImpl("invalid-catalog", "仓库数据格式无效。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDeckZone(value: unknown): value is DeckZone {
  return (DECK_ZONES as readonly unknown[]).includes(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isFinite(value));
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonnegativeInteger(value) && value >= 1;
}

function isRetryableCatalogError(value: unknown): boolean {
  return value instanceof CardCatalogClientErrorImpl && value.kind === "network";
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isCardVariant(value: unknown): value is CardVariant {
  return value === "standard" || value === "alternate" || value === "unknown";
}

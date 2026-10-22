import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RoomDeckSubmission } from "@riftbound/protocol";
import {
  validateCatalogDeck,
  type CardCatalogRuntime,
  type CatalogCard
} from "../card-catalog.js";

export const M1_PRESET_CATALOG_SCHEMA = "riftbound.m1-preset-catalog.v1" as const;

export const M1_PRESET_IDS = Object.freeze(["rumble-sfd", "fiora-sfd"] as const);
export type M1PresetId = (typeof M1_PRESET_IDS)[number];

const DECK_ZONES = [
  "legend",
  "champion",
  "mainDeck",
  "battlefields",
  "runes",
  "sideboard"
] as const;
type PresetDeckZone = (typeof DECK_ZONES)[number];

const PRESET_NAMES: Readonly<Record<M1PresetId, string>> = Object.freeze({
  "rumble-sfd": "Rumble (Mechanized Menace)",
  "fiora-sfd": "Fiora (Grand Duelist)"
});

const INTEGRATION_DECKS_MODULE = new URL(
  "../../../../packages/integration-tests/src/headless/decks.js",
  import.meta.url
);
const DEFAULT_M1_DECK_PLAN_PATH = fileURLToPath(new URL(
  "../../../../docs/plans/m1-decks.json",
  import.meta.url
));
const DEFAULT_GENERATED_CATALOG_PATH = fileURLToPath(new URL(
  "../../../../packages/card-data/data/deck-catalog.json",
  import.meta.url
));

interface HeadlessCard {
  readonly canonicalCardId: string;
  readonly name: string;
}

interface HeadlessDeck {
  readonly mainDeck: readonly HeadlessCard[];
  readonly runeDeck: readonly HeadlessCard[];
  readonly championLegend: HeadlessCard;
  readonly chosenChampion: HeadlessCard;
  readonly battlefields: readonly HeadlessCard[];
}

interface HeadlessDeckModule {
  readonly buildM1Deck: (id: M1PresetId, seat: "A") => HeadlessDeck;
}

export interface M1PresetZoneCounts {
  readonly legend: 1;
  readonly champion: 1;
  readonly mainDeck: 39;
  readonly runes: 12;
  readonly battlefields: 3;
  readonly total: 56;
}

export interface M1PresetCardReference {
  readonly printingId: string;
  readonly canonicalCardId: string;
  readonly name: string;
}

export interface M1PresetDeck {
  readonly id: M1PresetId;
  readonly name: string;
  readonly legend: M1PresetCardReference;
  readonly champion: M1PresetCardReference;
  readonly cardCount: 56;
  readonly zoneCounts: M1PresetZoneCounts;
  readonly digest: string;
  readonly deck: RoomDeckSubmission;
}

export interface M1PresetCatalog {
  readonly schemaVersion: typeof M1_PRESET_CATALOG_SCHEMA;
  readonly presets: readonly [M1PresetDeck, M1PresetDeck];
}

export interface M1PresetLoadOptions {
  /** Preflight path override, used to verify the required failure message. */
  readonly deckPlanPath?: string;
  /** Generated catalog path; the same path consumed by headless/decks.ts. */
  readonly catalogPath?: string;
}

export class M1PresetCatalogError extends Error {
  readonly code = "m1-preset-catalog-unavailable" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "M1PresetCatalogError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("Deck contains a non-JSON value");
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizedZone(
  entries: RoomDeckSubmission[PresetDeckZone]
): readonly { readonly cardId: string; readonly quantity: number }[] {
  if (entries === undefined) return [];
  const quantities = new Map<string, number>();
  for (const entry of entries) {
    const quantity = (quantities.get(entry.cardId) ?? 0) + entry.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new TypeError(`Invalid deck quantity for ${entry.cardId}`);
    }
    quantities.set(entry.cardId, quantity);
  }
  return [...quantities]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([cardId, quantity]) => ({ cardId, quantity }));
}

/** Stable digest over zone contents; source ordering and duplicate entry splits do not matter. */
export function m1DeckDigest(deck: RoomDeckSubmission): string {
  const content: Partial<Record<PresetDeckZone, readonly { readonly cardId: string; readonly quantity: number }[]>> = {};
  for (const zone of DECK_ZONES) {
    const entries = normalizedZone(deck[zone]);
    if (entries.length > 0) content[zone] = entries;
  }
  const digest = createHash("sha256").update(canonicalJson(content), "utf8").digest("hex");
  return `sha256:${digest}`;
}

export function matchingM1Preset(
  deck: RoomDeckSubmission,
  catalog: M1PresetCatalog
): M1PresetDeck | null {
  const digest = m1DeckDigest(deck);
  return catalog.presets.find(preset => preset.digest === digest) ?? null;
}

async function requireSourceFile(file: string, label: string): Promise<void> {
  try {
    await access(file);
  } catch (cause) {
    throw new M1PresetCatalogError(
      `M1 preset ${label} is missing at ${file}. The tracked M1 deck plan and generated card catalog are required.`,
      { cause }
    );
  }
}

function physicalPrintingFor(
  catalog: CardCatalogRuntime,
  canonicalCardId: string,
  preferredSetCode = "sfd"
): CatalogCard {
  const group = catalog.publicCatalog.groups?.find(candidate =>
    candidate.canonicalCardId === canonicalCardId
  );
  const groupPrintings = group
    ? group.printings.flatMap(printingId => {
        const card = catalog.publicCatalog.cards.find(candidate => candidate.id === printingId);
        return card ? [card] : [];
      })
    : [];
  const candidates = groupPrintings.length > 0
    ? groupPrintings
    : catalog.publicCatalog.cards.filter(card => card.canonicalCardId === canonicalCardId);
  const available = candidates.filter(card =>
    catalog.constructedRules.policy.printingPolicies[card.id]?.available === true
  );
  const selectable = available.length > 0 ? available : candidates;
  const printing = selectable.find(card =>
    card.setCode === preferredSetCode && card.variant === "standard"
  ) ?? selectable.find(card => card.variant === "standard") ??
    selectable.find(card => card.id === group?.primaryPrintingId) ?? selectable[0];
  if (!printing) {
    throw new M1PresetCatalogError(
      `M1 preset card catalog has no printing for canonical card ${canonicalCardId}.`
    );
  }
  return printing;
}

function aggregateCards(
  cards: readonly HeadlessCard[],
  catalog: CardCatalogRuntime
): readonly { readonly cardId: string; readonly quantity: number }[] {
  const quantities = new Map<string, { readonly printingId: string; readonly quantity: number }>();
  for (const card of cards) {
    const printing = physicalPrintingFor(catalog, card.canonicalCardId);
    const current = quantities.get(card.canonicalCardId);
    quantities.set(card.canonicalCardId, {
      printingId: current?.printingId ?? printing.id,
      quantity: (current?.quantity ?? 0) + 1
    });
  }
  return [...quantities.values()]
    .sort((left, right) => left.printingId < right.printingId ? -1 :
      left.printingId > right.printingId ? 1 : 0)
    .map(entry => ({ cardId: entry.printingId, quantity: entry.quantity }));
}

function submissionFor(deck: HeadlessDeck, catalog: CardCatalogRuntime): RoomDeckSubmission {
  return deepFreeze({
    mainDeck: aggregateCards(deck.mainDeck, catalog),
    runes: aggregateCards(deck.runeDeck, catalog),
    legend: aggregateCards([deck.championLegend], catalog),
    champion: aggregateCards([deck.chosenChampion], catalog),
    battlefields: aggregateCards(deck.battlefields, catalog)
  });
}

function cardReference(card: CatalogCard): M1PresetCardReference {
  return {
    printingId: card.id,
    canonicalCardId: card.canonicalCardId,
    name: card.fullName
  };
}

function assertPresetShape(deck: RoomDeckSubmission): void {
  const count = (zone: PresetDeckZone): number => (deck[zone] ?? [])
    .reduce((total, entry) => total + entry.quantity, 0);
  if (count("legend") !== 1 || count("champion") !== 1 ||
      count("mainDeck") !== 39 || count("runes") !== 12 ||
      count("battlefields") !== 3 || count("sideboard") !== 0) {
    throw new M1PresetCatalogError("A tracked M1 preset does not have the required 1/1/39/12/3 deck shape.");
  }
}

/**
 * Builds both beta presets through the same headless builder used by M1 engine
 * acceptance, then validates the resulting wire submissions against the
 * server's authoritative catalog runtime.
 */
export async function loadM1PresetCatalog(
  catalog: CardCatalogRuntime,
  options: M1PresetLoadOptions = {}
): Promise<M1PresetCatalog> {
  const deckPlanPath = path.resolve(options.deckPlanPath ?? DEFAULT_M1_DECK_PLAN_PATH);
  const catalogPath = path.resolve(options.catalogPath ?? DEFAULT_GENERATED_CATALOG_PATH);
  await Promise.all([
    requireSourceFile(deckPlanPath, "deck plan"),
    requireSourceFile(catalogPath, "card catalog")
  ]);

  let headless: HeadlessDeckModule;
  try {
    headless = await import(INTEGRATION_DECKS_MODULE.href) as HeadlessDeckModule;
  } catch (cause) {
    throw new M1PresetCatalogError(
      `M1 preset sources could not be loaded from ${INTEGRATION_DECKS_MODULE.href}.`,
      { cause }
    );
  }

  const presets = M1_PRESET_IDS.map(id => {
    const headlessDeck = headless.buildM1Deck(id, "A");
    const deck = submissionFor(headlessDeck, catalog);
    assertPresetShape(deck);
    const validation = validateCatalogDeck(catalog, deck);
    if (!validation.valid) {
      const reason = validation.issues[0]?.message ??
        validation.printingIssues[0]?.message ?? "unknown validation failure";
      throw new M1PresetCatalogError(`M1 preset ${id} is not catalog-legal: ${reason}`);
    }
    const legend = physicalPrintingFor(catalog, headlessDeck.championLegend.canonicalCardId);
    const champion = physicalPrintingFor(catalog, headlessDeck.chosenChampion.canonicalCardId);
    return deepFreeze({
      id,
      name: PRESET_NAMES[id],
      legend: cardReference(legend),
      champion: cardReference(champion),
      cardCount: 56 as const,
      zoneCounts: {
        legend: 1 as const,
        champion: 1 as const,
        mainDeck: 39 as const,
        runes: 12 as const,
        battlefields: 3 as const,
        total: 56 as const
      },
      digest: m1DeckDigest(deck),
      deck
    });
  }) as [M1PresetDeck, M1PresetDeck];

  return Object.freeze({ schemaVersion: M1_PRESET_CATALOG_SCHEMA, presets });
}

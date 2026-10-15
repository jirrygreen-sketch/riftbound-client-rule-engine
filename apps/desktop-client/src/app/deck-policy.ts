import { type DeckByZone } from "../hooks/useCardCatalog";
import { type CatalogCard, type DeckZone } from "../net/CardCatalogClient";

export const DECK_ZONE_LABELS: Readonly<Record<DeckZone, string>> = {
  mainDeck: "主卡组",
  runes: "符文",
  legend: "传说",
  champion: "英雄",
  battlefields: "战场",
  sideboard: "备牌"
};

export const DECK_ZONE_ORDER: readonly DeckZone[] = [
  "mainDeck",
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
];

export const DEFAULT_DRAFT_NAME = "当前草稿";

export function allowedZonesFor(card: CatalogCard): readonly DeckZone[] {
  if (card.allowedZones !== undefined) return card.allowedZones;
  return allowedZonesFromCardType(card);
}

export function isCardAbilityImplemented(card: CatalogCard): boolean {
  const supportedFoundationTypes = new Set([
    "unit",
    "spell",
    "battlefield",
    "champion",
    "legend"
  ]);

  return card.ability.trim().length === 0 &&
    supportedFoundationTypes.has(card.cardType.trim().toLowerCase());
}

export function canSubmitRoomDeck(options: {
  requestPending: boolean;
  roomStatus: "waiting" | "playing" | "ended" | null;
}): boolean {
  return !options.requestPending && options.roomStatus === "waiting";
}


function allowedZonesFromCardType(card: CatalogCard): readonly DeckZone[] {
  const cardType = card.cardType.toLowerCase();
  const tags = card.tags.map(tag => tag.toLowerCase());
  if (cardType === "rune") return ["runes"];
  if (cardType === "legend") return ["legend"];
  if (cardType === "battlefield") return ["battlefields"];
  if (cardType === "champion" || tags.includes("champion")) {
    return ["mainDeck", "champion", "sideboard"];
  }
  return ["mainDeck", "sideboard"];
}

export function limitFor(card: CatalogCard, zone: DeckZone): number {
  const zoneLimit =
    zone === "runes" ? 12 :
    zone === "battlefields" ? 1 :
    zone === "legend" ? 1 :
    3;
  return card.maxCopies === undefined ? zoneLimit : Math.min(card.maxCopies, zoneLimit);
}

export function buildCardLimits(
  cards: readonly CatalogCard[],
  activeZone: DeckZone,
  deck: DeckByZone
): Map<string, number> {
  const candidates = new Map<string, { limit: number; hasLegalPrinting: boolean }>();

  const limits = new Map<string, number>();
  for (const card of cards) {
    if (!allowedZonesFor(card).includes(activeZone)) continue;

    const current = candidates.get(card.canonicalCardId) ?? {
      limit: 0,
      hasLegalPrinting: false
    };
    const printingLimit = limitFor(card, activeZone);
    if (
      card.banned !== true &&
      card.available !== false &&
      printingLimit > 0
    ) {
      current.limit = Math.max(current.limit, printingLimit);
      current.hasLegalPrinting = true;
    }
    candidates.set(card.canonicalCardId, current);
  }

  for (const [canonicalCardId, candidate] of candidates) {
    const usedElsewhere = sharedLimitZones(activeZone)
      .filter(zone => zone !== activeZone)
      .reduce(
        (total, zone) => total + zoneCanonicalCount(deck, zone, canonicalCardId, cards),
        0
      );
    limits.set(
      canonicalCardId,
      candidate.hasLegalPrinting
        ? Math.max(0, candidate.limit - usedElsewhere)
        : 0
    );
  }
  return limits;
}

export function sharedLimitZones(activeZone: DeckZone): readonly DeckZone[] {
  const sharedZones: readonly DeckZone[] = ["mainDeck", "champion", "sideboard"];
  return sharedZones.includes(activeZone) ? sharedZones : [activeZone];
}

export function zoneCanonicalCount(
  deck: DeckByZone,
  zone: DeckZone,
  canonicalCardId: string,
  cards: readonly CatalogCard[]
): number {
  const printingIds = new Set(
    cards
      .filter(card => card.canonicalCardId === canonicalCardId)
      .map(card => card.id)
  );
  return Object.entries(deck[zone]).reduce(
    (total, [printingId, quantity]) =>
      printingIds.has(printingId) ? total + quantity : total,
    0
  );
}

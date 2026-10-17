import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MatchCard, MatchDeck } from "../../../engine-core/dist/game/lifecycle.js";

export type M1PreconId = "rumble-sfd" | "fiora-sfd";
export type HeadlessSeat = "A" | "B";

export interface HeadlessCard extends MatchCard {
  readonly canonicalCardId: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
}

interface M1ListEntry {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly name: string;
  readonly quantity: number;
  readonly cardType: string;
  readonly domains: readonly string[];
}

interface M1Candidate {
  readonly id: M1PreconId;
  readonly chosenChampion: string;
  readonly recommendedCardList: readonly M1ListEntry[];
}

interface CatalogCard {
  readonly canonicalCardId: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
}

interface M1File {
  readonly candidates: readonly M1Candidate[];
}

function readJson<T>(relative: string): T {
  const file = fileURLToPath(new URL(relative, import.meta.url));
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

const m1 = readJson<M1File>("../../../../docs/plans/m1-decks.json");
const catalog = readJson<{ readonly cards: readonly CatalogCard[] }>(
  "../../../../packages/card-data/data/deck-catalog.json",
);
const catalogByCanonical = new Map(catalog.cards.map(card => [card.canonicalCardId, card]));

function candidate(id: M1PreconId): M1Candidate {
  const found = m1.candidates.find(value => value.id === id);
  if (!found) throw new Error(`M1 precon is missing from m1-decks.json: ${id}`);
  return found;
}

function typesFor(cardType: string): readonly string[] {
  switch (cardType.toLowerCase()) {
    case "unit": return ["unit"];
    case "spell": return ["spell"];
    case "gear": return ["gear"];
    case "rune": return ["rune"];
    case "legend": return ["legend"];
    case "battlefield": return ["battlefield"];
    default: return [cardType.toLowerCase()];
  }
}

function physicalCard(
  entry: M1ListEntry,
  seat: HeadlessSeat,
  zone: M1ListEntry["zone"],
  ordinal: number,
): HeadlessCard {
  const printed = catalogByCanonical.get(entry.canonicalCardId);
  return {
    id: `${seat}:${zone}:${ordinal}:${entry.canonicalCardId}`,
    cardId: entry.canonicalCardId,
    canonicalCardId: entry.canonicalCardId,
    name: entry.name,
    cardType: entry.cardType,
    domains: [...entry.domains],
    types: typesFor(entry.cardType),
    energy: printed?.energy ?? null,
    power: printed?.power ?? null,
    might: printed?.might ?? null,
  };
}

function entriesFor(deck: M1Candidate, zone: M1ListEntry["zone"]): readonly M1ListEntry[] {
  return deck.recommendedCardList.filter(entry => entry.zone === zone);
}

function expand(entries: readonly M1ListEntry[], seat: HeadlessSeat, zone: M1ListEntry["zone"]): HeadlessCard[] {
  const cards: HeadlessCard[] = [];
  for (const entry of entries) {
    for (let copy = 0; copy < entry.quantity; copy += 1) {
      cards.push(physicalCard(entry, seat, zone, cards.length));
    }
  }
  return cards;
}

export function buildM1Deck(id: M1PreconId, seat: HeadlessSeat): MatchDeck & {
  readonly mainDeck: readonly HeadlessCard[];
  readonly runeDeck: readonly HeadlessCard[];
  readonly championLegend: HeadlessCard;
  readonly chosenChampion: HeadlessCard;
  readonly battlefields: readonly [HeadlessCard, HeadlessCard, HeadlessCard];
} {
  const deck = candidate(id);
  const legends = expand(entriesFor(deck, "legend"), seat, "legend");
  const champions = expand(entriesFor(deck, "champion"), seat, "champion");
  const main = expand(entriesFor(deck, "mainDeck"), seat, "mainDeck");
  const runes = expand(entriesFor(deck, "runes"), seat, "runes");
  const battlefields = expand(entriesFor(deck, "battlefields"), seat, "battlefields");
  if (legends.length !== 1 || champions.length !== 1 || main.length !== 39 || runes.length !== 12 || battlefields.length !== 3) {
    throw new Error(`Invalid ${id} M1 deck shape`);
  }
  return {
    mainDeck: main,
    runeDeck: runes,
    championLegend: legends[0]!,
    chosenChampion: champions[0]!,
    battlefields: [battlefields[0]!, battlefields[1]!, battlefields[2]!],
  };
}

export function m1Decks(): readonly [ReturnType<typeof buildM1Deck>, ReturnType<typeof buildM1Deck>] {
  return [buildM1Deck("rumble-sfd", "A"), buildM1Deck("fiora-sfd", "B")];
}

export function m1CardCatalog(): ReadonlyMap<string, HeadlessCard> {
  const result = new Map<string, HeadlessCard>();
  for (const id of ["rumble-sfd", "fiora-sfd"] as const) {
    const deck = buildM1Deck(id, "A");
    for (const card of [deck.championLegend, deck.chosenChampion, ...deck.mainDeck, ...deck.runeDeck, ...deck.battlefields]) {
      result.set(card.cardId ?? card.id, card);
    }
  }
  return result;
}

import { readFileSync } from "node:fs";
import type { RoomDeckSubmission } from "../../../protocol/src/index.js";

export type V2M1PreconId = "rumble-sfd" | "fiora-sfd";

interface CardRecord {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly name: string;
  readonly cardType: string;
  readonly available?: boolean;
  readonly variant?: string;
  readonly setCode?: string;
  readonly energy?: number | null;
  readonly power?: number | null;
}

interface DeckPlanEntry {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly quantity: number;
}

interface DeckPlan {
  readonly candidates: readonly {
    readonly id: string;
    readonly recommendedCardList: readonly DeckPlanEntry[];
  }[];
}

const plan = JSON.parse(readFileSync(
  new URL("../../../../docs/plans/m1-decks.json", import.meta.url),
  "utf8"
)) as DeckPlan;
const catalog = JSON.parse(readFileSync(
  new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url),
  "utf8"
)) as { readonly cards: readonly CardRecord[] };
const printings = new Map(catalog.cards.map(card => [card.canonicalCardId, card] as const));

export const V2_M1_PRECONS: Readonly<Record<V2M1PreconId, {
  readonly deck: RoomDeckSubmission;
  readonly cards: readonly CardRecord[];
}>> = Object.fromEntries((["rumble-sfd", "fiora-sfd"] as const).map(id => {
  const candidate = plan.candidates.find(value => value.id === id);
  if (!candidate) throw new Error(`Missing M1 deck plan ${id}`);
  const zones: Partial<Record<DeckPlanEntry["zone"], { cardId: string; quantity: number }[]>> = {};
  const cards: CardRecord[] = [];
  for (const entry of candidate.recommendedCardList) {
    const card = printings.get(entry.canonicalCardId);
    if (!card || card.available === false) {
      throw new Error(`Missing available M1 printing for ${entry.canonicalCardId}`);
    }
    const zone = zones[entry.zone] ?? [];
    zone.push({ cardId: card.id, quantity: entry.quantity });
    zones[entry.zone] = zone;
    for (let copy = 0; copy < entry.quantity; copy += 1) cards.push(card);
  }
  return [id, { deck: zones as RoomDeckSubmission, cards: Object.freeze(cards) }];
})) as Readonly<Record<V2M1PreconId, {
  readonly deck: RoomDeckSubmission;
  readonly cards: readonly CardRecord[];
}>>;

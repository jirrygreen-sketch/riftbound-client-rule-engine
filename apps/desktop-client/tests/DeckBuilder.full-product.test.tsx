import { describe, expect, it } from "vitest";
import {
  addCard,
  type DeckBuilderCard,
  type DeckBuilderEntry,
  buildDeckGroups,
  expandedGroupsForSearch,
  isAddDisabled,
  isCardAvailable,
  removeCard
} from "../src/components/DeckBuilder";

const standard: DeckBuilderCard = card({
  id: "flame-standard"
});

const alternate: DeckBuilderCard = card({
  id: "flame-alternate",
  variant: "alternate",
  imageUrl: "https://example.com/flame-alternate.jpg"
});

const bannedAlternate: DeckBuilderCard = card({
  id: "flame-banned-alternate",
  variant: "alternate",
  banned: true,
  available: true,
  availabilityReason: "banned"
});

const unreleased: DeckBuilderCard = card({
  id: "flame-unreleased",
  setCode: "RAD",
  cardNumber: "RAD-001-167",
  available: false,
  availabilityReason: "previewNotReleased"
});

const oracle: DeckBuilderCard = card({
  id: "oracle-standard",
  canonicalCardId: "oracle",
  name: "Tide Oracle",
  localizedName: "潮汐预言者",
  subtitle: "Tidecaller",
  localizedSubtitle: "唤潮者",
  fullName: "Tide Oracle · Tidecaller",
  cardType: "Unit",
  domains: ["water"],
  tags: ["ocean-magic"],
  setCode: "SET-002",
  cardNumber: "SET-002-001"
});

const flameCards = [standard, alternate, bannedAlternate, unreleased];

describe("DeckBuilder full product interactions", () => {
  it("searches names, card numbers, rules identities, and canonical identities", () => {
    const catalog = [...flameCards, oracle];
    const search = (query: string) =>
      buildDeckGroups(catalog, new Map(), new Map(), query);

    expect(search("Flame Warden")).toHaveLength(1);
    expect(search("SET-001-004")).toHaveLength(1);
    expect(search("RB-001")).toHaveLength(1);
    expect(search("flame")).toHaveLength(1);
    expect(search("flame-alternate")).toHaveLength(1);
    expect(search("oracle")).toHaveLength(1);
    expect(search("潮汐")).toHaveLength(1);
    expect(search("ocean-magic")).toHaveLength(1);
    expect(search("flame-alternate")[0]?.cards).toHaveLength(4);
  });

  it("groups standard and alternate printings under one canonical card", () => {
    const groups = buildDeckGroups(
      flameCards,
      new Map([
        ["flame-standard", 2],
        ["flame-alternate", 1]
      ]),
      new Map([["flame", 3]]),
      ""
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      canonicalCardId: "flame",
      quantity: 3,
      limit: 3,
      remaining: 0
    });
    expect(groups[0]?.cards.map(card => card.id)).toEqual([
      "flame-standard",
      "flame-unreleased",
      "flame-alternate",
      "flame-banned-alternate"
    ]);
  });

  it("finds all printings when searching the full displayed localized title", () => {
    const groups = buildDeckGroups(
      [...flameCards, oracle],
      new Map(),
      new Map(),
      "  烈焰守望者 · 余烬卫士  "
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe("烈焰守望者 · 余烬卫士");
    expect(groups[0]?.cards).toHaveLength(flameCards.length);
    expect(groups[0]?.canonicalCardId).toBe("flame");
  });

  it("shares the canonical copy limit across all printings", () => {
    const limits = new Map([["flame", 3]]);
    let deck = addCard([], flameCards, "flame-standard", limits);
    deck = addCard(deck, flameCards, "flame-alternate", limits);
    deck = addCard(deck, flameCards, "flame-standard", limits);
    const blocked = addCard(deck, flameCards, "flame-alternate", limits);

    expect(deck).toEqual([
      { cardId: "flame-standard", quantity: 2 },
      { cardId: "flame-alternate", quantity: 1 }
    ]);
    expect(blocked).toBe(deck);
    expect(isAddDisabled(3, 3)).toBe(true);
  });

  it("does not offer banned or unavailable printings", () => {
    const limits = new Map([["flame", 3]]);
    const availableDeck = addCard([], flameCards, "flame-standard", limits);
    const bannedDeck = addCard(availableDeck, flameCards, "flame-banned-alternate", limits);
    const unavailableDeck = addCard(availableDeck, flameCards, "flame-unreleased", limits);

    expect(isCardAvailable(bannedAlternate)).toBe(false);
    expect(isCardAvailable(unreleased)).toBe(false);
    expect(isCardAvailable(standard)).toBe(true);
    expect(bannedDeck).toBe(availableDeck);
    expect(unavailableDeck).toBe(availableDeck);
  });

  it("removes only the selected printing", () => {
    const deck: readonly DeckBuilderEntry[] = [
      { cardId: "flame-standard", quantity: 2 },
      { cardId: "flame-alternate", quantity: 1 }
    ];

    expect(removeCard(deck, "flame-alternate")).toEqual([
      { cardId: "flame-standard", quantity: 2 }
    ]);
    expect(removeCard(deck, "flame-standard")).toEqual([
      { cardId: "flame-standard", quantity: 1 },
      { cardId: "flame-alternate", quantity: 1 }
    ]);
  });

  it("shows the selected quantity and remaining canonical limit", () => {
    const groups = buildDeckGroups(
      flameCards,
      new Map([["flame-alternate", 1]]),
      new Map([["flame", 4]]),
      ""
    );
    const unlimited = buildDeckGroups(
      [oracle],
      new Map(),
      new Map(),
      ""
    );

    expect(groups[0]).toMatchObject({
      quantity: 1,
      limit: 4,
      remaining: 3
    });
    expect(unlimited[0]).toMatchObject({
      quantity: 0,
      limit: null,
      remaining: null
    });
  });

  it("expands matched groups while preserving manually opened groups", () => {
    const current = new Set(["oracle"]);
    const expanded = expandedGroupsForSearch(current, ["oracle", "flame"], "flame");

    expect([...expanded].sort()).toEqual(["flame", "oracle"]);
    expect(expandedGroupsForSearch(expanded, ["flame"], "")).toBe(expanded);
  });
});

function card(overrides: Partial<DeckBuilderCard> = {}): DeckBuilderCard {
  return {
    id: "flame-standard",
    canonicalCardId: "flame",
    name: "Flame Warden",
    subtitle: "Ember Guard",
    fullName: "Flame Warden · Ember Guard",
    localizedName: "烈焰守望者",
    localizedSubtitle: "余烬卫士",
    cardType: "RB-001",
    domains: ["fire"],
    tags: ["guard", "fire-warden"],
    setCode: "SET-001",
    cardNumber: "SET-001-004",
    variant: "standard",
    imageUrl: null,
    ...overrides
  };
}

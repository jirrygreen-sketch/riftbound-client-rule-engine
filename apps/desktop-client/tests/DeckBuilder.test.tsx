import { describe, expect, it } from "vitest";
import {
  addCard,
  type DeckBuilderCard,
  type DeckBuilderEntry,
  buildDeckGroups,
  isAddDisabled,
  isCardAvailable,
  removeCard
} from "../src/components/DeckBuilder";

const standard: DeckBuilderCard = card({
  id: "flame-standard",
  name: "Flame Warden",
  fullName: "Flame Warden · Ember Guard",
  subtitle: "Ember Guard"
});

const alternate: DeckBuilderCard = card({
  id: "flame-alternate",
  name: "Flame Warden",
  fullName: "Flame Warden · Ember Guard",
  subtitle: "Ember Guard",
  variant: "alternate"
});

const oracle: DeckBuilderCard = card({
  id: "oracle-standard",
  canonicalCardId: "oracle",
  name: "Tide Oracle",
  localizedName: "Tide Oracle",
  fullName: "Tide Oracle · Tidecaller",
  subtitle: "Tidecaller",
  cardType: "Unit",
  domains: ["water"],
  tags: ["ocean-magic"],
  setCode: "SET-002",
  cardNumber: "SET-002-001"
});

describe("DeckBuilder", () => {
  it("searches card names, rules identities, tags, and set numbers", () => {
    const catalog = [standard, alternate, oracle];
    const search = (query: string) => buildDeckGroups(catalog, new Map(), new Map(), query);
    expect(search("flame")).toHaveLength(1);
    expect(search("RB-001")).toHaveLength(1);
    expect(search("magic")).toHaveLength(1);
    expect(search("SET-001-004")).toHaveLength(1);
    expect(search("flame-alternate")[0]?.cards).toHaveLength(2);
    expect(search("oracle")[0]?.canonicalCardId).toBe("oracle");
  });

  it("adds entries by printing id and shares the canonical limit", () => {
    const limits = new Map([["flame", 2]]);
    let deck = addCard([], [standard, alternate], "flame-standard", limits);
    deck = addCard(deck, [standard, alternate], "flame-alternate", limits);
    const blocked = addCard(deck, [standard, alternate], "flame-alternate", limits);

    expect(deck).toEqual([
      { cardId: "flame-standard", quantity: 1 },
      { cardId: "flame-alternate", quantity: 1 }
    ]);
    expect(blocked).toBe(deck);
  });

  it("removes only the selected printing", () => {
    const deck: DeckBuilderEntry[] = [
      { cardId: "flame-standard", quantity: 2 },
      { cardId: "flame-alternate", quantity: 1 }
    ];

    const next = removeCard(deck, "flame-alternate");

    expect(next).toEqual([
      { cardId: "flame-standard", quantity: 2 }
    ]);
  });

  it("groups printings by canonical identity and trusts only server limits", () => {
    const limits = new Map([["flame", 3]]);
    const groups = buildDeckGroups(
      [standard, alternate, oracle],
      new Map([
        ["flame-standard", 2],
        ["flame-alternate", 1]
      ]),
      limits,
      ""
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      canonicalCardId: "flame",
      quantity: 3,
      limit: 3
    });
    expect(groups[1]).toMatchObject({
      canonicalCardId: "oracle",
      limit: null
    });

    expect(addCard([], [standard, alternate], "flame-standard", new Map())).toHaveLength(0);
  });

  it("blocks every printing add button once the shared canonical limit is reached", () => {
    expect(isAddDisabled(2, 2)).toBe(true);
    expect(isAddDisabled(3, 2)).toBe(true);
    expect(isAddDisabled(1, 2)).toBe(false);
    expect(isAddDisabled(2, null)).toBe(true);
  });

  it("blocks unavailable printings while released printings can still be added", () => {
    const released: DeckBuilderCard = card({
      id: "flame-standard",
      variant: "standard"
    });
    const releasedAlternate: DeckBuilderCard = card({
      id: "flame-alternate",
      variant: "alternate"
    });
    const unreleased = card({
      id: "flame-unreleased",
      variant: "standard",
      setCode: "RAD",
      cardNumber: "RAD-001-167",
      available: false,
      availabilityReason: "previewNotReleased"
    });
    const catalog = [released, releasedAlternate, unreleased];
    const limits = new Map([["flame", 3]]);

    let deck = addCard([], catalog, "flame-standard", limits);
    deck = addCard(deck, catalog, "flame-alternate", limits);
    const blockedUnreleased = addCard(deck, catalog, "flame-unreleased", limits);
    const blockedWhenUnreleasedIsFirst = addCard(
      [],
      catalog,
      "flame-unreleased",
      limits
    );

    expect(deck).toEqual([
      { cardId: "flame-standard", quantity: 1 },
      { cardId: "flame-alternate", quantity: 1 }
    ]);
    expect(blockedUnreleased).toBe(deck);
    expect(blockedWhenUnreleasedIsFirst).toEqual([]);
  });

  it("blocks a banned printing without zeroing the shared canonical limit", () => {
    const banned = card({
      id: "flame-banned",
      banned: true,
      available: true,
      availabilityReason: "banned"
    });
    const catalog = [standard, alternate, banned];
    const limits = new Map([["flame", 3]]);

    const deck = addCard([], catalog, "flame-standard", limits);
    const blockedBanned = addCard(deck, catalog, "flame-banned", limits);
    const releasedAlternate = addCard(deck, catalog, "flame-alternate", limits);

    expect(isCardAvailable(banned)).toBe(false);
    expect(isCardAvailable(standard)).toBe(true);
    expect(blockedBanned).toBe(deck);
    expect(releasedAlternate).toEqual([
      { cardId: "flame-standard", quantity: 1 },
      { cardId: "flame-alternate", quantity: 1 }
    ]);
  });

  it("keeps localized full titles with subtitles and picks a representative thumbnail", () => {
    const localized: DeckBuilderCard = card({
      id: "flame-standard",
      localizedName: "烈焰守卫",
      localizedSubtitle: "余烬卫士",
      imageUrl: "https://example.com/standard.jpg"
    });
    const alternateWithImage: DeckBuilderCard = card({
      id: "flame-alternate",
      variant: "alternate",
      imageUrl: "https://example.com/alternate.jpg"
    });

    const groups = buildDeckGroups(
      [localized, alternateWithImage],
      new Map([["flame-alternate", 1]]),
      new Map([["flame", 3]]),
      ""
    );

    expect(groups[0]).toMatchObject({
      title: "烈焰守卫 · 余烬卫士",
      subtitle: "余烬卫士",
      representativeImageUrl: "https://example.com/alternate.jpg"
    });
  });
});

function card(overrides: Partial<DeckBuilderCard> = {}): DeckBuilderCard {
  return {
    id: `${overrides.canonicalCardId ?? "flame"}-standard`,
    canonicalCardId: "flame",
    name: "Flame Warden",
    subtitle: "Ember Guard",
    fullName: "Flame Warden · Ember Guard",
    localizedName: "Flame Warden",
    localizedSubtitle: "Ember Guard",
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

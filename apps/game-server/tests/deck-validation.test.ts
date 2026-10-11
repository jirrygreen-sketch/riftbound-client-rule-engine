import { describe, expect, it } from "vitest";
import {
  PARTIAL_DECK_RULES,
  validateDeck,
  type DeckCardDefinition,
  type DeckCardEntry,
  type DeckSubmission
} from "../src/deck-validation.js";

const cards: readonly DeckCardDefinition[] = [
  {
    id: "card.alpha.base",
    canonicalCardId: "card.alpha",
    name: "Alpha",
    allowedZones: ["mainDeck", "sideboard", "battlefields"]
  },
  {
    id: "card.alpha.alt-art",
    canonicalCardId: "card.alpha",
    name: "Alpha",
    allowedZones: ["mainDeck", "sideboard", "battlefields"]
  },
  {
    id: "card.alpha.reprint",
    canonicalCardId: "card.alpha",
    name: "Alpha",
    allowedZones: ["mainDeck", "sideboard", "battlefields"]
  },
  {
    id: "card.beta",
    canonicalCardId: "card.beta",
    name: "Beta",
    allowedZones: ["mainDeck", "sideboard", "battlefields"]
  },
  {
    id: "card.chosen-champion",
    canonicalCardId: "card.chosen-champion",
    name: "Chosen Champion",
    allowedZones: ["mainDeck", "champion", "sideboard"]
  },
  {
    id: "card.battlefield",
    canonicalCardId: "card.battlefield",
    name: "Battlefield",
    allowedZones: ["battlefields"]
  },
  {
    id: "card.basic-rune",
    canonicalCardId: "card.basic-rune",
    name: "Basic Rune",
    allowedZones: ["runes"]
  },
  {
    id: "card.advanced-rune",
    canonicalCardId: "card.advanced-rune",
    name: "Advanced Rune",
    allowedZones: ["runes"]
  },
  {
    id: "card.legend",
    canonicalCardId: "card.legend",
    name: "Legend",
    allowedZones: ["legend"]
  },
  ...Array.from({ length: 12 }, (_, index): DeckCardDefinition => ({
    id: `card.filler-${index}`,
    canonicalCardId: `card.filler-${index}`,
    name: `Filler ${index}`,
    allowedZones: ["mainDeck", "sideboard"]
  }))
];

function deck(
  zones: Partial<Record<keyof DeckSubmission, readonly DeckCardEntry[]>>
): DeckSubmission {
  return zones;
}

function makePartialValidDeck(): DeckSubmission {
  return {
    mainDeck: [
      { cardId: "card.alpha.base", quantity: 2 },
      { cardId: "card.alpha.alt-art", quantity: 1 },
      ...Array.from({ length: 12 }, (_, index): DeckCardEntry => ({
        cardId: `card.filler-${index}`,
        quantity: 3
      }))
    ],
    runes: [
      { cardId: "card.basic-rune", quantity: 10 },
      { cardId: "card.advanced-rune", quantity: 2 }
    ],
    legend: [{ cardId: "card.legend", quantity: 1 }],
    champion: [{ cardId: "card.chosen-champion", quantity: 1 }],
    battlefields: [
      { cardId: "card.battlefield", quantity: 1 },
      { cardId: "card.alpha.base", quantity: 1 },
      { cardId: "card.beta", quantity: 1 }
    ],
    sideboard: [
      { cardId: "card.beta", quantity: 1 },
      { cardId: "card.alpha.reprint", quantity: 1 },
      { cardId: "card.filler-0", quantity: 1 },
      { cardId: "card.filler-1", quantity: 1 },
      { cardId: "card.filler-2", quantity: 1 },
      { cardId: "card.filler-3", quantity: 1 },
      { cardId: "card.filler-4", quantity: 1 },
      { cardId: "card.filler-5", quantity: 1 },
      { cardId: "card.filler-6", quantity: 1 },
      { cardId: "card.filler-7", quantity: 1 }
    ]
  };
}

describe("validateDeck", () => {
  it("rejects unknown deck keys instead of treating them as an empty deck", () => {
    const result = validateDeck(
      { mainDeck: [], extraZone: [] } as unknown as DeckSubmission,
      cards
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("invalid_deck");
    expect(result.issues[0]?.unknownFields).toEqual(["extraZone"]);
  });

  it("rejects entry fields, including client-supplied canonicalCardId", () => {
    const result = validateDeck({
      mainDeck: [
        {
          cardId: "card.alpha.base",
          quantity: 1,
          canonicalCardId: "card.fake"
        } as unknown as DeckCardEntry
      ]
    }, cards);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: "invalid_entry",
      zone: "mainDeck",
      entryIndex: 0,
      unknownFields: ["canonicalCardId"]
    });
  });

  it("does not let a limited policy raise the configured default limit", () => {
    const result = validateDeck(
      deck({ mainDeck: [{ cardId: "card.beta", quantity: 4 }] }),
      cards,
      {
        cardPolicies: {
          "card.beta": { type: "limited", maxCopies: 4 }
        }
      }
    );

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: "copy_limit_exceeded",
      canonicalCardId: "card.beta"
    });
    expect(result.issues[0]?.message).toContain("the limit is 3");
  });

  it("uses min(limited maxCopies, configured canonical limit)", () => {
    const result = validateDeck(
      deck({ mainDeck: [{ cardId: "card.beta", quantity: 4 }] }),
      cards,
      {
        defaultMaxCopiesPerCanonical: 5,
        cardPolicies: {
          "card.beta": { type: "limited", maxCopies: 4 }
        }
      }
    );

    expect(result.valid).toBe(true);
    expect(result.canonicalCardCounts["card.beta"]).toBe(4);
  });

  it("saturates counts and reports overflow before unsafe accumulation", () => {
    const result = validateDeck(deck({
      mainDeck: [
        { cardId: "card.alpha.base", quantity: Number.MAX_SAFE_INTEGER },
        { cardId: "card.beta", quantity: 1 }
      ]
    }), cards);

    expect(result.valid).toBe(false);
    expect(result.overflow).toBe(true);
    expect(result.totalCards).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.zoneCounts.mainDeck).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.issues.map(error => error.code)).toEqual(["count_overflow"]);
  });

  it("does not apply the default 3-copy limit to runes", () => {
    const result = validateDeck(deck({
      runes: [{ cardId: "card.basic-rune", quantity: 4 }]
    }), cards);

    expect(result.valid).toBe(true);
    expect(result.totalCards).toBe(4);
  });

  it("accepts the current structural fixture rules", () => {
    const result = validateDeck(
      makePartialValidDeck(),
      cards,
      { ...PARTIAL_DECK_RULES, copyRules: [] }
    );

    expect(result).toMatchObject({
      valid: true,
      overflow: false,
      totalCards: 66,
      zoneCounts: {
        mainDeck: 39,
        runes: 12,
        legend: 1,
        champion: 1,
        battlefields: 3,
        sideboard: 10
      },
      issues: []
    });
  });

  it("counts mainDeck, champion, and sideboard identities together", () => {
    const result = validateDeck(deck({
      mainDeck: [{ cardId: "card.chosen-champion", quantity: 2 }],
      champion: [{ cardId: "card.chosen-champion", quantity: 1 }],
      sideboard: [{ cardId: "card.chosen-champion", quantity: 1 }]
    }), cards, {
      copyRules: [{ zones: ["mainDeck", "champion", "sideboard"] }]
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: "copy_limit_exceeded",
      canonicalCardId: "card.chosen-champion",
      copyRuleIndex: 0
    });
  });

  it("requires mainDeck plus chosen champion to total forty", () => {
    const validDeck = makePartialValidDeck();
    const result = validateDeck({
      ...validDeck,
      mainDeck: validDeck.mainDeck?.slice(0, 1)
    }, cards, PARTIAL_DECK_RULES);

    expect(result.valid).toBe(false);
    expect(result.issues.map(error => error.code)).toContain("deck_size_out_of_range");
  });

  it("allows the structural rune count without injecting a copy policy", () => {
    const result = validateDeck(deck({
      runes: [{ cardId: "card.basic-rune", quantity: 12 }]
    }), cards, {
      ...PARTIAL_DECK_RULES,
      copyRules: [],
      sizeRules: { runes: { maximum: 12 } },
      sizeGroups: undefined
    });

    expect(result.valid).toBe(true);
    expect(result.zoneCounts.runes).toBe(12);
  });

  it("rejects a banned card in a zone without a copy rule", () => {
    const result = validateDeck(deck({
      runes: [{ cardId: "card.basic-rune", quantity: 1 }]
    }), cards, {
      cardPolicies: {
        "card.basic-rune": { type: "banned" }
      },
      copyRules: [{ zones: ["mainDeck"] }]
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "banned_card",
      canonicalCardId: "card.basic-rune"
    });
  });

  it("allows three distinct battlefields but rejects duplicate identities", () => {
    const rules = {
      ...PARTIAL_DECK_RULES,
      sizeRules: { battlefields: { minimum: 3, maximum: 3 } },
      sizeGroups: undefined
    };
    const valid = validateDeck(deck({
      battlefields: [
        { cardId: "card.battlefield", quantity: 1 },
        { cardId: "card.alpha.base", quantity: 1 },
        { cardId: "card.beta", quantity: 1 }
      ]
    }), cards, rules);
    const duplicate = validateDeck(deck({
      battlefields: [
        { cardId: "card.alpha.base", quantity: 2 },
        { cardId: "card.beta", quantity: 1 }
      ]
    }), cards, rules);

    expect(valid.valid).toBe(true);
    expect(duplicate.valid).toBe(false);
    expect(duplicate.issues.map(error => error.code)).toContain(
      "zone_uniqueness_violated"
    );
  });

  it("counts normal, alternate-art, and reprint cards as one canonical card", () => {
    const result = validateDeck(deck({
      mainDeck: [
        { cardId: "card.alpha.base", quantity: 2 },
        { cardId: "card.alpha.alt-art", quantity: 2 }
      ]
    }), cards);

    expect(result.valid).toBe(false);
    expect(result.totalCards).toBe(4);
    expect(result.canonicalCardCounts["card.alpha"]).toBe(4);
    expect(result.issues[0]).toMatchObject({
      code: "copy_limit_exceeded",
      canonicalCardId: "card.alpha"
    });
  });

  it("merges duplicate entries before applying copy limits", () => {
    const result = validateDeck(deck({
      mainDeck: [
        { cardId: "card.alpha.base", quantity: 1 },
        { cardId: "card.alpha.base", quantity: 2 }
      ]
    }), cards);

    expect(result.valid).toBe(true);
    expect(result.totalCards).toBe(3);
    expect(result.canonicalCardCounts["card.alpha"]).toBe(3);
  });

  it("rejects banned cards and applies restricted as one copy", () => {
    const banned = validateDeck(deck({
      mainDeck: [{ cardId: "card.alpha.base", quantity: 1 }]
    }), cards, {
      cardPolicies: { "card.alpha": { type: "banned" } }
    });
    const restricted = validateDeck(deck({
      mainDeck: [{ cardId: "card.beta", quantity: 2 }]
    }), cards, {
      cardPolicies: { "card.beta": { type: "restricted" } }
    });

    expect(banned.issues[0]?.code).toBe("banned_card");
    expect(restricted.issues[0]?.code).toBe("copy_limit_exceeded");
    expect(restricted.issues[0]?.message).toContain("the limit is 1");
  });

  it("counts unknown cards toward totals and rejects bad zone placement", () => {
    const result = validateDeck({
      mainDeck: [{ cardId: "card.unknown", quantity: 2 }],
      battlefields: [{ cardId: "card.legend", quantity: 1 }]
    }, cards, { totalCards: { minimum: 2 } });

    expect(result.valid).toBe(false);
    expect(result.totalCards).toBe(3);
    expect(result.zoneCounts.battlefields).toBe(1);
    expect(result.issues.map(error => error.code)).toEqual([
      "unknown_card",
      "card_not_allowed_in_zone"
    ]);
  });

  it("never applies the default copy limit to runes without an explicit rule", () => {
    const result = validateDeck(deck({
      runes: [
        { cardId: "card.basic-rune", quantity: 10 },
        { cardId: "card.advanced-rune", quantity: 2 }
      ]
    }), cards, PARTIAL_DECK_RULES);

    expect(result.issues.map(error => error.code)).not.toContain(
      "copy_limit_exceeded"
    );
    expect(result.zoneCounts.runes).toBe(12);
  });
});

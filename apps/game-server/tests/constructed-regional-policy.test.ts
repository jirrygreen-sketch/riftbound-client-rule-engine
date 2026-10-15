/**
 * Regional Constructed validator wrapper — focused tests.
 *
 * SYNTHETIC FIXTURES — NOT AN OFFICIAL SOURCE.
 * The region codes, set codes, release dates and source URLs below are
 * placeholder fixture values invented for these tests. They are NOT the real
 * regional release matrix and must not be cited as an official availability
 * claim. The wrapper under test consumes the same caller-supplied DATA and
 * adds no authority of its own; the authoritative release dates must come from
 * a verified official source supplied by the parent task.
 */
import { describe, expect, it } from "vitest";
import {
  createConstructedRules,
  validateConstructedDeck,
  type ConstructedPolicyCard,
  type ConstructedRules
} from "../src/constructed-policy.js";
import {
  RegionalConstructedContextError,
  REGIONAL_CONSTRUCTED_REASON,
  validateRegionalConstructedDeck,
  type RegionalConstructedContext
} from "../src/constructed-regional-policy.js";
import {
  REGIONAL_AVAILABILITY_REASON,
  type RegionalSchedule
} from "../src/constructed-regional-availability.js";
import type {
  DeckCardDefinition,
  DeckSubmission,
  DeckZone
} from "../src/deck-validation.js";

// Synthetic fixture identifiers. `ogn` here is only a placeholder set label.
const REGION = "FIX-REGION";
const OTHER_REGION = "FIX-OTHER";
const SET = "ogn";
const SOURCE_URL = "https://fixture.invalid/not-an-official-source";
const LEGEND_CHAMPION_TAG = "Fixturechamp";

function policyCard(
  values: Partial<ConstructedPolicyCard> & {
    readonly canonicalCardId: string;
    readonly fullName: string;
  }
): ConstructedPolicyCard {
  return {
    id: values.id ?? `${values.canonicalCardId}.base`,
    setCode: SET,
    cardType: "Unit",
    ...values
  };
}

const cards: readonly ConstructedPolicyCard[] = [
  ...Array.from({ length: 14 }, (_, index): ConstructedPolicyCard => policyCard({
    canonicalCardId: `card.filler-${index}`,
    fullName: `Neutral Filler ${index}`,
    domains: ["Fury"],
    tags: []
  })),
  policyCard({
    canonicalCardId: "card.rune",
    fullName: "Fixture Rune",
    cardType: "Rune",
    domains: ["Fury"],
    tags: ["Basic"]
  }),
  ...Array.from({ length: 3 }, (_, index): ConstructedPolicyCard => policyCard({
    canonicalCardId: `card.battlefield-${index}`,
    fullName: `Fixture Battlefield ${index}`,
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  })),
  policyCard({
    canonicalCardId: "card.champion",
    fullName: "Fixture Champion",
    name: LEGEND_CHAMPION_TAG,
    domains: ["Chaos"],
    tags: [LEGEND_CHAMPION_TAG, "Champion"]
  }),
  policyCard({
    canonicalCardId: "card.legend",
    fullName: "Fixture Legend",
    cardType: "Legend",
    domains: ["Fury", "Chaos"],
    tags: [LEGEND_CHAMPION_TAG]
  }),
  policyCard({
    id: "card.preview.base",
    canonicalCardId: "card.preview",
    fullName: "Fixture Radiance Preview",
    setCode: "rad",
    domains: ["Fury"],
    tags: []
  })
];

const constructed: ConstructedRules = createConstructedRules(cards, "standard", {
  asOf: "2026-10-11T00:00:00.000Z"
});

const validationCards: readonly DeckCardDefinition[] = cards.map(item => ({
  id: item.id,
  canonicalCardId: item.canonicalCardId,
  name: item.fullName
}));

/** Trusted fixture `cardId -> setCode` map built from the fixture catalog. */
function printingSetCodes(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of cards) map[item.id] = item.setCode;
  return map;
}

function legalDeck(): DeckSubmission {
  return {
    mainDeck: Array.from({ length: 13 }, (_, index) => ({
      cardId: `card.filler-${index}.base`,
      quantity: 3
    })),
    runes: [{ cardId: "card.rune.base", quantity: 12 }],
    legend: [{ cardId: "card.legend.base", quantity: 1 }],
    champion: [{ cardId: "card.champion.base", quantity: 1 }],
    battlefields: Array.from({ length: 3 }, (_, index) => ({
      cardId: `card.battlefield-${index}.base`,
      quantity: 1
    })),
    sideboard: [{ cardId: "card.filler-13.base", quantity: 1 }]
  };
}

function scheduleWith(
  releaseDate: string,
  regionCode: string = REGION
): RegionalSchedule {
  return [
    {
      regionCode,
      setCode: SET,
      releaseDate,
      sourceUrl: SOURCE_URL,
      status: "confirmed"
    }
  ];
}

function context(
  overrides: Partial<RegionalConstructedContext> = {}
): RegionalConstructedContext {
  return {
    regionCode: REGION,
    eventDate: "2026-06-01",
    scheduleVersion: "fixture-schedule-v0",
    schedule: scheduleWith("2026-01-01"),
    printingSetCodes: printingSetCodes(),
    ...overrides
  };
}

describe("validateRegionalConstructedDeck", () => {
  it("keeps a structurally legal deck valid when every printing is regionally available", () => {
    const deck = legalDeck();
    const result = validateRegionalConstructedDeck(
      deck,
      validationCards,
      constructed,
      context()
    );

    expect(result.valid).toBe(true);
    expect(result.regionalIssues).toEqual([]);
    expect(result.regionContext).toEqual({
      regionCode: REGION,
      eventDate: "2026-06-01",
      scheduleVersion: "fixture-schedule-v0"
    });
    // The base Constructed result is preserved unchanged.
    const base = validateConstructedDeck(deck, validationCards, constructed);
    expect(result.valid).toBe(base.valid);
    expect(result.printingIssues).toEqual(base.printingIssues);
    expect(result.issues).toEqual(base.issues);
    expect(result.totalCards).toBe(base.totalCards);
    expect(result.overflow).toBe(base.overflow);
    expect(result.zoneCounts).toEqual(base.zoneCounts);
    expect(result.canonicalCardCounts).toEqual(base.canonicalCardCounts);
  });

  it("checks every zone, including the six-zone sweep, against the region", () => {
    const result = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ schedule: scheduleWith("2026-12-01") })
    );

    const zones = new Set<DeckZone>(result.regionalIssues.map(issue => issue.zone));
    expect([...zones].sort()).toEqual(
      ["battlefields", "champion", "legend", "mainDeck", "runes", "sideboard"]
    );
    expect(result.valid).toBe(false);
    for (const issue of result.regionalIssues) {
      expect(issue.status).toBe("unreleased");
      expect(issue.releaseDate).toBe("2026-12-01");
      expect(issue.sourceUrl).toBe(SOURCE_URL);
      expect(issue.reason).toBeNull();
    }
  });

  it("reports an unreleased cell relative to the pinned event date, never the clock", () => {
    const before = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ eventDate: "2025-12-31", schedule: scheduleWith("2026-01-01") })
    );
    const onDay = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ eventDate: "2026-01-01", schedule: scheduleWith("2026-01-01") })
    );

    expect(before.regionalIssues[0]).toMatchObject({
      status: "unreleased",
      releaseDate: "2026-01-01"
    });
    expect(before.valid).toBe(false);
    expect(onDay.regionalIssues).toEqual([]);
    expect(onDay.valid).toBe(true);
  });

  it("fails closed with an unknown regional issue when a card id has no trusted printing mapping", () => {
    const map = printingSetCodes();
    delete map["card.champion.base"];
    const result = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ printingSetCodes: map })
    );

    expect(result.valid).toBe(false);
    expect(result.regionalIssues).toEqual([
      {
        cardId: "card.champion.base",
        zone: "champion",
        status: "unknown",
        releaseDate: null,
        sourceUrl: null,
        reason: REGIONAL_CONSTRUCTED_REASON.missingPrintingSetCode
      }
    ]);
  });

  it("fails closed when the query region is absent from the schedule", () => {
    const result = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ schedule: scheduleWith("2026-01-01", OTHER_REGION) })
    );

    expect(result.valid).toBe(false);
    expect(result.regionalIssues.length).toBeGreaterThan(0);
    for (const issue of result.regionalIssues) {
      expect(issue.status).toBe("unknown");
      expect(issue.reason).toBe(REGIONAL_AVAILABILITY_REASON.missingRegionEntry);
    }
  });

  it("fails closed when a schedule cell is duplicated", () => {
    const duplicate: RegionalSchedule = [
      ...scheduleWith("2026-01-01"),
      ...scheduleWith("2026-01-01")
    ];
    const result = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ schedule: duplicate })
    );

    expect(result.valid).toBe(false);
    expect(result.regionalIssues[0]).toMatchObject({
      status: "unknown",
      reason: REGIONAL_AVAILABILITY_REASON.duplicateEntry
    });
  });

  it("fails closed on an unconfirmed / conflicting schedule cell", () => {
    const unconfirmed: RegionalSchedule = [
      { regionCode: REGION, setCode: SET, releaseDate: "2026-01-01", sourceUrl: SOURCE_URL, status: "unknown" }
    ];
    const unconfirmedResult = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ schedule: unconfirmed })
    );
    expect(unconfirmedResult.valid).toBe(false);
    expect(unconfirmedResult.regionalIssues[0]?.reason).toBe(
      REGIONAL_AVAILABILITY_REASON.unconfirmedEntry
    );

    const conflicting: RegionalSchedule = [
      ...scheduleWith("2026-01-01"),
      { regionCode: REGION, setCode: SET, releaseDate: "2026-02-01", sourceUrl: SOURCE_URL, status: "confirmed" }
    ];
    const conflictingResult = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ schedule: conflicting })
    );
    expect(conflictingResult.valid).toBe(false);
    expect(conflictingResult.regionalIssues[0]?.reason).toBe(
      REGIONAL_AVAILABILITY_REASON.conflictingEntry
    );
  });

  it("keeps the base Constructed checks on top of the regional check", () => {
    // (a) A structural rule (undersized main deck) must still reject a deck
    // even when every printing is region-available.
    const undersized: DeckSubmission = {
      ...legalDeck(),
      mainDeck: Array.from({ length: 12 }, (_, index) => ({
        cardId: `card.filler-${index}.base`,
        quantity: 3
      }))
    };
    const undersizedResult = validateRegionalConstructedDeck(
      undersized,
      validationCards,
      constructed,
      context()
    );
    const undersizedBase = validateConstructedDeck(
      undersized,
      validationCards,
      constructed
    );
    expect(undersizedResult.regionalIssues).toEqual([]);
    expect(undersizedBase.valid).toBe(false);
    expect(undersizedResult.valid).toBe(false);
    expect(undersizedResult.issues.map(issue => issue.code)).toContain(
      "deck_size_out_of_range"
    );

    // (b) The GLOBAL unreleased-printing check is NOT deleted: a Radiance
    // preview printing stays flagged even if a (synthetic) regional schedule
    // claims that set is released. The two constraints are dual/conservative.
    const deckWithPreview: DeckSubmission = {
      ...undersized,
      mainDeck: [
        ...Array.from({ length: 12 }, (_, index) => ({
          cardId: `card.filler-${index}.base`,
          quantity: 3
        })),
        { cardId: "card.preview.base", quantity: 1 }
      ]
    };
    const previewSchedule: RegionalSchedule = [
      { regionCode: REGION, setCode: SET, releaseDate: "2026-01-01", sourceUrl: SOURCE_URL, status: "confirmed" },
      { regionCode: REGION, setCode: "rad", releaseDate: "2026-01-01", sourceUrl: SOURCE_URL, status: "confirmed" }
    ];
    const previewResult = validateRegionalConstructedDeck(
      deckWithPreview,
      validationCards,
      constructed,
      context({ schedule: previewSchedule })
    );
    const previewBase = validateConstructedDeck(
      deckWithPreview,
      validationCards,
      constructed
    );
    // Region says the rad cell is available (no unreleased/unknown regional issue)...
    expect(
      previewResult.regionalIssues.some(issue => issue.cardId === "card.preview.base")
    ).toBe(false);
    // ...but the base global printing check still fails the deck closed.
    expect(previewBase.printingIssues.map(issue => issue.cardId)).toContain(
      "card.preview.base"
    );
    expect(previewResult.valid).toBe(false);
    expect(previewResult.printingIssues.map(issue => issue.cardId)).toContain(
      "card.preview.base"
    );
  });

  it("does not mutate the deck, validation cards, or the context inputs", () => {
    const deck = legalDeck();
    const deckSnapshot = structuredClone(deck);
    const cardsSnapshot = structuredClone(validationCards);
    const ctx = context();
    const ctxSnapshot = structuredClone(ctx);

    validateRegionalConstructedDeck(deck, validationCards, constructed, ctx);

    expect(deck).toEqual(deckSnapshot);
    expect(validationCards).toEqual(cardsSnapshot);
    expect(ctx).toEqual(ctxSnapshot);
  });

  it("rejects a missing or malformed regional context instead of guessing", () => {
    const call = (bad: unknown): unknown =>
      validateRegionalConstructedDeck(
        legalDeck(),
        validationCards,
        constructed,
        bad as RegionalConstructedContext
      );

    expect(() => call(undefined)).toThrow(RegionalConstructedContextError);
    expect(() => call(null)).toThrow(RegionalConstructedContextError);
    expect(() => call(context({ regionCode: "" }))).toThrow(RegionalConstructedContextError);
    expect(() => call(context({ scheduleVersion: "" }))).toThrow(RegionalConstructedContextError);
    // Impossible and wrongly-shaped calendar dates.
    expect(() => call(context({ eventDate: "2026-02-30" }))).toThrow(RegionalConstructedContextError);
    expect(() => call(context({ eventDate: "2026-13-01" }))).toThrow(RegionalConstructedContextError);
    expect(() => call(context({ eventDate: "2026/06/01" }))).toThrow(RegionalConstructedContextError);
    expect(() => call(context({ eventDate: "20260601" }))).toThrow(RegionalConstructedContextError);
    // Schedule must be an array; printing map must be a trusted record.
    expect(() => call(context({ schedule: undefined as unknown as RegionalSchedule })))
      .toThrow(RegionalConstructedContextError);
    expect(() => call(context({ printingSetCodes: undefined as unknown as Record<string, string> })))
      .toThrow(RegionalConstructedContextError);
  });

  it("does not write a fabricated set code when the mapping is absent", () => {
    // Deleting one id must not fall back to another card's set code.
    const map = printingSetCodes();
    delete map["card.filler-0.base"];
    const result = validateRegionalConstructedDeck(
      legalDeck(),
      validationCards,
      constructed,
      context({ printingSetCodes: map })
    );

    const issue = result.regionalIssues.find(
      entry => entry.cardId === "card.filler-0.base"
    );
    expect(issue).toMatchObject({
      zone: "mainDeck",
      status: "unknown",
      reason: REGIONAL_CONSTRUCTED_REASON.missingPrintingSetCode
    });
    expect(result.valid).toBe(false);
  });
});

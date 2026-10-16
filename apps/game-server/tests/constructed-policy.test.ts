import { describe, expect, it, vi } from "vitest";
import {
  createConstructedRules,
  getConstructedCardPolicy,
  getConstructedPrintingPolicy,
  validateConstructedDeck,
  type ConstructedPolicyCard
} from "../src/constructed-policy.js";
import {
  validateDeck,
  type DeckCardDefinition,
  type DeckSubmission
} from "../src/deck-validation.js";

function card(
  values: Partial<ConstructedPolicyCard> & {
    readonly canonicalCardId: string;
    readonly fullName: string;
  }
): ConstructedPolicyCard {
  return {
    id: values.id ?? `${values.canonicalCardId}.base`,
    setCode: "ogn",
    cardType: "Unit",
    ...values
  };
}

const banCardTypes: Readonly<Record<string, string>> = {
  "card.called-shot": "Spell",
  "card.ekko": "Unit",
  "card.draven": "Unit",
  "card.fight-or-flight": "Spell",
  "card.scrapheap": "Gear",
  "card.stealthy-pursuer": "Unit",
  "card.stacked-deck": "Spell",
  "card.arena": "Battlefield",
  "card.aspirants-climb": "Battlefield",
  "card.dreaming-tree": "Battlefield",
  "card.obelisk": "Battlefield",
  "card.reavers-row": "Battlefield"
};

const officialBans: readonly {
  readonly officialName: string;
  readonly snapshotName: string;
  readonly canonicalCardId: string;
}[] = [
  { officialName: "Called Shot", snapshotName: "Called Shot", canonicalCardId: "card.called-shot" },
  { officialName: "Ekko, Recurrent", snapshotName: "Ekko, Recurrent", canonicalCardId: "card.ekko" },
  { officialName: "Draven, Vanquisher", snapshotName: "Draven, Vanquisher", canonicalCardId: "card.draven" },
  { officialName: "Fight or Flight", snapshotName: "Fight or Flight", canonicalCardId: "card.fight-or-flight" },
  { officialName: "Scrapheap", snapshotName: "Scrapheap", canonicalCardId: "card.scrapheap" },
  { officialName: "Stealthy Pursuer", snapshotName: "Stealthy Pursuer", canonicalCardId: "card.stealthy-pursuer" },
  { officialName: "Stacked Deck", snapshotName: "Stacked Deck", canonicalCardId: "card.stacked-deck" },
  { officialName: "The Arena’s Greatest", snapshotName: "The Arena’s Greatest", canonicalCardId: "card.arena" },
  { officialName: "Aspirant’s Climb", snapshotName: "Aspirant’s Climb", canonicalCardId: "card.aspirants-climb" },
  { officialName: "Dreaming Tree", snapshotName: "The Dreaming Tree", canonicalCardId: "card.dreaming-tree" },
  { officialName: "Obelisk of Power", snapshotName: "Obelisk of Power", canonicalCardId: "card.obelisk" },
  { officialName: "Reaver’s Row", snapshotName: "Reaver’s Row", canonicalCardId: "card.reavers-row" }
];

// Domain Identity metadata is part of the checked input: the legend declares
// the identity, and every card that declares domains must stay inside it.
const LEGEND_IDENTITY_DOMAINS = ["Fury", "Chaos"] as const;
const LEGEND_CHAMPION_TAG = "Fixturechamp";

const legalCards: readonly ConstructedPolicyCard[] = [
  ...Array.from({ length: 14 }, (_, index): ConstructedPolicyCard => card({
    canonicalCardId: `card.filler-${index}`,
    fullName: `Neutral Filler ${index}`,
    cardType: "Unit",
    domains: ["Fury"],
    tags: []
  })),
  card({
    canonicalCardId: "card.rune",
    fullName: "Fixture Rune",
    cardType: "Rune",
    domains: ["Fury"],
    tags: ["Basic"]
  }),
  card({
    id: "card.rune.alternate",
    canonicalCardId: "card.rune",
    fullName: "Fixture Rune",
    cardType: "Rune",
    setCode: "ogn",
    domains: ["Fury"],
    tags: ["Basic"]
  }),
  ...Array.from({ length: 3 }, (_, index): ConstructedPolicyCard => card({
    canonicalCardId: `card.battlefield-${index}`,
    fullName: `Fixture Battlefield ${index}`,
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  })),
  card({
    canonicalCardId: "card.champion",
    fullName: "Fixture Champion",
    cardType: "Unit",
    domains: ["Chaos"],
    tags: [LEGEND_CHAMPION_TAG, "Champion"]
  }),
  card({
    canonicalCardId: "card.legend",
    fullName: "Fixture Legend",
    cardType: "Legend",
    domains: [...LEGEND_IDENTITY_DOMAINS],
    tags: [LEGEND_CHAMPION_TAG]
  })
];

const cards: readonly ConstructedPolicyCard[] = [
  ...officialBans.map(ban => card({
    canonicalCardId: ban.canonicalCardId,
    fullName: ban.snapshotName,
    cardType: banCardTypes[ban.canonicalCardId] ?? "Unit"
  })),
  ...legalCards,
  card({
    canonicalCardId: "card.radiance",
    fullName: "Radiance Preview",
    setCode: "rad",
    domains: ["Fury"],
    tags: []
  }),
  card({
    id: "card.reprint.ogn",
    canonicalCardId: "card.reprint",
    fullName: "Released Reprint",
    setCode: "ogn",
    domains: ["Fury"],
    tags: []
  }),
  card({
    id: "card.reprint.rad",
    canonicalCardId: "card.reprint",
    fullName: "Released Reprint",
    setCode: "rad",
    domains: ["Fury"],
    tags: []
  }),
  card({
    id: "card.proving-ground.base",
    canonicalCardId: "card.proving-ground",
    fullName: "Proving Ground Card",
    setCode: "ogs",
    domains: ["Fury"],
    tags: []
  }),
  card({
    canonicalCardId: "card.eternal",
    fullName: "Eternal Fixture",
    setCode: "eternal",
    domains: ["Fury"],
    tags: []
  })
];

const constructed = createConstructedRules(cards, "standard", {
  asOf: "2026-10-11T00:00:00.000Z"
});

const validationCards: readonly DeckCardDefinition[] = cards.map(item => ({
  id: item.id,
  canonicalCardId: item.canonicalCardId,
  name: item.fullName
}));

function legalDeck(): DeckSubmission {
  return {
    mainDeck: [
      ...Array.from({ length: 13 }, (_, index) => ({
        cardId: `card.filler-${index}.base`,
        quantity: 3
      }))
    ],
    runes: [
      { cardId: "card.rune.base", quantity: 11 },
      { cardId: "card.rune.alternate", quantity: 1 }
    ],
    legend: [{ cardId: "card.legend.base", quantity: 1 }],
    champion: [{ cardId: "card.champion.base", quantity: 1 }],
    battlefields: [
      ...Array.from({ length: 3 }, (_, index) => ({
        cardId: `card.battlefield-${index}.base`,
        quantity: 1
      }))
    ],
    sideboard: [{ cardId: "card.filler-13.base", quantity: 1 }]
  };
}

function deckWithMainDeckId(
  legal: DeckSubmission,
  cardId: string
): DeckSubmission {
  return {
    ...legal,
    mainDeck: [{ cardId, quantity: 1 }]
  };
}

describe("createConstructedRules", () => {
  it("exposes the official rules and public policy shape", () => {
    expect(constructed.policy.format).toBe("standard");
    expect(constructed.policy.checkedAt).toBe("2026-10-11");
    expect(constructed.policy.banResolutionComplete).toBe(true);
    expect(constructed.policy.tournamentComplete).toBe(false);
    expect(constructed.policy.limitations.map(item => item.id)).toEqual([
      "domain-identity",
      "champion-legend-signature",
      "identity-metadata",
      "colorless-domain",
      "effect-added-cards",
      "regional-product-availability"
    ]);
    expect(constructed.policy.missingBannedNames).toEqual([]);
    expect(constructed.policy.sources.map(source => source.id)).toEqual([
      "rules-hub-constructed-legality",
      "card-snapshot-official-english-full-name"
    ]);
    expect(constructed.rules.sizeRules).toEqual({
      legend: { minimum: 1, maximum: 1 },
      champion: { minimum: 1, maximum: 1 },
      runes: { minimum: 12, maximum: 12 },
      battlefields: { minimum: 3, maximum: 3 },
      sideboard: { minimum: 0, maximum: 10 }
    });
    expect(constructed.rules.sizeGroups).toEqual([
      { zones: ["mainDeck", "champion"], rule: { minimum: 40, maximum: 40 } }
    ]);
    expect(constructed.rules.uniqueCanonicalZones).toEqual(["battlefields"]);
  });

  it("resolves every official ban by exact name or explicit source alias", () => {
    expect(constructed.policy.bannedTargets).toHaveLength(12);
    for (const ban of officialBans) {
      const target = constructed.policy.bannedTargets.find(
        candidate => candidate.officialName === ban.officialName
      );
      expect(target).toMatchObject({
        canonicalCardId: ban.canonicalCardId,
        resolvedFullName: ban.snapshotName,
        sourceId: "rules-hub-constructed-legality"
      });
      expect(constructed.policy.cardPolicies[ban.canonicalCardId]).toEqual({
        status: "banned",
        maxCopies: 0,
        policyType: "limited"
      });
    }

    const dreamingTree = constructed.policy.bannedTargets.find(
      target => target.officialName === "Dreaming Tree"
    );
    expect(dreamingTree?.aliases).toEqual(["The Dreaming Tree"]);
  });

  it("bans every art and printing of the canonical identity", () => {
    const result = validateDeck(deckWithMainDeckId(
      legalDeck(),
      "card.draven.base"
    ), validationCards, constructed.rules);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain("banned_card");
    expect(result.issues.find(issue => issue.code === "banned_card"))
      .toMatchObject({ canonicalCardId: "card.draven" });
  });

  it("allows a twelve-copy rune across printings and rejects thirteen", () => {
    const valid = validateDeck(legalDeck(), validationCards, constructed.rules);
    const tooMany = validateDeck({
      ...legalDeck(),
      runes: [{ cardId: "card.rune.base", quantity: 13 }]
    }, validationCards, constructed.rules);

    expect(valid.valid).toBe(true);
    expect(valid.totalCards).toBe(57);
    expect(tooMany.valid).toBe(false);
    expect(tooMany.issues.map(issue => issue.code)).toContain(
      "copy_limit_exceeded"
    );
  });

  it("requires exactly three battlefields with one copy of each canonical battlefield", () => {
    const two = validateDeck({
      ...legalDeck(),
      battlefields: [{ cardId: "card.battlefield-0.base", quantity: 2 }]
    }, validationCards, constructed.rules);
    const duplicateCanonical = validateDeck({
      ...legalDeck(),
      battlefields: [
        { cardId: "card.battlefield-0.base", quantity: 2 },
        { cardId: "card.obelisk.base", quantity: 1 }
      ]
    }, validationCards, constructed.rules);

    expect(two.valid).toBe(false);
    expect(two.issues.map(issue => issue.code)).toContain(
      "zone_size_out_of_range"
    );
    expect(duplicateCanonical.valid).toBe(false);
    expect(duplicateCanonical.issues.map(issue => issue.code)).toContain(
      "copy_limit_exceeded"
    );
  });

  it("requires main deck plus champion to total exactly forty", () => {
    const result = validateDeck({
      ...legalDeck(),
      mainDeck: [{ cardId: "card.filler-0.base", quantity: 38 }]
    }, validationCards, constructed.rules);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain(
      "deck_size_out_of_range"
    );
    expect(result.zoneCounts.mainDeck + result.zoneCounts.champion).toBe(39);
  });

  it("exposes card policies by canonicalCardId, including bans at zero", () => {
    expect(getConstructedCardPolicy(
      constructed.policy,
      "card.rune"
    )).toEqual({ status: "legal", maxCopies: 12, policyType: "limited" });
    expect(getConstructedCardPolicy(
      constructed.policy,
      "card.battlefield-0"
    )).toEqual({ status: "legal", maxCopies: 1, policyType: "limited" });
    expect(getConstructedCardPolicy(
      constructed.policy,
      "card.filler-0"
    )).toEqual({ status: "legal", maxCopies: 3, policyType: "limited" });
    expect(getConstructedCardPolicy(
      constructed.policy,
      "card.called-shot"
    )).toEqual({ status: "banned", maxCopies: 0, policyType: "limited" });
    expect(getConstructedCardPolicy(
      constructed.policy,
      "card.radiance"
    )).toEqual({ status: "unreleased", maxCopies: 0, policyType: "limited" });
    expect(getConstructedCardPolicy(
      constructed.policy,
      "card.eternal"
    )).toEqual({ status: "notStandard", maxCopies: 0, policyType: "limited" });
  });

  it("keeps a released identity legal while marking only its Radiance reprint unavailable", () => {
    expect(getConstructedCardPolicy(
      constructed.policy,
      "card.reprint"
    )).toEqual({ status: "legal", maxCopies: 3, policyType: "limited" });
    expect(getConstructedPrintingPolicy(
      constructed.policy,
      "card.reprint.ogn"
    )).toEqual({ status: "available", available: true, setCode: "ogn" });
    expect(getConstructedPrintingPolicy(
      constructed.policy,
      "card.reprint.rad"
    )).toEqual({
      status: "previewNotReleased",
      available: false,
      setCode: "rad"
    });
    expect(getConstructedPrintingPolicy(
      constructed.policy,
      "card.radiance.base"
    )).toEqual({
      status: "previewNotReleased",
      available: false,
      setCode: "rad"
    });
  });

  it("rejects unavailable printings through the policy validation helper", () => {
    const result = validateConstructedDeck(
      {
        ...legalDeck(),
        mainDeck: [
          ...Array.from({ length: 12 }, (_, index) => ({
            cardId: `card.filler-${index}.base`,
            quantity: 3
          })),
          { cardId: "card.reprint.rad", quantity: 1 }
        ]
      },
      validationCards,
      constructed
    );
    const releasedResult = validateConstructedDeck(
      {
        ...legalDeck(),
        mainDeck: [
          ...Array.from({ length: 12 }, (_, index) => ({
            cardId: `card.filler-${index}.base`,
            quantity: 3
          })),
          { cardId: "card.reprint.ogn", quantity: 3 }
        ]
      },
      validationCards,
      constructed
    );

    expect(result.valid).toBe(false);
    expect(result.printingIssues).toEqual([
      {
        cardId: "card.reprint.rad",
        canonicalCardId: "card.reprint",
        zone: "mainDeck",
        status: "previewNotReleased",
        message: "Printing card.reprint.rad is a Radiance preview printing and is not released as of 2026-10-11."
      }
    ]);
    expect(releasedResult.valid).toBe(true);
    expect(releasedResult.printingIssues).toEqual([]);
  });

  it("does not report unreleased or non-Standard identities as officially banned", () => {
    const unreleased = validateConstructedDeck(
      deckWithMainDeckId(legalDeck(), "card.radiance.base"),
      validationCards,
      constructed
    );
    const notStandard = validateConstructedDeck(
      deckWithMainDeckId(legalDeck(), "card.eternal.base"),
      validationCards,
      constructed
    );

    expect(unreleased.valid).toBe(false);
    expect(unreleased.printingIssues).toEqual([
      expect.objectContaining({
        cardId: "card.radiance.base",
        status: "previewNotReleased"
      })
    ]);
    expect(unreleased.issues.map(issue => issue.code)).not.toContain(
      "banned_card"
    );

    expect(notStandard.valid).toBe(false);
    expect(notStandard.printingIssues).toEqual([
      expect.objectContaining({
        cardId: "card.eternal.base",
        status: "notStandard"
      })
    ]);
    expect(notStandard.issues.map(issue => issue.code)).not.toContain(
      "banned_card"
    );
  });

  it("does not silently turn missing ban targets into an empty banlist", () => {
    const missing = createConstructedRules([
      ...legalCards,
      ...officialBans
        .filter(ban => ban.canonicalCardId !== "card.dreaming-tree")
        .map(ban => card({
          canonicalCardId: ban.canonicalCardId,
          fullName: ban.snapshotName,
          cardType: banCardTypes[ban.canonicalCardId] ?? "Unit"
        }))
    ], "standard", { asOf: "2026-10-11" });

    expect(missing.policy.banResolutionComplete).toBe(false);
    expect(missing.policy.missingBannedNames).toEqual(["Dreaming Tree"]);
    expect(missing.policy.missingBannedTargets).toEqual([
      {
        officialName: "Dreaming Tree",
        sourceId: "rules-hub-constructed-legality",
        reason: "No card in the snapshot has this exact official English fullName or an explicitly recorded source alias."
      }
    ]);
    expect(missing.policy.bannedTargets).toHaveLength(11);
  });

  it("rejects ambiguous official names instead of guessing a ban target", () => {
    const ambiguousCards = [
      ...legalCards,
      card({
        canonicalCardId: "card.dreaming-tree-a",
        fullName: "Dreaming Tree",
        cardType: "Battlefield"
      }),
      card({
        canonicalCardId: "card.dreaming-tree-b",
        fullName: "Dreaming Tree",
        cardType: "Battlefield"
      })
    ];

    expect(() => createConstructedRules(ambiguousCards, "standard", {
      asOf: "2026-10-11"
    })).toThrow(
      /Dreaming Tree.*canonical cards/
    );
  });

  it("marks Radiance preview cards as unreleased rather than Standard legal", () => {
    expect(constructed.policy.standard).toEqual({
      legalSetCodes: ["ogs", "ogn", "sfd", "unl", "ven"],
      radiance: {
        status: "preview-not-released",
        effectiveDate: "2026-10-16",
        releaseDate: "2026-10-23"
      }
    });
  });

  it.each([
    { asOf: "2026-10-15T23:59:59.999Z", available: false },
    { asOf: "2026-10-16T00:00:00.000Z", available: false },
    { asOf: "2026-10-22T23:59:59.999Z", available: false },
    { asOf: "2026-10-23T00:00:00.000Z", available: true },
    { asOf: "2026-10-24T00:00:00.000Z", available: true }
  ])("uses the release boundary at $asOf without changing bans or released identities", ({ asOf, available }) => {
    const active = createConstructedRules(cards, "standard", {
      asOf
    });

    expect(active.policy.checkedAt).toBe(asOf.slice(0, 10));
    expect(active.policy.standard).toEqual({
      legalSetCodes: available
        ? ["ogs", "ogn", "sfd", "unl", "ven", "rad"]
        : ["ogs", "ogn", "sfd", "unl", "ven"],
      radiance: {
        status: available ? "active" : "preview-not-released",
        effectiveDate: "2026-10-16",
        releaseDate: "2026-10-23"
      }
    });
    expect(getConstructedCardPolicy(active.policy, "card.radiance")).toEqual({
      status: available ? "legal" : "unreleased",
      maxCopies: available ? 3 : 0,
      policyType: "limited"
    });
    expect(getConstructedPrintingPolicy(
      active.policy,
      "card.radiance.base"
    )).toEqual({
      status: available ? "available" : "previewNotReleased",
      available,
      setCode: "rad"
    });
    expect(getConstructedPrintingPolicy(
      active.policy,
      "card.reprint.rad"
    )).toEqual({
      status: available ? "available" : "previewNotReleased",
      available,
      setCode: "rad"
    });
    expect(getConstructedCardPolicy(active.policy, "card.reprint")).toEqual({
      status: "legal", maxCopies: 3, policyType: "limited"
    });
    expect(getConstructedPrintingPolicy(active.policy, "card.reprint.ogn")).toEqual({
      status: "available", available: true, setCode: "ogn"
    });
    const deck = legalDeck();
    const released = validateConstructedDeck({
      ...deck,
      mainDeck: [{ cardId: "card.reprint.ogn", quantity: 3 }, ...deck.mainDeck.slice(1)]
    }, validationCards, active);
    const radiance = validateConstructedDeck({
      ...deck,
      mainDeck: [{ cardId: "card.reprint.rad", quantity: 3 }, ...deck.mainDeck.slice(1)]
    }, validationCards, active);
    expect(released.valid).toBe(true);
    expect(released.printingIssues).toEqual([]);
    expect(radiance.valid).toBe(available);
    expect(radiance.printingIssues).toEqual(available ? [] : [
      expect.objectContaining({ cardId: "card.reprint.rad", status: "previewNotReleased" })
    ]);
    expect(getConstructedCardPolicy(active.policy, "card.called-shot")).toEqual({
      status: "banned",
      maxCopies: 0,
      policyType: "limited"
    });
  });

  it.each(["2000-01-01", "2030-01-01"])("uses the injected clock independently of wall time %s", systemDate => {
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(systemDate));
    try {
      const now = vi.fn(() => Date.parse("2026-10-22T23:59:59.999Z"));
      const preview = createConstructedRules(cards, "standard", { now });
      expect(now).toHaveBeenCalledTimes(1);
      expect(preview.policy.checkedAt).toBe("2026-10-22");
      expect(getConstructedPrintingPolicy(preview.policy, "card.reprint.rad"))
        .toEqual({ status: "previewNotReleased", available: false, setCode: "rad" });
      const released = createConstructedRules(cards, "standard", {
        now: () => Date.parse("2026-10-23T00:00:00.000Z")
      });
      expect(getConstructedPrintingPolicy(released.policy, "card.reprint.rad"))
        .toEqual({ status: "available", available: true, setCode: "rad" });
      expect(wallClock).not.toHaveBeenCalled();
    } finally {
      wallClock.mockRestore();
    }
  });

  it.each(["2026-10-16", new Date("2026-10-16")])("gives explicit asOf %s priority over the injected clock", asOf => {
    const now = vi.fn(() => { throw new Error("Clock must not be read"); });
    const result = createConstructedRules(cards, "standard", { asOf, now });
    expect(result.policy.checkedAt).toBe("2026-10-16");
    expect(result.policy.standard.radiance.status).toBe("preview-not-released");
    expect(now).not.toHaveBeenCalled();
  });

  it("rejects an invalid asOf instant", () => {
    expect(() => createConstructedRules(cards, "standard", {
      asOf: "not-a-date"
    })).toThrow(/asOf must be a valid date/);
  });

  it("rejects an invalid injected clock instant", () => {
    expect(() => createConstructedRules(cards, "standard", {
      now: () => Number.NaN
    })).toThrow(/asOf must be a valid date/);
  });

  it("treats the official Proving Grounds set code OGS as Standard-legal", () => {
    expect(getConstructedCardPolicy(
      constructed.policy,
      "card.proving-ground"
    )).toEqual({ status: "legal", maxCopies: 3, policyType: "limited" });
    expect(getConstructedPrintingPolicy(
      constructed.policy,
      "card.proving-ground.base"
    )).toEqual({
      status: "available",
      available: true,
      setCode: "ogs"
    });
    expect(constructed.policy.standard.legalSetCodes).toContain("ogs");
    expect(constructed.policy.standard.legalSetCodes).not.toContain("pgs");
  });
});

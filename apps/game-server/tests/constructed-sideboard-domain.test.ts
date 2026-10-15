/**
 * Sideboard Domain Identity (CR 103.2.c + TR 2026-07-16 601.1.c.2).
 *
 * The tournament Constructed rules require a sideboard to consist only of
 * valid Main Deck cards, so a sideboard card must satisfy the same Domain
 * Identity as the Main Deck. This file only exercises the official entries
 * `validateConstructedDeck` / `validateCatalogDeck`; it never re-implements the
 * domain predicate.
 *
 * Controlled validation fixtures borrow catalog printing IDs and some Domain/Tag
 * values, but use synthetic names, canonical identities, costs and a fixture
 * catalog stamp. These tests exercise production validation entries; they do not
 * authenticate or replay the actual official catalog. Explicit fixture.* cards
 * provide multi-domain and Signature counterexamples.
 */
import { describe, expect, it } from "vitest";
import {
  createConstructedRules,
  validateConstructedDeck,
  type ConstructedPolicyCard,
  type ConstructedRules
} from "../src/constructed-policy.js";
import {
  loadCardCatalogRuntime,
  validateCatalogDeck,
  type CardCatalogRuntime
} from "../src/card-catalog.js";
import type {
  DeckCardDefinition,
  DeckSubmission,
  DeckZone
} from "../src/deck-validation.js";

const AS_OF = "2026-10-12T00:00:00.000Z";

function card(values: {
  readonly id: string;
  readonly fullName: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly canonicalCardId?: string;
}): ConstructedPolicyCard {
  return {
    id: values.id,
    canonicalCardId: values.canonicalCardId ?? values.id,
    fullName: values.fullName,
    cardType: values.cardType,
    setCode: "ogn",
    domains: [...values.domains],
    tags: [...values.tags]
  };
}

// Controlled fixtures with selected catalog IDs; see the source boundary above.
const MIND_MAIN = [
  "ogn-084-298", "ogn-086-298", "ogn-087-298", "ogn-088-298",
  "ogn-091-298", "ogn-092-298", "ogn-097-298"
] as const;
const ORDER_MAIN = [
  "ogn-208-298", "ogn-210-298", "ogn-211-298",
  "ogn-215-298", "ogn-216-298", "ogn-217-298"
] as const;

const CATALOG_CARDS: readonly ConstructedPolicyCard[] = [
  ...MIND_MAIN.map(cardId => card({
    id: cardId,
    fullName: `Mind unit ${cardId}`,
    cardType: "Unit",
    domains: ["Mind"],
    tags: []
  })),
  ...ORDER_MAIN.map(cardId => card({
    id: cardId,
    fullName: `Order unit ${cardId}`,
    cardType: "Unit",
    domains: ["Order"],
    tags: []
  })),
  card({
    id: "ogn-096-298",
    fullName: "Watchful Sentry",
    cardType: "Unit",
    domains: ["Mind"],
    tags: ["Freljord"]
  }),
  card({
    id: "ogn-218-298",
    fullName: "Vanguard Captain",
    cardType: "Unit",
    domains: ["Order"],
    tags: ["Elite", "Demacia"]
  }),
  card({
    id: "ogn-219-298",
    fullName: "Vanguard Sergeant",
    cardType: "Unit",
    domains: ["Order"],
    tags: ["Elite", "Demacia"]
  }),
  card({
    id: "ogn-001-298",
    fullName: "Blazing Scorcher",
    cardType: "Unit",
    domains: ["Fury"],
    tags: ["Dragon", "Noxus"]
  }),
  card({
    id: "ogn-089-298",
    fullName: "Mind Rune",
    cardType: "Rune",
    domains: ["Mind"],
    tags: ["Basic"]
  }),
  card({
    id: "ogn-275-298",
    fullName: "Altar to Unity",
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  }),
  card({
    id: "ogn-277-298",
    fullName: "Back-Alley Bar",
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  }),
  card({
    id: "ogn-278-298",
    fullName: "Bandle Tree",
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  }),
  card({
    id: "ogn-265-298",
    fullName: "Herald of the Arcane",
    cardType: "Legend",
    domains: ["Mind", "Order"],
    tags: ["Viktor"]
  }),
  card({
    id: "ogn-117-298",
    fullName: "Viktor, Innovator",
    cardType: "Unit",
    domains: ["Mind"],
    tags: ["Viktor", "Zaun", "Champion"]
  }),
  card({
    id: "ogn-246-298",
    fullName: "Viktor, Leader",
    cardType: "Unit",
    domains: ["Order"],
    tags: ["Viktor", "Zaun", "Champion"]
  }),
  card({
    id: "ogn-266-298",
    fullName: "Siphon Power, Viktor",
    cardType: "Spell",
    domains: ["Mind", "Order"],
    tags: ["Viktor", "Signature"]
  }),
  // Literal fixtures the snapshot cannot express.
  card({
    id: "fixture.sideboard-multi-domain",
    fullName: "Multi-Domain Sideboard Fixture",
    cardType: "Unit",
    domains: ["Mind", "Chaos"],
    tags: []
  }),
  card({
    id: "fixture.viktor-signature-two",
    fullName: "Second Viktor Signature Fixture",
    cardType: "Spell",
    domains: ["Mind", "Order"],
    tags: ["Viktor", "Signature"]
  })
];

function allowedZonesFor(cardValue: ConstructedPolicyCard): readonly DeckZone[] {
  const cardType = cardValue.cardType.toLowerCase();
  if (cardType === "rune") return ["runes"];
  if (cardType === "legend") return ["legend"];
  if (cardType === "battlefield") return ["battlefields"];
  if (cardType === "unit" &&
      (cardValue.tags ?? []).some(tag => tag.toLowerCase() === "champion")) {
    return ["mainDeck", "champion", "sideboard"];
  }
  if (cardType === "unit" || cardType === "gear" || cardType === "spell") {
    return ["mainDeck", "sideboard"];
  }
  return [];
}

const validationCards: readonly DeckCardDefinition[] = CATALOG_CARDS.map(item => ({
  id: item.id,
  canonicalCardId: item.canonicalCardId,
  name: item.fullName,
  allowedZones: allowedZonesFor(item)
}));

const constructed: ConstructedRules = createConstructedRules(
  CATALOG_CARDS,
  "standard",
  { asOf: AS_OF }
);

/** Mind/Order Viktor deck: 39 Main + Chosen Champion = 40. */
function viktorDeck(overrides: Partial<DeckSubmission> = {}): DeckSubmission {
  return {
    mainDeck: [
      ...MIND_MAIN.map(cardId => ({ cardId, quantity: 3 })),
      ...ORDER_MAIN.map(cardId => ({ cardId, quantity: 3 }))
    ],
    runes: [{ cardId: "ogn-089-298", quantity: 12 }],
    legend: [{ cardId: "ogn-265-298", quantity: 1 }],
    champion: [{ cardId: "ogn-117-298", quantity: 1 }],
    battlefields: [
      { cardId: "ogn-275-298", quantity: 1 },
      { cardId: "ogn-277-298", quantity: 1 },
      { cardId: "ogn-278-298", quantity: 1 }
    ],
    sideboard: [
      { cardId: "ogn-096-298", quantity: 1 },
      { cardId: "ogn-218-298", quantity: 1 },
      { cardId: "ogn-219-298", quantity: 1 }
    ],
    ...overrides
  };
}

function codes(result: { readonly issues: readonly { code: string }[] }): string[] {
  return result.issues.map(issue => issue.code);
}

function validate(deck: DeckSubmission, rules: ConstructedRules = constructed) {
  return validateConstructedDeck(deck, validationCards, rules);
}

describe("sideboard Domain Identity (CR 103.2.c / TR 601.1.c.2)", () => {
  it("accepts a sideboard whose cards stay inside the Mind/Order Domain Identity", () => {
    const result = validate(viktorDeck());

    expect(result.valid).toBe(true);
    expect(codes(result)).not.toContain("card_not_in_domain_identity");
  });

  it("rejects an off-domain single-domain Fury card placed in the sideboard", () => {
    const result = validate(viktorDeck({
      sideboard: [{ cardId: "ogn-001-298", quantity: 1 }]
    }));

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("card_not_in_domain_identity");
    expect(result.issues.find(
      issue => issue.code === "card_not_in_domain_identity"
    )).toMatchObject({ cardId: "ogn-001-298", zone: "sideboard" });
  });

  it("requires every declared domain of a multi-domain sideboard card to be present", () => {
    const result = validate(viktorDeck({
      sideboard: [{ cardId: "fixture.sideboard-multi-domain", quantity: 1 }]
    }));

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("card_not_in_domain_identity");
    expect(result.issues.find(
      issue => issue.code === "card_not_in_domain_identity"
    )?.message).toContain("Chaos");
  });

  it("keeps a sideboard card without identity metadata unavailable, not a bypass", () => {
    const stripped = createConstructedRules(
      CATALOG_CARDS.map(item => item.id === "ogn-096-298"
        ? {
            id: item.id,
            canonicalCardId: item.canonicalCardId,
            fullName: item.fullName,
            cardType: item.cardType,
            setCode: item.setCode
          }
        : item),
      "standard",
      { asOf: AS_OF }
    );

    const result = validate(viktorDeck(), stripped);

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("identity_metadata_unavailable");
    expect(result.issues.find(
      issue => issue.code === "identity_metadata_unavailable"
    )).toMatchObject({ cardId: "ogn-096-298", zone: "sideboard" });
  });

  it("still rejects a Rune or Legend placed in the sideboard via the zone guard", () => {
    const rune = validate(viktorDeck({
      sideboard: [{ cardId: "ogn-089-298", quantity: 1 }]
    }));
    const legend = validate(viktorDeck({
      sideboard: [{ cardId: "ogn-265-298", quantity: 1 }]
    }));

    expect(rune.valid).toBe(false);
    expect(rune.issues.find(
      issue => issue.code === "card_not_allowed_in_zone"
    )).toMatchObject({ cardId: "ogn-089-298", zone: "sideboard" });

    expect(legend.valid).toBe(false);
    expect(legend.issues.find(
      issue => issue.code === "card_not_allowed_in_zone"
    )).toMatchObject({ cardId: "ogn-265-298", zone: "sideboard" });
  });

  it("keeps the cross main+sideboard copy limit and Signature total (no regression)", () => {
    const copy = validate(viktorDeck({
      sideboard: [{ cardId: "ogn-084-298", quantity: 1 }]
    }));
    // 37 fillers + 2 Signatures = 39 Main Deck plus the Chosen Champion.
    const signature = validate(viktorDeck({
      mainDeck: [
        ...MIND_MAIN.map(cardId => ({ cardId, quantity: 3 })),
        ...ORDER_MAIN.slice(0, 5).map(cardId => ({ cardId, quantity: 3 })),
        { cardId: "ogn-217-298", quantity: 1 },
        { cardId: "ogn-266-298", quantity: 1 },
        { cardId: "fixture.viktor-signature-two", quantity: 1 }
      ],
      sideboard: [
        { cardId: "ogn-266-298", quantity: 1 },
        { cardId: "fixture.viktor-signature-two", quantity: 1 }
      ]
    }));

    // ogn-084-298 is already three in the main deck; one more in the sideboard
    // exceeds the combined canonical limit (three names, three zones).
    expect(copy.valid).toBe(false);
    expect(codes(copy)).toContain("copy_limit_exceeded");
    expect(codes(copy)).not.toContain("card_not_in_domain_identity");

    // Two Signature names, two copies each, four total, two per name is fine:
    // only the deck-wide Signature sum is illegal.
    expect(signature.valid).toBe(false);
    expect(codes(signature)).toContain("signature_limit_exceeded");
    expect(codes(signature)).not.toContain("copy_limit_exceeded");
    expect(codes(signature)).not.toContain("card_not_in_domain_identity");
    expect(codes(signature)).not.toContain("deck_size_out_of_range");
  });
});

describe("sideboard Domain Identity through the catalog entry", () => {
  async function runtime(): Promise<CardCatalogRuntime> {
    return loadCardCatalogRuntime({
      catalog: {
        schemaVersion: 1,
        dataVersion: "2026-10-12-sideboard-domain-fixture",
        digest: "sha256:" + "s".repeat(64),
        cards: CATALOG_CARDS.map(item => ({
          id: item.id,
          canonicalCardId: item.canonicalCardId,
          name: item.fullName,
          fullName: item.fullName,
          cardType: item.cardType,
          domains: [...(item.domains ?? [])],
          tags: [...(item.tags ?? [])],
          setCode: item.setCode,
          cardNumber: "000",
          variant: "standard" as const,
          imageUrl: null,
          energy: null,
          power: null,
          might: null,
          ability: ""
        }))
      }
    });
  }

  it("rejects an off-domain sideboard card through validateCatalogDeck", async () => {
    const result = validateCatalogDeck(await runtime(), viktorDeck({
      sideboard: [{ cardId: "ogn-001-298", quantity: 1 }]
    }));

    expect(result.valid).toBe(false);
    expect(result.issues.find(
      issue => issue.code === "card_not_in_domain_identity"
    )).toMatchObject({ cardId: "ogn-001-298", zone: "sideboard" });
  });

  it("accepts the in-identity sideboard through validateCatalogDeck", async () => {
    const result = validateCatalogDeck(await runtime(), viktorDeck());

    expect(result.valid).toBe(true);
    expect(codes(result)).not.toContain("card_not_in_domain_identity");
  });
});

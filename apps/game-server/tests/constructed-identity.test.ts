/**
 * Constructed identity checks (CR 103.1.b, 103.2.a.2, 103.2.d, 103.3.a.1, 103.4.b).
 *
 * The fixtures are small literals taken from the current official snapshot
 * (card id / cardType / domains / tags are real observed values) so the tests
 * stay offline and deterministic. Cases the snapshot cannot express are marked
 * as literal fixtures: the snapshot has no non-Colorless Battlefield, and it
 * has exactly one Jinx Signature card.
 */
import { describe, expect, it } from "vitest";
import {
  createConstructedRules,
  getConstructedCardPolicy,
  validateConstructedDeck,
  type ConstructedPolicyCard,
  type ConstructedRules
} from "../src/constructed-policy.js";
import type {
  DeckCardDefinition,
  DeckSubmission
} from "../src/deck-validation.js";
import { normalizeCardCatalog } from "../src/card-catalog.js";

function realCard(
  values: Omit<ConstructedPolicyCard, "setCode"> & {
    readonly setCode?: string;
  }
): ConstructedPolicyCard {
  return { setCode: "ogn", ...values };
}

/** Real single-domain Fury units used as main-deck filler. */
const FILLER_IDS = [
  "ogn-001-298",
  "ogn-002-298",
  "ogn-003-298",
  "ogn-006-298",
  "ogn-010-298",
  "ogn-011-298",
  "ogn-012-298",
  "ogn-013-298",
  "ogn-015-298",
  "ogn-016-298",
  "ogn-018-298",
  "ogn-019-298",
  "ogn-020-298"
] as const;

const CATALOG_CARDS: readonly ConstructedPolicyCard[] = [
  realCard({
    id: "ogn-251-298",
    canonicalCardId: "ogn-251-298",
    fullName: "Loose Cannon",
    cardType: "Legend",
    domains: ["Fury", "Chaos"],
    tags: ["Jinx"]
  }),
  realCard({
    id: "ogn-202-298",
    canonicalCardId: "ogn-202-298",
    fullName: "Jinx, Rebel",
    cardType: "Unit",
    domains: ["Chaos"],
    tags: ["Jinx", "Zaun", "Champion"]
  }),
  realCard({
    id: "ogn-030-298",
    canonicalCardId: "ogn-030-298",
    fullName: "Jinx, Demolitionist",
    cardType: "Unit",
    domains: ["Fury"],
    tags: ["Jinx", "Zaun", "Champion"]
  }),
  realCard({
    id: "ogn-252-298",
    canonicalCardId: "ogn-252-298",
    fullName: "Super Mega Death Rocket!, Jinx",
    cardType: "Spell",
    domains: ["Fury", "Chaos"],
    tags: ["Jinx", "Signature"]
  }),
  realCard({
    id: "ogn-076-298",
    canonicalCardId: "ogn-076-298",
    fullName: "Yasuo, Remorseful",
    cardType: "Unit",
    domains: ["Calm"],
    tags: ["Yasuo", "Ionia", "Champion"]
  }),
  realCard({
    id: "ogn-250-298",
    canonicalCardId: "ogn-250-298",
    fullName: "Stormbringer, Volibear",
    cardType: "Spell",
    domains: ["Fury", "Body"],
    tags: ["Volibear", "Signature"]
  }),
  realCard({
    id: "ogs-017-024",
    canonicalCardId: "ogs-017-024",
    fullName: "Dark Child, Starter",
    cardType: "Legend",
    setCode: "ogs",
    domains: ["Fury", "Chaos"],
    tags: ["Annie", "Champion"]
  }),
  realCard({
    id: "ogs-018-024",
    canonicalCardId: "ogs-018-024",
    fullName: "Tibbers, Annie",
    cardType: "Unit",
    setCode: "ogs",
    domains: ["Fury", "Chaos"],
    tags: ["Annie", "Signature"]
  }),
  realCard({
    id: "ogs-001-024",
    canonicalCardId: "ogs-001-024",
    fullName: "Annie, Fiery",
    cardType: "Unit",
    setCode: "ogs",
    domains: ["Fury"],
    tags: ["Annie", "Noxus", "Champion"]
  }),
  realCard({
    id: "ven-192-star-166",
    canonicalCardId: "ven-192-star-166",
    fullName: "Curator of the Sands",
    cardType: "Legend",
    setCode: "ven",
    domains: ["Calm", "Mind"],
    tags: ["Dog", "Shurima", "Nasus"]
  }),
  realCard({
    id: "ogn-042-298",
    canonicalCardId: "ogn-042-298",
    fullName: "Calm Rune",
    cardType: "Rune",
    domains: ["Calm"],
    tags: ["Basic"]
  }),
  realCard({
    id: "ogn-007-298",
    canonicalCardId: "ogn-007-298",
    fullName: "Fury Rune",
    cardType: "Rune",
    domains: ["Fury"],
    tags: ["Basic"]
  }),
  realCard({
    id: "ogn-275-298",
    canonicalCardId: "ogn-275-298",
    fullName: "Altar to Unity",
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  }),
  realCard({
    id: "ogn-277-298",
    canonicalCardId: "ogn-277-298",
    fullName: "Back-Alley Bar",
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  }),
  realCard({
    id: "ogn-278-298",
    canonicalCardId: "ogn-278-298",
    fullName: "Bandle Tree",
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  }),
  ...FILLER_IDS.map(cardId => realCard({
    id: cardId,
    canonicalCardId: cardId,
    fullName: `Fixture Filler ${cardId}`,
    cardType: "Unit",
    domains: ["Fury"],
    tags: []
  })),
  // Literal fixtures for cases the current snapshot cannot express.
  realCard({
    id: "fixture.off-domain-battlefield",
    canonicalCardId: "fixture.off-domain-battlefield",
    fullName: "Off-Domain Battlefield Fixture",
    cardType: "Battlefield",
    domains: ["Mind"],
    tags: []
  }),
  realCard({
    id: "fixture.jinx-signature-two",
    canonicalCardId: "fixture.jinx-signature-two",
    fullName: "Second Jinx Signature Fixture",
    cardType: "Spell",
    domains: ["Chaos"],
    tags: ["Jinx", "Signature"]
  }),
  realCard({
    id: "fixture.shurima-champion",
    canonicalCardId: "fixture.shurima-champion",
    fullName: "Shurima Champion Fixture",
    cardType: "Unit",
    domains: ["Calm"],
    tags: ["Shurima", "Champion"]
  }),
  realCard({
    id: "fixture.domainless-legend",
    canonicalCardId: "fixture.domainless-legend",
    fullName: "Domainless Legend Fixture",
    cardType: "Legend",
    domains: [],
    tags: ["Fixtures"]
  })
];

const constructed = createConstructedRules(CATALOG_CARDS, "standard", {
  asOf: "2026-10-12T00:00:00.000Z"
});

const validationCards: readonly DeckCardDefinition[] = CATALOG_CARDS.map(card => ({
  id: card.id,
  canonicalCardId: card.canonicalCardId,
  name: card.fullName
}));

const BATTLEFIELDS = [
  { cardId: "ogn-275-298", quantity: 1 },
  { cardId: "ogn-277-298", quantity: 1 },
  { cardId: "ogn-278-298", quantity: 1 }
] as const;

/** Loose Cannon / Jinx deck: 39 main deck + 1 Chosen Champion = 40. */
function jinxDeck(): DeckSubmission {
  return {
    mainDeck: [
      { cardId: "ogn-252-298", quantity: 3 },
      ...FILLER_IDS.slice(0, 12).map(cardId => ({ cardId, quantity: 3 }))
    ],
    runes: [{ cardId: "ogn-007-298", quantity: 12 }],
    legend: [{ cardId: "ogn-251-298", quantity: 1 }],
    champion: [{ cardId: "ogn-202-298", quantity: 1 }],
    battlefields: [...BATTLEFIELDS]
  };
}

/** Dark Child, Starter / Annie deck: 39 main deck + 1 Chosen Champion = 40. */
function annieDeck(): DeckSubmission {
  return {
    mainDeck: FILLER_IDS.map(cardId => ({ cardId, quantity: 3 })),
    runes: [{ cardId: "ogn-007-298", quantity: 12 }],
    legend: [{ cardId: "ogs-017-024", quantity: 1 }],
    champion: [{ cardId: "ogs-001-024", quantity: 1 }],
    battlefields: [...BATTLEFIELDS]
  };
}

function codes(result: { readonly issues: readonly { code: string }[] }): string[] {
  return result.issues.map(issue => issue.code);
}

function validate(
  deck: DeckSubmission,
  rules: ConstructedRules = constructed
) {
  return validateConstructedDeck(deck, validationCards, rules);
}

describe("constructed identity: Champion Legend and Domain Identity", () => {
  it("accepts the real Loose Cannon / Jinx, Rebel deck", () => {
    const result = validate(jinxDeck());

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.printingIssues).toEqual([]);
  });

  it("rejects a Chosen Champion whose champion tag does not match the legend", () => {
    const result = validate({
      ...jinxDeck(),
      champion: [{ cardId: "ogn-076-298", quantity: 1 }]
    });

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("champion_tag_mismatch");
    expect(result.issues.find(
      issue => issue.code === "champion_tag_mismatch"
    )).toMatchObject({
      cardId: "ogn-076-298",
      canonicalCardId: "ogn-076-298",
      zone: "champion"
    });
    // Yasuo, Remorseful is also a Calm card outside {Fury, Chaos}.
    expect(codes(result)).toContain("card_not_in_domain_identity");
  });

  it("rejects a signature unit as Chosen Champion even when its tag matches", () => {
    const tibbers = validate({
      ...annieDeck(),
      champion: [{ cardId: "ogs-018-024", quantity: 1 }]
    });

    // Tibbers has the Annie tag but is a signature unit (CR 103.2.a.2 example).
    expect(tibbers.valid).toBe(false);
    expect(codes(tibbers)).toContain("champion_is_signature");
    expect(codes(tibbers)).not.toContain("champion_tag_mismatch");
  });

  it("accepts a champion unit that really matches the legend tag", () => {
    const result = validate(annieDeck());

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("requires every declared domain of a multi-domain card to be inside the identity", () => {
    const result = validate({
      ...jinxDeck(),
      mainDeck: [
        { cardId: "ogn-250-298", quantity: 1 },
        ...FILLER_IDS.slice(0, 12).map(cardId => ({ cardId, quantity: 3 }))
      ]
    });

    // Stormbringer, Volibear is Fury/Body: Fury matches Loose Cannon but Body
    // does not, so the card is rejected instead of matching on any one domain.
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("card_not_in_domain_identity");
    expect(result.issues.find(
      issue => issue.code === "card_not_in_domain_identity"
    )?.message).toContain("Body");
    // It is also a Volibear Signature while the legend tag is Jinx.
    expect(codes(result)).toContain("signature_tag_mismatch");
  });

  it("rejects out-of-identity runes and battlefields", () => {
    const runes = validate({
      ...jinxDeck(),
      runes: [
        { cardId: "ogn-007-298", quantity: 11 },
        { cardId: "ogn-042-298", quantity: 1 }
      ]
    });
    const battlefield = validate({
      ...jinxDeck(),
      battlefields: [
        { cardId: "ogn-275-298", quantity: 1 },
        { cardId: "ogn-277-298", quantity: 1 },
        { cardId: "fixture.off-domain-battlefield", quantity: 1 }
      ]
    });

    expect(runes.valid).toBe(false);
    expect(runes.issues.find(
      issue => issue.code === "card_not_in_domain_identity"
    )).toMatchObject({ cardId: "ogn-042-298", zone: "runes" });

    expect(battlefield.valid).toBe(false);
    expect(battlefield.issues.find(
      issue => issue.code === "card_not_in_domain_identity"
    )).toMatchObject({
      cardId: "fixture.off-domain-battlefield",
      zone: "battlefields"
    });
  });

  it("does not apply the domain check to Colorless battlefields", () => {
    const result = validate(jinxDeck());

    expect(codes(result)).not.toContain("card_not_in_domain_identity");
    expect(constructed.policy.limitations.map(item => item.id))
      .toContain("colorless-domain");
  });

  it("counts all Signature cards together instead of allowing three per name", () => {
    const result = validate({
      ...jinxDeck(),
      mainDeck: [
        { cardId: "ogn-252-298", quantity: 2 },
        { cardId: "fixture.jinx-signature-two", quantity: 2 },
        ...FILLER_IDS.slice(0, 11).map(cardId => ({ cardId, quantity: 3 }))
      ]
    });

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("signature_limit_exceeded");
    expect(result.issues.find(
      issue => issue.code === "signature_limit_exceeded"
    )?.message).toContain("4");
    // Two copies per name are individually fine: only the sum total is illegal.
    expect(codes(result)).not.toContain("copy_limit_exceeded");
    expect(codes(result)).not.toContain("signature_tag_mismatch");
  });

  it("rejects a Signature card whose tag does not match the legend", () => {
    const result = validate({
      ...jinxDeck(),
      mainDeck: [
        { cardId: "ogn-250-298", quantity: 1 },
        ...FILLER_IDS.slice(0, 12).map(cardId => ({ cardId, quantity: 3 }))
      ]
    });

    expect(codes(result)).toContain("signature_tag_mismatch");
  });
});

describe("constructed identity: metadata failures are never silently legal", () => {
  it("rejects a deck whose catalog cards carry no identity metadata", () => {
    const stripped = createConstructedRules(
      CATALOG_CARDS.map(card => ({
        id: card.id,
        canonicalCardId: card.canonicalCardId,
        fullName: card.fullName,
        cardType: card.cardType,
        setCode: card.setCode
      })),
      "standard",
      { asOf: "2026-10-12T00:00:00.000Z" }
    );

    const result = validate(jinxDeck(), stripped);

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("identity_metadata_unavailable");
  });

  it("rejects a printing without catalog identity metadata instead of assuming legality", () => {
    const missingPrinting = createConstructedRules(
      CATALOG_CARDS.filter(card => card.id !== FILLER_IDS[0]),
      "standard",
      { asOf: "2026-10-12T00:00:00.000Z" }
    );

    const result = validate(jinxDeck(), missingPrinting);

    expect(result.valid).toBe(false);
    expect(result.issues.find(
      issue => issue.code === "identity_metadata_unavailable"
    )).toMatchObject({ cardId: FILLER_IDS[0] });
  });

  it("rejects a legend without catalog domains instead of fabricating an identity", () => {
    const result = validate({
      ...jinxDeck(),
      legend: [{ cardId: "fixture.domainless-legend", quantity: 1 }]
    });

    expect(result.valid).toBe(false);
    expect(result.issues.find(
      issue => issue.code === "identity_metadata_unavailable"
    )).toMatchObject({ cardId: "fixture.domainless-legend" });
  });

  it("refuses to name a champion tag for a legend with region-like extra tags", () => {
    const result = validate({
      ...annieDeck(),
      legend: [{ cardId: "ven-192-star-166", quantity: 1 }],
      champion: [{ cardId: "fixture.shurima-champion", quantity: 1 }]
    });

    // Curator of the Sands carries ["Dog", "Shurima", "Nasus"]: the region-like
    // Shurima tag must never be used to match a champion unit.
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("identity_metadata_unavailable");
    expect(codes(result)).not.toContain("champion_tag_mismatch");
  });

  it("keeps the legend-less partial path free of identity claims", () => {
    const result = validate({
      mainDeck: [{ cardId: FILLER_IDS[0], quantity: 1 }]
    });

    // The constructed ruleset requires exactly one Champion Legend; without one
    // the structural rules fail and no identity verdict is fabricated.
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("zone_size_out_of_range");
    expect(codes(result)).not.toContain("identity_metadata_unavailable");
  });
});

describe("constructed identity: private metadata stays server-side", () => {
  it("keeps the private identity lookup out of the public policy", () => {
    expect(Object.keys(constructed.policy).sort()).toEqual([
      "banResolutionComplete",
      "bannedTargets",
      "cardPolicies",
      "checkedAt",
      "format",
      "limitations",
      "missingBannedNames",
      "missingBannedTargets",
      "policyScope",
      "printingPolicies",
      "sources",
      "standard",
      "tournamentComplete",
      "zoneRules"
    ]);
    expect(constructed.policy).not.toHaveProperty("identityMetadata");
    expect(JSON.stringify(constructed.policy)).not.toContain("identityMetadata");
    expect(JSON.stringify(constructed.policy)).not.toContain("byCardId");
    expect(JSON.stringify(constructed.policy)).not.toContain(
      "knownChampionTags"
    );
    expect(constructed.identityMetadata.byCardId.get("ogn-251-298"))
      .toMatchObject({
        cardType: "Legend",
        domains: ["Fury", "Chaos"],
        tags: ["Jinx"]
      });
    expect(constructed.policy.tournamentComplete).toBe(false);
    expect(constructed.policy.limitations.map(item => item.id)).toContain(
      "regional-product-availability"
    );
    expect(constructed.policy.limitations.map(item => item.id)).toContain(
      "effect-added-cards"
    );
  });
});

/**
 * Named champion-family fixtures.
 *
 * `id` / `canonicalCardId` / `name` / `cardType` / `domains` / `tags` / `setCode`
 * are the real observed values from
 * `packages/card-data/data/deck-catalog.json`, so the champion family is
 * derived exactly the way the server does it for the live catalog. Only the few
 * `fixture.*` cards are literals, because the snapshot cannot express an
 * already-corrected Karma record or a deliberately ambiguous one.
 */
function namedCard(
  values: Omit<ConstructedPolicyCard, "setCode"> & {
    readonly setCode?: string;
  }
): ConstructedPolicyCard {
  return { setCode: "ogn", ...values };
}

const NAMED_FILLER_IDS: readonly string[] = Array.from(
  { length: 13 },
  (_, index) => `fixture.named-filler-${index}`
);

const NAMED_CARDS: readonly ConstructedPolicyCard[] = [
  namedCard({
    id: "ven-155-166",
    canonicalCardId: "card.hash-aa310ded3ca355bccab78b17783adac7b21e0b2477c14135b2cf52ebad7d96a5",
    fullName: "Heart of the Tempest",
    name: "Heart of the Tempest",
    cardType: "Legend",
    setCode: "ven",
    domains: ["Order", "Chaos"],
    tags: ["Yordle", "Kennen"]
  }),
  namedCard({
    id: "ven-192-star-166",
    canonicalCardId: "card.hash-913749be19f87a0f632bd0690ad0490bb254a346584c09e1b8c3244137f609a7",
    fullName: "Curator of the Sands",
    name: "Curator of the Sands",
    cardType: "Legend",
    setCode: "ven",
    domains: ["Calm", "Mind"],
    tags: ["Dog", "Shurima", "Nasus"]
  }),
  namedCard({
    id: "ven-145-166",
    canonicalCardId: "card.hash-913749be19f87a0f632bd0690ad0490bb254a346584c09e1b8c3244137f609a7",
    fullName: "Curator of the Sands",
    name: "Curator of the Sands",
    cardType: "Legend",
    setCode: "ven",
    domains: ["Calm", "Mind"],
    tags: ["Nasus"]
  }),
  namedCard({
    id: "unl-187-219",
    canonicalCardId: "card.hash-8e09f40d2b739aa2e5e38a58cb0c9b9a2682ab534807bcc62c90206e763d6856",
    fullName: "Piltover Enforcer",
    name: "Piltover Enforcer",
    cardType: "Legend",
    setCode: "unl",
    domains: ["Fury", "Order"],
    tags: ["Vi"]
  }),
  namedCard({
    id: "ogn-263-298",
    canonicalCardId: "card.hash-275c83714004b04a02ea1ff6f9f629c0b77b0d086f67110ebc98b8056b99b7a6",
    fullName: "Swift Scout",
    name: "Swift Scout",
    cardType: "Legend",
    setCode: "ogn",
    domains: ["Mind", "Chaos"],
    tags: ["Teemo"]
  }),
  namedCard({
    id: "rad-141-167",
    canonicalCardId: "card.hash-35388dd2b47ca5aff627f64dbadee600be5e2d4c7d1f00c2d412147b43679458",
    fullName: "Hexplosives Expert",
    name: "Hexplosives Expert",
    cardType: "Legend",
    setCode: "rad",
    domains: ["Fury", "Chaos"],
    tags: ["Yordle", "Ziggs"]
  }),
  namedCard({
    id: "ven-113-166",
    canonicalCardId: "card.hash-f8e2a3619f710bd235f910a96127e6c5f05eb8a3971f892d3d728bab7dc7d677",
    fullName: "Kennen, Storm of Shuriken",
    name: "Kennen",
    cardType: "Unit",
    setCode: "ven",
    domains: ["Chaos"],
    tags: ["Yordle", "Kennen", "Champion"]
  }),
  namedCard({
    id: "ogn-197-298",
    canonicalCardId: "card.hash-cb1f129544dcf370595e85fa0b8df2f0620b5cb3bd0199a5a8700160557bfb5f",
    fullName: "Teemo, Scout",
    name: "Teemo",
    cardType: "Unit",
    setCode: "ogn",
    domains: ["Chaos"],
    tags: ["Yordle", "Teemo", "Bandle City", "Champion"]
  }),
  namedCard({
    id: "ven-046-166",
    canonicalCardId: "card.hash-2df5544ffea6f698095320fc6fa4ee6de200fc1053c9c5737ca847fc57e18b35",
    fullName: "Nasus, Ascended",
    name: "Nasus",
    cardType: "Unit",
    setCode: "ven",
    domains: ["Calm"],
    tags: ["Dog", "Shurima", "Nasus", "Champion"]
  }),
  namedCard({
    id: "rad-023-167",
    canonicalCardId: "card.hash-143c51170da933db17fe250dec223607e32fd758ab3825c4f009ce0d78c4d1b5",
    fullName: "Ziggs, Short-Fused",
    name: "Ziggs",
    cardType: "Unit",
    setCode: "rad",
    domains: ["Fury"],
    tags: ["Bandle City", "Ziggs", "Champion"]
  }),
  namedCard({
    id: "ogn-036-298",
    canonicalCardId: "card.hash-bcfd5b90d3252713ccfca0703a0d9aef17711a45ff2065bd68d7dd7822950b51",
    fullName: "Vi, Destructive",
    name: "Vi",
    cardType: "Unit",
    setCode: "ogn",
    domains: ["Fury"],
    tags: ["Vi", "Piltover", "Champion"]
  }),
  namedCard({
    id: "ogn-235-298",
    canonicalCardId: "card.hash-65e0ab54a0954e391f643dc900a7a0faa2cd298faa850e7c436e13659498922d",
    fullName: "Karma, Channeler",
    name: "Karma",
    cardType: "Unit",
    setCode: "ogn",
    domains: ["Order"],
    tags: ["Vi", "Ionia", "Champion"]
  }),
  namedCard({
    id: "ven-156-166",
    canonicalCardId: "card.hash-caa60c112cdc9dccc741c15d4bb6d88be761ea9eff1495e0945ebb1a86bc5d74",
    fullName: "Lightning Rush",
    name: "Lightning Rush",
    cardType: "Spell",
    setCode: "ven",
    domains: ["Order", "Chaos"],
    tags: ["Kennen", "Signature"]
  }),
  namedCard({
    id: "ogn-264-298",
    canonicalCardId: "card.hash-1175fb7ab62c4d777b8ccd63b423982a0b70440ed2d5652d2b61dde6fb07b06f",
    fullName: "Guerilla Warfare, Teemo",
    name: "Guerilla Warfare",
    cardType: "Spell",
    setCode: "ogn",
    domains: ["Mind", "Chaos"],
    tags: ["Teemo", "Signature"]
  }),
  namedCard({
    id: "rad-142-167",
    canonicalCardId: "card.hash-adaaf974cd82ebaff6aa819c452460671fea4a56efdd3d88174b6e787957c96a",
    fullName: "Hexplosive Minefield",
    name: "Hexplosive Minefield",
    cardType: "Spell",
    setCode: "rad",
    domains: ["Fury", "Chaos"],
    tags: ["Ziggs", "Signature"]
  }),
  // Literal fixtures: a corrected Karma record, two deliberately ambiguous
  // records, one unknown-family legend.
  namedCard({
    id: "fixture.karma-legend",
    canonicalCardId: "fixture.karma-legend",
    fullName: "Karma Legend Fixture",
    name: "Karma Legend Fixture",
    cardType: "Legend",
    domains: ["Order", "Chaos"],
    tags: ["Karma"]
  }),
  namedCard({
    id: "fixture.karma-corrected",
    canonicalCardId: "fixture.karma-corrected",
    fullName: "Karma Corrected Fixture",
    name: "Karma",
    cardType: "Unit",
    domains: ["Order"],
    tags: ["Karma", "Champion"]
  }),
  namedCard({
    id: "fixture.ambiguous-legend",
    canonicalCardId: "fixture.ambiguous-legend",
    fullName: "Ambiguous Legend Fixture",
    name: "Ambiguous Legend Fixture",
    cardType: "Legend",
    domains: ["Order", "Chaos"],
    tags: ["Kennen", "Teemo"]
  }),
  namedCard({
    id: "fixture.ambiguous-signature",
    canonicalCardId: "fixture.ambiguous-signature",
    fullName: "Ambiguous Signature Fixture",
    name: "Ambiguous Signature Fixture",
    cardType: "Spell",
    domains: ["Order", "Chaos"],
    tags: ["Kennen", "Teemo", "Signature"]
  }),
  namedCard({
    id: "fixture.unknown-family-legend",
    canonicalCardId: "fixture.unknown-family-legend",
    fullName: "Unknown Family Legend Fixture",
    name: "Unknown Family Legend Fixture",
    cardType: "Legend",
    domains: ["Order", "Chaos"],
    tags: ["Unknown Family"]
  }),
  // Literal champion-unit fixtures for the fail-closed family guard: an unknown
  // named unit that carries two catalog-known families at once (including the
  // Kennen tag a Kennen legend would otherwise accept), the same record without
  // any `name`, and a unit with no catalog-known family tag at all. Their own
  // `name` never appears among their tags, so they never enter
  // `knownChampionTags`.
  namedCard({
    id: "fixture.ambiguous-champion",
    canonicalCardId: "fixture.ambiguous-champion",
    fullName: "Ambiguous Champion Fixture",
    name: "Ambiguous Champion Fixture",
    cardType: "Unit",
    domains: [],
    tags: ["Kennen", "Teemo", "Champion"]
  }),
  namedCard({
    id: "fixture.nameless-ambiguous-champion",
    canonicalCardId: "fixture.nameless-ambiguous-champion",
    fullName: "Nameless Ambiguous Champion Fixture",
    cardType: "Unit",
    domains: [],
    tags: ["Kennen", "Teemo", "Champion"]
  }),
  namedCard({
    id: "fixture.unknown-family-champion",
    canonicalCardId: "fixture.unknown-family-champion",
    fullName: "Unknown Family Champion Fixture",
    name: "Unknown Family Champion Fixture",
    cardType: "Unit",
    domains: [],
    tags: ["Yordle", "Champion"]
  }),
  // Domainless fillers/runes so any legend's Domain Identity is satisfiable,
  // plus Colorless battlefields. They carry no Champion tag, so they never
  // contribute to the named champion tag set.
  ...NAMED_FILLER_IDS.map(cardId => namedCard({
    id: cardId,
    canonicalCardId: cardId,
    fullName: `Named Filler ${cardId}`,
    cardType: "Unit",
    domains: [],
    tags: []
  })),
  namedCard({
    id: "fixture.named-rune",
    canonicalCardId: "fixture.named-rune",
    fullName: "Named Rune Fixture",
    cardType: "Rune",
    domains: [],
    tags: ["Basic"]
  }),
  ...Array.from({ length: 3 }, (_, index): ConstructedPolicyCard => namedCard({
    id: `fixture.named-battlefield-${index}`,
    canonicalCardId: `fixture.named-battlefield-${index}`,
    fullName: `Named Battlefield Fixture ${index}`,
    cardType: "Battlefield",
    domains: ["Colorless"],
    tags: []
  }))
];

const namedConstructed = createConstructedRules(NAMED_CARDS, "standard", {
  asOf: "2026-10-12T00:00:00.000Z"
});

const namedValidationCards: readonly DeckCardDefinition[] = NAMED_CARDS.map(
  card => ({
    id: card.id,
    canonicalCardId: card.canonicalCardId,
    name: card.fullName
  })
);

function namedDeck(
  legendId: string,
  championId: string,
  extraMainDeck: readonly { cardId: string; quantity: number }[] = [],
  fillerCount = 13
): DeckSubmission {
  return {
    mainDeck: [
      ...NAMED_FILLER_IDS.slice(0, fillerCount).map(cardId => ({
        cardId,
        quantity: 3
      })),
      ...extraMainDeck
    ],
    runes: [{ cardId: "fixture.named-rune", quantity: 12 }],
    legend: [{ cardId: legendId, quantity: 1 }],
    champion: [{ cardId: championId, quantity: 1 }],
    battlefields: [0, 1, 2].map(index => ({
      cardId: `fixture.named-battlefield-${index}`,
      quantity: 1
    }))
  };
}

function validateNamed(
  deck: DeckSubmission,
  rules: ConstructedRules = namedConstructed
) {
  return validateConstructedDeck(deck, namedValidationCards, rules);
}

describe("constructed identity: champion family resolution from the catalog", () => {
  it("accepts a Kennen legend with a matching Kennen champion and signature", () => {
    const result = validateNamed(namedDeck(
      "ven-155-166",
      "ven-113-166",
      [{ cardId: "ven-156-166", quantity: 3 }],
      12
    ));

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.printingIssues).toEqual([]);
  });

  it("rejects another Yordle champion whose family differs although both carry the Yordle tag", () => {
    const result = validateNamed(namedDeck("ven-155-166", "ogn-197-298"));

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("champion_tag_mismatch");
    // The family is resolver-known, so this is a real mismatch, not a metadata
    // gap; the shared Yordle tag must not be used to accept Teemo.
    expect(codes(result)).not.toContain("identity_metadata_unavailable");
    expect(result.issues.find(
      issue => issue.code === "champion_tag_mismatch"
    )).toMatchObject({ cardId: "ogn-197-298", zone: "champion" });
  });

  it("rejects a Teemo signature under a Kennen legend", () => {
    const result = validateNamed(namedDeck(
      "ven-155-166",
      "ven-113-166",
      [{ cardId: "ogn-264-298", quantity: 3 }],
      12
    ));

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("signature_tag_mismatch");
  });

  it("resolves the Nasus alternate and normal printings to the same family without rewriting tags", () => {
    const alternate = validateNamed(namedDeck("ven-192-star-166", "ven-046-166"));
    const normal = validateNamed(namedDeck("ven-145-166", "ven-046-166"));

    expect(alternate.valid).toBe(true);
    expect(alternate.issues).toEqual([]);
    expect(normal.valid).toBe(true);
    expect(normal.issues).toEqual([]);

    // The private lookup keeps the raw per-printing tags and never promotes the
    // region/creature tags to champion families.
    expect(namedConstructed.identityMetadata.byCardId.get("ven-192-star-166"))
      .toMatchObject({ tags: ["Dog", "Shurima", "Nasus"] });
    expect(namedConstructed.identityMetadata.byCardId.get("ven-145-166"))
      .toMatchObject({ tags: ["Nasus"] });
    expect(namedConstructed.identityMetadata.knownChampionTags.has("Nasus"))
      .toBe(true);
    for (const tag of ["Dog", "Shurima", "Yordle"]) {
      expect(namedConstructed.identityMetadata.knownChampionTags.has(tag))
        .toBe(false);
    }
  });

  it("keeps the family fix from releasing an unreleased Radiance legend", () => {
    const result = validateNamed(namedDeck("rad-141-167", "rad-023-167"));

    expect(result.valid).toBe(false);
    // The family resolves, so the block is the printing policy, not a metadata gap.
    expect(codes(result)).not.toContain("identity_metadata_unavailable");
    expect(result.printingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardId: "rad-141-167",
        status: "previewNotReleased"
      }),
      expect.objectContaining({
        cardId: "rad-023-167",
        status: "previewNotReleased"
      })
    ]));
    expect(getConstructedCardPolicy(
      namedConstructed.policy,
      "card.hash-35388dd2b47ca5aff627f64dbadee600be5e2d4c7d1f00c2d412147b43679458"
    )).toEqual({ status: "unreleased", maxCopies: 0, policyType: "limited" });
  });

  it("rejects the contradictory Karma, Channeler record under either legend", () => {
    const underVi = validateNamed(namedDeck("unl-187-219", "ogn-235-298"));
    const underKarma = validateNamed(namedDeck("fixture.karma-legend", "ogn-235-298"));

    expect(underVi.valid).toBe(false);
    expect(codes(underVi)).toContain("identity_metadata_unavailable");
    expect(codes(underVi)).not.toContain("champion_tag_mismatch");
    expect(underVi.issues.find(
      issue => issue.code === "identity_metadata_unavailable"
    )).toMatchObject({ cardId: "ogn-235-298", zone: "champion" });

    // The `Vi` tag on the card must never let it pass as a Vi champion, and the
    // contradictory record must not be reported as a plain family mismatch
    // either.
    expect(underKarma.valid).toBe(false);
    expect(codes(underKarma)).toContain("identity_metadata_unavailable");
    expect(codes(underKarma)).not.toContain("champion_tag_mismatch");
  });

  it("accepts a corrected Karma champion once the catalog records it consistently", () => {
    const result = validateNamed(
      namedDeck("fixture.karma-legend", "fixture.karma-corrected")
    );

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects ambiguous named matches instead of guessing a family", () => {
    const legend = validateNamed(namedDeck("fixture.ambiguous-legend", "ven-113-166"));
    const signature = validateNamed(namedDeck(
      "ven-155-166",
      "ven-113-166",
      [{ cardId: "fixture.ambiguous-signature", quantity: 3 }],
      12
    ));

    expect(legend.valid).toBe(false);
    expect(codes(legend)).toContain("identity_metadata_unavailable");
    expect(codes(legend)).not.toContain("champion_tag_mismatch");
    expect(signature.valid).toBe(false);
    expect(signature.issues.find(
      issue => issue.code === "identity_metadata_unavailable"
    )).toMatchObject({ cardId: "fixture.ambiguous-signature" });
  });

  it("rejects an ambiguous champion unit even when its tags carry the chosen Legend tag", () => {
    // The named catalog really knows both families, so the ambiguity is a
    // catalog fact, not a legacy-fallback artefact.
    expect(namedConstructed.identityMetadata.knownChampionTags.has("Kennen"))
      .toBe(true);
    expect(namedConstructed.identityMetadata.knownChampionTags.has("Teemo"))
      .toBe(true);

    const namedUnit = validateNamed(
      namedDeck("ven-155-166", "fixture.ambiguous-champion")
    );
    const namelessUnit = validateNamed(
      namedDeck("ven-155-166", "fixture.nameless-ambiguous-champion")
    );

    for (const result of [namedUnit, namelessUnit]) {
      expect(result.valid).toBe(false);
      // 2+ known families stay unresolved; the shared Kennen tag must not let
      // the unit through as a Kennen champion.
      expect(codes(result)).toContain("identity_metadata_unavailable");
      expect(codes(result)).not.toContain("champion_tag_mismatch");
    }
    expect(namedUnit.issues.find(
      issue => issue.code === "identity_metadata_unavailable"
    )).toMatchObject({ cardId: "fixture.ambiguous-champion", zone: "champion" });
    expect(namelessUnit.issues.find(
      issue => issue.code === "identity_metadata_unavailable"
    )).toMatchObject({
      cardId: "fixture.nameless-ambiguous-champion",
      zone: "champion"
    });
  });

  it("rejects a champion unit with no catalog-known family tag instead of guessing", () => {
    const result = validateNamed(
      namedDeck("ven-155-166", "fixture.unknown-family-champion")
    );

    expect(result.valid).toBe(false);
    // 0 candidates: the Yordle region tag is not a family, so this stays a
    // metadata gap rather than a mismatch.
    expect(codes(result)).toContain("identity_metadata_unavailable");
    expect(codes(result)).not.toContain("champion_tag_mismatch");
    expect(result.issues.find(
      issue => issue.code === "identity_metadata_unavailable"
    )).toMatchObject({
      cardId: "fixture.unknown-family-champion",
      zone: "champion"
    });
  });

  it("decides a uniquely resolved other family from the family, not the raw region tags", () => {
    const result = validateNamed(namedDeck("ven-155-166", "ogn-036-298"));

    expect(result.valid).toBe(false);
    // Vi resolves uniquely (Piltover is a region tag and is never a family), so
    // this is a real mismatch against the Kennen legend.
    expect(codes(result)).toContain("champion_tag_mismatch");
    expect(codes(result)).not.toContain("identity_metadata_unavailable");
    expect(result.issues.find(
      issue => issue.code === "champion_tag_mismatch"
    )).toMatchObject({ cardId: "ogn-036-298", zone: "champion" });
  });

  it("does not accept an unknown family in a named catalog", () => {
    const result = validateNamed(
      namedDeck("fixture.unknown-family-legend", "ven-113-166")
    );

    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("identity_metadata_unavailable");
    expect(codes(result)).not.toContain("champion_tag_mismatch");
  });

  it("keeps the named champion tag set private and out of the public policy", () => {
    expect(namedConstructed.policy).not.toHaveProperty("identityMetadata");
    expect(JSON.stringify(namedConstructed.policy)).not.toContain(
      "knownChampionTags"
    );
    expect(JSON.stringify(namedConstructed.policy)).not.toContain("byCardId");
    expect(namedConstructed.identityMetadata.byCardId.get("ven-113-166"))
      .toMatchObject({ name: "Kennen", tags: ["Yordle", "Kennen", "Champion"] });
  });
});

describe("constructed identity: the HTTP catalog JSON carries no private mapping", () => {
  it("serves a catalog whose JSON has no byCardId or knownChampionTags", () => {
    const publicCatalog = normalizeCardCatalog({
      schemaVersion: 1,
      dataVersion: "fixture",
      digest: "fixture",
      cards: [
        {
          id: "ven-155-166",
          canonicalCardId: "ven-155-166",
          name: "Heart of the Tempest",
          fullName: "Heart of the Tempest",
          cardType: "Legend",
          domains: ["Order", "Chaos"],
          tags: ["Yordle", "Kennen"],
          setCode: "ven",
          cardNumber: "ven-155",
          variant: "standard",
          imageUrl: null,
          energy: null,
          power: null,
          might: null,
          ability: ""
        },
        {
          id: "ven-113-166",
          canonicalCardId: "ven-113-166",
          name: "Kennen",
          fullName: "Kennen, Storm of Shuriken",
          cardType: "Unit",
          domains: ["Chaos"],
          tags: ["Yordle", "Kennen", "Champion"],
          setCode: "ven",
          cardNumber: "ven-113",
          variant: "standard",
          imageUrl: null,
          energy: 3,
          power: 2,
          might: 3,
          ability: "Fixture ability."
        }
      ]
    });

    const json = JSON.stringify(publicCatalog);
    expect(json).not.toContain("knownChampionTags");
    expect(json).not.toContain("byCardId");
    expect(publicCatalog.cards[0]).not.toHaveProperty("knownChampionTags");
  });
});

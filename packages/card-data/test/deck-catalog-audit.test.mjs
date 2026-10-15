import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildEffectCoverageReport } from "../dist/index.js";
import { buildDeckCatalog } from "../scripts/build-deck-catalog.mjs";

// Fixture-driven regression for the public deck catalog.
//
// Every catalog under test is produced by the real `buildDeckCatalog` builder
// from a synthetic snapshot, so this file runs offline in a fresh checkout.
// The audits that require the gitignored official snapshot live in
// `test/persisted-catalog-audit.mjs` and are run explicitly.

function canonicalIdFor(fullName) {
  return `card.hash-${createHash("sha256")
    .update(fullName, "utf8")
    .digest("hex")}`;
}

function officialCard(overrides = {}) {
  return {
    id: "fix-001-100",
    name: "Flame Warden",
    subtitle: "Ember Guard",
    set: { value: { id: "FIX", label: "Fixture" } },
    publicCode: "FIX-001/100",
    cardType: { type: [{ id: "unit", label: "Unit" }] },
    domain: { values: [] },
    tags: { tags: [] },
    text: { richText: { body: "When this card arrives, draw 1 card." } },
    ...overrides
  };
}

const COMMUNITY_ONLY_CARD = {
  cardCode: "com-001-100",
  name: "Community Card",
  fullName: "Community Card",
  setCode: "com",
  cardNumber: "001-100",
  cardType: "Unit",
  domains: ["Ember"],
  tags: ["community"],
  abilityEffective: ""
};

const FIXTURE_OFFICIAL_CARDS = [
  officialCard({ id: "fix-001-100", publicCode: "FIX-001/100" }),
  officialCard({ id: "fix-001a-100", publicCode: "FIX-001a/100" }),
  officialCard({
    id: "ogn-014-100",
    set: { value: { id: "OGN", label: "Fixture Origins" } },
    publicCode: "OGN-014/100"
  }),
  officialCard({
    id: "sfd-227-221",
    name: "Ahri",
    subtitle: "Inquisitive",
    set: { value: { id: "SFD", label: "Fixture Starlit" } },
    publicCode: "SFD-227/221"
  }),
  officialCard({
    id: "sfd-227-star-221",
    name: "Ahri",
    subtitle: "Inquisitive",
    set: { value: { id: "SFD", label: "Fixture Starlit" } },
    publicCode: "SFD-227*/221"
  }),
  officialCard({
    id: "ven-001-166",
    name: "Kai'Sa",
    subtitle: "Survivor",
    set: { value: { id: "VEN", label: "Fixture Venom" } },
    publicCode: "VEN-001/166",
    text: {
      richText: { body: "When this card arrives, each player discards a card." }
    }
  }),
  officialCard({
    id: "ogn-112-298",
    name: "Kai'Sa",
    subtitle: "Evolutionary",
    set: { value: { id: "OGN", label: "Fixture Origins" } },
    publicCode: "OGN-112/298",
    text: {
      richText: { body: "When this card arrives, each player discards a card." }
    }
  }),
  officialCard({
    id: "fix-003-100",
    name: "Simple Gear",
    subtitle: undefined,
    publicCode: "FIX-003/100",
    text: { richText: { body: "" } }
  }),
  officialCard({
    id: "rad-r01",
    name: "Radiance Rune",
    subtitle: undefined,
    set: { value: { id: "RAD", label: "Fixture Radiance" } },
    publicCode: "RAD-R01/100",
    text: { richText: { body: "" } }
  }),
  officialCard({
    id: "rad-r01a",
    name: "Radiance Rune",
    subtitle: undefined,
    set: { value: { id: "RAD", label: "Fixture Radiance" } },
    publicCode: "RAD-R01a/100",
    text: { richText: { body: "[NO TEXT]" } }
  })
];

function fixtureCatalog() {
  return buildDeckCatalog({
    schemaVersion: 1,
    source: { releaseTag: "fixture-2026-10-12" },
    cards: [
      ...FIXTURE_OFFICIAL_CARDS.map((card) => ({
        cardCode: card.id,
        ...card
      })),
      COMMUNITY_ONLY_CARD
    ],
    localizedGalleries: {
      "en-US": { cards: FIXTURE_OFFICIAL_CARDS },
      "zh-CN": { cards: [] }
    }
  });
}

function groupCardsByCanonical(catalog) {
  const byCanonical = new Map();
  for (const card of catalog.cards) {
    const existing = byCanonical.get(card.canonicalCardId);
    if (existing === undefined) {
      byCanonical.set(card.canonicalCardId, [card]);
    } else {
      existing.push(card);
    }
  }
  return byCanonical;
}

function coverageReportFor(catalog) {
  return buildEffectCoverageReport(
    catalog.cards.map((card) => ({
      id: card.id,
      canonicalCardId: card.canonicalCardId,
      ability: card.ability ?? ""
    }))
  );
}

test("fixture deck catalog groups every printing under one canonical identity", () => {
  const catalog = fixtureCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.cards.length, 11);
  assert.equal(catalog.groups.length, 7);

  const cardsById = new Map();
  for (const card of catalog.cards) {
    assert.equal(cardsById.has(card.id), false, `duplicate printing ${card.id}`);
    cardsById.set(card.id, card);
    if (card.id === COMMUNITY_ONLY_CARD.cardCode) {
      assert.equal(card.canonicalCardId, card.id);
      continue;
    }
    assert.equal(
      card.canonicalCardId,
      canonicalIdFor(card.fullName),
      `canonical id is not derived from the official full name for ${card.id}`
    );
  }

  const cardsByCanonical = groupCardsByCanonical(catalog);
  assert.equal(cardsByCanonical.size, 7);

  const groupsByCanonical = new Map();
  for (const group of catalog.groups) {
    assert.equal(
      groupsByCanonical.has(group.canonicalCardId),
      false,
      `duplicate canonical group ${group.canonicalCardId}`
    );
    groupsByCanonical.set(group.canonicalCardId, group);
    assert.equal(group.printings.includes(group.primaryPrintingId), true);

    const expectedPrintings = cardsByCanonical
      .get(group.canonicalCardId)
      ?.map((card) => card.id)
      .sort();
    assert.notEqual(expectedPrintings, undefined);
    assert.deepEqual([...group.printings].sort(), expectedPrintings);

    if (group.identityProvenance === "unknown-community") {
      assert.equal(group.canonicalCardId, COMMUNITY_ONLY_CARD.cardCode);
      continue;
    }

    assert.equal(group.identityProvenance, "official-name-rule");
    const primary = cardsById.get(group.primaryPrintingId);
    assert.notEqual(primary, undefined);
    assert.equal(primary.canonicalCardId, group.canonicalCardId);
    assert.equal(primary.fullName, group.fullName);
    assert.equal(primary.variant, "standard");
  }
  assert.equal(groupsByCanonical.size, cardsByCanonical.size);

  const unknownGroup = groupsByCanonical.get(COMMUNITY_ONLY_CARD.cardCode);
  assert.notEqual(unknownGroup, undefined);
  assert.equal(unknownGroup.identityProvenance, "unknown-community");
  assert.deepEqual(unknownGroup.printings, [COMMUNITY_ONLY_CARD.cardCode]);
  assert.equal(unknownGroup.primaryPrintingId, COMMUNITY_ONLY_CARD.cardCode);
  assert.deepEqual(unknownGroup.ruleReferences, []);
  assert.equal(
    unknownGroup.reason,
    "Official gallery provenance is unavailable; the printing is isolated."
  );
});

test("alternate and reprint printings share a canonical identity for copy limits", () => {
  const catalog = fixtureCatalog();
  const cardsByCanonical = groupCardsByCanonical(catalog);
  const officialCanonicals = [...cardsByCanonical.entries()].filter(
    ([canonicalCardId]) => canonicalCardId !== COMMUNITY_ONLY_CARD.cardCode
  );

  const multiPrintingIdentities = officialCanonicals.filter(
    ([, printings]) => printings.length > 1
  );
  assert.equal(multiPrintingIdentities.length, 3);

  const variantCounts = { standard: 0, alternate: 0, unknown: 0 };
  for (const card of catalog.cards) {
    variantCounts[card.variant] += 1;
  }
  assert.deepEqual(variantCounts, {
    standard: 7,
    alternate: 3,
    unknown: 1
  });

  const crossSetIdentities = officialCanonicals.filter(
    ([, printings]) => new Set(printings.map((card) => card.setCode)).size > 1
  );
  assert.equal(crossSetIdentities.length, 1);

  // Every alternate art or showcase printing must resolve to the same
  // canonical identity as a standard printing; otherwise a canonical copy
  // limit could leak across separate printing ids.
  let alternateWithoutStandard = 0;
  for (const printings of cardsByCanonical.values()) {
    const hasAlternate = printings.some((card) => card.variant === "alternate");
    const hasStandard = printings.some((card) => card.variant === "standard");
    if (hasAlternate && !hasStandard) alternateWithoutStandard += 1;
  }
  assert.equal(alternateWithoutStandard, 0);

  const groupsByCanonical = new Map(
    catalog.groups.map((group) => [group.canonicalCardId, group])
  );
  for (const [canonicalCardId, printings] of cardsByCanonical) {
    const group = groupsByCanonical.get(canonicalCardId);
    assert.notEqual(group, undefined);
    assert.deepEqual(
      [...group.printings].sort(),
      printings.map((card) => card.id).sort()
    );
  }

  // The showcase `*` alternate resolves under the standard primary printing.
  const ahri = groupsByCanonical.get(canonicalIdFor("Ahri, Inquisitive"));
  assert.notEqual(ahri, undefined);
  assert.equal(ahri.primaryPrintingId, "sfd-227-221");
  assert.deepEqual(
    [...ahri.printings].sort(),
    ["sfd-227-221", "sfd-227-star-221"]
  );
});

test("effect coverage reproduces from the fixture catalog and matches ability text", () => {
  const catalog = fixtureCatalog();
  const report = coverageReportFor(catalog);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.printingCount, 11);
  assert.equal(report.canonicalIdentityCount, 7);
  assert.equal(report.executableCount, 5);
  assert.equal(report.judgeRequiredCount, 3);
  assert.equal(report.noAbilityCount, 3);

  const statusByPrinting = new Map(
    report.entries.map((entry) => [entry.printingId, entry.status])
  );
  for (const printingId of [
    "fix-001-100",
    "fix-001a-100",
    "ogn-014-100",
    "sfd-227-221",
    "sfd-227-star-221"
  ]) {
    assert.equal(statusByPrinting.get(printingId), "executable", printingId);
  }
  for (const printingId of ["ven-001-166", "ogn-112-298", "rad-r01a"]) {
    assert.equal(statusByPrinting.get(printingId), "judge-required", printingId);
  }
  for (const printingId of ["fix-003-100", "rad-r01", "com-001-100"]) {
    assert.equal(statusByPrinting.get(printingId), "no-ability", printingId);
  }

  const cardsById = new Map(catalog.cards.map((card) => [card.id, card]));
  for (const entry of report.entries) {
    const card = cardsById.get(entry.printingId);
    assert.notEqual(card, undefined);
    const hasNoAbilityText = (card.ability ?? "").trim() === "";
    assert.equal(
      entry.status === "no-ability",
      hasNoAbilityText,
      `no-ability classification disagrees with ability text for ${entry.printingId}`
    );
  }
});

test("radiance showcase rune placeholders are judge-required, not no-ability", () => {
  const catalog = fixtureCatalog();
  const statusByPrinting = new Map(
    coverageReportFor(catalog).entries.map((entry) => [
      entry.printingId,
      entry.status
    ])
  );

  // The Radiance showcase Basic Rune carries the upstream sentinel text
  // "[NO TEXT]" instead of an empty ability, so the conservative compiler
  // classifies it as judge-required rather than no-ability.
  const showcase = catalog.cards.find((card) => card.id === "rad-r01a");
  assert.notEqual(showcase, undefined);
  assert.equal(showcase.ability, "[NO TEXT]");
  assert.equal(statusByPrinting.get("rad-r01a"), "judge-required");

  // The blank-text standard Radiance rune remains no-ability.
  assert.equal(statusByPrinting.get("rad-r01"), "no-ability");
});

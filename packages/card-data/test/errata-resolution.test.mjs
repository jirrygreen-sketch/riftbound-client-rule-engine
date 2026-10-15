import assert from "node:assert/strict";
import test from "node:test";

import {
  ERRATA_ANNOUNCEMENTS,
  ERRATA_NOTATION_TABLE,
  buildErrataIndex,
  deriveNotationMap,
  errataAuditReport,
  galleryTokenVocabulary,
  resolveAbilityNotation,
  resolvePrintingErrata,
  splitErrataAnnotation
} from "../scripts/errata.mjs";
import { buildDeckCatalog } from "../scripts/build-deck-catalog.mjs";

// Fixture-driven regressions for evidence-bound errata resolution. Every fixture
// uses the real announcement shapes (printed notation plus `:rb_*:` gallery
// notation) but synthetic ids, so the suite runs offline and never reads the
// gitignored official snapshot.

const GALLERY_HIDDEN_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for " +
  ":rb_energy_0:.)\n" +
  "When you play me, give another friendly unit +3 :rb_might: this turn, then " +
  "recycle me if I was played from face down.";

const NOTATION_HIDDEN_TEXT =
  "[Hidden] (Hide now for [A] to react with later for [0].)\n" +
  "When you play me, give another friendly unit +3 [S] this turn, then recycle " +
  "me if I was played from face down.";

const CORRECTED_HIDDEN_TEXT =
  "[Hidden] (Hide now for [A] to react with later for [0].)\n" +
  "When you play me, give a friendly unit +3 [M] this turn, then recycle me if " +
  "I was played from face down.\n▲\n[OLD TEXT]\n" +
  NOTATION_HIDDEN_TEXT;

const VOCABULARY = galleryTokenVocabulary([
  GALLERY_HIDDEN_TEXT,
  ":rb_energy_1:, :rb_exhaust:: [Reaction]"
]);

function mergedCard(overrides = {}) {
  return {
    cardCode: "fix-001-100",
    fullName: "Fixture Card",
    abilityOriginal: NOTATION_HIDDEN_TEXT,
    abilityCorrected: CORRECTED_HIDDEN_TEXT,
    hasErrata: true,
    matchedErrataCode: "fixture-errata-1",
    ...overrides
  };
}

test("splits a corrected annotation at the ▲ [OLD TEXT] separator", () => {
  const split = splitErrataAnnotation(CORRECTED_HIDDEN_TEXT);
  assert.notEqual(split, null);
  assert.equal(split.printedNotation, NOTATION_HIDDEN_TEXT);
  assert.equal(
    split.effectiveText,
    CORRECTED_HIDDEN_TEXT.split("\n▲\n[OLD TEXT]")[0]
  );
  assert.equal(splitErrataAnnotation(""), null);
  assert.equal(splitErrataAnnotation(undefined), null);

  // An annotation without the marker is corrected text without printed evidence.
  const markerless = splitErrataAnnotation("Corrected only.");
  assert.deepEqual(markerless, {
    effectiveText: "Corrected only.",
    printedNotation: null
  });
});

test("derives the printed-notation correspondence from the printing itself", () => {
  const derived = deriveNotationMap(NOTATION_HIDDEN_TEXT, GALLERY_HIDDEN_TEXT);
  assert.equal(derived.status, "ok");
  assert.equal(derived.map.get("[A]"), ":rb_rune_rainbow:");
  assert.equal(derived.map.get("[0]"), ":rb_energy_0:");
  assert.equal(derived.map.get("[S]"), ":rb_might:");

  // The map is per printing, not a global guess: a token used twice with two
  // different gallery symbols is rejected instead of picking one.
  const ambiguous = deriveNotationMap(
    "[C] and [C]",
    ":rb_rune_fury: and :rb_rune_body:"
  );
  assert.equal(ambiguous.status, "unresolved");
  assert.match(ambiguous.reason, /ambiguous-notation-token \[C\]/);

  const misaligned = deriveNotationMap("[M]", "no symbols here");
  assert.equal(misaligned.status, "unresolved");
  assert.equal(misaligned.reason, "printed-notation-token-count-mismatch");
});

test("resolves only attested notation and never invents a Domain rune", () => {
  const vocabulary = galleryTokenVocabulary([
    ":rb_rune_rainbow: :rb_might: :rb_energy_0: :rb_energy_7: :rb_exhaust:"
  ]);
  const resolved = resolveAbilityNotation("[A] [M] [S] [E] [T] [7]", {
    vocabulary
  });
  assert.equal(resolved.status, "ok");
  assert.equal(
    resolved.text,
    ":rb_rune_rainbow: :rb_might: :rb_might: :rb_exhaust: :rb_exhaust: :rb_energy_7:"
  );

  // `[C]` is a single rune of the card's own Domain. It is deliberately NOT in
  // the documented table: without per-printing correspondence it must stay
  // unresolved rather than guess a Domain.
  assert.equal(ERRATA_NOTATION_TABLE.has("[C]"), false);
  const domain = resolveAbilityNotation("pay [C]", {
    vocabulary: galleryTokenVocabulary([":rb_rune_fury:"])
  });
  assert.equal(domain.status, "unresolved");
  assert.match(domain.reason, /unresolved-notation-token \[C\]/);

  // The documented table is also gated on attestation in the corpus vocabulary.
  const unattested = resolveAbilityNotation("[A]", { vocabulary: new Set() });
  assert.equal(unattested.status, "unresolved");
});

test("verifies one printing when its printed notation reproduces the gallery text", () => {
  const verified = resolvePrintingErrata({
    printingId: "fix-001-100",
    galleryText: GALLERY_HIDDEN_TEXT,
    correctedText: CORRECTED_HIDDEN_TEXT,
    printedNotation: NOTATION_HIDDEN_TEXT,
    errataCode: "fixture-errata-1",
    vocabulary: VOCABULARY
  });
  assert.equal(verified.status, "verified");
  assert.equal(verified.changed, true);
  assert.equal(verified.method, "printing");
  assert.equal(verified.errataCode, "fixture-errata-1");
  assert.equal(
    verified.effectiveText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for " +
      ":rb_energy_0:.)\n" +
      "When you play me, give a friendly unit +3 :rb_might: this turn, then " +
      "recycle me if I was played from face down."
  );

  // The empty-marker case falls back to the merged record's own printed text.
  const emptyMarker = resolvePrintingErrata({
    printingId: "fix-001-100",
    galleryText: GALLERY_HIDDEN_TEXT,
    correctedText: CORRECTED_HIDDEN_TEXT.split("\n▲\n[OLD TEXT]")[0] +
      "\n▲\n[OLD TEXT]",
    printedNotation: NOTATION_HIDDEN_TEXT,
    vocabulary: VOCABULARY
  });
  assert.equal(emptyMarker.status, "verified");
});

test("refuses to resolve errata whose evidence does not reproduce the printed text", () => {
  // No marker in the annotation: the only printed evidence is the caller's own
  // printed text, which does not reproduce the gallery text.
  const wrongPrinted = resolvePrintingErrata({
    printingId: "fix-001-100",
    galleryText: GALLERY_HIDDEN_TEXT,
    correctedText: "Give a friendly unit +3 [M] this turn.",
    printedNotation: "A completely different printed text.",
    vocabulary: VOCABULARY
  });
  assert.equal(wrongPrinted.status, "unresolved");
  // The evidence cannot even line up token-for-token with the gallery text.
  assert.equal(wrongPrinted.reason, "printed-notation-token-count-mismatch");

  // Evidence that lines up token-for-token but renders to different characters is
  // rejected on the round-trip instead.
  const misrendered = resolvePrintingErrata({
    printingId: "fix-001-100",
    galleryText: GALLERY_HIDDEN_TEXT,
    correctedText: "Give a friendly unit +3 [M] this turn.",
    printedNotation:
      "[Hidden] (Hide now for [A] to react with later for [0].)\n" +
      "When you play me, give another friendly unit +3 [M] this turn.",
    vocabulary: VOCABULARY
  });
  assert.equal(misrendered.status, "unresolved");
  assert.equal(
    misrendered.reason,
    "printed-notation-does-not-reproduce-gallery-text"
  );

  const inventedToken = resolvePrintingErrata({
    printingId: "fix-001-100",
    galleryText: GALLERY_HIDDEN_TEXT,
    correctedText: "When you play me, give a friendly unit +3 [S] this [Reaction].",
    printedNotation: NOTATION_HIDDEN_TEXT,
    vocabulary: new Set()
  });
  assert.equal(inventedToken.status, "unresolved");
  assert.match(inventedToken.reason, /unresolved-notation-token/);

  const missingGallery = resolvePrintingErrata({
    printingId: "fix-001-100",
    galleryText: "",
    correctedText: CORRECTED_HIDDEN_TEXT,
    printedNotation: NOTATION_HIDDEN_TEXT
  });
  assert.equal(missingGallery.status, "unresolved");
  assert.equal(missingGallery.reason, "missing-gallery-text");

  const noCorrection = resolvePrintingErrata({
    printingId: "fix-001-100",
    galleryText: GALLERY_HIDDEN_TEXT,
    correctedText: null,
    printedNotation: NOTATION_HIDDEN_TEXT
  });
  assert.equal(noCorrection.reason, "missing-corrected-text");
});

test("inherits verified errata to siblings with identical printed text only", () => {
  const galleryTextById = new Map([
    ["fix-001-100", GALLERY_HIDDEN_TEXT],
    ["fix-001a-100", GALLERY_HIDDEN_TEXT],
    ["fix-002-100", "A different printed text."]
  ]);
  const cards = [
    mergedCard(),
    mergedCard({ cardCode: "fix-001a-100", abilityCorrected: null, hasErrata: false }),
    mergedCard({
      cardCode: "fix-002-100",
      fullName: "Fixture Card",
      abilityCorrected: null,
      hasErrata: false
    })
  ];

  const index = buildErrataIndex({ cards, galleryTextById, vocabulary: VOCABULARY });

  assert.equal(index.resolutions.has("fix-001-100"), true);
  const inherited = index.resolutions.get("fix-001a-100");
  assert.notEqual(inherited, undefined);
  assert.equal(inherited.method, "identity-sibling");
  assert.equal(inherited.originPrintingId, "fix-001-100");
  // A sibling whose printed text differs is never given another card's errata.
  assert.equal(index.resolutions.has("fix-002-100"), false);
  assert.equal(index.stats.propagated, 1);
});

test("reports conflicting sibling errata as unresolved instead of guessing", () => {
  const galleryTextById = new Map([
    ["fix-001-100", GALLERY_HIDDEN_TEXT],
    ["fix-001a-100", GALLERY_HIDDEN_TEXT],
    ["fix-001b-100", GALLERY_HIDDEN_TEXT]
  ]);
  const cards = [
    mergedCard(),
    mergedCard({
      cardCode: "fix-001a-100",
      abilityCorrected: CORRECTED_HIDDEN_TEXT.replace(
        "give a friendly unit",
        "give another friendly unit"
      )
    }),
    mergedCard({ cardCode: "fix-001b-100", abilityCorrected: null, hasErrata: false })
  ];

  const index = buildErrataIndex({ cards, galleryTextById, vocabulary: VOCABULARY });

  assert.deepEqual(index.unresolved, [
    { printingId: "fix-001b-100", reason: "identity-sibling-errata-conflict" }
  ]);
  assert.equal(index.resolutions.has("fix-001b-100"), false);
});

test("keeps printings without official gallery provenance printed", () => {
  const index = buildErrataIndex({
    cards: [mergedCard({ cardCode: "fix-003-100" })],
    galleryTextById: new Map(),
    vocabulary: VOCABULARY
  });

  assert.equal(index.resolutions.size, 0);
  assert.deepEqual(index.unresolved, [
    { printingId: "fix-003-100", reason: "no-official-gallery-printing" }
  ]);
  assert.equal(index.stats.unresolved, 1);
});

test("audit report exposes provenance only and is detached", () => {
  const galleryTextById = new Map([[ "fix-001-100", GALLERY_HIDDEN_TEXT ]]);
  const index = buildErrataIndex({
    cards: [mergedCard()],
    galleryTextById,
    vocabulary: VOCABULARY
  });
  const report = errataAuditReport(index);

  assert.deepEqual(report.unresolved, []);
  assert.equal(report.verified.length, 1);
  assert.deepEqual(Object.keys(report.verified[0]).sort(), [
    "changed",
    "effectiveText",
    "errataCode",
    "method",
    "originPrintingId",
    "printingId"
  ]);
  assert.equal(report.verified[0].effectiveText.includes("▲"), false);
  assert.equal(report.verified[0].effectiveText.includes("[OLD TEXT]"), false);

  report.verified[0].effectiveText = "mutated";
  report.stats.changed = 0;
  const fresh = errataAuditReport(index);
  assert.notEqual(fresh.verified[0].effectiveText, "mutated");
  assert.equal(fresh.stats.changed, 1);
});

test("the deck catalog applies verified errata and keeps unverified text printed", () => {
  const officialCard = {
    id: "fix-001-100",
    name: "Fixture Card",
    set: { value: { id: "FIX", label: "Fixture" } },
    publicCode: "FIX-001/100",
    cardType: { type: [{ id: "unit", label: "Unit" }] },
    domain: { values: [{ label: "Fury" }] },
    tags: { tags: [] },
    text: { richText: { body: GALLERY_HIDDEN_TEXT } }
  };
  const snapshot = {
    schemaVersion: 1,
    dataVersion: "fixture-2026-10-15",
    cards: [
      {
        cardCode: "fix-001-100",
        fullName: "Fixture Card",
        name: "Fixture Card",
        setCode: "fix",
        cardNumber: "001-100",
        cardType: "Unit",
        domains: ["Fury"],
        tags: [],
        abilityOriginal: NOTATION_HIDDEN_TEXT,
        abilityCorrected: CORRECTED_HIDDEN_TEXT,
        hasErrata: true,
        matchedErrataCode: "fixture-errata-1"
      }
    ],
    localizedGalleries: { "en-US": { cards: [officialCard] } }
  };

  const errata = [];
  const catalog = buildDeckCatalog(snapshot, { errata });
  assert.equal(
    catalog.cards[0].ability,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for " +
      ":rb_energy_0:.)\n" +
      "When you play me, give a friendly unit +3 :rb_might: this turn, then " +
      "recycle me if I was played from face down."
  );
  assert.equal(errata.length, 1);
  assert.equal(errata[0].stats.changed, 1);

  // Without verified evidence the printed text is preserved verbatim. Here the
  // annotation's corrected wording uses a symbol the printing's own [OLD TEXT]
  // evidence cannot justify, so the erratum stays printed (judge-required).
  const contradicted = [];
  const unverifiedSnapshot = {
    ...snapshot,
    cards: [{
      ...snapshot.cards[0],
      abilityOriginal:
        "[Hidden]\nWhen you play me, give another friendly unit +3 [S] this " +
        "turn.",
      abilityCorrected:
        "[Hidden]\nEach opposing unit loses 3 [Q] this turn."
    }]
  };
  const unverified = buildDeckCatalog(unverifiedSnapshot, { errata: contradicted });
  assert.equal(unverified.cards[0].ability, GALLERY_HIDDEN_TEXT);
  assert.equal(contradicted[0].stats.unresolved, 1);
  // The marker's printed evidence cannot line up with this printing's gallery
  // text, so the whole annotation is rejected rather than partially applied.
  assert.equal(
    contradicted[0].unresolved[0].reason,
    "printed-notation-token-count-mismatch"
  );
});

// The four Radiance errata published on 2026-10-09 are copied verbatim from
// https://playriftbound.com/en-us/news/announcements/radiance-errata-updates.
// They are DATA (official announcement text), not paraphrases. The `[OLD TEXT]`
// sections are the wording the official gallery still carries, so they are the
// exact evidence the resolver has to reproduce.
const RADIANCE_ERRATA_ANNOUNCEMENTS = [
  {
    name: "Elnuk Herd",
    galleryText:
      "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for " +
      ":rb_energy_0:.)\n" +
      "When you play me, give another friendly unit +3 :rb_might: this turn, then " +
      "recycle me if I was played from face down.",
    printedNotation:
      "[Hidden] (Hide now for [A] to react with later for [0].)\n" +
      "When you play me, give another friendly unit +3 [S] this turn, then " +
      "recycle me if I was played from face down.",
    correctedNotation:
      "[Hidden] (Hide now for [A] to react with later for [0].)\n" +
      "When you play me, give a friendly unit +3 [M] this turn, then recycle me " +
      "if I was played from face down.",
    expectedEffective:
      "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for " +
      ":rb_energy_0:.)\n" +
      "When you play me, give a friendly unit +3 :rb_might: this turn, then " +
      "recycle me if I was played from face down."
  },
  {
    name: "Last Caress",
    galleryText:
      "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "The next unit you play this turn (even from face down) can be played to " +
      "any battlefield. When you play it, [Buff] it. (Give it a +1 :rb_might: " +
      "buff if it doesn't have one.)",
    printedNotation:
      "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "The next unit you play this turn (even from face down) can be played to " +
      "any battlefield. When you play it, [Buff] it. (Give it a +1 [S] buff if " +
      "it doesn't have one.)",
    correctedNotation:
      "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "The next unit you play this turn, even from face down, can be played to " +
      "any battlefield. When you play it, [Buff] it. (Give it a +1 [M] buff if " +
      "it doesn't have one.)",
    expectedEffective:
      "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "The next unit you play this turn, even from face down, can be played to " +
      "any battlefield. When you play it, [Buff] it. (Give it a +1 :rb_might: " +
      "buff if it doesn't have one.)"
  },
  {
    name: "Forbidden Technique",
    galleryText:
      "Ready a unit.\nWhen you play a card with Energy cost :rb_energy_7: or " +
      "more, you may play this from your trash for " +
      ":rb_energy_1::rb_rune_fury::rb_rune_fury:. Banish this.",
    printedNotation:
      "Ready a unit.\nWhen you play a card with Energy cost [7] or more, you " +
      "may play this from your trash for [1][C][C]. Banish this.",
    correctedNotation:
      "Ready a unit.\nWhen you play a card with Energy cost [7] or more, you " +
      "may play this from your trash for [1][C][C]. Then banish this.",
    expectedEffective:
      "Ready a unit.\nWhen you play a card with Energy cost :rb_energy_7: or " +
      "more, you may play this from your trash for " +
      ":rb_energy_1::rb_rune_fury::rb_rune_fury:. Then banish this."
  },
  {
    name: "Neeko, Blending In",
    galleryText:
      "(Neutral cards can go in decks of any Domain.)\n" +
      "If Neeko is in your deck, choose 3 different legends in addition to your " +
      "starting legend. (Different means none match names.)\n" +
      "When you play me, choose one of those legends and add it to your Legend " +
      "Zone while I'm on the board.",
    printedNotation:
      "(Neutral cards can go in decks of any Domain.)\n" +
      "If Neeko is in your deck, choose 3 different legends in addition to your " +
      "starting legend. (Different means none match names.)\n" +
      "When you play me, choose one of those legends and add it to your Legend " +
      "Zone while I'm on the board.",
    correctedNotation:
      "(Neutral cards can go in decks of any Domain.)\n" +
      "If Neeko is in your deck, choose up to 3 different legends in addition " +
      "to your starting legend. (Different means none match names.)\n" +
      "When you play me, choose one of those Legends and add it to your Legend " +
      "Zone while I'm on the board.",
    expectedEffective:
      "(Neutral cards can go in decks of any Domain.)\n" +
      "If Neeko is in your deck, choose up to 3 different legends in addition " +
      "to your starting legend. (Different means none match names.)\n" +
      "When you play me, choose one of those Legends and add it to your Legend " +
      "Zone while I'm on the board."
  }
];

test("reproduces all four published Radiance errata end to end", () => {
  const vocabulary = galleryTokenVocabulary(
    RADIANCE_ERRATA_ANNOUNCEMENTS.map((entry) => entry.galleryText)
  );

  for (const entry of RADIANCE_ERRATA_ANNOUNCEMENTS) {
    const resolution = resolvePrintingErrata({
      printingId: `radiance-fixture:${entry.name}`,
      galleryText: entry.galleryText,
      // The announcement publishes NEW before OLD; the merged snapshot stores the
      // same pair as `abilityCorrected` with the ▲ [OLD TEXT] marker.
      correctedText: `${entry.correctedNotation}\n▲\n[OLD TEXT]\n${entry.printedNotation}`,
      errataCode: `radiance-${entry.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`,
      vocabulary
    });
    assert.equal(resolution.status, "verified", entry.name);
    assert.equal(resolution.changed, true, entry.name);
    assert.equal(resolution.effectiveText, entry.expectedEffective, entry.name);
    // The corrected wording must never carry the announcement marker.
    assert.equal(resolution.effectiveText.includes("▲"), false, entry.name);
    assert.equal(
      resolution.effectiveText.includes("[OLD TEXT]"),
      false,
      entry.name
    );
  }
});

test("documents the official errata announcements with Radiance first", () => {
  assert.equal(ERRATA_ANNOUNCEMENTS[0].set, "Radiance");
  assert.equal(
    ERRATA_ANNOUNCEMENTS[0].url,
    "https://playriftbound.com/en-us/news/announcements/radiance-errata-updates"
  );
  const sets = ERRATA_ANNOUNCEMENTS.map((entry) => entry.set);
  assert.deepEqual(sets, [
    "Radiance",
    "Vendetta",
    "Unleashed",
    "Spiritforged",
    "Origins"
  ]);
  const urls = new Set(ERRATA_ANNOUNCEMENTS.map((entry) => entry.url));
  assert.equal(urls.size, ERRATA_ANNOUNCEMENTS.length);
  for (const entry of ERRATA_ANNOUNCEMENTS) {
    assert.match(entry.url, /^https:\/\//u);
  }
});

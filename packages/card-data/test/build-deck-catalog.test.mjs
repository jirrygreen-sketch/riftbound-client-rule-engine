import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const {
  BuildDeckCatalogError,
  buildDeckCatalog,
  buildLocalizedTexts,
  classifyLocalizedText,
  localizedTextCoverage,
  main,
  parseArguments,
  resolveOutputPath,
  resolveSnapshotPath
} = await import("../scripts/build-deck-catalog.mjs");

const {
  REVIEWED_TAG_CORRECTIONS_VERSION,
  findReviewedTagCorrection,
  listReviewedTagCorrections
} = await import("../scripts/reviewed-card-tags.mjs");

const KARMA_CHANNELER_IMAGE_ASSET_URL =
  "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/aca8664b334f2fa40cc7bae2811dd4e1b4f06388-744x1039.png";

// Mirrors the real official-gallery record for the reviewed printing.
function karmaChannelerOfficialCard(overrides = {}) {
  return {
    id: "ogn-235-298",
    collectorNumber: 235,
    name: "Karma",
    subtitle: "Channeler",
    set: { label: "Card Set", value: { id: "OGN", label: "Origins" } },
    cardType: {
      type: [{ id: "unit", label: "Unit" }],
      superType: [{ id: "champion", label: "Champion" }]
    },
    publicCode: "OGN-235/298",
    domain: { values: [{ id: "order", label: "Order" }] },
    cardImage: { url: `${KARMA_CHANNELER_IMAGE_ASSET_URL}?accountingTag=RB` },
    text: { richText: { body: "<p>Vision.</p>" } },
    energy: { value: { id: 6 } },
    power: { value: { id: 1 } },
    might: { value: { id: 6 } },
    tags: { tags: ["Vi", "Ionia"] },
    ...overrides
  };
}

const PUBLIC_CARD_FIELDS = [
  "ability",
  "canonicalCardId",
  "cardNumber",
  "cardType",
  "domains",
  "energy",
  "fullName",
  "id",
  "imageUrl",
  "might",
  "name",
  "power",
  "setCode",
  "subtitle",
  "tags",
  "variant"
];

const LOCALIZED_CARD_FIELDS = [
  "localizedAbilityLanguage",
  "localizedAbilitySource",
  "localizedAbilityStatus"
];

const ENGLISH_GALLERY_URL =
  "https://example.test/cards?locale=en_US";
const CHINESE_GALLERY_URL =
  "https://example.test/cards?locale=zh_CN";
const ENGLISH_UPDATED_AT = "2026-10-28T14:52:59.390159224Z";
const CHINESE_UPDATED_AT = "2026-10-28T14:50:03.063541516Z";
const SYNCED_AT = "2026-10-28T15:00:00.000Z";

function localizedGalleries(english, chinese) {
  return {
    "en-US": {
      url: ENGLISH_GALLERY_URL,
      resultsUpdatedAt: ENGLISH_UPDATED_AT,
      cards: english
    },
    "zh-CN": {
      url: CHINESE_GALLERY_URL,
      resultsUpdatedAt: CHINESE_UPDATED_AT,
      cards: chinese
    }
  };
}

function localizedSnapshot(english, chinese, cards = english.map((card) =>
  printingCard(card)
)) {
  const galleries = localizedGalleries(english, chinese);
  return {
    schemaVersion: 1,
    dataVersion: "2026-10-28-localized-fixture",
    cards,
    localizedTexts: {
      "zh-CN": buildLocalizedTexts(
        galleries["en-US"],
        galleries["zh-CN"],
        SYNCED_AT
      )
    },
    localizedGalleries: galleries
  };
}

function officialCard(overrides = {}) {
  return {
    id: "fix-001-100",
    name: "Flame Warden",
    subtitle: "Ember Guard",
    set: { value: { id: "FIX", label: "Fixture" } },
    publicCode: "FIX-001/100",
    cardType: {
      type: [{ id: "unit", label: "Unit" }],
      superType: [{ id: "champion", label: "Champion" }]
    },
    domain: { values: [{ id: "ember", label: "Ember" }] },
    cardImage: { url: "https://example.test/flame.png" },
    text: {
      richText: {
        body: "<p>First line<br />Second line</p>"
      }
    },
    energy: { value: { id: 2 } },
    power: { value: { id: 3 } },
    might: { value: { id: 4 } },
    tags: { tags: ["Flame", "Ember"] },
    ...overrides
  };
}

function printingCard(official, overrides = {}) {
  return {
    cardCode: official.id,
    ...official,
    ...overrides
  };
}

function snapshot(english, chinese = [], cards = english.map((card) => printingCard(card))) {
  return {
    schemaVersion: 1,
    source: { releaseTag: "v2026-10-11" },
    cards,
    localizedGalleries: {
      "en-US": { cards: english },
      "zh-CN": { cards: chinese }
    }
  };
}

function findCard(catalog, id) {
  const card = catalog.cards.find((entry) => entry.id === id);
  assert.notEqual(card, undefined);
  return card;
}

test("groups exact official full names across sets and art variants", () => {
  const standard = officialCard({
    id: "fix-001-100",
    publicCode: "FIX-001/100"
  });
  const alternate = officialCard({
    id: "fix-001a-100",
    publicCode: "FIX-001a/100"
  });
  const reprint = officialCard({
    id: "ogn-014-100",
    set: { value: { id: "OGN", label: "Origins" } },
    publicCode: "OGN-014/100"
  });
  const catalog = buildDeckCatalog(
    snapshot([standard, alternate, reprint])
  );

  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.cards.length, 3);
  assert.equal(findCard(catalog, "fix-001-100").variant, "standard");
  assert.equal(findCard(catalog, "fix-001a-100").variant, "alternate");
  assert.equal(findCard(catalog, "ogn-014-100").variant, "standard");
  assert.equal(
    new Set(catalog.cards.map((card) => card.canonicalCardId)).size,
    1
  );

  const group = catalog.groups[0];
  assert.equal(group.identityProvenance, "official-name-rule");
  assert.deepEqual(group.ruleReferences, [
    "CR 132.3",
    "CR 132.4",
    "TR 601.2.a"
  ]);
  assert.equal(group.fullName, "Flame Warden, Ember Guard");
  assert.equal(group.primaryPrintingId, "fix-001-100");
  assert.deepEqual(group.printings, [
    "fix-001-100",
    "fix-001a-100",
    "ogn-014-100"
  ]);
});

test("keeps different champion subtitles separate and never fuzzy-merges names", () => {
  const survivor = officialCard({
    id: "ven-001-166",
    name: "Kai'Sa",
    subtitle: "Survivor",
    publicCode: "VEN-001/166"
  });
  const evolutionary = officialCard({
    id: "ogn-112-298",
    name: "Kai'Sa",
    subtitle: "Evolutionary",
    publicCode: "OGN-112/298"
  });
  const nearMiss = officialCard({
    id: "fix-002-100",
    subtitle: "Ember Guards",
    publicCode: "FIX-002/100"
  });
  const flame = officialCard();
  const catalog = buildDeckCatalog(
    snapshot([survivor, evolutionary, nearMiss, flame])
  );

  const identities = new Set(catalog.cards.map((card) => card.canonicalCardId));
  assert.equal(identities.size, 4);
  assert.notEqual(
    findCard(catalog, "ven-001-166").canonicalCardId,
    findCard(catalog, "ogn-112-298").canonicalCardId
  );
  assert.notEqual(
    findCard(catalog, "fix-002-100").canonicalCardId,
    findCard(catalog, "fix-001-100").canonicalCardId
  );
});

test("maps localized Chinese fields and preserves multiline and empty abilities", () => {
  const card = officialCard();
  const chinese = {
    ...card,
    name: "烈焰守卫",
    subtitle: "余烬卫士"
  };
  const plain = officialCard({
    id: "fix-003-100",
    name: "Simple Gear",
    subtitle: undefined,
    publicCode: "FIX-003/100",
    text: { richText: { body: "" } }
  });
  const catalog = buildDeckCatalog(
    snapshot([card, plain], [chinese, { ...plain, name: "简单装备" }])
  );

  const localized = findCard(catalog, "fix-001-100");
  assert.equal(localized.localizedName, "烈焰守卫");
  assert.equal(localized.localizedSubtitle, "余烬卫士");
  assert.equal(localized.ability, "First line\nSecond line");
  assert.equal(localized.fullName, "Flame Warden, Ember Guard");
  assert.equal(localized.subtitle, "Ember Guard");

  const empty = findCard(catalog, "fix-003-100");
  assert.equal(empty.ability, "");
  assert.equal(empty.localizedName, "简单装备");
  assert.equal("localizedSubtitle" in empty, false);
});

test("recognizes explicit official publicCode alternate indicators", () => {
  const star = officialCard({
    id: "fix-001-star-100",
    publicCode: "FIX-001-star/100"
  });
  const suffixA = officialCard({
    id: "fix-001a-100",
    publicCode: "FIX-001a/100"
  });
  const standard = officialCard({
    id: "fix-001-100",
    publicCode: "FIX-001/100"
  });
  const catalog = buildDeckCatalog(snapshot([standard, suffixA, star]));

  assert.equal(findCard(catalog, "fix-001-100").variant, "standard");
  assert.equal(findCard(catalog, "fix-001a-100").variant, "alternate");
  assert.equal(findCard(catalog, "fix-001-star-100").variant, "alternate");
});

test("classifies the official ASCII star suffix and keeps a standard primary", () => {
  const standard = officialCard({
    id: "sfd-227-221",
    name: "Ahri",
    subtitle: "Inquisitive",
    set: { value: { id: "SFD", label: "Starlit Destinies" } },
    publicCode: "SFD-227/221"
  });
  const showcase = officialCard({
    id: "sfd-227-star-221",
    name: "Ahri",
    subtitle: "Inquisitive",
    set: { value: { id: "SFD", label: "Starlit Destinies" } },
    publicCode: "SFD-227*/221"
  });
  const catalog = buildDeckCatalog(snapshot([standard, showcase]));

  assert.equal(findCard(catalog, "sfd-227-221").variant, "standard");
  assert.equal(findCard(catalog, "sfd-227-star-221").variant, "alternate");
  assert.equal(catalog.groups.length, 1);
  assert.equal(catalog.groups[0].primaryPrintingId, "sfd-227-221");
});

test("preserves official superType Champion metadata in tags", () => {
  const card = officialCard({
    id: "fix-004-100",
    publicCode: "FIX-004/100",
    tags: { tags: ["Flame"] }
  });
  const catalog = buildDeckCatalog(snapshot([card]));
  const publicCard = findCard(catalog, "fix-004-100");

  assert.deepEqual(publicCard.tags, ["Flame", "Champion"]);
});

test("isolates uncertain community-only printings instead of guessing identity", () => {
  const community = {
    cardCode: "com-001-100",
    name: "Community Card",
    subtitle: "Unverified",
    fullName: "Community Card, Unverified",
    setCode: "com",
    cardNumber: "001-100",
    cardType: "Unit",
    domains: ["Ember"],
    tags: ["community"],
    imageUrl: "https://example.test/community.png",
    energy: 1,
    power: 1,
    might: 1,
    abilityEffective: ""
  };
  const catalog = buildDeckCatalog({
    dataVersion: "2026-10-11-community",
    cards: [community]
  });

  const card = catalog.cards[0];
  assert.equal(card.id, "com-001-100");
  assert.equal(card.canonicalCardId, "com-001-100");
  assert.equal(card.variant, "unknown");
  assert.deepEqual(catalog.groups, [
    {
      canonicalCardId: "com-001-100",
      identityProvenance: "unknown-community",
      ruleReferences: [],
      reason: "Official gallery provenance is unavailable; the printing is isolated.",
      primaryPrintingId: "com-001-100",
      printings: ["com-001-100"]
    }
  ]);
});

test("emits only public fields and computes a deterministic digest", () => {
  const card = officialCard();
  const first = buildDeckCatalog(snapshot([card]));
  const second = buildDeckCatalog({
    ...snapshot([card]),
    source: { releaseTag: "different-download-tag" }
  }, { dataVersion: first.dataVersion });

  assert.match(first.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(
    Object.keys(first.cards[0]).sort(),
    [
      "ability",
      "canonicalCardId",
      "cardNumber",
      "cardType",
      "domains",
      "energy",
      "fullName",
      "id",
      "imageUrl",
      "might",
      "name",
      "power",
      "setCode",
      "subtitle",
      "tags",
      "variant"
    ]
  );
});

test("classifies localized rules and effect text independently with strict fallbacks", () => {
  const structured = officialCard({
    id: "fix-101-100",
    publicCode: "FIX-101/100",
    text: { richText: { body: "<p>Draw 1.</p>" } },
    effect: { richText: { body: "<p>At end of turn, discard 1.</p>" } }
  });
  const structuredZh = {
    ...structured,
    name: "结构中文",
    text: { richText: { body: "<p>抽一张牌。</p>" } },
    effect: { richText: { body: "<p>在你回合结束时，弃置一张牌。</p>" } }
  };
  const identical = officialCard({
    id: "fix-102-100",
    publicCode: "FIX-102/100",
    text: { richText: { body: "<p>English only.</p>" } }
  });
  const identicalZh = {
    ...identical,
    name: "英文相同",
    text: { richText: { body: "<p>English only.</p>" } }
  };
  const missing = officialCard({
    id: "fix-103-100",
    publicCode: "FIX-103/100",
    text: { richText: { body: "<p>Draw 2.</p>" } }
  });
  const missingZh = { ...missing, name: "缺正文" };
  delete missingZh.text;
  const noEffect = officialCard({
    id: "fix-104-100",
    publicCode: "FIX-104/100",
    text: undefined
  });
  const noEffectZh = { ...noEffect, name: "无效果" };
  delete noEffectZh.text;
  const catalog = buildDeckCatalog(localizedSnapshot(
    [structured, identical, missing, noEffect],
    [structuredZh, identicalZh, missingZh, noEffectZh]
  ));

  const structuredCard = findCard(catalog, structured.id);
  assert.equal(structuredCard.localizedAbilityRulesText, "<p>抽一张牌。</p>");
  assert.equal(
    structuredCard.localizedAbilityEffectText,
    "<p>在你回合结束时，弃置一张牌。</p>"
  );
  assert.equal(structuredCard.localizedAbilityLanguage, "zh-CN");
  assert.equal(structuredCard.localizedAbilityStatus, "official-structured");
  assert.deepEqual(structuredCard.localizedAbilitySource, {
    url: CHINESE_GALLERY_URL,
    locale: "zh-CN",
    updatedAt: CHINESE_UPDATED_AT,
    syncedAt: SYNCED_AT
  });

  const fallback = findCard(catalog, identical.id);
  assert.equal(fallback.localizedAbilityRulesText, "<p>English only.</p>");
  assert.equal("localizedAbilityEffectText" in fallback, false);
  assert.equal(fallback.localizedAbilityLanguage, "en-US");
  assert.equal(fallback.localizedAbilityStatus, "english-fallback");

  const missingCard = findCard(catalog, missing.id);
  assert.equal("localizedAbilityRulesText" in missingCard, false);
  assert.equal("localizedAbilityEffectText" in missingCard, false);
  assert.equal("localizedAbilityLanguage" in missingCard, false);
  assert.equal(missingCard.localizedAbilityStatus, "missing");

  const noEffectCard = findCard(catalog, noEffect.id);
  assert.equal("localizedAbilityRulesText" in noEffectCard, false);
  assert.equal("localizedAbilityEffectText" in noEffectCard, false);
  assert.equal(noEffectCard.localizedAbilityStatus, "no-effect");

  assert.equal(
    classifyLocalizedText(structured, structuredZh, structured.id),
    "official-structured"
  );
  assert.equal(
    classifyLocalizedText(identical, identicalZh, identical.id),
    "english-fallback"
  );
  assert.equal(
    classifyLocalizedText(missing, missingZh, missing.id),
    "missing"
  );
  assert.equal(
    classifyLocalizedText(noEffect, noEffectZh, noEffect.id),
    "no-effect"
  );

  const markupOnlyDifference = {
    ...identical,
    id: "fix-106-100",
    publicCode: "FIX-106/100",
    text: { richText: { body: "<p>English only.</p>" } }
  };
  const markupOnlyDifferenceZh = {
    ...markupOnlyDifference,
    name: "标记不同",
    text: { richText: { body: "English only." } }
  };
  assert.equal(
    classifyLocalizedText(
      markupOnlyDifference,
      markupOnlyDifferenceZh,
      markupOnlyDifference.id
    ),
    "missing"
  );
});

test("supplements only a strictly matching official Equip accessibility fragment", () => {
  const card = officialCard({
    id: "sfd-095-221",
    name: "Doran's Blade",
    publicCode: "SFD-095/221",
    cardType: { type: [{ id: "gear", label: "Gear" }] },
    domain: { values: [{ id: "body", label: "Body" }] },
    text: {
      richText: {
        body: "<p>[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)</p>"
      }
    },
    cardImage: {
      url: "https://example.test/dorans-blade.png",
      accessibilityText:
        "Riftbound Gear: 多兰之刃. [装配][C]（支付[C]：将此牌贴附到你控制的一名单位上。）"
    }
  });
  const chinese = {
    ...card,
    name: "多兰之刃",
    text: undefined
  };
  const catalog = buildDeckCatalog(localizedSnapshot([card], [chinese]));
  const publicCard = findCard(catalog, card.id);

  assert.equal(
    publicCard.localizedAbilityRulesText,
    "[装配]:rb_rune_body:（支付:rb_rune_body:：将此牌贴附到你控制的一名单位上。）"
  );
  assert.equal(
    publicCard.localizedAbilityStatus,
    "official-accessibility-supplemented"
  );

  const multipleRunes = {
    ...card,
    id: "sfd-096-221",
    publicCode: "SFD-096/221",
    text: {
      richText: {
        body: "<p>[Equip] :rb_energy_1::rb_rune_body: (:rb_energy_1::rb_rune_body:: Attach this to a unit you control.)</p>"
      }
    }
  };
  const multipleZh = {
    ...chinese,
    id: multipleRunes.id,
    publicCode: multipleRunes.publicCode
  };
  assert.equal(
    classifyLocalizedText(multipleRunes, multipleZh, multipleRunes.id),
    "missing"
  );
});

test("keeps the localized fields optional for legacy snapshots", () => {
  const card = officialCard();
  const catalog = buildDeckCatalog(snapshot([card]));
  const legacy = findCard(catalog, card.id);

  assert.equal(legacy.localizedAbilityRulesText, undefined);
  assert.equal(legacy.localizedAbilityEffectText, undefined);
  assert.equal(legacy.localizedAbilityLanguage, undefined);
  assert.equal(legacy.localizedAbilityStatus, undefined);
  assert.equal(legacy.localizedAbilitySource, undefined);
});

test("fails closed on tampered, incomplete, unknown, and drifted localization data", () => {
  const english = officialCard();
  const chinese = {
    ...english,
    name: "烈焰守卫",
    text: { richText: { body: "<p>抽一张牌。</p>" } }
  };
  const valid = localizedSnapshot([english], [chinese]);

  const tampered = structuredClone(valid);
  tampered.localizedTexts["zh-CN"].cards[0].rulesTextHtml =
    "<p>篡改正文</p>";
  assert.throws(
    () => buildDeckCatalog(tampered),
    /does not match the official galleries/
  );

  const missingAuditRecord = structuredClone(valid);
  missingAuditRecord.localizedTexts["zh-CN"].cards = [];
  assert.throws(
    () => buildDeckCatalog(missingAuditRecord),
    /does not match the official galleries/
  );

  const tamperedStatus = structuredClone(valid);
  tamperedStatus.localizedTexts["zh-CN"].cards[0].status =
    "official-accessibility-supplemented";
  assert.throws(
    () => buildDeckCatalog(tamperedStatus),
    /does not match the official galleries/
  );

  const unknownToken = officialCard({
    id: "fix-105-100",
    publicCode: "FIX-105/100",
    text: { richText: { body: "<p>Draw :rb_energy_1:.</p>" } }
  });
  const unknownTokenZh = {
    ...unknownToken,
    name: "未知符号",
    text: { richText: { body: "<p>抽:rb_not_a_token:。</p>" } }
  };
  assert.throws(
    () => localizedSnapshot([unknownToken], [unknownTokenZh]),
    /unknown gallery token :rb_not_a_token:/
  );

  const malformedBody = {
    ...chinese,
    text: { richText: {} }
  };
  assert.throws(
    () => localizedSnapshot([english], [malformedBody]),
    /malformed richText body/
  );

  assert.throws(
    () => localizedSnapshot(
      [english],
      [{ ...chinese, id: "fix-999-100" }]
    ),
    /different printing ids/
  );
});

test("reports localized coverage at the printing and set level", () => {
  const structured = officialCard({
    id: "fix-111-100",
    publicCode: "FIX-111/100",
    text: { richText: { body: "<p>Draw 1.</p>" } }
  });
  const fallback = officialCard({
    id: "fix-112-100",
    publicCode: "FIX-112/100",
    text: { richText: { body: "<p>English only.</p>" } }
  });
  const missing = officialCard({
    id: "fix-113-100",
    publicCode: "FIX-113/100",
    text: { richText: { body: "<p>Draw 3.</p>" } }
  });
  const noEffect = officialCard({
    id: "fix-114-100",
    publicCode: "FIX-114/100",
    text: undefined
  });
  const chinese = [
    { ...structured, name: "中文一", text: { richText: { body: "<p>抽一张牌。</p>" } } },
    { ...fallback, name: "中文二" },
    { ...missing, name: "中文三", text: undefined },
    { ...noEffect, name: "中文四", text: undefined }
  ];
  const galleries = localizedGalleries(
    [structured, fallback, missing, noEffect],
    chinese
  );
  const coverage = localizedTextCoverage(
    galleries["en-US"],
    galleries["zh-CN"]
  );

  assert.deepEqual({
    catalogPrintings: coverage.catalogPrintings,
    effectPrintings: coverage.effectPrintings,
    officialStructured: coverage.officialStructured,
    officialAccessibilitySupplemented:
      coverage.officialAccessibilitySupplemented,
    displayableChinese: coverage.displayableChinese,
    englishFallback: coverage.englishFallback,
    missing: coverage.missing,
    noEffect: coverage.noEffect
  }, {
    catalogPrintings: 4,
    effectPrintings: 3,
    officialStructured: 1,
    officialAccessibilitySupplemented: 0,
    displayableChinese: 1,
    englishFallback: 1,
    missing: 1,
    noEffect: 1
  });
  assert.deepEqual(coverage.sets.fix, {
    catalog: 4,
    effect: 3,
    officialStructured: 1,
    officialAccessibilitySupplemented: 0,
    displayableChinese: 1,
    englishFallback: 1,
    missing: 1,
    noEffect: 1
  });
});

test("parses CLI options and writes the catalog atomically", async () => {
  const options = parseArguments([
    "--snapshot",
    "snapshot.json",
    "--output",
    "catalog.json",
    "--data-version",
    "2026-10-11-official",
    "--dry-run"
  ]);
  assert.deepEqual(options, {
    snapshot: "snapshot.json",
    output: "catalog.json",
    dataVersion: "2026-10-11-official",
    dryRun: true,
    help: false
  });
  assert.equal(resolveSnapshotPath("snapshot.json"), path.resolve("snapshot.json"));
  assert.equal(resolveOutputPath("catalog.json"), path.resolve("catalog.json"));
  assert.throws(
    () => parseArguments(["--nope"]),
    (error) => error instanceof BuildDeckCatalogError
  );

  const directory = await mkdtemp(path.join(os.tmpdir(), "deck-catalog-"));
  try {
    const snapshotPath = path.join(directory, "snapshot.json");
    const outputPath = path.join(directory, "catalog.json");
    await writeFile(
      snapshotPath,
      `${JSON.stringify(snapshot([officialCard()]))}\n`
    );
    const logs = [];
    const exitCode = await main([
      "--snapshot",
      snapshotPath,
      "--output",
      outputPath,
      "--data-version",
      "2026-10-11-official"
    ], { log: (message) => logs.push(message) });

    assert.equal(exitCode, 0);
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(parsed.dataVersion, "2026-10-11-official");
    assert.equal(parsed.cards.length, 1);
    assert.match(logs[0], /Built 1 cards and 1 identity groups/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrects the reviewed Karma, Channeler printing tag Vi to Karma", () => {
  const karma = karmaChannelerOfficialCard();
  const sibling = karmaChannelerOfficialCard({
    id: "sfd-237-221",
    collectorNumber: 237,
    set: { label: "Card Set", value: { id: "SFD", label: "Starlit Destinies" } },
    publicCode: "SFD-237/221",
    cardImage: { url: "https://example.test/karma-sfd.png" },
    tags: { tags: ["Karma"] }
  });
  const catalog = buildDeckCatalog(snapshot([karma, sibling]));

  const corrected = findCard(catalog, "ogn-235-298");
  assert.deepEqual(corrected.tags, ["Karma", "Ionia", "Champion"]);
  assert.equal(corrected.name, "Karma");
  assert.equal(corrected.fullName, "Karma, Channeler");
  assert.equal(corrected.cardType, "Unit");
  assert.deepEqual(corrected.domains, ["Order"]);
  // public schema stays backward compatible: no new fields are introduced
  assert.deepEqual(Object.keys(corrected).sort(), PUBLIC_CARD_FIELDS);

  // the sibling printing of the same identity is left untouched
  const other = findCard(catalog, "sfd-237-221");
  assert.deepEqual(other.tags, ["Karma", "Champion"]);
  assert.equal(other.canonicalCardId, corrected.canonicalCardId);
});

test("does not rewrite unrelated Vi printings to Karma", () => {
  const vi = officialCard({
    id: "fix-999-100",
    name: "Vi",
    subtitle: "Piltover Enforcer",
    publicCode: "FIX-999/100",
    tags: { tags: ["Vi", "Piltover"] }
  });
  const notChampion = officialCard({
    id: "fix-998-100",
    name: "Ionia Relic",
    subtitle: undefined,
    publicCode: "FIX-998/100",
    tags: { tags: ["Ionia"] }
  });
  const catalog = buildDeckCatalog(snapshot([vi, notChampion]));

  assert.deepEqual(findCard(catalog, "fix-999-100").tags, [
    "Vi",
    "Piltover",
    "Champion"
  ]);
  assert.deepEqual(findCard(catalog, "fix-998-100").tags, ["Ionia", "Champion"]);
  assert.equal(
    findCard(catalog, "fix-999-100").tags.includes("Karma"),
    false
  );
});

test("reports a conflict instead of silently overriding a drifted reviewed printing", () => {
  const unknownImage = karmaChannelerOfficialCard({
    cardImage: { url: "https://example.test/unknown-karma.png" }
  });
  assert.throws(
    () => buildDeckCatalog(snapshot([unknownImage])),
    (error) =>
      error.name === "ReviewedTagCorrectionConflictError" &&
      /ogn-235-298/.test(error.message)
  );

  const driftedName = karmaChannelerOfficialCard({ name: "Karma?" });
  assert.throws(
    () => buildDeckCatalog(snapshot([driftedName])),
    (error) =>
      error.name === "ReviewedTagCorrectionConflictError" &&
      /ogn-235-298/.test(error.message)
  );
});

test("leaves the input snapshot object untouched while correcting tags", () => {
  const input = snapshot([karmaChannelerOfficialCard()]);
  const frozen = JSON.parse(JSON.stringify(input));

  const catalog = buildDeckCatalog(input);

  assert.deepEqual(input, frozen);
  assert.deepEqual(input.cards[0].tags, { tags: ["Vi", "Ionia"] });
  assert.notEqual(
    findCard(catalog, "ogn-235-298").tags,
    input.cards[0].tags.tags
  );
});

test("is idempotent and digest-stable for the reviewed printing", () => {
  const fromWrong = buildDeckCatalog(
    snapshot([karmaChannelerOfficialCard()])
  );

  const alreadyCorrect = karmaChannelerOfficialCard({
    tags: { tags: ["Karma", "Ionia"] }
  });
  const fromCorrect = buildDeckCatalog(snapshot([alreadyCorrect]));

  const correctedTags = findCard(fromCorrect, "ogn-235-298").tags;
  assert.deepEqual(correctedTags, ["Karma", "Ionia", "Champion"]);
  assert.equal(correctedTags.filter((tag) => tag === "Karma").length, 1);

  // both the defective and the already-correct inputs converge on one catalog
  assert.equal(fromWrong.digest, fromCorrect.digest);
  assert.equal(
    fromWrong.digest,
    buildDeckCatalog(snapshot([karmaChannelerOfficialCard()])).digest
  );
});

async function runBuild(snapshotObject, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "deck-catalog-log-"));
  try {
    const snapshotPath = path.join(directory, "snapshot.json");
    const outputPath = path.join(directory, "catalog.json");
    await writeFile(snapshotPath, `${JSON.stringify(snapshotObject)}\n`);
    const logs = [];
    const exitCode = await main([
      "--snapshot",
      snapshotPath,
      "--output",
      outputPath,
      "--data-version",
      options.dataVersion ?? "2026-10-13-test",
      ...(options.dryRun === true ? ["--dry-run"] : [])
    ], { log: (message) => logs.push(message) });
    const catalog = exitCode === 0
      ? JSON.parse(await readFile(outputPath, "utf8"))
      : undefined;
    return { exitCode, logs, catalog };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("reports a reviewed correction only when this build actually applies it", async () => {
  const result = await runBuild(snapshot([karmaChannelerOfficialCard()]));

  assert.equal(result.exitCode, 0);
  assert.ok(
    result.logs.some((line) =>
      /Reviewed tag corrections applied: ogn-235-298: Vi->Karma\./.test(line)
    ),
    `expected an applied-correction log, got: ${result.logs.join(" | ")}`
  );
  assert.deepEqual(findCard(result.catalog, "ogn-235-298").tags, [
    "Karma",
    "Ionia",
    "Champion"
  ]);
});

test("does not report a correction when the input is already correct", async () => {
  const alreadyCorrect = karmaChannelerOfficialCard({
    tags: { tags: ["Karma", "Ionia"] }
  });
  const result = await runBuild(snapshot([alreadyCorrect]));

  assert.equal(result.exitCode, 0);
  assert.deepEqual(findCard(result.catalog, "ogn-235-298").tags, [
    "Karma",
    "Ionia",
    "Champion"
  ]);
  assert.equal(
    result.logs.some((line) => line.includes("Reviewed tag corrections")),
    false,
    `expected no correction log, got: ${result.logs.join(" | ")}`
  );
});

test("does not report a correction when a skip conflict leaves tags untouched", async () => {
  // No official gallery match => unknown-community path with onConflict "skip".
  // The printing id matches a reviewed record but the identity guard does not,
  // so no correction is applied and nothing must be reported as corrected.
  const communityOnly = {
    cardCode: "ogn-235-298",
    name: "Community Karma",
    fullName: "Community Karma",
    setCode: "ogn",
    cardNumber: "235-298",
    cardType: "Unit",
    domains: ["Order"],
    tags: ["Vi", "Ionia"],
    imageUrl: "https://example.test/community-karma.png",
    energy: 6,
    power: 1,
    might: 6,
    abilityEffective: ""
  };
  const result = await runBuild({
    dataVersion: "2026-10-13-community",
    cards: [communityOnly]
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(findCard(result.catalog, "ogn-235-298").tags, ["Vi", "Ionia"]);
  assert.equal(
    result.logs.some((line) => line.includes("Reviewed tag corrections")),
    false,
    `expected no correction log, got: ${result.logs.join(" | ")}`
  );
});

test("exposes a versioned, detached tool-internal review record", () => {
  const records = listReviewedTagCorrections();
  const record = records.find((entry) => entry.printingId === "ogn-235-298");
  assert.notEqual(record, undefined);
  assert.equal(record.wrongTag, "Vi");
  assert.equal(record.correctedTag, "Karma");
  assert.equal(record.version, REVIEWED_TAG_CORRECTIONS_VERSION);
  assert.match(record.imageAssetSha256, /^sha256:[a-f0-9]{64}$/);

  // the listed copy is detached from the frozen source table
  record.mutated = true;
  assert.equal(
    findReviewedTagCorrection("ogn-235-298").mutated,
    undefined
  );
});

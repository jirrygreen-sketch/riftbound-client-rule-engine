import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const {
  BuildDeckCatalogError,
  buildDeckCatalog,
  main,
  parseArguments,
  resolveOutputPath,
  resolveSnapshotPath
} = await import("../scripts/build-deck-catalog.mjs");

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

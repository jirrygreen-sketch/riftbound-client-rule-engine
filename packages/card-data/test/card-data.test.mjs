import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CARD_DATA_SCHEMA_VERSION,
  SYNTHETIC_DEMO_BUNDLE,
  SYNTHETIC_DEMO_COLLECTION_ID,
  SYNTHETIC_DEMO_DATA_SET,
  SYNTHETIC_DEMO_DATA_VERSION,
  SYNTHETIC_DEMO_MANIFEST,
  TRIGGER_CONQUER_CARD,
  computeCardDataSetDigest,
  createCardDataBundle,
  createCardDataManifest,
  createCardDataRegistry,
  createCardDataSet,
  buildEffectCoverageReport,
  isCardDataBundle,
  isCardDataManifest,
  isCardDataRegistry,
  isCardDataSet,
  isCardDataSetContent,
  isCardDefinition,
  isDeckList,
  validateDeck
} from "../dist/index.js";

const secondCard = {
  id: "card.synthetic-shield",
  collectionId: SYNTHETIC_DEMO_COLLECTION_ID,
  name: "Synthetic Shield",
  cardType: "gear",
  cost: { energy: 2, power: 0 },
  tags: ["synthetic-demo", "defensive"]
};

const identityPrintingCard = {
  ...secondCard,
  cardCode: "syn-042",
  cardImage: "https://example.test/synthetic-shield.png",
  setCode: "syn",
  collectorNumber: "042",
  officialCardId: "syn-042",
  canonicalCardId: "card.synthetic-shield",
  rulesIdentityKey: "rule.synthetic-shield",
  printingKind: "normal",
  variantKey: "syn-042-normal",
  identitySource: "officialCardId",
  identityConfidence: "explicit",
  identityScope: "official-id"
};

function createDataSet(cards = [TRIGGER_CONQUER_CARD, secondCard]) {
  return createCardDataSet({
    schemaVersion: CARD_DATA_SCHEMA_VERSION,
    collectionId: SYNTHETIC_DEMO_COLLECTION_ID,
    dataVersion: SYNTHETIC_DEMO_DATA_VERSION,
    cards
  });
}

test("exports a compatible synthetic Trigger Conquer record", () => {
  assert.equal(isCardDefinition(TRIGGER_CONQUER_CARD), true);
  assert.equal(TRIGGER_CONQUER_CARD.id, "card.trigger-conquer");
  assert.equal(TRIGGER_CONQUER_CARD.collectionId, SYNTHETIC_DEMO_COLLECTION_ID);
  assert.equal(TRIGGER_CONQUER_CARD.name, "Trigger Conquer");
  assert.equal(TRIGGER_CONQUER_CARD.cardType, "spell");
  assert.equal(TRIGGER_CONQUER_CARD.cost.energy, 1);
  assert.equal(TRIGGER_CONQUER_CARD.cost.power, 0);
  assert.deepEqual(TRIGGER_CONQUER_CARD.tags, ["synthetic-demo", "trigger"]);

  assert.equal(isCardDataSetContent(SYNTHETIC_DEMO_DATA_SET), true);
  assert.equal(isCardDataSet(SYNTHETIC_DEMO_DATA_SET), true);
  assert.equal(isCardDataManifest(SYNTHETIC_DEMO_MANIFEST), true);
  assert.equal(isCardDataBundle(SYNTHETIC_DEMO_BUNDLE), true);
  assert.equal(SYNTHETIC_DEMO_BUNDLE.dataSet.cards.length, 1);
  assert.equal(SYNTHETIC_DEMO_BUNDLE.manifest.cardCount, 1);
});

test("computes a stable digest independent of card and tag order", () => {
  const left = createDataSet();
  const right = createDataSet([
    { ...secondCard, tags: [...secondCard.tags].reverse() },
    TRIGGER_CONQUER_CARD
  ]);

  assert.equal(left.digest, right.digest);
  assert.match(left.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    left.digest,
    computeCardDataSetDigest({
      schemaVersion: left.schemaVersion,
      collectionId: left.collectionId,
      dataVersion: left.dataVersion,
      cards: left.cards
    })
  );
  assert.equal(
    createDataSet([TRIGGER_CONQUER_CARD]).digest,
    SYNTHETIC_DEMO_DATA_SET.digest
  );

  const changed = createDataSet([
    { ...TRIGGER_CONQUER_CARD, name: "Changed synthetic record" },
    secondCard
  ]);
  assert.notEqual(left.digest, changed.digest);
});

test("rejects duplicate ids and data versions at their boundaries", () => {
  assert.throws(
    () => createDataSet([TRIGGER_CONQUER_CARD, TRIGGER_CONQUER_CARD]),
    /card data set/
  );
  assert.throws(
    () => createDataSet([
      TRIGGER_CONQUER_CARD,
      { ...secondCard, collectionId: "collection.other-demo" }
    ]),
    /card data set/
  );

  const first = createDataSet([TRIGGER_CONQUER_CARD]);
  const duplicateVersion = createDataSet([secondCard]);
  assert.throws(
    () => createCardDataRegistry([first, duplicateVersion]),
    /duplicate dataVersion/
  );
  assert.equal(
    isCardDataRegistry({
      schemaVersion: CARD_DATA_SCHEMA_VERSION,
      dataSets: [first, duplicateVersion]
    }),
    false
  );
  assert.equal(
    createCardDataRegistry([first]).dataSets.length,
    1
  );
});

test("validates and preserves optional printing identity fields", () => {
  assert.equal(isCardDefinition(identityPrintingCard), true);
  assert.equal(isCardDataSet(createDataSet([identityPrintingCard])), true);

  const dataSet = createDataSet([identityPrintingCard]);
  assert.deepEqual(dataSet.cards[0], identityPrintingCard);
  assert.equal(dataSet.cards[0].identityScope, "official-id");

  const changed = createDataSet([
    { ...identityPrintingCard, identityScope: "explicit-map" }
  ]);
  assert.notEqual(dataSet.digest, changed.digest);

  const legacy = createDataSet([secondCard]).cards[0];
  assert.equal(Object.hasOwn(legacy, "identityScope"), false);
  assert.equal(Object.hasOwn(legacy, "printingKind"), false);
});

test("rejects invalid optional printing identity values", () => {
  assert.equal(
    isCardDefinition({ ...identityPrintingCard, cardCode: "" }),
    false
  );
  assert.equal(
    isCardDefinition({ ...identityPrintingCard, canonicalCardId: "not stable" }),
    false
  );
  assert.equal(
    isCardDefinition({ ...identityPrintingCard, printingKind: "showcase" }),
    false
  );
  assert.equal(
    isCardDefinition({ ...identityPrintingCard, identitySource: "fullName" }),
    false
  );
  assert.equal(
    isCardDefinition({ ...identityPrintingCard, identityConfidence: "name" }),
    false
  );
  assert.equal(
    isCardDefinition({ ...identityPrintingCard, identityScope: "candidate-name" }),
    false
  );
});

test("rejects tampered records and unknown keys", () => {
  const dataSet = createDataSet();
  const tampered = {
    ...dataSet,
    cards: [
      {
        ...dataSet.cards[0],
        cost: { energy: 99, power: 0 }
      },
      dataSet.cards[1]
    ]
  };
  assert.equal(isCardDataSet(tampered), false);
  assert.equal(
    isCardDataSet({ ...dataSet, unexpected: "field" }),
    false
  );
  assert.equal(
    isCardDefinition({ ...TRIGGER_CONQUER_CARD, tags: ["synthetic-demo", "synthetic-demo"] }),
    false
  );
  assert.equal(
    isCardDefinition({ ...TRIGGER_CONQUER_CARD, name: "\u0000" }),
    false
  );
});

test("manifest and bundle validation reject mismatches", () => {
  const dataSet = createDataSet();
  const manifest = createCardDataManifest(dataSet);
  const bundle = createCardDataBundle({
    schemaVersion: dataSet.schemaVersion,
    collectionId: dataSet.collectionId,
    dataVersion: dataSet.dataVersion,
    cards: dataSet.cards
  });

  assert.equal(isCardDataBundle(bundle), true);
  assert.equal(
    isCardDataManifest({ ...manifest, cardCount: 2 }),
    true
  );
  assert.equal(
    isCardDataBundle({
      dataSet,
      manifest: { ...manifest, cardCount: manifest.cardCount + 1 }
    }),
    false
  );
  assert.equal(
    isCardDataBundle({
      dataSet,
      manifest: { ...manifest, digest: `sha256:${"0".repeat(64)}` }
    }),
    false
  );
});

test("validates deck references and policy without official assumptions", () => {
  const dataSet = createDataSet();
  const validDeck = {
    collectionId: dataSet.collectionId,
    dataVersion: dataSet.dataVersion,
    entries: [
      { cardId: TRIGGER_CONQUER_CARD.id, quantity: 2 },
      { cardId: secondCard.id, quantity: 1 }
    ]
  };

  assert.equal(isDeckList(validDeck), true);
  assert.deepEqual(validateDeck(dataSet, validDeck), {
    valid: true,
    totalCards: 3,
    issues: []
  });

  assert.deepEqual(
    validateDeck(dataSet, validDeck, {
      minimumSize: 4,
      maximumSize: 4,
      maxCopiesPerCard: 1,
      requiredTags: ["synthetic-demo"],
      allowedCardTypes: ["unit"]
    }).issues.map((entry) => entry.code).sort(),
    [
      "allowed_card_type",
      "allowed_card_type",
      "deck_too_small",
      "too_many_copies"
    ]
  );

  const unknown = validateDeck(dataSet, {
    ...validDeck,
    entries: [{ cardId: "card.not-present", quantity: 1 }]
  });
  assert.deepEqual(unknown.issues.map((entry) => entry.code), ["unknown_card"]);

  const wrongVersion = validateDeck(dataSet, {
    ...validDeck,
    dataVersion: "2026-10-10-synthetic-demo.1"
  });
  assert.deepEqual(
    wrongVersion.issues.map((entry) => entry.code),
    ["data_version_mismatch"]
  );

  assert.equal(isDeckList({
    ...validDeck,
    entries: [
      { cardId: TRIGGER_CONQUER_CARD.id, quantity: 1 },
      { cardId: TRIGGER_CONQUER_CARD.id, quantity: 1 }
    ]
  }), false);
  assert.equal(isDeckList({ ...validDeck, unexpected: true }), false);
});

test("builds conservative effect coverage by printing and identity", () => {
  const executable = {
    ...identityPrintingCard,
    id: "fix-001-100",
    ability: "When this card arrives, draw 1 card."
  };
  const alternateExecutable = {
    ...executable,
    id: "fix-001a-100",
    ability: "When this card arrives, draw 1 card."
  };
  const unknown = {
    ...identityPrintingCard,
    id: "fix-002-100",
    canonicalCardId: "card.hash-unknown",
    ability: "When this card arrives, each player discards a card."
  };
  const noAbility = {
    ...identityPrintingCard,
    id: "fix-003-100",
    canonicalCardId: "card.hash-empty",
    ability: "   "
  };

  const report = buildEffectCoverageReport([
    executable,
    alternateExecutable,
    unknown,
    noAbility
  ]);

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.printingCount, 4);
  assert.equal(report.canonicalIdentityCount, 3);
  assert.equal(report.executableCount, 2);
  assert.equal(report.judgeRequiredCount, 1);
  assert.equal(report.noAbilityCount, 1);
  assert.equal(report.entries[0].status, "executable");
  assert.equal(report.entries[0].reason, "compiled to verified EffectIR");
  assert.equal(report.entries[2].status, "judge-required");
  assert.match(report.entries[2].reason, /verified compiler coverage/);
  assert.equal(report.entries[3].status, "no-ability");

  assert.throws(
    () => buildEffectCoverageReport([{ nope: true }]),
    /every coverage input must be a valid coverage card/
  );
  assert.throws(
    () => buildEffectCoverageReport([executable, executable]),
    /duplicate printing id/
  );
});

test("effect coverage script reports persisted catalog totals without guessing", async () => {
  const { parseArguments, main } = await import("../scripts/build-effect-coverage.mjs");
  assert.deepEqual(parseArguments([
    "--catalog",
    "catalog.json",
    "--output",
    "coverage.json",
    "--dry-run"
  ]), {
    catalog: "catalog.json",
    output: "coverage.json",
    dryRun: true,
    help: false
  });
  assert.throws(
    () => parseArguments(["--nope"]),
    error => error.name === "BuildEffectCoverageError"
  );

  const logs = [];
  const exitCode = await main([
    "--catalog",
    fileURLToPath(new URL("../data/deck-catalog.json", import.meta.url)),
    "--dry-run"
  ], { log: message => logs.push(message) });

  assert.equal(exitCode, 0);
  assert.match(logs[0], /^Effect coverage dry run:/);
  assert.match(logs[0], /printings=1381 canonicalIdentities=1080/);
});

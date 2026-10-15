// Persisted catalog audit.
//
// This file deliberately does NOT match the default `test/*.test.mjs` glob:
// it reads the gitignored official snapshots under `packages/card-data/data`,
// which are absent in a fresh checkout. Offline fixture regressions for the
// same catalog live in `test/deck-catalog-audit.test.mjs`.
//
// Run it explicitly after rebuilding the persisted data:
//
//   pnpm --filter @riftbound/card-data build:catalog
//   pnpm --filter @riftbound/card-data build:coverage
//   node --test test/persisted-catalog-audit.mjs
//
// When the snapshots are missing every test below fails with the exact path
// and the rebuild command, so the suite can never silently skip.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildEffectCoverageReport } from "../dist/index.js";

function readPersistedJson(fileName) {
  const filePath = fileURLToPath(new URL(`../data/${fileName}`, import.meta.url));
  let contents;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Persisted catalog audit requires ${filePath} (${
        error.code ?? error.message
      }). Run \`pnpm --filter @riftbound/card-data build:catalog\` and ` +
        "`pnpm --filter @riftbound/card-data build:coverage` first, then " +
        "`node --test test/persisted-catalog-audit.mjs`."
    );
  }
  return JSON.parse(contents);
}

let catalogCache;
function loadCatalog() {
  if (catalogCache === undefined) {
    catalogCache = readPersistedJson("deck-catalog.json");
  }
  return catalogCache;
}

let coverageCache;
function loadCoverage() {
  if (coverageCache === undefined) {
    coverageCache = readPersistedJson("effect-coverage.json");
  }
  return coverageCache;
}

function canonicalIdFor(fullName) {
  return `card.hash-${createHash("sha256")
    .update(fullName, "utf8")
    .digest("hex")}`;
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

test("persisted deck catalog groups every printing under one canonical identity", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.cards.length, 1381);
  assert.equal(catalog.groups.length, 1080);

  const cardsById = new Map();
  for (const card of catalog.cards) {
    assert.equal(cardsById.has(card.id), false, `duplicate printing ${card.id}`);
    cardsById.set(card.id, card);
    assert.equal(
      card.canonicalCardId,
      canonicalIdFor(card.fullName),
      `canonical id is not derived from the official full name for ${card.id}`
    );
  }

  const cardsByCanonical = groupCardsByCanonical(catalog);
  assert.equal(cardsByCanonical.size, 1080);

  const groupsByCanonical = new Map();
  for (const group of catalog.groups) {
    assert.equal(
      groupsByCanonical.has(group.canonicalCardId),
      false,
      `duplicate canonical group ${group.canonicalCardId}`
    );
    groupsByCanonical.set(group.canonicalCardId, group);
    assert.equal(group.identityProvenance, "official-name-rule");

    const expectedPrintings = cardsByCanonical
      .get(group.canonicalCardId)
      ?.map((card) => card.id)
      .sort();
    assert.notEqual(expectedPrintings, undefined);
    assert.deepEqual([...group.printings].sort(), expectedPrintings);
    assert.equal(group.printings.includes(group.primaryPrintingId), true);

    const primary = cardsById.get(group.primaryPrintingId);
    assert.notEqual(primary, undefined);
    assert.equal(primary.canonicalCardId, group.canonicalCardId);
    assert.equal(primary.fullName, group.fullName);
  }
  assert.equal(groupsByCanonical.size, cardsByCanonical.size);
});

test("alternate and reprint printings share a canonical identity for copy limits", () => {
  const catalog = loadCatalog();
  const cardsByCanonical = groupCardsByCanonical(catalog);
  const multiPrintingIdentities = [...cardsByCanonical.values()]
    .filter((printings) => printings.length > 1);
  assert.equal(multiPrintingIdentities.length, 207);

  const variantCounts = { standard: 0, alternate: 0, unknown: 0 };
  for (const card of catalog.cards) {
    variantCounts[card.variant] += 1;
  }
  assert.deepEqual(variantCounts, {
    standard: 1212,
    alternate: 169,
    unknown: 0
  });

  const crossSetIdentities = [...cardsByCanonical.values()].filter(
    (printings) => new Set(printings.map((card) => card.setCode)).size > 1
  );
  assert.equal(crossSetIdentities.length, 46);

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
});

test("persisted effect coverage reproduces from the catalog and matches ability text", () => {
  const catalog = loadCatalog();
  const coverage = loadCoverage();
  assert.equal(coverage.schemaVersion, 1);
  assert.equal(coverage.printingCount, 1381);
  assert.equal(coverage.canonicalIdentityCount, 1080);
  assert.equal(coverage.executableCount, 0);
  assert.equal(coverage.judgeRequiredCount, 1348);
  assert.equal(coverage.noAbilityCount, 33);

  const recomputed = buildEffectCoverageReport(
    catalog.cards.map((card) => ({
      id: card.id,
      canonicalCardId: card.canonicalCardId,
      ability: card.ability ?? ""
    }))
  );
  assert.equal(recomputed.printingCount, coverage.printingCount);
  assert.equal(recomputed.canonicalIdentityCount, coverage.canonicalIdentityCount);
  assert.equal(recomputed.executableCount, coverage.executableCount);
  assert.equal(recomputed.judgeRequiredCount, coverage.judgeRequiredCount);
  assert.equal(recomputed.noAbilityCount, coverage.noAbilityCount);
  assert.deepEqual(recomputed.entries, coverage.entries);

  const cardsById = new Map(catalog.cards.map((card) => [card.id, card]));
  for (const entry of coverage.entries) {
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
  const catalog = loadCatalog();
  const coverage = loadCoverage();
  const statusByPrinting = new Map(
    coverage.entries.map((entry) => [entry.printingId, entry.status])
  );

  // These Radiance showcase Basic Runes carry the upstream sentinel text
  // "[NO TEXT]" instead of an empty ability, so the conservative compiler
  // classifies them as judge-required rather than no-ability.
  for (const printingId of [
    "rad-r01a",
    "rad-r02a",
    "rad-r03a",
    "rad-r04a",
    "rad-r05a",
    "rad-r06a"
  ]) {
    const card = catalog.cards.find((entry) => entry.id === printingId);
    assert.notEqual(card, undefined);
    assert.equal(card.ability, "[NO TEXT]");
    assert.equal(statusByPrinting.get(printingId), "judge-required");
  }

  // The blank-text standard Radiance runes remain no-ability.
  for (const printingId of [
    "rad-r01",
    "rad-r02",
    "rad-r03",
    "rad-r04",
    "rad-r05",
    "rad-r06"
  ]) {
    assert.equal(statusByPrinting.get(printingId), "no-ability");
  }
});

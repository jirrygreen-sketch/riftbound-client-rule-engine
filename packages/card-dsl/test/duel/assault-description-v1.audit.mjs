// Real official-catalog audit for the pure-DATA `assault-description-v1` recogniser.
//
// This audit is EXPLICIT and PARENT-RUN: the official catalog is gitignored and
// absent in a fresh checkout, so a missing/unreadable catalog FAILS this test
// loudly rather than skipping. It never inspects generated card-data outputs.
//
// It censuses the complete 1381-printing catalog, derives the catalog's Assault
// printings from the ability text itself, and asserts that:
//   - the recognised set is EXACTLY the four real pure whole-ability Assault
//     printings (two bare [Assault] default-1, one [Assault 2] + reminder, one
//     bare [Assault] + reminder);
//   - every one of the catalog's 67 Assault printings is classified (the other
//     63 — keyword+other / grant / trigger / aura / condition / dynamic / Spell —
//     are unknown, never resolved as Assault);
//   - the real Unit `ogn-036-298` (Vi, Destructive), which has NO Assault, is
//     never recognised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const catalogPath =
  process.env.RIFTBOUND_ASSAULT_CATALOG ??
  new URL('../../../card-data/data/deck-catalog.json', import.meta.url);

const { describeDuelAssaultV1 } = await import('../../dist/duel/assault-description-v1.js');

const mentionsAssault = (card) =>
  typeof card.ability === 'string' && card.ability.includes('[Assault');

test('real catalog census: pure whole-ability Assault is recognised and nothing else', () => {
  assert.ok(existsSync(catalogPath), `official catalog is required for this audit: ${catalogPath}`);
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.ok(Array.isArray(catalog.cards), 'catalog.cards must be an array');
  assert.equal(catalog.cards.length, 1381, 'expected the 1381-printing catalog');

  const known = [];
  const unknown = [];
  for (const card of catalog.cards) {
    const result = describeDuelAssaultV1(card);
    (result.status === 'known' ? known : unknown).push(card.id);
  }
  known.sort();

  // The complete, exhaustive set of pure whole-ability Assault printings.
  assert.deepEqual(known, ['ogn-210-298', 'ogn-215-298', 'sfd-156-221', 'unl-225-219']);
  assert.equal(known.length + unknown.length, catalog.cards.length);

  // The real Unit with no Assault must never be recognised.
  assert.ok(!known.includes('ogn-036-298'), 'Vi, Destructive (ogn-036-298) has no Assault');
  const vi = catalog.cards.find((card) => card.id === 'ogn-036-298');
  assert.ok(vi, 'ogn-036-298 must exist in the catalog');
  assert.equal(describeDuelAssaultV1(vi).status, 'unknown');

  // Every catalog Assault printing is classified; only the 4 pure ones are known.
  const assaultCards = catalog.cards.filter(mentionsAssault);
  assert.equal(assaultCards.length, 67, `expected 67 Assault printings, found ${assaultCards.length}`);
  const knownAssault = assaultCards.filter((card) => describeDuelAssaultV1(card).status === 'known').map((card) => card.id).sort();
  assert.deepEqual(knownAssault, ['ogn-210-298', 'ogn-215-298', 'sfd-156-221', 'unl-225-219']);
  for (const card of assaultCards) {
    const result = describeDuelAssaultV1(card);
    assert.ok(result.status === 'known' || result.status === 'unknown');
  }

  console.log(`[assault-description-v1] known=${known.length} unknown=${unknown.length} total=${catalog.cards.length} assaultPrintings=${assaultCards.length}`);
});

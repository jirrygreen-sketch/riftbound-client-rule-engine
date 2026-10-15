// EXPLICIT FULL-CATALOG AUDIT for the printed base-cost binding kernel.
//
// This is deliberately NOT part of the default `pnpm test` run (`test/*.test.mjs`): it depends on the
// gitignored official deck catalog (packages/card-data/data/deck-catalog.json) and covers the whole
// official printing set. Run it explicitly where that local catalog exists:
//   pnpm --filter @riftbound/engine-core run audit:printed-costs
//
// The official catalog is REQUIRED here. When it is absent this audit FAILS loudly instead of
// skipping: a skipped audit would read as "covered" while nothing was verified. The default suite
// (duel-printed-costs.test.mjs) stays catalog-free and runs on a clean checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DUEL_DOMAINS } from '../dist/duel/resources.js';
import { bindDuelPrintedCost, bindDuelPrintedCostRegistry } from '../dist/duel/printed-costs.js';

const CATALOG_URL = new URL('../../card-data/data/deck-catalog.json', import.meta.url);
const FIXTURE_URL = new URL('./fixtures/printed-costs-cards.json', import.meta.url);
const PLAYABLE_TYPES = ['Unit', 'Gear', 'Spell'];

/** Official-catalog totals this audit pins. A drift here is a real catalog change, not a flake. */
const EXPECTED = Object.freeze({
  totalPrintings: 1381,
  numeric: 1119,
  notPlayed: 262,
  unsupportedCardType: 252,
  noPrintedEnergy: 10,
});

function readCatalog() {
  if (!fs.existsSync(CATALOG_URL)) {
    throw new Error(`printed-cost audit requires the official deck catalog at ${CATALOG_URL.pathname}; `
      + 'synchronize the local card data or run only the default catalog-free suite');
  }
  return JSON.parse(fs.readFileSync(CATALOG_URL, 'utf8'));
}
const catalog = readCatalog();
const fixture = JSON.parse(fs.readFileSync(FIXTURE_URL, 'utf8'));
const projected = card => ({
  id: card.id,
  canonicalCardId: card.canonicalCardId ?? null,
  name: card.name ?? null,
  fullName: card.fullName ?? null,
  cardType: card.cardType,
  domains: card.domains,
  energy: card.energy ?? null,
  power: card.power ?? null,
  might: card.might ?? null,
});
const deepFreeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
};

test('catalog shape is the official full printing set this audit pins', () => {
  assert.ok(Array.isArray(catalog.cards), 'catalog.cards must be an array');
  assert.equal(catalog.cards.length, EXPECTED.totalPrintings);
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(new Set(catalog.cards.map(c => c.id)).size, catalog.cards.length, 'printing ids must be unique');
});

test('every official printing binds: 1119 numeric, 262 not-played (252 type + 10 null Energy)', () => {
  const counts = { numeric: 0, notPlayed: 0, unsupportedCardType: 0, noPrintedEnergy: 0 };
  const reasons = new Set();
  for (const card of catalog.cards) {
    const binding = bindDuelPrintedCost(card);
    assert.equal(binding.cardId, card.id);
    if (binding.kind === 'numeric') {
      counts.numeric += 1;
      // Energy is the literal printed number, never a normalized free 0.
      assert.ok(Number.isSafeInteger(binding.cost.energy) && binding.cost.energy >= 0, `${card.id} Energy`);
      assert.equal(binding.cost.energy, card.energy, `${card.id} Energy must equal the printed number`);
      // Power is either absent, or exactly one allowedDomains requirement with a positive amount.
      assert.ok(binding.cost.power.length === 0 || binding.cost.power.length === 1, `${card.id} Power arity`);
      if (binding.cost.power.length === 1) {
        const p = binding.cost.power[0];
        assert.ok(Number.isSafeInteger(p.amount) && p.amount > 0, `${card.id} Power amount`);
        assert.equal(p.amount, card.power, `${card.id} Power amount must equal the printed number`);
        assert.ok(p.allowedDomains.length > 0, `${card.id} allowedDomains`);
        for (const d of p.allowedDomains) assert.ok(DUEL_DOMAINS.includes(d), `${card.id} unknown Domain ${d}`);
      } else {
        assert.ok(card.power === null || card.power === 0, `${card.id} printed Power must be null/0 when omitted`);
      }
    } else {
      counts.notPlayed += 1;
      reasons.add(binding.reason);
      if (binding.reason === 'unsupported-card-type') {
        counts.unsupportedCardType += 1;
        assert.ok(!PLAYABLE_TYPES.includes(card.cardType), `${card.id} must be a non-main card type`);
      } else {
        counts.noPrintedEnergy += 1;
        assert.equal(binding.reason, 'no-printed-energy');
        assert.ok(PLAYABLE_TYPES.includes(card.cardType), `${card.id} must be a main card type`);
        assert.equal(card.energy, null, `${card.id} must print null Energy`);
      }
    }
  }
  assert.deepEqual(counts, {
    numeric: EXPECTED.numeric,
    notPlayed: EXPECTED.notPlayed,
    unsupportedCardType: EXPECTED.unsupportedCardType,
    noPrintedEnergy: EXPECTED.noPrintedEnergy,
  });
  assert.deepEqual([...reasons].sort(), ['no-printed-energy', 'unsupported-card-type']);
  assert.equal(counts.numeric + counts.notPlayed, EXPECTED.totalPrintings);
});

test('the whole-catalog registry is keyed by printing id and matches per-card binding, read-only', () => {
  const frozen = deepFreeze(structuredClone(catalog.cards));
  const before = structuredClone(catalog.cards);
  const registry = bindDuelPrintedCostRegistry(frozen);
  assert.equal(registry.size, EXPECTED.totalPrintings);
  assert.deepEqual([...registry.keys()], catalog.cards.map(c => c.id), 'keys keep catalog order and printing ids');
  // Spot-check every binding across the full set, including the worst-case large and small printings.
  let numeric = 0;
  for (const card of catalog.cards) {
    const fromRegistry = registry.get(card.id);
    assert.deepEqual(fromRegistry, bindDuelPrintedCost(card), `${card.id} registry/bind parity`);
    if (fromRegistry.kind === 'numeric') numeric += 1;
  }
  assert.equal(numeric, EXPECTED.numeric);
  assert.deepEqual(frozen, before, 'binding the whole catalog must not mutate the snapshot');
  assert.deepEqual(catalog.cards, before, 'the audit must not mutate the loaded catalog');

  // A duplicated official printing id is rejected, never silently collapsed.
  const dup = [catalog.cards[0], catalog.cards[0]];
  assert.throws(() => bindDuelPrintedCostRegistry(dup), /duplicate printing ID/);
});

test('the tracked minimal fixture stays a faithful projection of the official catalog', () => {
  assert.ok(fixture.cards.length > 0 && fixture.cards.length <= 30, 'the fixture stays minimal');
  const byId = new Map(catalog.cards.map(c => [c.id, c]));
  for (const entry of fixture.cards) {
    const official = byId.get(entry.id);
    assert.ok(official, `fixture card ${entry.id} must exist in the official catalog`);
    assert.deepEqual(entry, projected(official), `fixture card ${entry.id} must equal the official projection`);
  }
  // The fixture ids are exactly the tracked groups the default suite asserts over.
  const groups = fixture.groups;
  assert.deepEqual([...fixture.cards.map(c => c.id)].sort(),
    [...groups.numeric, ...groups.nullEnergy, ...groups.unsupported].sort());
  for (const id of groups.numeric) {
    assert.equal(bindDuelPrintedCost(byId.get(id)).kind, 'numeric', `${id} must stay numeric`);
  }
  for (const id of groups.nullEnergy) {
    const b = bindDuelPrintedCost(byId.get(id));
    assert.equal(b.kind, 'not-played');
    assert.equal(b.reason, 'no-printed-energy');
  }
  for (const id of groups.unsupported) {
    const b = bindDuelPrintedCost(byId.get(id));
    assert.equal(b.kind, 'not-played');
    assert.equal(b.reason, 'unsupported-card-type');
  }
});

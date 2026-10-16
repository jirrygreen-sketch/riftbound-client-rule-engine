// OPT-IN audit: source-bound Ganking / enter-ready binding kernel against the REAL catalog.
// NOT part of the default `*.test.mjs` glob; run with
//   pnpm --filter @riftbound/card-dsl audit:official-catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleSpecifier = process.env.DUEL_ABILITY_BINDINGS_MODULE ?? '../../dist/duel/ability-bindings.js';
const {
  GANKING_REMINDER_TEXT,
  ENTER_READY_TEXT,
  normalizeAbilityText,
  bindPrintingAbility,
  bindAbilityByCardId,
  bindAbilityRegistry,
  abilitySourceFromCatalog,
} = await import(moduleSpecifier);

const CATALOG_URL = new URL('../../../../packages/card-data/data/deck-catalog.json', import.meta.url);
if (!fs.existsSync(CATALOG_URL)) {
  throw new Error(
    'audit:official-catalog requires the gitignored official catalog at packages/card-data/data/deck-catalog.json; ' +
    'run the card-data sync/build pipeline first.',
  );
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_URL, 'utf8'));
const source = abilitySourceFromCatalog(catalog);

const card = (id) => {
  const found = catalog.cards.find((entry) => entry.id === id);
  assert.ok(found, `actual catalog printing ${id}`);
  return found;
};
/** Bind a real printing by its catalog id (never a mock literal). */
const bind = (id) => bindPrintingAbility(source, card(id));

const STATIC_BOTH = 'ogs-009-024';       // exact Ganking + enter-ready
const ENTER_READY_ONLY = ['ogs-016-024', 'sfd-006-221']; // exact enter-ready only
const GANKING_PARTIAL = [                // Ganking prefix with a trailing body
  'ogn-036-298', 'ogn-112-298', 'ogn-112a-298', 'ogn-189-298', 'ogn-194-298',
  'ogn-205-298', 'ogn-205a-298', 'sfd-235-221', 'sfd-235-star-221', 'unl-005-219',
];
const NON_UNIT_GANKING = ['ogn-267-298', 'ogn-297-298', 'ogn-309-298'];

const BINDING_KEYS = [
  'cardId', 'fullyBound', 'normalizedAbilityText', 'sourceCatalogDigest', 'sourceDataVersion',
  'staticAbilities', 'unresolvedText',
];
const assertBindingShape = (binding, cardId) => {
  assert.equal(binding.cardId, cardId);
  assert.deepEqual(Object.keys(binding).sort(), BINDING_KEYS);
  assert.equal(binding.sourceDataVersion, catalog.dataVersion);
  assert.equal(binding.sourceCatalogDigest, catalog.digest);
  assert.ok(binding.staticAbilities.every((segment) => Object.keys(segment).length === 1 && typeof segment.kind === 'string'));
};
const kinds = (binding) => binding.staticAbilities.map((segment) => segment.kind);

test('literals are the fixed official texts, not invented strings', () => {
  assert.equal(GANKING_REMINDER_TEXT, '[Ganking] (I can move from battlefield to battlefield.)');
  assert.equal(ENTER_READY_TEXT, 'I enter ready.');
  assert.equal(card(STATIC_BOTH).ability, `${GANKING_REMINDER_TEXT}\n${ENTER_READY_TEXT}`);
  assert.equal(card(STATIC_BOTH).cardType, 'Unit');
});

test('the whole fixed-text printings are fully bound', () => {
  const both = bind(STATIC_BOTH);
  assertBindingShape(both, STATIC_BOTH);
  assert.deepEqual(kinds(both), ['ganking', 'enter-ready']);
  assert.equal(both.fullyBound, true);
  assert.equal(both.unresolvedText, null);
  assert.equal(both.normalizedAbilityText, card(STATIC_BOTH).ability);

  for (const id of ENTER_READY_ONLY) {
    const binding = bind(id);
    assertBindingShape(binding, id);
    assert.equal(card(id).ability, ENTER_READY_TEXT);
    assert.deepEqual(kinds(binding), ['enter-ready']);
    assert.equal(binding.fullyBound, true);
    assert.equal(binding.unresolvedText, null);
  }
});

test('non-Unit printings are never bound, even when their text mentions Ganking', () => {
  for (const id of NON_UNIT_GANKING) {
    const real = card(id);
    assert.notEqual(real.cardType, 'Unit');
    assert.ok(real.ability.includes('Ganking'), `${id} must mention Ganking to make the test meaningful`);
    const binding = bind(id);
    assert.deepEqual(kinds(binding), [], id);
    assert.equal(binding.fullyBound, false, id);
    assert.equal(binding.unresolvedText, normalizeAbilityText(real.ability), id);
  }
  // Exhaustive: no non-Unit printing in the whole catalog is bound.
  const registry = bindAbilityRegistry(source);
  for (const entry of catalog.cards) {
    if (entry.cardType === 'Unit') continue;
    const binding = registry.get(entry.id);
    assert.equal(binding.fullyBound, false, `${entry.id} must not be fully bound`);
    assert.deepEqual(binding.staticAbilities, []);
  }
});

test('a Ganking prefix with any extra ability body stays unresolved', () => {
  for (const id of GANKING_PARTIAL) {
    const real = card(id);
    assert.equal(real.cardType, 'Unit');
    assert.ok(real.ability.startsWith(`${GANKING_REMINDER_TEXT}\n`), id);
    const expectedUnresolved = real.ability.slice(GANKING_REMINDER_TEXT.length + 1);
    const binding = bind(id);
    assert.deepEqual(kinds(binding), ['ganking'], `${id} recognised fragment only`);
    assert.equal(binding.fullyBound, false, `${id} extra body must clear fullyBound`);
    assert.equal(binding.unresolvedText, expectedUnresolved, id);
    assert.ok(binding.unresolvedText.length > 0, id);
  }
});

test('normalization only touches whitespace / line endings', () => {
  const real = card(STATIC_BOTH);
  const messy = `\r\n  ${GANKING_REMINDER_TEXT}   \r\n${ENTER_READY_TEXT}\r\n\r\n`;
  const normalized = normalizeAbilityText(messy);
  assert.equal(normalized, `${GANKING_REMINDER_TEXT}\n${ENTER_READY_TEXT}`);
  assert.equal(normalized, real.ability);
  // Internal spacing is NOT collapsed: a doubled space breaks the literal match.
  const broken = { id: 'synthetic-2', cardType: 'Unit', ability: GANKING_REMINDER_TEXT.replace('] (', ']  (') };
  const brokenSource = {
    dataVersion: catalog.dataVersion, sourceCatalogDigest: catalog.digest, cards: [broken],
  };
  assert.equal(bindPrintingAbility(brokenSource, broken).fullyBound, false);
});

test('source metadata is carried verbatim and the catalog is not mutated', () => {
  const snapshot = JSON.stringify(catalog.cards);
  const before = structuredClone(card(STATIC_BOTH));
  const binding = bind(STATIC_BOTH);
  assert.equal(binding.sourceDataVersion, catalog.dataVersion);
  assert.equal(binding.sourceCatalogDigest, catalog.digest);
  assert.match(binding.sourceCatalogDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(binding.normalizedAbilityText, before.ability);
  assert.deepEqual(card(STATIC_BOTH), before);
  assert.equal(JSON.stringify(catalog.cards), snapshot);
});

test('returned bindings are isolated from the registry (mutation safety)', () => {
  const registry = bindAbilityRegistry(source);
  const first = registry.get(STATIC_BOTH);
  const second = registry.get(STATIC_BOTH);
  assert.notEqual(first, second);
  assert.notEqual(first.staticAbilities, second.staticAbilities);
  first.staticAbilities.push({ kind: 'ganking' });
  first.fullyBound = false;
  first.unresolvedText = 'tampered';
  first.staticAbilities[0].kind = 'enter-ready';
  const third = registry.get(STATIC_BOTH);
  assert.deepEqual(kinds(third), ['ganking', 'enter-ready']);
  assert.equal(third.fullyBound, true);
  assert.equal(third.unresolvedText, null);
  assert.deepEqual(kinds(second), ['ganking', 'enter-ready']);

  const id = ENTER_READY_ONLY[0];
  const a = bind(id);
  const b = bind(id);
  assert.notEqual(a, b);
  assert.notEqual(a.staticAbilities, b.staticAbilities);
  a.staticAbilities.length = 0;
  assert.deepEqual(kinds(bind(id)), ['enter-ready']);
});

test('source-bound entry rejects forged tuples that are not in the trusted source', () => {
  const real = card('ogn-036-298');
  assert.equal(real.cardType, 'Unit');
  assert.ok(real.ability.startsWith('[Ganking]'));

  assert.throws(
    () => bindPrintingAbility(source, { id: real.id, cardType: 'Unit', ability: ENTER_READY_TEXT }),
    TypeError,
    'a real id re-pointed at known text must be rejected',
  );
  assert.throws(
    () => bindPrintingAbility(source, { id: real.id, cardType: 'Spell', ability: real.ability }),
    TypeError,
    'a real id with a contradicting cardType must be rejected',
  );
  assert.throws(
    () => bindPrintingAbility(source, { id: 'syn-000-000', cardType: 'Unit', ability: ENTER_READY_TEXT }),
    TypeError,
    'an unknown id must not be bound to known text',
  );

  // A genuine value clone (same id/type/ability) binds without identity.
  const clone = { id: real.id, cardType: real.cardType, ability: real.ability };
  const clonedBinding = bindPrintingAbility(source, clone);
  assert.equal(clonedBinding.cardId, real.id);
  assert.deepEqual(kinds(clonedBinding), ['ganking']);
  assert.equal(clonedBinding.fullyBound, false, 'the real card is partial');

  // Raw-whitespace differences that normalize identically are still accepted.
  const id = ENTER_READY_ONLY[0];
  const spaced = { id, cardType: 'Unit', ability: `  ${ENTER_READY_TEXT}  ` };
  const spacedBinding = bindPrintingAbility(source, spaced);
  assert.deepEqual(kinds(spacedBinding), ['enter-ready']);
  assert.equal(spacedBinding.fullyBound, true);

  assert.equal(bindPrintingAbility(source, card(id)).fullyBound, true);
});

test('duplicate and empty-metadata sources are rejected at the entry points', () => {
  assert.throws(
    () => bindAbilityByCardId({
      dataVersion: 'x', sourceCatalogDigest: 'sha256:x',
      cards: [{ id: 'dup', cardType: 'Unit', ability: '' }, { id: 'dup', cardType: 'Unit', ability: ENTER_READY_TEXT }],
    }, 'dup'),
    /duplicate printing id/,
    'byId must not ignore a duplicate source id',
  );
  assert.throws(() => bindAbilityRegistry({ dataVersion: '', sourceCatalogDigest: 'sha256:x', cards: [] }), TypeError);
  assert.throws(() => bindAbilityRegistry({ dataVersion: 'x', sourceCatalogDigest: '', cards: [] }), TypeError);
  assert.throws(
    () => bindPrintingAbility(
      { dataVersion: '', sourceCatalogDigest: 'sha256:x', cards: [] },
      { id: 'a', cardType: 'Unit', ability: '' },
    ),
    TypeError,
  );
  assert.throws(() => abilitySourceFromCatalog({ dataVersion: '', digest: 'sha256:x', cards: [] }), TypeError);
  assert.throws(() => abilitySourceFromCatalog({ dataVersion: 'x', digest: '', cards: [] }), TypeError);
  assert.throws(
    () => bindAbilityRegistry({ dataVersion: 'x', sourceCatalogDigest: 'sha256:x', cards: [{ id: '', cardType: 'Unit', ability: '' }] }),
    TypeError,
  );
  assert.equal(bindAbilityByCardId(source, STATIC_BOTH).fullyBound, true);
});

test('registry covers every printing and rejects duplicate ids', () => {
  const registry = bindAbilityRegistry(source);
  assert.equal(registry.size, catalog.cards.length);
  assert.equal(registry.size, 1381);
  assert.deepEqual(registry.cardIds(), catalog.cards.map((entry) => entry.id));
  for (const entry of catalog.cards) {
    assert.ok(registry.has(entry.id));
    const binding = registry.get(entry.id);
    assert.equal(binding.cardId, entry.id);
    assert.equal(typeof binding.fullyBound, 'boolean');
  }
  assert.throws(() => bindAbilityRegistry({
    dataVersion: 'x', sourceCatalogDigest: 'sha256:x',
    cards: [{ id: 'dup', cardType: 'Unit', ability: '' }, { id: 'dup', cardType: 'Unit', ability: '' }],
  }), /duplicate printing id/);
  assert.equal(bindAbilityByCardId(source, 'no-such-card'), undefined);
  assert.equal(bindAbilityByCardId(source, STATIC_BOTH).fullyBound, true);
});

test('census: exactly the whole fixed-text printings bind; the rest are unresolved', () => {
  const registry = bindAbilityRegistry(source);
  const fullyBound = [];
  const partial = [];
  const fullyBoundIds = new Set([STATIC_BOTH, ...ENTER_READY_ONLY]);
  for (const entry of catalog.cards) {
    const binding = registry.get(entry.id);
    if (binding.fullyBound) fullyBound.push(entry.id);
    else if (binding.staticAbilities.length > 0) partial.push(entry.id);
  }
  assert.deepEqual([...fullyBound].sort(), [...fullyBoundIds].sort());
  assert.deepEqual(partial.sort(), [...GANKING_PARTIAL].sort());
  for (const id of partial) {
    const binding = registry.get(id);
    assert.equal(card(id).cardType, 'Unit');
    assert.deepEqual(kinds(binding), ['ganking']);
    assert.equal(binding.fullyBound, false);
  }
});

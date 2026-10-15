// Default (clean-checkout) suite for the source-bound Ganking / enter-ready binding kernel.
//
// These tests exercise the COMPILED artifact at ../dist/duel/ability-bindings.js:
// the package's `test` script runs `pnpm build` first, then `node --test`.
//
// The catalog is the TRACKED synthetic fixture at test/fixtures/official-catalog.mjs.
// No gitignored official data is read and there is no data-missing skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, cardById } from '../fixtures/official-catalog.mjs';
import {
  GANKING_REMINDER_TEXT,
  ENTER_READY_TEXT,
  normalizeAbilityText,
  bindPrintingAbility,
  bindAbilityByCardId,
  bindAbilityRegistry,
  abilitySourceFromCatalog,
} from '../../dist/duel/ability-bindings.js';

const catalog = CATALOG;
const source = abilitySourceFromCatalog(catalog);

const card = (id) => {
  const found = cardById(id);
  assert.ok(found, `fixture is missing ${id}`);
  return found;
};
/** Bind a fixture card by printing id (never a mock literal). */
const bind = (id) => bindPrintingAbility(source, card(id));

const STATIC_BOTH = 'syn-unit-static-both';
const GANKING_ONLY = 'syn-unit-static-ganking';
const ENTER_READY_ONLY = 'syn-unit-static-enter-ready';
const GANKING_PARTIAL = 'syn-unit-partial';
const GANKING_BARE = 'syn-unit-ganking-bare';
const SPELL_GANKING = 'syn-spell-ganking';
const LEGEND_GRANT = 'syn-legend-grant-ganking';

/** A synthetic trusted source for parser-only fixtures not in the catalog. */
const syntheticSource = (cards, meta = {}) => ({
  dataVersion: meta.dataVersion ?? catalog.dataVersion,
  sourceCatalogDigest: meta.sourceCatalogDigest ?? catalog.digest,
  cards,
});
const bindSynthetic = (cardObj) => bindPrintingAbility(syntheticSource([cardObj]), cardObj);

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

test('the three whole fixed-text Units are fully bound', () => {
  const both = bind(STATIC_BOTH);
  assertBindingShape(both, STATIC_BOTH);
  assert.deepEqual(kinds(both), ['ganking', 'enter-ready']);
  assert.equal(both.fullyBound, true);
  assert.equal(both.unresolvedText, null);
  assert.equal(both.normalizedAbilityText, card(STATIC_BOTH).ability);

  const ganking = bind(GANKING_ONLY);
  assertBindingShape(ganking, GANKING_ONLY);
  assert.deepEqual(kinds(ganking), ['ganking']);
  assert.equal(ganking.fullyBound, true);

  const enterReady = bind(ENTER_READY_ONLY);
  assertBindingShape(enterReady, ENTER_READY_ONLY);
  assert.equal(card(ENTER_READY_ONLY).ability, ENTER_READY_TEXT);
  assert.deepEqual(kinds(enterReady), ['enter-ready']);
  assert.equal(enterReady.fullyBound, true);
  assert.equal(enterReady.unresolvedText, null);
});

test('exact-text mismatches are rejected (no reminder / no bracket / wrong case)', () => {
  const bare = bind(GANKING_BARE);
  assert.equal(card(GANKING_BARE).ability, 'Ganking (I can move from battlefield to battlefield.)');
  assert.deepEqual(kinds(bare), []);
  assert.equal(bare.fullyBound, false);
  assert.equal(bare.unresolvedText, normalizeAbilityText(card(GANKING_BARE).ability));
});

test('non-Unit printings are never bound, even when their text mentions Ganking', () => {
  for (const id of [SPELL_GANKING, LEGEND_GRANT]) {
    const real = card(id);
    assert.notEqual(real.cardType, 'Unit');
    assert.ok(real.ability.includes('Ganking'), `${id} must mention Ganking to make the test meaningful`);
    const binding = bind(id);
    assert.deepEqual(kinds(binding), []);
    assert.equal(binding.fullyBound, false);
    assert.equal(binding.unresolvedText, normalizeAbilityText(real.ability));
  }
  // Exhaustive: no non-Unit printing in the whole fixture is bound.
  const registry = bindAbilityRegistry(source);
  for (const entry of catalog.cards) {
    if (entry.cardType === 'Unit') continue;
    const binding = registry.get(entry.id);
    assert.equal(binding.fullyBound, false, `${entry.id} must not be fully bound`);
    assert.deepEqual(binding.staticAbilities, []);
  }
});

test('a Ganking prefix with any extra ability body stays unresolved', () => {
  const real = card(GANKING_PARTIAL);
  assert.equal(real.cardType, 'Unit');
  assert.ok(real.ability.startsWith(`${GANKING_REMINDER_TEXT}\n`));
  const expectedUnresolved = real.ability.slice(GANKING_REMINDER_TEXT.length + 1);
  const binding = bind(GANKING_PARTIAL);
  assert.deepEqual(kinds(binding), ['ganking'], 'recognised fragment only');
  assert.equal(binding.fullyBound, false, 'extra body must clear fullyBound');
  assert.equal(binding.unresolvedText, expectedUnresolved);
  assert.ok(binding.unresolvedText.length > 0);
});

test('conditional / granted Ganking is not bound to the unit', () => {
  // A Spell granting Ganking to another unit must stay unresolved.
  assert.deepEqual(kinds(bind(SPELL_GANKING)), []);
  assert.equal(bind(SPELL_GANKING).fullyBound, false);
  // A Legend granting Ganking is a granted, not intrinsic, ability.
  assert.deepEqual(kinds(bind(LEGEND_GRANT)), []);
  assert.equal(bind(LEGEND_GRANT).fullyBound, false);
});

test('enter-ready is only recognised as the exact whole statement', () => {
  // "I enter ready." followed by more text is not the exact whole statement.
  const followed = { id: 'synthetic-enter-followed', cardType: 'Unit', ability: `${ENTER_READY_TEXT}\nAnd draw a card.` };
  assert.deepEqual(kinds(bindSynthetic(followed)), []);
  assert.equal(bindSynthetic(followed).fullyBound, false);
  // Conditional enter-ready is not the fixed text.
  const conditional = { id: 'synthetic-enter-conditional', cardType: 'Unit', ability: 'I enter ready if you control a battlefield.' };
  assert.deepEqual(kinds(bindSynthetic(conditional)), []);
  assert.equal(bindSynthetic(conditional).fullyBound, false);
  // "Other units enter ready." is a different subject and must not bind.
  const other = { id: 'synthetic-enter-other', cardType: 'Unit', ability: 'Other units enter ready.' };
  assert.deepEqual(kinds(bindSynthetic(other)), []);
});

test('normalization only touches whitespace / line endings', () => {
  const real = card(STATIC_BOTH);
  const messy = `\r\n  ${GANKING_REMINDER_TEXT}   \r\n${ENTER_READY_TEXT}\r\n\r\n`;
  const normalized = normalizeAbilityText(messy);
  assert.equal(normalized, `${GANKING_REMINDER_TEXT}\n${ENTER_READY_TEXT}`);
  const synthetic = { id: 'synthetic', cardType: 'Unit', ability: messy };
  const binding = bindSynthetic(synthetic);
  assert.deepEqual(kinds(binding), ['ganking', 'enter-ready']);
  assert.equal(binding.fullyBound, true);
  assert.equal(binding.normalizedAbilityText, real.ability);
  // Internal spacing is NOT collapsed: a doubled space breaks the literal match.
  const broken = { id: 'synthetic-2', cardType: 'Unit', ability: GANKING_REMINDER_TEXT.replace('] (', ']  (') };
  assert.equal(bindSynthetic(broken).fullyBound, false);
  // Punctuation is never stripped.
  const punctuation = { id: 'synthetic-3', cardType: 'Unit', ability: '[Ganking] I can move from battlefield to battlefield.' };
  assert.equal(bindSynthetic(punctuation).fullyBound, false);
});

test('source metadata is carried verbatim and the fixture catalog is not mutated', () => {
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

  // Direct binding calls also return fresh objects.
  const a = bind(ENTER_READY_ONLY);
  const b = bind(ENTER_READY_ONLY);
  assert.notEqual(a, b);
  assert.notEqual(a.staticAbilities, b.staticAbilities);
  a.staticAbilities.length = 0;
  assert.deepEqual(kinds(bind(ENTER_READY_ONLY)), ['enter-ready']);
});

test('source-bound entry rejects forged tuples that are not in the trusted source', () => {
  const real = card(GANKING_ONLY);
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

  // A genuine value clone (same id/type/normalized text) binds without identity.
  const clone = { id: real.id, cardType: real.cardType, ability: real.ability };
  const clonedBinding = bindPrintingAbility(source, clone);
  assert.equal(clonedBinding.cardId, real.id);
  assert.deepEqual(kinds(clonedBinding), ['ganking']);
  assert.equal(clonedBinding.fullyBound, true);

  // Raw-whitespace differences that normalize identically are still accepted.
  const spaced = { id: ENTER_READY_ONLY, cardType: 'Unit', ability: `  ${ENTER_READY_TEXT}  ` };
  const spacedBinding = bindPrintingAbility(source, spaced);
  assert.deepEqual(kinds(spacedBinding), ['enter-ready']);
  assert.equal(spacedBinding.fullyBound, true);

  // The genuine catalog card itself still binds.
  assert.equal(bindPrintingAbility(source, card(ENTER_READY_ONLY)).fullyBound, true);
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
  // The fixture source still resolves fine.
  assert.equal(bindAbilityByCardId(source, STATIC_BOTH).fullyBound, true);
});

test('registry covers every printing and rejects duplicate ids', () => {
  const registry = bindAbilityRegistry(source);
  assert.equal(registry.size, catalog.cards.length);
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

test('census: exactly the selected printings bind; every other printing is unknown', () => {
  const registry = bindAbilityRegistry(source);
  const fullyBound = [];
  const partial = [];
  const fullyBoundIds = new Set([STATIC_BOTH, GANKING_ONLY, ENTER_READY_ONLY]);
  for (const entry of catalog.cards) {
    const binding = registry.get(entry.id);
    if (binding.fullyBound) fullyBound.push(entry.id);
    else if (binding.staticAbilities.length > 0) partial.push(entry.id);
  }
  assert.deepEqual([...fullyBound].sort(), [...fullyBoundIds].sort());
  assert.deepEqual(partial, [GANKING_PARTIAL]);
  for (const id of partial) {
    const binding = registry.get(id);
    assert.equal(card(id).cardType, 'Unit');
    assert.deepEqual(kinds(binding), ['ganking']);
    assert.equal(binding.fullyBound, false);
  }
});

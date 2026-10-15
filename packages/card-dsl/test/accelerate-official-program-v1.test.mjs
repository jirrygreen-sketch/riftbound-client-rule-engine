// Focused opt-in suite for the source-bound pure Accelerate official IR.
// The default registry remains the archived 65-program surface; Accelerate is
// available only through its named factory (or the explicit combined factory).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../dist/duel/official-programs.js';
const current = await import(moduleSpecifier);
const { CATALOG, CENSUS, cardById } = await import('./fixtures/official-catalog.mjs');

const REMINDER = '[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)';
const makeCard = (id, overrides = {}) => ({
  id,
  cardType: 'Unit',
  ability: REMINDER,
  energy: id === 'ogn-010-298' ? 2 : 5,
  power: null,
  might: id === 'ogn-010-298' ? 2 : 5,
  domains: ['Fury'],
  tags: ['Accelerate'],
  canonicalCardId: `card.syn-${id}`,
  name: `Synthetic ${id}`,
  fullName: `Synthetic ${id}`,
  localizedName: `Synthetic ${id}`,
  setCode: 'syn',
  cardNumber: `SYN-${id}`,
  variant: 'standard',
  ...overrides,
});
const accelerateCards = [makeCard('ogn-001-298'), makeCard('ogn-010-298')];
const syntheticCatalog = {
  ...CATALOG,
  cards: [...CATALOG.cards, ...accelerateCards],
};
const syntheticSource = current.duelAbilitySourceFromCatalog(syntheticCatalog);

const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());

test('Accelerate is resolved only by the named opt-in factory, with explicit choice semantics', () => {
  const legacy = current.createDuelOfficialProgramRegistry(syntheticSource);
  const accelerate = current.createDuelAccelerateOfficialProgramRegistryV1(syntheticSource);
  const extended = current.createDuelExtendedUnitOfficialProgramRegistryV1(syntheticSource);

  assert.equal(legacy.get('ogn-001-298').status, 'unknown');
  assert.equal(legacy.get('ogn-010-298').status, 'unknown');
  for (const registry of [accelerate, extended]) {
    for (const id of ['ogn-001-298', 'ogn-010-298']) {
      const program = registry.getProgram(id);
      assert.ok(program);
      exactKeys(program.semantics, ['kind', 'choiceTiming', 'optional', 'additionalCost', 'paidEffect']);
      assert.deepEqual(program.semantics, {
        kind: 'accelerate',
        choiceTiming: 'card-play-choices',
        optional: true,
        additionalCost: { energy: 1, power: [{ allowedDomains: ['Fury'], amount: 1 }] },
        paidEffect: { kind: 'enter-ready-replacement', timing: 'unit-entry' },
      });
    }
  }
});

test('Accelerate registry census is base 65 plus exactly the two pure printings', () => {
  const legacy = current.createDuelOfficialProgramRegistry(syntheticSource);
  const accelerate = current.createDuelAccelerateOfficialProgramRegistryV1(syntheticSource);
  const extended = current.createDuelExtendedUnitOfficialProgramRegistryV1(syntheticSource);
  assert.equal(legacy.knownProgramCount, CENSUS.known);
  assert.equal(accelerate.knownProgramCount, CENSUS.known + 2);
  assert.equal(extended.knownProgramCount, CENSUS.known + 2);
  assert.equal(accelerate.size, syntheticCatalog.cards.length);
  assert.equal(extended.size, syntheticCatalog.cards.length);
});

test('Accelerate program and reference codecs are canonical and source-bound', () => {
  const registry = current.createDuelAccelerateOfficialProgramRegistryV1(syntheticSource);
  const program = registry.getProgram('ogn-001-298');
  const raw = current.encodeDuelOfficialProgramRaw(program);
  assert.deepEqual(current.decodeDuelOfficialProgramRaw(raw), program);
  assert.deepEqual(current.decodeDuelOfficialProgramRaw(JSON.stringify(JSON.parse(raw))), program);
  const reference = registry.reference('ogn-001-298');
  const referenceRaw = current.encodeDuelProgramReferenceRaw(reference);
  assert.deepEqual(current.decodeDuelProgramReferenceRaw(referenceRaw), reference);
  assert.deepEqual(current.resolveDuelProgramReference(registry, reference), program);
  assert.throws(() => current.decodeDuelOfficialProgramRaw(raw.replace('"optional":true', '"optional":false')),
    /optional|Accelerate|source tuple/u);
  assert.throws(() => current.encodeDuelOfficialProgramRaw({
    ...program,
    semantics: { ...program.semantics, extra: true },
  }), /unknown or missing fields/u);
  assert.throws(() => current.resolveDuelProgramReference(registry, { ...reference, sourceCatalogDigest: 'sha256:forged' }),
    /metadata/u);
});

test('compound, multi-ability, wrong-type, domain mismatch and nonnumeric stats remain unknown', () => {
  const cards = [
    makeCard('compound', { ability: `${REMINDER}\nWhen you play me, draw 1.` }),
    makeCard('multi-ability', { ability: `${REMINDER}\n${REMINDER}` }),
    makeCard('spell', { cardType: 'Spell' }),
    makeCard('wrong-domain', { domains: ['Order'] }),
    makeCard('unknown-stat', { energy: null }),
  ];
  const source = current.duelAbilitySourceFromCatalog({
    schemaVersion: 1,
    dataVersion: 'accelerate-boundary-v1',
    digest: 'sha256:accelerate-boundary',
    cards,
  });
  const registry = current.createDuelAccelerateOfficialProgramRegistryV1(source);
  for (const card of cards) {
    assert.equal(registry.get(card.id).status, 'unknown', card.id);
    assert.equal(registry.reference(card.id), undefined, card.id);
  }
});

test('the default entry points stay byte-identical to the frozen legacy 65 implementation on 1381 printings',
  { skip: !fs.existsSync(new URL('../../../packages/card-data/data/deck-catalog.json', import.meta.url)) },
  async () => {
    const legacyUrl = new URL('./fixtures/duel-official-programs-legacy-65.ts', import.meta.url);
    const legacySourceText = readFileSync(legacyUrl, 'utf8');
    assert.equal(createHash('sha256').update(legacySourceText).digest('hex'),
      'b9a36371fd883b45658f6ccbc8c8f3e32b9dd81aae113e89341141bf8394b334');
    const compiled = ts.transpileModule(legacySourceText, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    assert.deepEqual(compiled.diagnostics, []);
    const normalizerUrl = new URL('../dist/duel/ability-bindings.js', import.meta.url).href;
    const legacyJs = compiled.outputText.replaceAll('./ability-bindings.js', normalizerUrl);
    const legacy = await import(`data:text/javascript;base64,${Buffer.from(legacyJs).toString('base64')}`);
    const catalogUrl = new URL('../../../packages/card-data/data/deck-catalog.json', import.meta.url);
    const bytes = readFileSync(catalogUrl);
    const catalog = JSON.parse(bytes.toString('utf8'));
    assert.equal(catalog.cards.length, 1381);
    const source = current.duelAbilitySourceFromCatalog(catalog);
    const oldSource = legacy.duelAbilitySourceFromCatalog(catalog);
    const oldRegistry = legacy.createDuelOfficialProgramRegistry(oldSource);
    const currentRegistry = current.createDuelOfficialProgramRegistry(source);
    const aliasRegistry = current.createDuelProgramRegistry(source);
    const assaultRegistry = current.createDuelAssaultOfficialProgramRegistryV1(source);
    const accelerateRegistry = current.createDuelAccelerateOfficialProgramRegistryV1(source);
    const extendedRegistry = current.createDuelExtendedUnitOfficialProgramRegistryV1(source);
    assert.equal(oldRegistry.knownProgramCount, 65);
    assert.equal(currentRegistry.knownProgramCount, 65);
    assert.equal(aliasRegistry.knownProgramCount, 65);
    assert.equal(assaultRegistry.knownProgramCount, 69);
    assert.equal(accelerateRegistry.knownProgramCount, 67);
    assert.equal(extendedRegistry.knownProgramCount, 71);
    assert.deepEqual(currentRegistry.cardIds(), oldRegistry.cardIds());
    assert.deepEqual(aliasRegistry.cardIds(), oldRegistry.cardIds());
    const accelerated = [];
    for (const id of oldRegistry.cardIds()) {
      assert.deepEqual(currentRegistry.get(id), oldRegistry.get(id), id);
      assert.deepEqual(currentRegistry.getProgram(id), oldRegistry.getProgram(id), id);
      assert.deepEqual(currentRegistry.reference(id), oldRegistry.reference(id), id);
      assert.deepEqual(aliasRegistry.get(id), oldRegistry.get(id), id);
      assert.deepEqual(aliasRegistry.getProgram(id), oldRegistry.getProgram(id), id);
      assert.deepEqual(aliasRegistry.reference(id), oldRegistry.reference(id), id);
      if (accelerateRegistry.get(id).status !== oldRegistry.get(id).status) accelerated.push(id);
    }
    assert.deepEqual(accelerated, ['ogn-001-298', 'ogn-010-298']);
    for (const id of accelerated) {
      const program = accelerateRegistry.getProgram(id);
      assert.deepEqual(current.resolveDuelProgramReference(accelerateRegistry, accelerateRegistry.reference(id)), program);
      assert.deepEqual(extendedRegistry.getProgram(id), program);
    }
  });

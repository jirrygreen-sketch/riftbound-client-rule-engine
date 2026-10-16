import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const currentUrl = new URL(moduleSpecifier, import.meta.url);
const current = await import(currentUrl.href);
const legacySourceUrl = new URL(
  '../fixtures/duel-official-programs-legacy-65.ts',
  import.meta.url,
);
const legacySource = readFileSync(legacySourceUrl, 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha256(legacySource), 'b9a36371fd883b45658f6ccbc8c8f3e32b9dd81aae113e89341141bf8394b334');

// Compile the archived implementation independently, sharing only the unchanged
// ability-text normalizer that its original relative import used.
const compiledLegacy = ts.transpileModule(legacySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.deepEqual(compiledLegacy.diagnostics, []);
assert.match(compiledLegacy.outputText, /\.\/ability-bindings\.js/u);
const normalizerUrl = new URL('./ability-bindings.js', currentUrl).href;
const legacyJs = compiledLegacy.outputText.replaceAll('./ability-bindings.js', normalizerUrl);
const legacy = await import(`data:text/javascript;base64,${Buffer.from(legacyJs).toString('base64')}`);

const catalogUrl = new URL('../../../../packages/card-data/data/deck-catalog.json', import.meta.url);
const catalogBytes = readFileSync(catalogUrl);
const catalog = JSON.parse(catalogBytes.toString('utf8'));
const source = current.duelAbilitySourceFromCatalog(catalog);
const oldSource = legacy.duelAbilitySourceFromCatalog(catalog);
const oldRegistry = legacy.createDuelOfficialProgramRegistry(oldSource);
const defaultRegistry = current.createDuelOfficialProgramRegistry(source);
const assaultRegistry = current.createDuelAssaultOfficialProgramRegistryV1(source);
const pureIds = ['ogn-210-298', 'ogn-215-298', 'sfd-156-221', 'unl-225-219'];
const digest = value => sha256(JSON.stringify(value ?? null));

test('default official registry remains byte-identical to the archived implementation for all 1408 printings', () => {
  assert.equal(sha256(catalogBytes), '06421ffce228ad3412a03f6796e1446e26e61519d79adfddb5892c71e1dab189');
  assert.equal(catalog.cards.length, 1408);
  assert.equal(catalog.dataVersion, '2026-10-15-official-gallery');
  assert.equal(catalog.digest, 'sha256:e9635b38044140375c33d9e5d8e12c1c2386994dfaa9ae8ae6832a127ff9f73d');
  assert.equal(source.dataVersion, oldSource.dataVersion);
  assert.equal(source.sourceCatalogDigest, oldSource.sourceCatalogDigest);
  assert.deepEqual(defaultRegistry.cardIds(), oldRegistry.cardIds());
  assert.deepEqual(defaultRegistry.cardIds(), catalog.cards.map(card => card.id));
  assert.equal(oldRegistry.knownProgramCount, 65);
  assert.equal(defaultRegistry.knownProgramCount, 65);
  assert.equal(assaultRegistry.knownProgramCount, 69);

  const baseline = [];
  const currentHashes = [];
  for (const id of oldRegistry.cardIds()) {
    const oldBinding = oldRegistry.get(id);
    const defaultBinding = defaultRegistry.get(id);
    const oldHashes = [digest(oldBinding), digest(oldRegistry.getProgram(id)), digest(oldRegistry.reference(id))];
    const newHashes = [digest(defaultBinding), digest(defaultRegistry.getProgram(id)), digest(defaultRegistry.reference(id))];
    assert.deepEqual(newHashes, oldHashes, `binding/program/reference changed: ${id}`);
    assert.deepEqual(defaultBinding, oldBinding, `binding fields changed: ${id}`);
    assert.deepEqual(defaultRegistry.reference(id), oldRegistry.reference(id), `reference changed: ${id}`);
    baseline.push([id, ...oldHashes]);
    currentHashes.push([id, ...newHashes]);
  }
  assert.equal(digest(currentHashes), digest(baseline));
  console.log(`[assault-legacy] catalog=${sha256(catalogBytes)} baseline=${sha256(legacySource)} bindings=${digest(baseline)} known=65 optKnown=69`);
});

test('named Assault registry changes exactly four complete printings and leaves compound text unresolved', () => {
  const changed = [];
  const assaultMentions = catalog.cards.filter(card => typeof card.ability === 'string' && card.ability.includes('[Assault'));
  assert.equal(assaultMentions.length, 68);
  assert.equal(assaultMentions.filter(card => !pureIds.includes(card.id)).length, 64);
  for (const id of defaultRegistry.cardIds()) {
    const oldBinding = defaultRegistry.get(id);
    const optBinding = assaultRegistry.get(id);
    if (digest(oldBinding) === digest(optBinding)) {
      assert.deepEqual(assaultRegistry.reference(id), defaultRegistry.reference(id), id);
      continue;
    }
    changed.push(id);
    assert.equal(oldBinding.status, 'unknown', id);
    assert.equal(oldBinding.unresolvedReason, 'unsupported-whole-ability', id);
    assert.equal(oldBinding.program, null, id);
    assert.equal(defaultRegistry.reference(id), undefined, id);
    assert.equal(optBinding.status, 'resolved', id);
    assert.equal(optBinding.sourceDataVersion, oldBinding.sourceDataVersion, id);
    assert.equal(optBinding.sourceCatalogDigest, oldBinding.sourceCatalogDigest, id);
    assert.equal(optBinding.normalizedAbilityText, oldBinding.normalizedAbilityText, id);
    assert.equal(optBinding.program.source.dataVersion, source.dataVersion, id);
    assert.equal(optBinding.program.source.sourceCatalogDigest, source.sourceCatalogDigest, id);
    const amount = id === 'sfd-156-221' ? 2 : 1;
    assert.equal(optBinding.program.semantics.modifier.amount, amount, id);
    const reference = assaultRegistry.reference(id);
    assert.equal(reference.cardId, id);
    assert.equal(reference.dataVersion, source.dataVersion);
    assert.equal(reference.sourceCatalogDigest, source.sourceCatalogDigest);
    const phase = assaultRegistry.sourceProgramPhaseScope(id, 'main', reference);
    assert.equal(phase.scope, 'source-program', id);
    assert.deepEqual(phase.runtimeSubevents, [
      { event: 'attack', handlers: [], modifiers: ['passive.self-assault'] },
    ], id);
  }
  assert.deepEqual(changed.sort(), pureIds);
  for (const card of assaultMentions.filter(card => !pureIds.includes(card.id))) {
    assert.equal(assaultRegistry.get(card.id).status, 'unknown', card.id);
    assert.equal(assaultRegistry.reference(card.id), undefined, card.id);
  }
  assert.equal(assaultRegistry.get('ogn-036-298').status, 'unknown');
  assert.equal(assaultRegistry.reference('ogn-036-298'), undefined);
});

test('legacy bind functions and aliases do not acquire Assault authority', () => {
  for (const id of pureIds) {
    const card = catalog.cards.find(entry => entry.id === id);
    const expected = legacy.bindDuelOfficialProgram(oldSource, card);
    assert.deepEqual(current.bindDuelOfficialProgram(source, card), expected, id);
    assert.deepEqual(current.bindDuelProgram(source, card), expected, id);
    assert.deepEqual(current.bindDuelOfficialProgramByCardId(source, id), expected, id);
    assert.deepEqual(current.createDuelProgramRegistry(source).get(id), expected, id);
    assert.equal(expected.status, 'unknown', id);
  }
});

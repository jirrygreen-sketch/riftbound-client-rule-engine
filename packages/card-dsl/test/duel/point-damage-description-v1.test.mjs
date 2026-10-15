import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../../../card-data/data/deck-catalog.json' with { type: 'json' };
import {
  describeDuelPointDamageV1,
} from '../../dist/duel/point-damage-description-v1.js';
import {
  createDuelOfficialProgramRegistry,
  createDuelPointDamageOfficialProgramRegistryV1,
  duelAbilitySourceFromCatalog,
} from '../../dist/duel/official-programs.js';

const ids = ['ogn-009-298', 'ogn-085-298', 'ogs-003-024', 'ogs-022-024'];
const cards = Object.fromEntries(ids.map((id) => [id, catalog.cards.find((card) => card.id === id)]));

test('recognises only the four complete point-damage whole texts', () => {
  const expected = new Map([
    ['ogn-009-298', [3, 'battlefield']],
    ['ogn-085-298', [6, 'battlefield']],
    ['ogs-003-024', [2, 'battlefield']],
    ['ogs-022-024', [8, 'any']],
  ]);
  for (const id of ids) {
    const description = describeDuelPointDamageV1(cards[id]);
    assert.equal(description.status, 'known');
    assert.equal(description.semantics.kind, 'point-damage');
    assert.deepEqual([description.printedAmount, description.semantics.target.location], expected.get(id));
    assert.equal(description.semantics.target.minSelections, 1);
    assert.equal(description.semantics.target.maxSelections, 1);
    assert.equal(description.source.cardId, undefined, 'descriptor source is a tuple, not an authority id');
  }
});

test('whole-text and card type hardening returns unknown', () => {
  const base = cards['ogn-009-298'];
  const extra = { ...base, ability: `${base.ability}\nDraw 1.` };
  const wrongType = { ...base, cardType: 'Unit' };
  assert.equal(describeDuelPointDamageV1(extra).status, 'unknown');
  assert.equal(describeDuelPointDamageV1(wrongType).reason, 'not-spell');
  assert.equal(describeDuelPointDamageV1({ ...base, ability: '[Action]\nDeal 9 to a unit.' }).reason,
    'unsupported-damage-amount');
});

test('point registry is explicit opt-in and preserves prior variant counts', () => {
  const source = duelAbilitySourceFromCatalog(catalog);
  const old = createDuelOfficialProgramRegistry(source);
  const point = createDuelPointDamageOfficialProgramRegistryV1(source);
  assert.equal(old.knownProgramCount, 65);
  assert.equal(point.knownProgramCount, 81);
  for (const id of ids) {
    assert.equal(old.get(id)?.status, 'unknown');
    const binding = point.get(id);
    assert.equal(binding?.status, 'resolved');
    assert.equal(binding.program?.semantics.kind, 'point-damage-spell-resolution');
    assert.equal(binding.program?.source.cardId, id);
    assert.equal(binding.program?.source.dataVersion, catalog.dataVersion);
    assert.equal(binding.program?.source.sourceCatalogDigest, catalog.digest);
  }
});

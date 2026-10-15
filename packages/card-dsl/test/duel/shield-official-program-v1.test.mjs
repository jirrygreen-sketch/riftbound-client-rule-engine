import test from 'node:test';
import assert from 'node:assert/strict';

const {
  createDuelOfficialProgramRegistry,
  createDuelPointDamageOfficialProgramRegistryV1,
  createDuelShieldOfficialProgramRegistryV1,
  duelAbilitySourceFromCatalog,
  encodeDuelProgramReferenceRaw,
  validateDuelOfficialProgram,
} = await import('../../dist/duel/official-programs.js');
import { CATALOG } from '../fixtures/official-catalog.mjs';

const SHIELD_TEXT = "[Shield] (+1 :rb_might: while I'm a defender.)";
const shieldCards = [
  {
    id: 'ogn-052-298', cardType: 'Unit', ability: SHIELD_TEXT,
    energy: 2, power: null, might: 2, domains: ['Calm'], tags: ['Poro'],
    canonicalCardId: 'card.hash-d758a4eb01d27daf80036a95c8930bef4e01df5c77bf18f8f92392c7dd708701',
    name: 'Stalwart Poro', fullName: 'Stalwart Poro', localizedName: '强强魄罗',
    setCode: 'ogn', cardNumber: 'OGN-052/298', variant: 'standard',
  },
  {
    id: 'ogs-005-024', cardType: 'Unit', ability: SHIELD_TEXT,
    energy: 6, power: 1, might: 6, domains: ['Calm'], tags: ['Ionia', 'Bird'],
    canonicalCardId: 'card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6',
    name: 'Zephyr Sage', fullName: 'Zephyr Sage', localizedName: '和风贤者',
    setCode: 'ogs', cardNumber: 'OGS-005/024', variant: 'standard',
  },
];
const sourceCatalog = { ...CATALOG, cards: [...CATALOG.cards, ...shieldCards] };
const source = duelAbilitySourceFromCatalog(sourceCatalog);

test('Shield is an independent opt-in and the legacy/point registries stay unknown', () => {
  const legacy = createDuelOfficialProgramRegistry(source);
  const point = createDuelPointDamageOfficialProgramRegistryV1(source);
  const shield = createDuelShieldOfficialProgramRegistryV1(source);
  for (const id of shieldCards.map(card => card.id)) {
    assert.equal(legacy.get(id).status, 'unknown');
    assert.equal(point.get(id).status, 'unknown');
    assert.equal(legacy.reference(id), undefined);
    assert.equal(point.reference(id), undefined);
    assert.equal(shield.get(id).status, 'resolved');
    assert.deepEqual(shield.getProgram(id).semantics, {
      kind: 'passive', event: 'defender', sourceScope: 'source-unit-on-board',
      modifier: { kind: 'self-shield', amount: 1 },
    });
  }
  assert.equal(shield.knownProgramCount, legacy.knownProgramCount + 2);
});

test('Shield source query names only defender applicability and survives reference codec', () => {
  const registry = createDuelShieldOfficialProgramRegistryV1(source);
  const id = shieldCards[0].id;
  assert.deepEqual(registry.eventScope(id, 'defend').modifiers, ['passive.self-shield']);
  assert.equal(registry.eventScope(id, 'attack').status, 'known-no-handler');
  const atomic = registry.sourceProgramPhaseScope(id, 'main');
  assert.equal(atomic.scope, 'source-program');
  assert.deepEqual(atomic.runtimeSubevents, [{ event: 'defend', handlers: [], modifiers: ['passive.self-shield'] }]);
  const nested = registry.sourceProgramPhaseScope(id, { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(nested.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(nested.runtimeSubevents[0].event, 'defend');
  const reference = registry.reference(id);
  assert.ok(reference);
  assert.equal(registry.sourceProgramPhaseScope(id, 'main', reference).programId, reference.programId);
  assert.equal(encodeDuelProgramReferenceRaw(reference), encodeDuelProgramReferenceRaw(registry.reference(id)));
  assert.equal(validateDuelOfficialProgram(registry.getProgram(id)).ok, true);
});

test('Shield requires the pinned catalog envelope and complete printing tuple', () => {
  const wrongCatalog = duelAbilitySourceFromCatalog({ ...sourceCatalog, dataVersion: 'catalog-drift-v1' });
  const wrongDigest = duelAbilitySourceFromCatalog({ ...sourceCatalog, digest: 'sha256:catalog-drift' });
  assert.equal(createDuelShieldOfficialProgramRegistryV1(wrongCatalog).get('ogn-052-298').status, 'unknown');
  assert.equal(createDuelShieldOfficialProgramRegistryV1(wrongDigest).get('ogn-052-298').status, 'unknown');
  const altered = duelAbilitySourceFromCatalog({ ...sourceCatalog, cards: sourceCatalog.cards.map(card =>
    card.id === 'ogn-052-298' ? { ...card, might: 3 } : card) });
  assert.equal(createDuelShieldOfficialProgramRegistryV1(altered).get('ogn-052-298').status, 'unknown');
  const textDrift = duelAbilitySourceFromCatalog({ ...sourceCatalog, cards: sourceCatalog.cards.map(card =>
    card.id === 'ogn-052-298' ? { ...card, ability: '[Shield 2]' } : card) });
  assert.equal(createDuelShieldOfficialProgramRegistryV1(textDrift).get('ogn-052-298').status, 'unknown');
});

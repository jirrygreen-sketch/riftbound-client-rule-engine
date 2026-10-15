import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const dsl = await import(moduleSpecifier);

// This is a required local source census. Missing catalog data is a failure.
const catalog = JSON.parse(readFileSync(new URL('../../../card-data/data/deck-catalog.json', import.meta.url), 'utf8'));
const source = dsl.duelAbilitySourceFromCatalog(catalog);
const pureEquip = catalog.cards.filter((card) => card.cardType === 'Gear' && card.tags.includes('Equipment') && [
  'rad-150-167', 'sfd-009-221', 'sfd-016-221', 'sfd-030-221', 'sfd-033-221', 'sfd-042-221',
  'sfd-051-221', 'sfd-073-221', 'sfd-086-221', 'sfd-095-221', 'sfd-102-221', 'sfd-108-221',
  'sfd-115-221', 'sfd-118-221', 'sfd-124-221', 'sfd-133-221', 'sfd-134-221', 'sfd-150-221',
  'sfd-153-221', 'sfd-161-221', 'sfd-172-221', 'sfd-178-221', 'unl-019-219', 'unl-039-219',
  'unl-096-219', 'unl-188-219', 'ven-011-166', 'ven-027-166',
].includes(card.id));

const legacyFactories = [
  dsl.createDuelOfficialProgramRegistry,
  dsl.createDuelAssaultOfficialProgramRegistryV1,
  dsl.createDuelAccelerateOfficialProgramRegistryV1,
  dsl.createDuelExtendedUnitOfficialProgramRegistryV1,
  dsl.createDuelFuryOptionalRosterOfficialProgramRegistryV1,
  dsl.createDuelPointDamageOfficialProgramRegistryV1,
  dsl.createDuelShieldOfficialProgramRegistryV1,
];

test('Equip source census resolves only 24 pure resource-cost printings', () => {
  assert.equal(pureEquip.length, 28);
  const registry = dsl.createDuelEquipOfficialProgramRegistryV1(source);
  const resolved = pureEquip.filter((card) => registry.get(card.id)?.status === 'resolved');
  assert.equal(resolved.length, 24);
  assert.equal(registry.get('rad-150-167').unresolvedReason, 'equip-non-resource-cost');
  assert.equal(registry.get('sfd-150-221').unresolvedReason, 'equip-non-resource-cost');
  assert.equal(registry.get('sfd-178-221').unresolvedReason, 'equip-non-resource-cost');
  assert.equal(registry.get('unl-188-219').unresolvedReason, 'equip-cost-alteration');
  for (const card of resolved) {
    const program = registry.getProgram(card.id);
    assert.equal(program.semantics.kind, 'equip-activated-ability');
    assert.equal(program.semantics.sourceScope, 'source-gear-on-board');
    assert.equal(program.semantics.cost.nonResourceLiteral, null);
    assert.deepEqual(program.semantics.costAlterations, []);
    assert.equal(program.semantics.target.controller, 'source-controller');
    assert.deepEqual(registry.sourceProgramPhaseScope(card.id, { phase: 'begin', mode: 'runtime-subevents' }).runtimeSubevents[0], {
      event: 'activate',
      handlers: ['activated.equip'],
      modifiers: ['activated.equip.base-cost', 'activated.equip.target'],
    });
  }
});

test('Equip source tuple, catalog stamp, tail text and semantic shape are closed', () => {
  const mutate = (edit) => {
    const next = structuredClone(catalog);
    edit(next);
    return dsl.duelAbilitySourceFromCatalog(next);
  };
  assert.equal(dsl.createDuelEquipOfficialProgramRegistryV1(mutate((c) => {
    c.cards.find((x) => x.id === 'sfd-009-221').ability += '\nTail.';
  })).get('sfd-009-221').status, 'unknown');
  assert.equal(dsl.createDuelEquipOfficialProgramRegistryV1(mutate((c) => {
    c.digest = 'sha256:wrong';
  })).get('sfd-009-221').status, 'unknown');
  assert.equal(dsl.createDuelEquipOfficialProgramRegistryV1(mutate((c) => {
    c.cards.find((x) => x.id === 'sfd-009-221').might += 1;
  })).get('sfd-009-221').status, 'unknown');
  assert.equal(dsl.createDuelEquipOfficialProgramRegistryV1(mutate((c) => {
    c.cards.find((x) => x.id === 'sfd-009-221').id = 'sfd-009-221-forged';
  })).get('sfd-009-221'), undefined);

  const registry = dsl.createDuelEquipOfficialProgramRegistryV1(source);
  const program = registry.getProgram('sfd-009-221');
  const partial = structuredClone(program);
  delete partial.semantics.runtime;
  assert.equal(dsl.validateDuelOfficialProgram(partial).ok, false);
  const forgedCost = structuredClone(program);
  forgedCost.semantics.cost.nonResourceLiteral = 'exhaust a friendly unit';
  assert.equal(dsl.validateDuelOfficialProgram(forgedCost).ok, false);
});

test('all legacy factories preserve resolved program references and digests', () => {
  const baseline = legacyFactories.map((factory) => factory(source));
  for (let index = 0; index < baseline.length; index += 1) {
    const old = baseline[index];
    const expanded = dsl.createDuelEquipBeginningOfficialProgramRegistryV1(source);
    assert.equal(expanded.size, old.size);
    for (const id of old.cardIds()) {
      const oldReference = old.reference(id);
      if (oldReference === undefined) continue;
      const expandedReference = expanded.reference(id);
      assert.ok(expandedReference);
      assert.equal(expandedReference.programId, oldReference.programId);
      assert.equal(expandedReference.dataVersion, oldReference.dataVersion);
      assert.equal(expandedReference.sourceCatalogDigest, oldReference.sourceCatalogDigest);
    }
  }
});


test('reviewed source authorization compares every metadata field exactly', () => {
  const original = source.cards.find(card => card.id === 'sfd-009-221');
  assert.ok(original);
  const edits = {
    cardType: 'Unit', ability: original.ability + '\nForged tail.',
    energy: (original.energy ?? 0) + 1, power: (original.power ?? 0) + 1,
    might: (original.might ?? 0) + 1, domains: ['Calm'], tags: ['Forged'],
    canonicalCardId: 'forged-canonical', name: 'forged-name', fullName: 'forged-full-name',
    localizedName: 'forged-localized-name', setCode: 'forged-set',
    cardNumber: 'forged-number', variant: 'forged-variant',
  };
  for (const [field, value] of Object.entries(edits)) {
    const registry = dsl.createDuelEquipOfficialProgramRegistryV1({ ...source, cards: [{ ...original, [field]: value }] });
    assert.equal(registry.get('sfd-009-221').status, 'unknown', field);
  }
});

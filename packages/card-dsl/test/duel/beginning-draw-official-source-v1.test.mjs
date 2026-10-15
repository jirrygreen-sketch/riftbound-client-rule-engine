import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const dsl = await import(moduleSpecifier);
const catalog = JSON.parse(readFileSync(new URL('../../../card-data/data/deck-catalog.json', import.meta.url), 'utf8'));
const source = dsl.duelAbilitySourceFromCatalog(catalog);
const ids = ['ogn-251-298', 'ogn-301-298', 'ogn-301-star-298'];

test('Beginning source census resolves all three Loose Cannon printings', () => {
  const registry = dsl.createDuelBeginningPhaseOfficialProgramRegistryV1(source);
  assert.equal(ids.filter((id) => registry.get(id)?.status === 'resolved').length, 3);
  for (const id of ids) {
    const program = registry.getProgram(id);
    assert.equal(program.semantics.kind, 'beginning-phase-conditional-draw');
    assert.equal(program.semantics.trigger.enqueue, 'unconditional-pending-item');
    assert.equal(program.semantics.effect.condition.clauseRole, 'effect');
    assert.equal(program.semantics.effect.condition.evaluatedAt, 'resolution');
    assert.equal(program.semantics.effect.condition.maximum, 1);
    assert.equal(program.semantics.controller.kind, 'ability-controller');
    assert.equal(program.semantics.controller.source, 'canonical-source-controller');
    assert.equal(program.semantics.controller.status, 'pending');
    assert.equal(program.semantics.runtime.status, 'pending');
    const scope = registry.sourceProgramPhaseScope(id, { phase: 'begin', mode: 'runtime-subevents' });
    assert.equal(scope.directBoundaryStatus, 'handlers-or-modifiers');
    assert.equal(scope.sourceProgramComplete, false);
    assert.deepEqual(scope.handlers, ['trigger.beginning-phase']);
    assert.deepEqual(scope.runtimeSubevents, [{
      event: 'begin', handlers: ['trigger.beginning-phase'], modifiers: [],
    }]);
    assert.deepEqual(registry.eventScope(id, 'begin'), {
      status: 'handlers-or-modifiers', event: 'begin',
      programId: `riftbound-duel-official-v1:${id}`,
      handlers: ['trigger.beginning-phase'], modifiers: [],
    });
  }
});

test('Beginning source rejects wrong printing tuple, stamp, tail text and partial semantic shape', () => {
  const mutate = (edit) => {
    const next = structuredClone(catalog);
    edit(next);
    return dsl.duelAbilitySourceFromCatalog(next);
  };
  assert.equal(dsl.createDuelBeginningPhaseOfficialProgramRegistryV1(mutate((c) => {
    c.cards.find((x) => x.id === 'ogn-251-298').ability += '\nTail.';
  })).get('ogn-251-298').status, 'unknown');
  assert.equal(dsl.createDuelBeginningPhaseOfficialProgramRegistryV1(mutate((c) => {
    c.dataVersion = 'wrong-version';
  })).get('ogn-251-298').status, 'unknown');
  assert.equal(dsl.createDuelBeginningPhaseOfficialProgramRegistryV1(mutate((c) => {
    c.cards.find((x) => x.id === 'ogn-251-298').tags = ['Forged'];
  })).get('ogn-251-298').status, 'unknown');

  const program = dsl.createDuelBeginningPhaseOfficialProgramRegistryV1(source).getProgram('ogn-251-298');
  const partial = structuredClone(program);
  delete partial.semantics.controller;
  assert.equal(dsl.validateDuelOfficialProgram(partial).ok, false);
  const wrongCondition = structuredClone(program);
  wrongCondition.semantics.effect.condition.evaluatedAt = 'trigger';
  assert.equal(dsl.validateDuelOfficialProgram(wrongCondition).ok, false);
});

test('Equip-only and legacy factories do not opt into beginning-draw semantics', () => {
  const equip = dsl.createDuelEquipOfficialProgramRegistryV1(source);
  const legacy = dsl.createDuelOfficialProgramRegistry(source);
  for (const id of ids) {
    assert.equal(equip.get(id)?.status, 'unknown');
    assert.equal(legacy.get(id)?.status, 'unknown');
  }
});


test('reviewed source authorization compares every metadata field exactly', () => {
  const original = source.cards.find(card => card.id === 'ogn-251-298');
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
    const registry = dsl.createDuelBeginningPhaseOfficialProgramRegistryV1({ ...source, cards: [{ ...original, [field]: value }] });
    assert.equal(registry.get('ogn-251-298').status, 'unknown', field);
  }
});

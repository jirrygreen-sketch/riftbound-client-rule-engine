import test from 'node:test';
import assert from 'node:assert/strict';

const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const {
  bindDuelOfficialProgram,
  createDuelAssaultOfficialProgramRegistryV1,
  createDuelOfficialProgramRegistry,
  duelAbilitySourceFromCatalog,
  makeDuelOfficialProgramId,
  queryDuelSourceProgramPhaseScope,
  validateDuelOfficialProgram,
} = await import(moduleSpecifier);

const fields = {
  energy: 2, power: 0, might: 3, domains: ['Fury'], tags: ['Warrior'],
  canonicalCardId: 'card.assault', name: 'Assault Unit', fullName: 'Assault Unit',
  localizedName: 'Assault Unit', setCode: 'syn', cardNumber: 'SYN-1', variant: 'standard',
};
const card = (id, ability, extra = {}) => ({
  id, cardType: 'Unit', ability, ...fields, ...extra,
});
const cards = [
  card('ogn-210-298', '[Assault] (+1 :rb_might: while I\'m an attacker.)'),
  card('ogn-215-298', '[Assault] (+1 :rb_might: while I\'m an attacker.)', { might: 5 }),
  card('sfd-156-221', '[Assault 2] (+2 :rb_might: while I\'m an attacker.)', { might: 3 }),
  card('unl-225-219', '[Assault]', { might: 2 }),
  card('mixed', '[Assault 2], [Shield 2] (+2 :rb_might: while I\'m an attacker or defender.)'),
  card('grant', 'Give a unit [Assault 3] this turn. (+3 :rb_might: while it\'s an attacker.)'),
];
const source = duelAbilitySourceFromCatalog({
  schemaVersion: 1, dataVersion: 'assault-test-v1', digest: 'sha256:assault-test', cards,
});
const legacyRegistry = createDuelOfficialProgramRegistry(source);
const registry = createDuelAssaultOfficialProgramRegistryV1(source);

test('registers only complete pure Assault printings as self-assault passive programs', () => {
  assert.equal(registry.size, cards.length);
  assert.equal(registry.knownProgramCount, 4);
  for (const [id, amount] of [['ogn-210-298', 1], ['ogn-215-298', 1], ['sfd-156-221', 2], ['unl-225-219', 1]]) {
    const binding = registry.get(id);
    assert.equal(binding.status, 'resolved');
    assert.equal(binding.program.programId, makeDuelOfficialProgramId(id));
    assert.deepEqual(binding.program.semantics, {
      kind: 'passive', event: 'attacker', sourceScope: 'source-unit-on-board',
      modifier: { kind: 'self-assault', amount },
    });
  }
  for (const id of ['mixed', 'grant']) {
    assert.equal(registry.get(id).status, 'unknown');
    assert.equal(registry.get(id).program, null);
  }
});

test('Assault source scope exposes only the attack passive subevent', () => {
  const id = 'sfd-156-221';
  const atomic = registry.sourceProgramPhaseScope(id, 'main');
  assert.equal(atomic.scope, 'source-program');
  assert.equal(atomic.sourceApplicabilityStatus, 'known-no-handler');
  assert.deepEqual(atomic.runtimeSubevents, [{
    event: 'attack', handlers: [], modifiers: ['passive.self-assault'],
  }]);
  const nested = registry.sourceProgramPhaseScope(id, { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(nested.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.deepEqual(nested.runtimeSubevents, atomic.runtimeSubevents);
  assert.deepEqual(registry.eventScope(id, 'attack').modifiers, ['passive.self-assault']);
  assert.equal(registry.phaseEventScope(id, 'hold').status, 'known-no-handler');
  assert.deepEqual(registry.phaseEventScope(id, 'hold').modifiers, []);
});

test('validator binds Assault amount to the complete source text', () => {
  const program = registry.getProgram('sfd-156-221');
  const forged = { ...program, semantics: {
    ...program.semantics, modifier: { ...program.semantics.modifier, amount: 3 },
  } };
  assert.equal(validateDuelOfficialProgram(forged).ok, false);
  assert.equal(bindDuelOfficialProgram(source, cards.find(card => card.id === 'sfd-156-221')).status, 'unknown');
});

test('legacy entry points remain unknown while the named registry has private source authority', () => {
  assert.equal(legacyRegistry.knownProgramCount, 0);
  for (const id of ['ogn-210-298', 'ogn-215-298', 'sfd-156-221', 'unl-225-219']) {
    assert.equal(legacyRegistry.get(id).status, 'unknown');
    assert.equal(legacyRegistry.reference(id), undefined);
  }
  const id = 'sfd-156-221';
  const reference = registry.reference(id);
  assert.ok(reference);
  assert.equal(queryDuelSourceProgramPhaseScope(registry, id, 'main', reference).scope, 'source-program');
  assert.equal(queryDuelSourceProgramPhaseScope(legacyRegistry, id, 'main').reason, 'unresolved-program');
  assert.equal(queryDuelSourceProgramPhaseScope(registry.get(id), id, 'main').reason, 'unresolved-program');
  assert.equal(queryDuelSourceProgramPhaseScope({ ...registry }, id, 'main').reason, 'unresolved-program');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../dist/duel/official-programs.js';
const current = await import(moduleSpecifier);

const catalogUrl = new URL('../../card-data/data/deck-catalog.json', import.meta.url);
const catalogPresent = fs.existsSync(catalogUrl);

test('Fury optional roster resolves only the exact Vi compound and pure Deflect printings', { skip: !catalogPresent }, () => {
  const catalog = JSON.parse(fs.readFileSync(catalogUrl, 'utf8'));
  const source = current.duelAbilitySourceFromCatalog(catalog);
  const legacy = current.createDuelOfficialProgramRegistry(source);
  const assault = current.createDuelAssaultOfficialProgramRegistryV1(source);
  const accelerate = current.createDuelAccelerateOfficialProgramRegistryV1(source);
  const extended = current.createDuelExtendedUnitOfficialProgramRegistryV1(source);
  const roster = current.createDuelFuryOptionalRosterOfficialProgramRegistryV1(source);

  assert.equal(legacy.knownProgramCount, 65);
  assert.equal(assault.knownProgramCount, 69);
  assert.equal(accelerate.knownProgramCount, 67);
  assert.equal(extended.knownProgramCount, 71);
  assert.equal(roster.knownProgramCount, 77);
  for (const id of ['ogn-036-298', 'ven-167-166', 'ogn-013-298', 'sfd-037-221', 'unl-220-219', 'unl-t02']) {
    assert.equal(legacy.get(id).status, 'unknown', `legacy ${id}`);
    assert.equal(extended.get(id).status, 'unknown', `extended ${id}`);
    assert.equal(roster.get(id).status, 'resolved', `roster ${id}`);
  }

  const vi = roster.getProgram('ogn-036-298');
  assert.deepEqual(vi.semantics, {
    kind: 'compound-vi-self',
    sourceScope: 'source-unit-on-board',
    ganking: { kind: 'ganking', subject: 'self', scope: 'standard-move', mode: 'permission' },
    activation: {
      event: 'activate', sourceScope: 'source-unit-on-board',
      costs: [{ kind: 'recycle-from-trash', amount: 1, selector: 'one-card', zone: 'controller-trash', payer: 'ability-controller' }],
      effects: [{ kind: 'add-might', amount: 1, recipient: 'ability-source-unit', duration: 'this-turn' }],
    },
  });
  assert.deepEqual(roster.getProgram('ven-167-166').semantics, vi.semantics);
  assert.equal(roster.getProgram('ogn-013-298').semantics.kind, 'deflect');
  assert.equal(roster.getProgram('unl-220-219').semantics.kind, 'deflect');
  assert.equal(roster.getProgram('unl-t02').semantics.kind, 'deflect');
  assert.equal(roster.getProgram('sfd-037-221').semantics.modifier.powerDomain, 'wildcard');
  assert.equal(roster.getProgram('sfd-037-221').semantics.modifier.optional, false);
  assert.equal(roster.getProgram('sfd-037-221').semantics.modifier.automaticPayment, false);
  // CR 1.4 809.1.c/d: each choice adds to the play cost; it is not paid before target choice.
  assert.equal(roster.getProgram('sfd-037-221').semantics.modifier.timing, 'additional-play-cost');
  assert.equal(roster.getProgram('sfd-037-221').semantics.modifier.per, 'each-choice-of-source');
});

test('whole-roster source identity, codecs, and phase scope stay strict', { skip: !catalogPresent }, () => {
  const catalog = JSON.parse(fs.readFileSync(catalogUrl, 'utf8'));
  const source = current.duelAbilitySourceFromCatalog(catalog);
  const roster = current.createDuelFuryOptionalRosterOfficialProgramRegistryV1(source);
  const program = roster.getProgram('ogn-036-298');
  const raw = current.encodeDuelOfficialProgramRaw(program);
  assert.deepEqual(current.decodeDuelOfficialProgramRaw(raw), program);
  assert.equal(roster.resolve(roster.reference('ogn-036-298')).status, 'resolved');
  assert.equal(roster.sourceProgramPhaseScope('ogn-036-298', 'main').scope, 'source-program');
  assert.equal(roster.sourceProgramPhaseScope('ogn-036-298', 'main').sourceApplicabilityStatus, 'known-no-handler');
  assert.equal(roster.sourceProgramPhaseScope('ogn-013-298', { phase: 'main', mode: 'runtime-subevents' }).sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(roster.eventScope('ogn-013-298', 'spell-resolution').status, 'known-no-handler');
  assert.deepEqual(roster.eventScope('ogn-013-298', 'play').modifiers, ['passive.deflect.additional-opponent-power-cost']);
  assert.equal(roster.eventScope('ogn-036-298', 'standard-move').modifiers[0], 'static.ganking');
  assert.equal(roster.eventScope('ogn-036-298', 'activate').handlers[0], 'compound-vi-self.activate');

  const forgedSemantics = { ...program, semantics: { ...program.semantics, activation: {
    ...program.semantics.activation,
    costs: [{ ...program.semantics.activation.costs[0], zone: 'opponent-trash' }],
  } } };
  assert.equal(current.validateDuelOfficialProgram(forgedSemantics).ok, false);
  assert.throws(() => current.encodeDuelOfficialProgramRaw({ ...program, semantics: { ...program.semantics, extra: true } }), /unknown or missing fields/u);

  const changed = {
    ...catalog,
    cards: catalog.cards.map((card) => card.id === 'ogn-013-298' ? { ...card, tags: [...card.tags, 'Forged'] } : card),
  };
  const changedRegistry = current.createDuelFuryOptionalRosterOfficialProgramRegistryV1(
    current.duelAbilitySourceFromCatalog(changed),
  );
  assert.equal(changedRegistry.get('ogn-013-298').status, 'unknown');
  assert.equal(changedRegistry.reference('ogn-013-298'), undefined);
});


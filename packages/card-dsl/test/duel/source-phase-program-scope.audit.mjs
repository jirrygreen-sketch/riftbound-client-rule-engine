// OPT-IN audit: opaque, source-bound phase-program scope against the REAL catalog.
// NOT part of the default `*.test.mjs` glob; run with
//   pnpm --filter @riftbound/card-dsl audit:official-catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  DUEL_PHASE_EVENT_NAMES,
  assertDuelOfficialProgram,
  bindDuelOfficialProgram,
  createDuelOfficialProgramRegistry,
  createDuelProgramReference,
  duelAbilitySourceFromCatalog,
  makeDuelOfficialProgramId,
  queryDuelEventScope,
  queryDuelPhaseEventScope,
  queryDuelSourceProgramPhaseScope,
} = await import(process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js');

const CATALOG_URL = new URL('../../../../packages/card-data/data/deck-catalog.json', import.meta.url);
if (!fs.existsSync(CATALOG_URL)) {
  throw new Error(
    'audit:official-catalog requires the gitignored official catalog at packages/card-data/data/deck-catalog.json; ' +
    'run the card-data sync/build pipeline first.',
  );
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_URL));
const source = duelAbilitySourceFromCatalog(catalog);
const registry = createDuelOfficialProgramRegistry(source);
const card = (id) => {
  const found = catalog.cards.find((entry) => entry.id === id);
  assert.ok(found, `missing catalog printing ${id}`);
  return found;
};
const query = (id, eventOrContext) => registry.sourceProgramPhaseScope(id, eventOrContext);
const requiredEverywhere = [
  'all-source-candidate-closure', 'hidden-zone-event-subjects',
  'continuous-effect-registry', 'cleanup-queue-and-replacements', 'runtime-subevent-journal',
  'recursive-conquer-event-journal',
];
const checkSource = (result, id) => {
  assert.equal(result.scope, 'source-program');
  assert.equal(result.eventRecognized, true);
  assert.equal(result.globalClosureStatus, 'unverified');
  assert.equal(result.sourceProgramComplete, true);
  assert.equal('status' in result, false);
  assert.equal('eventSupported' in result, false);
  assert.equal('replacementsCovered' in result, false);
  assert.equal('continuousCovered' in result, false);
  assert.equal(result.programId, makeDuelOfficialProgramId(id));
  assert.deepEqual(result.reference, registry.reference(id));
  assert.equal(result.sourceCardId, id);
  assert.equal(result.sourceDataVersion, catalog.dataVersion);
  assert.equal(result.sourceCatalogDigest, catalog.digest);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.runtimeSubevents), true);
  for (const contract of requiredEverywhere) {
    assert.ok(result.requiredGlobalRuntimeClosure.includes(contract), `${id}: missing ${contract}`);
  }
  assert.equal('zone' in result, false);
  assert.equal('sourceMode' in result, false);
  assert.equal('zoneEpoch' in result, false);
  assert.equal('sourceUID' in result, false);
};
const checkUnknown = (result, reason, eventRecognized = true) => {
  assert.equal(result.scope, 'unknown');
  assert.equal(result.directBoundaryStatus, 'unknown');
  assert.equal(result.sourceApplicabilityStatus, 'unknown');
  assert.equal(result.globalClosureStatus, 'unverified');
  assert.equal(result.eventRecognized, eventRecognized);
  assert.equal(result.reason, reason);
  assert.equal(result.reference, null);
  assert.equal(result.sourceProgramComplete, false);
  assert.equal('status' in result, false);
  assert.equal('eventSupported' in result, false);
  assert.ok(result.requiredGlobalRuntimeClosure.includes('recursive-conquer-event-journal'));
};

// A local negative is explicitly NOT a proof that other sources or global
// hidden/continuous/queue/runtime/pre-exit work is absent.
test('all thirty genuine Basic Runes give local absence at all twelve phases, never global closure', () => {
  const runes = catalog.cards.filter((entry) => entry.cardType === 'Rune');
  assert.equal(runes.length, 30);
  assert.equal(DUEL_PHASE_EVENT_NAMES.length, 12);
  let checked = 0;
  for (const rune of runes) {
    assert.equal(registry.getProgram(rune.id)?.semantics.kind, 'basic-rune');
    for (const event of DUEL_PHASE_EVENT_NAMES) {
      const result = query(rune.id, event);
      checkSource(result, rune.id);
      assert.equal(result.mode, 'atomic-boundary');
      assert.equal(result.event, event);
      assert.equal(result.sourceApplicabilityStatus, 'known-no-handler');
      assert.deepEqual(result.handlers, []);
      assert.deepEqual(result.modifiers, []);
      assert.deepEqual(result.runtimeSubevents, []);
      if (event === 'draw') assert.ok(result.requiredGlobalRuntimeClosure.includes('draw-subject-journal'));
      if (event === 'lethal-kill') {
        assert.ok(result.requiredGlobalRuntimeClosure.includes('pre-exit-event-journal'));
        assert.ok(result.requiredGlobalRuntimeClosure.includes('kill-trigger-effect-cases'));
      }
      checked++;
    }
  }
  assert.equal(checked, 360);
});

test('Reaction Rune activation remains an independent handler, not an automatic phase subevent', () => {
  const id = 'ogn-007-298';
  assert.deepEqual(queryDuelEventScope(registry.getProgram(id), 'activate').handlers, [
    'basic-rune.basic-rune-energy', 'basic-rune.basic-rune-power',
  ]);
  const result = query(id, { phase: 'main', mode: 'runtime-subevents' });
  checkSource(result, id);
  assert.equal(result.sourceApplicabilityStatus, 'known-no-handler');
  assert.deepEqual(result.runtimeSubevents, []);
  assert.equal(result.requiredGlobalRuntimeClosure.includes('runtime-subevent-journal'), true);
});

test('registry census stays 1381 printings, 65 complete, and 1316 unresolved', () => {
  assert.equal(registry.size, 1381);
  assert.equal(registry.knownProgramCount, 65);
  const unknown = catalog.cards.filter((entry) => registry.get(entry.id)?.status === 'unknown');
  assert.equal(unknown.length, 1316);
  for (const entry of unknown) {
    const result = query(entry.id, 'hold');
    assert.equal(result.sourceApplicabilityStatus, 'unknown', entry.id);
    assert.equal(result.reason, 'unresolved-program', entry.id);
    assert.equal(result.reference, null, entry.id);
    assert.equal(result.sourceProgramComplete, false, entry.id);
  }
});

test('Altar has one real Hold handler across both query modes, never a guessed no-op', () => {
  const id = 'ogn-275-298';
  for (const mode of ['atomic-boundary', 'runtime-subevents']) {
    const result = query(id, { phase: 'hold', mode });
    checkSource(result, id);
    assert.equal(result.sourceApplicabilityStatus, 'handlers-or-modifiers');
    assert.deepEqual(result.handlers, ['trigger.hold']);
    assert.deepEqual(result.modifiers, []);
    assert.deepEqual(result.runtimeSubevents, []);
  }
  assert.equal(query(id, 'begin').sourceApplicabilityStatus, 'known-no-handler');
});

test('Poro and Vi Conquer triggers require recursive runtime events, never a start-phase handler', () => {
  for (const id of ['sfd-069-221', 'unl-222-219', 'unl-187-219', 'unl-229-219']) {
    const atomic = query(id, 'main');
    checkSource(atomic, id);
    assert.equal(atomic.sourceApplicabilityStatus, 'known-no-handler');
  assert.equal(atomic.directBoundaryStatus, 'known-no-handler');
    assert.deepEqual(atomic.handlers, []);
    assert.deepEqual(atomic.runtimeSubevents, [
      { event: 'conquer', handlers: ['trigger.conquer'], modifiers: [] },
    ]);
    assert.ok(atomic.requiredGlobalRuntimeClosure.includes('recursive-conquer-event-journal'));
    const recursive = query(id, { phase: 'main', mode: 'runtime-subevents' });
    checkSource(recursive, id);
    assert.equal(recursive.sourceApplicabilityStatus, 'handlers-or-modifiers');
    assert.equal(recursive.directBoundaryStatus, 'known-no-handler');
    assert.deepEqual(recursive.handlers, []);
    assert.deepEqual(recursive.runtimeSubevents, atomic.runtimeSubevents);
    assert.deepEqual(queryDuelEventScope(registry.getProgram(id), 'conquer').handlers, ['trigger.conquer']);
  }
});

test('Yi advertises both Ganking permission and enter-ready replacement as potential subevents', () => {
  const id = 'ogs-009-024';
  const atomic = query(id, 'main');
  checkSource(atomic, id);
  assert.equal(atomic.sourceApplicabilityStatus, 'known-no-handler');
  assert.equal(atomic.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(atomic.runtimeSubevents, [
    { event: 'standard-move', handlers: ['static.ganking'], modifiers: [] },
    { event: 'unit-enter', handlers: ['static.enter-ready'], modifiers: [] },
  ]);
  const nested = query(id, { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(nested.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(nested.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(nested.handlers, []);
  assert.deepEqual(nested.runtimeSubevents, atomic.runtimeSubevents);
  assert.deepEqual(queryDuelEventScope(registry.getProgram(id), 'unit-enter').handlers, ['static.enter-ready']);
});

test('standalone enter-ready static programs retain potential Unit-entry replacement', () => {
  for (const id of ['ogs-016-024', 'sfd-006-221']) {
    const result = query(id, { phase: 'draw', mode: 'runtime-subevents' });
    checkSource(result, id);
    assert.equal(result.sourceApplicabilityStatus, 'handlers-or-modifiers');
    assert.deepEqual(result.runtimeSubevents, [
      { event: 'unit-enter', handlers: ['static.enter-ready'], modifiers: [] },
    ]);
    assert.ok(result.requiredGlobalRuntimeClosure.includes('draw-subject-journal'));
  }
});

test('Bandle Tree retains Hide permission modifier for nested runtime Hide, not direct phase', () => {
  const id = 'ogn-278-298';
  const atomic = query(id, 'main');
  checkSource(atomic, id);
  assert.equal(atomic.sourceApplicabilityStatus, 'known-no-handler');
  assert.equal(atomic.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(atomic.modifiers, []);
  assert.deepEqual(atomic.runtimeSubevents, [
    { event: 'hide', handlers: [], modifiers: ['passive.additional-hide-permission'] },
  ]);
  const nested = query(id, { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(nested.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(nested.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(nested.handlers, []);
  assert.deepEqual(nested.modifiers, []);
  assert.deepEqual(nested.runtimeSubevents, atomic.runtimeSubevents);
  assert.deepEqual(queryDuelEventScope(registry.getProgram(id), 'hide').modifiers, ['passive.additional-hide-permission']);
});

test('Viktor activated ability never auto-fires at a phase boundary', () => {
  for (const id of ['ogn-265-298', 'ogn-308-298', 'ogn-308-star-298']) {
    const result = query(id, { phase: 'main', mode: 'runtime-subevents' });
    checkSource(result, id);
    assert.equal(result.sourceApplicabilityStatus, 'known-no-handler');
    assert.deepEqual(result.runtimeSubevents, []);
    assert.deepEqual(queryDuelEventScope(registry.getProgram(id), 'activate').handlers, ['activated.activate']);
  }
});

test('verified printed Unit and Recruit no-ability programs exclude only their printed abilities', () => {
  for (const id of ['ogn-049-298', 'ogn-271-298', 'ven-t04']) {
    const result = query(id, { phase: 'main', mode: 'runtime-subevents' });
    checkSource(result, id);
    assert.equal(result.sourceApplicabilityStatus, 'known-no-handler');
    assert.deepEqual(result.runtimeSubevents, []);
  }
});

test('opaque registry and card id are the sole source-scope entry; bare programs/bindings fail closed', () => {
  const id = 'ogn-275-298';
  const program = registry.getProgram(id);
  const reference = createDuelProgramReference(program);
  const context = { phase: 'hold', mode: 'runtime-subevents' };
  const expected = query(id, context);
  assert.deepEqual(queryDuelSourceProgramPhaseScope(registry, id, context, reference), expected);
  assert.deepEqual(registry.sourceProgramPhaseScope(id, context, reference), expected);
  for (const bare of [program, registry.get(id), bindDuelOfficialProgram(source, card(id)), { ...registry }]) {
    checkUnknown(queryDuelSourceProgramPhaseScope(bare, id, context, reference), 'unresolved-program');
  }
  assert.notEqual(expected.reference, reference);
  assert.equal(Object.isFrozen(expected.reference), true);
});

test('reference mismatch rejects wrong card, program ID, digest, version and extra metadata', () => {
  const id = 'ogn-275-298';
  const reference = registry.reference(id);
  for (const wrong of [
    registry.reference('ogn-007-298'),
    { ...reference, programId: makeDuelOfficialProgramId('ogn-007-298') },
    { ...reference, sourceCatalogDigest: 'sha256:wrong' },
    { ...reference, dataVersion: 'future' },
    { ...reference, zoneEpoch: 12 },
  ]) {
    assert.throws(() => queryDuelSourceProgramPhaseScope(registry, id, 'hold', wrong), TypeError);
  }
});

test('wrong or partial source binding cannot yield absence, including forged tuple', () => {
  const real = card('ogn-007-298');
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, domains: ['Order'] }), TypeError);
  const differentRegistry = createDuelOfficialProgramRegistry({
    ...source, cards: [{ ...real, domains: ['Order'] }],
  });
  assert.equal(differentRegistry.get(real.id).status, 'unknown');
  checkUnknown(differentRegistry.sourceProgramPhaseScope(real.id, 'main'), 'unresolved-program');
  const valid = registry.get(real.id);
  for (const forged of [
    { ...valid, cardId: 'unl-187-219' },
    { ...valid, normalizedAbilityText: 'I enter ready.' },
    { ...valid, sourceCatalogDigest: 'sha256:wrong' },
    { ...valid, status: 'unknown' },
    { ...valid, program: null },
    { ...valid, program: { ...valid.program, source: { ...valid.program.source, domains: ['Order'] } } },
  ]) {
    checkUnknown(queryDuelSourceProgramPhaseScope(forged, real.id, 'main'), 'unresolved-program');
  }
});

test('missing, partial and unresolved registry inputs fail closed', () => {
  for (const input of [undefined, null, { status: 'resolved', program: null }, registry.get('ogn-205-298'), { cardId: 'ogn-007-298' }]) {
    const result = queryDuelSourceProgramPhaseScope(input, 'ogn-007-298', 'draw');
    checkUnknown(result, 'unresolved-program');
    assert.ok(result.requiredGlobalRuntimeClosure.includes('draw-subject-journal'));
  }
  checkUnknown(queryDuelSourceProgramPhaseScope(registry, 'not-in-catalog-999', 'draw'), 'unresolved-program');
  checkUnknown(queryDuelSourceProgramPhaseScope(registry, 'ogn-205-298', 'draw'), 'unresolved-program');
});

test('invalid context and bogus phase never become a negative proof', () => {
  const id = 'ogn-007-298';
  const invalid = [
    null, undefined, 5, {}, { phase: 'main' }, { mode: 'atomic-boundary' },
    { phase: 'main', mode: 'phase' }, { phase: 'main', mode: 'atomic-boundary', event: 'hold' },
    { phase: null, mode: 'atomic-boundary' }, { phase: 'main', mode: 'runtime-subevents', zone: 'hand' },
  ];
  for (const context of invalid) {
    checkUnknown(query(id, context), 'invalid-context',
      typeof context?.phase === 'string' && DUEL_PHASE_EVENT_NAMES.includes(context.phase));
  }
  for (const context of ['not-a-phase', { phase: 'not-a-phase', mode: 'atomic-boundary' }]) {
    checkUnknown(query(id, context), 'unknown-event', false);
  }
});

test('lethal-kill never aliases ordinary death and demands pre-exit/kill evidence', () => {
  for (const id of ['ogn-007-298', 'ogs-009-024', 'ogn-275-298']) {
    const result = query(id, { phase: 'lethal-kill', mode: 'runtime-subevents' });
    checkSource(result, id);
    assert.ok(result.requiredGlobalRuntimeClosure.includes('pre-exit-event-journal'));
    assert.ok(result.requiredGlobalRuntimeClosure.includes('kill-trigger-effect-cases'));
    assert.ok(!result.runtimeSubevents.some((subevent) => subevent.event === 'death'));
    assert.deepEqual(result.handlers, []);
  }
  assert.equal(query('ogn-007-298', 'death').reason, 'unknown-event');
  assert.equal(queryDuelPhaseEventScope(registry.getProgram('ogn-007-298'), 'lethal-kill').reason, 'unsupported-phase-event');
});

test('future semantic kind, forged real kind and extra fields cannot enroll in source scope', () => {
  const program = registry.getProgram('ogn-049-298');
  for (const semantics of [
    { kind: 'future-trigger', event: 'begin' },
    { ...program.semantics, unknownCompilerField: true },
    { kind: 'activated', event: 'activate', sourceScope: 'ability-source', costs: [], effects: [] },
    { ...registry.getProgram('ogn-278-298').semantics },
  ]) {
    checkUnknown(queryDuelSourceProgramPhaseScope({ ...program, semantics }, program.cardId, 'begin'), 'unresolved-program');
  }
});

test('self-consistent source and semantics forgery cannot borrow a real reference or invent a printing', () => {
  const yi = registry.getProgram('ogs-009-024');
  const forgedYi = {
    ...yi,
    source: { ...yi.source, normalizedAbilityText: '' },
    semantics: { kind: 'no-ability', playability: {
      kind: 'printed-unit', fromHand: true, energyCost: yi.source.energy, tokenOnly: false,
    } },
  };
  assertDuelOfficialProgram(forgedYi); // Valid IR syntax is NOT registry authority.
  assert.deepEqual(createDuelProgramReference(forgedYi), registry.reference(yi.cardId));
  checkUnknown(queryDuelSourceProgramPhaseScope(forgedYi, yi.cardId, 'main', registry.reference(yi.cardId)), 'unresolved-program');
  const trustedYi = query(yi.cardId, { phase: 'main', mode: 'runtime-subevents' });
  checkSource(trustedYi, yi.cardId);
  assert.equal(trustedYi.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.deepEqual(trustedYi.runtimeSubevents.map((event) => event.event), ['standard-move', 'unit-enter']);

  const unit = registry.getProgram('ogn-049-298');
  for (const [cardId, digest] of [
    ['not-in-catalog-999', unit.source.sourceCatalogDigest],
    [unit.cardId, 'sha256:invented'],
  ]) {
    const invented = { ...unit, cardId, programId: makeDuelOfficialProgramId(cardId),
      source: { ...unit.source, cardId, sourceCatalogDigest: digest } };
    const inventedBinding = { ...registry.get(unit.cardId), cardId, sourceCatalogDigest: digest, program: invented };
    assertDuelOfficialProgram(invented);
    checkUnknown(queryDuelSourceProgramPhaseScope(invented, cardId, 'begin', createDuelProgramReference(invented)), 'unresolved-program');
    checkUnknown(queryDuelSourceProgramPhaseScope(inventedBinding, cardId, 'begin'), 'unresolved-program');
  }
  checkUnknown(queryDuelSourceProgramPhaseScope(registry, 'not-in-catalog-999', 'begin'), 'unresolved-program');
});

test('all semantic and fingerprint arrays reject future keys, symbols, holes, accessors and exotic prototypes', () => {
  const cases = [
    ['ogs-009-024', (program) => { program.semantics.abilities.futureEvent = { event: 'begin', handler: 'future.begin' }; }],
    ['unl-187-219', (program) => { program.semantics.effects.futureEvent = { event: 'begin', handler: 'future.begin' }; }],
    ['unl-187-219', (program) => { program.semantics.costs.futureEvent = { event: 'begin', handler: 'future.begin' }; }],
    ['ogn-265-298', (program) => { program.semantics.effects.extra = true; }],
    ['ogn-007-298', (program) => { program.semantics.abilities[0].costs.futureEvent = true; }],
    ['ogn-007-298', (program) => { program.semantics.abilities[1].effects[Symbol('future')] = true; }],
    ['ogn-049-298', (program) => { program.source.domains.extra = 'future'; }],
    ['ogn-049-298', (program) => { program.source.tags[Symbol('future')] = true; }],
    ['ogs-009-024', (program) => { delete program.semantics.abilities[0]; }],
    ['ogs-009-024', (program) => { Object.defineProperty(program.semantics.abilities, 0,
      { configurable: true, get: () => ({ kind: 'ganking', subject: 'self', scope: 'standard-move', mode: 'permission' }) }); }],
    ['ogs-009-024', (program) => { Object.setPrototypeOf(program.semantics.abilities, Object.create(Array.prototype)); }],
  ];
  for (const [id, corrupt] of cases) {
    const program = structuredClone(registry.getProgram(id));
    corrupt(program);
    assert.throws(() => assertDuelOfficialProgram(program), TypeError, id);
    checkUnknown(queryDuelSourceProgramPhaseScope(program, id, 'begin'), 'unresolved-program');
    assert.equal(query(id, 'begin').sourceProgramComplete, true, `registry is unaffected by ${id} mutation`);
  }
  for (const corrupt of [
    (cards) => { cards.extra = true; },
    (cards) => { delete cards[0]; },
    (cards) => { Object.defineProperty(cards, 0, { get: () => source.cards[0] }); },
    (cards) => { Object.setPrototypeOf(cards, Object.create(Array.prototype)); },
  ]) {
    const cards = [...source.cards];
    corrupt(cards);
    assert.throws(() => createDuelOfficialProgramRegistry({ ...source, cards }), TypeError);
  }
});

test('frozen phase vocabulary cannot promote Rune activate or arbitrary new boundaries', () => {
  assert.equal(Object.isFrozen(DUEL_PHASE_EVENT_NAMES), true);
  assert.throws(() => DUEL_PHASE_EVENT_NAMES.push('activate'), TypeError);
  assert.throws(() => DUEL_PHASE_EVENT_NAMES.splice(0, 0, 'future-phase'), TypeError);
  assert.deepEqual(DUEL_PHASE_EVENT_NAMES, [
    'awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending',
    'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout',
  ]);
  for (const event of ['activate', 'future-phase']) {
    checkUnknown(query('ogn-007-298', event), 'unknown-event', false);
    assert.equal(registry.phaseEventScope('ogn-007-298', event).reason, 'unknown-event');
  }
  assert.equal(registry.eventScope('ogn-007-298', 'activate').handlers.length, 2);
});

test('recursive Conquer closure is global even for Rune/no-ability/unknown scopes', () => {
  for (const id of ['ogn-007-298', 'ogn-049-298', 'ogn-205-298']) {
    for (const phase of ['awaken', 'main', 'draw', 'lethal-kill']) {
      const scope = query(id, phase);
      assert.equal(scope.globalClosureStatus, 'unverified');
      assert.ok(scope.requiredGlobalRuntimeClosure.includes('recursive-conquer-event-journal'), `${id} ${phase}`);
    }
  }
  checkUnknown(query('not-in-catalog-999', 'main'), 'unresolved-program');
});

test('source-local absence has no Core whole-phase evidence shape', () => {
  for (const id of ['ogn-007-298', 'ogs-009-024', 'ogn-205-298']) {
    const result = query(id, 'main');
    assert.equal(result.globalClosureStatus, 'unverified');
    for (const key of ['status', 'eventSupported', 'replacementsCovered', 'staticCovered',
      'continuousCovered', 'triggersCovered', 'programReference', 'uid', 'zoneEpoch']) {
      assert.equal(key in result, false, `${id}: ${key} cannot be a Core evidence field`);
    }
    assert.notEqual(result.scope, 'known-no-handler');
    assert.notEqual(result.scope, 'handlers-or-modifiers');
  }
});

test('legacy phase API stays stricter: nine recognized boundaries remain unknown', () => {
  for (const phase of DUEL_PHASE_EVENT_NAMES.filter((name) => !['awaken', 'begin', 'hold'].includes(name))) {
    const old = registry.phaseEventScope('ogn-007-298', phase);
    const sourceOnly = query('ogn-007-298', phase);
    assert.equal(old.status, 'unknown', phase);
    assert.equal(old.reason, 'unsupported-phase-event', phase);
    assert.equal(sourceOnly.sourceApplicabilityStatus, 'known-no-handler', phase);
    assert.ok(sourceOnly.requiredGlobalRuntimeClosure.length >= 5);
  }
});

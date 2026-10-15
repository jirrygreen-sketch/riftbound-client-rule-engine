// Default (clean-checkout) suite for the opaque, source-bound phase-program scope.
//
// Reads the TRACKED synthetic fixture at test/fixtures/official-catalog.mjs.
// No gitignored official data is read and there is no data-missing skip; the
// real-catalog census is in the explicit `*.audit.mjs` files.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG, CENSUS, RUNE_IDS, cardById } from '../fixtures/official-catalog.mjs';

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

const catalog = CATALOG;
const source = duelAbilitySourceFromCatalog(catalog);
const registry = createDuelOfficialProgramRegistry(source);
const card = (id) => {
  const found = cardById(id);
  assert.ok(found, `fixture printing ${id}`);
  return found;
};
const query = (id, eventOrContext) => registry.sourceProgramPhaseScope(id, eventOrContext);

const RUNE = 'ogn-007-298';
const PRINTED_UNIT = 'syn-unit-printed-empty';
const RECRUIT_UNIT = 'syn-unit-recruit-empty';
const STATIC_BOTH = 'syn-unit-static-both';
const ENTER_READY = 'syn-unit-static-enter-ready';
const ALTAR = 'syn-battlefield-altar';
const HIDE = 'syn-battlefield-hide';
const VIKTOR = 'syn-legend-viktor';
const VI = 'syn-legend-vi';
const PORO = ['syn-unit-poro', 'syn-unit-poro-alt'];
const UNKNOWN = 'syn-spell-unknown';

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

test('all thirty genuine Basic Runes give local absence at all twelve phases, never global closure', () => {
  const runes = RUNE_IDS.map((id) => card(id));
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
  assert.deepEqual(queryDuelEventScope(registry.getProgram(RUNE), 'activate').handlers, [
    'basic-rune.basic-rune-energy', 'basic-rune.basic-rune-power',
  ]);
  const result = query(RUNE, { phase: 'main', mode: 'runtime-subevents' });
  checkSource(result, RUNE);
  assert.equal(result.sourceApplicabilityStatus, 'known-no-handler');
  assert.deepEqual(result.runtimeSubevents, []);
  assert.equal(result.requiredGlobalRuntimeClosure.includes('runtime-subevent-journal'), true);
});

test('registry census matches the fixture and unresolved printings stay unknown', () => {
  assert.equal(registry.size, CENSUS.size);
  assert.equal(registry.knownProgramCount, CENSUS.known);
  const unknown = catalog.cards.filter((entry) => registry.get(entry.id)?.status === 'unknown');
  assert.equal(unknown.length, CENSUS.unknown);
  for (const entry of unknown) {
    const result = query(entry.id, 'hold');
    assert.equal(result.sourceApplicabilityStatus, 'unknown', entry.id);
    assert.equal(result.reason, 'unresolved-program', entry.id);
    assert.equal(result.reference, null, entry.id);
    assert.equal(result.sourceProgramComplete, false, entry.id);
  }
});

test('the hold Battlefield has one real Hold handler across both query modes, never a guessed no-op', () => {
  for (const mode of ['atomic-boundary', 'runtime-subevents']) {
    const result = query(ALTAR, { phase: 'hold', mode });
    checkSource(result, ALTAR);
    assert.equal(result.sourceApplicabilityStatus, 'handlers-or-modifiers');
    assert.deepEqual(result.handlers, ['trigger.hold']);
    assert.deepEqual(result.modifiers, []);
    assert.deepEqual(result.runtimeSubevents, []);
  }
  assert.equal(query(ALTAR, 'begin').sourceApplicabilityStatus, 'known-no-handler');
});

test('conquer triggers require recursive runtime events, never a start-phase handler', () => {
  for (const id of [...PORO, VI]) {
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

test('the both-ability static Unit advertises Ganking and enter-ready as potential subevents', () => {
  const atomic = query(STATIC_BOTH, 'main');
  checkSource(atomic, STATIC_BOTH);
  assert.equal(atomic.sourceApplicabilityStatus, 'known-no-handler');
  assert.equal(atomic.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(atomic.runtimeSubevents, [
    { event: 'standard-move', handlers: ['static.ganking'], modifiers: [] },
    { event: 'unit-enter', handlers: ['static.enter-ready'], modifiers: [] },
  ]);
  const nested = query(STATIC_BOTH, { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(nested.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(nested.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(nested.handlers, []);
  assert.deepEqual(nested.runtimeSubevents, atomic.runtimeSubevents);
  assert.deepEqual(queryDuelEventScope(registry.getProgram(STATIC_BOTH), 'unit-enter').handlers, ['static.enter-ready']);
});

test('standalone enter-ready static programs retain potential Unit-entry replacement', () => {
  const result = query(ENTER_READY, { phase: 'draw', mode: 'runtime-subevents' });
  checkSource(result, ENTER_READY);
  assert.equal(result.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.deepEqual(result.runtimeSubevents, [
    { event: 'unit-enter', handlers: ['static.enter-ready'], modifiers: [] },
  ]);
  assert.ok(result.requiredGlobalRuntimeClosure.includes('draw-subject-journal'));
});

test('the hide Battlefield retains Hide permission modifier for nested runtime Hide, not direct phase', () => {
  const atomic = query(HIDE, 'main');
  checkSource(atomic, HIDE);
  assert.equal(atomic.sourceApplicabilityStatus, 'known-no-handler');
  assert.equal(atomic.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(atomic.modifiers, []);
  assert.deepEqual(atomic.runtimeSubevents, [
    { event: 'hide', handlers: [], modifiers: ['passive.additional-hide-permission'] },
  ]);
  const nested = query(HIDE, { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(nested.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(nested.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(nested.handlers, []);
  assert.deepEqual(nested.modifiers, []);
  assert.deepEqual(nested.runtimeSubevents, atomic.runtimeSubevents);
  assert.deepEqual(queryDuelEventScope(registry.getProgram(HIDE), 'hide').modifiers, ['passive.additional-hide-permission']);
});

test('the activated Legend never auto-fires at a phase boundary', () => {
  const result = query(VIKTOR, { phase: 'main', mode: 'runtime-subevents' });
  checkSource(result, VIKTOR);
  assert.equal(result.sourceApplicabilityStatus, 'known-no-handler');
  assert.deepEqual(result.runtimeSubevents, []);
  assert.deepEqual(queryDuelEventScope(registry.getProgram(VIKTOR), 'activate').handlers, ['activated.activate']);
});

test('verified printed Unit and Recruit no-ability programs exclude only their printed abilities', () => {
  for (const id of [PRINTED_UNIT, RECRUIT_UNIT]) {
    const result = query(id, { phase: 'main', mode: 'runtime-subevents' });
    checkSource(result, id);
    assert.equal(result.sourceApplicabilityStatus, 'known-no-handler');
    assert.deepEqual(result.runtimeSubevents, []);
  }
});

test('opaque registry and card id are the sole source-scope entry; bare programs/bindings fail closed', () => {
  const program = registry.getProgram(ALTAR);
  const reference = createDuelProgramReference(program);
  const context = { phase: 'hold', mode: 'runtime-subevents' };
  const expected = query(ALTAR, context);
  assert.deepEqual(queryDuelSourceProgramPhaseScope(registry, ALTAR, context, reference), expected);
  assert.deepEqual(registry.sourceProgramPhaseScope(ALTAR, context, reference), expected);
  for (const bare of [program, registry.get(ALTAR), bindDuelOfficialProgram(source, card(ALTAR)), { ...registry }]) {
    checkUnknown(queryDuelSourceProgramPhaseScope(bare, ALTAR, context, reference), 'unresolved-program');
  }
  assert.notEqual(expected.reference, reference);
  assert.equal(Object.isFrozen(expected.reference), true);
});

test('reference mismatch rejects wrong card, program ID, digest, version and extra metadata', () => {
  const reference = registry.reference(ALTAR);
  for (const wrong of [
    registry.reference(RUNE),
    { ...reference, programId: makeDuelOfficialProgramId(RUNE) },
    { ...reference, sourceCatalogDigest: 'sha256:wrong' },
    { ...reference, dataVersion: 'future' },
    { ...reference, zoneEpoch: 12 },
  ]) {
    assert.throws(() => queryDuelSourceProgramPhaseScope(registry, ALTAR, 'hold', wrong), TypeError);
  }
});

test('wrong or partial source binding cannot yield absence, including forged tuple', () => {
  const real = card(RUNE);
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, domains: ['Order'] }), TypeError);
  const differentRegistry = createDuelOfficialProgramRegistry({
    ...source, cards: [{ ...real, domains: ['Order'] }],
  });
  assert.equal(differentRegistry.get(real.id).status, 'unknown');
  checkUnknown(differentRegistry.sourceProgramPhaseScope(real.id, 'main'), 'unresolved-program');
  const valid = registry.get(real.id);
  for (const forged of [
    { ...valid, cardId: VI },
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
  for (const input of [undefined, null, { status: 'resolved', program: null }, registry.get(UNKNOWN), { cardId: RUNE }]) {
    const result = queryDuelSourceProgramPhaseScope(input, RUNE, 'draw');
    checkUnknown(result, 'unresolved-program');
    assert.ok(result.requiredGlobalRuntimeClosure.includes('draw-subject-journal'));
  }
  checkUnknown(queryDuelSourceProgramPhaseScope(registry, 'not-in-catalog-999', 'draw'), 'unresolved-program');
  checkUnknown(queryDuelSourceProgramPhaseScope(registry, UNKNOWN, 'draw'), 'unresolved-program');
});

test('invalid context and bogus phase never become a negative proof', () => {
  const invalid = [
    null, undefined, 5, {}, { phase: 'main' }, { mode: 'atomic-boundary' },
    { phase: 'main', mode: 'phase' }, { phase: 'main', mode: 'atomic-boundary', event: 'hold' },
    { phase: null, mode: 'atomic-boundary' }, { phase: 'main', mode: 'runtime-subevents', zone: 'hand' },
  ];
  for (const context of invalid) {
    checkUnknown(query(RUNE, context), 'invalid-context',
      typeof context?.phase === 'string' && DUEL_PHASE_EVENT_NAMES.includes(context.phase));
  }
  for (const context of ['not-a-phase', { phase: 'not-a-phase', mode: 'atomic-boundary' }]) {
    checkUnknown(query(RUNE, context), 'unknown-event', false);
  }
});

test('lethal-kill never aliases ordinary death and demands pre-exit/kill evidence', () => {
  for (const id of [RUNE, STATIC_BOTH, ALTAR]) {
    const result = query(id, { phase: 'lethal-kill', mode: 'runtime-subevents' });
    checkSource(result, id);
    assert.ok(result.requiredGlobalRuntimeClosure.includes('pre-exit-event-journal'));
    assert.ok(result.requiredGlobalRuntimeClosure.includes('kill-trigger-effect-cases'));
    assert.ok(!result.runtimeSubevents.some((subevent) => subevent.event === 'death'));
    assert.deepEqual(result.handlers, []);
  }
  assert.equal(query(RUNE, 'death').reason, 'unknown-event');
  assert.equal(queryDuelPhaseEventScope(registry.getProgram(RUNE), 'lethal-kill').reason, 'unsupported-phase-event');
});

test('future semantic kind, forged real kind and extra fields cannot enroll in source scope', () => {
  const program = registry.getProgram(PRINTED_UNIT);
  for (const semantics of [
    { kind: 'future-trigger', event: 'begin' },
    { ...program.semantics, unknownCompilerField: true },
    { kind: 'activated', event: 'activate', sourceScope: 'ability-source', costs: [], effects: [] },
    { ...registry.getProgram(HIDE).semantics },
  ]) {
    checkUnknown(queryDuelSourceProgramPhaseScope({ ...program, semantics }, program.cardId, 'begin'), 'unresolved-program');
  }
});

test('self-consistent source and semantics forgery cannot borrow a real reference or invent a printing', () => {
  const yi = registry.getProgram(STATIC_BOTH);
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

  const unit = registry.getProgram(PRINTED_UNIT);
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
    [STATIC_BOTH, (program) => { program.semantics.abilities.futureEvent = { event: 'begin', handler: 'future.begin' }; }],
    [VI, (program) => { program.semantics.effects.futureEvent = { event: 'begin', handler: 'future.begin' }; }],
    [VI, (program) => { program.semantics.costs.futureEvent = { event: 'begin', handler: 'future.begin' }; }],
    [VIKTOR, (program) => { program.semantics.effects.extra = true; }],
    [RUNE, (program) => { program.semantics.abilities[0].costs.futureEvent = true; }],
    [RUNE, (program) => { program.semantics.abilities[1].effects[Symbol('future')] = true; }],
    [PRINTED_UNIT, (program) => { program.source.domains.extra = 'future'; }],
    [PRINTED_UNIT, (program) => { program.source.tags[Symbol('future')] = true; }],
    [STATIC_BOTH, (program) => { delete program.semantics.abilities[0]; }],
    [STATIC_BOTH, (program) => { Object.defineProperty(program.semantics.abilities, 0,
      { configurable: true, get: () => ({ kind: 'ganking', subject: 'self', scope: 'standard-move', mode: 'permission' }) }); }],
    [STATIC_BOTH, (program) => { Object.setPrototypeOf(program.semantics.abilities, Object.create(Array.prototype)); }],
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
    checkUnknown(query(RUNE, event), 'unknown-event', false);
    assert.equal(registry.phaseEventScope(RUNE, event).reason, 'unknown-event');
  }
  assert.equal(registry.eventScope(RUNE, 'activate').handlers.length, 2);
});

test('recursive Conquer closure is global even for Rune/no-ability/unknown scopes', () => {
  for (const id of [RUNE, PRINTED_UNIT, UNKNOWN]) {
    for (const phase of ['awaken', 'main', 'draw', 'lethal-kill']) {
      const scope = query(id, phase);
      assert.equal(scope.globalClosureStatus, 'unverified');
      assert.ok(scope.requiredGlobalRuntimeClosure.includes('recursive-conquer-event-journal'), `${id} ${phase}`);
    }
  }
  checkUnknown(query('not-in-catalog-999', 'main'), 'unresolved-program');
});

test('source-local absence has no Core whole-phase evidence shape', () => {
  for (const id of [RUNE, STATIC_BOTH, UNKNOWN]) {
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
    const old = registry.phaseEventScope(RUNE, phase);
    const sourceOnly = query(RUNE, phase);
    assert.equal(old.status, 'unknown', phase);
    assert.equal(old.reason, 'unsupported-phase-event', phase);
    assert.equal(sourceOnly.sourceApplicabilityStatus, 'known-no-handler', phase);
    assert.ok(sourceOnly.requiredGlobalRuntimeClosure.length >= 5);
  }
});

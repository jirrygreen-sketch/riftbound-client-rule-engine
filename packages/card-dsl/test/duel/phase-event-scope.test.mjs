// Default (clean-checkout) suite for the strict phase-boundary event scope.
//
// Reads the TRACKED synthetic fixture at test/fixtures/official-catalog.mjs.
// No gitignored official data is read and there is no data-missing skip; the
// real-catalog census is in the explicit `*.audit.mjs` files.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG, CENSUS, RUNE_IDS, cardById } from '../fixtures/official-catalog.mjs';

const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const {
  DUEL_PHASE_EVENT_NAMES,
  bindDuelOfficialProgram,
  createDuelOfficialProgramRegistry,
  createDuelProgramReference,
  decodeDuelProgramReferenceRaw,
  duelAbilitySourceFromCatalog,
  encodeDuelProgramReferenceRaw,
  makeDuelOfficialProgramId,
  queryDuelEventScope,
  queryDuelPhaseEventScope,
} = await import(moduleSpecifier);

const catalog = CATALOG;
const source = duelAbilitySourceFromCatalog(catalog);
const registry = createDuelOfficialProgramRegistry(source);
const card = (id) => {
  const found = cardById(id);
  assert.ok(found, `fixture printing ${id}`);
  return found;
};
const bind = (id) => bindDuelOfficialProgram(source, card(id));
const runeIds = RUNE_IDS;
const resolvedScope = (id, event) => registry.phaseEventScope(id, event);

const RUNE = 'ogn-007-298';
const ENTER_READY = 'syn-unit-static-enter-ready';
const ALTAR = 'syn-battlefield-altar';
const UNKNOWN = 'syn-spell-unknown';

const assertNegative = (result, id, event) => {
  assert.equal(result.status, 'known-no-handler');
  assert.equal(result.scope, 'known-no-handler');
  assert.equal(result.event, event);
  assert.equal(result.programId, makeDuelOfficialProgramId(id));
  assert.ok(result.reference);
  assert.equal(result.reference.cardId, id);
  assert.equal(result.reference.programId, result.programId);
  assert.equal(result.handlers.length, 0);
  assert.equal(result.modifiers.length, 0);
  assert.equal(result.eventSupported, true);
  assert.equal(result.replacementsCovered, true);
  assert.equal(result.staticCovered, true);
  assert.equal(result.continuousCovered, true);
  assert.equal(result.triggersCovered, true);
  assert.equal(result.sourceCardId, id);
  assert.equal(result.sourceDataVersion, catalog.dataVersion);
  assert.equal(result.sourceCatalogDigest, catalog.digest);
  assert.equal('reason' in result, false);
  assert.equal('requiredContracts' in result, false);
};

// 1
test('phase API exposes the exact twelve Core boundary names', () => {
  assert.deepEqual(DUEL_PHASE_EVENT_NAMES, [
    'awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending',
    'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout',
  ]);
});

// 2
test('legacy event scope remains unknown for a phase-only event', () => {
  const program = registry.getProgram(RUNE);
  assert.equal(queryDuelEventScope(program, 'channel').status, 'unknown');
  assert.equal(queryDuelEventScope(program, 'channel').reason, 'unknown-event');
});

// 3
test('complete Basic Rune gives a source-bound negative proof at Awaken', () => {
  for (const id of runeIds) assertNegative(resolvedScope(id, 'awaken'), id, 'awaken');
});

// 4
test('complete resolved printing gives a source-bound Beginning negative proof', () => {
  assertNegative(resolvedScope(ENTER_READY, 'begin'), ENTER_READY, 'begin');
  assertNegative(resolvedScope(ALTAR, 'begin'), ALTAR, 'begin');
});

// 5
test('the real hold Battlefield handler is not classified as no-effect', () => {
  const result = resolvedScope(ALTAR, 'hold');
  assert.equal(result.status, 'handlers-or-modifiers');
  assert.equal(result.scope, 'handlers-or-modifiers');
  assert.equal(result.eventSupported, true);
  assert.deepEqual(result.handlers, ['trigger.hold']);
  assert.deepEqual(result.modifiers, []);
  assert.equal(result.programId, makeDuelOfficialProgramId(ALTAR));
  assert.deepEqual(result.reference, registry.reference(ALTAR));
  assert.equal(result.triggersCovered, true);
  assert.equal(result.staticCovered, true);
  assert.equal(result.continuousCovered, true);
  assert.equal(result.replacementsCovered, true);
});

// 6
test('complete static printing proves no hold handler without hiding the reference', () => {
  assertNegative(resolvedScope(ENTER_READY, 'hold'), ENTER_READY, 'hold');
});

// 7
test('Rune phase negative proof does not erase its Reaction activation handlers', () => {
  assert.deepEqual(registry.eventScope(RUNE, 'activate'), {
    status: 'handlers-or-modifiers',
    event: 'activate',
    programId: makeDuelOfficialProgramId(RUNE),
    handlers: ['basic-rune.basic-rune-energy', 'basic-rune.basic-rune-power'],
    modifiers: [],
  });
  assertNegative(resolvedScope(RUNE, 'hold'), RUNE, 'hold');
});

// 8
test('unknown whole program stays unknown at a recognized phase', () => {
  const result = resolvedScope(UNKNOWN, 'begin');
  assert.equal(result.status, 'unknown');
  assert.equal(result.scope, 'unknown');
  assert.equal(result.reason, 'unresolved-program');
  assert.equal(result.programId, null);
  assert.equal(result.reference, null);
  assert.equal(result.eventSupported, false);
  assert.equal(result.sourceCardId, null);
});

// 9
test('missing program input is unresolved rather than known-no-handler', () => {
  const result = queryDuelPhaseEventScope(undefined, 'hold');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'unresolved-program');
  assert.deepEqual(result.handlers, []);
  assert.deepEqual(result.modifiers, []);
  assert.equal(result.reference, null);
});

// 10
test('channel, draw, main, ending, cleanup, lethal-kill and burnout stay unknown', () => {
  const expectedRequirements = {
    channel: ['hidden-zone-event-subjects', 'continuous-effect-registry'],
    draw: ['hidden-zone-event-subjects', 'continuous-effect-registry'],
    main: ['hidden-zone-event-subjects', 'continuous-effect-registry'],
    ending: ['continuous-effect-registry', 'cleanup-queue-and-replacements'],
    expiration: ['continuous-effect-registry', 'cleanup-queue-and-replacements'],
    fepr: ['continuous-effect-registry', 'cleanup-queue-and-replacements'],
    'required-cleanup': ['continuous-effect-registry', 'cleanup-queue-and-replacements'],
    'lethal-kill': ['pre-exit-event-journal', 'kill-trigger-effect-cases'],
    burnout: ['hidden-zone-event-subjects', 'continuous-effect-registry'],
  };
  for (const [event, contracts] of Object.entries(expectedRequirements)) {
    const result = resolvedScope(RUNE, event);
    assert.equal(result.status, 'unknown', event);
    assert.equal(result.reason, 'unsupported-phase-event', event);
    assert.deepEqual(result.requiredContracts, contracts, event);
    assert.equal(result.eventSupported, false, event);
    assert.equal(result.programId, null, event);
  }
});

// 11
test('bogus phase event returns unknown-event, never a negative proof', () => {
  const result = resolvedScope(RUNE, 'not-a-phase');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'unknown-event');
  assert.equal(result.event, 'not-a-phase');
  assert.equal(result.requiredContracts, undefined);
  assert.equal(result.programId, null);
});

// 12
test('wrong program reference is rejected by phase scope', () => {
  const reference = registry.reference(RUNE);
  assert.throws(
    () => queryDuelPhaseEventScope(registry.getProgram(ENTER_READY), 'hold', reference),
    TypeError,
  );
  assert.throws(
    () => queryDuelPhaseEventScope(registry.getProgram(RUNE), 'hold', {
      ...reference,
      programId: 'riftbound-duel-official-v1:ogn-007-007',
    }),
    TypeError,
  );
});

// 13
test('phase registry preserves the fixture printing and resolved/unknown census', () => {
  assert.equal(registry.size, CENSUS.size);
  assert.equal(registry.knownProgramCount, CENSUS.known);
  assert.equal(runeIds.length, 30);
  assert.equal(catalog.cards.filter((entry) => registry.get(entry.id)?.status === 'unknown').length, CENSUS.unknown);
});

// 14
test('forged source tuple produces unknown binding and unknown phase scope', () => {
  const genuine = card(RUNE);
  const forgedSource = {
    ...source,
    cards: [{ ...genuine, cardType: 'Gear', domains: ['Order'] }],
  };
  const forgedBinding = createDuelOfficialProgramRegistry(forgedSource).get(genuine.id);
  assert.equal(forgedBinding.status, 'unknown');
  assert.equal(queryDuelPhaseEventScope(forgedBinding, 'hold').reason, 'unresolved-program');
});

// 15
test('phase result reference round-trips through the strict reference codec', () => {
  const result = resolvedScope(ALTAR, 'hold');
  const raw = encodeDuelProgramReferenceRaw(result.reference);
  assert.deepEqual(decodeDuelProgramReferenceRaw(raw), result.reference);
  assert.deepEqual(result.reference, createDuelProgramReference(registry.getProgram(ALTAR)));
  assert.equal(result.reference.dataVersion, catalog.dataVersion);
  assert.equal(result.reference.sourceCatalogDigest, catalog.digest);
});

// 16
test('Gold intrinsic remains separate from printing phase scope', () => {
  const goldPrinting = registry.get('syn-unit-poro');
  if (goldPrinting?.status === 'resolved') {
    assert.notEqual(goldPrinting.program.semantics.kind, 'gold-intrinsic');
  }
  assert.equal(typeof registry.reference('syn-unit-poro').programId === 'string', true);
});

test('the documented Basic Rune printing still binds through its exact tuple', () => {
  assert.equal(bind(RUNE).status, 'resolved');
});

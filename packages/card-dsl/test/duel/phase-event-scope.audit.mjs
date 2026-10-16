// OPT-IN audit: strict phase-boundary event scope against the REAL catalog.
// NOT part of the default `*.test.mjs` glob; run with
//   pnpm --filter @riftbound/card-dsl audit:official-catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

const CATALOG_URL = new URL('../../../../packages/card-data/data/deck-catalog.json', import.meta.url);
if (!fs.existsSync(CATALOG_URL)) {
  throw new Error(
    'audit:official-catalog requires the gitignored official catalog at packages/card-data/data/deck-catalog.json; ' +
    'run the card-data sync/build pipeline first.',
  );
}

const catalogBytes = fs.readFileSync(CATALOG_URL);
const catalog = JSON.parse(catalogBytes.toString('utf8'));
const source = duelAbilitySourceFromCatalog(catalog);
const registry = createDuelOfficialProgramRegistry(source);
const card = (id) => {
  const found = catalog.cards.find((entry) => entry.id === id);
  assert.ok(found, `actual catalog printing ${id}`);
  return found;
};
const bind = (id) => bindDuelOfficialProgram(source, card(id));
const runeIds = catalog.cards.filter((entry) => entry.cardType === 'Rune').map((entry) => entry.id);
const resolvedScope = (id, event) => registry.phaseEventScope(id, event);

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

// 1: The phase vocabulary is exactly the Core V2 boundary vocabulary.
test('phase API exposes the exact twelve Core boundary names', () => {
  assert.deepEqual(DUEL_PHASE_EVENT_NAMES, [
    'awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending',
    'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout',
  ]);
});

// 2: Keep the legacy negative control unchanged: phase-only names are not old events.
test('legacy event scope remains unknown for a phase-only event', () => {
  const program = registry.getProgram('ogn-007-298');
  assert.equal(queryDuelEventScope(program, 'channel').status, 'unknown');
  assert.equal(queryDuelEventScope(program, 'channel').reason, 'unknown-event');
});

// 3: A complete Rune proves absence only through the new phase contract.
test('complete Basic Rune gives a source-bound negative proof at Awaken', () => {
  for (const id of runeIds) assertNegative(resolvedScope(id, 'awaken'), id, 'awaken');
});

// 4: Beginning is recognized, but only a complete program may prove absence.
test('complete resolved printing gives a source-bound Beginning negative proof', () => {
  assertNegative(resolvedScope('ogs-016-024', 'begin'), 'ogs-016-024', 'begin');
  assertNegative(resolvedScope('ogn-275-298', 'begin'), 'ogn-275-298', 'begin');
});

// 5: The real hold Battlefield handler is not classified as no-effect.
test('Altar hold handler remains a positive handler scope', () => {
  const result = resolvedScope('ogn-275-298', 'hold');
  assert.equal(result.status, 'handlers-or-modifiers');
  assert.equal(result.scope, 'handlers-or-modifiers');
  assert.equal(result.eventSupported, true);
  assert.deepEqual(result.handlers, ['trigger.hold']);
  assert.deepEqual(result.modifiers, []);
  assert.equal(result.programId, makeDuelOfficialProgramId('ogn-275-298'));
  assert.deepEqual(result.reference, registry.reference('ogn-275-298'));
  assert.equal(result.triggersCovered, true);
  assert.equal(result.staticCovered, true);
  assert.equal(result.continuousCovered, true);
  assert.equal(result.replacementsCovered, true);
});

// 6: An unrelated complete program can be a hold negative proof, unlike a handler.
test('complete static printing proves no hold handler without hiding the reference', () => {
  assertNegative(resolvedScope('ogs-016-024', 'hold'), 'ogs-016-024', 'hold');
});

// 7: Basic Rune Reaction abilities remain activation handlers, not automatic phase effects.
test('Rune phase negative proof does not erase its Reaction activation handlers', () => {
  const id = 'ogn-007-298';
  assert.deepEqual(registry.eventScope(id, 'activate'), {
    status: 'handlers-or-modifiers',
    event: 'activate',
    programId: makeDuelOfficialProgramId(id),
    handlers: ['basic-rune.basic-rune-energy', 'basic-rune.basic-rune-power'],
    modifiers: [],
  });
  assertNegative(resolvedScope(id, 'hold'), id, 'hold');
});

// 8: Unknown whole programs can never be used to prove a phase no-op.
test('unknown whole program stays unknown at a recognized phase', () => {
  const result = resolvedScope('ogn-205-298', 'begin');
  assert.equal(result.status, 'unknown');
  assert.equal(result.scope, 'unknown');
  assert.equal(result.reason, 'unresolved-program');
  assert.equal(result.programId, null);
  assert.equal(result.reference, null);
  assert.equal(result.eventSupported, false);
  assert.equal(result.sourceCardId, null);
});

// 9: Missing/partial compiler output remains unknown, not an empty handler list.
test('missing program input is unresolved rather than known-no-handler', () => {
  const result = queryDuelPhaseEventScope(undefined, 'hold');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'unresolved-program');
  assert.deepEqual(result.handlers, []);
  assert.deepEqual(result.modifiers, []);
  assert.equal(result.reference, null);
});

// 10: Recognized enum values without a complete DSL contract fail closed.
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
    const result = resolvedScope('ogn-007-298', event);
    assert.equal(result.status, 'unknown', event);
    assert.equal(result.reason, 'unsupported-phase-event', event);
    assert.deepEqual(result.requiredContracts, contracts, event);
    assert.equal(result.eventSupported, false, event);
    assert.equal(result.programId, null, event);
  }
});

// 11: Bogus enum values are distinct from recognized-but-unsupported phases.
test('bogus phase event returns unknown-event, never a negative proof', () => {
  const result = resolvedScope('ogn-007-298', 'not-a-phase');
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'unknown-event');
  assert.equal(result.event, 'not-a-phase');
  assert.equal(result.requiredContracts, undefined);
  assert.equal(result.programId, null);
});

// 12: A wrong source reference is rejected rather than converted to a guessed scope.
test('wrong program reference is rejected by phase scope', () => {
  const reference = registry.reference('ogn-007-298');
  assert.throws(
    () => queryDuelPhaseEventScope(registry.getProgram('ogn-049-298'), 'hold', reference),
    TypeError,
  );
  assert.throws(
    () => queryDuelPhaseEventScope(registry.getProgram('ogn-007-298'), 'hold', {
      ...reference,
      programId: 'riftbound-duel-official-v1:ogn-007-007',
    }),
    TypeError,
  );
});

// 13: Premonition adds one whole source; no unsupported fragment becomes known.
test('phase registry preserves the 1408-printing and 65/1343 census', () => {
  assert.equal(registry.size, 1408);
  assert.equal(registry.knownProgramCount, 65);
  assert.equal(runeIds.length, 30);
  assert.equal(catalog.cards.filter((entry) => registry.get(entry.id)?.status === 'unknown').length, 1343);
});

// 14: Forged source tuples cannot become phase proofs.
test('forged source tuple produces unknown binding and unknown phase scope', () => {
  const genuine = card('ogn-007-298');
  const forgedSource = {
    ...source,
    cards: [{ ...genuine, cardType: 'Gear', domains: ['Order'] }],
  };
  const forgedBinding = createDuelOfficialProgramRegistry(forgedSource).get(genuine.id);
  assert.equal(forgedBinding.status, 'unknown');
  assert.equal(queryDuelPhaseEventScope(forgedBinding, 'hold').reason, 'unresolved-program');
});

// 15: Source-bound reference and its canonical codec remain complete.
test('phase result reference round-trips through the strict reference codec', () => {
  const result = resolvedScope('ogn-275-298', 'hold');
  const raw = encodeDuelProgramReferenceRaw(result.reference);
  assert.deepEqual(decodeDuelProgramReferenceRaw(raw), result.reference);
  assert.deepEqual(result.reference, createDuelProgramReference(registry.getProgram('ogn-275-298')));
  assert.equal(result.reference.dataVersion, catalog.dataVersion);
  assert.equal(result.reference.sourceCatalogDigest, catalog.digest);
});

// 16: Intrinsic Gold is not a printing program and therefore has no fake phase scope.
test('Gold intrinsic remains separate from printing phase scope', () => {
  const goldPrinting = registry.get('ogn-187-298');
  if (goldPrinting?.status === 'resolved') {
    assert.notEqual(goldPrinting.program.semantics.kind, 'gold-intrinsic');
  }
  assert.equal(registry.reference('ogn-187-298') === undefined || typeof registry.reference('ogn-187-298').programId === 'string', true);
});

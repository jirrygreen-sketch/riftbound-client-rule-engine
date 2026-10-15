// Default (clean-checkout) suite for the two whole-source Draw templates.
//
// The compiler recognizes exactly two additional whole-ability Draw templates:
//   - Battlefield "When you hold here, draw 1."  -> trigger.hold + draw-cards 1
//   - Spell       "Draw 4."                      -> spell-resolution + draw-cards 4
//
// This file builds its OWN complete synthetic printing tuple inline, so it runs
// in a clean checkout with no gitignored official data and no data-missing skip.
// The regression baseline for the previously verified templates (Basic Rune,
// Ganking, Altar Recruit, Viktor Recruit) reuses only TRACKED fixture literals;
// no generated catalog, no `*.audit.mjs` real-data path, and no modification of
// the shared fixture/census is performed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALTAR_TEXT,
  DATA_VERSION,
  DIGEST,
  GANKING_REMINDER_TEXT,
  RUNE_IDS,
  VIKTOR_TEXT,
  cardById,
} from '../fixtures/official-catalog.mjs';

const moduleSpecifier =
  process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const {
  assertDuelOfficialProgram,
  bindDuelOfficialProgram,
  createDuelOfficialProgramRegistry,
  createDuelProgramReference,
  decodeDuelOfficialProgramRaw,
  decodeDuelProgramReferenceRaw,
  duelAbilitySourceFromCatalog,
  encodeDuelOfficialProgramRaw,
  encodeDuelProgramReferenceRaw,
  makeDuelOfficialProgramId,
  queryDuelEventScope,
  queryDuelSourceProgramPhaseScope,
  resolveDuelProgramReference,
  validateDuelOfficialProgram,
} = await import(moduleSpecifier);

// Exact whole-ability texts under test (the two new whole-source templates).
const HOLD_DRAW_TEXT = 'When you hold here, draw 1.';
const DRAW_4_TEXT = 'Draw 4.';

// Independent synthetic printing constructor. The envelope strings MUST equal the
// compiled Basic Rune identity constants for the rune regression to resolve.
const synCard = (id, cardType, ability, extra = {}) => ({
  id,
  cardType,
  ability,
  energy: extra.energy ?? null,
  power: extra.power ?? null,
  might: extra.might ?? null,
  domains: extra.domains ?? ['Colorless'],
  tags: extra.tags ?? [],
  canonicalCardId: extra.canonicalCardId ?? `card.syn-${id}`,
  name: extra.name ?? `Syn ${id}`,
  fullName: extra.fullName ?? `Syn ${id}`,
  localizedName: extra.localizedName ?? '合成',
  setCode: extra.setCode ?? 'syn',
  cardNumber: extra.cardNumber ?? `SYN-${id}`,
  variant: extra.variant ?? 'standard',
});

const RUNE_ID = RUNE_IDS[0];
const RUNE_CARD = cardById(RUNE_ID);
assert.ok(RUNE_CARD, `tracked fixture printing ${RUNE_ID}`);

const HOLD_DRAW_ID = 'syn-battlefield-hold-draw';
const SPELL_DRAW_ID = 'syn-spell-draw-four';

const RESOLVED_LOCAL = [
  RUNE_ID,
  HOLD_DRAW_ID,
  SPELL_DRAW_ID,
  'syn-battlefield-altar-recruit',
  'syn-legend-viktor-recruit',
  'syn-unit-ganking',
];
const UNKNOWN_LOCAL = [
  'syn-spell-draw4-multiclause',
  'syn-battlefield-hold-draw-multiclause',
  'syn-unit-hold-draw',
  'syn-battlefield-draw4',
  'syn-gear-draw4',
  'syn-spell-draw-three',
  'syn-battlefield-hold-two',
  'syn-battlefield-hold-draw-noperiod',
  'syn-spell-damage',
];

const localCards = [
  { ...RUNE_CARD },
  synCard(HOLD_DRAW_ID, 'Battlefield', HOLD_DRAW_TEXT, { domains: ['Order'], tags: ['Altar'] }),
  synCard(SPELL_DRAW_ID, 'Spell', DRAW_4_TEXT, { domains: ['Fury'], tags: ['Spell'] }),
  synCard('syn-battlefield-altar-recruit', 'Battlefield', ALTAR_TEXT, { domains: ['Order'], tags: ['Altar'] }),
  synCard('syn-legend-viktor-recruit', 'Legend', VIKTOR_TEXT, { domains: ['Order'], tags: ['Viktor'] }),
  synCard('syn-unit-ganking', 'Unit', GANKING_REMINDER_TEXT, { energy: 1, might: 2, domains: ['Chaos'], tags: ['Warrior'] }),
  synCard('syn-spell-draw4-multiclause', 'Spell', 'Draw 4. Draw 1.', { domains: ['Fury'], tags: ['Spell'] }),
  synCard('syn-battlefield-hold-draw-multiclause', 'Battlefield',
    `${HOLD_DRAW_TEXT} You may hide an additional card here.`, { domains: ['Order'], tags: ['Altar'] }),
  synCard('syn-unit-hold-draw', 'Unit', HOLD_DRAW_TEXT, { energy: 2, might: 2, domains: ['Order'], tags: ['Warrior'] }),
  synCard('syn-battlefield-draw4', 'Battlefield', DRAW_4_TEXT, { domains: ['Order'], tags: ['Altar'] }),
  synCard('syn-gear-draw4', 'Gear', DRAW_4_TEXT, { energy: 1, domains: ['Fury'], tags: ['Gear'] }),
  synCard('syn-spell-draw-three', 'Spell', 'Draw 3.', { domains: ['Fury'], tags: ['Spell'] }),
  synCard('syn-battlefield-hold-two', 'Battlefield', 'When you hold here, draw 2.', { domains: ['Order'], tags: ['Altar'] }),
  synCard('syn-battlefield-hold-draw-noperiod', 'Battlefield', 'When you hold here, draw 1', { domains: ['Order'], tags: ['Altar'] }),
  synCard('syn-spell-damage', 'Spell', 'Deal 1 damage to a unit.', { domains: ['Fury'], tags: ['Spell'] }),
];

const CATALOG = {
  schemaVersion: 1,
  dataVersion: DATA_VERSION,
  digest: DIGEST,
  cards: localCards,
  groups: [],
};

const source = duelAbilitySourceFromCatalog(CATALOG);
const registry = createDuelOfficialProgramRegistry(source);
const card = (id) => {
  const found = localCards.find((entry) => entry.id === id);
  assert.ok(found, `local printing ${id}`);
  return found;
};
const bind = (id) => bindDuelOfficialProgram(source, card(id));
const queryPhase = (id, eventOrContext) => registry.sourceProgramPhaseScope(id, eventOrContext);
const clone = (value) => structuredClone(value);

const GLOBAL_CLOSURE = [
  'all-source-candidate-closure', 'hidden-zone-event-subjects',
  'continuous-effect-registry', 'cleanup-queue-and-replacements',
  'runtime-subevent-journal', 'recursive-conquer-event-journal',
];

// ---------------------------------------------------------------------------
// Positive whole-source binding for the two new Draw templates.
// ---------------------------------------------------------------------------

test('Battlefield "When you hold here, draw 1." binds trigger.hold + a single draw 1 effect', () => {
  const binding = bind(HOLD_DRAW_ID);
  assert.equal(binding.status, 'resolved');
  assert.equal(binding.normalizedAbilityText, HOLD_DRAW_TEXT);
  const program = binding.program;
  assert.equal(program.programId, makeDuelOfficialProgramId(HOLD_DRAW_ID));
  assert.equal(program.cardId, HOLD_DRAW_ID);
  assert.equal(program.source.cardType, 'Battlefield');
  assert.equal(program.source.normalizedAbilityText, HOLD_DRAW_TEXT);
  assert.deepEqual(program.semantics, {
    kind: 'trigger',
    event: 'hold',
    sourceScope: 'battlefield-controller',
    condition: null,
    optional: false,
    costs: [],
    effects: [{ kind: 'draw-cards', amount: 1, recipient: 'effect-controller' }],
  });
  assert.equal(program.source.sourceCatalogDigest, DIGEST);
  assert.equal(program.source.dataVersion, DATA_VERSION);
  assert.equal(Object.isFrozen(program.semantics.effects), true);
  assert.throws(() => { program.semantics.effects[0].amount = 2; }, TypeError);
});

test('Spell "Draw 4." binds spell-resolution + a single draw 4 effect and round-trips', () => {
  const binding = bind(SPELL_DRAW_ID);
  assert.equal(binding.status, 'resolved');
  assert.equal(binding.normalizedAbilityText, DRAW_4_TEXT);
  const program = binding.program;
  assert.equal(program.programId, makeDuelOfficialProgramId(SPELL_DRAW_ID));
  assert.equal(program.source.cardType, 'Spell');
  assert.deepEqual(program.semantics, {
    kind: 'spell-resolution',
    effects: [{ kind: 'draw-cards', amount: 4, recipient: 'effect-controller' }],
  });
  assert.deepEqual(validateDuelOfficialProgram(program), { ok: true, value: program, issues: [] });
  assert.deepEqual(decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(program)), program);
  const reference = createDuelProgramReference(program);
  assert.deepEqual(registry.reference(SPELL_DRAW_ID), reference);
  assert.deepEqual(decodeDuelProgramReferenceRaw(encodeDuelProgramReferenceRaw(reference)), reference);
  assert.deepEqual(resolveDuelProgramReference(registry, reference), program);
});

// ---------------------------------------------------------------------------
// Multi-clause / different type / unknown must stay unknown.
// ---------------------------------------------------------------------------

test('multi-clause, wrong-type and near-miss Draw texts all remain unknown', () => {
  for (const id of UNKNOWN_LOCAL) {
    const binding = bind(id);
    assert.equal(binding.status, 'unknown', id);
    assert.equal(binding.program, null, id);
    assert.equal(binding.unresolvedReason, 'unsupported-whole-ability', id);
  }
  // A Spell text on a non-Spell type and a multi-clause Spell are both unbound.
  assert.equal(bind('syn-battlefield-draw4').program, null);
  assert.equal(bind('syn-gear-draw4').program, null);
  assert.equal(bind('syn-unit-hold-draw').program, null);
  assert.equal(bind('syn-spell-draw4-multiclause').program, null);
  assert.equal(bind('syn-battlefield-hold-draw-multiclause').program, null);
  // Registry side: unknown printings expose no program/reference.
  assert.equal(registry.getProgram(SPELL_DRAW_ID).semantics.kind, 'spell-resolution');
  assert.equal(registry.getProgram('syn-spell-draw4-multiclause'), undefined);
  assert.equal(registry.reference('syn-spell-draw4-multiclause'), undefined);
  assert.equal(registry.getProgram('syn-unit-hold-draw'), undefined);
});

// ---------------------------------------------------------------------------
// Candidate source drift is rejected, but a genuine value clone still binds.
// ---------------------------------------------------------------------------

test('a drifted candidate Draw source tuple is rejected; a genuine value clone binds', () => {
  const real = card(HOLD_DRAW_ID);
  assert.equal(bindDuelOfficialProgram(source, clone(real)).status, 'resolved');
  for (const [field, value] of [
    ['ability', `${HOLD_DRAW_TEXT} Extra.`],
    ['cardType', 'Unit'],
    ['energy', 1],
    ['might', 2],
    ['domains', ['Fury']],
    ['tags', ['Spell']],
    ['canonicalCardId', 'forged-canonical'],
    ['name', 'forged-name'],
    ['fullName', 'forged-full-name'],
    ['localizedName', '伪造'],
    ['setCode', 'zzz'],
    ['cardNumber', 'ZZZ-000/000'],
    ['variant', 'forged'],
  ]) {
    assert.throws(() => bindDuelOfficialProgram(source, { ...real, [field]: value }), TypeError, field);
  }
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, dataVersion: 'forged-version' }), /dataVersion/);
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, sourceCatalogDigest: 'sha256:forged' }), /digest/);
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, id: 'invented-draw-printing' }), /not present/);

  const spellReal = card(SPELL_DRAW_ID);
  assert.equal(bindDuelOfficialProgram(source, clone(spellReal)).status, 'resolved');
  assert.throws(() => bindDuelOfficialProgram(source, { ...spellReal, cardType: 'Battlefield' }), TypeError);
  assert.throws(() => bindDuelOfficialProgram(source, { ...spellReal, ability: 'Draw 5.' }), TypeError);
});

// ---------------------------------------------------------------------------
// Codec / validator reject forged amount, recipient, accessor, sparse, extra
// and tampered-source Draw programs.
// ---------------------------------------------------------------------------

test('Draw codec rejects forged amount, recipient, extra, sparse and tampered source', () => {
  const spell = registry.getProgram(SPELL_DRAW_ID);
  const hold = registry.getProgram(HOLD_DRAW_ID);

  // Amount drift.
  assert.equal(validateDuelOfficialProgram((() => { const c = clone(spell); c.semantics.effects[0].amount = 3; return c; })()).ok, false);
  assert.throws(() => decodeDuelOfficialProgramRaw(JSON.stringify((() => { const c = clone(spell); c.semantics.effects[0].amount = 3; return c; })())), /Spell/);
  assert.throws(() => decodeDuelOfficialProgramRaw(JSON.stringify((() => { const c = clone(hold); c.semantics.effects[0].amount = 2; return c; })())), /hold trigger/);

  // Recipient drift.
  assert.equal(validateDuelOfficialProgram((() => { const c = clone(spell); c.semantics.effects[0].recipient = 'ability-controller'; return c; })()).ok, false);
  assert.throws(() => decodeDuelOfficialProgramRaw(JSON.stringify((() => { const c = clone(spell); c.semantics.effects[0].recipient = 'ability-controller'; return c; })())), /Draw semantics/);

  // Extra fields at effect / semantics / source levels.
  for (const mutate of [
    (c) => { c.semantics.effects[0].extra = true; },
    (c) => { c.semantics.extra = true; },
    (c) => { c.source.extra = true; },
  ]) {
    assert.equal(validateDuelOfficialProgram(mutate(clone(spell))).ok, false);
  }
  assert.throws(() => decodeDuelOfficialProgramRaw(JSON.stringify((() => { const c = clone(spell); c.semantics.effects[0].extra = true; return c; })())), /unknown or missing fields/);

  // Sparse effects array (JSON null, and an object hole).
  assert.equal(validateDuelOfficialProgram((() => { const c = clone(spell); c.semantics.effects = new Array(1); return c; })()).ok, false);
  assert.throws(() => decodeDuelOfficialProgramRaw(JSON.stringify((() => { const c = clone(spell); c.semantics.effects = [undefined]; return c; })())), /must be an object/);

  // Tampered source text / type must fail closed even if semantics look right.
  assert.throws(() => decodeDuelOfficialProgramRaw(JSON.stringify((() => { const c = clone(spell); c.source.normalizedAbilityText = 'Draw 5.'; return c; })())), /complete(?: Spell)? source (?:text|instruction)/);
  assert.equal(validateDuelOfficialProgram((() => { const c = clone(spell); c.source.cardType = 'Gear'; return c; })()).ok, false);

  // Structural drift in the bound semantics is rejected without widening v1.
  assert.equal(validateDuelOfficialProgram((() => { const c = clone(hold); c.semantics.costs = [{ kind: 'exhaust-source' }]; return c; })()).ok, false);
  assert.equal(validateDuelOfficialProgram((() => { const c = clone(hold); c.semantics.sourceScope = 'ability-source'; return c; })()).ok, false);
  assert.equal(validateDuelOfficialProgram((() => {
    const c = clone(spell);
    c.semantics.effects[0] = { kind: 'ready-unit', target: { kind: 'unit', controller: 'any', scope: 'legal-unit' } };
    return c;
  })()).ok, false);
});

test('Draw codec rejects accessor-backed effect nodes and non-canonical raw', () => {
  const spell = registry.getProgram(SPELL_DRAW_ID);
  const hold = registry.getProgram(HOLD_DRAW_ID);

  // An accessor on the effects array index is not an own data property.
  for (const program of [spell, hold]) {
    const withArrayAccessor = clone(program);
    const element = withArrayAccessor.semantics.effects[0];
    Object.defineProperty(withArrayAccessor.semantics.effects, 0, {
      configurable: true, enumerable: true, get: () => element,
    });
    assert.throws(() => encodeDuelOfficialProgramRaw(withArrayAccessor), /own data property/);
    assert.throws(() => assertDuelOfficialProgram(withArrayAccessor), /own data property/);
  }

  // An accessor with a wrong value is not accepted, even when the key exists.
  const wrongGetter = clone(spell);
  Object.defineProperty(wrongGetter.semantics.effects[0], 'amount', {
    configurable: true, enumerable: true, get: () => 5,
  });
  assert.equal(validateDuelOfficialProgram(wrongGetter).ok, false);

  // Non-canonical raw JSON is rejected on decode.
  const raw = encodeDuelOfficialProgramRaw(spell);
  assert.throws(() => decodeDuelOfficialProgramRaw(raw.replace('{"', '{ "')), /canonical/);
  assert.throws(() => decodeDuelOfficialProgramRaw(raw.replace('"amount":4', '"amount":4.0')), /canonical|invalid|unsupported/);
});

// ---------------------------------------------------------------------------
// Phase / event scope: neither template promotes a phase into an automatic
// action, and global closure stays unverified.
// ---------------------------------------------------------------------------

test('hold-draw exposes only trigger.hold and never an automatic phase handler', () => {
  assert.deepEqual(queryDuelEventScope(registry.get(HOLD_DRAW_ID), 'hold'), {
    status: 'handlers-or-modifiers',
    event: 'hold',
    programId: makeDuelOfficialProgramId(HOLD_DRAW_ID),
    handlers: ['trigger.hold'],
    modifiers: [],
  });
  const atHold = queryPhase(HOLD_DRAW_ID, 'hold');
  assert.equal(atHold.scope, 'source-program');
  assert.equal(atHold.mode, 'atomic-boundary');
  assert.deepEqual(atHold.handlers, ['trigger.hold']);
  assert.deepEqual(atHold.runtimeSubevents, []);
  assert.equal(atHold.globalClosureStatus, 'unverified');
  for (const contract of GLOBAL_CLOSURE) assert.ok(atHold.requiredGlobalRuntimeClosure.includes(contract));

  // At every other phase it is a local no-handler, never a Core global proof.
  for (const phase of ['awaken', 'begin', 'channel', 'draw', 'main', 'ending', 'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout']) {
    const result = queryPhase(HOLD_DRAW_ID, phase);
    assert.deepEqual(result.handlers, [], phase);
    assert.equal(result.directBoundaryStatus, 'known-no-handler', phase);
    assert.equal(result.globalClosureStatus, 'unverified', phase);
    assert.equal('status' in result, false, phase);
  }
});

test('Spell "Draw 4." resolution is a subevent, never an automatic Main action', () => {
  assert.deepEqual(queryDuelEventScope(registry.get(SPELL_DRAW_ID), 'spell-resolution'), {
    status: 'handlers-or-modifiers',
    event: 'spell-resolution',
    programId: makeDuelOfficialProgramId(SPELL_DRAW_ID),
    handlers: ['spell-resolution.draw-cards'],
    modifiers: [],
  });

  const atMain = queryPhase(SPELL_DRAW_ID, 'main');
  assert.equal(atMain.scope, 'source-program');
  assert.equal(atMain.directBoundaryStatus, 'known-no-handler');
  assert.equal(atMain.sourceApplicabilityStatus, 'known-no-handler');
  assert.deepEqual(atMain.handlers, []);
  assert.deepEqual(atMain.modifiers, []);
  assert.equal(atMain.globalClosureStatus, 'unverified');
  assert.deepEqual(atMain.runtimeSubevents, [
    { event: 'spell-resolution', handlers: ['spell-resolution.draw-cards'], modifiers: [] },
  ]);

  const runtimeMain = queryPhase(SPELL_DRAW_ID, { phase: 'main', mode: 'runtime-subevents' });
  assert.equal(runtimeMain.directBoundaryStatus, 'known-no-handler');
  assert.deepEqual(runtimeMain.handlers, []);
  assert.equal(runtimeMain.sourceApplicabilityStatus, 'handlers-or-modifiers');
  assert.equal(runtimeMain.globalClosureStatus, 'unverified');

  // The generic resolver cannot turn the Spell into a Main handler either.
  assert.equal(queryDuelEventScope(registry.get(SPELL_DRAW_ID), 'main').status, 'unknown');
  for (const phase of ['awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending', 'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout']) {
    const result = queryPhase(SPELL_DRAW_ID, phase);
    for (const handler of result.handlers) {
      assert.notEqual(handler, 'automaticMain', phase);
      assert.notEqual(handler, 'main.handler', phase);
    }
    assert.equal(result.globalClosureStatus, 'unverified', phase);
  }
});

// ---------------------------------------------------------------------------
// Previously verified templates must stay intact.
// ---------------------------------------------------------------------------

test('Basic Rune, Ganking, Altar Recruit and Viktor Recruit templates are preserved', () => {
  // Basic Rune rule grant.
  const rune = registry.getProgram(RUNE_ID);
  assert.equal(rune.semantics.kind, 'basic-rune');
  assert.equal(rune.semantics.sourceRule, 'CR-v1.4:164.2');
  const runeAtMain = queryPhase(RUNE_ID, 'main');
  assert.equal(runeAtMain.sourceApplicabilityStatus, 'known-no-handler');
  assert.equal(runeAtMain.globalClosureStatus, 'unverified');

  // Ganking passive still resolves to a Standard Move permission.
  const ganking = registry.getProgram('syn-unit-ganking');
  assert.equal(ganking.semantics.kind, 'static');
  assert.deepEqual(ganking.semantics.abilities, [
    { kind: 'ganking', subject: 'self', scope: 'standard-move', mode: 'permission' },
  ]);
  assert.deepEqual(queryDuelEventScope(registry.get('syn-unit-ganking'), 'standard-move'), {
    status: 'handlers-or-modifiers',
    event: 'standard-move',
    programId: makeDuelOfficialProgramId('syn-unit-ganking'),
    handlers: ['static.ganking'],
    modifiers: [],
  });

  // Altar hold trigger still plays a deferred Recruit token.
  const altar = registry.getProgram('syn-battlefield-altar-recruit');
  assert.equal(altar.semantics.kind, 'trigger');
  assert.equal(altar.semantics.event, 'hold');
  assert.equal(altar.semantics.effects[0].kind, 'play-recruit-token');
  assert.equal(altar.semantics.effects[0].resolution, 'deferred-token-play');
  assert.equal(altar.semantics.effects[0].token.might, 1);
  assert.equal('createUnit' in altar.semantics.effects[0], false);

  // Viktor activation still keeps both costs and the Recruit play.
  const viktor = registry.getProgram('syn-legend-viktor-recruit');
  assert.equal(viktor.semantics.kind, 'activated');
  assert.deepEqual(viktor.semantics.costs, [
    { kind: 'energy', amount: 1, payer: 'ability-controller' },
    { kind: 'exhaust-source' },
  ]);
  assert.equal(viktor.semantics.effects[0].kind, 'play-recruit-token');
});

test('the local synthetic registry census is exactly the resolved/unknown split', () => {
  assert.equal(registry.size, localCards.length);
  assert.equal(registry.knownProgramCount, RESOLVED_LOCAL.length);
  assert.deepEqual(
    registry.cardIds().filter((id) => registry.get(id).status === 'resolved').sort(),
    [...RESOLVED_LOCAL].sort(),
  );
  assert.deepEqual(
    registry.cardIds().filter((id) => registry.get(id).status === 'unknown').sort(),
    [...UNKNOWN_LOCAL].sort(),
  );
});

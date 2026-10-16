// OPT-IN audit: whole-ability official program compiler against the REAL catalog.
//
// This file is deliberately NOT part of the default `*.test.mjs` glob: it reads
// the gitignored official catalog at packages/card-data/data/deck-catalog.json and
// therefore cannot run in a clean checkout. Run it explicitly with
//   pnpm --filter @riftbound/card-dsl audit:official-catalog
// after the card-data sync/build pipeline has produced the catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const CATALOG_URL = new URL('../../../../packages/card-data/data/deck-catalog.json', import.meta.url);
if (!fs.existsSync(CATALOG_URL)) {
  throw new Error(
    'audit:official-catalog requires the gitignored official catalog at packages/card-data/data/deck-catalog.json; ' +
    'run the card-data sync/build pipeline first.',
  );
}

// The package test script normally tests ../dist after TypeScript compilation.
// The coordination artifact also runs this same TAP file against its isolated
// compiler output by setting DUEL_OFFICIAL_PROGRAMS_MODULE.
const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const {
  DUEL_OFFICIAL_IR_KIND,
  DUEL_OFFICIAL_IR_SCHEMA_VERSION,
  DUEL_OFFICIAL_RULESET,
  DUEL_OFFICIAL_REFERENCE_KIND,
  DUEL_PREMONITION_REACTION_TEXT,
  DUEL_GOLD_INTRINSIC_ABILITY_KIND,
  DUEL_GOLD_INTRINSIC_ID,
  DUEL_GOLD_INTRINSIC_REFERENCE_KIND,
  assertDuelGoldIntrinsicAbilityReference,
  bindDuelOfficialProgram,
  bindDuelOfficialProgramByCardId,
  createDuelOfficialProgramRegistry,
  createDuelProgramReference,
  createDuelGoldIntrinsicAbilityReference,
  decodeDuelGoldIntrinsicAbilityReferenceRaw,
  decodeDuelOfficialProgramRaw,
  decodeDuelProgramReferenceRaw,
  duelAbilitySourceFromCatalog,
  encodeDuelGoldIntrinsicAbilityReferenceRaw,
  encodeDuelOfficialProgramRaw,
  encodeDuelProgramReferenceRaw,
  getDuelGoldIntrinsicTokenAbilitySpec,
  makeDuelOfficialProgramId,
  queryDuelEventScope,
  resolveDuelGoldIntrinsicAbilityReference,
  resolveDuelProgramReference,
  validateDuelOfficialProgram,
} = await import(moduleSpecifier);

const rawBytes = fs.readFileSync(CATALOG_URL);
const catalog = JSON.parse(rawBytes.toString('utf8'));
const source = duelAbilitySourceFromCatalog(catalog);
const card = (id) => {
  const found = catalog.cards.find((entry) => entry.id === id);
  assert.ok(found, `catalog is missing ${id}`);
  return found;
};
const bind = (id) => bindDuelOfficialProgram(source, card(id));

const VI_IDS = ['unl-187-219', 'unl-229-219', 'unl-229-star-219'];
const VIKTOR_IDS = ['ogn-265-298', 'ogn-308-298', 'ogn-308-star-298'];
const STATIC_IDS = ['ogs-009-024', 'ogs-016-024', 'sfd-006-221'];
const NUMERIC_EMPTY_UNIT_IDS = ['ogn-049-298', 'ogn-088-298', 'ogn-142-298', 'ogn-175-298', 'ogn-219-298'];
const RECRUIT_IDS = ['ogn-271-298', 'ogn-272-298', 'ogn-273-298', 'ven-t04'];
const PORO_IDS = ['sfd-069-221', 'unl-222-219'];
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());

// 1
test('binds the real catalog envelope and preserves the official source metadata', () => {
  assert.equal(catalog.cards.length, 1381);
  assert.equal(catalog.dataVersion, '2026-10-12-official-gallery');
  assert.equal(catalog.digest, 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10');
  assert.equal(source.dataVersion, catalog.dataVersion);
  assert.equal(source.sourceCatalogDigest, catalog.digest);
  assert.equal(source.cards.length, catalog.cards.length);
  assert.equal(crypto.createHash('sha256').update(rawBytes).digest('hex').length, 64);
});

// 2
test('registry covers every printing but only complete official templates resolve', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  assert.equal(registry.size, 1381);
  assert.deepEqual(registry.cardIds(), catalog.cards.map((entry) => entry.id));
  assert.equal(registry.knownProgramCount, 65);
  for (const entry of catalog.cards) {
    assert.equal(registry.has(entry.id), true);
    const binding = registry.get(entry.id);
    assert.ok(binding);
    assert.equal(binding.cardId, entry.id);
    assert.ok(binding.status === 'resolved' || binding.status === 'unknown');
  }
});

test('real Premonition preserves its whole Reaction permission, Draw 3 and printing cost', () => {
  const matches = catalog.cards.filter(entry => entry.cardType === 'Spell' && entry.ability === DUEL_PREMONITION_REACTION_TEXT);
  assert.deepEqual(matches.map(entry => entry.id), ['sfd-087-221']);
  const printing = matches[0], program = bind(printing.id).program;
  assert.equal(printing.energy, 2);
  assert.equal(printing.power, 3);
  assert.deepEqual(printing.domains, ['Mind']);
  assert.deepEqual(program.semantics, { kind: 'spell-resolution', permission: 'reaction',
    effects: [{ kind: 'draw-cards', amount: 3, recipient: 'effect-controller' }] });
  assert.deepEqual(decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(program)), program);
});

// 3
test('all Vi printing variants bind the same full conquer program', () => {
  for (const id of VI_IDS) {
    const binding = bind(id);
    assert.equal(binding.status, 'resolved');
    assert.equal(binding.program.cardId, id);
    assert.equal(binding.program.programId, makeDuelOfficialProgramId(id));
    assert.equal(binding.program.source.normalizedAbilityText, card(id).ability);
    assert.deepEqual(binding.program.source.domains, ['Fury', 'Order']);
    assert.deepEqual(binding.program.source.tags, ['Vi']);
    assert.equal(binding.program.semantics.kind, 'trigger');
    assert.equal(binding.program.semantics.event, 'conquer');
  }
});

// 4
test('Vi retains the condition, optional exhaust cost, and unrestricted Unit target', () => {
  const program = bind('unl-187-219').program;
  assert.equal(program.semantics.condition.amount, 3);
  assert.equal(program.semantics.optional, true);
  assert.deepEqual(program.semantics.costs, [{ kind: 'exhaust-source' }]);
  assert.deepEqual(program.semantics.effects, [{
    kind: 'ready-unit',
    target: { kind: 'unit', controller: 'any', scope: 'legal-unit' },
  }]);
  assert.equal(program.semantics.effects[0].target.controller, 'any');
});

// 5
test('Altar binds hold scope and effect-controller base Recruit ownership', () => {
  const program = bind('ogn-275-298').program;
  assert.equal(program.semantics.kind, 'trigger');
  assert.equal(program.semantics.event, 'hold');
  assert.equal(program.semantics.sourceScope, 'battlefield-controller');
  assert.deepEqual(program.semantics.effects, [{
    kind: 'play-recruit-token',
    token: {
      kind: 'unit-token', cardType: 'Unit', domains: [], domainless: true,
      tags: ['Recruit'], energy: null, power: null, might: 1,
      physicalPrintingCardId: null,
    },
    controller: 'effect-controller',
    owner: 'effect-controller',
    destination: 'base',
    resolution: 'deferred-token-play',
  }]);
});

// 6
test('Bandle Tree is a Hide modifier, not a no-effect program', () => {
  const program = bind('ogn-278-298').program;
  assert.deepEqual(program.semantics, {
    kind: 'passive',
    event: 'hide',
    sourceScope: 'source-battlefield',
    modifier: {
      kind: 'additional-hide-permission', amount: 1, optional: true, scope: 'source-battlefield',
    },
  });
  const registry = createDuelOfficialProgramRegistry(source);
  assert.deepEqual(registry.eventScope('ogn-278-298', 'hide'), {
    status: 'handlers-or-modifiers',
    event: 'hide',
    programId: makeDuelOfficialProgramId('ogn-278-298'),
    handlers: [],
    modifiers: ['passive.additional-hide-permission'],
  });
});

// 7
test('Viktor variants preserve both Energy 1 and source-exhaust costs', () => {
  for (const id of VIKTOR_IDS) {
    const semantics = bind(id).program.semantics;
    assert.equal(semantics.kind, 'activated');
    assert.deepEqual(semantics.costs, [
      { kind: 'energy', amount: 1, payer: 'ability-controller' },
      { kind: 'exhaust-source' },
    ]);
    assert.equal(semantics.effects[0].kind, 'play-recruit-token');
    assert.equal(semantics.effects[0].destination, 'executor-defined');
    assert.equal(semantics.effects[0].resolution, 'deferred-token-play');
  }
});

// 8
test('complete static templates bind enter replacement separately from Ganking', () => {
  const yi = bind('ogs-009-024').program;
  assert.deepEqual(yi.semantics, {
    kind: 'static',
    abilities: [
      { kind: 'ganking', subject: 'self', scope: 'standard-move', mode: 'permission' },
      { kind: 'enter-ready', subject: 'self', scope: 'unit-enter', mode: 'replacement' },
    ],
  });
  for (const id of ['ogs-016-024', 'sfd-006-221']) {
    assert.deepEqual(bind(id).program.semantics, {
      kind: 'static',
      abilities: [{ kind: 'enter-ready', subject: 'self', scope: 'unit-enter', mode: 'replacement' }],
    });
  }
});

// 9
test('partial or unrelated official text stays unknown and is not partial proof', () => {
  const partial = bind('ogn-205-298');
  assert.equal(partial.status, 'unknown');
  assert.equal(partial.program, null);
  assert.equal(partial.unresolvedReason, 'unsupported-whole-ability');
  assert.equal(bind('ogn-001-298').status, 'unknown');
  const registry = createDuelOfficialProgramRegistry(source);
  assert.deepEqual(registry.eventScope('ogn-205-298', 'conquer'), {
    status: 'unknown', event: 'conquer', programId: null, handlers: [], modifiers: [], reason: 'unresolved-program',
  });
});

// 10
test('event scope distinguishes known no-handler Begin/Awaken from unknown events', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  assert.deepEqual(registry.eventScope('ogs-016-024', 'begin'), {
    status: 'known-no-handler', event: 'begin', programId: makeDuelOfficialProgramId('ogs-016-024'), handlers: [], modifiers: [],
  });
  assert.deepEqual(registry.eventScope('ogs-016-024', 'awaken'), {
    status: 'known-no-handler', event: 'awaken', programId: makeDuelOfficialProgramId('ogs-016-024'), handlers: [], modifiers: [],
  });
  assert.equal(registry.eventScope('ogs-016-024', 'made-up-event').status, 'unknown');
  assert.equal(registry.eventScope('ogs-016-024', 'made-up-event').reason, 'unknown-event');
});

// 11
test('numeric-energy empty Units are playable printings while null-energy Recruits are token-only', () => {
  for (const id of NUMERIC_EMPTY_UNIT_IDS) {
    const program = bind(id).program;
    assert.equal(program.semantics.kind, 'no-ability');
    assert.equal(program.semantics.playability.kind, 'printed-unit');
    assert.equal(program.semantics.playability.fromHand, true);
    assert.equal(program.semantics.playability.tokenOnly, false);
    assert.equal(program.semantics.playability.energyCost, card(id).energy);
  }
  for (const id of RECRUIT_IDS) {
    const program = bind(id).program;
    assert.equal(program.semantics.kind, 'no-ability');
    assert.deepEqual(program.semantics.playability, {
      kind: 'recruit-token', fromHand: false, energyCost: null, tokenOnly: true,
    });
  }
  assert.equal(catalog.cards.filter((entry) => entry.cardType === 'Unit' && entry.ability === '').length, 9);
});

// 12
test('empty non-Unit printings: genuine Basic Runes bind rule semantics, other non-Units stay unknown', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  const emptyNonUnits = catalog.cards.filter((entry) => entry.ability === '' && entry.cardType !== 'Unit');
  assert.ok(emptyNonUnits.length > 0);
  for (const entry of emptyNonUnits) {
    const binding = registry.get(entry.id);
    if (entry.cardType === 'Rune') {
      // CR 164.2 grants both abilities to every Basic Rune, so a verified Rune
      // printing resolves to rule-granted semantics instead of empty text — but
      // never as a free playable printed Unit.
      assert.equal(binding.status, 'resolved', entry.id);
      assert.equal(binding.program.semantics.kind, 'basic-rune', entry.id);
      assert.equal(binding.program.semantics.sourceRule, 'CR-v1.4:164.2', entry.id);
      assert.equal('playability' in binding.program.semantics, false, entry.id);
      assert.equal(entry.energy, null, entry.id);
      assert.equal(entry.power, null, entry.id);
      assert.equal(entry.might, null, entry.id);
    } else {
      // Empty text on any other card type still proves nothing.
      assert.equal(binding.status, 'unknown', entry.id);
    }
  }
  assert.equal(registry.get('ogn-049-298').status, 'resolved');
});

// 13
test('whole source tuple for forged cards is rejected, while a genuine value clone binds', () => {
  const real = card('ogn-049-298');
  const clone = structuredClone(real);
  assert.equal(bindDuelOfficialProgram(source, clone).status, 'resolved');
  for (const [field, value] of [
    ['cardType', 'Spell'],
    ['ability', 'I enter ready.'],
    ['energy', real.energy + 1],
    ['power', 1],
    ['might', real.might + 1],
    ['canonicalCardId', 'forged-canonical'],
    ['name', 'forged-name'],
    ['fullName', 'forged-full-name'],
    ['localizedName', '伪造'],
    ['setCode', 'zzz'],
    ['cardNumber', 'ZZZ-000/000'],
    ['variant', 'forged'],
  ]) {
    const forged = { ...real, [field]: value };
    assert.throws(() => bindDuelOfficialProgram(source, forged), TypeError, field);
  }
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, domains: ['Order'] }), TypeError);
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, tags: ['Recruit'] }), TypeError);
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, dataVersion: 'forged-version' }), /dataVersion/);
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, sourceCatalogDigest: 'sha256:forged' }), /digest/);
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, id: 'unknown-id' }), /not present/);
});

// 14
test('duplicate, sparse, and malformed source envelopes fail closed', () => {
  const real = card('ogn-049-298');
  assert.throws(() => duelAbilitySourceFromCatalog({ ...catalog, cards: [real, real] }), /duplicate/);
  assert.throws(() => duelAbilitySourceFromCatalog({ ...catalog, cards: [{ ...real, energy: undefined }] }), TypeError);
  assert.throws(() => duelAbilitySourceFromCatalog({ ...catalog, cards: [{ ...real, tags: ['Recruit', 1] }] }), TypeError);
  assert.equal(bindDuelOfficialProgramByCardId(source, 'does-not-exist'), undefined);
  assert.throws(() => bindDuelOfficialProgramByCardId({ ...source, cards: [real, real] }, real.id), /duplicate/);
});

// 15
test('registry accessors are clone-on-read/frozen and expose no arbitrary register authority', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  assert.equal(Object.prototype.hasOwnProperty.call(registry, 'registerProgram'), false);
  const first = registry.get('ogn-275-298');
  const second = registry.get('ogn-275-298');
  assert.notEqual(first, second);
  assert.notEqual(first.program, second.program);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.program), true);
  assert.equal(Object.isFrozen(first.program.semantics.effects[0].token), true);
  assert.throws(() => { first.program.semantics.effects[0].token.might = 999; }, TypeError);
  assert.equal(registry.get('ogn-275-298').program.semantics.effects[0].token.might, 1);
});

// 16
test('raw program codec is exact, canonical, and strict about extra/unknown nodes', () => {
  const program = bind('unl-187-219').program;
  const raw = encodeDuelOfficialProgramRaw(program);
  assert.equal(decodeDuelOfficialProgramRaw(raw).programId, program.programId);
  assert.deepEqual(validateDuelOfficialProgram(program), { ok: true, value: program, issues: [] });
  assert.throws(() => decodeDuelOfficialProgramRaw(`${raw.slice(0, -1)},\"extra\":true}`), /unknown or missing fields/);
  assert.throws(() => decodeDuelOfficialProgramRaw(raw.replace('"amount":3', '"amount":4')), /invalid conquer trigger/);
  assert.throws(() => decodeDuelOfficialProgramRaw(raw.replace('{"', '{ "')), /canonical/);
  assert.equal(program.kind, DUEL_OFFICIAL_IR_KIND);
  assert.equal(program.schemaVersion, DUEL_OFFICIAL_IR_SCHEMA_VERSION);
  assert.equal(program.ruleset, DUEL_OFFICIAL_RULESET);
});

// 17
test('program references resolve only with matching programId and source metadata', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  const program = registry.getProgram('ogn-308-298');
  const reference = createDuelProgramReference(program);
  assert.equal(reference.kind, DUEL_OFFICIAL_REFERENCE_KIND);
  assert.equal(resolveDuelProgramReference(registry, reference).programId, program.programId);
  const raw = encodeDuelProgramReferenceRaw(reference);
  assert.deepEqual(decodeDuelProgramReferenceRaw(raw), reference);
  assert.throws(() => resolveDuelProgramReference(registry, { ...reference, programId: 'forged' }), /programId/);
  assert.throws(() => resolveDuelProgramReference(registry, { ...reference, sourceCatalogDigest: 'sha256:forged' }), /metadata/);
  assert.throws(() => resolveDuelProgramReference(registry, { ...reference, dataVersion: 'future-epoch' }), /metadata/);
  assert.throws(() => decodeDuelProgramReferenceRaw(`${raw.slice(0, -1)},\"epoch\":99}`), TypeError);
});

// 18
test('token play is represented as deferred semantics, never as an engine-created Unit', () => {
  const altarEffect = bind('ogn-275-298').program.semantics.effects[0];
  const viktorEffect = bind('ogn-265-298').program.semantics.effects[0];
  for (const effect of [altarEffect, viktorEffect]) {
    assert.equal(effect.kind, 'play-recruit-token');
    assert.equal(effect.resolution, 'deferred-token-play');
    assert.equal(effect.token.physicalPrintingCardId, null);
    assert.equal('createUnit' in effect, false);
  }
});

// 19
test('both actual Poro printings bind identical full Gold creation semantics with distinct source metadata', () => {
  const [first, second] = PORO_IDS.map((id) => bind(id));
  for (const [i, result] of [first, second].entries()) {
    const id = PORO_IDS[i];
    assert.equal(result.status, 'resolved');
    assert.equal(result.program.programId, makeDuelOfficialProgramId(id));
    assert.equal(result.program.source.cardId, id);
    assert.equal(result.program.source.canonicalCardId, card(id).canonicalCardId);
    assert.equal(result.program.source.cardNumber, card(id).cardNumber);
    assert.equal(result.program.source.sourceCatalogDigest, catalog.digest);
    assert.equal(result.program.source.normalizedAbilityText, card(id).ability);
    assert.deepEqual(result.program.source.tags, card(id).tags);
  }
  assert.equal(first.program.source.canonicalCardId, second.program.source.canonicalCardId);
  assert.notEqual(first.program.programId, second.program.programId);
  assert.notEqual(first.program.source.cardNumber, second.program.source.cardNumber);
  assert.deepEqual(first.program.semantics, second.program.semantics);
});

// 20
test('Poro conquering-source Unit predicate is mandatory and costless, unlike Vi controller-conquer', () => {
  const poro = bind(PORO_IDS[0]).program.semantics;
  const vi = bind(VI_IDS[0]).program.semantics;
  assert.deepEqual(poro, {
    kind: 'trigger', event: 'conquer', sourceScope: 'conquering-source-unit',
    eventPredicate: {
      kind: 'source-unit-present-at-conquered-battlefield',
      participant: 'ability-source-unit', battlefield: 'conquered-battlefield',
      pointOutcome: 'including-negated-or-replaced',
    },
    condition: null, optional: false, costs: [],
    effects: [poro.effects[0]],
  });
  assert.equal(vi.sourceScope, 'ability-source');
  assert.deepEqual(vi.condition, { kind: 'assigned-excess-damage-at-least', amount: 3 });
  assert.equal(vi.optional, true);
  assert.deepEqual(vi.costs, [{ kind: 'exhaust-source' }]);
  assert.equal(vi.effects[0].kind, 'ready-unit');
  // CR 383.4.c: only the source Unit present at the Battlefield during the
  // controller's Conquer is eligible; negating/replacing the point does not cancel it.
  // Runtime presence/UID/point event facts require Core attestation, not DSL inference.
  assert.equal(poro.sourceScope !== vi.sourceScope, true);
});

// 21
test('Poro plays an exhausted, domainless Gear token in creating effect controller Base', () => {
  const { effects: [effect] } = bind(PORO_IDS[0]).program.semantics;
  exactKeys(effect, ['kind', 'token', 'controller', 'owner', 'destination', 'entryExhausted', 'resolution']);
  assert.deepEqual(effect, {
    kind: 'play-gold-gear-token',
    token: {
      kind: 'gear-token', tokenName: 'Gold', cardType: 'Gear', domains: [], domainless: true,
      energy: null, power: null, might: null, physicalPrintingCardId: null,
      defaultEntryReady: true, intrinsicAbility: createDuelGoldIntrinsicAbilityReference(),
    },
    controller: 'effect-controller', owner: 'effect-controller',
    destination: 'effect-controller-base', entryExhausted: true,
    resolution: 'deferred-token-play',
  });
  assert.equal(effect.token.intrinsicAbility.kind, DUEL_GOLD_INTRINSIC_REFERENCE_KIND);
  assert.equal(effect.token.intrinsicAbility.intrinsicId, DUEL_GOLD_INTRINSIC_ID);
  assert.equal('createUnit' in effect, false);
  assert.equal('playableFromHand' in effect.token, false);
  assert.equal('ready' in effect.token, false); // default Ready overridden for this effect.
});

// 22
test('Gold rule-bound intrinsic Reaction preserves ordered Kill + Exhaust costs and Add Any one Power', () => {
  const spec = getDuelGoldIntrinsicTokenAbilitySpec();
  const reference = createDuelGoldIntrinsicAbilityReference();
  assert.equal(spec.kind, DUEL_GOLD_INTRINSIC_ABILITY_KIND);
  assert.equal(spec.intrinsicId, DUEL_GOLD_INTRINSIC_ID);
  assert.equal(spec.sourceRule, 'CR-v1.4:187.5');
  assert.equal(spec.token, 'Gold gear token');
  assert.equal(spec.event, 'activate');
  assert.equal(spec.permission, 'reaction');
  assert.equal(spec.sourceScope, 'source-gold-gear-token');
  assert.deepEqual(spec.costs, [{ kind: 'kill-source' }, { kind: 'exhaust-source' }]);
  assert.deepEqual(spec.effects, [{ kind: 'add-universal-power', amount: 1,
    recipient: 'ability-controller', destination: 'rune-pool', expiration: 'rune-pool-reset' }]);
  assert.equal(spec.costs.some((cost) => cost.kind === 'energy'), false);
  assert.equal(spec.effects.some((effect) => effect.kind === 'add-energy'), false);
  assert.deepEqual(resolveDuelGoldIntrinsicAbilityReference(reference), spec);
  assert.notEqual(spec.kind, DUEL_OFFICIAL_IR_KIND);
  assert.equal('cardId' in spec, false);
  assert.equal('programId' in spec, false);
});

// 23
test('Gold intrinsic reference is strict, canonical, immutable, and not a forged printing ID', () => {
  const reference = createDuelGoldIntrinsicAbilityReference();
  const raw = encodeDuelGoldIntrinsicAbilityReferenceRaw(reference);
  assert.deepEqual(decodeDuelGoldIntrinsicAbilityReferenceRaw(raw), reference);
  assert.equal(Object.isFrozen(reference), true);
  assert.equal(Object.isFrozen(resolveDuelGoldIntrinsicAbilityReference(reference).costs[0]), true);
  assert.throws(() => resolveDuelGoldIntrinsicAbilityReference({ ...reference, intrinsicId: 'forged' }), TypeError);
  assert.throws(() => assertDuelGoldIntrinsicAbilityReference({ ...reference, printingCardId: 'sfd-t03' }), TypeError);
  assert.throws(() => decodeDuelGoldIntrinsicAbilityReferenceRaw(raw.replace('{"', '{ "')), /canonical/);
  assert.throws(() => decodeDuelGoldIntrinsicAbilityReferenceRaw('not-json'), /not JSON/);
  assert.throws(() => decodeDuelGoldIntrinsicAbilityReferenceRaw(JSON.stringify({ ...reference, kind: 'duel-official-program' })), TypeError);
});

// 24
test('Poro raw codec, strict source branch and reference round-trip preserve exact metadata', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  for (const id of PORO_IDS) {
    const program = registry.getProgram(id);
    const raw = encodeDuelOfficialProgramRaw(program);
    assert.deepEqual(decodeDuelOfficialProgramRaw(raw), program);
    assert.deepEqual(validateDuelOfficialProgram(program), { ok: true, value: program, issues: [] });
    const ref = createDuelProgramReference(program);
    assert.deepEqual(registry.reference(id), ref);
    assert.deepEqual(decodeDuelProgramReferenceRaw(encodeDuelProgramReferenceRaw(ref)), ref);
    assert.deepEqual(resolveDuelProgramReference(registry, ref), program);
    assert.throws(() => registry.resolve({ ...ref, sourceCatalogDigest: 'sha256:forged' }), /metadata/);
    assert.throws(() => registry.resolve({ ...ref, programId: makeDuelOfficialProgramId(PORO_IDS[1 - PORO_IDS.indexOf(id)]) }), /metadata|programId/);
  }
});

// 25
test('Gold raw rejects forged ability, source scope, extra field, token card/stats and entry override', () => {
  const program = bind(PORO_IDS[0]).program;
  const forged = () => structuredClone(program);
  for (const [label, mutate] of [
    ['sourceScope', (p) => { p.semantics.sourceScope = 'ability-source'; }],
    ['sourceParticipant', (p) => { p.semantics.eventPredicate.participant = 'conquering-player'; }],
    ['pointOutcome', (p) => { p.semantics.eventPredicate.pointOutcome = 'point-awarded-only'; }],
    ['eventPredicateExtra', (p) => { p.semantics.eventPredicate.extra = true; }],
    ['optional', (p) => { p.semantics.optional = true; }],
    ['condition', (p) => { p.semantics.condition = { kind: 'assigned-excess-damage-at-least', amount: 3 }; }],
    ['sourceText', (p) => { p.source.normalizedAbilityText += ' Reminder'; }],
    ['sourceType', (p) => { p.source.cardType = 'Legend'; }],
    ['extra', (p) => { p.semantics.effects[0].spoof = true; }],
    ['cardType', (p) => { p.semantics.effects[0].token.cardType = 'Unit'; }],
    ['stats', (p) => { p.semantics.effects[0].token.might = 1; }],
    ['printedId', (p) => { p.semantics.effects[0].token.physicalPrintingCardId = 'sfd-t03'; }],
    ['entryReady', (p) => { p.semantics.effects[0].entryExhausted = false; }],
    ['controller', (p) => { p.semantics.effects[0].controller = 'card-owner'; }],
    ['intrinsic', (p) => { p.semantics.effects[0].token.intrinsicAbility.intrinsicId = 'forged'; }],
  ]) {
    const changed = forged(); mutate(changed);
    assert.throws(() => decodeDuelOfficialProgramRaw(JSON.stringify(changed)), label);
    assert.equal(validateDuelOfficialProgram(changed).ok, false, label);
  }
  assert.throws(() => decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(program).replace('"gear-token"', '"unit-token"')));
});

// 26
test('whole source tuple rejects forged Poro metadata and altered complete text', () => {
  const real = card(PORO_IDS[0]);
  assert.equal(bindDuelOfficialProgram(source, structuredClone(real)).status, 'resolved');
  for (const [field, value] of [
    ['ability', real.ability + ' (Gold tokens have an extra ability.)'],
    ['cardType', 'Gear'], ['energy', 0], ['power', 1], ['might', 1],
    ['domains', ['Chaos']], ['tags', ['Poro']], ['name', 'Gold'],
    ['canonicalCardId', 'forged-canonical'], ['setCode', 'unl'], ['variant', 'alternate'],
  ]) {
    assert.throws(() => bindDuelOfficialProgram(source, { ...real, [field]: value }), TypeError, field);
  }
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, sourceCatalogDigest: 'sha256:forged' }), /digest/);
  assert.throws(() => bindDuelOfficialProgram(source, { ...real, id: 'invented-gold-printing' }), /not present/);
});

// 27
test('33 actual Gold whole-text printings: only two Poros resolve; other 31 remain unknown', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  const goldCards = catalog.cards.filter((entry) => typeof entry.ability === 'string' && entry.ability.includes('Gold'));
  assert.equal(goldCards.length, 33);
  assert.deepEqual(goldCards.filter((entry) => registry.get(entry.id).status === 'resolved').map((entry) => entry.id), PORO_IDS);
  for (const entry of goldCards.filter((candidate) => !PORO_IDS.includes(candidate.id))) {
    assert.equal(registry.get(entry.id).status, 'unknown', entry.id);
    assert.equal(registry.get(entry.id).unresolvedReason, 'unsupported-whole-ability', entry.id);
    assert.equal(registry.get(entry.id).program, null, entry.id);
  }
  for (const id of ['sfd-201-221', 'sfd-249-221', 'unl-018-219', 'rad-100-167', 'sfd-220-221']) {
    assert.equal(registry.get(id).status, 'unknown', id);
  }
  assert.equal(registry.knownProgramCount, 65);
  assert.equal(registry.size, 1381);
  assert.equal(catalog.cards.filter((entry) => registry.get(entry.id).status === 'unknown').length, 1316);
});

// 28
test('Poro registry scope, frozen clone-on-read, and no arbitrary token registration', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  assert.deepEqual(registry.eventScope(PORO_IDS[0], 'conquer'), {
    status: 'handlers-or-modifiers', event: 'conquer', programId: makeDuelOfficialProgramId(PORO_IDS[0]),
    handlers: ['trigger.conquer'], modifiers: [],
  });
  const first = registry.get(PORO_IDS[0]);
  const second = registry.get(PORO_IDS[0]);
  assert.notEqual(first.program, second.program);
  assert.equal(Object.isFrozen(first.program.semantics.effects[0].token.intrinsicAbility), true);
  assert.throws(() => { first.program.semantics.effects[0].entryExhausted = false; }, TypeError);
  assert.equal(registry.get(PORO_IDS[0]).program.semantics.effects[0].entryExhausted, true);
  assert.equal(Object.hasOwn(registry, 'registerToken'), false);
  assert.equal(Object.hasOwn(registry, 'registerProgram'), false);
  assert.equal(registry.has('sfd-t03'), true); // physical token artwork ≠ created Gold.
  assert.equal(registry.get('sfd-t03').status, 'unknown');
  assert.equal(registry.get('unl-t05').status, 'unknown');
  assert.equal(registry.reference('sfd-t03'), undefined);
});

// 29
test('all original twenty IDs and their old canonical program/reference formats still round-trip', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  const baseline = [
    ...NUMERIC_EMPTY_UNIT_IDS, ...VIKTOR_IDS, ...STATIC_IDS,
    ...RECRUIT_IDS, ...VI_IDS, 'ogn-275-298', 'ogn-278-298',
  ];
  assert.equal(baseline.length, 20);
  assert.equal(new Set(baseline).size, 20);
  for (const id of baseline) {
    const program = registry.getProgram(id);
    const ref = registry.reference(id);
    assert.equal(program.programId, makeDuelOfficialProgramId(id));
    assert.deepEqual(decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(program)), program, id);
    assert.deepEqual(decodeDuelProgramReferenceRaw(encodeDuelProgramReferenceRaw(ref)), ref, id);
    assert.deepEqual(resolveDuelProgramReference(registry, ref), program, id);
  }
});

// 30
test('Gold parser rejects unknown kinds, sparse nodes and forged deep fields without widening v1', () => {
  const baseline = bind(PORO_IDS[0]).program;
  for (const modify of [
    (p) => { p.semantics.kind = 'new-automatic-gold'; },
    (p) => { p.semantics.event = 'made-up-event'; },
    (p) => { p.semantics.effects = new Array(1); },
    (p) => { p.semantics.effects[0].token.domains = new Array(1); },
    (p) => { p.semantics.effects[0].token.intrinsicAbility.extra = 'yes'; },
    (p) => { p.semantics.costs = [{ kind: 'kill-source' }]; },
  ]) {
    const bad = structuredClone(baseline); modify(bad);
    assert.equal(validateDuelOfficialProgram(bad).ok, false);
  }
  assert.equal(queryDuelEventScope(bind(PORO_IDS[0]), 'made-up-event').status, 'unknown');
  assert.equal(queryDuelEventScope(bind('sfd-201-221'), 'conquer').status, 'unknown');
  assert.equal(createDuelOfficialProgramRegistry(source).reference('sfd-201-221'), undefined);
});

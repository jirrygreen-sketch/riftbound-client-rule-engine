// Default (clean-checkout) suite for the CR 164.2 Basic Rune rule grant.
//
// Reads the TRACKED synthetic fixture at test/fixtures/official-catalog.mjs. The
// verified Basic Rune allow-list is keyed by printing id + catalog version/digest,
// so the fixture carries the exact 30-printing identity table. No gitignored data
// is read and there is no data-missing skip. The real-catalog census is in the
// explicit `*.audit.mjs` files.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG, CENSUS, RESOLVED_IDS, RUNE_IDS, cardById } from '../fixtures/official-catalog.mjs';

const moduleSpecifier = process.env.DUEL_OFFICIAL_PROGRAMS_MODULE ?? '../../dist/duel/official-programs.js';
const {
  DUEL_OFFICIAL_IR_SCHEMA_VERSION,
  DUEL_GOLD_INTRINSIC_ID,
  bindDuelOfficialProgram,
  bindDuelOfficialProgramByCardId,
  createDuelOfficialProgramRegistry,
  createDuelProgramReference,
  decodeDuelOfficialProgramRaw,
  decodeDuelProgramReferenceRaw,
  duelAbilitySourceFromCatalog,
  encodeDuelOfficialProgramRaw,
  encodeDuelProgramReferenceRaw,
  getDuelGoldIntrinsicTokenAbilitySpec,
  makeDuelOfficialProgramId,
  parseDuelOfficialProgram,
  queryDuelEventScope,
  resolveDuelProgramReference,
  validateDuelOfficialProgram,
} = await import(moduleSpecifier);

const catalog = CATALOG;
const source = duelAbilitySourceFromCatalog(catalog);
const card = (id) => {
  const result = cardById(id);
  assert.ok(result, `fixture printing ${id}`);
  return result;
};
const bind = (id) => bindDuelOfficialProgram(source, card(id));
const runeCards = catalog.cards.filter((entry) => entry.cardType === 'Rune');
const identities = [...new Set(runeCards.map((entry) => entry.canonicalCardId))];
const ids = runeCards.map((entry) => entry.id);
const nonRuneResolvedIds = RESOLVED_IDS.filter((id) => !RUNE_IDS.includes(id));
const change = (id, fn) => {
  const clone = structuredClone(card(id));
  fn(clone);
  return clone;
};

// 1
test('source version/hash and exactly six identities, thirty genuine physical Basic Rune printings', () => {
  assert.equal(source.dataVersion, '2026-10-12-official-gallery');
  assert.equal(source.sourceCatalogDigest, 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10');
  assert.equal(new Set(ids).size, 30);
  assert.equal(identities.length, 6);
  assert.deepEqual(catalog.cards.filter((item) => item.cardType === 'Rune').map((item) => item.id).sort(), [...ids].sort());
  for (const entry of runeCards) {
    assert.equal(entry.domains.length, 1);
    assert.deepEqual(entry.tags, ['Basic']);
    assert.equal(entry.energy, null);
    assert.equal(entry.power, null);
    assert.equal(entry.might, null);
    assert.equal(typeof entry.canonicalCardId, 'string');
  }
});

// 2
test('all thirty bind as complete rule-granted programs in six domains, five variants each', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  const perDomain = new Map();
  for (const entry of runeCards) {
    const bound = bind(entry.id);
    assert.equal(bound.status, 'resolved', entry.id);
    assert.deepEqual(registry.get(entry.id), bound, entry.id);
    assert.equal(bindDuelOfficialProgramByCardId(source, entry.id).status, 'resolved');
    assert.equal(bound.program.programId, makeDuelOfficialProgramId(entry.id));
    assert.equal(bound.program.schemaVersion, DUEL_OFFICIAL_IR_SCHEMA_VERSION);
    assert.equal(bound.program.semantics.kind, 'basic-rune');
    assert.equal(bound.program.semantics.sourceRule, 'CR-v1.4:164.2');
    assert.equal(bound.program.semantics.domain, entry.domains[0]);
    assert.equal(bound.program.semantics.abilities.length, 2);
    assert.deepEqual(bound.program.source.domains, entry.domains);
    assert.equal(bound.program.source.canonicalCardId, entry.canonicalCardId);
    assert.equal(bound.program.source.cardNumber, entry.cardNumber);
    perDomain.set(entry.domains[0], (perDomain.get(entry.domains[0]) ?? 0) + 1);
  }
  assert.equal(perDomain.size, 6);
  for (const count of perDomain.values()) assert.equal(count, 5);
});

// 3
test('printed absence and six RAD showcase placeholders are distinct from CR-granted abilities', () => {
  assert.equal(runeCards.filter((entry) => entry.ability === '').length, 24);
  const placeholder = runeCards.filter((entry) => entry.ability === '[NO TEXT]');
  assert.equal(placeholder.length, 6);
  for (const entry of runeCards) {
    const binding = bind(entry.id);
    assert.equal(binding.normalizedAbilityText, entry.ability);
    assert.equal(binding.program.source.normalizedAbilityText, entry.ability);
    assert.equal(binding.program.semantics.abilities[0].sourceRule, 'CR-v1.4:164.2.a');
    assert.notEqual(binding.program.semantics.kind, 'no-ability');
  }
});

// 4
test('Energy activation is Reaction: exhaust source as cost, Add exactly one domainless Energy', () => {
  for (const id of ids) {
    const ability = bind(id).program.semantics.abilities[0];
    assert.deepEqual(ability, {
      kind: 'basic-rune-energy', sourceRule: 'CR-v1.4:164.2.a', event: 'activate',
      sourceScope: 'source-basic-rune', permission: 'reaction',
      costs: [{ kind: 'exhaust-source' }],
      effects: [{ kind: 'add-energy', amount: 1, recipient: 'ability-controller',
        destination: 'rune-pool', expiration: 'rune-pool-reset' }],
    });
    assert.equal(ability.costs.some((cost) => cost.kind === 'energy'), false);
  }
});

// 5
test('Power activation is Reaction: recycle source Rune even if exhausted, Add its exact domain Power', () => {
  for (const entry of runeCards) {
    const ability = bind(entry.id).program.semantics.abilities[1];
    assert.deepEqual(ability, {
      kind: 'basic-rune-power', sourceRule: 'CR-v1.4:164.2.b/164.2.b.1',
      event: 'activate', sourceScope: 'source-basic-rune', permission: 'reaction',
      costs: [{ kind: 'recycle-source', destination: 'source-owner-rune-deck', readiness: 'ready-or-exhausted' }],
      effects: [{ kind: 'add-domain-power', amount: 1, domain: entry.domains[0],
        domainSource: 'source-rune-domain', recipient: 'ability-controller',
        destination: 'rune-pool', expiration: 'rune-pool-reset' }],
    });
    assert.equal(ability.costs.some((cost) => cost.kind === 'exhaust-source'), false);
    assert.equal(ability.effects.some((effect) => effect.kind === 'add-universal-power'), false);
    assert.equal('sourceUID' in ability, false);
  }
});

// 6
test('complete Rune event scope reports both distinct activate handlers, without inventing phases', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  for (const id of ids) {
    assert.deepEqual(registry.eventScope(id, 'activate'), {
      status: 'handlers-or-modifiers', event: 'activate', programId: makeDuelOfficialProgramId(id),
      handlers: ['basic-rune.basic-rune-energy', 'basic-rune.basic-rune-power'], modifiers: [],
    });
    for (const event of ['begin', 'awaken', 'conquer', 'hold', 'hide', 'unit-enter', 'standard-move', 'play', 'attack', 'become-exhausted', 'death']) {
      assert.deepEqual(registry.eventScope(id, event), {
        status: 'known-no-handler', event, programId: makeDuelOfficialProgramId(id), handlers: [], modifiers: [],
      });
    }
    assert.deepEqual(queryDuelEventScope(registry.getProgram(id), 'channel-phase'), {
      status: 'unknown', event: 'channel-phase', programId: null, handlers: [], modifiers: [], reason: 'unknown-event',
    });
  }
});

// 7
test('all new physical Rune programs preserve strict raw codec and references, including RAD placeholders', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  for (const id of ids) {
    const program = registry.getProgram(id);
    const raw = encodeDuelOfficialProgramRaw(program);
    assert.deepEqual(decodeDuelOfficialProgramRaw(raw), program, id);
    assert.deepEqual(parseDuelOfficialProgram(program), program, id);
    const reference = createDuelProgramReference(program);
    assert.deepEqual(registry.reference(id), reference);
    assert.deepEqual(decodeDuelProgramReferenceRaw(encodeDuelProgramReferenceRaw(reference)), reference);
    assert.deepEqual(resolveDuelProgramReference(registry, reference), program);
    assert.deepEqual(registry.resolve(reference).program, program);
  }
});

// 8
test('forged candidate tuple is rejected on every identity, type, tag, domain, cost and metadata field', () => {
  const id = 'rad-r01a';
  assert.equal(bindDuelOfficialProgram(source, structuredClone(card(id))).status, 'resolved');
  for (const [field, value] of [
    ['id', 'rad-r99a'], ['cardType', 'Gear'], ['ability', ''], ['energy', 0], ['power', 0], ['might', 1],
    ['domains', ['Fury', 'Calm']], ['domains', ['Order']], ['tags', ['Basic', 'Token']],
    ['tags', []], ['canonicalCardId', card('rad-r02a').canonicalCardId], ['name', 'Gold'],
    ['fullName', 'Gold'], ['localizedName', '错误符文'], ['setCode', 'ogn'],
    ['cardNumber', 'RAD-R09a'], ['variant', 'standard'],
    ['dataVersion', 'future'], ['sourceCatalogDigest', 'sha256:forged'],
  ]) assert.throws(() => bindDuelOfficialProgram(source, change(id, (c) => { c[field] = value; })), TypeError, field);
  assert.throws(() => bindDuelOfficialProgram(source, change('ogn-007-298', (c) => { c.ability = '[NO TEXT]'; })), TypeError);
  assert.throws(() => bindDuelOfficialProgram(source, change('rad-r01a', (c) => { c.ability = ' [NO TEXT] '; })), TypeError);
});

// 9
test('altered trusted Rune source is unknown, not a forged no-ability program', () => {
  const genuine = card('ogn-007-298');
  for (const [field, value] of [
    ['ability', ''], ['ability', '[NO TEXT]'], ['cardType', 'Gear'], ['tags', ['Basic', 'Token']],
    ['domains', ['Order']], ['domains', ['Fury', 'Calm']], ['energy', 0], ['power', 0],
    ['might', 0], ['canonicalCardId', 'fake'], ['name', 'Other Rune'], ['fullName', 'Other Rune'],
    ['localizedName', 'fake'], ['setCode', 'rad'], ['cardNumber', 'FAKE'], ['variant', 'alternate'],
  ]) {
    if (field === 'ability' && value === '') continue;
    const changed = { ...genuine, [field]: value };
    const badSource = { ...source, cards: [changed] };
    assert.equal(bindDuelOfficialProgramByCardId(badSource, genuine.id).status, 'unknown', `${field}:${value}`);
  }
  assert.equal(bindDuelOfficialProgramByCardId({ ...source, cards: [{ ...card('rad-r01a'), ability: '' }] }, 'rad-r01a').status, 'unknown');
  for (const forged of [
    { ...genuine, cardType: 'Unit', ability: '', energy: 0 },
    { ...genuine, cardType: 'Unit', ability: 'I enter ready.' },
    { ...genuine, cardType: 'Legend', ability: ':rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.' },
  ]) {
    assert.equal(bindDuelOfficialProgramByCardId({ ...source, cards: [forged] }, genuine.id).status, 'unknown');
  }
});

// 10
test('catalog envelope/version/digest changes never grant Rune semantics', () => {
  const rune = card('ogn-042-298');
  for (const changed of [
    { ...source, dataVersion: 'new-gallery', cards: [rune] },
    { ...source, sourceCatalogDigest: 'sha256:fake', cards: [rune] },
    { ...source, cards: [{ ...rune, id: 'new-rune-printing' }] },
  ]) {
    const id = changed.cards[0].id;
    const result = bindDuelOfficialProgramByCardId(changed, id);
    assert.equal(result.status, 'unknown');
    assert.equal(result.program, null);
    assert.deepEqual(queryDuelEventScope(result, 'activate').handlers, []);
  }
  assert.throws(() => bindDuelOfficialProgram({ ...source, cards: [] }, rune), /not present/);
  assert.throws(() => bindDuelOfficialProgramByCardId({ ...source, cards: [rune, rune] }, rune.id), /duplicate/);
});

// 11
test('unrelated non-Rune printings and arbitrary no-text cards never inherit Basic Rune abilities', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  for (const id of ['syn-spell-unknown', 'syn-spell-empty', 'syn-legend-grant-ganking']) {
    assert.notEqual(registry.get(id).program?.semantics.kind, 'basic-rune');
  }
  for (const example of [
    { ...card('ogn-007-298'), id: 'invented-no-text-rune' },
    { ...card('ogn-007-298'), id: 'invented-gold', cardType: 'Gear' },
    { ...card('ogn-007-298'), id: 'invented-token', cardType: 'RuneToken', tags: ['Token'] },
    { ...card('ogn-007-298'), id: 'invented-legend', cardType: 'Legend' },
    { ...card('rad-r01a'), id: 'invented-placeholder-rune' },
  ]) {
    assert.equal(bindDuelOfficialProgramByCardId({ ...source, cards: [example] }, example.id).status, 'unknown');
  }
  assert.equal(Object.hasOwn(registry, 'registerProgram'), false);
  assert.equal(Object.hasOwn(registry, 'registerToken'), false);
});

// 12
test('program parser rejects cross-domain, removed ability, changed cost/effect/permission and source forgery', () => {
  const base = bind('rad-r06a').program;
  const bad = [
    (p) => { p.semantics.domain = 'Fury'; },
    (p) => { p.semantics.abilities.pop(); },
    (p) => { delete p.semantics.abilities[0]; },
    (p) => { p.semantics.abilities.extra = 1; },
    (p) => { delete p.semantics.abilities[0].costs[0]; },
    (p) => { p.semantics.abilities[1].effects.extra = 'hidden'; },
    (p) => { p.semantics.abilities.reverse(); },
    (p) => { p.semantics.abilities[0].permission = 'action'; },
    (p) => { p.semantics.abilities[0].sourceRule = 'CR-v1.4:187.5'; },
    (p) => { p.semantics.abilities[0].costs = [{ kind: 'energy', amount: 1, payer: 'ability-controller' }]; },
    (p) => { p.semantics.abilities[0].effects[0].kind = 'add-universal-power'; },
    (p) => { p.semantics.abilities[1].costs[0].kind = 'exhaust-source'; },
    (p) => { p.semantics.abilities[1].costs[0].destination = 'main-deck'; },
    (p) => { p.semantics.abilities[1].costs[0].readiness = 'ready-only'; },
    (p) => { p.semantics.abilities[1].effects[0].domain = 'Calm'; },
    (p) => { p.semantics.abilities[1].effects[0].domainSource = 'chosen-domain'; },
    (p) => { p.semantics.abilities[1].effects[0].destination = 'main-pool'; },
    (p) => { p.semantics.abilities[1].effects[0].recipient = 'card-owner'; },
    (p) => { p.semantics.abilities[1].effects[0].expiration = 'never'; },
    (p) => { p.semantics.abilities[1].effects[0].extra = true; },
    (p) => { p.source.tags = ['Token']; },
    (p) => { p.source.domains = ['Fury']; },
    (p) => { p.source.normalizedAbilityText = ''; },
    (p) => { p.source.dataVersion = 'other'; },
    (p) => { p.source.sourceCatalogDigest = 'sha256:fake'; },
    (p) => { p.source.cardNumber = 'RAD-R06'; },
    (p) => { p.source.cardType = 'RuneToken'; },
    (p) => { p.source.energy = 0; },
    (p) => { p.semantics = { kind: 'no-ability', playability: { kind: 'printed-unit', fromHand: true, energyCost: 0, tokenOnly: false } }; },
  ];
  for (const [index, mutate] of bad.entries()) {
    const program = structuredClone(base);
    mutate(program);
    assert.equal(validateDuelOfficialProgram(program).ok, false, `mutation ${index}`);
    assert.throws(() => decodeDuelOfficialProgramRaw(JSON.stringify(program)), `mutation ${index}`);
  }
});

// 13
test('canonical raw parser and references reject unknown fields, malformed or swapped bindings', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  const program = registry.getProgram('ogn-007-298');
  const raw = encodeDuelOfficialProgramRaw(program);
  assert.throws(() => decodeDuelOfficialProgramRaw(` ${raw}`), /canonical/);
  assert.throws(() => decodeDuelOfficialProgramRaw(`${raw.slice(0, -1)},"spoof":true}`), /unknown or missing fields/);
  const ref = registry.reference(program.cardId);
  const rawRef = encodeDuelProgramReferenceRaw(ref);
  assert.throws(() => decodeDuelProgramReferenceRaw(` ${rawRef}`), /canonical/);
  assert.throws(() => decodeDuelProgramReferenceRaw(`${rawRef.slice(0, -1)},"spoof":true}`), TypeError);
  for (const forged of [
    { ...ref, programId: makeDuelOfficialProgramId('rad-r01') },
    { ...ref, dataVersion: 'future' },
    { ...ref, sourceCatalogDigest: 'sha256:fake' },
    { ...ref, cardId: 'new-rune-printing', programId: makeDuelOfficialProgramId('new-rune-printing') },
  ]) assert.throws(() => resolveDuelProgramReference(registry, forged), TypeError);
});

// 14
test('registry is immutable clone-on-read across source, abilities, costs and effects', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  const a = registry.get('ogn-007-298');
  const b = registry.get('ogn-007-298');
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.program.semantics, b.program.semantics);
  assert.notStrictEqual(a.program.source.domains, b.program.source.domains);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(a.program.semantics.abilities[1].effects[0]), true);
  assert.equal(Object.isFrozen(a.program.semantics.abilities[1].costs[0]), true);
  assert.throws(() => { a.program.semantics.abilities[1].effects[0].domain = 'Calm'; }, TypeError);
  assert.throws(() => { a.program.source.domains[0] = 'Calm'; }, TypeError);
  assert.equal(registry.get('ogn-007-298').program.semantics.domain, 'Fury');
  const clone = structuredClone(card('ogn-007-298'));
  const mutableSource = duelAbilitySourceFromCatalog({ ...catalog, cards: [clone] });
  const fresh = createDuelOfficialProgramRegistry(mutableSource);
  clone.domains[0] = 'Calm';
  assert.equal(fresh.getProgram(clone.id).semantics.domain, 'Fury');
  assert.deepEqual(fresh.cardIds(), ['ogn-007-298']);
  assert.throws(() => { registry.getProgram('ogn-007-298').semantics.abilities[0].costs.push({ kind: 'energy' }); }, TypeError);
});

// 15
test('non-Rune resolved programs round-trip unchanged; Gold intrinsic stays separate', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  assert.equal(new Set(nonRuneResolvedIds).size, nonRuneResolvedIds.length);
  for (const id of nonRuneResolvedIds) {
    const program = registry.getProgram(id);
    assert.ok(program, id);
    assert.equal(program.programId, `riftbound-duel-official-v1:${id}`);
    assert.notEqual(program.semantics.kind, 'basic-rune');
    assert.deepEqual(decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(program)), program, id);
    const ref = registry.reference(id);
    assert.deepEqual(resolveDuelProgramReference(registry, decodeDuelProgramReferenceRaw(encodeDuelProgramReferenceRaw(ref))), program, id);
  }
  assert.equal(registry.eventScope('syn-unit-poro', 'conquer').handlers[0], 'trigger.conquer');
  assert.equal(registry.eventScope('syn-battlefield-hide', 'hide').modifiers[0], 'passive.additional-hide-permission');
  assert.equal(getDuelGoldIntrinsicTokenAbilitySpec().intrinsicId, DUEL_GOLD_INTRINSIC_ID);
  assert.equal(getDuelGoldIntrinsicTokenAbilitySpec().effects[0].kind, 'add-universal-power');
});

// 16
test('fixture census: only the expected printings resolve and the rest stay unknown', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  assert.equal(registry.size, CENSUS.size);
  assert.equal(registry.knownProgramCount, CENSUS.known);
  assert.equal(runeCards.length, 30);
  const resolved = registry.cardIds().filter((id) => registry.get(id).status === 'resolved').sort();
  assert.deepEqual(resolved, [...RESOLVED_IDS].sort());
  assert.equal(registry.cardIds().length - resolved.length, CENSUS.unknown);
  assert.equal(registry.get('syn-spell-unknown').status, 'unknown');
  assert.equal(registry.eventScope('syn-spell-unknown', 'activate').status, 'unknown');
});

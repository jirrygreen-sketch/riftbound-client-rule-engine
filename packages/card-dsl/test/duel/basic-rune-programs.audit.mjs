// OPT-IN audit: CR 164.2 Basic Rune rule grant against the REAL catalog.
// NOT part of the default `*.test.mjs` glob; run with
//   pnpm --filter @riftbound/card-dsl audit:official-catalog
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

// The test runner points at an isolated compiler output; never shared package dist.
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

const CATALOG_URL = new URL('../../../../packages/card-data/data/deck-catalog.json', import.meta.url);
if (!fs.existsSync(CATALOG_URL)) {
  throw new Error(
    'audit:official-catalog requires the gitignored official catalog at packages/card-data/data/deck-catalog.json; ' +
    'run the card-data sync/build pipeline first.',
  );
}

const bytes = fs.readFileSync(CATALOG_URL);
const catalog = JSON.parse(bytes.toString('utf8'));
const source = duelAbilitySourceFromCatalog(catalog);
const card = (id) => {
  const result = catalog.cards.find((entry) => entry.id === id);
  assert.ok(result, `actual catalog printing ${id}`);
  return result;
};
const bind = (id) => bindDuelOfficialProgram(source, card(id));
const identities = [
  ['Fury', '007', '01', '炽烈符文', '30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902'],
  ['Calm', '042', '02', '翠意符文', 'efe5e5f4811f4089cd86b83cd6b8385613b0f469b2c2ae9f6b74a55ceb5cf0ed'],
  ['Mind', '089', '03', '灵光符文', 'a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b'],
  ['Body', '126', '04', '摧破符文', 'a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17'],
  ['Chaos', '166', '05', '混沌符文', '055d9ad1c38fc05b800d053d3845209673f5397b39fb7bf76787adbc8cf42743'],
  ['Order', '214', '06', '序理符文', 'e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67'],
];
const expected = identities.flatMap(([domain, ogn, rad, localizedName, canonicalHash]) => [
  ['ogn', `ogn-${ogn}-298`, `OGN-${ogn}/298`, 'standard', ''],
  ['ogn', `ogn-${ogn}a-298`, `OGN-${ogn}a/298`, 'alternate', ''],
  ['rad', `rad-r${rad}`, `RAD-R${rad}`, 'standard', ''],
  ['rad', `rad-r${rad}a`, `RAD-R${rad}a`, 'alternate', '[NO TEXT]'],
  ['ven', `ven-r${rad}`, `VEN-R${rad}`, 'standard', ''],
].map(([setCode, id, cardNumber, variant, ability]) => ({
  id, cardType: 'Rune', canonicalCardId: `card.hash-${canonicalHash}`,
  name: `${domain} Rune`, fullName: `${domain} Rune`, localizedName,
  domains: [domain], tags: ['Basic'], setCode, cardNumber, variant, ability,
  energy: null, power: null, might: null,
})));
const ids = expected.map((item) => item.id);
const oldIds = [
  'ogn-049-298', 'ogn-088-298', 'ogn-142-298', 'ogn-175-298', 'ogn-219-298',
  'ogn-265-298', 'ogn-271-298', 'ogn-272-298', 'ogn-273-298', 'ogn-275-298',
  'ogn-278-298', 'ogn-308-298', 'ogn-308-star-298', 'ogs-009-024', 'ogs-016-024',
  'sfd-006-221', 'sfd-069-221', 'unl-187-219', 'unl-222-219', 'unl-229-219',
  'unl-229-star-219', 'ven-t04',
];
// The 2026-10-13 catalog re-binding resolved eleven additional whole-ability
// templates (twelve physical printings, since ogn-117 has a standard and an
// alternate printing): six units, five spells and one battlefield. These are
// source-resolved complete-text bindings, not executed behavior.
const newWholeIds = [
  'ogn-091-298', 'ogn-105-298', 'ogn-114-298', 'ogn-117-298', 'ogn-117a-298',
  'ogn-209-298', 'ogn-229-298', 'ogn-234-298', 'ogn-280-298', 'unl-077-219',
  'unl-180-219', 'ven-048-166',
];
const change = (id, fn) => {
  const clone = structuredClone(card(id));
  fn(clone);
  return clone;
};

// 1
test('source version/hash and exactly six identities, thirty genuine physical Basic Rune printings', () => {
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '06d99a589fed6046bff8072847946d5304a8ca43ef1e4e2c680c4a7a0f1df766');
  assert.equal(catalog.dataVersion, '2026-10-12-official-gallery');
  assert.equal(catalog.digest, 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10');
  assert.equal(new Set(ids).size, 30);
  assert.equal(new Set(expected.map((item) => item.canonicalCardId)).size, 6);
  assert.deepEqual(catalog.cards.filter((item) => item.cardType === 'Rune').map((item) => item.id).sort(), [...ids].sort());
  for (const item of expected) {
    const actual = card(item.id);
    for (const [key, value] of Object.entries(item)) assert.deepEqual(actual[key], value, `${item.id}.${key}`);
  }
});

// 2
test('all thirty bind as complete rule-granted programs in six domains, five variants each', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  for (const item of expected) {
    const bound = bind(item.id);
    assert.equal(bound.status, 'resolved', item.id);
    assert.deepEqual(registry.get(item.id), bound, item.id);
    assert.equal(bindDuelOfficialProgramByCardId(source, item.id).status, 'resolved');
    assert.equal(bound.program.programId, makeDuelOfficialProgramId(item.id));
    assert.equal(bound.program.schemaVersion, DUEL_OFFICIAL_IR_SCHEMA_VERSION);
    assert.equal(bound.program.semantics.kind, 'basic-rune');
    assert.equal(bound.program.semantics.sourceRule, 'CR-v1.4:164.2');
    assert.equal(bound.program.semantics.domain, item.domains[0]);
    assert.equal(bound.program.semantics.abilities.length, 2);
    assert.deepEqual(bound.program.source.domains, item.domains);
    assert.equal(bound.program.source.canonicalCardId, item.canonicalCardId);
    assert.equal(bound.program.source.cardNumber, item.cardNumber);
  }
});

// 3
test('printed absence and six RAD showcase placeholders are distinct from CR-granted abilities', () => {
  assert.equal(expected.filter((entry) => entry.ability === '').length, 24);
  const placeholder = expected.filter((entry) => entry.ability === '[NO TEXT]');
  assert.deepEqual(placeholder.map((entry) => entry.id), identities.map(([, , rad]) => `rad-r${rad}a`));
  for (const item of expected) {
    const binding = bind(item.id);
    assert.equal(binding.normalizedAbilityText, item.ability);
    assert.equal(binding.program.source.normalizedAbilityText, item.ability);
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
  for (const item of expected) {
    const ability = bind(item.id).program.semantics.abilities[1];
    assert.deepEqual(ability, {
      kind: 'basic-rune-power', sourceRule: 'CR-v1.4:164.2.b/164.2.b.1',
      event: 'activate', sourceScope: 'source-basic-rune', permission: 'reaction',
      costs: [{ kind: 'recycle-source', destination: 'source-owner-rune-deck', readiness: 'ready-or-exhausted' }],
      effects: [{ kind: 'add-domain-power', amount: 1, domain: item.domains[0],
        domainSource: 'source-rune-domain', recipient: 'ability-controller',
        destination: 'rune-pool', expiration: 'rune-pool-reset' }],
    });
    assert.equal(ability.costs.some((cost) => cost.kind === 'exhaust-source'), false);
    assert.equal(ability.effects.some((effect) => effect.kind === 'add-universal-power'), false);
    assert.equal('sourceUID' in ability, false); // Core verifies live UID/zoneEpoch/controller/timing.
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
test('unrelated Rune/Gear/Legend tokens and arbitrary no-text cards never inherit Basic Rune abilities', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  for (const id of ['sfd-t03', 'unl-t05', 'ogn-001-298', 'ogn-278-298']) {
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
test('old twenty-two printing IDs and reference/raw semantics unchanged; Gold intrinsic separate', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  assert.equal(new Set(oldIds).size, 22);
  for (const id of oldIds) {
    const program = registry.getProgram(id);
    assert.ok(program, id);
    assert.equal(program.programId, `riftbound-duel-official-v1:${id}`);
    assert.notEqual(program.semantics.kind, 'basic-rune');
    assert.deepEqual(decodeDuelOfficialProgramRaw(encodeDuelOfficialProgramRaw(program)), program, id);
    const ref = registry.reference(id);
    assert.deepEqual(resolveDuelProgramReference(registry, decodeDuelProgramReferenceRaw(encodeDuelProgramReferenceRaw(ref))), program, id);
  }
  assert.equal(registry.eventScope('unl-187-219', 'conquer').handlers[0], 'trigger.conquer');
  assert.equal(registry.eventScope('ogn-278-298', 'hide').modifiers[0], 'passive.additional-hide-permission');
  assert.equal(registry.eventScope('ogn-265-298', 'activate').handlers[0], 'activated.activate');
  assert.equal(getDuelGoldIntrinsicTokenAbilitySpec().intrinsicId, DUEL_GOLD_INTRINSIC_ID);
  assert.equal(getDuelGoldIntrinsicTokenAbilitySpec().effects[0].kind, 'add-universal-power');
});

// 16
test('fresh catalog census: old 22 + 30 Rune + 12 re-bound + one Reaction printing, 1316 unknown', () => {
  const registry = createDuelOfficialProgramRegistry(source);
  assert.equal(registry.size, 1381);
  assert.equal(registry.knownProgramCount, 65);
  const resolved = registry.cardIds().filter((id) => registry.get(id).status === 'resolved').sort();
  assert.deepEqual(resolved, [...oldIds, ...ids, ...newWholeIds, 'sfd-087-221'].sort());
  assert.equal(registry.cardIds().length - resolved.length, 1316);
  assert.equal(registry.get('ogn-001-298').status, 'unknown');
  assert.equal(registry.eventScope('ogn-001-298', 'activate').status, 'unknown');
});
